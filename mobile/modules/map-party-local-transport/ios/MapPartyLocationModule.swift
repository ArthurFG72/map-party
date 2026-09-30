import ExpoModulesCore
import CoreLocation

private final class MapPartyLocationDelegate: NSObject, CLLocationManagerDelegate {
  weak var owner: MapPartyLocationModule?
  let manager = CLLocationManager()

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    manager.distanceFilter = 1
    manager.pausesLocationUpdatesAutomatically = false
    manager.allowsBackgroundLocationUpdates = true
    manager.showsBackgroundLocationIndicator = true
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    owner?.sendLocation(location)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    owner?.sendEvent("onLocationError", ["message": error.localizedDescription])
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    owner?.authorizationChanged(manager.authorizationStatus)
  }
}

public final class MapPartyLocationModule: Module {
  private let delegate = MapPartyLocationDelegate()
  private var authorizationContinuation: CheckedContinuation<Bool, Never>?

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

    AsyncFunction("start") {
      DispatchQueue.main.async {
        self.delegate.manager.startUpdatingLocation()
        self.delegate.manager.requestLocation()
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
    var body: [String: Any] = [
      "latitude": coordinate.latitude,
      "longitude": coordinate.longitude,
      "accuracy": max(0, location.horizontalAccuracy),
      "timestamp": Int(location.timestamp.timeIntervalSince1970 * 1000)
    ]
    if location.speed >= 0 { body["speed"] = location.speed }
    if location.course >= 0 { body["heading"] = location.course }
    sendEvent("onLocation", body)
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
}
