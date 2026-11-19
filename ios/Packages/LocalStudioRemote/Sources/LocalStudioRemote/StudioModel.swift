import Foundation
import Network
import Observation

public struct StudioEnvironment: Sendable {
    public var directory: URL
    public var keychainService: String
    public var device: DeviceProfile
    public var connectDelay: Duration
    public var passThrough: Bool

    public init(directory: URL, keychainService: String, device: DeviceProfile, connectDelay: Duration = .zero, passThrough: Bool = false) {
        self.passThrough = passThrough
        self.directory = directory
        self.keychainService = keychainService
        self.device = device
        self.connectDelay = connectDelay
    }

    public func wipe() {
        try? FileManager.default.removeItem(at: directory)
        CredentialStore(service: keychainService).removeAll()
    }
}

@Observable
@MainActor
public final class StudioModel {
    public private(set) var machines: [MachineModel] = []
    @ObservationIgnored public var onNotification: (@MainActor (MachineModel, StudioNotification) -> Void)?
    @ObservationIgnored let environment: StudioEnvironment
    @ObservationIgnored let cache: CacheStore
    @ObservationIgnored let credentials: CredentialStore
    @ObservationIgnored private let pathMonitor = NWPathMonitor()
    @ObservationIgnored private var lastPath: NWPath.Status?
    @ObservationIgnored private var lastInterfaces: [NWInterface.InterfaceType] = []

    public init(environment: StudioEnvironment) {
        self.environment = environment
        cache = CacheStore(directory: environment.directory)
        credentials = CredentialStore(service: environment.keychainService)
        let perf = Perf.shared
        for record in CacheStore.loadMachines(in: environment.directory) {
            let cached = CacheStore.loadCache(in: environment.directory, machine: record.id)
            machines.append(MachineModel(record: record, cached: cached, studio: self, pairing: nil))
        }
        if machines.contains(where: { !$0.threads.isEmpty }) {
            perf.threadListShown(fromCache: true)
        }
    }

    public func start() {
        for machine in machines {
            machine.start()
        }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let status = path.status
            let interfaces = path.availableInterfaces.map(\.type)
            Task { @MainActor in
                self?.pathChanged(status: status, interfaces: interfaces)
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "com.baney.localstudio.path"))
    }

    public func appBecameActive() {
        wakeAll()
    }

    @discardableResult
    public func pair(_ link: PairingLink) -> MachineModel {
        let record = MachineRecord(id: UUID().uuidString.lowercased(), name: link.name, machine: nil)
        let machine = MachineModel(record: record, cached: nil, studio: self, pairing: link)
        machines.append(machine)
        saveRecords()
        machine.start()
        return machine
    }

    public func remove(_ machine: MachineModel) {
        machine.stop()
        machines.removeAll { $0 === machine }
        credentials.remove(machine.id)
        saveRecords()
        let cache = cache
        let id = machine.id
        Task { await cache.removeCache(machine: id) }
    }

    func saveRecords() {
        let records = machines.map(\.record)
        let cache = cache
        Task { await cache.saveMachines(records) }
    }

    private func wakeAll() {
        for machine in machines {
            machine.wake()
        }
    }

    private func pathChanged(status: NWPath.Status, interfaces: [NWInterface.InterfaceType]) {
        defer {
            lastPath = status
            lastInterfaces = interfaces
        }
        guard let lastPath else {
            return
        }
        if status == .satisfied && (lastPath != .satisfied || interfaces != lastInterfaces) {
            wakeAll()
        }
    }
}

public enum ListSource: String, Sendable {
    case none
    case cache
    case live
}

@Observable
@MainActor
public final class MachineModel: Identifiable {
    public let id: String
    public private(set) var record: MachineRecord
    public private(set) var link: LinkState = .idle
    public private(set) var listSource: ListSource = .none
    public private(set) var projects: [Project] = []
    public private(set) var threads: [ThreadRow] = []
    public private(set) var transcripts: [String: TranscriptWindow] = [:]
    public private(set) var infos: [String: ThreadInfo] = [:]
    public private(set) var approvals: [String: [Approval]] = [:]
    public private(set) var queues: [String: [QueuedMessage]] = [:]
    public private(set) var models = ModelCatalog()
    public private(set) var connection: Connection?
    public private(set) var notices: [String] = []
    public private(set) var lastNotification: StudioNotification?
    public private(set) var lastError: String?
    public private(set) var pendingSends: [String: String] = [:]
    public private(set) var waitingSends: [String: String] = [:]
    /// Sends from an earlier server epoch with no acknowledgement, by request id to thread.
    public private(set) var unconfirmedSends: [String: String] = [:]
    public private(set) var duplicateSends = 0
    public private(set) var cacheSaved = false
    public private(set) var lastSeq: UInt64 = 0

    @ObservationIgnored private weak var studio: StudioModel?
    @ObservationIgnored private let remote: MachineConnection
    @ObservationIgnored private var listener: Task<Void, Never>?
    @ObservationIgnored private var saver: Task<Void, Never>?
    @ObservationIgnored private var watching: Set<String> = []
    @ObservationIgnored private var lastChange = Date.distantPast

    init(record: MachineRecord, cached: MachineCache?, studio: StudioModel, pairing: PairingLink?) {
        id = record.id
        self.record = record
        self.studio = studio
        let environment = studio.environment
        let config = ConnectionConfig(account: record.id, device: environment.device, initialDelay: environment.connectDelay)
        remote = MachineConnection(
            config: config,
            credentials: studio.credentials,
            outbox: Outbox(file: CacheStore.outboxFile(in: environment.directory, machine: record.id)),
            channel: environment.passThrough ? PassThroughChannel() : NoiseChannel(),
            pairing: pairing
        )
        if let cached {
            projects = cached.projects
            threads = cached.threads
            transcripts = cached.transcripts
            infos = cached.infos
            listSource = cached.threads.isEmpty ? .none : .cache
            cacheSaved = true
        }
    }

    public var name: String { record.machine?.name ?? record.name }

    func start() {
        guard listener == nil else {
            return
        }
        let stream = remote.events
        listener = Task { [weak self] in
            for await event in stream {
                guard let self else {
                    return
                }
                self.handle(event)
            }
        }
        let remote = remote
        Task { await remote.start() }
    }

    func stop() {
        listener?.cancel()
        listener = nil
        let remote = remote
        Task { await remote.stop() }
    }

    func wake() {
        let remote = remote
        Task { await remote.wake() }
    }

    public func thread(_ id: String) -> ThreadRow? {
        threads.first { $0.id == id }
    }

    public func watch(_ thread: String) {
        guard watching.insert(thread).inserted else {
            return
        }
        perform { try await $0.watch(thread) }
    }

    public func unwatch(_ thread: String) {
        guard watching.remove(thread) != nil else {
            return
        }
        perform { try await $0.unwatch(thread) }
    }

    public func send(_ text: String, thread: String, delivery: Delivery = .default) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }
        Perf.shared.sendStarted(thread: thread)
        let remote = remote
        Task {
            let request = await remote.send(thread, prompt: PromptDraft(text: trimmed), delivery: delivery)
            self.pendingSends[request] = thread
        }
    }

    public func resend(_ request: String) {
        guard unconfirmedSends.removeValue(forKey: request) != nil else {
            return
        }
        let remote = remote
        Task { await remote.resend(request) }
    }

    public func answer(_ approval: Approval, thread: String, answer: ApprovalAnswer) {
        perform { try await $0.answerApproval(thread: thread, request: approval.requestId, answer: answer) }
    }

    public func loadEarlier(_ thread: String, limit: Int = 100) {
        guard let window = transcripts[thread], window.earlier > 0 else {
            return
        }
        let before = window.earlier
        let remote = remote
        Task {
            do {
                let page = try await remote.loadEarlier(thread: thread, before: before, limit: limit)
                if self.transcripts[page.thread]?.prepend(page, before: before) == true {
                    self.scheduleSave()
                }
            } catch {
                self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    public func sendQueuedNow(_ queued: QueuedMessage, thread: String) {
        perform { try await $0.sendQueuedNow(thread: thread, queued: queued.id) }
    }

    public func removeQueued(_ queued: QueuedMessage, thread: String) {
        perform { try await $0.removeQueued(thread: thread, queued: queued.id) }
    }

    public func abort(_ thread: String) {
        perform { try await $0.abort(thread: thread) }
    }

    public func startThread(project: String?, text: String, settings: ThreadSettings = ThreadSettings()) {
        let args = StartThreadArgs(draft: "ios-" + UUID().uuidString.lowercased(), project: project, prompt: PromptDraft(text: text), settings: settings)
        perform { try await $0.startThread(args) }
    }

    private func perform(_ work: @escaping @Sendable (MachineConnection) async throws -> Void) {
        let remote = remote
        Task {
            do {
                try await work(remote)
            } catch {
                self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func handle(_ event: ConnectionEvent) {
        switch event {
        case let .state(state):
            link = state
        case let .hello(machine, _, _, snapshot):
            if record.machine != machine {
                record.machine = machine
                studio?.saveRecords()
            }
            lastError = nil
            for update in snapshot {
                apply(update)
            }
            listSource = .live
            Perf.shared.threadListShown(fromCache: false)
            scheduleSave()
        case let .update(seq, update):
            lastSeq = seq
            apply(update)
            scheduleSave()
        case let .sendAccepted(request, duplicate):
            pendingSends.removeValue(forKey: request)
            waitingSends.removeValue(forKey: request)
            if duplicate {
                duplicateSends += 1
            }
        case let .sendWaiting(request, reason, _):
            waitingSends[request] = reason
        case let .sendUnconfirmed(request):
            unconfirmedSends[request] = pendingSends[request] ?? ""
        case let .sendRejected(request, message):
            pendingSends.removeValue(forKey: request)
            waitingSends.removeValue(forKey: request)
            lastError = message
        }
    }

    private func apply(_ update: Update) {
        switch update {
        case let .connection(state):
            connection = state
        case let .projects(list):
            projects = list
        case let .threads(list):
            threads = list
        case let .threadStarted(draft, _):
            waitingSends.removeValue(forKey: draft)
        case let .thread(thread, info):
            infos[thread] = info
        case let .transcript(thread, op):
            transcripts[thread, default: TranscriptWindow()].apply(op)
            Perf.shared.transcriptUpdated(thread: thread)
        case let .approvals(thread, list):
            approvals[thread] = list
        case let .queue(thread, list):
            queues[thread] = list
        case .composerText, .daemonDefault, .other:
            return
        case let .models(catalog):
            models = catalog
        case let .notification(note):
            lastNotification = note
            studio?.onNotification?(self, note)
        case let .requestDone(request, _):
            pendingSends.removeValue(forKey: request)
            waitingSends.removeValue(forKey: request)
        case let .requestFailed(request, message):
            pendingSends.removeValue(forKey: request)
            lastError = message
        case let .notice(level, text):
            notices.append("\(level.rawValue): \(text)")
            if notices.count > 20 {
                notices.removeFirst(notices.count - 20)
            }
        }
    }

    private func scheduleSave() {
        cacheSaved = false
        lastChange = Date()
        guard saver == nil, let cache = studio?.cache else {
            return
        }
        saver = Task {
            try? await Task.sleep(for: .milliseconds(300))
            let snapshot = self.cacheSnapshot()
            await cache.saveCache(snapshot, machine: self.id)
            self.saver = nil
            if self.lastChange > snapshot.savedAt {
                self.scheduleSave()
            } else {
                self.cacheSaved = true
            }
        }
    }

    private func cacheSnapshot() -> MachineCache {
        let recent = threads.sorted { $0.updatedAt > $1.updatedAt }.prefix(8).map(\.id)
        let keep = Set(recent).union(watching)
        var windows: [String: TranscriptWindow] = [:]
        for id in keep {
            if let window = transcripts[id] {
                windows[id] = window.trimmed(to: 60)
            }
        }
        return MachineCache(
            projects: projects,
            threads: threads,
            transcripts: windows,
            infos: infos.filter { keep.contains($0.key) },
            savedAt: Date()
        )
    }
}
