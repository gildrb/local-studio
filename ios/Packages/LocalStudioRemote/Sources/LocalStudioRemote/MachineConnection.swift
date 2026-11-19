import Foundation

public enum LinkState: Sendable, Hashable {
    case idle
    case connecting
    case pairing
    case live
    case waiting(attempt: Int, retryAt: Date, reason: String)
    case unpaired
    case incompatible(machine: ProtocolWindow, app: ProtocolWindow)

    public var detail: String? {
        switch self {
        case let .waiting(attempt, _, reason): "attempt \(attempt): \(reason)"
        case .unpaired: "pair again"
        case let .incompatible(machine, app):
            machine.oldest > app.newest
                ? "the machine speaks protocol \(machine.label) and this app \(app.label): update this app"
                : "the machine speaks protocol \(machine.label) and this app \(app.label): update the machine"
        default: nil
        }
    }

    public var label: String {
        switch self {
        case .idle: "idle"
        case .connecting: "connecting"
        case .pairing: "pairing"
        case .live: "live"
        case .waiting: "waiting"
        case .unpaired: "unpaired"
        case .incompatible: "incompatible"
        }
    }
}

public enum ConnectionEvent: Sendable {
    case state(LinkState)
    case hello(MachineIdentity, protocolVersion: Int, resume: ResumeKind, snapshot: [Update])
    case update(seq: UInt64, update: Update)
    case sendAccepted(request: String, duplicate: Bool)
    case sendWaiting(request: String, reason: String, retryAt: Date)
    case sendRejected(request: String, message: String)
    /// A send went out in an earlier server epoch and was never acknowledged. The phone doesn't
    /// retry it on its own (docs/remote.md, Requests): the snapshot shows whether it landed.
    case sendUnconfirmed(request: String)
}

enum DeliveryOutcome: Sendable {
    case done
    case busy
    case failed
}

public struct ConnectionConfig: Sendable {
    public var account: String
    public var device: DeviceProfile
    public var pingInterval: Duration
    public var handshakeTimeout: Duration
    public var initialDelay: Duration
    public var stableAfter: TimeInterval

    public init(
        account: String,
        device: DeviceProfile,
        pingInterval: Duration = .seconds(20),
        handshakeTimeout: Duration = .seconds(10),
        initialDelay: Duration = .zero,
        stableAfter: TimeInterval = 60
    ) {
        self.account = account
        self.device = device
        self.pingInterval = pingInterval
        self.handshakeTimeout = handshakeTimeout
        self.initialDelay = initialDelay
        self.stableAfter = stableAfter
    }
}

private final class ReplyWaiter: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, any Error>?

    init(_ continuation: CheckedContinuation<Data, any Error>) {
        self.continuation = continuation
    }

    func finish(_ result: Result<Data, any Error>) {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(with: result)
    }
}

struct SocketTransport: HandshakeTransport {
    let socket: URLSessionWebSocketTask

    func send(_ message: Data) async throws {
        try await socket.send(.data(message))
    }

    func receive() async throws -> Data {
        switch try await socket.receive() {
        case let .data(data):
            return data
        case let .string(text):
            if case let .incompatible(window) = try? FrameCodec.decode(Data(text.utf8)) {
                throw RemoteError.incompatible(window)
            }
            throw RemoteError.handshake("a text frame during the handshake")
        @unknown default:
            throw RemoteError.handshake("an unknown socket message")
        }
    }
}

public actor MachineConnection {
    public static let unpairedCloseCode = 4401
    public static let replacedCloseCode = 4409
    public static let refusedCloseCode = 4429
    public static let busyCloseCode = 1013
    public static let protocolCloseCode = 1002

    public nonisolated let events: AsyncStream<ConnectionEvent>
    private let sink: AsyncStream<ConnectionEvent>.Continuation
    private let config: ConnectionConfig
    private let credentials: CredentialStore
    private let outbox: Outbox
    private let channel: any SecureChannel
    private let session: URLSession

    private var pairing: PairingLink?
    private var socket: URLSessionWebSocketTask?
    private var secure: (any SecureSession)?
    private var reader = RecordReader()
    private var waiters: [Int: ReplyWaiter] = [:]
    private var nextID = 1
    private var watched: [String] = []
    private var inFlight: Set<String> = []
    private var runner: Task<Void, Never>?
    private var pause: Task<Void, Never>?
    private var pinger: Task<Void, Never>?
    private var busyRetry: Task<Void, Never>?
    private var busyAttempt = 0
    private var attempt = 0
    private var live = false
    private var connectedAt: Date?
    private var epoch: String?
    private var lastSeq: UInt64?
    private var unpaired = false
    private var incompatible: ProtocolWindow?
    private var stopped = false

    public init(config: ConnectionConfig, credentials: CredentialStore, outbox: Outbox, channel: any SecureChannel = NoiseChannel(), pairing: PairingLink? = nil) {
        let (stream, sink) = AsyncStream<ConnectionEvent>.makeStream(bufferingPolicy: .unbounded)
        events = stream
        self.sink = sink
        self.config = config
        self.credentials = credentials
        self.outbox = outbox
        self.channel = channel
        self.pairing = pairing
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
    }

    public func start() {
        guard runner == nil else {
            return
        }
        stopped = false
        runner = Task { await self.run() }
    }

    public func stop() {
        stopped = true
        runner?.cancel()
        runner = nil
        pause?.cancel()
        dropSocket()
        sink.yield(.state(.idle))
    }

    public func wake() async {
        if live {
            do {
                try await ping(timeout: .seconds(3))
            } catch {
                socket?.cancel(with: .goingAway, reason: nil)
            }
            return
        }
        attempt = 0
        pause?.cancel()
    }

    public func watch(_ thread: String) async throws {
        if !watched.contains(thread) {
            watched.append(thread)
        }
        if live {
            try await request("watch", ThreadArgs(thread: thread))
        }
    }

    public func unwatch(_ thread: String) async throws {
        watched.removeAll { $0 == thread }
        if live {
            try await request("unwatch", ThreadArgs(thread: thread))
        }
    }

    public func send(_ thread: String, prompt: PromptDraft, delivery: Delivery) async -> String {
        let entry = await outbox.enqueue(thread: thread, prompt: prompt, delivery: delivery)
        if live && busyRetry == nil {
            Task { await self.deliver(entry) }
        }
        return entry.args.request
    }

    /// Sends an unconfirmed message again, under the same request id.
    public func resend(_ request: String) async {
        guard let entry = await outbox.release(request), live, busyRetry == nil else {
            return
        }
        Task { await self.deliver(entry) }
    }

    public func answerApproval(thread: String, request approval: String, answer: ApprovalAnswer) async throws {
        try await request("answer_approval", AnswerApprovalArgs(thread: thread, request: approval, answer: answer))
    }

    public func loadEarlier(thread: String, before: Int, limit: Int) async throws -> LoadEarlierResult {
        try await request("load_earlier", LoadEarlierArgs(thread: thread, before: before, limit: limit), as: LoadEarlierResult.self)
    }

    public func sendQueuedNow(thread: String, queued: String) async throws {
        try await request("send_queued_now", QueuedArgs(thread: thread, queued: queued))
    }

    public func removeQueued(thread: String, queued: String) async throws {
        try await request("remove_queued", QueuedArgs(thread: thread, queued: queued))
    }

    public func abort(thread: String) async throws {
        try await request("abort", ThreadArgs(thread: thread))
    }

    public func startThread(_ args: StartThreadArgs) async throws {
        var tries = 0
        while true {
            do {
                try await request("start_thread", args)
                sink.yield(.sendAccepted(request: args.draft, duplicate: false))
                return
            } catch let RemoteError.busy(reason) {
                tries += 1
                let delay = Self.backoff(attempt: tries)
                sink.yield(.sendWaiting(request: args.draft, reason: reason, retryAt: Date().addingTimeInterval(delay)))
                try await Task.sleep(for: .seconds(delay))
            }
        }
    }

    public func request<Args: Encodable & Sendable, Answer: Decodable>(_ op: String, _ args: Args, as answer: Answer.Type) async throws -> Answer {
        let data = try await request(op, args)
        do {
            return try JSONDecoder().decode(ResultEnvelope<Answer>.self, from: data).result
        } catch {
            throw RemoteError.unexpected("the \(op) result did not decode: \(error.localizedDescription)")
        }
    }

    @discardableResult
    public func request<Args: Encodable & Sendable>(_ op: String, _ args: Args) async throws -> Data {
        guard live, socket != nil else {
            throw RemoteError.notConnected
        }
        let id = nextID
        nextID += 1
        let json = try FrameCodec.encode(RequestFrame(id: id, op: op, args: args))
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, any Error>) in
            let waiter = ReplyWaiter(continuation)
            waiters[id] = waiter
            do {
                try transmit(json) { error in
                    if error != nil {
                        waiter.finish(.failure(RemoteError.notConnected))
                    }
                }
            } catch {
                waiters.removeValue(forKey: id)
                waiter.finish(.failure(error))
            }
        }
    }

    private func transmit(_ json: Data, completion: @escaping @Sendable ((any Error)?) -> Void) throws {
        guard let socket else {
            throw RemoteError.notConnected
        }
        var sealed: [Data] = []
        for record in try RecordWriter.frame(json) {
            guard let message = try secure?.seal(record) else {
                throw RemoteError.notConnected
            }
            sealed.append(message)
        }
        for (index, message) in sealed.enumerated() {
            let last = index == sealed.count - 1
            socket.send(.data(message)) { error in
                if last || error != nil {
                    completion(error)
                }
            }
        }
    }

    private func routes() -> [URL]? {
        if let pairing {
            return [pairing.url]
        }
        guard let credential = credentials.load(config.account), !credential.urls.isEmpty else {
            return nil
        }
        return credential.orderedURLs
    }

    private func run() async {
        if config.initialDelay > .zero {
            try? await Task.sleep(for: config.initialDelay)
        }
        while !stopped && !Task.isCancelled {
            guard let urls = routes() else {
                unpaired = true
                sink.yield(.state(.unpaired))
                return
            }
            var reason = "closed"
            var floor = 0.0
            for url in urls {
                do {
                    try await connectOnce(url)
                } catch {
                    reason = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
                let closed: Int? = if let socket { await Self.settledCloseCode(of: socket) } else { nil }
                switch closed {
                case Self.unpairedCloseCode:
                    unpaired = true
                case Self.replacedCloseCode:
                    reason = "a newer connection from this phone replaced this one"
                case Self.refusedCloseCode:
                    reason = "the machine refuses this address for a few minutes after repeated failures"
                    floor = 60
                case Self.busyCloseCode:
                    reason = "the machine has too many connections opening"
                case Self.protocolCloseCode:
                    reason = "the machine refused a message that broke the protocol"
                default:
                    break
                }
                let upFor = connectedAt.map { Date().timeIntervalSince($0) }
                connectedAt = nil
                dropSocket()
                if stopped || Task.isCancelled {
                    return
                }
                if unpaired {
                    sink.yield(.state(.unpaired))
                    return
                }
                if let incompatible {
                    sink.yield(.state(.incompatible(machine: incompatible, app: .app)))
                    return
                }
                if let upFor {
                    if upFor >= config.stableAfter {
                        attempt = 0
                    }
                    break
                }
            }
            attempt += 1
            let delay = max(floor, Self.backoff(attempt: attempt))
            sink.yield(.state(.waiting(attempt: attempt, retryAt: Date().addingTimeInterval(delay), reason: reason)))
            let sleeper = Task { _ = try? await Task.sleep(for: .seconds(delay)) }
            pause = sleeper
            await sleeper.value
            pause = nil
        }
    }

    /// URLSession reports a close code it has no case for (1013, 4401, 4409, 4429) as 1005 and
    /// leaves the close frame's payload, code first, in `closeReason`.
    public static func closeCode(of socket: URLSessionWebSocketTask) -> Int {
        let code = socket.closeCode
        guard code == .noStatusReceived || code == .invalid, let payload = socket.closeReason, payload.count >= 2 else {
            return code.rawValue
        }
        let raw = Int(payload[payload.startIndex]) << 8 | Int(payload[payload.startIndex + 1])
        return (1000...4999).contains(raw) ? raw : code.rawValue
    }

    /// A failed `receive()` can return before URLSession sets the close code, so wait up to a second for it.
    public static func settledCloseCode(of socket: URLSessionWebSocketTask) async -> Int {
        for _ in 0..<50 where socket.closeCode == .invalid && socket.closeReason == nil {
            try? await Task.sleep(for: .milliseconds(20))
        }
        return closeCode(of: socket)
    }

    public static func backoff(attempt: Int) -> Double {
        Double.random(in: 0...min(30.0, pow(2.0, Double(max(0, attempt - 1)))))
    }

    private func connectOnce(_ url: URL) async throws {
        let role: HandshakeRole
        let staticKey: Data
        if let pairing {
            sink.yield(.state(.pairing))
            if let health = await Self.health(for: url), !health.window.overlaps(.app) {
                incompatible = health.window
                throw RemoteError.incompatible(health.window)
            }
            staticKey = StaticKey.generate()
            role = .pair(id: pairing.id, psk: pairing.secret, device: config.device.record(id: UUID().uuidString.lowercased()))
        } else if let credential = credentials.load(config.account) {
            sink.yield(.state(.connecting))
            staticKey = credential.staticKey
            role = .known(device: credential.device, machineKey: credential.machineKey)
        } else {
            unpaired = true
            throw RemoteError.unpaired
        }

        let socket = session.webSocketTask(with: url)
        socket.maximumMessageSize = 2 * RecordWriter.maxMessage
        self.socket = socket
        socket.resume()
        let timeout = config.handshakeTimeout
        let watchdog = Task {
            try await Task.sleep(for: timeout)
            socket.cancel(with: .goingAway, reason: nil)
        }
        defer { watchdog.cancel() }

        let header = try FrameCodec.encode(OpeningHeader(role: role))
        guard let headerText = String(bytes: header, encoding: .utf8) else {
            throw RemoteError.unexpected("the opening header is not UTF-8")
        }
        try await socket.send(.string(headerText))
        let established: any SecureSession
        do {
            established = try await channel.handshake(role, staticKey: staticKey, prologue: Data(remotePrologue.utf8) + header, over: SocketTransport(socket: socket))
        } catch let RemoteError.incompatible(window) {
            incompatible = window
            throw RemoteError.incompatible(window)
        }
        secure = established
        reader = RecordReader()
        // The pairing is trusted only once the server's hello decrypts: in XXpsk3 that is the
        // first message whose keys prove the server holds the psk (docs/remote.md, Pairing).
        var proposed: MachineCredential?
        if case let .pair(_, _, device) = role {
            proposed = MachineCredential(device: device.id, staticKey: staticKey, machineKey: established.remoteStatic, urls: [url])
        }

        let device = config.device
        let hello = HelloFrame(
            device: HelloDevice(name: device.name, app: device.app, channel: device.channel),
            resume: ResumeState(seq: epoch == nil ? nil : lastSeq, epoch: epoch, watch: watched)
        )
        let watchedAtHello = watched
        try transmit(try FrameCodec.encode(hello)) { _ in }
        switch try await receiveFrame(socket) {
        case let .hello(reply):
            watchdog.cancel()
            if !ProtocolWindow.app.contains(reply.protocolVersion) {
                let machine = ProtocolWindow(newest: reply.protocolVersion, oldest: reply.protocolVersion)
                incompatible = machine
                throw RemoteError.incompatible(machine)
            }
            if let proposed {
                guard credentials.save(proposed, for: config.account) else {
                    throw RemoteError.unexpected("the Keychain refused the machine credential")
                }
                pairing = nil
            }
            if let baseline = reply.seq {
                lastSeq = baseline
            } else if reply.resume == .snapshot || reply.epoch != epoch {
                lastSeq = nil
            }
            epoch = reply.epoch
            if var credential = credentials.load(config.account) {
                credential.machine = reply.machine.id
                credential.lastSuccess[url.absoluteString] = Date()
                credential.replaceURLs(reply.machine.urls ?? [])
                credentials.save(credential, for: config.account)
            }
            live = true
            connectedAt = Date()
            sink.yield(.hello(reply.machine, protocolVersion: reply.protocolVersion, resume: reply.resume, snapshot: reply.snapshot))
            sink.yield(.state(.live))
        case let .incompatible(machine):
            incompatible = machine
            throw RemoteError.incompatible(machine)
        default:
            throw RemoteError.unexpected("the machine did not answer hello")
        }

        startPinger()
        for thread in watched where !watchedAtHello.contains(thread) {
            Task { try? await self.request("watch", ThreadArgs(thread: thread)) }
        }
        for thread in watchedAtHello where !watched.contains(thread) {
            Task { try? await self.request("unwatch", ThreadArgs(thread: thread)) }
        }
        Task { await self.flushOutbox() }
        while true {
            try handle(try await receiveFrame(socket))
        }
    }

    public static func healthURL(for socket: URL) -> URL? {
        guard var components = URLComponents(url: socket, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.scheme = components.scheme?.lowercased() == "wss" ? "https" : "http"
        var path = components.path
        if path.hasSuffix("/ws") {
            path.removeLast(3)
        }
        components.path = path + "/health"
        components.query = nil
        components.fragment = nil
        return components.url
    }

    public static func health(for socket: URL) async -> HealthReport? {
        guard let url = healthURL(for: socket) else {
            return nil
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 5
        guard
            let (data, response) = try? await URLSession.shared.data(for: request),
            (response as? HTTPURLResponse)?.statusCode == 200
        else {
            return nil
        }
        return try? JSONDecoder().decode(HealthReport.self, from: data)
    }

    private func receiveFrame(_ socket: URLSessionWebSocketTask) async throws -> ServerFrame {
        while true {
            let message = try await socket.receive()
            guard case let .data(data) = message else {
                throw RemoteError.unexpected("a text frame after the handshake")
            }
            guard let plaintext = try secure?.open(data) else {
                throw RemoteError.notConnected
            }
            if case let .frame(json) = try reader.read(plaintext) {
                return try FrameCodec.decode(json)
            }
        }
    }

    private func handle(_ frame: ServerFrame) throws {
        switch frame {
        case let .update(seq, update):
            lastSeq = seq
            sink.yield(.update(seq: seq, update: update))
        case let .reply(id, result):
            waiters.removeValue(forKey: id)?.finish(result.mapError { $0 as any Error })
        case let .incompatible(machine):
            incompatible = machine
            throw RemoteError.incompatible(machine)
        case .hello, .unknown:
            return
        }
    }

    private func flushOutbox() async {
        let current = epoch ?? ""
        for entry in await outbox.pending() {
            if let sent = entry.sentEpoch, sent != current {
                await outbox.markUnconfirmed(entry.args.request)
                sink.yield(.sendUnconfirmed(request: entry.args.request))
                continue
            }
            if entry.unconfirmed == true {
                continue
            }
            guard live, await deliver(entry) != .busy else {
                return
            }
        }
    }

    @discardableResult
    private func deliver(_ entry: OutboxEntry) async -> DeliveryOutcome {
        let request = entry.args.request
        guard !inFlight.contains(request) else {
            return .failed
        }
        inFlight.insert(request)
        defer { inFlight.remove(request) }
        await outbox.markSent(request, epoch: epoch ?? "")
        do {
            let reply = try await self.request("send", entry.args)
            let duplicate = (try? JSONDecoder().decode(DuplicateFlag.self, from: reply))?.duplicate ?? false
            await outbox.remove(request)
            busyAttempt = 0
            sink.yield(.sendAccepted(request: request, duplicate: duplicate))
            return .done
        } catch let RemoteError.busy(reason) {
            retryWhenBusy(request: request, reason: reason)
            return .busy
        } catch let RemoteError.server(message) {
            await outbox.remove(request)
            sink.yield(.sendRejected(request: request, message: message))
            return .failed
        } catch {
            return .failed
        }
    }

    private func retryWhenBusy(request: String, reason: String) {
        guard busyRetry == nil else {
            return
        }
        busyAttempt += 1
        let delay = Self.backoff(attempt: busyAttempt)
        sink.yield(.sendWaiting(request: request, reason: reason, retryAt: Date().addingTimeInterval(delay)))
        busyRetry = Task {
            try? await Task.sleep(for: .seconds(delay))
            if Task.isCancelled {
                return
            }
            self.busyRetry = nil
            await self.flushOutbox()
        }
    }

    private func startPinger() {
        pinger?.cancel()
        let interval = config.pingInterval
        pinger = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                if Task.isCancelled {
                    return
                }
                do {
                    try await self.ping(timeout: .seconds(10))
                } catch {
                    self.cancelSocket()
                    return
                }
            }
        }
    }

    private func ping(timeout: Duration) async throws {
        let socket = socket
        let watchdog = Task {
            try await Task.sleep(for: timeout)
            socket?.cancel(with: .goingAway, reason: nil)
        }
        defer { watchdog.cancel() }
        try await request("ping", EmptyArgs())
    }

    private func cancelSocket() {
        socket?.cancel(with: .goingAway, reason: nil)
    }

    private func dropSocket() {
        live = false
        pinger?.cancel()
        pinger = nil
        busyRetry?.cancel()
        busyRetry = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        secure = nil
        reader = RecordReader()
        let pending = waiters
        waiters = [:]
        inFlight = []
        for waiter in pending.values {
            waiter.finish(.failure(RemoteError.notConnected))
        }
    }
}
