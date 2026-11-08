import AppKit
import Foundation
import LocalStudioKit

@MainActor
final class UserSender {
    struct Turn {
        let text: String
        let sentAt: Date
        var thread: String?
        var highest: [DrawnElapsed.Source: (seconds: Int, text: String)] = [:]
        var episodes = 0
        var busy = false
        var done = false
        var bubble: TimeInterval?
        var draft: String?
        var followUp = false
    }

    private let store: StudioStore
    let turnLimit: TimeInterval
    var record: (String, String) -> Void = { _, _ in }
    var jitter: (Int) -> Int = { _ in 0 }
    var context: (String) -> Void = { _ in }
    private(set) var turns: [Turn] = []

    init(store: StudioStore) {
        self.store = store
        turnLimit = 150
        store.shell.probe.drawn = []
    }

    func send(_ text: String, in window: NSWindow, to target: String?, failing: Bool = false) async throws -> Int? {
        context("open \(target ?? "draft")")
        let rendered = { [store] in store.shell.probe.header?.thread == target && store.shell.probe.header?.pending == nil }
        if try await !wait(2, rendered) {
            let header = store.shell.probe.header
            record("view not shown", "before typing “\(text)” the header still shows \(header?.thread ?? header?.pending ?? "a draft"), expected \(target ?? "a draft")")
        }
        try await Task.sleep(for: .milliseconds(150 + jitter(100)))
        context("focus composer")
        if try await !wait(1, { Screen.composerFocused(in: window) }) {
            record("composer focus", "before typing “\(text)” the composer is not the first responder (\(Screen.responder(in: window))); clicking it")
            guard let composer = Screen.composer(in: window) else {
                record("composer focus", "no composer on screen to type “\(text)” into")
                return nil
            }
            let frame = composer.convert(composer.visibleRect, to: nil)
            KeyDriver.click(at: NSPoint(x: frame.midX, y: frame.midY), in: window)
            guard try await wait(1, { Screen.composerFocused(in: window) }) else {
                record("composer focus", "clicking the composer did not focus it (\(Screen.responder(in: window)))")
                return nil
            }
        }
        if Screen.composer(in: window)?.string.isEmpty == false {
            press("cmd+a", window)
            press("delete", window)
        }
        context("type")
        for character in text {
            KeyDriver.type(String(character), in: window)
            try await Task.sleep(for: .milliseconds(15 + jitter(30)))
        }
        let typed = Screen.composer(in: window)?.string ?? "(no composer)"
        let search = Screen.searchText(in: window)
        if !search.isEmpty {
            record("search captured typing", "typing “\(text)” into the composer put “\(search)” in the sidebar search field (responder \(Screen.responder(in: window)))")
        }
        guard typed == text, search.isEmpty else {
            if typed != text {
                record("typing", "typing “\(text)” left the composer showing “\(typed)” (responder \(Screen.responder(in: window)))")
            }
            store.inbox.query = ""
            store.conversation.newThread.existingWorktree = nil
            return nil
        }
        turns.append(Turn(text: text, sentAt: .now, thread: target, followUp: target != nil))
        let index = turns.count - 1
        context("send")
        press("return", window)
        if try await !wait(2, { Screen.composer(in: window)?.string.isEmpty == true }) {
            record("composer kept text", "after Return the composer still shows “\(Screen.composer(in: window)?.string ?? "")”")
        }
        if try await !wait(10, { Screen.bubbleShown(text, in: window, probe: store.shell.probe) }) {
            record("bubble missing", "after sending “\(text)” no user message with that text is on screen in the timeline (\(Screen.describeBubble(text, in: window, probe: store.shell.probe)))")
        } else {
            let latency = Date.now.timeIntervalSince(turns[index].sentAt)
            turns[index].bubble = latency
            if latency > 1 {
                record("bubble late", "the user message “\(text)” took \(Int(latency * 1000)) ms to appear in the timeline after Return")
            }
        }
        if failing {
            turns[index].done = true
        }
        return index
    }

    func thread(of index: Int) async throws -> String {
        try await until("“\(turns[index].text)” to start a thread", 30) {
            check()
            return turns[index].thread != nil
        }
        return turns[index].thread ?? ""
    }

    func reply(to index: Int) async throws {
        let thread = try await thread(of: index)
        try await until("the reply to “\(turns[index].text)”", turnLimit + 5) {
            check()
            return turns[index].done
        }
        let timeline = store.shell.probe.timeline
        if store.conversation.thread == thread, timeline?.thread == thread, !(timeline?.lastUser == turns[index].text && timeline?.replied == true) {
            record("no reply", "\(thread) finished “\(turns[index].text)” without an assistant reply under it on screen")
        }
    }

    func check() {
        resolve()
        drainDrawn()
        let probe = store.shell.probe.timeline
        for index in turns.indices where !turns[index].done {
            guard let thread = turns[index].thread else {
                if Date.now.timeIntervalSince(turns[index].sentAt) > turnLimit {
                    record("turn stuck", "“\(turns[index].text)” never showed up as a thread")
                    turns[index].done = true
                }
                continue
            }
            let busy = store.inbox.thread(thread)?.status == .working
            if busy, !turns[index].busy {
                turns[index].episodes += 1
                if turns[index].episodes == 2 {
                    record("turn restarted", "\(thread) went Working again after it had stopped, for the single send “\(turns[index].text)”")
                }
            }
            turns[index].busy = busy
            let replied = probe?.thread == thread && probe?.lastUser == turns[index].text && probe?.replied == true
            if !busy, turns[index].episodes > 0 || replied, store.conversation.info.map({ $0.thread != thread || !$0.busy }) ?? true {
                turns[index].done = true
            } else if Date.now.timeIntervalSince(turns[index].sentAt) > turnLimit {
                record("turn stuck", "\(thread) still Working \(Int(turnLimit)) s after “\(turns[index].text)”")
                turns[index].done = true
            }
        }
    }

    private func resolve() {
        let probe = store.shell.probe.timeline
        let pendings = store.conversation.pendings
        for index in turns.indices where !turns[index].done && turns[index].thread == nil {
            let text = turns[index].text
            if let start = pendings.first(where: { Self.sameTitle($0.info.title, text) || $0.draft == turns[index].draft }) {
                turns[index].draft = start.draft
                turns[index].thread = start.thread
            } else if let thread = store.conversation.thread, probe?.thread == thread, probe?.lastUser == text {
                turns[index].thread = thread
            } else if let row = store.inbox.threads.first(where: { row in Self.sameTitle(row.title, text) && !pendings.contains { $0.draft == row.id } }) {
                turns[index].thread = row.id
            }
        }
    }

    private func drainDrawn() {
        guard let drawn = store.shell.probe.drawn, !drawn.isEmpty else { return }
        store.shell.probe.drawn = []
        for event in drawn {
            guard let text = event.text, let seconds = Self.seconds(text),
                  let index = turns.lastIndex(where: { ($0.thread == event.thread || $0.draft == event.thread) && $0.sentAt <= event.at }),
                  !turns[index].done else { continue }
            if let highest = turns[index].highest[event.source], seconds < highest.seconds {
                let place = event.source == .workingRow ? "timeline working row" : "sidebar badge"
                record("working reset", "\(event.thread) \(place) showed “\(text)” after “\(highest.text)” during the single turn for “\(turns[index].text)”")
            }
            if seconds >= turns[index].highest[event.source]?.seconds ?? 0 {
                turns[index].highest[event.source] = (seconds, text)
            }
        }
    }

    var summary: String {
        let sent = turns.filter { $0.thread != nil }
        return "sends: \(turns.count) through the composer, \(sent.count) became threads, Working episodes per send max \(sent.map(\.episodes).max() ?? 0); "
            + "user message on screen after Return \(Self.latencies(turns))"
            + "; follow-ups in existing threads (\(turns.filter(\.followUp).count)) \(Self.latencies(turns.filter(\.followUp)))"
    }

    private static func latencies(_ turns: [Turn]) -> String {
        let bubbles = turns.compactMap(\.bubble).sorted()
        guard !bubbles.isEmpty else { return "none" }
        let p95 = bubbles[min(bubbles.count - 1, bubbles.count * 95 / 100)]
        return "p50 \(Int(bubbles[bubbles.count / 2] * 1000)) ms p95 \(Int(p95 * 1000)) ms max \(Int((bubbles.last ?? 0) * 1000)) ms"
    }

    nonisolated static func sameTitle(_ title: String, _ text: String) -> Bool {
        guard !title.isEmpty else { return false }
        if title == text { return true }
        let line = text.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? text
        if title == String(line.prefix(80)) { return true }
        return title.hasSuffix("…") && text.hasPrefix(String(title.dropLast()))
    }

    static func seconds(_ text: String) -> Int? {
        var total = 0
        var found = false
        for token in text.split(separator: " ") {
            guard let unit = token.last, let value = Int(token.dropLast()) else { continue }
            switch unit {
            case "h": total += value * 3600
            case "m": total += value * 60
            case "s": total += value
            default: continue
            }
            found = true
        }
        return found ? total : nil
    }

    private func press(_ spec: String, _ window: NSWindow) {
        guard let chord = KeyChord.parse(spec) else { return }
        KeyDriver.press(chord, in: window)
    }

    private func wait(_ seconds: TimeInterval, _ condition: () -> Bool) async throws -> Bool {
        let deadline = Date.now.addingTimeInterval(seconds)
        while !condition() {
            guard Date.now < deadline else { return false }
            try await Task.sleep(for: .milliseconds(20))
        }
        return true
    }
}
