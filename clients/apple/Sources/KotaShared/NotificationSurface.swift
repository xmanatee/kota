import Foundation

/// Injection seam for the cross-platform notification surface. The
/// macOS shell binds an AppKit/UNUserNotificationCenter-backed
/// implementation; the iOS shell binds a UIKit-aware one. `AppState`
/// always talks to this protocol so the shared state container can be
/// constructed without a bundle / `UNUserNotificationCenter.current()`
/// crash in `swift test`.
public protocol NotificationManaging {
    func requestAuthorization()
    func notify(title: String, body: String, identifier: String)
}

/// No-op stub used by tests and by code paths that do not have a
/// platform-specific notifier wired yet. Recording stubs in tests
/// still land in `AppStateTests`; this is the silent default.
public struct InertNotificationManager: NotificationManaging {
    public init() {}
    public func requestAuthorization() {}
    public func notify(title: String, body: String, identifier: String) {}
}
