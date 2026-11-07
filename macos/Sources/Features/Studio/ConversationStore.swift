import Foundation
import LocalStudioKit
import Observation

@MainActor
@Observable
final class ConversationStore {
    private(set) var thread: String?
    private(set) var info: ThreadInfo?
    private(set) var items: [Item] = []
    private(set) var approvals: [Approval] = []
    private(set) var queued: [QueuedMessage] = []
    private(set) var composerText: String?
    private(set) var models: [ModelOption] = []
    private(set) var favorites: [ModelKey] = []
    private(set) var commands: [SlashCommand] = []

    @ObservationIgnored private let core: CoreHandle
    @ObservationIgnored private let requests: RequestCenter
    @ObservationIgnored private var draft: String?

    init(core: CoreHandle, requests: RequestCenter) {
        self.core = core
        self.requests = requests
    }

    func focus(_ thread: String?) {
        guard thread != self.thread else { return }
        self.thread = thread
        info = nil
        items = []
        approvals = []
        queued = []
        composerText = nil
    }

    func threadStarted(draft: String, thread: String) -> Bool {
        guard draft == self.draft else { return false }
        self.draft = nil
        return true
    }

    func setInfo(thread: String, info: ThreadInfo) {
        guard thread == self.thread else { return }
        self.info = info
    }

    func apply(thread: String, op: TranscriptOp) -> String? {
        guard thread == self.thread else { return nil }
        switch op {
        case .reset(let items):
            self.items = items
        case .insert(let index, let item):
            guard let position = Int(exactly: index), position <= items.count else { return outOfSync }
            items.insert(item, at: position)
        case .update(let index, let item):
            guard let position = Int(exactly: index), position < items.count else { return outOfSync }
            items[position] = item
        }
        return nil
    }

    func setApprovals(thread: String, approvals: [Approval]) {
        guard thread == self.thread else { return }
        self.approvals = approvals
    }

    func setQueue(thread: String, queued: [QueuedMessage]) {
        guard thread == self.thread else { return }
        self.queued = queued
    }

    func setComposerText(thread: String, text: String) {
        guard thread == self.thread else { return }
        composerText = text
    }

    func consumeComposerText() -> String? {
        defer { composerText = nil }
        return composerText
    }

    func setModels(_ models: [ModelOption], favorites: [ModelKey]) {
        self.models = models
        self.favorites = favorites
    }

    func setCommands(request: String, commands: [SlashCommand]) {
        self.commands = commands
    }

    func loadModels() {
        core.run { $0.loadModels() }
    }

    func send(_ text: String, project: String?, steer: Bool) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let prompt = PromptDraft(text: trimmed, images: [], files: [])
        guard let thread else {
            let draft = UUID().uuidString
            self.draft = draft
            let settings = ThreadSettings(provider: nil, model: nil, thinkingLevel: nil, access: .fullAccess, worktree: .local)
            core.run { $0.startThread(draft: draft, project: project, prompt: prompt, settings: settings) }
            return
        }
        core.run { $0.send(thread: thread, prompt: prompt, delivery: steer ? .steer : .queue) }
    }

    func abort() {
        guard let thread else { return }
        core.run { $0.abort(thread: thread) }
    }

    func setModel(_ model: ModelOption) {
        guard let thread else { return }
        core.run { $0.setModel(thread: thread, provider: model.provider, model: model.id) }
    }

    func setThinkingLevel(_ level: String) {
        guard let thread else { return }
        core.run { $0.setThinkingLevel(thread: thread, level: level) }
    }

    func answer(_ approval: Approval, _ answer: ApprovalAnswer) {
        guard let thread else { return }
        core.run { $0.answerApproval(thread: thread, request: approval.requestId, answer: answer) }
    }

    private var outOfSync: String {
        "The transcript went out of sync; reopen the thread."
    }
}
