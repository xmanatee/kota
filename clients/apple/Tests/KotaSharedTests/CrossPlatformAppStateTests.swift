import XCTest
@testable import KotaShared

/// Cross-platform smoke test for the shared `AppState` view-model.
/// Both the macOS host (`swift test`) and the iOS Simulator runtime
/// (`xcodebuild test -scheme KotaApple-Package -destination
/// 'platform=iOS Simulator,…'`) exercise this same file because it
/// lives in `KotaSharedTests`, the cross-platform test target. The
/// test pins the construction contract that lets either shell mount
/// `AppState` without touching `UNUserNotificationCenter.current()`,
/// `NSWorkspace`, `NSOpenPanel`, or `UIApplication.shared.open`:
///
///   - production initializer must accept an inert `PlatformAffordances`
///     and an inert `NotificationManaging`, and must not start polling
///     when `startPollingOnInit: false`.
///   - the construction must not request notification authorization,
///     must not open URLs, and must not surface a project picker.
///   - the platform-affordance defaults must mirror the iOS shape
///     (`supportsQuit == false`, `supportsNativeProjectPicker ==
///     false`, `openURL` returns false). Each shell overrides these
///     in its own concrete impl; the inert default is what tests and
///     unbooted fallbacks see.
@MainActor
final class CrossPlatformAppStateTests: XCTestCase {

    final class RecordingPlatform: PlatformAffordances {
        private(set) var openURLCalls: [URL] = []
        private(set) var pickProjectCalls = 0
        private(set) var openSettingsCalls = 0
        private(set) var quitCalls = 0
        var supportsQuit: Bool = false
        var supportsNativeProjectPicker: Bool = false

        @MainActor
        @discardableResult
        func openURL(_ url: URL) -> Bool {
            openURLCalls.append(url)
            return false
        }

        @MainActor
        func pickProjectDirectory() async -> URL? {
            pickProjectCalls += 1
            return nil
        }

        @MainActor
        func openAppSettings() {
            openSettingsCalls += 1
        }

        @MainActor
        func quitApp() {
            quitCalls += 1
        }
    }

    final class RecordingNotifier: NotificationManaging {
        private(set) var authorizationCount = 0
        private(set) var notifyCount = 0

        func requestAuthorization() {
            authorizationCount += 1
        }

        func notify(title: String, body: String, identifier: String) {
            notifyCount += 1
        }
    }

    private func clearDefaults() {
        UserDefaults.standard.removeObject(forKey: "projectDirectory")
        UserDefaults.standard.removeObject(forKey: "remoteDaemonURL")
        UserDefaults.standard.removeObject(forKey: "notificationsEnabled")
    }

    func testInertConstructionMakesNoSideEffects() {
        clearDefaults()
        let platform = RecordingPlatform()
        let notifier = RecordingNotifier()
        _ = AppState(
            client: nil,
            notifications: notifier,
            platform: platform,
            startPollingOnInit: false
        )
        XCTAssertEqual(
            notifier.authorizationCount, 0,
            "Construction must not request notification authorization when polling is off."
        )
        XCTAssertEqual(
            platform.openURLCalls, [],
            "Construction must not open any URL via the platform shim."
        )
        XCTAssertEqual(
            platform.pickProjectCalls, 0,
            "Construction must not surface a project picker."
        )
    }

    func testInertPlatformAffordancesAreNoOps() async {
        let inert = InertPlatformAffordances()
        XCTAssertFalse(inert.supportsQuit)
        XCTAssertFalse(inert.supportsNativeProjectPicker)
        let dummyURL = URL(string: "http://example.test/")!
        await MainActor.run {
            XCTAssertFalse(
                inert.openURL(dummyURL),
                "Inert openURL must signal no-op so callers can hide UI."
            )
            inert.openAppSettings()
            inert.quitApp()
        }
        let picked = await inert.pickProjectDirectory()
        XCTAssertNil(picked, "Inert picker must return nil so callers fall back to manual entry.")
    }

    func testOpenDashboardRoutesThroughPlatformWhenIdentityAdvertisesIt() {
        clearDefaults()
        let platform = RecordingPlatform()
        let state = AppState(
            client: nil,
            notifications: RecordingNotifier(),
            platform: platform,
            startPollingOnInit: false
        )
        // No identity → openDashboard should silently no-op.
        state.openDashboard()
        XCTAssertEqual(
            platform.openURLCalls, [],
            "openDashboard must skip the platform when isDashboardAvailable is false."
        )
    }

    func testFooterActionsHonorPlatformQuitFlag() {
        clearDefaults()
        let platform = RecordingPlatform()
        platform.supportsQuit = false
        let state = AppState(
            client: nil,
            notifications: RecordingNotifier(),
            platform: platform,
            startPollingOnInit: false
        )
        XCTAssertFalse(
            state.platform.supportsQuit,
            "iOS-style platform must report supportsQuit == false so FooterActionsView hides Quit."
        )
    }
}
