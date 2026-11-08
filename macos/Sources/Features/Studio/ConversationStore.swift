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
    private(set) var anchors: [TimelineAnchor] = []
    private(set) var approvals: [Approval] = []
    private(set) var queued: [QueuedMessage] = []
    private(set) var models: [ModelOption] = []
    private(set) var favorites: [ModelKey] = []
    private(set) var hiddenModels: [ModelKey] = []
    private(set) var modelsLoaded = false
    private(set) var commands: [SlashCommand] = []
    private(set) var commandsLoaded = false
    private(set) var mentionRequest: String?
    private(set) var branchRequest: String?
    private(set) var endRequest = 0
    private(set) var focusRequest = 0
    private(set) var expandedFolds: Set<UInt64> = []
    var modelPickerPresented = false
    var followsEnd = true
    let newThread = NewThreadOptions()
    let stash = ComposerStash()
    private(set) var pullsRequest: String?
    @ObservationIgnored private(set) var pullsProject: String?
    private(set) var pullsError: String?
    @ObservationIgnored var draftProject: String?

    @ObservationIgnored private let core: CoreHandle
    @ObservationIgnored private let requests: RequestCenter
    @ObservationIgnored private var drafts: [String: ComposerDraft] = [:]
    @ObservationIgnored private(set) var commandsRequest: String?
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

    private(set) var worktreeSetup: [String: (stages: [SetupStage], done: Bool, error: String?)] = [:]
    private(set) var pendings: [PendingStart] = []
    private(set) var focusedPending: String?
    @ObservationIgnored var pendingsChanged: (() -> Void)?
    @ObservationIgnored private(set) var aliases: [String: String] = [:]

    var pending: PendingStart? {
        focusedPending.flatMap(pendingStart)
    }

    var pendingDraft: String? {
        focusedPending
    }

    var showsThread: Bool {
        thread != nil || focusedPending != nil
    }

    var selectedID: String? {
        thread ?? focusedPending
    }

    func pendingStart(_ draft: String) -> PendingStart? {
        pendings.first { $0.draft == draft }
    }

    func resolve(_ id: String) -> String {
        guard pendingStart(id) == nil else { return id }
        return aliases.first { $0.value == id }?.key ?? id
    }

    func setWorktreeSetup(thread: String, stages: [SetupStage], done: Bool, error: String?) {
        worktreeSetup[thread] = (stages, done, error)
    }

    func cancelWorktreeSetup() {
        guard let pending else { return }
        core.run { $0.cancelWorktreeSetup(thread: pending.draft) }
        editPending(pending.draft)
    }

    func skipWorktreeSetup() {
        guard let pending else { return }
        core.run { $0.skipWorktreeSetup(thread: pending.draft) }
    }

    func showPending(_ draft: String) {
        guard let start = pendingStart(draft), focusedPending != draft || thread != nil else { return }
        park()
        thread = nil
        entries = start.entries
        rebuildRows()
        info = start.info
        approvals = []
        queued = start.queued
        expandedFolds = []
        followsEnd = true
        scrollTop = nil
        focusedPending = draft
        keepTimeline(draft)
    }

    func startFailed(draft: String, message: String) {
        guard let index = pendings.firstIndex(where: { $0.draft == draft }), pendings[index].thread == nil else { return }
        pendings[index].failure = message
        pendings[index].info.busy = false
        if focusedPending == draft {
            info = pendings[index].info
        }
        pendingsChanged?()
    }

    func retryPending(_ draft: String) {
        guard let index = pendings.firstIndex(where: { $0.draft == draft }), pendings[index].failure != nil else { return }
        pendings[index].failure = nil
        pendings[index].info.busy = true
        pendings[index].info.runStartedAt = Int64(Date.now.timeIntervalSince1970 * 1000)
        let start = pendings[index]
        if focusedPending == draft {
            info = start.info
        }
        pendingsChanged?()
        launch(start)
    }

    func editPending(_ draft: String) {
        guard let start = pendingStart(draft), start.thread == nil else { return }
        pendings.removeAll { $0.draft == draft }
        let composer = composer(key: Self.draftKey(start.project))
        if composer.isEmpty {
            composer.text = start.prompt.text
            composer.files = start.prompt.files
            composer.contexts = start.prompt.contexts
        }
        if focusedPending == draft {
            focusedPending = nil
            entries = []
            rows = []
            anchors = []
            info = nil
            queued = []
            focusRequest += 1
        }
        pendingsChanged?()
    }

    func settlePendings(listed: (String) -> Bool) {
        let settled = pendings.filter { start in start.thread.map(listed) ?? false }
        guard !settled.isEmpty else { return }
        for start in settled {
            if let thread = start.thread {
                aliases[thread] = start.draft
            }
        }
        pendings.removeAll { start in start.thread.map(listed) ?? false }
        pendingsChanged?()
    }

    func pendingRows(now: Date = .now) -> [ThreadRow] {
        pendings.map { start in
            let at = Int64(start.at.timeIntervalSince1970 * 1000)
            return ThreadRow(
                id: start.draft, project: start.project, title: start.info.title, shelf: .active,
                status: start.failure == nil ? .working : .failed, statusSince: at, updatedAt: at, snoozedUntil: nil,
                pinned: false, unread: false, branch: nil, worktree: nil, provider: start.info.model?.provider,
                model: start.info.model?.id, additions: 0, deletions: 0, note: start.failure, archived: false,
                autoSettle: true, liveAgents: 0, fanOut: nil, pullRequest: nil
            )
        }
    }

    private(set) var skills: [SkillEntry] = []
    private(set) var skillsLoaded = false
    private(set) var messageImages: [String: (mimeType: String, data: Data)] = [:]
    private(set) var messageImageErrors: [String: String] = [:]
    var gallery: ImageGallery?
    @ObservationIgnored private(set) var skillsRequest: String?
    @ObservationIgnored private var skillsProject: String??
    @ObservationIgnored private var pendingServiceTier: [String: String] = [:]

    func setSkills(request: String, skills: [SkillEntry]) {
        guard request == skillsRequest else { return }
        skillsRequest = nil
        self.skills = skills
        skillsLoaded = true
    }

    func loadSkills(project: String?) {
        guard skillsRequest == nil, skillsProject != .some(project) || !skillsLoaded else { return }
        let request = requests.issue { [weak self] _ in
            self?.skillsRequest = nil
            self?.skillsLoaded = true
        }
        skillsRequest = request
        skillsProject = .some(project)
        core.run { $0.listSkills(request: request, project: project) }
    }

    func setMessageImage(request: String, mimeType: String, data: Data) {
        messageImages[request] = (mimeType, data)
    }

    func loadMessageImage(entry: String, index: Int) -> String? {
        guard let thread else { return nil }
        var request = ""
        request = requests.issue { [weak self] outcome in
            if case .failed(let message) = outcome {
                self?.messageImageErrors[request] = message
            }
        }
        let id = request
        core.run { $0.loadMessageImage(request: id, thread: thread, entry: entry, index: UInt32(index)) }
        return id
    }

    func openGallery(entry: String, thumbnails: [ImageThumbnail], index: Int) {
        gallery = ImageGallery(entry: entry, thumbnails: thumbnails, index: index)
    }

    func serviceTiers(settings: Settings?) -> [String] {
        if thread != nil {
            return info?.serviceTiers ?? []
        }
        return currentModel(settings: settings)?.serviceTiers ?? []
    }

    func serviceTier(settings: Settings?) -> String? {
        if thread != nil {
            return info?.serviceTier
        }
        guard let tier = newThread.serviceTier, serviceTiers(settings: settings).contains(tier) else { return nil }
        return tier
    }

    func setServiceTier(_ tier: String?) {
        guard let thread else {
            newThread.serviceTier = tier
            return
        }
        core.run { $0.setServiceTier(thread: thread, tier: tier) }
    }

    @ObservationIgnored private var infoCache: [String: ThreadInfo] = [:]
    @ObservationIgnored private var transcripts: [String: CachedTranscript] = [:]
    @ObservationIgnored private var recency: [String] = []
    @ObservationIgnored private var timelineUse: [String] = []
    @ObservationIgnored private var awaitingReset = false
    @ObservationIgnored private var seeded: Set<String> = []
    @ObservationIgnored var scrollTop: UInt64?
    private(set) var timelines: [String] = []
    private(set) var loading = false

    var showsLoading: Bool {
        rows.isEmpty && (info == nil || (loading && thread != nil))
    }

    static let cachedThreads = 12
    static let liveTimelines = 10

    func focus(_ thread: String?, row: ThreadRow? = nil) {
        guard thread != self.thread || focusedPending != nil else { return }
        park()
        focusedPending = nil
        self.thread = thread
        let cached = thread.flatMap { transcripts[$0] }
        info = thread.flatMap { infoCache[$0] }.map { Self.reconciled($0, row: row) }
        entries = cached?.entries ?? []
        rows = cached?.rows ?? []
        if anchors != cached?.anchors ?? [] {
            anchors = cached?.anchors ?? []
        }
        approvals = cached?.approvals ?? []
        queued = cached?.queued ?? []
        expandedFolds = cached?.expandedFolds ?? []
        followsEnd = cached?.scroll.followsEnd ?? true
        scrollTop = cached?.scroll.top
        awaitingReset = cached != nil
        let loading = thread != nil && cached == nil
        if self.loading != loading {
            self.loading = loading
        }
        keepTimeline(thread)
    }

    func cachedRows(_ thread: String) -> [TimelineRow] {
        transcripts[thread]?.rows ?? []
    }

    private func keepTimeline(_ id: String?) {
        guard let id else { return }
        timelineUse.removeAll { $0 == id }
        timelineUse.insert(id, at: 0)
        timelineUse = Array(timelineUse.prefix(Self.liveTimelines))
        var next = timelines.filter(timelineUse.contains)
        if !next.contains(id) {
            next.append(id)
        }
        if next != timelines {
            timelines = next
        }
    }

    var restoredScroll: ThreadScroll {
        ThreadScroll(followsEnd: followsEnd, top: scrollTop)
    }

    private func park() {
        guard let thread, !entries.isEmpty else { return }
        transcripts[thread] = CachedTranscript(
            entries: entries, rows: rows, anchors: anchors, expandedFolds: expandedFolds, approvals: approvals, queued: queued,
            scroll: ThreadScroll(followsEnd: followsEnd, top: scrollTop)
        )
        recency.removeAll { $0 == thread }
        recency.insert(thread, at: 0)
        while recency.count > Self.cachedThreads {
            transcripts[recency.removeLast()] = nil
        }
    }

    private static func reconciled(_ info: ThreadInfo, row: ThreadRow?) -> ThreadInfo {
        guard let row else { return info }
        var info = info
        info.busy = row.status == .working || row.status == .approval
        if !row.title.isEmpty {
            info.title = row.title
        }
        return info
    }

    func threadStarted(draft: String, thread: String) -> Bool {
        if let tier = pendingServiceTier.removeValue(forKey: draft) {
            core.run { $0.setServiceTier(thread: thread, tier: tier) }
        }
        requests.settle(draft)
        guard let index = pendings.firstIndex(where: { $0.draft == draft }) else { return false }
        pendings[index].thread = thread
        pendings[index].failure = nil
        let start = pendings[index]
        pendings[index].queued = []
        var info = start.info
        info.thread = thread
        info.busy = true
        infoCache[thread] = info
        seeded.insert(thread)
        transcripts[thread] = CachedTranscript(
            entries: start.entries, rows: TimelineLayout.rows(for: start.entries, expanded: []), anchors: [], expandedFolds: [],
            approvals: [], queued: start.queued, scroll: ThreadScroll()
        )
        recency.removeAll { $0 == thread }
        recency.insert(thread, at: 0)
        if let composer = drafts.removeValue(forKey: draft), drafts[thread] == nil {
            drafts[thread] = composer
        }
        for message in start.queued {
            let prompt = PromptDraft(text: message.text, images: [], files: [])
            core.run { $0.send(thread: thread, prompt: prompt, delivery: .queue) }
        }
        pendingsChanged?()
        return focusedPending == draft
    }

    func setInfo(thread: String, info: ThreadInfo) {
        let info = Self.continued(info, previous: infoCache[thread])
        infoCache[thread] = info
        guard thread == self.thread, self.info != info else { return }
        self.info = info
    }

    private static let startSkew: Int64 = 2_000

    private static func continued(_ info: ThreadInfo, previous: ThreadInfo?) -> ThreadInfo {
        guard info.busy, let previous, previous.busy, let earlier = previous.runStartedAt, let start = info.runStartedAt,
              start > earlier, start - earlier < startSkew else { return info }
        var info = info
        info.runStartedAt = earlier
        return info
    }

    func apply(thread: String, op: TranscriptOp) -> String? {
        guard thread == self.thread else { return nil }
        if loading {
            loading = false
        }
        switch op {
        case .reset(let items):
            awaitingReset = false
            if items.isEmpty, seeded.contains(thread) { return nil }
            seeded.remove(thread)
            reconcile(items)
        case .insert(let index, let item):
            guard !awaitingReset else { return nil }
            dropSeed(thread)
            guard let position = Int(exactly: index), position <= entries.count else { return outOfSync }
            entries.insert(TimelineEntry(item: item), at: position)
            rebuildRows()
        case .update(let index, let item):
            guard !awaitingReset else { return nil }
            dropSeed(thread)
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

    private func dropSeed(_ thread: String) {
        guard seeded.remove(thread) != nil else { return }
        entries = []
    }

    private func reconcile(_ items: [Item]) {
        let existing = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let next = items.map { item -> TimelineEntry in
            guard let entry = existing[item.id] else { return TimelineEntry(item: item) }
            if entry.item != item {
                entry.item = item
            }
            return entry
        }
        if !next.elementsEqual(entries, by: ===) {
            entries = next
        }
        rebuildRows()
    }

    func setApprovals(thread: String, approvals: [Approval]) {
        guard thread == self.thread, self.approvals != approvals else { return }
        self.approvals = approvals
    }

    func setQueue(thread: String, queued: [QueuedMessage]) {
        guard thread == self.thread, self.queued != queued else { return }
        self.queued = queued
    }

    func setComposerText(thread: String, text: String) {
        let draft = composer(key: thread)
        draft.text = text
        if thread == self.thread {
            focusRequest += 1
        }
    }

    func setModels(_ models: [ModelOption], favorites: [ModelKey], hidden: [ModelKey]) {
        self.models = models
        self.favorites = favorites
        self.hiddenModels = hidden
        modelsLoaded = true
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

    func loadPullRequests(project: String) {
        pullsError = nil
        let request = requests.issue { [weak self] outcome in
            if case .failed(let message) = outcome {
                self?.pullsError = message
                self?.pullsProject = nil
            }
        }
        pullsRequest = request
        pullsProject = project
        core.run { $0.listPullRequests(request: request, project: project) }
    }

    func composer(project: String?) -> ComposerDraft {
        composer(key: thread ?? focusedPending ?? Self.draftKey(project))
    }

    private static func draftKey(_ project: String?) -> String {
        "project:\(project ?? "")"
    }

    func promptHistory() -> [String] {
        var history: [String] = []
        for entry in entries {
            if case .user(let text, _, _, _) = entry.item.kind, history.last != text {
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
        send(draft, project: project, delivery: steer ? .steer : .queue, settings: nil, defaultBranch: nil)
    }

    func submit(project: String?, alternate: Bool, settings: Settings?, defaultBranch: String? = nil) {
        let draft = composer(project: project)
        let opposite: Delivery = settings?.followUpBehavior == .steer ? .queue : .steer
        send(draft, project: project, delivery: alternate ? opposite : .default, settings: settings, defaultBranch: defaultBranch)
    }

    func steerQueuedMessage() -> Bool {
        guard let message = queued.first(where: { !$0.steering && !$0.sending }) else { return false }
        sendNow(message)
        return true
    }

    func attachContext(text: String, source: String) {
        let body = text.trimmingCharacters(in: .newlines)
        guard !body.isEmpty else { return }
        let lines = body.split(separator: "\n", omittingEmptySubsequences: false).count
        let title = lines == 1 ? "\(source) · 1 line" : "\(source) · \(lines) lines"
        let kind: ComposerContext.Kind = source.lowercased().contains("terminal") ? .terminal : .text
        composer(project: draftProject).contexts.append(ComposerContext(kind: kind, title: title, source: source, text: body))
        focusRequest += 1
    }

    func attachPullRequest(_ pull: PullRequest, to draft: ComposerDraft) {
        guard !draft.contexts.contains(where: { $0.kind == .pullRequest && $0.title.hasPrefix("#\(pull.number) ") }) else { return }
        let detail = [pull.title, pull.url, "\(pull.head) → \(pull.base) · \(pull.state.lowercased())"].joined(separator: "\n")
        draft.contexts.append(ComposerContext(
            kind: .pullRequest, title: "#\(pull.number) \(pull.title)", source: "Pull request #\(pull.number)", text: detail
        ))
    }

    func stashKey(project: String?) -> String {
        (thread != nil ? info?.project : project) ?? ""
    }

    @discardableResult
    func stashPrompt(project: String?) -> Bool {
        let draft = composer(project: project)
        guard !draft.isEmpty else { return false }
        stash.park(StashedPrompt(text: draft.text, files: draft.files, contexts: draft.contexts), project: stashKey(project: project))
        draft.clear()
        focusRequest += 1
        return true
    }

    func restoreStash(_ prompt: StashedPrompt, project: String?) {
        let key = stashKey(project: project)
        let draft = composer(project: project)
        if !draft.isEmpty {
            stash.park(StashedPrompt(text: draft.text, files: draft.files, contexts: draft.contexts), project: key)
        }
        draft.clear()
        draft.text = prompt.text
        draft.files = prompt.files
        draft.contexts = prompt.contexts
        stash.remove(prompt.id, project: key)
        focusRequest += 1
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

    func setHidden(_ model: ModelOption, _ hidden: Bool) {
        core.run { $0.setHiddenModel(provider: model.provider, model: model.id, hidden: hidden) }
    }

    func isHidden(_ model: ModelOption) -> Bool {
        hiddenModels.contains { $0.provider == model.provider && $0.model == model.id }
    }

    var providerUnavailable: Bool {
        guard modelsLoaded else { return false }
        if thread != nil {
            return info?.model == nil && !models.contains(where: \.configured)
        }
        return currentModel(settings: nil) == nil
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

    func requestFocus() {
        focusRequest += 1
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
                    thinkingLevels: info?.thinkingLevels ?? [], contextWindow: info?.context?.window ?? 0, configured: true,
                    serviceTiers: info?.serviceTiers ?? []
                )
        }
        let selectable = models.filter { $0.configured && !isHidden($0) }
        let chosen = newThread.model ?? settings.flatMap { settings in
            settings.defaultProvider.flatMap { provider in settings.defaultModel.map { ModelKey(provider: provider, model: $0) } }
        }
        if let chosen, let model = selectable.first(where: { $0.provider == chosen.provider && $0.id == chosen.model }) {
            return model
        }
        return selectable.first(where: isFavorite) ?? selectable.first
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

    private func send(_ draft: ComposerDraft, project: String?, delivery: Delivery, settings: Settings?, defaultBranch: String?) {
        let text = draft.promptText
        guard !text.isEmpty || !draft.images.isEmpty else { return }
        let prompt = PromptDraft(text: text, images: draft.images.map(\.attachment), files: draft.files)
        let typed = draft.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !typed.isEmpty {
            sentPrompts.append(typed)
        }
        let snapshot = StashedPrompt(text: draft.text, files: draft.files, contexts: draft.contexts)
        let images = draft.images
        draft.clear()
        followsEnd = true
        endRequest += 1
        guard let thread else {
            if let focusedPending, let index = pendings.firstIndex(where: { $0.draft == focusedPending }) {
                pendings[index].queued.append(QueuedMessage(id: UUID().uuidString, text: text, steering: false, sending: true))
                queued = pendings[index].queued
                return
            }
            let id = UUID().uuidString
            let model = currentModel(settings: settings)
            let options = ThreadSettings(
                provider: model?.provider,
                model: model?.id,
                thinkingLevel: thinkingLevel(settings: settings),
                access: access(settings: settings),
                worktree: newThread.worktreeChoice(settings: settings, defaultBranch: defaultBranch)
            )
            let fanOut = newThread.fanOutModels(available: models)
            if let tier = serviceTier(settings: settings) {
                pendingServiceTier[id] = tier
                for index in fanOut.indices.dropFirst() {
                    pendingServiceTier["\(id)#\(index)"] = tier
                }
            }
            let info = pendingInfo(id, project: project, title: typed.isEmpty ? text : typed, settings: settings)
            let start = PendingStart(
                draft: id, project: project, prompt: snapshot, request: prompt, options: options, fanOut: fanOut,
                entries: [Self.pendingEntry(text: text, images: images)], info: info
            )
            begin(start)
            newThread.threadStarted()
            launch(start)
            return
        }
        core.run { $0.send(thread: thread, prompt: prompt, delivery: busy ? delivery : .default) }
    }

    private static let pendingItem = UInt64.max

    private static func pendingEntry(text: String, images: [ComposerImage]) -> TimelineEntry {
        let thumbnails = images.map { image in
            let size = image.thumbnail?.size ?? .zero
            return ImageThumbnail(mimeType: image.attachment.mimeType, data: image.attachment.data, width: UInt32(size.width), height: UInt32(size.height))
        }
        let kind = ItemKind.user(text: text, images: UInt32(images.count), entry: nil, thumbnails: thumbnails)
        return TimelineEntry(item: Item(id: pendingItem, turn: 1, createdAt: Int64(Date.now.timeIntervalSince1970 * 1000), kind: kind))
    }

    private func pendingInfo(_ draft: String, project: String?, title: String, settings: Settings?) -> ThreadInfo {
        let model = currentModel(settings: settings)
        let line = title.split(whereSeparator: \.isNewline).first.map(String.init) ?? title
        return ThreadInfo(
            thread: draft, project: project, title: String(line.prefix(80)), cwd: "",
            model: model.map { ModelRef(provider: $0.provider, id: $0.id, name: $0.name, reasoning: $0.reasoning) },
            thinkingLevel: thinkingLevel(settings: settings) ?? "", thinkingLevels: thinkingLevels(settings: settings),
            access: access(settings: settings), busy: true, runStartedAt: Int64(Date.now.timeIntervalSince1970 * 1000),
            compacting: false, retryAttempt: 0, queued: 0, context: nil, branch: nil, worktree: nil,
            serviceTier: serviceTier(settings: settings), serviceTiers: serviceTiers(settings: settings), goal: nil
        )
    }

    private func begin(_ start: PendingStart) {
        park()
        pendings.insert(start, at: 0)
        thread = nil
        entries = start.entries
        rebuildRows()
        info = start.info
        approvals = []
        queued = []
        expandedFolds = []
        followsEnd = true
        scrollTop = nil
        focusedPending = start.draft
        keepTimeline(start.draft)
        pendingsChanged?()
    }

    private func launch(_ start: PendingStart) {
        let (id, project, prompt, options, fanOut) = (start.draft, start.project, start.request, start.options, start.fanOut)
        if fanOut.count >= 2 {
            core.run { $0.startThreads(draft: id, project: project, prompt: prompt, settings: options, models: fanOut) }
        } else {
            core.run { $0.startThread(draft: id, project: project, prompt: prompt, settings: options) }
        }
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
        let layout = TimelineLayout.rows(for: entries, expanded: expandedFolds)
        if !layout.elementsEqual(rows, by: { $0.same(as: $1) }) {
            rows = layout
        }
        let next = rows.enumerated().compactMap { index, row -> TimelineAnchor? in
            guard case .entry(let entry, _) = row, case .user(let text, _, _, _) = entry.item.kind else { return nil }
            let line = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? text
            return TimelineAnchor(id: entry.id, order: index, preview: line)
        }
        if next != anchors {
            anchors = next
        }
    }

    private var outOfSync: String {
        "The transcript went out of sync; reopen the thread."
    }
}

struct TimelineAnchor: Identifiable, Equatable {
    let id: UInt64
    let order: Int
    let preview: String
}

struct ThreadScroll: Equatable {
    var followsEnd = true
    var top: UInt64?
}

struct PendingStart {
    let draft: String
    let project: String?
    let prompt: StashedPrompt
    let request: PromptDraft
    let options: ThreadSettings
    let fanOut: [ModelKey]
    let entries: [TimelineEntry]
    var info: ThreadInfo
    var queued: [QueuedMessage] = []
    var thread: String?
    var failure: String?
    let at = Date.now
}

private struct CachedTranscript {
    let entries: [TimelineEntry]
    let rows: [TimelineRow]
    let anchors: [TimelineAnchor]
    let expandedFolds: Set<UInt64>
    let approvals: [Approval]
    let queued: [QueuedMessage]
    let scroll: ThreadScroll
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

    func same(as other: TimelineRow) -> Bool {
        switch (self, other) {
        case let (.entry(lhs, lhsHides), .entry(rhs, rhsHides)): lhs === rhs && lhsHides == rhsHides
        case let (.tools(lhs), .tools(rhs)): lhs.elementsEqual(rhs, by: ===)
        case let (.fold(lhs, lhsExpanded), .fold(rhs, rhsExpanded)): lhs === rhs && lhsExpanded == rhsExpanded
        default: false
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
    var worktree: Bool?
    var branch = ""
    var base: String?
    var existingWorktree: String?
    var existingBranch: String?
    var serviceTier: String?
    var multiModel = false
    var fanOut: [ModelKey] = []

    func usesWorktree(_ settings: Settings?) -> Bool {
        worktree ?? (settings?.newThreadWorkspace == .worktree)
    }

    func worktreeChoice(settings: Settings?, defaultBranch: String?) -> WorktreeChoice {
        if let existingWorktree {
            return .existing(path: existingWorktree)
        }
        let name = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        if worktree == nil, name.isEmpty, base == nil {
            return .default
        }
        guard usesWorktree(settings) else { return .local }
        let origin = (settings?.newWorktreesStartFromOrigin ?? true) ? defaultBranch.map { "origin/" + $0 } : nil
        return .newWorktree(branch: name.isEmpty ? Self.generatedBranch() : name, base: base ?? origin)
    }

    func isFanOut(_ model: ModelOption) -> Bool {
        fanOut.contains { $0.provider == model.provider && $0.model == model.id }
    }

    func toggleFanOut(_ model: ModelOption) {
        let key = ModelKey(provider: model.provider, model: model.id)
        if let index = fanOut.firstIndex(of: key) {
            fanOut.remove(at: index)
        } else {
            fanOut.append(key)
        }
    }

    func fanOutModels(available: [ModelOption]) -> [ModelKey] {
        guard multiModel else { return [] }
        return fanOut.filter { key in available.contains { $0.provider == key.provider && $0.id == key.model && $0.configured } }
    }

    func chooseWorkspace(worktree: Bool) {
        existingWorktree = nil
        existingBranch = nil
        self.worktree = worktree
    }

    func threadStarted() {
        existingWorktree = nil
        existingBranch = nil
        branch = ""
        multiModel = false
        fanOut = []
    }

    static func generatedBranch() -> String {
        "local-studio/" + UUID().uuidString.prefix(8).lowercased()
    }
}

struct ImageGallery: Identifiable {
    let id = UUID()
    let entry: String
    let thumbnails: [ImageThumbnail]
    var index: Int
}

@MainActor
@Observable
final class ComposerDraft {
    var text = ""
    var images: [ComposerImage] = []
    var files: [String] = []
    var contexts: [ComposerContext] = []

    var isEmpty: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && images.isEmpty && contexts.isEmpty
    }

    var promptText: String {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let blocks = contexts.map(\.promptBlock)
        return ([body] + blocks).filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    func clear() {
        text = ""
        images = []
        files = []
        contexts = []
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

struct ComposerContext: Identifiable, Equatable, Codable {
    enum Kind: String, Codable {
        case pullRequest
        case terminal
        case text
    }

    var id = UUID()
    let kind: Kind
    let title: String
    let source: String
    let text: String

    var symbol: String {
        switch kind {
        case .pullRequest: "arrow.triangle.pull"
        case .terminal: "terminal"
        case .text: "text.alignleft"
        }
    }

    var promptBlock: String {
        "\(source):\n```\n\(text)\n```"
    }
}
