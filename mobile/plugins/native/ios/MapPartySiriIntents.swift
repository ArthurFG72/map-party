import AppIntents
import Foundation

private enum MapPartySiriCommand {
  static let key = "MapParty.Siri.pendingCommand"

  static func store(_ value: String) {
    UserDefaults.standard.set(value, forKey: key)
  }
}

@available(iOS 16.0, *)
struct MapPartyStartNavigationIntent: AppIntent {
  static var title: LocalizedStringResource = "Iniciar navegação"
  static var openAppWhenRun: Bool = true
  func perform() async throws -> some IntentResult {
    MapPartySiriCommand.store("navigation.start")
    return .result()
  }
}

@available(iOS 16.0, *)
struct MapPartyPauseNavigationIntent: AppIntent {
  static var title: LocalizedStringResource = "Pausar navegação"
  static var openAppWhenRun: Bool = true
  func perform() async throws -> some IntentResult {
    MapPartySiriCommand.store("navigation.pause")
    return .result()
  }
}

@available(iOS 16.0, *)
struct MapPartyResumeNavigationIntent: AppIntent {
  static var title: LocalizedStringResource = "Retomar navegação"
  static var openAppWhenRun: Bool = true
  func perform() async throws -> some IntentResult {
    MapPartySiriCommand.store("navigation.resume")
    return .result()
  }
}

@available(iOS 16.0, *)
struct MapPartyStopNavigationIntent: AppIntent {
  static var title: LocalizedStringResource = "Cancelar navegação"
  static var openAppWhenRun: Bool = true
  func perform() async throws -> some IntentResult {
    MapPartySiriCommand.store("navigation.cancel")
    return .result()
  }
}

@available(iOS 16.0, *)
struct MapPartyNavigationStatusIntent: AppIntent {
  static var title: LocalizedStringResource = "Consultar navegação"
  static var openAppWhenRun: Bool = true
  func perform() async throws -> some IntentResult {
    MapPartySiriCommand.store("navigation.get_status")
    return .result()
  }
}

@available(iOS 16.0, *)
struct MapPartyShortcuts: AppShortcutsProvider {
  @AppShortcutsBuilder
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: MapPartyStartNavigationIntent(), phrases: ["Iniciar navegacao no \(.applicationName)"], shortTitle: "Iniciar navegacao", systemImageName: "location.fill")
    AppShortcut(intent: MapPartyPauseNavigationIntent(), phrases: ["Pausar navegacao no \(.applicationName)"], shortTitle: "Pausar navegacao", systemImageName: "pause.fill")
    AppShortcut(intent: MapPartyResumeNavigationIntent(), phrases: ["Retomar navegacao no \(.applicationName)"], shortTitle: "Retomar navegacao", systemImageName: "play.fill")
    AppShortcut(intent: MapPartyStopNavigationIntent(), phrases: ["Cancelar navegacao no \(.applicationName)"], shortTitle: "Cancelar navegacao", systemImageName: "stop.fill")
    AppShortcut(intent: MapPartyNavigationStatusIntent(), phrases: ["Consultar navegacao no \(.applicationName)"], shortTitle: "Consultar navegacao", systemImageName: "info.circle")
  }
}
