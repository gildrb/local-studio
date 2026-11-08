import AppKit
import Foundation
import LocalStudioKit

struct StressFailure: Error, CustomStringConvertible {
    let description: String

    init(_ description: String) {
        self.description = description
    }
}

@MainActor
struct StressSeed {
    struct Plan {
        let project: String
        let turns: Int
    }

    let store: StudioStore
    private(set) var prompts: [String: String] = [:]

    static let realModel = ProcessInfo.processInfo.environment["STRESS_MODEL"] == "haiku"
    static let realSendLimit = 20

    static var plans: [Plan] {
        guard realModel else { return fauxPlans }
        return [Plan(project: "alpha", turns: 2), Plan(project: "beta", turns: 1), Plan(project: "gamma", turns: 1), Plan(project: "alpha", turns: 1)]
    }

    static var seedSends: Int {
        plans.reduce(0) { $0 + $1.turns }
    }

    private static let fauxPlans: [Plan] = [
        Plan(project: "alpha", turns: 6), Plan(project: "beta", turns: 2), Plan(project: "gamma", turns: 1),
        Plan(project: "alpha", turns: 4), Plan(project: "beta", turns: 1), Plan(project: "gamma", turns: 3),
        Plan(project: "alpha", turns: 1), Plan(project: "beta", turns: 5), Plan(project: "gamma", turns: 2),
    ]

    private static let realPrompts = [
        "Run ls here, then summarize in one line",
        "Say hello in three words",
        "Read README.md and quote its first line",
        "What is 7 times 6? One line",
        "Count the files here with a shell command",
    ]

    static func realPrompt(_ index: Int) -> String {
        "\(realPrompts[index % realPrompts.count]) (\(index + 1))"
    }

    private static var activity: NSObjectProtocol?

    static func prepareProcess() {
        setvbuf(stdout, nil, _IOLBF, 0)
        UserDefaults.standard.register(defaults: ["NSApplicationCrashOnExceptions": true])
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical], reason: "Local Studio stress harness")
        if !realModel {
            installScript()
        }
    }

    private static func installScript() {
        let base = ProcessInfo.processInfo.environment["LOCAL_STUDIO_DATA_DIR"] ?? NSTemporaryDirectory()
        let url = URL(fileURLWithPath: base).appendingPathComponent("stress-script.json")
        var responses: [Any] = []
        for step in 0..<80 {
            responses.append([
                "content": [
                    ["type": "thinking", "thinking": "Checking the workspace before step \(step)."],
                    ["type": "text", "text": "Let me look at the files first."],
                    ["type": "toolCall", "name": "bash", "arguments": ["i": "list files", "script": "echo stress-\(step)"], "id": "call-\(step)"],
                ],
            ])
            responses.append(answer(step))
        }
        let script: [String: Any] = ["modelId": "faux-1", "repeatLastResponse": true, "responses": responses]
        guard let data = try? JSONSerialization.data(withJSONObject: script) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url)
        setenv("EUKHE_FAUX_SCRIPT", url.path, 1)
    }

    private static func answer(_ step: Int) -> String {
        let body = (1...28).map { "    let value\($0) = compute(\($0), step: \(step)) * \($0 % 7 + 1)" }.joined(separator: "\n")
        let prose = (1...4).map { paragraph in
            "Paragraph \(paragraph) of step \(step): the change keeps the state machine small, moves the expensive work off the main thread, and leaves the public surface untouched so callers keep compiling."
        }.joined(separator: "\n\n")
        return """
        Here is the change for step \(step).

        ```swift
        func step\(step)() -> Int {
        \(body)
            return value1 + value2
        }
        ```

        \(prose)

        - first, run the formatter
        - then, rerun the suite
        - finally, commit

        ```sh
        cargo test -p core --quiet
        swift build
        ```
        """
    }

    typealias Sender = (_ text: String, _ project: String, _ thread: String?) async throws -> String

    mutating func run(send: Sender? = nil) async throws {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        var projects: [String: String] = [:]
        for name in ["alpha", "beta", "gamma"] {
            let path = (home as NSString).appendingPathComponent("stress/\(name)")
            try? FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
            if Self.realModel {
                try? "# \(name)\n\nScratch project for the Local Studio stress harness.\n".write(toFile: (path as NSString).appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
            }
            if name == "alpha" {
                Self.git(["init", "-q"], in: path)
                Self.git(["-c", "user.name=Stress", "-c", "user.email=stress@local", "commit", "-q", "--allow-empty", "-m", "init"], in: path)
            }
            store.inbox.addProject(path: path)
            let canonical = Self.canonical(path)
            try await until("project \(name)", 20) {
                store.inbox.projects.contains { Self.canonical($0.path) == canonical }
            }
            projects[name] = store.inbox.projects.first { Self.canonical($0.path) == canonical }?.id
        }
        store.conversation.loadModels()
        try await until("models", 20) { store.conversation.modelsLoaded }
        if Self.realModel {
            guard store.conversation.models.contains(where: { $0.provider == "anthropic" && $0.id == "claude-haiku-5-5" && $0.configured }) else {
                throw StressFailure("anthropic/claude-haiku-5-5 is not configured")
            }
            store.conversation.newThread.model = ModelKey(provider: "anthropic", model: "claude-haiku-5-5")
            store.conversation.newThread.thinkingLevel = "low"
        }
        var sent = 0
        for (index, plan) in Self.plans.enumerated() {
            guard let project = projects[plan.project] else { throw StressFailure("project \(plan.project) missing") }
            store.newThread(in: project)
            let conversation = store.conversation
            conversation.newThread.access = .fullAccess
            let prompt = Self.realModel ? Self.realPrompt(sent) : "Stress \(index + 1): plan the \(plan.project) refactor, part \(index + 1)"
            sent += 1
            let thread = try await deliver(prompt, project, nil, send)
            prompts[thread] = prompt
            for turn in 1..<plan.turns {
                let text = Self.realModel ? Self.realPrompt(sent) : "Continue with part \(index + 1).\(turn + 1)"
                sent += 1
                _ = try await deliver(text, project, thread, send)
            }
            print("seed thread \(index + 1)/\(Self.plans.count) \(thread) in \(plan.project): \(conversation.rows.count) rows")
        }
    }

    private func deliver(_ text: String, _ project: String, _ thread: String?, _ send: Sender?) async throws -> String {
        if let send {
            return try await send(text, project, thread)
        }
        return try await apiSend(text, project: project, thread: thread)
    }

    private func apiSend(_ text: String, project: String, thread: String?) async throws -> String {
        let conversation = store.conversation
        if thread == nil {
            let known = Set(store.inbox.threads.map(\.id))
            conversation.composer(project: project).text = text
            conversation.submit(project: project, alternate: false, settings: store.pages.settings)
            try await until("a thread for “\(text)”", 30) {
                guard let thread = conversation.thread, !known.contains(thread) else { return false }
                return true
            }
        } else {
            conversation.send(text, project: project, steer: false)
        }
        guard let id = conversation.thread else { throw StressFailure("“\(text)” has no thread") }
        try await idle(id, text, "the reply to “\(text)”")
        return id
    }

    private func idle(_ thread: String, _ text: String, _ label: String) async throws {
        let conversation = store.conversation
        try await until(label, Self.realModel ? 120 : 60) {
            guard conversation.thread == thread, let info = conversation.info, info.thread == thread, !info.busy,
                  conversation.queued.isEmpty, let last = conversation.items.last,
                  case .assistant(_, false, _, _) = last.kind,
                  conversation.items.contains(where: { if case .user(text, _, _, _) = $0.kind { true } else { false } }) else { return false }
            return true
        }
    }

    private static func git(_ arguments: [String], in path: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = arguments
        process.currentDirectoryURL = URL(fileURLWithPath: path)
        guard (try? process.run()) != nil else { return }
        process.waitUntilExit()
    }

    private static func canonical(_ path: String) -> String {
        URL(fileURLWithPath: path).resolvingSymlinksInPath().path
    }
}

@MainActor
func until(_ label: String, _ timeout: TimeInterval, _ condition: () -> Bool) async throws {
    let deadline = Date.now.addingTimeInterval(timeout)
    while !condition() {
        guard Date.now < deadline else { throw StressFailure("timed out waiting for \(label)") }
        try await Task.sleep(for: .milliseconds(20))
    }
}

@MainActor
func launchedMainWindow(_ store: StudioStore) async throws -> NSWindow {
    do {
        try await until("the main window to appear at launch", 20) { visibleMainWindow(store) != nil }
    } catch {
        let windows = NSApp.windows.map { "\($0.identifier?.rawValue ?? "-") “\($0.title)” visible=\($0.isVisible) \(Int($0.frame.width))×\(Int($0.frame.height))" }
        throw StressFailure("no main window at launch (active=\(NSApp.isActive), windows: \(windows.joined(separator: "; ")))")
    }
    guard let window = visibleMainWindow(store) else { throw StressFailure("no main window at launch") }
    window.orderFront(nil)
    return window
}

@MainActor
func skipOnboarding(_ store: StudioStore, _ window: NSWindow) async throws {
    try await until("settings and projects", 20) { store.pages.settings != nil && store.inbox.receivedProjects }
    try await until("the onboarding sheet or none", 3) { window.attachedSheet != nil || !store.needsOnboarding }
    guard store.needsOnboarding else { return }
    store.completeOnboarding()
    try await until("Skip Setup to close the onboarding sheet", 2) { window.attachedSheet == nil }
}

@MainActor
func reopenMainWindow(_ store: StudioStore) async throws -> NSWindow {
    if visibleMainWindow(store) == nil {
        let reopen = NSAppleEventDescriptor(
            eventClass: AEEventClass(kCoreEventClass), eventID: AEEventID(kAEReopenApplication),
            targetDescriptor: NSAppleEventDescriptor(processIdentifier: ProcessInfo.processInfo.processIdentifier),
            returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID)
        )
        _ = try? reopen.sendEvent(options: [.noReply], timeout: 2)
    }
    try await until("the main window to reopen", 20) { visibleMainWindow(store) != nil }
    guard let window = visibleMainWindow(store) else { throw StressFailure("no main window after reopen") }
    window.orderFront(nil)
    return window
}

@MainActor
private func visibleMainWindow(_ store: StudioStore) -> NSWindow? {
    store.mainWindow.flatMap { $0.isVisible ? $0 : nil }
}
