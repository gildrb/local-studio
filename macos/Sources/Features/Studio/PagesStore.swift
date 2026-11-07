import Foundation
import LocalStudioKit
import Observation

@MainActor
@Observable
final class PagesStore {
    private(set) var archived: [ThreadRow] = []
    private(set) var usage: UsageReport?
    private(set) var local: LocalSnapshot?
    private(set) var providers: [ProviderStatus] = []
    private(set) var settings: Settings?
    private(set) var keybindings: [Keybinding] = []

    @ObservationIgnored private let core: CoreHandle
    @ObservationIgnored private let requests: RequestCenter

    init(core: CoreHandle, requests: RequestCenter) {
        self.core = core
        self.requests = requests
    }

    func setArchived(_ threads: [ThreadRow]) {
        archived = threads
    }

    func setUsage(_ report: UsageReport) {
        usage = report
    }

    func setLocal(_ snapshot: LocalSnapshot) {
        local = snapshot
    }

    func setProviders(_ providers: [ProviderStatus]) {
        self.providers = providers
    }

    func setSettings(_ settings: Settings) {
        self.settings = settings
    }

    func setKeybindings(_ bindings: [Keybinding]) {
        keybindings = bindings
    }
}
