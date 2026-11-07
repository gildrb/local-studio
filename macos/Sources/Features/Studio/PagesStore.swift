import Foundation
import LocalStudioKit
import Observation

enum LocalPendingKey: Hashable {
    case scan
    case deploy(String)
    case connect(String)
    case disconnect(String)
    case rename(String)
    case load(String)
    case stopRun(String, String)
    case unload(String, UInt16)
    case registry
    case inspect(String)
    case download(String)
    case previewShare(String, UInt16)
    case share(String, UInt16)
}

@MainActor
@Observable
final class PagesStore {
    private(set) var archived: [ThreadRow] = []
    private(set) var archiveLoaded = false
    private(set) var usage: UsageReport?
    private(set) var usagePeriod: UsagePeriod = .week
    private(set) var usageLoading = false
    private(set) var usageError: String?
    private(set) var local: LocalSnapshot?
    private(set) var localLoading = false
    private(set) var localError: String?
    private(set) var localActionError: String?
    private(set) var localPending: [String: LocalPendingKey] = [:]
    private(set) var providers: [ProviderStatus] = []
    private(set) var settings: Settings?
    private(set) var keybindings: [Keybinding] = []
    private(set) var pullsProject: String?
    private(set) var pullsRequest: String?
    private(set) var pullsError: String?
    private(set) var pullDetailNumber: UInt64?
    private(set) var pullDetailRequest: String?
    private(set) var pullDetailError: String?

    @ObservationIgnored private let core: CoreHandle
    @ObservationIgnored private let requests: RequestCenter
    @ObservationIgnored private var usageRequest: String?
    @ObservationIgnored private var localRequest: String?

    init(core: CoreHandle, requests: RequestCenter) {
        self.core = core
        self.requests = requests
    }

    private var live: Bool {
        core.studio != nil
    }

    func setArchived(_ threads: [ThreadRow]) {
        archived = threads
        archiveLoaded = true
    }

    func setUsage(request: String, report: UsageReport) {
        if request == usageRequest {
            usageRequest = nil
            usageLoading = false
            usageError = nil
        }
        guard report.period == usagePeriod else { return }
        usage = report
    }

    func setLocal(request: String, snapshot: LocalSnapshot) {
        local = snapshot
        localPending[request] = nil
        guard request == localRequest else { return }
        localRequest = nil
        localLoading = false
        localError = nil
    }

    func setProviders(_ providers: [ProviderStatus]) {
        self.providers = providers
    }

    func setSettings(_ settings: Settings) {
        self.settings = settings
        ThemeStore.shared.apply(settings)
        SnapShotService.shared.update(settings: settings, keybindings: keybindings)
    }

    func setKeybindings(_ bindings: [Keybinding]) {
        keybindings = bindings
        SnapShotService.shared.update(settings: settings, keybindings: bindings)
    }

    func update(_ change: (inout Settings) -> Void) {
        guard var next = settings else { return }
        change(&next)
        guard next != settings else { return }
        settings = next
        ThemeStore.shared.apply(next)
        core.run { $0.updateSettings(settings: next) }
    }

    func setKeybinding(_ command: String, shortcut: String?) {
        core.run { $0.setKeybinding(command: command, shortcut: shortcut) }
    }

    func loadProviders() {
        core.run { $0.loadProviders() }
    }

    func setFavorite(provider: String, model: String, favorite: Bool) {
        core.run { $0.setFavoriteModel(provider: provider, model: model, favorite: favorite) }
    }

    func loadArchived() {
        guard live else { return }
        let request = requests.issue()
        core.run { $0.listArchived(request: request) }
    }

    func unarchive(_ thread: String) {
        archived.removeAll { $0.id == thread }
        core.run { $0.setArchived(thread: thread, archived: false) }
        loadArchived()
    }

    func deleteArchived(_ thread: String) {
        archived.removeAll { $0.id == thread }
        core.run { $0.deleteThread(thread: thread) }
        loadArchived()
    }

    func loadUsage(_ period: UsagePeriod) {
        if period != usagePeriod {
            usagePeriod = period
            usage = nil
        }
        guard live else { return }
        usageError = nil
        usageLoading = true
        let request = requests.issue { [weak self] outcome in
            guard let self, case .failed(let message) = outcome else { return }
            usageRequest = nil
            usageLoading = false
            usageError = message
        }
        usageRequest = request
        core.run { $0.loadUsage(request: request, period: period) }
    }

    func refreshLocal() {
        guard live, localRequest == nil else { return }
        localLoading = local == nil
        let request = requests.issue { [weak self] outcome in
            guard let self, case .failed(let message) = outcome else { return }
            localRequest = nil
            localLoading = false
            localError = message
        }
        localRequest = request
        core.run { $0.localSnapshot(request: request) }
    }

    func perform(_ action: LocalAction, pending key: LocalPendingKey) {
        guard live else { return }
        localActionError = nil
        var request = ""
        request = requests.issue { [weak self] outcome in
            guard let self else { return }
            localPending[request] = nil
            if case .failed(let message) = outcome {
                localActionError = message
            }
        }
        localPending[request] = key
        core.run { $0.localAction(request: request, action: action) }
    }

    func isPending(_ key: LocalPendingKey) -> Bool {
        localPending.values.contains(key)
    }

    func dismissLocalActionError() {
        localActionError = nil
    }

    func loadPullRequests(project: String) {
        pullsProject = project
        guard live else { return }
        pullsError = nil
        let request = requests.issue { [weak self] outcome in
            guard let self, case .failed(let message) = outcome else { return }
            pullsError = message
        }
        pullsRequest = request
        core.run { $0.listPullRequests(request: request, project: project) }
    }

    func showPullRequests(project: String, request: String) {
        pullsProject = project
        pullsRequest = request
    }

    func loadPullRequest(project: String, number: UInt64) {
        pullDetailNumber = number
        pullDetailError = nil
        guard live else { return }
        let request = requests.issue { [weak self] outcome in
            guard let self, case .failed(let message) = outcome else { return }
            pullDetailError = message
        }
        pullDetailRequest = request
        core.run { $0.loadPullRequest(request: request, project: project, number: number) }
    }

    func showPullRequest(number: UInt64, request: String) {
        pullDetailNumber = number
        pullDetailRequest = request
    }

    func setHiddenModel(provider: String, model: String, hidden: Bool) {
        core.run { $0.setHiddenModel(provider: provider, model: model, hidden: hidden) }
    }
}
