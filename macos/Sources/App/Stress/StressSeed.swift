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

    static let realSendLimit = 36
    static let plans = [Plan(project: "alpha", turns: 3), Plan(project: "beta", turns: 2), Plan(project: "gamma", turns: 2), Plan(project: "alpha", turns: 2)]

    static var seedSends: Int {
        plans.reduce(0) { $0 + $1.turns }
    }

    private static let realPrompts = [
        "List the source files here, pick the largest one, read it and summarize its structure in five bullets",
        "Now propose one concrete refactor of that file that would make it simpler, as a short unified diff (do not apply it)",
        "Which other files would that change touch? Grep for the names involved and list each call site with one line on why",
        "Read the two files that look most central to this project and explain how they interact, citing function names",
        "Grep for TODO, FIXME or unwrap-like shortcuts here and summarize the three most worrying ones with file and line",
        "Pick one public type here, read its definition and every place it is used, then describe its lifecycle step by step",
        "Write a short design note (under 200 words) for making the slowest-looking code path here faster, with a code sketch",
        "Count the lines of each source file with a shell command and comment on which files are too large and how to split one",
    ]

    static func realPrompt(_ index: Int) -> String {
        "\(realPrompts[index % realPrompts.count]) (\(index + 1))"
    }

    private static var activity: NSObjectProtocol?

    static func prepareProcess() {
        setvbuf(stdout, nil, _IOLBF, 0)
        UserDefaults.standard.register(defaults: ["NSApplicationCrashOnExceptions": true])
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical], reason: "Local Studio stress harness")
    }

    typealias Sender = (_ text: String, _ project: String, _ thread: String?) async throws -> String

    mutating func run(send: Sender? = nil) async throws {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        var projects: [String: String] = [:]
        for name in ["alpha", "beta", "gamma"] {
            let path = (home as NSString).appendingPathComponent("stress/\(name)")
            try? FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: (path as NSString).appendingPathComponent("README.md")) {
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
        guard store.conversation.models.contains(where: { $0.provider == "anthropic" && $0.id == "claude-haiku-5-5" && $0.configured }) else {
            throw StressFailure("anthropic/claude-haiku-5-5 is not configured")
        }
        store.conversation.newThread.model = ModelKey(provider: "anthropic", model: "claude-haiku-5-5")
        store.conversation.newThread.thinkingLevel = "low"
        var sent = 0
        for (index, plan) in Self.plans.enumerated() {
            guard let project = projects[plan.project] else { throw StressFailure("project \(plan.project) missing") }
            store.newThread(in: project)
            let conversation = store.conversation
            conversation.newThread.access = .fullAccess
            let prompt = Self.realPrompt(sent)
            sent += 1
            let thread = try await deliver(prompt, project, nil, send)
            prompts[thread] = prompt
            for _ in 1..<plan.turns {
                let text = Self.realPrompt(sent)
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
        try await until(label, 120) {
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
