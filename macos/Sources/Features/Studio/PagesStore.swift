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

struct KeybindingIndex {
    private var byCommand: [String: Keybinding] = [:]
    private var byChord: [String: [Keybinding]] = [:]

    init(_ bindings: [Keybinding] = []) {
        for binding in bindings {
            if byCommand[binding.command] == nil {
                byCommand[binding.command] = binding
            }
            if let chord = binding.shortcut {
                byChord[chord, default: []].append(binding)
            }
        }
    }

    func binding(_ command: String) -> Keybinding? {
        byCommand[command]
    }

    func sharing(_ chord: String) -> [Keybinding] {
        byChord[chord] ?? []
    }
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
    private(set) var localDashboard: LocalDashboard?
    private(set) var providers: [ProviderStatus] = []
    private(set) var engines: [LocalEngine] = []
    private(set) var providerErrors: [String] = []
    private(set) var providersLoaded = false
    private(set) var providerPending: Set<String> = []
    private(set) var providerActionError: String?
    private(set) var settings: Settings?
    private(set) var keybindings: [Keybinding] = []
    private(set) var keybindingIndex = KeybindingIndex()
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
    @ObservationIgnored private var dashboardTarget: String?
    @ObservationIgnored private var discoveries: [String: (DiscoveryOutcome) -> Void] = [:]

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

    func setLocalDashboard(_ dashboard: LocalDashboard) {
        guard dashboardTarget == nil || dashboard.controller == dashboardTarget, dashboard != localDashboard else { return }
        localDashboard = dashboard
    }

    func watchLocalDashboard(_ controller: String?) {
        guard controller != dashboardTarget else { return }
        dashboardTarget = controller
        if let controller, localDashboard?.controller != controller {
            localDashboard = nil
        }
        guard live else { return }
        core.run { $0.watchLocalDashboard(controller: controller) }
    }

    func setProviders(_ providers: [ProviderStatus], engines: [LocalEngine], errors: [String]) {
        self.providers = providers
        self.engines = engines
        providerErrors = errors
        providersLoaded = true
    }

    func discovered(request: String, baseUrl: String, models: [ProviderModel]) {
        discoveries.removeValue(forKey: request)?(.models(baseUrl: baseUrl, models: models))
    }

    func discoverModels(baseUrl: String, api: ProviderApi, key: String?, provider: String?, finished: @escaping (DiscoveryOutcome) -> Void) {
        guard live else {
            finished(.failed("Local Studio is not connected to the agent daemon."))
            return
        }
        var request = ""
        request = requests.issue { [weak self] outcome in
            guard let self, case .failed(let message) = outcome else { return }
            discoveries.removeValue(forKey: request)?(.failed(message))
        }
        discoveries[request] = finished
        core.run { $0.discoverProviderModels(request: request, baseUrl: baseUrl, api: api, key: key, provider: provider) }
    }

    func addCustomProvider(_ provider: CustomProvider, finished: @escaping (RequestOutcome) -> Void) {
        providerAction("add", finished: finished) { $0.addCustomProvider(request: $1, provider: provider) }
    }

    func updateCustomProvider(_ id: String, _ provider: CustomProvider, finished: @escaping (RequestOutcome) -> Void) {
        providerAction(id, finished: finished) { $0.updateCustomProvider(request: $1, id: id, provider: provider) }
    }

    func removeCustomProvider(_ id: String) {
        providerAction(id) { $0.removeCustomProvider(request: $1, id: id) }
    }

    func refreshProviderModels(_ id: String) {
        providerAction(id) { $0.refreshProviderModels(request: $1, id: id) }
    }

    func setProviderKey(_ provider: String, key: String?) {
        providerAction(provider) { $0.setProviderKey(request: $1, provider: provider, key: key) }
    }

    func useLocalEngine(_ engine: LocalEngine) {
        providerAction(engine.id) { $0.useLocalEngine(request: $1, engine: engine.id) }
    }

    func isProviderPending(_ id: String) -> Bool {
        providerPending.contains(id)
    }

    func dismissProviderActionError() {
        providerActionError = nil
    }

    private func providerAction(_ id: String, finished: ((RequestOutcome) -> Void)? = nil, _ call: @escaping (Studio, String) -> Void) {
        let report: (RequestOutcome) -> Void = finished ?? { [weak self] outcome in
            if case .failed(let message) = outcome {
                self?.providerActionError = message
            }
        }
        guard live else {
            report(.failed("Local Studio is not connected to the agent daemon."))
            return
        }
        providerActionError = nil
        providerPending.insert(id)
        let request = requests.issue { [weak self] outcome in
            self?.providerPending.remove(id)
            report(outcome)
        }
        core.run { call($0, request) }
    }

    func setSettings(_ settings: Settings) {
        self.settings = settings
        ThemeStore.shared.apply(settings)
        SnapShotService.shared.update(settings: settings, keybindings: keybindings)
    }

    func setKeybindings(_ bindings: [Keybinding]) {
        keybindings = bindings
        keybindingIndex = KeybindingIndex(bindings)
        SnapShotService.shared.update(settings: settings, keybindings: bindings)
    }

    private(set) var daemon: (socket: String, version: String?, pid: UInt32?)?

    func setDaemon(socket: String, version: String?, pid: UInt32?) {
        daemon = (socket, version, pid)
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

    func cleanupWorktrees(_ finished: @escaping (RequestOutcome) -> Void) {
        let request = requests.issue(onOutcome: finished)
        core.run { $0.cleanupWorktrees(request: request) }
    }

}

enum DiscoveryOutcome {
    case models(baseUrl: String, models: [ProviderModel])
    case failed(String)
}
