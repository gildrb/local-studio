import AppKit
import SwiftUI

struct WindowActivity: Equatable {
    enum Presence: Equatable {
        case key
        case inactive
        case hidden
    }

    var presence: Presence = .key
    var reduceTransparency = false
    var lowPower = false

    @MainActor static var pinned: WindowActivity?
    @MainActor static var lowPowerOverride: Bool?
    @MainActor static var reduceTransparencyOverride: Bool?
    @MainActor fileprivate(set) static var main = WindowActivity()

    @MainActor static var reducesTransparency: Bool {
        reduceTransparencyOverride ?? NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
    }

    var visible: Bool { presence != .hidden }
    var live: Bool { presence == .key }
    var animates: Bool { live && !lowPower }
    var flatGlass: Bool { !live || reduceTransparency }

    var updateInterval: TimeInterval {
        switch presence {
        case .key: 0
        case .inactive: 0.25
        case .hidden: 2
        }
    }

    @MainActor
    static func of(_ window: NSWindow?) -> WindowActivity {
        if let pinned { return pinned }
        var activity = WindowActivity(
            reduceTransparency: reducesTransparency,
            lowPower: lowPowerOverride ?? ProcessInfo.processInfo.isLowPowerModeEnabled
        )
        guard let window, window.isVisible, !window.isMiniaturized, !NSApp.isHidden, window.occlusionState.contains(.visible) else {
            activity.presence = .hidden
            return activity
        }
        activity.presence = NSApp.isActive && (window.isMainWindow || window.isKeyWindow) ? .key : .inactive
        return activity
    }
}

extension EnvironmentValues {
    @Entry var windowActivity = WindowActivity()
}

struct WindowActivityHooks {
    var changed: (WindowActivity) -> Void = { _ in }
    var revealing: () -> Void = {}
}

private struct WindowActivityRoot: ViewModifier {
    let main: Bool
    let hooks: WindowActivityHooks
    @State private var activity = WindowActivity.pinned ?? WindowActivity()

    func body(content: Content) -> some View {
        content
            .environment(\.windowActivity, activity)
            .background(WindowActivityProbe(revealing: hooks.revealing) { next in
                guard next != activity else { return }
                if !activity.visible, next.visible { hooks.revealing() }
                if main { WindowActivity.main = next }
                hooks.changed(next)
                activity = next
            })
    }
}

extension View {
    func windowActivityRoot(main: Bool = false, hooks: WindowActivityHooks = WindowActivityHooks()) -> some View {
        modifier(WindowActivityRoot(main: main, hooks: hooks))
    }
}

private struct WindowActivityProbe: NSViewRepresentable {
    let revealing: () -> Void
    let report: (WindowActivity) -> Void

    func makeNSView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.revealing = revealing
        view.report = report
        return view
    }

    func updateNSView(_ view: ProbeView, context: Context) {
        view.revealing = revealing
        view.report = report
    }

    @MainActor
    final class ProbeView: NSView {
        var revealing: (() -> Void)?
        var report: ((WindowActivity) -> Void)?
        private var tokens: [(NotificationCenter, NSObjectProtocol)] = []
        private weak var observed: NSWindow?

        private static let windowNames: [Notification.Name] = [
            NSWindow.didBecomeMainNotification, NSWindow.didResignMainNotification,
            NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
            NSWindow.didChangeOcclusionStateNotification,
            NSWindow.didMiniaturizeNotification, NSWindow.didDeminiaturizeNotification,
        ]
        private static let appNames: [Notification.Name] = [
            NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
            NSApplication.didHideNotification, NSApplication.didUnhideNotification,
        ]
        private static let revealNames: [Notification.Name] = [
            NSApplication.willUnhideNotification, NSApplication.willBecomeActiveNotification,
        ]

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard window !== observed else { return }
            stopObserving()
            observed = window
            if let window { startObserving(window) }
            Task { @MainActor [weak self] in self?.publish() }
        }

        private func startObserving(_ window: NSWindow) {
            let center = NotificationCenter.default
            Self.windowNames.forEach { listen(center, $0, window) }
            Self.appNames.forEach { listen(center, $0, NSApp) }
            Self.revealNames.forEach { listen(center, $0, NSApp, reveal: true) }
            listen(center, .NSProcessInfoPowerStateDidChange, nil)
            listen(NSWorkspace.shared.notificationCenter, NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, nil)
        }

        private func listen(_ center: NotificationCenter, _ name: Notification.Name, _ object: Any?, reveal: Bool = false) {
            let token = center.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    if reveal { self?.revealing?() }
                    self?.publish()
                }
            }
            tokens.append((center, token))
        }

        private func stopObserving() {
            for (center, token) in tokens {
                center.removeObserver(token)
            }
            tokens.removeAll()
        }

        private func publish() {
            report?(WindowActivity.of(window))
        }
    }
}
