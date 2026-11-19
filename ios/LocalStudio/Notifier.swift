import LocalStudioRemote
import UserNotifications

@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()
    private let askPermission: Bool
    private var asked = false

    init(askPermission: Bool) {
        self.askPermission = askPermission
        super.init()
        center.delegate = self
    }

    func post(_ note: StudioNotification, machine: String) {
        let content = UNMutableNotificationContent()
        content.title = note.title
        content.subtitle = machine
        content.body = note.body
        content.threadIdentifier = note.thread
        content.userInfo = ["thread": note.thread, "kind": note.kind.rawValue]
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        let center = center
        let ask = askPermission && !asked
        asked = true
        Task {
            if ask {
                _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            }
            try? await center.add(request)
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}
