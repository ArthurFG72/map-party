import ExpoModulesCore
import Foundation

public final class MapPartySiriModule: Module {
  private let commandKey = "MapParty.Siri.pendingCommand"

  public func definition() -> ModuleDefinition {
    Name("MapPartySiri")

    AsyncFunction("consumeCommand") { () -> String? in
      let defaults = UserDefaults.standard
      let command = defaults.string(forKey: commandKey)
      if command != nil { defaults.removeObject(forKey: commandKey) }
      return command
    }
  }
}
