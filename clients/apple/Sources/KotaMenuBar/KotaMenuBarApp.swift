import KotaShared
import SwiftUI

#if os(macOS)
/// macOS entry point. Mounts the shared `MenuBarView` inside a
/// `MenuBarExtra` (macOS-only Scene type) and wires the shared
/// `Settings` form into the system Settings scene. Platform-specific
/// concerns (NSOpenPanel, NSWorkspace, NSApp.sendAction, terminate)
/// live in `MacOSPlatform`; notifications live in
/// `MacOSNotificationManager`.
@main
struct KotaMenuBarApp: App {
    @StateObject private var appState = AppState(
        notifications: MacOSNotificationManager.shared,
        platform: MacOSPlatform()
    )

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environmentObject(appState)
        } label: {
            MenuBarLabel(appState: appState)
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView()
                .environmentObject(appState)
                .frame(width: 420)
                .padding()
        }
    }
}
#else
/// iOS link-time stub. The `KotaMenuBar` target is macOS-only at
/// runtime, but the package-level `KotaApple-Package` test scheme
/// still builds it on every destination. This stub provides the
/// `_main` symbol so the target compiles cleanly on iOS.
@main
struct KotaMenuBarStub {
    static func main() {
        fputs(
            "KotaMenuBar executable only runs on macOS — build with `swift build` against the macOS host.\n",
            stderr
        )
        exit(1)
    }
}
#endif
