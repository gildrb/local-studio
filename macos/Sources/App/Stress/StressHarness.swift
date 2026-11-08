import AppKit
import Foundation
import LocalStudioKit

@MainActor
final class StressHarness: NSObject {
    private struct Violation {
        let at: TimeInterval
        let kind: String
        let detail: String
    }

    private struct Send {
        let text: String
        let project: String?
        let at: TimeInterval
        let failing: Bool
        var shown: TimeInterval?
        var listed: TimeInterval?
    }

    private enum Action: String, CaseIterable {
        case jump = "⌘1–9"
        case burst = "⌘1–9 burst"
        case recent = "⌃Tab"
        case back = "⌘["
        case forward = "⌘]"
        case step = "⌘⇧[ / ⌘⇧]"
        case newThread = "⌘T+type+send"
        case failedStart = "send → failed start"
        case pendingAction = "Retry/Edit"
        case close = "⌘W"
        case focus = "F6"
        case palette = "⌘K"
        case terminal = "⌘J"
        case panel = "⌥⌘B"
        case sidebar = "⌘B"
        case escape = "Esc"
        case scroll = "scroll"
        case click = "click"
        case settings = "Settings window"
        case keyWindow = "key window change"

        var weight: Int {
            switch self {
            case .jump: 16
            case .burst: 8
            case .recent: 8
            case .back: 4
            case .forward: 3
            case .step: 4
            case .newThread: 4
            case .failedStart: 1
            case .pendingAction: 2
            case .close: 3
            case .focus: 5
            case .palette: 4
            case .terminal: 4
            case .panel: 3
            case .sidebar: 3
            case .escape: 4
            case .scroll: 5
            case .click: 10
            case .settings: 2
            case .keyWindow: 3
            }
        }
    }

    private static let pendingDeadline: TimeInterval = 10

    private let store: StudioStore
    private let duration: TimeInterval
    private let monitor = FrameMonitor()
    private var random: SplitMix
    private var violations: [Violation] = []
    private var violationCounts: [String: Int] = [:]
    private var actions: [Action: Int] = [:]
    private var prompts: [String: String] = [:]
    private var projects: [String: String] = [:]
    private var seenRows: [String: Int] = [:]
    private var composerBottom: [String: CGFloat] = [:]
    private var scrolled: Set<String> = []
    private var lastTop: [String: UInt64] = [:]
    private var expectedTop: [String: UInt64] = [:]
    private var restoreFrames = 0
    private var streaks: [String: Int] = [:]
    private var workStarts: [String: Int64] = [:]
    private var sends: [Send] = []
    private var switchStart: (target: String, at: TimeInterval)?
    private var switchLatencies: [TimeInterval] = []
    private var previousThread: String?
    private var created = 0
    private var failing = 0
    private var finished = false
    private var expectClose = false
    private var closes = 0
    private var reopenLatencies: [TimeInterval] = []
    private var watched: NSWindow?
    private var pendingSeen: [String: TimeInterval] = [:]
    private var pendingReported: Set<String> = []
    private var pendingOutcomes: [String: Int] = [:]
    private var knownRows: Set<String> = []
    private var rowsRevision = -1
    private var pendingSignature: [String] = []
    private var edited: Set<String> = []
    private var spammed: Set<ObjectIdentifier> = []
    private var startTicks = 0
    private var startUpdates = 0
    private var lastTicks = 0
    private var lastTickAt: TimeInterval = 0
    private var spamTickGap: TimeInterval = 0
    private var clickMonitor: Any?
    private var timelineClicks = 0

    init(store: StudioStore, duration: TimeInterval, seed: UInt64) {
        self.store = store
        self.duration = duration
        random = SplitMix(seed: seed)
    }

    func start() {
        Task { await run() }
    }

    private func run() async {
        do {
            try await until("the core connection", 60) { store.connection == .ready }
            store.shell.onboardingDismissed = true
            let window = try await reopenMainWindow()
            var seed = StressSeed(store: store)
            try await seed.run()
            prompts = seed.prompts
            for (thread, _) in prompts {
                projects[thread] = store.inbox.thread(thread)?.project
            }
            try await Task.sleep(for: .seconds(1))
            print("stress window \(Int(window.frame.width))×\(Int(window.frame.height)) key=\(window.isKeyWindow) active=\(NSApp.isActive) visible=\(window.occlusionState.contains(.visible))")
            monitor.start(window: window)
            monitor.onFrame = { [weak self] in self?.check() }
            clickMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
                self?.checkClick(event)
                return event
            }
            try await Task.sleep(for: .milliseconds(300))
            monitor.recording = true
            startTicks = store.ticks
            startUpdates = store.appliedUpdates
            let end = monitor.elapsed() + duration
            while monitor.elapsed() < end {
                guard let window = visibleMainWindow else { throw StressFailure("the main window disappeared") }
                try await perform(pick(), in: window)
                monitor.progress(ticks: store.ticks)
                try await pause()
            }
            try await settlePendings()
            monitor.recording = false
            if let window = visibleMainWindow {
                KeyDriver.release(in: window)
            }
            monitor.stop()
            clickMonitor.map(NSEvent.removeMonitor)
            finish()
        } catch {
            print("FAIL macOS stress: \(error)")
            store.stop()
            exit(1)
        }
    }

    private var visibleMainWindow: NSWindow? {
        store.mainWindow.flatMap { $0.isVisible ? $0 : nil }
    }

    private func reopenMainWindow() async throws -> NSWindow {
        let window = try await presentMainWindow(store)
        if watched !== window {
            if let watched {
                NotificationCenter.default.removeObserver(self, name: NSWindow.willCloseNotification, object: watched)
            }
            NotificationCenter.default.addObserver(self, selector: #selector(mainWindowWillClose(_:)), name: NSWindow.willCloseNotification, object: window)
            watched = window
        }
        return window
    }

    @objc private func mainWindowWillClose(_ notification: Notification) {
        guard !expectClose else { return }
        print("FAIL macOS stress: the main window closed after \(monitor.context)")
        store.stop()
        exit(1)
    }

    private func settlePendings() async throws {
        monitor.context = "settling"
        let deadline = monitor.elapsed() + Self.pendingDeadline + 1
        while monitor.elapsed() < deadline, store.conversation.pendings.contains(where: { $0.failure == nil }) {
            try await Task.sleep(for: .milliseconds(50))
            monitor.progress(ticks: store.ticks)
        }
    }

    private lazy var enabled: [Action] = {
        let skipped = Set((ProcessInfo.processInfo.environment["STRESS_SKIP"] ?? "").split(separator: ",").map(String.init))
        return Action.allCases.filter { !skipped.contains("\($0)") }
    }()

    private func pick() -> Action {
        let total = enabled.map(\.weight).reduce(0, +)
        var roll = random.int(total)
        for action in enabled {
            roll -= action.weight
            if roll < 0 { return action }
        }
        return .jump
    }

    private func pause() async throws {
        let roll = random.int(100)
        let milliseconds = roll < 25 ? 8 + random.int(22) : roll < 85 ? 30 + random.int(90) : 150 + random.int(250)
        try await Task.sleep(for: .milliseconds(milliseconds))
    }

    private func press(_ spec: String, _ window: NSWindow, hold: Bool = false) {
        guard let chord = KeyChord.parse(spec) else { return }
        monitor.context = spec
        let before = store.conversation.selectedID
        KeyDriver.press(chord, in: window, hold: hold)
        if ProcessInfo.processInfo.environment["STRESS_TRACE"] != nil {
            print("press \(spec) \(before ?? "nil") -> \(store.conversation.selectedID ?? "nil") key=\(window.isKeyWindow) responder=\(window.firstResponder.map { "\(type(of: $0))" } ?? "nil")")
        }
    }

    private func jump(_ window: NSWindow) {
        let count = min(9, store.inbox.visibleOrder.count)
        guard count > 0 else { return }
        press("cmd+\(1 + random.int(count))", window)
    }

    private func perform(_ action: Action, in window: NSWindow) async throws {
        actions[action, default: 0] += 1
        if ProcessInfo.processInfo.environment["STRESS_TRACE"] != nil {
            print(String(format: "%7.2f action ", monitor.elapsed()) + action.rawValue)
        }
        let before = store.conversation.thread
        switch action {
        case .jump:
            jump(window)
        case .burst:
            for _ in 0..<(5 + random.int(12)) {
                if random.int(5) == 0 {
                    click(.sidebar, window)
                } else {
                    jump(window)
                }
                noteSwitch(from: before)
                try await Task.sleep(for: .milliseconds(10 + random.int(21)))
            }
        case .recent:
            KeyDriver.flags(.control, in: window)
            for index in 0..<(1 + random.int(3)) {
                if index > 0 { try await Task.sleep(for: .milliseconds(10 + random.int(50))) }
                press(random.int(4) == 0 ? "ctrl+shift+tab" : "ctrl+tab", window, hold: true)
            }
            KeyDriver.release(in: window)
        case .back:
            press("cmd+[", window)
        case .forward:
            press("cmd+]", window)
        case .step:
            press(random.int(2) == 0 ? "cmd+shift+[" : "cmd+shift+]", window)
        case .newThread:
            guard created < 8 else { return jump(window) }
            try await newThread(in: window, failing: false)
        case .failedStart:
            guard failing < 3 else { return jump(window) }
            try await newThread(in: window, failing: true)
        case .pendingAction:
            resolveFailedStart()
        case .close:
            try await close(window)
        case .focus:
            press(random.int(3) == 0 ? "shift+f6" : "f6", window)
        case .palette:
            press("cmd+k", window)
            try await Task.sleep(for: .milliseconds(40 + random.int(200)))
            press(random.int(2) == 0 ? "escape" : "cmd+k", window)
        case .terminal:
            press("cmd+j", window)
            spamTerminals()
        case .panel:
            press("cmd+option+b", window)
        case .sidebar:
            press("cmd+b", window)
        case .escape:
            press("escape", window)
        case .scroll:
            guard let thread = store.conversation.thread, store.shell.route == .thread,
                  let frame = store.shell.keys.frames[.timeline] else { return }
            monitor.context = "scroll"
            scrolled.insert(thread)
            let height = window.contentView?.bounds.height ?? 0
            KeyDriver.scroll(CGFloat(300 + random.int(900)), at: NSPoint(x: frame.midX, y: height - frame.midY), in: window)
        case .click:
            let regions: [FocusRegion] = [.sidebar, .sidebar, .timeline, .composer]
            click(regions[random.int(regions.count)], window)
        case .settings:
            try await toggleSettings(window)
        case .keyWindow:
            monitor.context = "key window change"
            NotificationCenter.default.post(name: NSWindow.didResignKeyNotification, object: window)
            try await Task.sleep(for: .milliseconds(5 + random.int(40)))
            NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: window)
        }
        noteSwitch(from: before)
    }

    private func noteSwitch(from before: String?) {
        if let after = store.conversation.thread, after != before {
            switchStart = (after, monitor.elapsed())
        }
    }

    private func spamTerminals() {
        let sessions = store.panels.decks.values.flatMap { $0.groups.flatMap(\.sessions) }
        for session in sessions where !spammed.contains(ObjectIdentifier(session)) {
            spammed.insert(ObjectIdentifier(session))
            session.write(Data("while :; do seq -f 'stress line %g of a terminal flooding the core with frames' 1 200; sleep 0.01; done\r".utf8))
        }
    }

    private func click(_ region: FocusRegion, _ window: NSWindow) {
        guard let frame = store.shell.keys.frames[region], frame.width > 4, frame.height > 4,
              let height = window.contentView?.bounds.height else { return }
        monitor.context = "click \(region)"
        let x = frame.minX + frame.width * (0.2 + Double(random.int(60)) / 100)
        let fraction = region == .sidebar ? 0.08 + Double(random.int(50)) / 100 : 0.15 + Double(random.int(70)) / 100
        let y = frame.minY + frame.height * fraction
        KeyDriver.click(at: NSPoint(x: x, y: height - y), in: window)
    }

    private func checkClick(_ event: NSEvent) {
        guard monitor.recording, let window = event.window, window === store.mainWindow, store.shell.route == .thread,
              let root = window.contentView?.superview, let height = window.contentView?.bounds.height,
              let frame = store.shell.keys.frames[.timeline] else { return }
        let location = CGPoint(x: event.locationInWindow.x, y: height - event.locationInWindow.y)
        guard frame.contains(location), let hit = root.hitTest(event.locationInWindow) else { return }
        let chain = sequence(first: hit, next: \.superview)
        guard let timeline = chain.compactMap({ $0 as? NSScrollView }).last else { return }
        timelineClicks += 1
        let focused = store.conversation.selectedID ?? "draft"
        if Self.opacity(of: hit) < 0.01 {
            record("hidden timeline click", "a click landed in a hidden timeline while \(focused) is focused, after \(monitor.context)")
        }
        let bounds = timeline.convert(timeline.bounds, to: nil)
        var visible = 0
        func count(_ view: NSView) {
            if let scroll = view as? NSScrollView {
                if scroll.convert(scroll.bounds, to: nil) == bounds, Self.opacity(of: scroll) >= 0.01 { visible += 1 }
                return
            }
            view.subviews.forEach(count)
        }
        count(root)
        if visible != 1 {
            record("timeline click target", "a click on the timeline found \(visible) visible timelines while \(focused) is focused, after \(monitor.context)")
        }
    }

    private static func opacity(of view: NSView) -> Float {
        sequence(first: view, next: \.superview).reduce(1) { $0 * Float($1.alphaValue) * ($1.layer?.opacity ?? 1) * ($1.isHidden ? 0 : 1) }
    }

    private func toggleSettings(_ window: NSWindow) async throws {
        monitor.context = "Settings window"
        let before = Set(NSApp.windows.filter(\.isVisible).map(ObjectIdentifier.init))
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        try await Task.sleep(for: .milliseconds(80 + random.int(300)))
        let opened = NSApp.windows.filter { $0.isVisible && $0 !== window && !before.contains(ObjectIdentifier($0)) }
        for settings in opened {
            settings.performClose(nil)
        }
        NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: window)
    }

    private func close(_ window: NSWindow) async throws {
        let draft = store.shell.route == .thread && store.conversation.selectedID == nil && !store.panels.rightPanelOpen
        guard draft else {
            guard store.conversation.selectedID != nil || store.panels.rightPanelOpen else { return jump(window) }
            return press("cmd+w", window)
        }
        guard closes < 3 else { return jump(window) }
        closes += 1
        expectClose = true
        defer { expectClose = false }
        press("cmd+w", window)
        try await until("⌘W on an empty draft to close the main window", 3) { visibleMainWindow == nil }
        guard NSApp.isRunning else { throw StressFailure("⌘W on an empty draft quit the app") }
        let start = monitor.elapsed()
        let reopened = try await reopenMainWindow()
        reopenLatencies.append(monitor.elapsed() - start)
        monitor.attach(window: reopened)
    }

    private func newThread(in window: NSWindow, failing: Bool) async throws {
        press("cmd+t", window)
        try await Task.sleep(for: .milliseconds(30 + random.int(60)))
        let text: String
        if failing {
            self.failing += 1
            text = "doomed \(self.failing)"
            store.conversation.newThread.existingWorktree = "/nonexistent/local-studio-stress-\(self.failing)"
        } else {
            created += 1
            text = "hello \(created)"
        }
        let project = store.inbox.currentProject
        if store.conversation.selectedID == nil {
            store.conversation.composer(project: project).text = ""
        }
        let responder = window.firstResponder.map { "\(type(of: $0))" } ?? "nil"
        monitor.context = "type"
        for character in text {
            KeyDriver.type(String(character), in: window)
            try await Task.sleep(for: .milliseconds(15 + random.int(30)))
        }
        let typed = store.conversation.selectedID == nil ? store.conversation.composer(project: project).text : ""
        if typed != text {
            let after = window.firstResponder.map { "\(type(of: $0))" } ?? "nil"
            let focused = store.conversation.selectedID ?? "draft"
            let terminal = store.panels.terminalOpen
            record("typing", "⌘T then typing “\(text)” left the draft composer with “\(typed)” (responder \(responder) → \(after), focused \(focused), region \(store.shell.region), terminal \(terminal), composer there “\(store.conversation.composer(project: project).text)”)")
            store.conversation.newThread.existingWorktree = nil
            return
        }
        sends.append(Send(text: text, project: project, at: monitor.elapsed(), failing: failing))
        press("return", window)
        if store.conversation.selectedID != nil, store.conversation.pending == nil {
            record("send", "sending “\(text)” from a draft did not show a pending thread")
        }
        try await Task.sleep(for: .milliseconds(random.int(40)))
        jump(window)
    }

    private func resolveFailedStart() {
        let failed = store.conversation.pendings.filter { $0.failure != nil }
        guard !failed.isEmpty else { return }
        let start = failed[random.int(failed.count)]
        monitor.context = "Retry/Edit"
        if random.int(2) == 0 {
            pendingOutcomes["retried", default: 0] += 1
            store.conversation.retryPending(start.draft)
        } else {
            pendingOutcomes["edited", default: 0] += 1
            edited.insert(start.draft)
            store.conversation.editPending(start.draft)
        }
    }

    private func record(_ kind: String, _ detail: String) {
        violationCounts[kind, default: 0] += 1
        if violationCounts[kind, default: 0] <= 5 {
            violations.append(Violation(at: monitor.elapsed(), kind: kind, detail: detail))
        }
    }

    private func streak(_ kind: String, _ failing: Bool, limit: Int = 2, _ detail: @autoclosure () -> String) {
        guard failing else {
            streaks[kind] = 0
            return
        }
        let count = streaks[kind, default: 0] + 1
        streaks[kind] = count
        if count == limit {
            record(kind, detail())
        }
    }

    private func checkCoreTicks() {
        let now = monitor.elapsed()
        guard store.ticks == lastTicks else {
            lastTicks = store.ticks
            lastTickAt = now
            return
        }
        guard !spammed.isEmpty, lastTickAt > 0 else { return }
        let gap = now - lastTickAt
        spamTickGap = max(spamTickGap, gap)
        if gap > 1 {
            record("core stalled", "no core update applied for \(Int(gap * 1000)) ms while terminals were flooding, after \(monitor.context)")
            lastTickAt = now
        }
    }

    private func check() {
        guard monitor.recording else { return }
        checkCoreTicks()
        trackSends()
        checkPendings()
        checkRows()
        let thread = store.conversation.thread
        if thread != previousThread {
            if let previousThread, let top = lastTop[previousThread] {
                expectedTop[previousThread] = top
            }
            previousThread = thread
            restoreFrames = 0
        }
        guard store.shell.route == .thread, !(store.panels.rightPanelOpen && store.panels.rightPanelMaximized) else { return }
        let probe = store.shell.probe
        let header = probe.header
        let pending = store.conversation.focusedPending
        streak("stale header", header?.thread != thread || header?.pending != pending, "header shows \(header?.thread ?? header?.pending ?? "draft") while \(thread ?? pending ?? "draft") is focused")
        if let pending, let start = store.conversation.pendingStart(pending), header?.pending == pending {
            let title = start.info.title.isEmpty ? "Untitled thread" : start.info.title
            streak("pending header", header?.title != title, "pending header shows “\(header?.title ?? "")”, expected “\(title)”")
        }
        guard let thread else {
            if let pending {
                streak("stale pending timeline", probe.timeline?.pending != pending, "timeline shows \(probe.timeline?.thread ?? probe.timeline?.pending ?? "nothing") while pending \(pending) is focused")
            }
            return
        }
        if let header, header.thread == thread {
            checkHeader(header, thread: thread)
        }
        guard let timeline = probe.timeline, timeline.thread == thread else {
            streak("stale timeline", true, "timeline still shows \(probe.timeline?.thread ?? "nothing") while \(thread) is focused")
            return
        }
        streaks["stale timeline"] = 0
        checkTimeline(timeline, thread: thread)
        if timeline.rows > 0, header?.thread == thread, let start = switchStart, start.target == thread {
            switchLatencies.append(monitor.elapsed() - start.at)
            switchStart = nil
        }
        checkComposer(thread: thread, consistent: header?.thread == thread)
        if let scroll = probe.scroll, scroll.thread == thread, timeline.rows > 0 {
            checkScroll(scroll, thread: thread)
        }
        checkWorking(thread: thread)
    }

    private func checkWorking(thread: String) {
        guard store.inbox.thread(thread)?.status == .working else {
            workStarts[thread] = nil
            streaks["working row"] = 0
            return
        }
        guard store.conversation.followsEnd, store.conversation.info?.thread == thread else { return }
        let probe = store.shell.probe.working
        let started = probe?.thread == thread && probe?.shown == true ? probe?.started : nil
        streak("working row", started == nil, "\(thread) is Working in the sidebar but its timeline shows \(probe?.thread == thread && probe?.shown == true ? "a working row without a start time" : "no working row"), after \(monitor.context)")
        guard let started else { return }
        if let previous = workStarts[thread], started > previous {
            record("working reset", "\(thread) working row restarted its elapsed time \(started - previous) ms later mid-turn, after \(monitor.context)")
        }
        workStarts[thread] = started
    }

    private func checkPendings() {
        let now = monitor.elapsed()
        for start in store.conversation.pendings {
            let first = pendingSeen[start.draft] ?? now
            pendingSeen[start.draft] = first
            if store.inbox.thread(start.draft) == nil {
                record("pending row missing", "pending “\(start.info.title)” has no sidebar row")
            }
            guard start.failure == nil, now - first > Self.pendingDeadline, !pendingReported.contains(start.draft) else { continue }
            pendingReported.insert(start.draft)
            let state = start.thread == nil ? "neither started nor failed" : "started as \(start.thread ?? "") but never listed"
            record("pending stuck", "pending “\(start.info.title)” \(state) after \(Int(Self.pendingDeadline)) s")
        }
    }

    private func checkRows() {
        let signature = store.conversation.pendings.map { "\($0.draft)|\($0.thread ?? "")|\($0.failure != nil)" }
        guard store.inbox.threadsRevision != rowsRevision || signature != pendingSignature else { return }
        rowsRevision = store.inbox.threadsRevision
        pendingSignature = signature
        let current = Set(store.inbox.threads.map(\.id)).union(store.conversation.pendings.map(\.draft))
        let aliases = store.conversation.aliases
        for gone in knownRows.subtracting(current) {
            if let thread = aliases.first(where: { $0.value == gone })?.key, current.contains(thread) {
                pendingOutcomes["started", default: 0] += 1
                continue
            }
            if edited.contains(gone) { continue }
            record("row vanished", "sidebar row \(gone) disappeared without an archive or delete")
        }
        knownRows = current
        for start in store.conversation.pendings where start.failure != nil && !pendingReported.contains("failed:\(start.draft)") {
            pendingReported.insert("failed:\(start.draft)")
            pendingOutcomes["failed", default: 0] += 1
        }
    }

    private func checkHeader(_ header: HeaderProbe, thread: String) {
        let row = store.inbox.thread(thread)
        let title = row?.title.isEmpty == false ? row?.title : store.conversation.info.flatMap { $0.thread == thread && !$0.title.isEmpty ? $0.title : nil }
        let project = row?.project ?? projects[thread]
        if project != nil, header.project == "No project" {
            record("no project", "header shows “No project” for \(thread) in \(project ?? "")")
        }
        if project != nil, header.title == "Untitled thread" {
            record("untitled", "header shows “Untitled thread” for \(thread)")
        }
        if let title, header.title != title, header.title != "Untitled thread" {
            streak("header title", true, "header shows “\(header.title)” for \(thread) titled “\(title)”")
        } else {
            streaks["header title"] = 0
        }
    }

    private func checkTimeline(_ timeline: TimelineProbe, thread: String) {
        if timeline.rows == 0, !timeline.placeholder, let seen = seenRows[thread], seen > 0 {
            record("blank timeline", "\(thread) rendered 0 rows after showing \(seen)")
        }
        if let first = timeline.firstUser {
            if let expected = prompts[thread] {
                if first != expected {
                    record("foreign rows", "\(thread) rendered rows starting “\(first)”, expected “\(expected)”")
                }
            } else if store.conversation.info?.thread == thread {
                prompts[thread] = first
            }
        }
        if timeline.rows > 0 {
            seenRows[thread] = timeline.rows
        }
    }

    private func checkComposer(thread: String, consistent: Bool) {
        guard consistent, let frame = store.shell.keys.frames[.composer], let window = store.mainWindow else { return }
        let key = "\(store.panels.terminalOpen)-\(Int(window.frame.height))-\(store.panels.rightPanelOpen)"
        guard let base = composerBottom[key] else {
            composerBottom[key] = frame.maxY
            return
        }
        if abs(frame.maxY - base) > 0.5 {
            record("composer moved", "composer bottom at \(frame.maxY) for \(thread), expected \(base), after \(monitor.context)")
        }
    }

    private func checkScroll(_ scroll: ScrollProbe, thread: String) {
        if let top = scroll.top {
            lastTop[thread] = top
        }
        guard scrolled.contains(thread) else {
            if scroll.distance > 2 {
                record("not at bottom", "\(thread) shown \(Int(scroll.distance)) pt above the end (follows end \(store.conversation.followsEnd)), after \(monitor.context)")
            }
            return
        }
        guard let expected = expectedTop[thread] else { return }
        restoreFrames += 1
        if scroll.top == expected {
            expectedTop[thread] = nil
        } else if restoreFrames > 3 {
            record("scroll not restored", "\(thread) top row \(scroll.top.map(String.init) ?? "?"), expected \(expected)")
            expectedTop[thread] = nil
        }
    }

    private func trackSends() {
        let now = monitor.elapsed()
        for index in sends.indices where sends[index].shown == nil || sends[index].listed == nil {
            let text = sends[index].text
            if sends[index].listed == nil, store.inbox.sections.contains(title: text) {
                sends[index].listed = now - sends[index].at
            }
            if sends[index].shown == nil, store.shell.probe.timeline?.firstUser == text {
                sends[index].shown = now - sends[index].at
            }
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true
        let interval = monitor.interval
        let ms = { (value: TimeInterval) in String(format: "%.1f ms", value * 1000) }
        let p99 = monitor.percentile(0.99)
        print("stress \(Int(duration)) s, \(monitor.frames.count) frames at \(ms(interval)) refresh")
        print("frame time p50 \(ms(monitor.percentile(0.5))) p95 \(ms(monitor.percentile(0.95))) p99 \(ms(p99)) max \(ms(monitor.frames.max() ?? 0))")
        let worst = monitor.hitches.max { $0.duration < $1.duration }
        print("hitches (>1.5× refresh): \(monitor.hitches.count)" + (worst.map { ", worst \(ms($0.duration)) at \(String(format: "%.2f", $0.at)) s after \($0.context)" } ?? ""))
        print("main-thread stalls >50 ms: \(monitor.stalls.count)")
        for stall in monitor.stalls.prefix(20) {
            print("  stall \(ms(stall.duration)) at \(String(format: "%.2f", stall.at)) s after \(stall.context)")
        }
        print("core: \(store.ticks - startTicks) ticks applied \(store.appliedUpdates - startUpdates) updates; \(spammed.count) terminals flooding, longest gap between ticks while flooding \(ms(spamTickGap))")
        let latencies = switchLatencies.sorted()
        if !latencies.isEmpty {
            let median = latencies[latencies.count / 2]
            let p95 = latencies[min(latencies.count - 1, Int(Double(latencies.count) * 0.95))]
            print("thread switch → content: \(latencies.count) switches, p50 \(ms(median)) p95 \(ms(p95)) max \(ms(latencies.last ?? 0))")
        }
        for send in sends {
            print("send “\(send.text)”\(send.failing ? " (failing start)" : "") → thread view \(send.shown.map(ms) ?? "never"), sidebar row \(send.listed.map(ms) ?? "never")")
        }
        if !reopenLatencies.isEmpty {
            print("⌘W on draft closed the window \(reopenLatencies.count)× and the app kept running; reopen → window " + reopenLatencies.map(ms).joined(separator: ", "))
        }
        print("pending starts: " + pendingOutcomes.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: ", "))
        print("actions: " + Action.allCases.compactMap { action in actions[action].map { "\(action.rawValue) \($0)" } }.joined(separator: ", "))
        print("input events: \(KeyDriver.native) through NSApp.sendEvent (window key), \(KeyDriver.emulated) through the window, views and monitors (app inactive)")
        print("clicks hit-tested in the timeline area: \(timelineClicks)")
        print("invariant violations: \(violationCounts.values.reduce(0, +))")
        for (kind, count) in violationCounts.sorted(by: { $0.key < $1.key }) {
            print("  \(kind): \(count)")
        }
        for violation in violations {
            print("  \(String(format: "%7.2f", violation.at)) s \(violation.kind): \(violation.detail)")
        }
        var failures: [String] = []
        if !violationCounts.isEmpty { failures.append("\(violationCounts.values.reduce(0, +)) invariant violations") }
        if !monitor.stalls.isEmpty { failures.append("\(monitor.stalls.count) main-thread stalls") }
        if p99 > interval * 2 + 0.0005 { failures.append("p99 frame time \(ms(p99)) above 2 refresh intervals") }
        if failures.isEmpty {
            print("PASS macOS stress")
            NSApp.terminate(nil)
        } else {
            print("FAIL macOS stress: " + failures.joined(separator: ", "))
            store.stop()
            exit(1)
        }
    }
}

private extension InboxSections {
    func contains(title: String) -> Bool {
        [pinned, active, working, snoozed, settled].contains { rows in rows.contains { $0.title == title } }
    }
}

struct SplitMix {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var value = state
        value = (value ^ (value >> 30)) &* 0xBF58_476D_1CE4_E5B9
        value = (value ^ (value >> 27)) &* 0x94D0_49BB_1331_11EB
        return value ^ (value >> 31)
    }

    mutating func int(_ bound: Int) -> Int {
        guard bound > 0 else { return 0 }
        return Int(next() % UInt64(bound))
    }
}
