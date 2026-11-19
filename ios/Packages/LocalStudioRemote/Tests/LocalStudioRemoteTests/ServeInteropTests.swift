import Foundation
import Testing
@testable import LocalStudioRemote

/// Pairs with a real `local-studio-serve` through `XXpsk3`, then reconnects through `KK`, using
/// the app's own Noise state machine, records and frame codec, so a pass here means the phone
/// and `snow` agree end to end. It then checks the docs/remote.md limits a phone relies on: a
/// replayed `KK` first message never replaces the live socket, and a flooded local listener
/// still lets the plain loopback client in. Set LOCAL_STUDIO_PAIR_LINK to a fresh `pair` link.
@Suite struct ServeInteropTests {
    struct Opened {
        var session: any SecureSession
        var reader = RecordReader()
        let socket: URLSessionWebSocketTask
        let header: Data
        let sent: [Data]
    }

    final class Recorder: HandshakeTransport, @unchecked Sendable {
        let inner: SocketTransport
        private let lock = NSLock()
        private var messages: [Data] = []

        init(_ socket: URLSessionWebSocketTask) {
            inner = SocketTransport(socket: socket)
        }

        var sent: [Data] {
            lock.withLock { messages }
        }

        func send(_ message: Data) async throws {
            lock.withLock { messages.append(message) }
            try await inner.send(message)
        }

        func receive() async throws -> Data {
            try await inner.receive()
        }
    }

    static let link = ProcessInfo.processInfo.environment["LOCAL_STUDIO_PAIR_LINK"].flatMap(PairingLink.init(string:))

    func socket(_ url: URL, login: String? = nil) -> URLSessionWebSocketTask {
        var request = URLRequest(url: url)
        if let login {
            request.setValue(login, forHTTPHeaderField: "Tailscale-User-Login")
        }
        let socket = URLSession.shared.webSocketTask(with: request)
        socket.resume()
        return socket
    }

    func open(_ url: URL, role: HandshakeRole, staticKey: Data) async throws -> Opened {
        let socket = socket(url)
        let header = try FrameCodec.encode(OpeningHeader(role: role))
        try await socket.send(.string(try #require(String(bytes: header, encoding: .utf8))))
        let recorder = Recorder(socket)
        let session = try await NoiseChannel().handshake(role, staticKey: staticKey, prologue: Data(remotePrologue.utf8) + header, over: recorder)
        return Opened(session: session, socket: socket, header: header, sent: recorder.sent)
    }

    func transmit(_ opened: inout Opened, _ frame: Data) async throws {
        for record in try RecordWriter.frame(frame) {
            try await opened.socket.send(.data(try opened.session.seal(record)))
        }
    }

    func next(_ opened: inout Opened) async throws -> ServerFrame {
        while true {
            guard case let .data(data) = try await opened.socket.receive() else {
                throw RemoteError.unexpected("a text frame after the handshake")
            }
            if case let .frame(json) = try opened.reader.read(try opened.session.open(data)) {
                return try FrameCodec.decode(json)
            }
        }
    }

    func hello(_ opened: inout Opened, resume: ResumeState) async throws -> HelloReplyValue {
        try await transmit(&opened, try FrameCodec.encode(HelloFrame(device: HelloDevice(name: "Interop Phone", app: "0.0.0", channel: "dev"), resume: resume)))
        while true {
            if case let .hello(reply) = try await next(&opened) {
                return reply
            }
        }
    }

    func ping(_ opened: inout Opened, id: Int) async throws -> Bool {
        try await transmit(&opened, try FrameCodec.encode(RequestFrame(id: id, op: "ping", args: EmptyArgs())))
        while true {
            if case let .reply(re, result) = try await next(&opened), re == id {
                return (try? result.get()) != nil
            }
        }
    }

    func closeCode(_ socket: URLSessionWebSocketTask) async -> Int {
        let bound = Task {
            try await Task.sleep(for: .seconds(5))
            socket.cancel()
        }
        while (try? await socket.receive()) != nil {}
        bound.cancel()
        return await MachineConnection.settledCloseCode(of: socket)
    }

    func opened(_ socket: URLSessionWebSocketTask) async -> Bool {
        await withCheckedContinuation { continuation in
            socket.sendPing { error in continuation.resume(returning: error == nil) }
        }
    }

    @Test(.enabled(if: link != nil)) func pairsReconnectsAndHoldsTheLimits() async throws {
        let link = try #require(Self.link)
        let staticKey = StaticKey.generate()
        let device = DeviceInfo(id: UUID().uuidString.lowercased(), name: "Interop Phone", platform: "ios", app: "0.0.0", channel: "dev")
        var paired = try await open(link.url, role: .pair(id: link.id, psk: link.secret, device: device), staticKey: staticKey)
        let first = try await hello(&paired, resume: ResumeState(seq: nil, epoch: nil, watch: []))
        #expect(first.resume == .snapshot)
        let machineKey = paired.session.remoteStatic
        paired.socket.cancel(with: .goingAway, reason: nil)

        let known = HandshakeRole.known(device: device.id, machineKey: machineKey)
        var live = try await open(link.url, role: known, staticKey: staticKey)
        let second = try await hello(&live, resume: ResumeState(seq: first.seq, epoch: first.epoch, watch: []))
        #expect(second.epoch == first.epoch)
        #expect(second.resume == .delta)

        let replay = socket(link.url)
        try await replay.send(.string(try #require(String(bytes: live.header, encoding: .utf8))))
        try await replay.send(.data(try #require(live.sent.first)))
        guard case .data = try await replay.receive() else {
            Issue.record("a replayed KK first message got no second message")
            return
        }
        #expect(try await ping(&live, id: 1), "the live socket stopped answering once a replayed handshake completed")
        try await replay.send(.data(Data((0..<64).map { _ in UInt8.random(in: 0...255) })))
        #expect(await closeCode(replay) == MachineConnection.protocolCloseCode, "a replayed KK handshake with no valid hello was not closed with 1002")
        #expect(try await ping(&live, id: 2), "a replayed KK handshake closed the live socket")

        var flood: [URLSessionWebSocketTask] = []
        for login in ["flood-1@example.com", "flood-2@example.com", "flood-3@example.com"] {
            for _ in 0..<2 {
                let held = socket(link.url, login: login)
                #expect(await opened(held), "a pending socket from \(login) was refused early")
                flood.append(held)
            }
        }
        let seventh = socket(link.url, login: "flood-4@example.com")
        #expect(await closeCode(seventh) == MachineConnection.busyCloseCode, "a seventh non-loopback pending socket took a slot kept for loopback")
        var back = try await open(link.url, role: known, staticKey: staticKey)
        let third = try await hello(&back, resume: ResumeState(seq: second.seq, epoch: second.epoch, watch: []))
        #expect(third.resume == .delta, "the plain loopback client was not let in while 6 others were pending")
        #expect(await closeCode(live.socket) == MachineConnection.replacedCloseCode, "the older socket was not replaced with 4409 after the new hello")
        for held in flood {
            held.cancel(with: .goingAway, reason: nil)
        }
        back.socket.cancel(with: .goingAway, reason: nil)
    }
}
