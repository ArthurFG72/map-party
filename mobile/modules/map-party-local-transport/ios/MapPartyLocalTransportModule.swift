import ExpoModulesCore
import Foundation

public final class MapPartyLocalTransportModule: Module {
  private let transport = MapPartyNearbyTransport()

  public func definition() -> ModuleDefinition {
    Name("MapPartyLocalTransport")
    Events("onMessage", "onVerification", "onPeer")

    OnCreate {
      transport.onMessage = { [weak self] body in self?.sendEvent("onMessage", body) }
      transport.onVerification = { [weak self] body in self?.sendEvent("onVerification", body) }
      transport.onPeer = { [weak self] body in self?.sendEvent("onPeer", body) }
    }

    AsyncFunction("start") { (roomID: String, participantID: String) in
      transport.start(roomID: roomID, participantID: participantID)
    }
    AsyncFunction("stop") { transport.stop() }
    AsyncFunction("sendJson") { (json: String) in transport.send(json: json) }
    AsyncFunction("verify") { (endpointID: String, accepted: Bool) in
      transport.verify(endpointID: endpointID, accepted: accepted)
    }
  }
}
