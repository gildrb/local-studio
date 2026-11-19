import Foundation

public struct NoiseChannel: SecureChannel {
    public init() {}

    public func handshake(_ role: HandshakeRole, staticKey: Data, prologue: Data, over transport: some HandshakeTransport) async throws -> any SecureSession {
        do {
            let local = try NoisePrivateKey(rawRepresentation: staticKey)
            var state: NoiseHandshake
            var finalPayload = Data()
            switch role {
            case let .pair(_, psk, device):
                state = try NoiseHandshake(pattern: .xxpsk3, initiator: true, prologue: prologue, localStatic: local, psk: psk)
                finalPayload = try JSONEncoder().encode(device)
            case let .known(_, machineKey):
                let machine = try NoisePublicKey(rawRepresentation: machineKey)
                state = try NoiseHandshake(pattern: .kk, initiator: true, prologue: prologue, localStatic: local, remoteStatic: machine)
            }
            while !state.isFinished {
                if state.isMyTurn {
                    let last = state.pattern == .xxpsk3 && state.handshakeStep == 2
                    try await transport.send(try state.write(payload: last ? finalPayload : Data()))
                } else {
                    _ = try state.read(try await transport.receive())
                }
            }
            guard let machine = state.remoteStatic else {
                throw RemoteError.handshake("the machine sent no static key")
            }
            return NoiseSession(remoteStatic: machine.rawRepresentation, transport: try state.transport())
        } catch let error as NoiseError {
            throw RemoteError.handshake("the encrypted handshake failed (\(error))")
        }
    }
}

public struct NoiseSession: SecureSession {
    public let remoteStatic: Data
    var transport: NoiseTransport

    public mutating func seal(_ plaintext: Data) throws -> Data {
        try transport.seal(plaintext)
    }

    public mutating func open(_ message: Data) throws -> Data {
        try transport.open(message)
    }
}
