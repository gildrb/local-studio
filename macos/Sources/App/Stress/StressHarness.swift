import AppKit
import Foundation
import LocalStudioKit

@MainActor
final class StressHarness {
    private struct Violation {
        let at: TimeInterval
        let kind: String
        let detail: String
    }

    private struct Send {
        let text: String
        let project: String?
        let at: TimeInterval
        let sidebarCount: Int
        var thread: String?
        var shown: TimeInterval?
        var listed: TimeInterval?
    }

    private enum Action: String, CaseIterable {
        case jump = "⌘1–9"
        case recent = "⌃Tab"
        case back = "⌘["
        case forward = "⌘]"
        case step = "⌘⇧[ / ⌘⇧]"
        case newThread = "⌘T+type+send"
        case close = "⌘W"
        case focus = "F6"
        case palette = "⌘K"
        case terminal = "⌘J"
        case panel = "⌥⌘B"
        case sidebar = "⌘B"
        case escape = "Esc"
        case scroll = "scroll"

        var weight: Int {
            switch self {
            case .jump: 34
            case .recent: 10
            case .back: 5
            case .forward: 4
            case .step: 4
            case .newThread: 3
            case .close: 3
            case .focus: 7
            case .palette: 5
            case .terminal: 3
            case .panel: 3
            case .sidebar: 4
            case .escape: 6
            case .scroll: 6
            }
        }
    }

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
    private var sends: [Send] = []
    private var switchStart: (target: String, at: TimeInterval)?
    private var switchLatencies: [TimeInterval] = []
    private var previousThread: String?
    private var created = 0
    private var finished = false

    init(store: StudioStore, duration: TimeInterval, seed: UInt64) {
        self.store = store
        self.duration = duration
        random = SplitMix(seed: seed)
    }

    static func prepare() {
        setvbuf(stdout, nil, _IOLBF, 0)
        StressSeed.installScript()
    }

    func start() {
        Task { await run() }
    }

    private func run() async {
        do {
            try await until("the core connection", 60) { store.connection == .ready }
            store.shell.onboardingDismissed = true
            NSApp.activate()
            if store.mainWindow == nil {
                let configuration = NSWorkspace.OpenConfiguration()
                configuration.activates = true
                NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, _ in }
            }
            try await until("the main window", 20) { store.mainWindow != nil }
            guard let window = store.mainWindow else { throw StressFailure("no main window") }
            window.makeKeyAndOrderFront(nil)
            var seed = StressSeed(store: store)
            try await seed.run()
            NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    print("FAIL macOS stress: the main window closed after \(self?.monitor.context ?? "launch")")
                    self?.store.stop()
                    exit(1)
                }
            }
            prompts = seed.prompts
            for (thread, _) in prompts {
                projects[thread] = store.inbox.thread(thread)?.project
            }
            try await Task.sleep(for: .seconds(1))
            print("stress window \(Int(window.frame.width))×\(Int(window.frame.height)) key=\(window.isKeyWindow) active=\(NSApp.isActive)")
            monitor.start(window: window)
            monitor.onFrame = { [weak self] in self?.check() }
            try await Task.sleep(for: .milliseconds(300))
            monitor.recording = true
            let end = monitor.elapsed() + duration
            while monitor.elapsed() < end {
                try await perform(pick(), in: window)
                try await pause()
            }
            monitor.recording = false
            KeyDriver.release(in: window)
            monitor.stop()
            finish()
        } catch {
            print("FAIL macOS stress: \(error)")
            store.stop()
            exit(1)
        }
    }

    private func pick() -> Action {
        let total = Action.allCases.map(\.weight).reduce(0, +)
        var roll = random.int(total)
        for action in Action.allCases {
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
        let before = store.conversation.thread
        KeyDriver.press(chord, in: window, hold: hold)
        if ProcessInfo.processInfo.environment["STRESS_TRACE"] != nil {
            print("press \(spec) \(before ?? "nil") -> \(store.conversation.thread ?? "nil") key=\(window.isKeyWindow) responder=\(type(of: window.firstResponder))")
        }
    }

    private func perform(_ action: Action, in window: NSWindow) async throws {
        actions[action, default: 0] += 1
        let before = store.conversation.thread
        switch action {
        case .jump:
            let count = min(9, store.inbox.visibleOrder.count)
            guard count > 0 else { return }
            press("cmd+\(1 + random.int(count))", window)
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
            guard created < 6 else { return press("cmd+1", window) }
            try await newThread(in: window)
        case .close:
            guard store.conversation.thread != nil || store.panels.rightPanelOpen else { return press("cmd+1", window) }
            press("cmd+w", window)
        case .focus:
            press(random.int(3) == 0 ? "shift+f6" : "f6", window)
        case .palette:
            press("cmd+k", window)
            try await Task.sleep(for: .milliseconds(40 + random.int(200)))
            press(random.int(2) == 0 ? "escape" : "cmd+k", window)
        case .terminal:
            press("cmd+j", window)
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
        }
        let after = store.conversation.thread
        if let after, after != before {
            switchStart = (after, monitor.elapsed())
        }
    }

    private func newThread(in window: NSWindow) async throws {
        press("cmd+t", window)
        try await Task.sleep(for: .milliseconds(30 + random.int(60)))
        created += 1
        let text = "hello \(created)"
        let project = store.inbox.currentProject
        monitor.context = "type"
        for character in text {
            KeyDriver.type(String(character), in: window)
            try await Task.sleep(for: .milliseconds(15 + random.int(30)))
        }
        let typed = store.conversation.thread == nil ? store.conversation.composer(project: project).text : ""
        if typed != text {
            record("typing", "⌘T then typing “\(text)” left the draft composer with “\(typed)”")
        }
        sends.append(Send(text: text, project: project, at: monitor.elapsed(), sidebarCount: store.inbox.visibleOrder.count))
        press("return", window)
        try await Task.sleep(for: .milliseconds(random.int(40)))
        press(random.int(2) == 0 ? "cmd+1" : "cmd+2", window)
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

    private func check() {
        guard monitor.recording else { return }
        let thread = store.conversation.thread
        trackSends()
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
        streak("stale header", header?.thread != thread, "header still shows \(header?.thread ?? "draft") while \(thread ?? "draft") is focused")
        guard let thread else { return }
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
        if timeline.rows == 0, let seen = seenRows[thread], seen > 0 {
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
            record("composer moved", "composer bottom at \(frame.maxY) for \(thread), expected \(base)")
        }
    }

    private func checkScroll(_ scroll: ScrollProbe, thread: String) {
        if let top = scroll.top {
            lastTop[thread] = top
        }
        guard scrolled.contains(thread) else {
            if scroll.distance > 2 {
                record("not at bottom", "\(thread) shown \(Int(scroll.distance)) pt above the end")
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
        for index in sends.indices {
            if sends[index].listed == nil, store.inbox.visibleOrder.count > sends[index].sidebarCount {
                sends[index].listed = now - sends[index].at
            }
            if sends[index].shown == nil, store.shell.probe.timeline?.firstUser == sends[index].text {
                sends[index].shown = now - sends[index].at
            }
            if sends[index].thread == nil, let thread = store.conversation.thread, prompts[thread] == nil, projects[thread] == nil {
                sends[index].thread = thread
                projects[thread] = sends[index].project
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
        let latencies = switchLatencies.sorted()
        if !latencies.isEmpty {
            let median = latencies[latencies.count / 2]
            let p95 = latencies[min(latencies.count - 1, Int(Double(latencies.count) * 0.95))]
            print("thread switch → content: \(latencies.count) switches, p50 \(ms(median)) p95 \(ms(p95)) max \(ms(latencies.last ?? 0))")
        }
        for send in sends {
            print("send “\(send.text)” → thread view \(send.shown.map(ms) ?? "never"), sidebar row \(send.listed.map(ms) ?? "never")")
        }
        print("actions: " + Action.allCases.compactMap { action in actions[action].map { "\(action.rawValue) \($0)" } }.joined(separator: ", "))
        print("key events: \(KeyDriver.native) through NSApp.sendEvent (window key), \(KeyDriver.emulated) through the window and monitors (app inactive)")
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
