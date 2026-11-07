import AppKit
import Combine
import Foundation
import LocalStudioKit

@MainActor
final class ShellSmoke {
    private struct Step {
        let name: String
        let act: @MainActor (ShellSmoke) -> Void
        let done: @MainActor (ShellSmoke) -> Bool
    }

    private let store: StudioStore
    private var steps: [Step] = []
    private var index = 0
    private var acted = false
    private var subscription: AnyCancellable?
    private var poll: Timer?
    private var project = ""
    private var thread = ""
    private let title = "Shell smoke renamed"

    init(store: StudioStore) {
        self.store = store
        steps = makeSteps()
    }

    func start() {
        subscription = store.didTick.sink { [weak self] in self?.advance() }
        poll = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.advance() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
            guard let self, index < steps.count else { return }
            let menu = menuShortcut("Show Terminal") ?? "missing"
            Self.dump(NSApp.mainMenu).forEach { print($0) }
            finish(passed: false, "timed out at step \(steps[index].name) (Show Terminal shortcut: \(menu), bindings: \(store.pages.keybindings.count))")
        }
    }

    private var row: ThreadRow? {
        store.inbox.thread(thread)
    }

    private func makeSteps() -> [Step] {
        [
            Step(name: "connect", act: { _ in }, done: { $0.store.connection == .ready }),
            Step(name: "add project", act: { smoke in
                let home = ProcessInfo.processInfo.environment["HOME"] ?? NSTemporaryDirectory()
                let path = URL(fileURLWithPath: home).appendingPathComponent("shell-smoke-project").path
                try? FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
                smoke.project = URL(fileURLWithPath: path).resolvingSymlinksInPath().path
                smoke.store.inbox.addProject(path: path)
            }, done: { smoke in
                guard let match = smoke.store.inbox.projects.first(where: { $0.path == smoke.project || $0.id == smoke.project || $0.path.hasSuffix("/shell-smoke-project") }) else { return false }
                smoke.project = match.id
                return true
            }),
            Step(name: "start thread", act: { smoke in
                smoke.store.newThread(in: smoke.project)
                smoke.store.conversation.send("run the smoke command", project: smoke.project, steer: false)
            }, done: { smoke in
                guard let id = smoke.store.focusedThread, smoke.store.inbox.thread(id) != nil else { return false }
                smoke.thread = id
                return smoke.store.inbox.thread(id)?.project == smoke.project
            }),
            Step(name: "turn settles", act: { _ in }, done: { smoke in
                guard let row = smoke.row else { return false }
                return row.status != .working && smoke.store.conversation.info?.busy == false
            }),
            Step(name: "pin", act: { $0.store.togglePin([$0.thread]) }, done: { $0.row?.shelf == .pinned && $0.row?.pinned == true }),
            Step(name: "unpin", act: { $0.store.inbox.setPinned([$0.thread], false) }, done: { $0.row?.pinned == false && $0.row?.shelf != .pinned }),
            Step(name: "settle", act: { $0.store.toggleSettle([$0.thread]) }, done: { $0.row?.shelf == .settled }),
            Step(name: "undo settle", act: { $0.store.inbox.performUndo() }, done: { $0.row?.shelf == .active }),
            Step(name: "snooze", act: { smoke in
                smoke.store.inbox.snooze([smoke.thread], until: Int64((Date.now.timeIntervalSince1970 + 3_600) * 1_000))
            }, done: { $0.row?.shelf == .snoozed && $0.row?.snoozedUntil != nil }),
            Step(name: "wake", act: { $0.store.inbox.snooze([$0.thread], until: nil) }, done: { $0.row?.shelf == .active }),
            Step(name: "mark unread", act: { $0.store.inbox.markUnread([$0.thread], true) }, done: { $0.row?.unread == true }),
            Step(name: "rename", act: { $0.store.inbox.rename($0.thread, to: $0.title) }, done: { $0.row?.title == $0.title }),
            Step(name: "archive", act: { $0.store.inbox.setArchived([$0.thread], true) }, done: { $0.store.inbox.receivedThreads && $0.row == nil }),
            Step(name: "unarchive", act: { $0.store.inbox.setArchived([$0.thread], false) }, done: { $0.row != nil && $0.row?.archived == false }),
            Step(name: "delete", act: { smoke in
                smoke.store.requestDelete([smoke.thread])
                if let confirmation = smoke.store.shell.confirmation {
                    smoke.store.confirm(confirmation)
                }
            }, done: { $0.row == nil }),
            Step(name: "menu shortcut from core", act: { _ in }, done: { $0.menuShortcut("Show Terminal") == "⌘j" }),
            Step(name: "override shortcut", act: { smoke in
                smoke.store.core.run { $0.setKeybinding(command: "terminal.toggle", shortcut: "cmd+shift+y") }
            }, done: { $0.menuShortcut("Show Terminal") == "⇧⌘y" }),
            Step(name: "reset shortcut", act: { smoke in
                smoke.store.core.run { $0.setKeybinding(command: "terminal.toggle", shortcut: "cmd+j") }
            }, done: { $0.menuShortcut("Show Terminal") == "⌘j" }),
        ]
    }

    private func menuShortcut(_ title: String) -> String? {
        guard let item = Self.find(title, in: NSApp.mainMenu) else { return nil }
        let shift = item.keyEquivalentModifierMask.contains(.shift) || item.keyEquivalent != item.keyEquivalent.lowercased()
        let command = item.keyEquivalentModifierMask.contains(.command)
        return (shift ? "⇧" : "") + (command ? "⌘" : "") + item.keyEquivalent.lowercased()
    }

    private static func find(_ title: String, in menu: NSMenu?) -> NSMenuItem? {
        guard let menu else { return nil }
        menu.delegate?.menuNeedsUpdate?(menu)
        menu.update()
        for item in menu.items {
            if item.title == title { return item }
            if let found = find(title, in: item.submenu) { return found }
        }
        return nil
    }

    private static func dump(_ menu: NSMenu?, depth: Int = 0) -> [String] {
        guard let menu, depth < 2 else { return [] }
        return menu.items.flatMap { item in
            ["\(String(repeating: "  ", count: depth))\(item.title) [\(item.keyEquivalentModifierMask.rawValue) \(item.keyEquivalent)]"] + dump(item.submenu, depth: depth + 1)
        }
    }

    private func advance() {
        while index < steps.count {
            let step = steps[index]
            if !acted {
                acted = true
                print("shell smoke: \(step.name)")
                step.act(self)
            }
            guard step.done(self) else { return }
            index += 1
            acted = false
        }
        finish(passed: true, "\(steps.count) inbox round-trips")
    }

    private func finish(passed: Bool, _ detail: String) {
        guard subscription != nil else { return }
        subscription = nil
        poll?.invalidate()
        print(passed ? "PASS macOS shell smoke: \(detail)" : "FAIL macOS shell smoke: \(detail)")
        if passed {
            NSApp.terminate(nil)
        } else {
            store.stop()
            exit(1)
        }
    }
}
