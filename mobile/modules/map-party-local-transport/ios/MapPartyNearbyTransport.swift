import Foundation
import NearbyConnections

final class MapPartyNearbyTransport: NSObject {
  private static let serviceID = "com.arthur.mapparty.offline"
  private static let maxEnvelopeBytes = 16 * 1024
  private static let maxTTLSeconds: TimeInterval = 180
  private static let maxHops = 3
  private static let dedupLimit = 512
  var onMessage: (([String: Any]) -> Void)?
  var onVerification: (([String: Any]) -> Void)?
  var onPeer: (([String: Any]) -> Void)?
  private let queue = DispatchQueue(label: "com.arthur.mapparty.nearby", qos: .utility)
  private var roomID = ""; private var participantID = ""
  private var manager: ConnectionManager?; private var advertiser: Advertiser?; private var discoverer: Discoverer?
  private var trusted = Set<EndpointID>(); private var seen = Set<String>(); private var seenOrder: [String] = []

  func start(roomID: String, participantID: String) {
    queue.async { guard !roomID.isEmpty, !participantID.isEmpty else { return }; self.stopLocked(); self.roomID = roomID; self.participantID = participantID
      let manager = ConnectionManager(serviceID: Self.serviceID, strategy: .cluster, queue: self.queue); manager.delegate = self; self.manager = manager
      let advertiser = Advertiser(connectionManager: manager); advertiser.delegate = self; advertiser.startAdvertising(using: self.contextData()); self.advertiser = advertiser
      let discoverer = Discoverer(connectionManager: manager); discoverer.delegate = self; discoverer.startDiscovery(); self.discoverer = discoverer; self.onPeer?(["state": "started"]) }
  }
  func stop() { queue.async { self.stopLocked() } }
  func send(json: String) { queue.async { guard let manager = self.manager, let data = self.envelopeData(json), !self.trusted.isEmpty else { return }; self.remember(self.fingerprint(data)); _ = manager.send(data, to: Array(self.trusted)) } }
  // The current JS bridge accepts Nearby verification automatically. Keep the
  // method for API parity with Android and for a future user-confirmation UI.
  func verify(endpointID: String, accepted: Bool) { }
  private func contextData() -> Data { (try? JSONSerialization.data(withJSONObject: ["room": roomID, "participant": participantID])) ?? Data() }
  private func stopLocked() { advertiser?.stopAdvertising(); discoverer?.stopDiscovery(); manager = nil; advertiser = nil; discoverer = nil; trusted.removeAll() }
  @discardableResult private func remember(_ key: String) -> Bool { guard !seen.contains(key) else { return false }; seen.insert(key); seenOrder.append(key); if seenOrder.count > Self.dedupLimit { seen.remove(seenOrder.removeFirst()) }; return true }
  private func envelopeData(_ json: String) -> Data? { guard let data = json.data(using: .utf8), var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }; object["roomId"] = roomID; object["messageId"] = string(object["messageId"]) ?? UUID().uuidString; object["createdAt"] = number(object["createdAt"]) ?? Date().timeIntervalSince1970 * 1000; let expiry = Date().timeIntervalSince1970 * 1000 + Self.maxTTLSeconds * 1000; object["expiresAt"] = min(number(object["expiresAt"]) ?? expiry, expiry); object["hops"] = min(max(Int(number(object["hops"]) ?? 0), 0), Self.maxHops); return try? JSONSerialization.data(withJSONObject: object) }
  private func validEnvelope(_ data: Data) -> [String: Any]? { guard data.count > 0, data.count <= Self.maxEnvelopeBytes, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], string(object["roomId"]) == roomID, let expiry = number(object["expiresAt"]), expiry > Date().timeIntervalSince1970 * 1000 else { return nil }; return object }
  private func number(_ value: Any?) -> TimeInterval? { (value as? NSNumber)?.doubleValue ?? (value as? Double) ?? (value as? String).flatMap(TimeInterval.init) }
  private func string(_ value: Any?) -> String? { guard let value = value as? String, !value.isEmpty else { return nil }; return value }
  private func fingerprint(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
  private func validContext(_ data: Data) -> Bool { guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return false }; return object["room"] == roomID }
}

extension MapPartyNearbyTransport: AdvertiserDelegate {
  func advertiser(_ advertiser: Advertiser, didReceiveConnectionRequestFrom endpointID: EndpointID, with context: Data, connectionRequestHandler: @escaping (Bool) -> Void) { connectionRequestHandler(validContext(context)) }
}
extension MapPartyNearbyTransport: DiscovererDelegate {
  func discoverer(_ discoverer: Discoverer, didFind endpointID: EndpointID, with context: Data) { guard validContext(context) else { return }; discoverer.requestConnection(to: endpointID, using: contextData()) }
  func discoverer(_ discoverer: Discoverer, didLose endpointID: EndpointID) { trusted.remove(endpointID); onPeer?(["endpointId": endpointID, "state": "lost"]) }
}
extension MapPartyNearbyTransport: ConnectionManagerDelegate {
  func connectionManager(_ connectionManager: ConnectionManager, didReceive verificationCode: String, from endpointID: EndpointID, verificationHandler: @escaping (Bool) -> Void) { onVerification?(["endpointId": endpointID, "authenticationToken": verificationCode]); verificationHandler(true); trusted.insert(endpointID) }
  func connectionManager(_ connectionManager: ConnectionManager, didReceive data: Data, withID payloadID: PayloadID, from endpointID: EndpointID) { guard trusted.contains(endpointID), var object = validEnvelope(data), remember(fingerprint(data)) else { return }; object["endpointId"] = endpointID; object["payloadId"] = String(payloadID); onMessage?(object); let hops = Int(number(object["hops"]) ?? 0); if hops < Self.maxHops { object["hops"] = hops + 1; if let relay = try? JSONSerialization.data(withJSONObject: object) { _ = connectionManager.send(relay, to: trusted.filter { $0 != endpointID }) } } }
  func connectionManager(_ connectionManager: ConnectionManager, didChangeTo state: ConnectionState, for endpointID: EndpointID) { let text = String(describing: state).lowercased(); if text.contains("connected") { trusted.insert(endpointID) }; if text.contains("disconnected") || text.contains("rejected") { trusted.remove(endpointID) }; onPeer?(["endpointId": endpointID, "state": text]) }
}
