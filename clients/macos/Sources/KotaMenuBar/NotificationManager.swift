import AppKit
import UserNotifications

/// Injection seam for the menu-bar notification surface. Production code
/// uses `NotificationManager.shared`, which lazily binds to
/// `UNUserNotificationCenter.current()` only when running inside a real
/// `.app` bundle. Tests pass a recording stub so `AppState` can be
/// constructed without crashing in `swift test`, which runs outside any
/// bundle. Calls are fire-and-forget — the protocol mirrors that.
protocol NotificationManaging {
    func requestAuthorization()
    func notify(title: String, body: String, identifier: String)
}

final class NotificationManager: NSObject, UNUserNotificationCenterDelegate, NotificationManaging {
    static let shared = NotificationManager()

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
