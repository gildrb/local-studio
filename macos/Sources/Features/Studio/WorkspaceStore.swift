import AppKit
import Foundation
import LocalStudioKit
import Observation

@MainActor
@Observable
final class WorkspaceStore {
    private(set) var gitStatus: [String: GitStatus] = [:]
    private(set) var branches: [String: [Branch]] = [:]
    private(set) var diffs: [String: [FileDiff]] = [:]
    private(set) var directories: [String: [FileEntry]] = [:]
    private(set) var fileContents: [String: FileContent] = [:]
    private(set) var searchResults: [String: [SearchHit]] = [:]
    private(set) var pullRequests: [String: [PullRequest]] = [:]
    private(set) var pullRequestDetails: [String: PullRequestDetail] = [:]
    private(set) var devices: [String: [Device]] = [:]

    let panels: PanelState

    @ObservationIgnored private var routes: [String: PanelRoute] = [:]
    @ObservationIgnored private var sessions: [String: TerminalSession] = [:]
    @ObservationIgnored private let core: CoreHandle
    @ObservationIgnored private let requests: RequestCenter

    init(core: CoreHandle, requests: RequestCenter) {
        self.core = core
        self.requests = requests
        panels = PanelState()
        panels.workspace = self
    }

    func setGitStatus(project: String, status: GitStatus) {
        gitStatus[project] = status
    }

    private(set) var subagents: [String: [Subagent]] = [:]

    func setSubagents(thread: String, agents: [Subagent]) {
        subagents[thread] = agents
        panels.subagentsChanged(thread: thread)
    }

    func setBranches(request: String, branches: [Branch], total: UInt32) {
        guard case .branches(let model) = routes.removeValue(forKey: request) else {
            self.branches[request] = branches
            return
        }
        model.branchesLoaded(branches)
    }

    func setDiff(request: String, files: [FileDiff]) {
        guard case .diff(let model) = routes.removeValue(forKey: request) else {
            diffs[request] = files
            return
        }
        model.loaded(files, request: request)
    }

    func setFiles(request: String, entries: [FileEntry]) {
        guard case .directory(let model, let relative) = routes.removeValue(forKey: request) else {
            directories[request] = entries
            return
        }
        model.loaded(entries, relative: relative)
    }

    func setFileContent(request: String, path: String, content: FileContent) {
        guard case .file(let model) = routes.removeValue(forKey: request) else {
            fileContents[request] = content
            return
        }
        model.loaded(content, request: request)
    }

    func setSearchResults(request: String, results: [SearchHit]) {
        searchResults[request] = results
    }

    func setPullRequestDetail(request: String, detail: PullRequestDetail) {
        guard case .pullDetail(let model) = routes.removeValue(forKey: request) else {
            pullRequestDetails[request] = detail
            return
        }
        model.loaded(detail, request: request)
    }

    func setDevices(request: String, devices: [Device]) {
        guard case .devices(let model) = routes.removeValue(forKey: request) else {
            self.devices[request] = devices
            return
        }
        model.loaded(devices, request: request)
    }

    func setPullRequests(request: String, pulls: [PullRequest]) {
        guard case .pulls(let model) = routes.removeValue(forKey: request) else {
            pullRequests[request] = pulls
            return
        }
        model.loaded(pulls, request: request)
    }

    func terminalOpened(request: String, terminal: String) {
        guard case .terminal(let session) = routes.removeValue(forKey: request) else {
            core.run { $0.closeTerminal(terminal: terminal) }
            return
        }
        sessions[terminal] = session
        session.bind(terminal)
    }

    func terminalFrame(terminal: String, frame: TerminalFrame) {
        sessions[terminal]?.apply(frame)
    }

    func terminalText(request: String, text: String) {
        guard case .terminalText(let completion) = routes.removeValue(forKey: request) else { return }
        completion(text)
    }

    func terminalExited(terminal: String, code: Int32?) {
        sessions[terminal]?.exited(code: code)
    }

    func requestTerminalText(_ completion: @escaping @MainActor (String) -> Void, _ call: (Studio, String) -> Void) {
        _ = issue(.terminalText(completion), call)
    }

    func issue(_ route: PanelRoute, _ call: (Studio, String) -> Void) -> String {
        var issued = ""
        let id = requests.issue { [weak self] outcome in
            guard let self, let route = routes.removeValue(forKey: issued) else { return }
            switch outcome {
            case .done(let message):
                route.done(message)
            case .failed(let message):
                route.fail(message, request: issued)
            }
        }
        issued = id
        routes[id] = route
        core.run { call($0, id) }
        return id
    }

    func command(_ body: (Studio) -> Void) {
        core.run(body)
    }

    func runScript(project: String, script: ProjectScript, ordinal: Int) -> TerminalSession {
        let session = TerminalSession(project: project, ordinal: ordinal, workspace: self)
        session.title = script.name
        let id = script.id
        session.request = issue(.terminal(session)) { studio, request in
            studio.runProjectScript(request: request, project: project, script: id)
        }
        return session
    }

    func openTerminal(project: String, ordinal: Int) -> TerminalSession {
        let session = TerminalSession(project: project, ordinal: ordinal, workspace: self)
        session.request = issue(.terminal(session)) { studio, id in
            studio.openTerminal(request: id, project: project, cols: session.columns, rows: session.rows)
        }
        return session
    }

    func forget(_ session: TerminalSession) {
        if let terminal = session.terminal {
            sessions[terminal] = nil
        }
    }
}

@MainActor
enum PanelRoute {
    case diff(DiffModel)
    case branches(DiffModel)
    case directory(FilesModel, String)
    case file(FilePreviewModel)
    case pulls(PullRequestsModel)
    case pullDetail(PullRequestDetailModel)
    case devices(DeviceModel)
    case deviceAction(DeviceModel, String)
    case terminal(TerminalSession)
    case terminalText(@MainActor (String) -> Void)

    func done(_ message: String) {
        if case .deviceAction(let model, let device) = self {
            model.actionFinished(device: device, message: message, failed: false)
        }
    }

    func fail(_ message: String, request: String) {
        switch self {
        case .diff(let model):
            model.failed(message, request: request)
        case .branches(let model):
            model.branchesLoaded([])
        case .directory(let model, let relative):
            model.failed(message, relative: relative)
        case .file(let model):
            model.failed(message, request: request)
        case .pulls(let model):
            model.failed(message, request: request)
        case .pullDetail(let model):
            model.failed(message, request: request)
        case .devices(let model):
            model.failed(message, request: request)
        case .deviceAction(let model, let device):
            model.actionFinished(device: device, message: message, failed: true)
        case .terminal(let session):
            session.failed(message)
        case .terminalText:
            break
        }
    }
}

struct PanelMemory {
    var rightPanelOpen = false
    var terminalOpen = false
    var maximized = false
    var width: CGFloat = PanelState.defaultWidth
    var surfaces: [PanelSurface] = []
    var active: String?
    var miniPlayer: BrowserModel?
}

@MainActor
@Observable
final class PanelState {
    nonisolated static let defaultWidth: CGFloat = 460
    static let widthRange: ClosedRange<CGFloat> = 320...1100
    static let minimumTerminalHeight: CGFloat = 180
    static let maximumTerminalRatio: CGFloat = 0.75
    static let trailingChromeInset: CGFloat = 76
    static let miniPlayerMinimumWidth: CGFloat = 240

    func updateSettings(_ change: (inout Settings) -> Void) {
        guard var settings = pages?.settings else { return }
        change(&settings)
        workspace?.command { $0.updateSettings(settings: settings) }
    }

    var rightPanelOpen = false
    var terminalOpen = false {
        didSet {
            if terminalOpen, !oldValue {
                ensureDrawerTerminal()
            }
        }
    }
    var rightPanelMaximized = false
    var rightPanelWidth: CGFloat = PanelState.defaultWidth
    var terminalHeight: CGFloat = 280
    private(set) var surfaces: [PanelSurface] = []
    var activeSurface: String?
    private(set) var thread: String?
    private(set) var decks: [String: TerminalDeck] = [:]
    private(set) var miniPlayer: BrowserModel?
    var miniPlayerOffset = CGSize.zero
    var miniPlayerWidth: CGFloat = 340

    @ObservationIgnored weak var workspace: WorkspaceStore?
    @ObservationIgnored private weak var conversation: ConversationStore?
    @ObservationIgnored private weak var inbox: InboxStore?
    @ObservationIgnored private weak var pages: PagesStore?
    @ObservationIgnored private var memory: [String: PanelMemory] = [:]
    @ObservationIgnored private var userRevision = 0
    @ObservationIgnored private var turnRevision: Int?
    @ObservationIgnored private var wasBusy = false
    @ObservationIgnored private var observedPulls: [String: UInt64?] = [:]

    func bind(conversation: ConversationStore, inbox: InboxStore, pages: PagesStore) {
        self.conversation = conversation
        self.inbox = inbox
        self.pages = pages
        observeProactive()
        registerCommands(inbox.commands)
    }

    private func registerCommands(_ commands: CommandRouter) {
        commands.register("preview.toggle", owner: self) { [weak self] in self?.togglePreview() }
        let browser: @MainActor () -> Bool = { [weak self] in self?.activeBrowser != nil }
        commands.register("preview.refresh", owner: self, enabled: browser) { [weak self] in self?.refreshPreview() }
        commands.register("preview.focusUrl", owner: self, enabled: browser) { [weak self] in self?.focusPreviewAddress() }
        commands.register("preview.zoomIn", owner: self, enabled: browser) { [weak self] in self?.zoomPreview(by: 0.1) }
        commands.register("preview.zoomOut", owner: self, enabled: browser) { [weak self] in self?.zoomPreview(by: -0.1) }
        commands.register("preview.resetZoom", owner: self, enabled: browser) { [weak self] in self?.resetPreviewZoom() }
    }

    var commands: CommandRouter? {
        inbox?.commands
    }

    func addToChat(_ text: String, source: String) {
        conversation?.attachContext(text: text, source: source)
    }

    var project: String? {
        if let info = conversation?.info, info.thread == thread, info.thread == conversation?.thread {
            return info.project
        }
        guard let thread else { return inbox?.currentProject }
        return inbox?.threads.first { $0.id == thread }?.project
    }

    var settings: Settings? {
        pages?.settings
    }

    var agents: [Subagent] {
        guard let thread else { return [] }
        return workspace?.subagents[thread] ?? []
    }

    var liveAgentCount: Int {
        guard let thread else { return 0 }
        if let row = inbox?.threads.first(where: { $0.id == thread }) {
            return Int(row.liveAgents)
        }
        return agents.filter(\.running).count
    }

    private(set) var cancelling: Set<String> = []
    var expandedAgents: Set<String> = []

    func cancelSubagent(_ child: String) {
        guard let thread, !cancelling.contains(child) else { return }
        cancelling.insert(child)
        workspace?.command { $0.cancelSubagent(thread: thread, child: child) }
    }

    func subagentsChanged(thread: String) {
        guard thread == self.thread else { return }
        let running = Set(agents.filter(\.running).map(\.id))
        cancelling.formIntersection(running)
    }

    var settledTurns: [UInt64] {
        guard let conversation, conversation.thread == thread else { return [] }
        return conversation.items.reversed().compactMap { item in
            if case .turnSummary(let turn, _, _) = item.kind { return turn }
            return nil
        }
    }

    func gitStatus(_ project: String?) -> GitStatus? {
        guard let project else { return nil }
        return workspace?.gitStatus[project]
    }

    func isGit(_ project: String?) -> Bool {
        guard let project else { return false }
        if let status = workspace?.gitStatus[project] { return status.isRepo }
        return inbox?.project(project)?.isGit ?? false
    }

    var activeContent: PanelSurface? {
        surfaces.first { $0.id == activeSurface }
    }

    func focus(_ thread: String?) {
        guard thread != self.thread else { return }
        let previous = self.thread
        memory[Self.key(previous)] = PanelMemory(
            rightPanelOpen: rightPanelOpen,
            terminalOpen: terminalOpen,
            maximized: rightPanelMaximized,
            width: rightPanelWidth,
            surfaces: surfaces,
            active: activeSurface,
            miniPlayer: miniPlayer
        )
        let carried = previous == nil && memory[Self.key(thread)] == nil
        let restored = carried ? memory.removeValue(forKey: Self.key(nil)) ?? PanelMemory() : memory[Self.key(thread)] ?? PanelMemory()
        self.thread = thread
        surfaces = restored.surfaces
        activeSurface = restored.active
        rightPanelWidth = restored.width
        rightPanelMaximized = restored.maximized
        rightPanelOpen = restored.rightPanelOpen
        terminalOpen = restored.terminalOpen
        if terminalOpen, let project {
            decks[project]?.groups.flatMap(\.sessions).forEach { $0.focusOnAttach = false }
        }
        miniPlayer = restored.miniPlayer
        wasBusy = false
        turnRevision = nil
    }

    func toggleRightPanel() {
        userRevision += 1
        if rightPanelOpen {
            closePanel()
        } else {
            rightPanelOpen = true
        }
    }

    private func closePanel() {
        if case .browser(let model) = activeContent?.content, model.current != nil {
            miniPlayer = model
        }
        rightPanelOpen = false
        rightPanelMaximized = false
    }

    var visibleMiniPlayer: BrowserModel? {
        guard let miniPlayer else { return nil }
        if rightPanelOpen, case .browser(let model) = activeContent?.content, model === miniPlayer { return nil }
        return miniPlayer
    }

    func float(_ model: BrowserModel) {
        userRevision += 1
        miniPlayer = model
        if case .browser(let active) = activeContent?.content, active === model {
            rightPanelOpen = false
            rightPanelMaximized = false
        }
    }

    func dock(_ model: BrowserModel) {
        guard let surface = surfaces.first(where: { if case .browser(let other) = $0.content { other === model } else { false } }) else { return }
        show(surface.id)
    }

    func closeMiniPlayer() {
        userRevision += 1
        miniPlayer = nil
    }

    var activeBrowser: BrowserModel? {
        if rightPanelOpen, case .browser(let model) = activeContent?.content { return model }
        return visibleMiniPlayer
    }

    func togglePreview() {
        if rightPanelOpen, activeContent?.kind == .browser {
            userRevision += 1
            closePanel()
        } else if let existing = surfaces.first(where: { $0.kind == .browser }) {
            show(existing.id)
        } else {
            openSurface(.browser)
        }
    }

    func refreshPreview() {
        activeBrowser?.reload()
    }

    func focusPreviewAddress() {
        guard let browser = activeBrowser else { return }
        if browser !== visibleMiniPlayer {
            browser.focusAddress()
        } else {
            dock(browser)
            browser.focusAddress()
        }
    }

    func zoomPreview(by step: CGFloat) {
        guard let browser = activeBrowser else { return }
        browser.setZoom(browser.zoom + step)
    }

    func resetPreviewZoom() {
        activeBrowser?.setZoom(1)
    }

    func toggleTerminal() {
        terminalOpen.toggle()
    }

    func toggleDiff() {
        userRevision += 1
        if rightPanelOpen, activeContent?.kind == .diff {
            rightPanelOpen = false
            rightPanelMaximized = false
        } else {
            openSurface(.diff)
        }
    }

    func openDiff(path: String) {
        userRevision += 1
        if !(rightPanelOpen && activeContent?.kind == .diff) {
            openSurface(.diff)
        }
        guard case .diff(let model) = activeContent?.content else { return }
        if model.thread != nil, model.scope != .latestTurn {
            model.scope = .latestTurn
        }
        model.focus(path: path)
    }

    func launcherActions() -> [PanelLauncherAction] {
        let project = project
        let status = gitStatus(project)
        return PanelSurfaceKind.launcher.map { kind in
            let available: Bool
            switch kind {
            case .browser: available = true
            case .terminal, .files: available = project != nil
            case .diff, .pullRequests: available = isGit(project)
            case .pullRequest: available = status?.pullRequest != nil
            case .agents: available = thread != nil
            case .device: available = true
            case .file: available = false
            }
            return PanelLauncherAction(kind: kind, available: available, badge: kind == .agents ? liveAgentCount : 0)
        }
    }

    func openSurface(_ kind: PanelSurfaceKind) {
        userRevision += 1
        present(kind)
    }

    private func present(_ kind: PanelSurfaceKind) {
        guard let action = launcherActions().first(where: { $0.kind == kind }), action.available else { return }
        if kind != .terminal, let existing = surfaces.first(where: { $0.kind == kind }) {
            show(existing.id)
            return
        }
        guard let content = makeContent(kind) else { return }
        append(PanelSurface(content: content))
    }

    func openFile(project: String, relative: String, line: UInt32?) {
        userRevision += 1
        if let existing = surfaces.first(where: {
            if case .file(let model) = $0.content { model.project == project && model.relative == relative } else { false }
        }) {
            if case .file(let model) = existing.content {
                model.reveal(line)
            }
            show(existing.id)
            return
        }
        guard let workspace else { return }
        let model = FilePreviewModel(project: project, relative: relative, line: line, workspace: workspace)
        model.load()
        append(PanelSurface(content: .file(model)))
    }

    func show(_ surface: String) {
        userRevision += 1
        activeSurface = surface
        rightPanelOpen = true
    }

    func close(_ surface: String) {
        guard let index = surfaces.firstIndex(where: { $0.id == surface }) else { return }
        userRevision += 1
        let removed = surfaces.remove(at: index)
        if case .browser(let model) = removed.content, model === miniPlayer {
            miniPlayer = nil
        }
        removed.dispose()
        if activeSurface == surface {
            activeSurface = surfaces.indices.contains(index) ? surfaces[index].id : surfaces.last?.id
        }
    }

    func closeActiveSurface() {
        if let activeSurface {
            close(activeSurface)
        }
    }

    func closeOthers(_ surface: String) {
        for other in surfaces where other.id != surface {
            close(other.id)
        }
    }

    func closeToRight(_ surface: String) {
        guard let index = surfaces.firstIndex(where: { $0.id == surface }) else { return }
        for other in surfaces[(index + 1)...] {
            close(other.id)
        }
    }

    func closeAll() {
        for surface in surfaces {
            close(surface.id)
        }
    }

    func deck(for project: String) -> TerminalDeck {
        if let deck = decks[project] { return deck }
        let deck = TerminalDeck(project: project, workspace: workspace)
        decks[project] = deck
        return deck
    }

    func runProjectScript(project: String, script: ProjectScript) {
        guard let workspace else { return }
        let deck = deck(for: project)
        deck.adopt { ordinal in workspace.runScript(project: project, script: script, ordinal: ordinal) }
        terminalOpen = true
    }

    func ensureDrawerTerminal() {
        guard let project else { return }
        let deck = deck(for: project)
        if deck.groups.isEmpty {
            deck.newTerminal()
        }
    }

    private func append(_ surface: PanelSurface) {
        surfaces.append(surface)
        show(surface.id)
    }

    private func observeProactive() {
        withObservationTracking {
            _ = conversation?.thread
            _ = conversation?.info?.busy
            _ = settings?.proactivePanels
            _ = project.flatMap { workspace?.gitStatus[$0]?.pullRequest?.number }
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in
                self?.evaluateProactive()
                self?.observeProactive()
            }
        }
    }

    func evaluateProactive() {
        guard let conversation, conversation.thread == thread else {
            wasBusy = false
            return
        }
        let busy = conversation.info?.thread == thread ? conversation.info?.busy ?? false : false
        if busy, !wasBusy {
            turnRevision = userRevision
        }
        let completed = wasBusy && !busy
        wasBusy = busy
        let pull = project.flatMap { gitStatus($0)?.pullRequest?.number }
        let previousPull = observedPulls[Self.key(thread)]
        observedPulls[Self.key(thread)] = pull
        guard settings?.proactivePanels == true else { return }
        if let pull, previousPull != .some(pull) {
            reveal(.pullRequest)
            return
        }
        guard completed, turnRevision == userRevision, isGit(project),
              activeContent?.kind != .pullRequest, activeContent?.kind != .pullRequests,
              Self.turnWarrantsDiff(conversation.items) else { return }
        reveal(.diff)
        if case .diff(let model) = activeContent?.content, model.thread != nil {
            if model.scope == .latestTurn {
                model.load()
            } else {
                model.scope = .latestTurn
            }
        }
    }

    private func reveal(_ kind: PanelSurfaceKind) {
        let revision = userRevision
        present(kind)
        userRevision = revision
    }

    static func turnWarrantsDiff(_ items: [Item]) -> Bool {
        guard let turn = items.last?.turn,
              items.contains(where: { if case .turnSummary(let settled, _, _) = $0.kind { settled == turn } else { false } }) else { return false }
        var changes: [String: UInt32] = [:]
        for item in items.reversed() {
            guard item.turn == turn else { break }
            if case .assistant(_, _, _, let changed) = item.kind {
                for file in changed {
                    changes[file.path] = file.additions + file.deletions
                }
            }
        }
        return changes.count >= 3 || changes.values.reduce(0, +) >= 50
    }

    private func makeContent(_ kind: PanelSurfaceKind) -> PanelSurfaceContent? {
        guard let workspace else { return nil }
        switch kind {
        case .browser:
            return .browser(BrowserModel())
        case .terminal:
            guard let project else { return nil }
            let group = TerminalGroup(deck: deck(for: project))
            group.add(axis: nil)
            return .terminal(group)
        case .files:
            guard let project else { return nil }
            let model = FilesModel(project: project, workspace: workspace, panels: self)
            model.load("")
            return .files(model)
        case .diff:
            guard let project else { return nil }
            let model = DiffModel(project: project, thread: thread, workspace: workspace, settings: settings)
            model.load()
            return .diff(model)
        case .pullRequest:
            guard let project, let pull = gitStatus(project)?.pullRequest else { return nil }
            let model = PullRequestDetailModel(project: project, pull: pull, workspace: workspace, settings: settings)
            model.load()
            return .pullRequest(model)
        case .pullRequests:
            guard let project else { return nil }
            let model = PullRequestsModel(project: project, workspace: workspace, settings: settings)
            model.load()
            return .pullRequests(model)
        case .agents:
            return .agents
        case .device:
            let model = DeviceModel(workspace: workspace)
            model.load()
            return .device(model)
        case .file:
            return nil
        }
    }

    private static func key(_ thread: String?) -> String {
        thread ?? ""
    }
}
