import AppKit
import Foundation
import LocalStudioKit
import Observation
import UniformTypeIdentifiers

@MainActor
@Observable
final class ConversationStore {
    private(set) var thread: String?
    private(set) var info: ThreadInfo?
    private(set) var entries: [TimelineEntry] = []
    private(set) var rows: [TimelineRow] = []
    private(set) var approvals: [Approval] = []
    private(set) var queued: [QueuedMessage] = []
    private(set) var models: [ModelOption] = []
    private(set) var favorites: [ModelKey] = []
    private(set) var commands: [SlashCommand] = []
    private(set) var commandsLoaded = false
    private(set) var mentionRequest: String?
    private(set) var branchRequest: String?
    private(set) var endRequest = 0
    private(set) var focusRequest = 0
    private(set) var expandedFolds: Set<UInt64> = []
    var followsEnd = true
    let newThread = NewThreadOptions()

    @ObservationIgnored private let core: CoreHandle
    @ObservationIgnored private let requests: RequestCenter
    @ObservationIgnored private var draft: String?
    @ObservationIgnored private var drafts: [String: ComposerDraft] = [:]
    @ObservationIgnored private var commandsRequest: String?
    @ObservationIgnored private var sentPrompts: [String] = []

    init(core: CoreHandle, requests: RequestCenter) {
        self.core = core
        self.requests = requests
    }

    var items: [Item] {
        entries.map(\.item)
    }

    var busy: Bool {
        info?.busy == true
    }

    func focus(_ thread: String?) {
        guard thread != self.thread else { return }
        self.thread = thread
        info = nil
        entries = []
        rows = []
        approvals = []
        queued = []
        expandedFolds = []
        followsEnd = true
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
            entries = items.map(TimelineEntry.init)
            rebuildRows()
        case .insert(let index, let item):
            guard let position = Int(exactly: index), position <= entries.count else { return outOfSync }
            entries.insert(TimelineEntry(item: item), at: position)
            rebuildRows()
        case .update(let index, let item):
            guard let position = Int(exactly: index), position < entries.count else { return outOfSync }
            let entry = entries[position]
            let restructures = entry.id != item.id || entry.item.turn != item.turn || entry.item.kind.shape != item.kind.shape
            if restructures {
                entries[position] = TimelineEntry(item: item)
                rebuildRows()
            } else {
                entry.item = item
            }
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
        let draft = composer(key: thread)
        draft.text = text
        if thread == self.thread {
            focusRequest += 1
        }
    }

    func setModels(_ models: [ModelOption], favorites: [ModelKey]) {
        self.models = models
        self.favorites = favorites
    }

    func setCommands(request: String, commands: [SlashCommand]) {
        guard request == commandsRequest else { return }
        commandsRequest = nil
        self.commands = commands
        commandsLoaded = true
    }

    func loadModels() {
        core.run { $0.loadModels() }
    }

    func loadCommands(project: String?) {
        guard commandsRequest == nil else { return }
        let request = requests.issue { [weak self] _ in
            self?.commandsRequest = nil
        }
        commandsRequest = request
        core.run { $0.listCommands(request: request, project: project) }
    }

    func searchMentions(_ query: String, project: String) {
        let request = requests.issue()
        mentionRequest = request
        core.run { $0.searchFiles(request: request, project: project, query: query, limit: 12) }
    }

    func clearMentions() {
        mentionRequest = nil
    }

    func loadBranches(project: String, query: String) {
        let request = requests.issue()
        branchRequest = request
        core.run { $0.listBranches(request: request, project: project, query: query, limit: 60) }
    }

    func composer(project: String?) -> ComposerDraft {
        composer(key: thread ?? "project:\(project ?? "")")
    }

    func promptHistory() -> [String] {
        var history: [String] = []
        for entry in entries {
            if case .user(let text, _, _) = entry.item.kind, history.last != text {
                history.append(text)
            }
        }
        for prompt in sentPrompts where history.last != prompt {
            history.append(prompt)
        }
        return history
    }

    func send(_ text: String, project: String?, steer: Bool) {
        let draft = ComposerDraft()
        draft.text = text
        send(draft, project: project, steer: steer, settings: nil)
    }

    func submit(project: String?, steer: Bool, settings: Settings?) {
        let draft = composer(project: project)
        send(draft, project: project, steer: steer, settings: settings)
    }

    func abort() {
        guard let thread else { return }
        core.run { $0.abort(thread: thread) }
    }

    func sendNow(_ message: QueuedMessage) {
        guard let thread else { return }
        core.run { $0.sendQueuedNow(thread: thread, queued: message.id) }
    }

    func cancelQueued(_ message: QueuedMessage) {
        guard let thread else { return }
        core.run { $0.removeQueued(thread: thread, queued: message.id) }
        let draft = composer(key: thread)
        draft.text = draft.text.isEmpty ? message.text : draft.text + "\n" + message.text
        focusRequest += 1
    }

    func editFromHere(entry: String) {
        guard let thread else { return }
        core.run { $0.editFromHere(thread: thread, entry: entry) }
    }

    func compact() {
        guard let thread else { return }
        core.run { $0.compact(thread: thread) }
    }

    func selectModel(_ model: ModelOption) {
        guard let thread else {
            newThread.model = ModelKey(provider: model.provider, model: model.id)
            if let level = newThread.thinkingLevel, !model.thinkingLevels.contains(level) {
                newThread.thinkingLevel = nil
            }
            return
        }
        core.run { $0.setModel(thread: thread, provider: model.provider, model: model.id) }
    }

    func setThinkingLevel(_ level: String) {
        guard let thread else {
            newThread.thinkingLevel = level
            return
        }
        core.run { $0.setThinkingLevel(thread: thread, level: level) }
    }

    func setAccess(_ mode: AccessMode) {
        guard let thread else {
            newThread.access = mode
            return
        }
        core.run { $0.setAccessMode(thread: thread, mode: mode) }
    }

    func setFavorite(_ model: ModelOption, _ favorite: Bool) {
        core.run { $0.setFavoriteModel(provider: model.provider, model: model.id, favorite: favorite) }
    }

    func isFavorite(_ model: ModelOption) -> Bool {
        favorites.contains { $0.provider == model.provider && $0.model == model.id }
    }

    func answer(_ approval: Approval, _ answer: ApprovalAnswer) {
        guard let thread else { return }
        core.run { $0.answerApproval(thread: thread, request: approval.requestId, answer: answer) }
    }

    func toggleFold(_ summary: UInt64) {
        if expandedFolds.contains(summary) {
            expandedFolds.remove(summary)
        } else {
            expandedFolds.insert(summary)
        }
        rebuildRows()
    }

    func scrollToEnd() {
        followsEnd = true
        endRequest += 1
    }

    func currentModel(settings: Settings?) -> ModelOption? {
        if thread != nil {
            guard let model = info?.model else { return nil }
            return models.first { $0.provider == model.provider && $0.id == model.id }
                ?? ModelOption(
                    provider: model.provider, id: model.id, name: model.name ?? model.id, reasoning: model.reasoning,
                    thinkingLevels: info?.thinkingLevels ?? [], contextWindow: info?.context?.window ?? 0, configured: true
                )
        }
        let key = newThread.model ?? settings.flatMap { settings in
            settings.defaultProvider.flatMap { provider in settings.defaultModel.map { ModelKey(provider: provider, model: $0) } }
        }
        guard let key else { return models.first(where: \.configured) }
        return models.first { $0.provider == key.provider && $0.id == key.model }
    }

    func thinkingLevel(settings: Settings?) -> String? {
        if thread != nil {
            return info?.thinkingLevel
        }
        return newThread.thinkingLevel ?? settings?.defaultThinkingLevel
    }

    func thinkingLevels(settings: Settings?) -> [String] {
        if thread != nil {
            return info?.thinkingLevels ?? []
        }
        return currentModel(settings: settings)?.thinkingLevels ?? []
    }

    func access(settings: Settings?) -> AccessMode {
        if thread != nil {
            return info?.access ?? .supervised
        }
        return newThread.access ?? settings?.defaultAccess ?? .supervised
    }

    private func send(_ draft: ComposerDraft, project: String?, steer: Bool, settings: Settings?) {
        let text = draft.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !draft.images.isEmpty else { return }
        let prompt = PromptDraft(text: text, images: draft.images.map(\.attachment), files: draft.files)
        if !text.isEmpty {
            sentPrompts.append(text)
        }
        draft.clear()
        followsEnd = true
        endRequest += 1
        guard let thread else {
            let id = UUID().uuidString
            self.draft = id
            let model = currentModel(settings: settings)
            let options = ThreadSettings(
                provider: model?.provider,
                model: model?.id,
                thinkingLevel: thinkingLevel(settings: settings),
                access: access(settings: settings),
                worktree: newThread.worktreeChoice
            )
            core.run { $0.startThread(draft: id, project: project, prompt: prompt, settings: options) }
            return
        }
        core.run { $0.send(thread: thread, prompt: prompt, delivery: steer && busy ? .steer : .queue) }
    }

    private func composer(key: String) -> ComposerDraft {
        if let draft = drafts[key] {
            return draft
        }
        let draft = ComposerDraft()
        drafts[key] = draft
        return draft
    }

    private func rebuildRows() {
        rows = TimelineLayout.rows(for: entries, expanded: expandedFolds)
    }

    private var outOfSync: String {
        "The transcript went out of sync; reopen the thread."
    }
}

@MainActor
@Observable
final class TimelineEntry: Identifiable {
    let id: UInt64
    fileprivate(set) var item: Item

    init(item: Item) {
        id = item.id
        self.item = item
    }
}

enum TimelineRow: Identifiable {
    case entry(TimelineEntry, hidesThinking: Bool)
    case tools([TimelineEntry])
    case fold(TimelineEntry, expanded: Bool)

    var id: UInt64 {
        switch self {
        case .entry(let entry, _): entry.id
        case .tools(let entries): entries.first?.id ?? 0
        case .fold(let entry, _): entry.id
        }
    }
}

enum TimelineLayout {
    @MainActor
    static func rows(for entries: [TimelineEntry], expanded: Set<UInt64>) -> [TimelineRow] {
        var hidden = Set<Int>()
        var hidesThinking = Set<Int>()
        var folds: [Int: Int] = [:]
        for (index, entry) in entries.enumerated() {
            guard case .turnSummary = entry.item.kind else { continue }
            let turn = entry.item.turn
            var members: [Int] = []
            var cursor = index - 1
            while cursor >= 0, entries[cursor].item.turn == turn {
                switch entries[cursor].item.kind {
                case .user, .turnSummary: cursor = -1
                case .assistant, .tool: members.append(cursor)
                case .notice, .compaction: break
                }
                cursor -= 1
            }
            var answer = entries[(index + 1)...].firstIndex { candidate in
                guard candidate.item.turn == turn, case .assistant = candidate.item.kind else { return false }
                return true
            }
            if answer == nil, let last = members.first(where: { entries[$0].item.kind.shape == ItemKind.assistantShape }) {
                answer = last
                members.removeAll { $0 == last }
            }
            guard let anchor = members.last else { continue }
            folds[anchor] = index
            guard !expanded.contains(entry.id) else { continue }
            hidden.formUnion(members)
            if let answer {
                hidesThinking.insert(answer)
            }
        }
        var rows: [TimelineRow] = []
        var group: [TimelineEntry] = []
        func flush() {
            if !group.isEmpty {
                rows.append(.tools(group))
                group = []
            }
        }
        for (index, entry) in entries.enumerated() {
            if let summary = folds[index] {
                flush()
                rows.append(.fold(entries[summary], expanded: expanded.contains(entries[summary].id)))
            }
            guard !hidden.contains(index) else { continue }
            switch entry.item.kind {
            case .turnSummary:
                continue
            case .tool:
                group.append(entry)
            case .user, .assistant, .notice, .compaction:
                flush()
                rows.append(.entry(entry, hidesThinking: hidesThinking.contains(index)))
            }
        }
        flush()
        return rows
    }
}

extension ItemKind {
    static let assistantShape = 1

    var shape: Int {
        switch self {
        case .user: 0
        case .assistant: 1
        case .tool: 2
        case .turnSummary: 3
        case .notice: 4
        case .compaction: 5
        }
    }
}

@MainActor
@Observable
final class NewThreadOptions {
    var model: ModelKey?
    var thinkingLevel: String?
    var access: AccessMode?
    var worktree = false
    var branch = ""
    var base: String?

    var worktreeChoice: WorktreeChoice {
        let name = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard worktree else { return .local }
        return .newWorktree(branch: name.isEmpty ? Self.generatedBranch() : name, base: base)
    }

    static func generatedBranch() -> String {
        "local-studio/" + UUID().uuidString.prefix(8).lowercased()
    }
}

@MainActor
@Observable
final class ComposerDraft {
    var text = ""
    var images: [ComposerImage] = []
    var files: [String] = []

    var isEmpty: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && images.isEmpty
    }

    func clear() {
        text = ""
        images = []
        files = []
    }

    func attach(image data: Data, mimeType: String) {
        images.append(ComposerImage(attachment: ImageAttachment(mimeType: mimeType, data: data), thumbnail: NSImage(data: data)))
    }

    func attach(urls: [URL], project: String?) {
        for url in urls {
            let type = UTType(filenameExtension: url.pathExtension)
            if let type, type.conforms(to: .image), let data = try? Data(contentsOf: url) {
                attach(image: data, mimeType: type.preferredMIMEType ?? "image/png")
                continue
            }
            let path = url.standardizedFileURL.path
            let relative = project.flatMap { root in
                path.hasPrefix(root + "/") ? String(path.dropFirst(root.count + 1)) : nil
            }
            let file = relative ?? path
            if !files.contains(file) {
                files.append(file)
            }
        }
    }
}

struct ComposerImage: Identifiable {
    let id = UUID()
    let attachment: ImageAttachment
    let thumbnail: NSImage?
}
