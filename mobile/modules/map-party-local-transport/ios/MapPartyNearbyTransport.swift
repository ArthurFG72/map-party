import Foundation
import MultipeerConnectivity

final class MapPartyNearbyTransport: NSObject {
  private static let serviceType = "mapparty"
  private static let maxEnvelopeBytes = 16 * 1024
  private static let maxTTLSeconds: TimeInterval = 3 * 60
  private static let maxHops = 3
  private static let dedupLimit = 512

  var onMessage: (([String: Any]) -> Void)?
  var onVerification: (([String: Any]) -> Void)?
  var onPeer: (([String: Any]) -> Void)?

  private let queue = DispatchQueue(label: "com.arthur.mapparty.multipeer", qos: .utility)
  private var roomID = ""
  private var participantID = ""
  private var session: MCSession?
  private var advertiser: MCNearbyServiceAdvertiser?
  private var browser: MCNearbyServiceBrowser?
  private var pendingVerification = Set<String>()
  private var trustedPeers = Set<String>()
  private var seen = Set<String>()
  private var seenOrder: [String] = []

  func start(roomID: String, participantID: String) {
    queue.async {
      guard !roomID.isEmpty, !participantID.isEmpty else { return }
      self.stopLocked()
      self.roomID = roomID
      self.participantID = String(participantID.prefix(60))
      let peer = MCPeerID(displayName: self.participantID)
      let session = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
      session.delegate = self
      self.session = session
      let context = self.contextData()
      let advertiser = MCNearbyServiceAdvertiser(peer: peer, discoveryInfo: ["room": roomID], serviceType: Self.serviceType)
      advertiser.delegate = self
      advertiser.startAdvertisingPeer()
      self.advertiser = advertiser
      let browser = MCNearbyServiceBrowser(peer: peer, serviceType: Self.serviceType)
      browser.delegate = self
      browser.startBrowsingForPeers()
      self.browser = browser
      self.onPeer?(["state": "started", "contextBytes": String(context.count)])
    }
  }

  func stop() { queue.async { self.stopLocked() } }

  func send(json: String) {
    queue.async {
      guard let session = self.session, !session.connectedPeers.isEmpty,
            let data = self.envelopeData(from: json), data.count <= Self.maxEnvelopeBytes else { return }
      self.remember(self.fingerprint(data))
      try? session.send(data, toPeers: session.connectedPeers.filter { self.trustedPeers.contains($0.displayName) }, with: .reliable)
    }
  }

  func verify(endpointID: String, accepted: Bool) {
    queue.async {
      guard self.pendingVerification.remove(endpointID) != nil else { return }
      if accepted { self.trustedPeers.insert(endpointID) }
      self.onPeer?(["endpointId": endpointID, "state": accepted ? "connected" : "rejected"])
    }
  }

  private func contextData() -> Data {
    (try? JSONSerialization.data(withJSONObject: ["room": roomID, "participant": participantID])) ?? Data()
  }

  private func stopLocked() {
    advertiser?.stopAdvertisingPeer()
    browser?.stopBrowsingForPeers()
    session?.disconnect()
    advertiser = nil; browser = nil; session = nil
    pendingVerification.removeAll(); trustedPeers.removeAll()
  }

  @discardableResult private func remember(_ key: String) -> Bool {
    guard !seen.contains(key) else { return false }
    seen.insert(key); seenOrder.append(key)
    if seenOrder.count > Self.dedupLimit { seen.remove(seenOrder.removeFirst()) }
    return true
  }

  private func envelopeData(from json: String) -> Data? {
    guard let data = json.data(using: .utf8), var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    object["roomId"] = roomID
    object["messageId"] = string(object["messageId"]) ?? UUID().uuidString
    object["createdAt"] = number(object["createdAt"]) ?? Date().timeIntervalSince1970 * 1000
    let expiry = Date().timeIntervalSince1970 * 1000 + Self.maxTTLSeconds * 1000
    object["expiresAt"] = min(number(object["expiresAt"]) ?? expiry, expiry)
    object["hops"] = min(max(Int(number(object["hops"]) ?? 0), 0), Self.maxHops)
    return try? JSONSerialization.data(withJSONObject: object)
  }

  private func validEnvelope(_ data: Data) -> [String: Any]? {
    guard data.count > 0, data.count <= Self.maxEnvelopeBytes,
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          string(object["roomId"]) == roomID,
          let expiry = number(object["expiresAt"]), expiry > Date().timeIntervalSince1970 * 1000 else { return nil }
    return object
  }

  private func number(_ value: Any?) -> TimeInterval? { (value as? NSNumber)?.doubleValue ?? (value as? Double) ?? (value as? String).flatMap(TimeInterval.init) }
  private func string(_ value: Any?) -> String? { guard let value = value as? String, !value.isEmpty else { return nil }; return value }
  private func fingerprint(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
}

extension MapPartyNearbyTransport: MCNearbyServiceAdvertiserDelegate {
  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
    guard self.isValidContext(context) else { invitationHandler(false, nil); return }
    pendingVerification.insert(peerID.displayName)
    onVerification?(["endpointId": peerID.displayName, "authenticationToken": peerID.displayName])
    invitationHandler(true, session)
  }
  func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) { onPeer?(["state": "error", "message": error.localizedDescription]) }
}

extension MapPartyNearbyTransport: MCNearbyServiceBrowserDelegate {
  func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String : String]?) {
    guard info?["room"] == roomID, let session else { return }
    browser.invitePeer(peerID, to: session, withContext: contextData(), timeout: 10)
  }
  func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) { trustedPeers.remove(peerID.displayName); onPeer?(["endpointId": peerID.displayName, "state": "lost"]) }
  func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) { onPeer?(["state": "error", "message": error.localizedDescription]) }
}

extension MapPartyNearbyTransport: MCSessionDelegate {
  func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
    queue.async {
      let stateName = state == .connected ? "connected" : state == .notConnected ? "disconnected" : "connecting"
      if state == .connected { self.trustedPeers.insert(peerID.displayName) }
      if state == .notConnected { self.trustedPeers.remove(peerID.displayName) }
      self.onPeer?(["endpointId": peerID.displayName, "state": stateName])
    }
  }
  func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
    queue.async {
      guard self.trustedPeers.contains(peerID.displayName), var object = self.validEnvelope(data) else { return }
      guard self.remember(self.fingerprint(data)) else { return }
      object["endpointId"] = peerID.displayName
      self.onMessage?(object)
      let hops = Int(self.number(object["hops"]) ?? 0)
      if hops < Self.maxHops {
        object["hops"] = hops + 1
        if let relay = try? JSONSerialization.data(withJSONObject: object) { try? session.send(relay, toPeers: session.connectedPeers.filter { $0.displayName != peerID.displayName && self.trustedPeers.contains($0.displayName) }, with: .reliable) }
      }
    }
  }
  func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
  func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
  func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}

private extension MapPartyNearbyTransport {
  func isValidContext(_ context: Data?) -> Bool {
    guard let context, let object = try? JSONSerialization.jsonObject(with: context) as? [String: String] else { return false }
    return object["room"] == roomID
  }
}
