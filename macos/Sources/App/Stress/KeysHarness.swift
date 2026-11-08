import AppKit
import Foundation
import LocalStudioKit

@MainActor
final class KeysHarness {
    private enum Plan {
        case run(String)
        case resolveOnly(String)
        case disabled(String)
    }

    private struct Outcome {
        let command: String
        let chord: String
        let when: String
        let result: String
        let passed: Bool
    }

    private let store: StudioStore
    private var outcomes: [Outcome] = []
    private var threads: [String] = []
    private var project: String?

    init(store: StudioStore) {
        self.store = store
    }

    func start() {
        Task { await run() }
    }

    private func run() async {
        do {
            try await until("the core connection", 60) { store.connection == .ready }
            let window = try await launchedMainWindow(store)
            try await skipOnboarding(store, window)
            var seed = StressSeed(store: store)
            try await seed.run()
            threads = store.inbox.visibleOrder
            project = store.inbox.thread(threads.first)?.project
            try await until("keybindings", 10) { !store.pages.keybindings.isEmpty }
            for binding in store.pages.keybindings {
                outcomes.append(try await check(binding, window))
            }
            report()
        } catch {
            print("FAIL macOS keys: \(error)")
            store.stop()
            exit(1)
        }
    }

    private func check(_ binding: Keybinding, _ window: NSWindow) async throws -> Outcome {
        let when = binding.when ?? "always"
        guard let shortcut = binding.shortcut, let chord = KeyChord.parse(shortcut) else {
            return Outcome(command: binding.command, chord: "—", when: when, result: "unbound", passed: true)
        }
        let display = chord.description
        try await reset(window)
        let plan = try await prepare(binding.command, window)
        let resolved = store.chordCommand(shortcut, responder: window.firstResponder)
        var outcome: Outcome
        switch plan {
        case .resolveOnly(let reason):
            let live = resolved == binding.command
            outcome = Outcome(
                command: binding.command, chord: display, when: when,
                result: live ? "live, not invoked (\(reason))" : "DEAD: resolves to \(resolved ?? "nothing") (\(reason))", passed: live
            )
        case .run(let context), .disabled(let context):
            let before = store.shell.probe.dispatches
            KeyDriver.press(chord, in: window)
            try await Task.sleep(for: .milliseconds(120))
            let probe = store.shell.probe
            let ran = probe.dispatched.suffix(min(probe.dispatches - before, probe.dispatched.count)).compactMap(\.self)
            if ran.contains(binding.command) {
                outcome = Outcome(command: binding.command, chord: display, when: when, result: "ran (\(context))", passed: true)
            } else if case .disabled = plan, resolved == nil || resolved != binding.command {
                outcome = Outcome(command: binding.command, chord: display, when: when, result: "disabled: \(context)", passed: true)
            } else {
                let detail = ran.isEmpty ? "no handler ran" : "ran \(ran.joined(separator: ", ")) instead"
                outcome = Outcome(
                    command: binding.command, chord: display, when: when,
                    result: "DEAD: \(detail), resolved \(resolved ?? "nothing") (\(context))", passed: false
                )
            }
        }
        try await cleanup(binding.command, window)
        return outcome
    }

    private func reset(_ window: NSWindow) async throws {
        store.shell.palette = nil
        store.conversation.modelPickerPresented = false
        if store.panels.rightPanelOpen {
            store.panels.closeAll()
            if store.panels.rightPanelOpen { store.panels.toggleRightPanel() }
        }
        if store.panels.terminalOpen { store.panels.toggleTerminal() }
        store.shell.route = .thread
        if let first = threads.first, store.conversation.thread != first {
            store.open(first)
        }
        store.focus(.sidebar)
        window.makeFirstResponder(nil)
        try await Task.sleep(for: .milliseconds(60))
    }

    private func prepare(_ command: String, _ window: NSWindow) async throws -> Plan {
        switch command {
        case "terminal.split", "terminal.splitVertical", "terminal.new", "terminal.close":
            store.panels.toggleTerminal()
            try await until("a terminal view", 8) { window.contentView?.firstDescendant(TerminalSurfaceView.self) != nil }
            store.focus(.terminal)
            try await until("terminal focus", 3) { window.firstResponder is TerminalSurfaceView }
            return .run("terminal focused")
        case "preview.refresh", "preview.focusUrl", "preview.zoomIn", "preview.zoomOut", "preview.resetZoom":
            store.panels.openSurface(.browser)
            try await until("a browser surface", 3) { store.panels.activeBrowser != nil }
            store.focus(.rightPanel)
            return .run("browser panel focused")
        case "rightPanel.close":
            store.panels.openSurface(.files)
            return .run("files panel open")
        case "rightPanel.previousTab", "rightPanel.nextTab":
            store.panels.openSurface(.files)
            store.panels.openSurface(.browser)
            return .run("files and browser tabs open")
        case "modelPicker.previousProvider", "modelPicker.nextProvider":
            store.conversation.modelPickerPresented = true
            try await Task.sleep(for: .milliseconds(120))
            let providers = Set(store.conversation.models.filter(\.configured).map(\.provider))
            return providers.count > 1 ? .run("model picker open") : .disabled("one configured provider (\(providers.sorted().joined(separator: ", ")))")
        case let jump where jump.hasPrefix("modelPicker.jump."):
            store.conversation.modelPickerPresented = true
            try await Task.sleep(for: .milliseconds(120))
            let number = Int(jump.dropFirst("modelPicker.jump.".count)) ?? 0
            let count = store.conversation.models.filter(\.configured).count
            return number <= count ? .run("model picker open") : .disabled("model picker open with \(count) configured model(s)")
        case "usage.cost", "usage.tokens", "usage.limits", "usage.period.day", "usage.period.week", "usage.period.month", "usage.period.quarter":
            store.show(.usage)
            try await Task.sleep(for: .milliseconds(150))
            return .run("Usage page open")
        case "navigation.back":
            if threads.count > 1 { store.open(threads[1]) }
            return .run("after opening a second thread")
        case "navigation.forward":
            if threads.count > 1 { store.open(threads[1]) }
            store.goBack()
            return .run("after going back")
        case "timeline.copyMessage":
            store.focus(.timeline)
            store.shell.timelineCursor = store.conversation.rows.last?.id
            return .resolveOnly("writes the system clipboard")
        case "thread.copyReference":
            return .resolveOnly("writes the system clipboard")
        case "editor.openFavorite":
            return .resolveOnly("launches an external editor")
        case "pullRequest.copyNumber":
            return .disabled("the thread's branch has no pull request")
        case "snapshot.capture":
            return store.pages.settings?.snapshotEnabled == true ? .resolveOnly("captures another app's window") : .disabled("SnapShots are off in Settings (default)")
        case "thread.steerQueuedMessage":
            return .disabled("the thread has no queued message")
        case "composer.stash":
            store.conversation.composer(project: project).text = "stash this prompt"
            return .run("composer has text")
        case "composer.effort":
            let levels = store.conversation.thinkingLevels(settings: store.pages.settings)
            return levels.count > 1 ? .run("thread open") : .disabled("the model has \(levels.count) thinking level(s)")
        case "composer.workspace", "composer.branch", "composer.previousWorktree":
            store.newThread(in: project)
            try await Task.sleep(for: .milliseconds(120))
            return .run("draft in a git project")
        case let jump where jump.hasPrefix("thread.jump."):
            let number = Int(jump.dropFirst("thread.jump.".count)) ?? 0
            return number <= store.inbox.visibleOrder.count ? .run("sidebar has \(store.inbox.visibleOrder.count) threads") : .disabled("fewer than \(number) threads")
        default:
            return .run("thread open, sidebar focused")
        }
    }

    private func cleanup(_ command: String, _ window: NSWindow) async throws {
        switch command {
        case "themeEditor.toggle":
            store.dispatch("themeEditor.toggle")
        case "appearance.cycle":
            store.dispatch("appearance.cycle")
            store.dispatch("appearance.cycle")
        case "composer.stash":
            store.conversation.composer(project: project).text = ""
        case "thread.pin", "thread.settle":
            store.dispatch(command)
        default:
            break
        }
        try await Task.sleep(for: .milliseconds(40))
    }

    private func report() {
        let width = outcomes.map(\.command.count).max() ?? 10
        print("| command | chord | when | result |")
        print("|---|---|---|---|")
        for outcome in outcomes {
            print("| \(outcome.command.padding(toLength: width, withPad: " ", startingAt: 0)) | \(outcome.chord) | \(outcome.when) | \(outcome.result) |")
        }
        let failed = outcomes.filter { !$0.passed }
        let ran = outcomes.filter { $0.result.hasPrefix("ran") }.count
        let disabled = outcomes.filter { $0.result.hasPrefix("disabled") }.count
        print("keys: \(outcomes.count) bindings, \(ran) ran, \(disabled) disabled with a reason, \(outcomes.count - ran - disabled - failed.count) live but not invoked, \(failed.count) dead")
        if failed.isEmpty {
            print("PASS macOS keys")
            NSApp.terminate(nil)
        } else {
            print("FAIL macOS keys: " + failed.map(\.command).joined(separator: ", "))
            store.stop()
            exit(1)
        }
    }
}
