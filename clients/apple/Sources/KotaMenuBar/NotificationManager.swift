#if os(macOS)
import AppKit
import KotaShared
import UserNotifications

/// macOS-specific notification surface for the menu-bar app. Lazily
/// binds to `UNUserNotificationCenter.current()` only when running
/// inside a real `.app` bundle so `swift test` (which runs outside
/// any bundle) does not crash. The matching protocol declaration
/// (`NotificationManaging`) lives in
/// `KotaShared/NotificationSurface.swift`.
final class MacOSNotificationManager: NSObject, UNUserNotificationCenterDelegate, NotificationManaging {
    static let shared = MacOSNotificationManager()

    private lazy var center: UNUserNotificationCenter? = {
        guard Bundle.main.bundleIdentifier != nil else { return nil }
        let c = UNUserNotificationCenter.current()
        c.delegate = self
        return c
    }()

    func requestAuthorization() {
        center?.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func notify(title: String, body: String, identifier: String) {
        center?.getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
            self.center?.add(request, withCompletionHandler: nil)
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        DispatchQueue.main.async {
            NSApp.activate(ignoringOtherApps: true)
        }
        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([])
    }
}
#endif
