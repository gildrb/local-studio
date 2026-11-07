import Combine
import Foundation
import LocalStudioKit
import Observation

@MainActor
@Observable
final class StudioStore {
    private(set) var connection: Connection = .connecting
    private(set) var notice: StudioNotice?

    let inbox: InboxStore
    let conversation: ConversationStore
    let workspace: WorkspaceStore
    let pages: PagesStore

    @ObservationIgnored let core = CoreHandle()
    @ObservationIgnored let requests = RequestCenter()
    @ObservationIgnored let didTick = PassthroughSubject<Void, Never>()
    @ObservationIgnored private let launch: DaemonLaunch?

    init(launch: DaemonLaunch?) {
        self.launch = launch
        inbox = InboxStore(core: core, requests: requests)
        conversation = ConversationStore(core: core, requests: requests)
        workspace = WorkspaceStore(core: core, requests: requests)
        pages = PagesStore(core: core, requests: requests)
        workspace.panels.bind(conversation: conversation, inbox: inbox, pages: pages)
    }

    func start() throws {
        let config = StudioConfig(socketPath: nil, sessionDir: nil, dataDir: nil, launch: launch)
        let waker = MainWaker { [weak self] in self?.tick() }
        core.studio = try Studio(config: config, waker: waker)
    }

    func stop() {
        core.studio?.shutdown()
        core.studio = nil
        requests.reset()
    }

    func select(_ thread: String?) {
        conversation.focus(thread)
        core.run { $0.selectThread(thread: thread) }
    }

    func post(_ level: NoticeLevel, _ text: String) {
        notice = StudioNotice(level: level, text: text)
    }

    func dismissNotice() {
        notice = nil
    }

    func receive(_ updates: [Update]) {
        for update in updates {
            apply(update)
        }
        didTick.send()
    }

    private func tick() {
        guard let studio = core.studio else { return }
        receive(studio.tick())
    }

    private func apply(_ update: Update) {
        switch update {
        case .connection(let state):
            connection = state
        case .projects(let projects):
            inbox.setProjects(projects)
        case .threads(let threads):
            inbox.setThreads(threads)
        case .archivedThreads(let request, let threads):
            requests.settle(request)
            pages.setArchived(threads)
        case .threadStarted(let draft, let thread):
            if conversation.threadStarted(draft: draft, thread: thread) {
                select(thread)
            }
        case .thread(let thread, let info):
            conversation.setInfo(thread: thread, info: info)
        case .transcript(let thread, let op):
            if let problem = conversation.apply(thread: thread, op: op) {
                post(.error, problem)
            }
        case .approvals(let thread, let approvals):
            conversation.setApprovals(thread: thread, approvals: approvals)
        case .queue(let thread, let queued):
            conversation.setQueue(thread: thread, queued: queued)
        case .composerText(let thread, let text):
            conversation.setComposerText(thread: thread, text: text)
        case .models(let models, let favorites):
            conversation.setModels(models, favorites: favorites)
        case .commands(let request, let commands):
            requests.settle(request)
            conversation.setCommands(request: request, commands: commands)
        case .notification(let thread, let kind, let title, let body):
            inbox.notify(thread: thread, kind: kind, title: title, body: body)
        case .gitStatus(let project, let status):
            workspace.setGitStatus(project: project, status: status)
        case .branches(let request, let branches, let total):
            requests.settle(request)
            workspace.setBranches(request: request, branches: branches, total: total)
        case .diff(let request, let files):
            requests.settle(request)
            workspace.setDiff(request: request, files: files)
        case .files(let request, let entries):
            requests.settle(request)
            workspace.setFiles(request: request, entries: entries)
        case .fileContent(let request, let path, let content):
            requests.settle(request)
            workspace.setFileContent(request: request, path: path, content: content)
        case .searchResults(let request, let results):
            requests.settle(request)
            workspace.setSearchResults(request: request, results: results)
        case .pullRequests(let request, let pulls):
            requests.settle(request)
            workspace.setPullRequests(request: request, pulls: pulls)
        case .terminalOpened(let request, let terminal):
            requests.settle(request)
            workspace.terminalOpened(request: request, terminal: terminal)
        case .terminalOutput(let terminal, let data):
            workspace.terminalOutput(terminal: terminal, data: data)
        case .terminalExited(let terminal, let code):
            workspace.terminalExited(terminal: terminal, code: code)
        case .usage(let request, let report):
            requests.settle(request)
            pages.setUsage(report)
        case .local(let request, let snapshot):
            requests.settle(request)
            pages.setLocal(snapshot)
        case .providers(let providers):
            pages.setProviders(providers)
        case .settings(let settings):
            pages.setSettings(settings)
        case .keybindings(let bindings):
            pages.setKeybindings(bindings)
        case .requestDone(let request, let message):
            requests.complete(request, .done(message))
        case .requestFailed(let request, let message):
            requests.complete(request, .failed(message))
        case .notice(let level, let text):
            post(level, text)
        }
    }
}
