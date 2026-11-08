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
    private var poll: Task<Void, Never>?
    private var project = ""
    private var thread = ""
    private let title = "Shell smoke renamed"
    private var second = ""
    private var expectedPinned: [String] = []
    private var revision = 0
    private var routed: [String] = []
    private var vimResult: [Bool] = []
    private var vimCursor: String?
    private var vimRegion: FocusRegion?

    init(store: StudioStore) {
        self.store = store
        steps = makeSteps()
    }

    func start() {
        subscription = store.didTick.sink { [weak self] in self?.advance() }
        poll = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(250))
                self?.advance()
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 180) { [weak self] in
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
            Step(name: "onboarding offered", act: { _ in }, done: { $0.store.needsOnboarding && !$0.store.pages.keybindings.isEmpty }),
            Step(name: "skip onboarding", act: { $0.store.completeOnboarding() }, done: { smoke in
                smoke.store.pages.settings?.onboardingCompleted == true && !smoke.store.needsOnboarding
            }),
            Step(name: "router dispatch", act: { smoke in
                smoke.store.commands.register("composer.stash", owner: smoke) { smoke.routed.append("composer.stash") }
                smoke.store.commands.register("terminal.split", owner: smoke, enabled: { true }, perform: { smoke.routed.append("terminal.split") })
                smoke.store.dispatch("composer.stash")
                smoke.store.dispatch("diff.toggle")
                smoke.store.commands.unregister(owner: smoke)
                smoke.store.dispatch("composer.stash")
            }, done: { $0.routed == ["composer.stash", "terminal.split"] }),
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
            Step(name: "rename project", act: { $0.store.inbox.renameProject($0.project, to: "Smoke Project") }, done: { smoke in
                smoke.store.inbox.project(smoke.project)?.name == "Smoke Project"
            }),
            Step(name: "project icon", act: { $0.store.inbox.setProjectIcon($0.project, "hammer") }, done: { smoke in
                smoke.store.inbox.project(smoke.project)?.icon == "hammer"
            }),
            Step(name: "reset project icon", act: { $0.store.inbox.setProjectIcon($0.project, nil) }, done: { smoke in
                smoke.store.inbox.project(smoke.project).map { $0.icon == nil } ?? false
            }),
            Step(name: "load project settings", act: { $0.store.inbox.loadProjectSettings($0.project) }, done: { smoke in
                smoke.store.inbox.projectSettings[smoke.project] != nil && smoke.store.inbox.projectScripts[smoke.project] != nil
            }),
            Step(name: "project override", act: { smoke in
                let overrides = ProjectSettings(defaultProvider: nil, defaultModel: nil, defaultThinkingLevel: nil, defaultAccess: .fullAccess, newThreadWorkspace: .local, newWorktreesStartFromOrigin: nil)
                smoke.store.inbox.updateProjectSettings(smoke.project, overrides)
            }, done: { smoke in
                let entry = smoke.store.inbox.projectSettings[smoke.project]
                return entry?.settings.defaultAccess == .fullAccess && entry?.effective.defaultAccess == .fullAccess
            }),
            Step(name: "project script", act: { smoke in
                let script = ProjectScript(id: "smoke", name: "Smoke", command: "echo smoke", icon: "play", keybinding: "cmd+shift+y", runOnWorktreeSetup: false, waitForSetup: false)
                smoke.store.inbox.saveProjectScripts(smoke.project, [script])
            }, done: { $0.store.inbox.projectScripts[$0.project]?.map(\.name) == ["Smoke"] }),
            Step(name: "clear project script", act: { $0.store.inbox.saveProjectScripts($0.project, []) }, done: { smoke in
                smoke.store.inbox.projectScripts[smoke.project]?.isEmpty == true
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
            Step(name: "message search", act: { smoke in
                smoke.store.inbox.query = "smoke-ok"
                smoke.store.inbox.searchMessages()
            }, done: { smoke in
                smoke.store.inbox.searchEntries.contains { $0.id == smoke.thread && !($0.snippet ?? "").isEmpty }
            }),
            Step(name: "clear search", act: { $0.store.inbox.query = "" }, done: { $0.store.inbox.searchEntries.isEmpty }),
            Step(name: "auto-settle off", act: { $0.store.inbox.setAutoSettle($0.thread, false) }, done: { $0.row?.autoSettle == false }),
            Step(name: "auto-settle on", act: { $0.store.inbox.setAutoSettle($0.thread, true) }, done: { $0.row?.autoSettle == true }),
            Step(name: "second thread", act: { smoke in
                smoke.store.newThread(in: smoke.project)
                smoke.store.conversation.send("second smoke thread", project: smoke.project, steer: false)
            }, done: { smoke in
                guard let id = smoke.store.focusedThread, id != smoke.thread, smoke.store.inbox.thread(id) != nil else { return false }
                smoke.second = id
                return true
            }),
            Step(name: "second turn settles", act: { _ in }, done: { $0.store.inbox.thread($0.second)?.status != .working }),
        ] + keyboardSteps() + [
            Step(name: "pin both", act: { $0.store.inbox.setPinned([$0.thread, $0.second], true) }, done: { smoke in
                smoke.store.inbox.sections.pinned.count == 2
            }),
            Step(name: "reorder pinned", act: { smoke in
                let pinned = smoke.store.inbox.sections.pinned.map(\.id)
                guard let first = pinned.first, let last = pinned.last else { return }
                smoke.expectedPinned = [last, first]
                smoke.revision = smoke.store.inbox.threadsRevision
                smoke.store.inbox.movePinned(last, before: first)
            }, done: { smoke in
                smoke.store.inbox.threadsRevision > smoke.revision && smoke.store.inbox.sections.pinned.map(\.id) == smoke.expectedPinned
            }),
            Step(name: "unpin both", act: { $0.store.inbox.setPinned([$0.thread, $0.second], false) }, done: { $0.store.inbox.sections.pinned.isEmpty }),
            Step(name: "archive", act: { $0.store.inbox.setArchived([$0.thread], true) }, done: { $0.store.inbox.receivedThreads && $0.row == nil }),
            Step(name: "unarchive", act: { $0.store.inbox.setArchived([$0.thread], false) }, done: { $0.row != nil && $0.row?.archived == false }),
            Step(name: "delete", act: { smoke in
                smoke.store.requestDelete([smoke.thread, smoke.second])
                if let confirmation = smoke.store.shell.confirmation {
                    smoke.store.confirm(confirmation)
                }
            }, done: { $0.row == nil && $0.store.inbox.thread($0.second) == nil }),
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
        poll?.cancel()
        print(passed ? "PASS macOS shell smoke: \(detail)" : "FAIL macOS shell smoke: \(detail)")
        if passed {
            NSApp.terminate(nil)
        } else {
            store.stop()
            exit(1)
        }
    }
}

extension ShellSmoke {
    private func keyboardSteps() -> [Step] {
        [
            Step(name: "main window at launch", act: { _ in }, done: { $0.store.mainWindow?.isVisible == true }),
            Step(name: "⌘T opens a draft in the current project", act: { $0.store.dispatch("chat.newTab") }, done: { smoke in
                smoke.store.focusedThread == nil && smoke.store.shell.route == .thread && smoke.store.inbox.currentProject == smoke.project
                    && smoke.store.currentRegion == .composer && smoke.menuItem("New Thread Here")?.keyEquivalent == "t"
            }),
            Step(name: "⌃Tab cycles recent threads", act: { smoke in
                smoke.store.open(smoke.thread)
                smoke.store.open(smoke.second)
                smoke.store.dispatch("thread.recentNext")
            }, done: { smoke in
                guard smoke.store.focusedThread == smoke.thread else { return false }
                let item = smoke.menuItem("Next Recent Thread")
                return item?.keyEquivalent == "\t" && item?.keyEquivalentModifierMask.contains(.control) == true
            }),
            Step(name: "⌃Tab release commits, next ⌃Tab returns", act: { smoke in
                smoke.store.endRecentCycle()
                smoke.store.dispatch("thread.recentNext")
                smoke.store.endRecentCycle()
            }, done: { $0.store.focusedThread == $0.second && $0.store.shell.recent.prefix(2) == [$0.second, $0.thread] }),
            Step(name: "Close Thread owns ⌘W once the right panel is closed", act: { smoke in
                if smoke.store.panels.rightPanelOpen { smoke.store.panels.toggleRightPanel() }
            }, done: { $0.menuItem("Close Thread")?.keyEquivalent == "w" }),
            Step(name: "⌘W closes the thread view", act: { $0.store.dispatch("thread.close") }, done: { smoke in
                smoke.store.focusedThread == nil && smoke.store.inbox.thread(smoke.second) != nil && smoke.store.shell.canGoBack
            }),
            Step(name: "⌘[ goes back to the closed thread", act: { $0.store.dispatch("navigation.back") }, done: { $0.store.focusedThread == $0.second && !$0.store.conversation.rows.isEmpty }),
            Step(name: "F6 cycles focus regions", act: { smoke in
                smoke.store.focus(.sidebar)
                smoke.store.dispatch("focus.cycle")
            }, done: { smoke in
                smoke.store.shell.region == .timeline && smoke.store.shell.timelineCursor == smoke.store.conversation.rows.last?.id
                    && smoke.menuItem("Cycle Regions")?.keyEquivalent == String(Character(UnicodeScalar(NSF6FunctionKey) ?? " "))
            }),
            Step(name: "timeline arrows and copy text", act: { smoke in
                _ = smoke.key(.up)
            }, done: { smoke in
                let rows = smoke.store.conversation.rows
                guard rows.count > 1, smoke.store.shell.timelineCursor == rows[rows.count - 2].id else { return false }
                return rows.contains { !$0.copyText.isEmpty }
            }),
            Step(name: "vim keys on", act: { $0.store.setVimMode(true) }, done: { $0.store.pages.settings?.vimMode == true }),
            Step(name: "vim j/k, G, gg in the sidebar", act: { smoke in
                smoke.store.focus(.sidebar)
                smoke.store.shell.sidebarCursor = smoke.store.inbox.visibleOrder.first
                smoke.vimResult = [smoke.key(.text("j")), smoke.key(.text("G")), smoke.key(.text("g")), smoke.key(.text("g")), smoke.key(.text("k"))]
                smoke.vimCursor = smoke.store.shell.sidebarCursor
                _ = smoke.key(.text("j"))
            }, done: { smoke in
                let order = smoke.store.inbox.visibleOrder
                return order.count >= 2 && smoke.vimResult.allSatisfy(\.self) && smoke.vimCursor == order.first && smoke.store.shell.sidebarCursor == order[1]
            }),
            Step(name: "vim l moves to the timeline, i focuses the composer", act: { smoke in
                _ = smoke.key(.text("l"))
                smoke.vimRegion = smoke.store.shell.region
                _ = smoke.key(.text("i"))
            }, done: { smoke in
                smoke.vimRegion == .timeline && smoke.store.currentRegion == .composer
                    && smoke.store.mainWindow?.firstResponder is ComposerNSTextView
            }),
            Step(name: "vim keys off", act: { $0.store.setVimMode(false) }, done: { $0.store.pages.settings?.vimMode == false }),
            Step(name: "type-to-filter from the sidebar", act: { smoke in
                smoke.store.focus(.sidebar)
                _ = smoke.key(.text("s"))
            }, done: { smoke in
                let filtered = smoke.store.inbox.query == "s"
                if filtered { smoke.store.inbox.query = "" }
                return filtered
            }),
        ]
    }

    private func key(_ key: NavInput.Key) -> Bool {
        store.routeKey(NavInput(key), responder: store.mainWindow?.firstResponder)
    }

    private func menuItem(_ title: String) -> NSMenuItem? {
        Self.find(title, in: NSApp.mainMenu)
    }
}

