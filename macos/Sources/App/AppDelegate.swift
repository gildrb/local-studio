import AppKit
import LocalStudioKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let store: StudioStore
    let commandRefresh: CommandRefresh
    private var smoke: Smoke?
    private var conversationSmoke: ConversationSmoke?
    private var shellSmoke: ShellSmoke?
    private var monitors: [Any] = []
    private var commandHold: DispatchWorkItem?
    private var panelSmoke: PanelSmoke?
    private var stress: StressHarness?
    private var providersSmoke: ProvidersSmoke?
    private var keys: KeysHarness?

    override init() {
        store = StudioStore(launch: Self.bundledDaemon(), controllerMain: Self.bundledController())
        commandRefresh = CommandRefresh(store: store)
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = CommandLine.arguments
        if let flag = arguments.firstIndex(of: "+snapshot") {
            let directory = arguments.indices.contains(flag + 1) ? arguments[flag + 1] : NSTemporaryDirectory() + "local-studio-snapshots"
            let filter = arguments.indices.contains(flag + 2) ? arguments[flag + 2] : nil
            exit(Snapshots.run(into: URL(fileURLWithPath: directory, isDirectory: true), matching: filter))
        }
        SyntaxHighlighter.shared.warm()
        let stressFlag = arguments.firstIndex(of: "+stress")
        let keysFlag = arguments.contains("+keys")
        if stressFlag != nil || keysFlag {
            StressSeed.prepareProcess()
        }
        configureNotifier()
        installKeyMonitors()
        do {
            try store.start()
        } catch {
            NSAlert(error: error).runModal()
            NSApp.terminate(nil)
            return
        }
        if arguments.contains("+smoke") {
            let smoke = Smoke(store: store)
            smoke.start()
            self.smoke = smoke
        }
        if arguments.contains("+smoke-conversation") {
            let smoke = ConversationSmoke(store: store)
            smoke.start()
            conversationSmoke = smoke
        }
        if arguments.contains("+smoke-shell") {
            let smoke = ShellSmoke(store: store)
            smoke.start()
            shellSmoke = smoke
        }
        if let flag = arguments.firstIndex(of: "+smoke-panels") {
            let path = arguments.indices.contains(flag + 1) ? arguments[flag + 1] : NSTemporaryDirectory() + "ls-smoke-panels-diff.png"
            let smoke = PanelSmoke(store: store, output: URL(fileURLWithPath: path))
            smoke.start()
            panelSmoke = smoke
        }
        if let flag = stressFlag {
            let seconds = arguments.indices.contains(flag + 1) ? TimeInterval(arguments[flag + 1]) : nil
            let seed = arguments.indices.contains(flag + 2) ? UInt64(arguments[flag + 2]) : nil
            let harness = StressHarness(store: store, duration: seconds ?? 60, seed: seed ?? 1)
            harness.start()
            stress = harness
        }
        if arguments.contains("+smoke-providers") {
            let smoke = ProvidersSmoke(store: store)
            smoke.start()
            providersSmoke = smoke
        }
        if keysFlag {
            let harness = KeysHarness(store: store)
            harness.start()
            keys = harness
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !automated else { return .terminateNow }
        if store.pages.settings?.quitConfirmation == .hold, Self.quitShortcutPressed() {
            guard Self.quitShortcutHeld(for: 0.6) else {
                store.post(.info, "Hold ⌘Q to quit Local Studio.")
                return .terminateCancel
            }
        }
        let working = store.inbox.threads.filter { $0.status == .working }.count
        guard working > 0 else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = working == 1 ? "A thread is still working" : "\(working) threads are still working"
        alert.informativeText = "Quit Local Studio anyway?"
        alert.addButton(withTitle: "Quit")
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn ? .terminateNow : .terminateCancel
    }

    private var automated: Bool {
        smoke != nil || shellSmoke != nil || conversationSmoke != nil || panelSmoke != nil || providersSmoke != nil || stress != nil || keys != nil
    }

    private static func quitShortcutPressed() -> Bool {
        guard let event = NSApp.currentEvent, event.type == .keyDown else { return false }
        return event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers?.lowercased() == "q"
    }

    private static func quitShortcutHeld(for seconds: TimeInterval) -> Bool {
        let deadline = Date.now.addingTimeInterval(seconds)
        while Date.now < deadline {
            let command = CGEventSource.keyState(.combinedSessionState, key: 0x37) || CGEventSource.keyState(.combinedSessionState, key: 0x36)
            guard command, CGEventSource.keyState(.combinedSessionState, key: 0x0C) else { return false }
            RunLoop.current.run(until: Date.now.addingTimeInterval(0.03))
        }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        monitors.forEach(NSEvent.removeMonitor)
        store.stop()
    }

    private func configureNotifier() {
        let store = store
        let notifier = store.inbox.notifier
        notifier.context = {
            NotifyContext(
                mode: store.pages.settings?.notifications ?? .off,
                inApp: store.pages.settings?.inAppNotifications ?? false,
                focusedThread: store.shell.route == .thread ? store.focusedThread : nil
            )
        }
        notifier.openThread = { thread in store.open(thread) }
        notifier.toast = { level, text in store.post(level, text) }
    }

    private func installKeyMonitors() {
        let flags = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] event in
            self?.flagsChanged(event.modifierFlags)
            return event
        }
        let keys = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.keyDown(event) == true ? nil : event
        }
        KeyDriver.keyMonitor = { [weak self] event in self?.keyDown(event) == true }
        KeyDriver.flagsMonitor = { [weak self] event in self?.flagsChanged(event.modifierFlags) }
        let clicks = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            if let window = event.window {
                self?.store.noteClick(at: event.locationInWindow, in: window)
            }
            return event
        }
        monitors = [flags, keys, clicks].compactMap(\.self)
    }

    private func keyDown(_ event: NSEvent) -> Bool {
        cancelCommandHold()
        guard let window = event.window, window === store.mainWindow, window.attachedSheet == nil else { return false }
        if store.shell.palette == nil, let input = NavInput(event), store.routeKey(input, responder: window.firstResponder) {
            return true
        }
        return store.routeChord(event, responder: window.firstResponder)
    }

    private func flagsChanged(_ flags: NSEvent.ModifierFlags) {
        let relevant = flags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
        if !relevant.contains(.control) {
            store.endRecentCycle()
        }
        guard relevant == .command else {
            cancelCommandHold()
            return
        }
        guard commandHold == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            self?.store.shell.commandHeld = true
        }
        commandHold = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45, execute: work)
    }

    private func cancelCommandHold() {
        commandHold?.cancel()
        commandHold = nil
        if store.shell.commandHeld {
            store.shell.commandHeld = false
        }
    }

    private static func bundledController() -> String? {
        guard let resources = Bundle.main.resourceURL else { return nil }
        let main = resources.appendingPathComponent("controller/src/main.ts")
        return FileManager.default.fileExists(atPath: main.path) ? main.path : nil
    }

    private static func bundledDaemon() -> DaemonLaunch? {
        guard let url = Bundle.main.url(forAuxiliaryExecutable: "eukhe-daemon") else { return nil }
        return DaemonLaunch(program: url.path, arguments: ["supervisor"])
    }
}
