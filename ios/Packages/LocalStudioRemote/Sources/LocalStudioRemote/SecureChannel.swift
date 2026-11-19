import CryptoKit
import Foundation

public enum HandshakeRole: Sendable {
    case pair(id: String, psk: Data, device: DeviceInfo)
    case known(device: String, machineKey: Data)

    public var pattern: String {
        switch self {
        case .pair: "XXpsk3"
        case .known: "KK"
        }
    }
}

public protocol HandshakeTransport: Sendable {
    func send(_ message: Data) async throws
    func receive() async throws -> Data
}

public protocol SecureSession: Sendable {
    var remoteStatic: Data { get }
    mutating func seal(_ plaintext: Data) throws -> Data
    mutating func open(_ message: Data) throws -> Data
}

public protocol SecureChannel: Sendable {
    func handshake(_ role: HandshakeRole, staticKey: Data, prologue: Data, over transport: some HandshakeTransport) async throws -> any SecureSession
}

public enum StaticKey {
    public static func generate() -> Data {
        Curve25519.KeyAgreement.PrivateKey().rawRepresentation
    }

    public static func publicKey(of privateKey: Data) throws -> Data {
        try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKey).publicKey.rawRepresentation
    }
}

public struct PassThroughChannel: SecureChannel {
    public init() {}

    public func handshake(_ role: HandshakeRole, staticKey: Data, prologue: Data, over transport: some HandshakeTransport) async throws -> any SecureSession {
        let ephemeral = try StaticKey.publicKey(of: StaticKey.generate())
        try await transport.send(ephemeral)
        let reply = try await transport.receive()
        switch role {
        case let .pair(_, _, device):
            guard reply.count >= 64 else {
                throw RemoteError.handshake("the machine's second pairing message is short")
            }
            let machineKey = Data(reply[reply.startIndex + 32 ..< reply.startIndex + 64])
            try await transport.send(try StaticKey.publicKey(of: staticKey) + JSONEncoder().encode(device))
            return PassThroughSession(remoteStatic: machineKey)
        case let .known(_, machineKey):
            guard reply.count >= 32 else {
                throw RemoteError.handshake("the machine's handshake reply is short")
            }
            return PassThroughSession(remoteStatic: machineKey)
        }
    }
}

public struct PassThroughSession: SecureSession {
    public let remoteStatic: Data

    public func seal(_ plaintext: Data) throws -> Data {
        plaintext
    }

    public func open(_ message: Data) throws -> Data {
        message
    }
}
