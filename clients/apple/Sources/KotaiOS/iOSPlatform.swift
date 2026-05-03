#if os(iOS)
import Foundation
import KotaShared
import UIKit

/// iOS implementation of the platform protocol the shared `AppState`
/// consumes. UIKit-specific calls (`UIApplication.shared.open`) live
/// here so the shared module never imports `UIKit`. iOS apps cannot
/// quit themselves and have no native folder picker, so those
/// affordances no-op and report `false`.
struct iOSPlatform: PlatformAffordances {
    @MainActor
    @discardableResult
    func openURL(_ url: URL) -> Bool {
        guard UIApplication.shared.canOpenURL(url) else { return false }
        UIApplication.shared.open(url)
        return true
    }

    @MainActor
    func pickProjectDirectory() async -> URL? {
        // iOS apps live in a sandbox and cannot resolve arbitrary
        // host paths through a native folder picker. The shared
        // SettingsView surfaces a manual path field whenever this
        // returns `nil`, which is the only iOS path.
        nil
    }

    @MainActor
    func openAppSettings() {
        // Inside the iOS app the Settings tab is already mounted, so
        // the menu-bar-style "Settings…" affordance is unused. If we
        // ever route through the system-level Settings.app deep-link
        // we'd open it here.
    }

    var supportsQuit: Bool { false }

    var supportsNativeProjectPicker: Bool { false }

    @MainActor
    func quitApp() {
        // iOS apps cannot terminate themselves per Apple's guidelines.
    }
}
#endif
