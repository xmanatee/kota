#if os(iOS)
import Foundation
import KotaShared
import UIKit
import UserNotifications

/// iOS implementation of the cross-platform `NotificationManaging`
/// protocol. Lazily binds `UNUserNotificationCenter.current()` only
/// when running inside a real `.app` bundle so unit tests outside a
/// bundle do not crash.
final class iOSNotificationManager: NSObject, UNUserNotificationCenterDelegate, NotificationManaging {
    static let shared = iOSNotificationManager()

    private lazy var center: UNUserNotificationCenter? = {
        guard Bundle.main.bundleIdentifier != nil else { return nil }
        let c = UNUserNotificationCenter.current()
        c.delegate = self
        return c
    }()

    func requestAuthorization() {
        center?.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
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
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}
#endif
