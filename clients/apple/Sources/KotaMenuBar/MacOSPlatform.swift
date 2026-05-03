#if os(macOS)
import AppKit
import Foundation
import KotaShared

/// macOS implementation of the platform protocol the shared `AppState`
/// consumes. AppKit-specific calls (`NSWorkspace`, `NSOpenPanel`,
/// `NSApp.sendAction`, `NSApplication.shared.terminate`) live here so
/// the shared module never imports `AppKit`.
struct MacOSPlatform: PlatformAffordances {
    @MainActor
    @discardableResult
    func openURL(_ url: URL) -> Bool {
        NSWorkspace.shared.open(url)
    }

    @MainActor
    func pickProjectDirectory() async -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Select your KOTA project directory (the folder containing .kota/)"
        panel.prompt = "Select"
        return panel.runModal() == .OK ? panel.url : nil
    }

    @MainActor
    func openAppSettings() {
        if #available(macOS 14, *) {
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        } else {
            NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        }
    }

    var supportsQuit: Bool { true }

    var supportsNativeProjectPicker: Bool { true }

    @MainActor
    func quitApp() {
        NSApplication.shared.terminate(nil)
    }
}
#endif
