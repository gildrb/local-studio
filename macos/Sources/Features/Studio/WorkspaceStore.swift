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

    func terminalOutput(terminal: String, data: Data) {
        sessions[terminal]?.receive(data)
    }

    func terminalExited(terminal: String, code: Int32?) {
        sessions.removeValue(forKey: terminal)?.exited(code: code)
    }

    func issue(_ route: PanelRoute, _ call: (Studio, String) -> Void) -> String {
        var issued = ""
        let id = requests.issue { [weak self] outcome in
            guard let self, let route = routes.removeValue(forKey: issued) else { return }
            if case .failed(let message) = outcome {
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
    case terminal(TerminalSession)

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
        case .terminal(let session):
            session.failed(message)
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
}

struct AgentRun: Identifiable {
    let id: UInt64
    let title: String
    let detail: String
    let state: ToolState
    let startedAt: Int64?
    let endedAt: Int64?
    let output: String

    var live: Bool {
        state == .running || state == .pending
    }
}

@MainActor
@Observable
final class PanelState {
    nonisolated static let defaultWidth: CGFloat = 460
    static let widthRange: ClosedRange<CGFloat> = 320...1100
    static let minimumTerminalHeight: CGFloat = 180
    static let maximumTerminalRatio: CGFloat = 0.75
    static let trailingChromeInset: CGFloat = 76

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

    @ObservationIgnored weak var workspace: WorkspaceStore?
    @ObservationIgnored private weak var conversation: ConversationStore?
    @ObservationIgnored private weak var inbox: InboxStore?
    @ObservationIgnored private weak var pages: PagesStore?
    @ObservationIgnored private var memory: [String: PanelMemory] = [:]

    func bind(conversation: ConversationStore, inbox: InboxStore, pages: PagesStore) {
        self.conversation = conversation
        self.inbox = inbox
        self.pages = pages
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

    var agents: [AgentRun] {
        guard let conversation, conversation.thread == thread else { return [] }
        return conversation.items.compactMap { item in
            guard case .tool(_, let name, let kind, let summary, _, let state, let output, _, let startedAt, let endedAt) = item.kind,
                  kind == .agent else { return nil }
            let title = summary.isEmpty ? name : summary
            return AgentRun(id: item.id, title: title, detail: name, state: state, startedAt: startedAt, endedAt: endedAt, output: output)
        }
    }

    var liveAgentCount: Int {
        agents.reduce(0) { $0 + ($1.live ? 1 : 0) }
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
            active: activeSurface
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
    }

    func toggleRightPanel() {
        rightPanelOpen.toggle()
        if !rightPanelOpen {
            rightPanelMaximized = false
        }
    }

    func toggleTerminal() {
        terminalOpen.toggle()
    }

    func toggleDiff() {
        if rightPanelOpen, activeContent?.kind == .diff {
            rightPanelOpen = false
            rightPanelMaximized = false
        } else {
            openSurface(.diff)
        }
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
            case .device, .file: available = false
            }
            return PanelLauncherAction(kind: kind, available: available, badge: kind == .agents ? liveAgentCount : 0)
        }
    }

    func openSurface(_ kind: PanelSurfaceKind) {
        guard let action = launcherActions().first(where: { $0.kind == kind }), action.available else { return }
        if kind != .terminal, let existing = surfaces.first(where: { $0.kind == kind }) {
            show(existing.id)
            return
        }
        guard let content = makeContent(kind) else { return }
        append(PanelSurface(content: content))
    }

    func openFile(project: String, relative: String, line: UInt32?) {
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
        activeSurface = surface
        rightPanelOpen = true
    }

    func close(_ surface: String) {
        guard let index = surfaces.firstIndex(where: { $0.id == surface }) else { return }
        let removed = surfaces.remove(at: index)
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
            guard let pull = gitStatus(project)?.pullRequest else { return nil }
            return .pullRequest(pull)
        case .pullRequests:
            guard let project else { return nil }
            let model = PullRequestsModel(project: project, workspace: workspace)
            model.load()
            return .pullRequests(model)
        case .agents:
            return .agents
        case .device, .file:
            return nil
        }
    }

    private static func key(_ thread: String?) -> String {
        thread ?? ""
    }
}
