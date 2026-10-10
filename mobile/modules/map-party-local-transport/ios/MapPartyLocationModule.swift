import ExpoModulesCore
import CoreLocation
import Foundation
import Security

private final class MapPartyLocationDelegate: NSObject, CLLocationManagerDelegate {
  weak var owner: MapPartyLocationModule?
  // CLLocationManager must be created and configured on the main thread.
  // Expo may instantiate this module on a background queue during startup.
  let manager: CLLocationManager

  func configure(mode: String) {
    let navigation = mode == "navigation" || mode == "boat"
    // The iOS default/nearest-ten-metre mode is too coarse for the initial
    // fix and can turn horizontal GPS noise into visible phantom movement.
    // Use the native high-accuracy provider in tracking too; JS stabilization
    // still rejects implausible jumps before they reach the map.
    manager.desiredAccuracy = mode == "navigation" ? kCLLocationAccuracyBestForNavigation : (mode == "boat" ? kCLLocationAccuracyBest : kCLLocationAccuracyNearestTenMeters)
    manager.distanceFilter = mode == "navigation" ? 3 : (mode == "boat" ? 5 : 20)
    manager.pausesLocationUpdatesAutomatically = false
    manager.activityType = mode == "navigation" ? .automotiveNavigation : (mode == "boat" ? .otherNavigation : .other)
    manager.allowsBackgroundLocationUpdates = navigation || mode == "tracking"
  }

  override init() {
    var createdManager: CLLocationManager!
    if Thread.isMainThread {
      createdManager = CLLocationManager()
    } else {
      DispatchQueue.main.sync {
        createdManager = CLLocationManager()
      }
    }
    manager = createdManager
    super.init()
    let configure = {
      self.manager.delegate = self
      self.configure(mode: "tracking")
      self.manager.showsBackgroundLocationIndicator = true
    }
    if Thread.isMainThread {
      configure()
    } else {
      DispatchQueue.main.sync(execute: configure)
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    guard location.horizontalAccuracy >= 0 else { return }
    owner?.sendLocation(location)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    owner?.sendEvent("onLocationError", ["message": error.localizedDescription])
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    owner?.authorizationChanged(manager.authorizationStatus)
  }
}

private final class MapPartyBackgroundUploadDelegate: NSObject, URLSessionTaskDelegate {
  weak var owner: MapPartyLocationModule?

  init(owner: MapPartyLocationModule) {
    self.owner = owner
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    owner?.backgroundUploadDidComplete(task, error: error)
  }
}

public final class MapPartyLocationModule: Module {
  private static let keychainService = "com.arthur.mapparty.background"
  private static let keychainAccount = "location-credential"
  private let delegate = MapPartyLocationDelegate()
  private var authorizationContinuation: CheckedContinuation<Bool, Never>?
  private lazy var backgroundUploadDelegate = MapPartyBackgroundUploadDelegate(owner: self)
  private lazy var uploadSession: URLSession = {
    let configuration = URLSessionConfiguration.background(withIdentifier: "com.arthur.mapparty.location-upload")
    configuration.isDiscretionary = false
    configuration.sessionSendsLaunchEvents = true
    configuration.waitsForConnectivity = true
    return URLSession(configuration: configuration, delegate: backgroundUploadDelegate, delegateQueue: nil)
  }()

  public func definition() -> ModuleDefinition {
    Name("MapPartyLocation")
    Events("onLocation", "onLocationError")

    OnCreate {
      self.delegate.owner = self
    }

    AsyncFunction("isPermissionGranted") {
      CLLocationManager.authorizationStatus() == .authorizedWhenInUse || CLLocationManager.authorizationStatus() == .authorizedAlways
    }

    AsyncFunction("authorizationStatus") {
      Self.authorizationStatusName(CLLocationManager.authorizationStatus())
    }

    AsyncFunction("requestPermission") { () async -> Bool in
      await self.requestAuthorization(always: false)
    }

    AsyncFunction("requestBackgroundPermission") { () async -> Bool in
      await self.requestAuthorization(always: true)
    }

    AsyncFunction("setMode") { (mode: String) in
      DispatchQueue.main.async { self.delegate.configure(mode: mode) }
    }

    AsyncFunction("configureBackgroundUpload") { (options: [String: String]) -> Bool in
      let required = ["serverUrl", "roomId", "participantId", "deviceId", "credential"]
      guard required.allSatisfy({ !(options[$0]?.isEmpty ?? true) }) else { return false }
      let defaults = UserDefaults.standard
      defaults.set(options["serverUrl"], forKey: "mapparty.background.serverUrl")
      defaults.set(options["roomId"], forKey: "mapparty.background.roomId")
      defaults.set(options["participantId"], forKey: "mapparty.background.participantId")
      defaults.set(options["deviceId"], forKey: "mapparty.background.deviceId")
      return self.saveCredential(options["credential"]!)
    }

    AsyncFunction("start") {
      DispatchQueue.main.async {
        self.delegate.manager.startUpdatingLocation()
        self.delegate.manager.requestLocation()
        self.dispatchPendingIfConfigured()
      }
    }

    AsyncFunction("stop") {
      DispatchQueue.main.async {
        self.delegate.manager.stopUpdatingLocation()
      }
    }
  }

  fileprivate func sendLocation(_ location: CLLocation) {
    let coordinate = location.coordinate
    var eventBody: [String: Any] = [
      "latitude": coordinate.latitude,
      "longitude": coordinate.longitude,
      "accuracy": max(0, location.horizontalAccuracy),
      "timestamp": Int(location.timestamp.timeIntervalSince1970 * 1000)
    ]
    var uploadBody: [String: Any] = [
      // Keep the native producer identical to Android and the REST contract.
      "lat": coordinate.latitude,
      "lng": coordinate.longitude,
      "accuracy": max(0, location.horizontalAccuracy),
      "timestamp": Int(location.timestamp.timeIntervalSince1970 * 1000)
    ]
    if location.speed >= 0 {
      eventBody["speed"] = location.speed
      uploadBody["speed"] = location.speed
    }
    if location.course >= 0 {
      eventBody["heading"] = location.course
      uploadBody["heading"] = location.course
    }
    sendEvent("onLocation", eventBody)
    uploadLocation(uploadBody)
  }

  private func uploadLocation(_ body: [String: Any]) {
    let defaults = UserDefaults.standard
    guard let serverUrl = defaults.string(forKey: "mapparty.background.serverUrl"),
          let roomId = defaults.string(forKey: "mapparty.background.roomId"),
          let deviceId = defaults.string(forKey: "mapparty.background.deviceId"),
          let credential = credentialValue(),
          let url = URL(string: "\(serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/api/party/\(roomId)/location") else { return }
    let sequence = max(defaults.integer(forKey: "mapparty.background.sequence") + 1, Int(Date().timeIntervalSince1970 * 1000))
    defaults.set(sequence, forKey: "mapparty.background.sequence")
    var payload = body
    payload["contractVersion"] = 1
    payload["locationSequence"] = sequence
    payload["forceBroadcast"] = true
    guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
    defaults.set(data, forKey: "mapparty.background.pending")
    dispatchPending(url: url, deviceId: deviceId, credential: credential)
  }

  private func dispatchPending(url: URL, deviceId: String, credential: String) {
    let defaults = UserDefaults.standard
    guard let pending = defaults.data(forKey: "mapparty.background.pending") else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 5
    request.httpBody = pending
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
    request.setValue(deviceId, forHTTPHeaderField: "X-Device-ID")
    let sequence = (try? JSONSerialization.jsonObject(with: pending) as? [String: Any])?["locationSequence"] as? NSNumber
    let task = uploadSession.uploadTask(with: request, from: pending)
    task.taskDescription = sequence?.stringValue
    task.resume()
  }

  private func dispatchPendingIfConfigured() {
    let defaults = UserDefaults.standard
    guard let serverUrl = defaults.string(forKey: "mapparty.background.serverUrl"),
          let roomId = defaults.string(forKey: "mapparty.background.roomId"),
          let deviceId = defaults.string(forKey: "mapparty.background.deviceId"),
          let credential = credentialValue(),
          let url = URL(string: "\(serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/api/party/\(roomId)/location") else { return }
    dispatchPending(url: url, deviceId: deviceId, credential: credential)
  }

  private func saveCredential(_ credential: String) -> Bool {
    guard let data = credential.data(using: .utf8) else { return false }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.keychainService,
      kSecAttrAccount as String: Self.keychainAccount
    ]
    SecItemDelete(query as CFDictionary)
    let item = query.merging([
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    ]) { _, new in new }
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
  }

  private func credentialValue() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.keychainService,
      kSecAttrAccount as String: Self.keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var result: CFTypeRef?
    if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
       let data = result as? Data,
       let credential = String(data: data, encoding: .utf8) {
      return credential
    }
    let legacy = UserDefaults.standard.string(forKey: "mapparty.background.credential")
    if let legacy, saveCredential(legacy) {
      UserDefaults.standard.removeObject(forKey: "mapparty.background.credential")
      return legacy
    }
    return nil
  }

  fileprivate func authorizationChanged(_ status: CLAuthorizationStatus) {
    guard status == .authorizedWhenInUse || status == .authorizedAlways || status == .denied || status == .restricted else { return }
    let granted = status == .authorizedWhenInUse || status == .authorizedAlways
    authorizationContinuation?.resume(returning: granted)
    authorizationContinuation = nil
  }

  private func requestAuthorization(always: Bool) async -> Bool {
    let status = CLLocationManager.authorizationStatus()
    if status == .authorizedAlways || (!always && status == .authorizedWhenInUse) { return true }
    if status == .denied || status == .restricted { return false }
    if always && status == .authorizedWhenInUse {
      return await waitForAuthorization { self.delegate.manager.requestAlwaysAuthorization() }
    }
    if status == .notDetermined {
      let granted = await waitForAuthorization { self.delegate.manager.requestWhenInUseAuthorization() }
      if !always || !granted || CLLocationManager.authorizationStatus() != .authorizedWhenInUse { return granted }
      return await waitForAuthorization { self.delegate.manager.requestAlwaysAuthorization() }
    }
    return false
  }

  private func waitForAuthorization(_ request: @escaping () -> Void) async -> Bool {
    await withCheckedContinuation { continuation in
      authorizationContinuation = continuation
      DispatchQueue.main.async {
        request()
        self.authorizationChanged(CLLocationManager.authorizationStatus())
      }
    }
  }

  private static func authorizationStatusName(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    case .authorizedAlways: return "authorizedAlways"
    case .authorizedWhenInUse: return "authorizedWhenInUse"
    @unknown default: return "unknown"
    }
  }

  fileprivate func backgroundUploadDidComplete(_ task: URLSessionTask, error: Error?) {
    guard error == nil,
          let response = task.response as? HTTPURLResponse,
          (200...299).contains(response.statusCode),
          let taskSequence = task.taskDescription,
          let pending = UserDefaults.standard.data(forKey: "mapparty.background.pending"),
          let object = try? JSONSerialization.jsonObject(with: pending) as? [String: Any],
          String(describing: object["locationSequence"] ?? "") == taskSequence else { return }
    UserDefaults.standard.removeObject(forKey: "mapparty.background.pending")
  }
}
