import Foundation

public let remoteProtocolVersion = 2
public let remoteMinProtocol = 2
public let remotePrologue = "local-studio-remote/1\n"

public struct ProtocolWindow: Codable, Sendable, Hashable {
    public var newest: Int
    public var oldest: Int

    public init(newest: Int, oldest: Int) {
        self.newest = newest
        self.oldest = oldest
    }

    public static let app = ProtocolWindow(newest: remoteProtocolVersion, oldest: remoteMinProtocol)

    public func overlaps(_ other: ProtocolWindow) -> Bool {
        oldest <= other.newest && other.oldest <= newest
    }

    public func contains(_ version: Int) -> Bool {
        (oldest...newest).contains(version)
    }

    public var label: String {
        oldest == newest ? "\(newest)" : "\(oldest) to \(newest)"
    }
}

public struct HealthReport: Decodable, Sendable, Hashable {
    public var ok: Bool
    public var `protocol`: Int
    public var minProtocol: Int?

    enum CodingKeys: String, CodingKey {
        case ok
        case `protocol`
        case minProtocol = "min_protocol"
    }

    public var window: ProtocolWindow {
        ProtocolWindow(newest: `protocol`, oldest: minProtocol ?? `protocol`)
    }
}

public struct DeviceProfile: Sendable, Hashable {
    public var name: String
    public var platform: String
    public var app: String
    public var channel: String

    public init(name: String, platform: String = "ios", app: String, channel: String) {
        self.name = name
        self.platform = platform
        self.app = app
        self.channel = channel
    }

    public func record(id: String) -> DeviceInfo {
        DeviceInfo(id: id, name: name, platform: platform, app: app, channel: channel)
    }
}

public struct DeviceInfo: Codable, Sendable, Hashable {
    public var id: String
    public var name: String
    public var platform: String
    public var app: String
    public var channel: String
}

public struct MachineIdentity: Codable, Sendable, Hashable {
    public var id: String
    public var name: String
    public var os: String?
    public var version: String?
    public var channel: String?
    public var urls: [String]?
}

struct OpeningHeader: Encodable {
    let v = 1
    let pattern: String
    let device: String?
    let pair: String?
    let `protocol` = remoteProtocolVersion
    let minProtocol = remoteMinProtocol

    enum CodingKeys: String, CodingKey {
        case v
        case pattern
        case device
        case pair
        case `protocol`
        case minProtocol = "min_protocol"
    }

    init(role: HandshakeRole) {
        pattern = role.pattern
        switch role {
        case let .pair(id, _, _):
            device = nil
            pair = id
        case let .known(device, _):
            self.device = device
            pair = nil
        }
    }
}

struct HelloDevice: Encodable {
    let name: String
    let app: String
    let channel: String
}

struct ResumeState: Encodable {
    let seq: UInt64?
    let epoch: String?
    let watch: [String]
}

struct HelloFrame: Encodable {
    let op = "hello"
    let device: HelloDevice
    let resume: ResumeState
}

struct EmptyArgs: Codable, Sendable {}

struct RequestFrame<Args: Encodable>: Encodable {
    let id: Int
    let op: String
    let args: Args
}

public struct ThreadArgs: Codable, Sendable, Hashable {
    public var thread: String
}

public struct SendArgs: Codable, Sendable, Hashable {
    public var request: String
    public var thread: String
    public var prompt: PromptDraft
    public var delivery: Delivery
}

public struct StartThreadArgs: Codable, Sendable, Hashable {
    public var draft: String
    public var project: String?
    public var prompt: PromptDraft
    public var settings: ThreadSettings
}

struct AnswerApprovalArgs: Encodable {
    let thread: String
    let request: String
    let answer: ApprovalAnswer
}

struct LoadEarlierArgs: Encodable {
    let thread: String
    let before: Int
    let limit: Int
}

public struct LoadEarlierResult: Decodable, Sendable {
    public var thread: String
    public var start: Int
    public var items: [Item]
}

/// `{"re": id, "ok": true, "duplicate": true}`: the request was already accepted in this epoch.
struct DuplicateFlag: Decodable {
    let duplicate: Bool?
}

struct ResultEnvelope<Result: Decodable>: Decodable {
    let result: Result
}

struct QueuedArgs: Encodable {
    let thread: String
    let queued: String
}

struct ReplyError: Decodable {
    let code: String?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case code
        case message
    }

    init(from decoder: any Decoder) throws {
        if let text = try? decoder.singleValueContainer().decode(String.self) {
            code = nil
            message = text
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        code = try container.decodeIfPresent(String.self, forKey: .code)
        message = try container.decodeIfPresent(String.self, forKey: .message)
    }

    var text: String {
        message ?? code ?? "request failed"
    }

    var failure: RemoteError {
        switch code {
        case "busy": .busy(text)
        case "too_many": .tooMany(text)
        default: .server(text)
        }
    }
}

struct ServerEnvelope: Decodable {
    let op: String?
    let re: Int?
    let ok: Bool?
    let error: ReplyError?
}

struct HelloReply: Decodable {
    let `protocol`: Int
    let epoch: String?
    let seq: UInt64?
    let machine: MachineIdentity
    let resume: String?
    let snapshot: [Update]?
}

struct IncompatibleReply: Decodable {
    let `protocol`: Int
    let minProtocol: Int?

    enum CodingKeys: String, CodingKey {
        case `protocol`
        case minProtocol = "min_protocol"
    }
}

struct UpdateFrame: Decodable {
    let seq: UInt64
    let update: Update
}

enum ServerFrame: Sendable {
    case hello(HelloReplyValue)
    case incompatible(ProtocolWindow)
    case update(seq: UInt64, update: Update)
    case reply(id: Int, result: Result<Data, RemoteError>)
    case unknown(String)
}

public enum ResumeKind: String, Sendable {
    case delta
    case snapshot
}

struct HelloReplyValue: Sendable {
    let protocolVersion: Int
    let epoch: String?
    let seq: UInt64?
    let machine: MachineIdentity
    let resume: ResumeKind
    let snapshot: [Update]
}

enum FrameCodec {
    static func decode(_ data: Data) throws -> ServerFrame {
        let decoder = JSONDecoder()
        let envelope = try decoder.decode(ServerEnvelope.self, from: data)
        if let re = envelope.re {
            if envelope.ok == true {
                return .reply(id: re, result: .success(data))
            }
            return .reply(id: re, result: .failure(envelope.error?.failure ?? .server("request failed")))
        }
        switch envelope.op {
        case "update":
            let frame = try decoder.decode(UpdateFrame.self, from: data)
            return .update(seq: frame.seq, update: frame.update)
        case "hello":
            let reply = try decoder.decode(HelloReply.self, from: data)
            return .hello(HelloReplyValue(
                protocolVersion: reply.protocol,
                epoch: reply.epoch,
                seq: reply.seq,
                machine: reply.machine,
                resume: reply.resume.flatMap(ResumeKind.init(rawValue:)) ?? .snapshot,
                snapshot: reply.snapshot ?? []
            ))
        case "incompatible":
            let reply = try decoder.decode(IncompatibleReply.self, from: data)
            return .incompatible(ProtocolWindow(newest: reply.protocol, oldest: reply.minProtocol ?? reply.protocol))
        default:
            return .unknown(envelope.op ?? "")
        }
    }

    static func encode<T: Encodable>(_ value: T) throws -> Data {
        try JSONEncoder().encode(value)
    }
}

public enum RemoteError: Error, Sendable, Equatable, LocalizedError {
    case notConnected
    case server(String)
    case unpaired
    case incompatible(ProtocolWindow)
    case busy(String)
    case tooMany(String)
    case handshake(String)
    case unexpected(String)

    public var errorDescription: String? {
        switch self {
        case .notConnected: "not connected"
        case let .server(message): message
        case .unpaired: "this phone is not paired with that machine"
        case let .incompatible(machine): "the machine speaks protocol \(machine.label), this app speaks \(ProtocolWindow.app.label)"
        case let .busy(message): "the machine is busy: \(message)"
        case let .tooMany(message): "too many uploads: \(message)"
        case let .handshake(message): "handshake failed: \(message)"
        case let .unexpected(message): message
        }
    }
}
