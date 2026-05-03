import KotaShared
import SwiftUI

#if os(iOS)
/// iOS entry point. Mounts the shared `IOSRootView` inside a single
/// `WindowGroup`. Platform-specific concerns (UIApplication,
/// UNUserNotificationCenter, sandboxed file access) live in
/// `iOSPlatform` and `iOSNotificationManager`.
@main
struct KotaiOSApp: App {
    @StateObject private var appState = AppState(
        notifications: iOSNotificationManager.shared,
        platform: iOSPlatform()
    )

    var body: some Scene {
        WindowGroup {
            IOSRootView()
                .environmentObject(appState)
        }
    }
}
#else
/// macOS link-time stub. The `KotaiOS` target is iOS-only at runtime,
/// but `swift build` invoked on a macOS host still tries to link the
/// executable. This stub provides the `_main` symbol so the target
/// compiles cleanly during the macOS test cycle. Building the real
/// app uses `xcodebuild` against the iOS Simulator SDK; running this
/// stub aborts with a clear message so it can never be confused for
/// the real binary.
@main
struct KotaiOSStub {
    static func main() {
        fputs(
            "KotaiOS executable only runs on iOS — build with `xcodebuild build -scheme KotaiOS -destination 'generic/platform=iOS Simulator'`.\n",
            stderr
        )
        exit(1)
    }
}
#endif
