import AppKit
import LocalStudioKit
@preconcurrency import UserNotifications

struct NotifyContext {
    let mode: NotificationMode
    let inApp: Bool
    let focusedThread: String?
}

@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    var context: () -> NotifyContext = { NotifyContext(mode: .off, inApp: false, focusedThread: nil) }
    var openThread: (String) -> Void = { _ in }
    var toast: (NoticeLevel, String) -> Void = { _, _ in }

    private var authorization: Task<Bool, Never>?
    private var installed = false

    func deliver(thread: String, kind: NotificationKind, title: String, body: String) {
        let context = context()
        let appActive = NSApp.isActive
        let threadFocused = appActive && context.focusedThread == thread
        guard !threadFocused else { return }
        let heading = Self.heading(kind, title: title)
        if appActive {
            if context.inApp {
                toast(kind == .failed ? .error : .info, body.isEmpty ? heading : "\(heading): \(body)")
            }
            if context.mode == .sound || context.mode == .notificationsAndSound {
                play(kind)
            }
            return
        }
        switch context.mode {
        case .off:
            return
        case .sound:
            play(kind)
        case .notifications:
            post(thread: thread, heading: heading, body: body)
        case .notificationsAndSound:
            post(thread: thread, heading: heading, body: body)
            play(kind)
        }
    }

    private func play(_ kind: NotificationKind) {
        let name = kind == .needsApproval ? "notification-input" : "notification-completion"
        guard let url = Bundle.main.url(forResource: name, withExtension: "mp3") else {
            NSSound(named: kind == .turnDone ? "Glass" : "Ping")?.play()
            return
        }
        sounds[name] = sounds[name] ?? NSSound(contentsOf: url, byReference: true)
        sounds[name]?.stop()
        sounds[name]?.play()
    }

    private var sounds: [String: NSSound] = [:]

    private func post(thread: String, heading: String, body: String) {
        guard Bundle.main.bundleIdentifier != nil else { return }
        let center = UNUserNotificationCenter.current()
        if !installed {
            center.delegate = self
            installed = true
        }
        let authorization = authorization ?? Task {
            (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        }
        self.authorization = authorization
        let content = UNMutableNotificationContent()
        content.title = heading
        content.body = body
        content.threadIdentifier = thread
        content.userInfo = ["thread": thread]
        let request = UNNotificationRequest(identifier: "\(thread)-\(UUID().uuidString)", content: content, trigger: nil)
        Task {
            guard await authorization.value else { return }
            try? await center.add(request)
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let thread = response.notification.request.content.userInfo["thread"] as? String else { return }
        await MainActor.run {
            NSApp.activate()
            openThread(thread)
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    private static func heading(_ kind: NotificationKind, title: String) -> String {
        let name = title.isEmpty ? "Thread" : title
        switch kind {
        case .turnDone: return "\(name) finished"
        case .needsApproval: return "\(name) needs approval"
        case .failed: return "\(name) failed"
        }
    }
}
