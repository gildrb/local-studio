import CryptoKit
import Foundation

public enum NoiseError: Error, Equatable, Sendable {
    case missingKey
    case badPsk
    case badPublicKey
    case shortMessage
    case trailingBytes
    case messageTooLong
    case decryptFailed
    case outOfOrder
    case notFinished
    case nonceExhausted
}

public enum NoisePattern: String, Sendable {
    case kk = "KK"
    case xxpsk3 = "XXpsk3"

    public var protocolName: String { "Noise_\(rawValue)_25519_ChaChaPoly_SHA256" }

    enum Token {
        case e, s, ee, es, se, ss, psk
    }

    var messages: [[Token]] {
        switch self {
        case .kk: [[.e, .es, .ss], [.e, .ee, .se]]
        case .xxpsk3: [[.e], [.e, .ee, .s, .es], [.s, .se, .psk]]
        }
    }
}

public enum Noise {
    public static let maxMessage = 65_535
    public static let tagLength = 16
    public static let keyLength = 32
}

struct CipherState: Sendable {
    var key: SymmetricKey?
    var nonce: UInt64 = 0

    init(key: SymmetricKey? = nil) {
        self.key = key
    }

    static func nonce(_ value: UInt64) throws -> ChaChaPoly.Nonce {
        var bytes = Data(count: 4)
        withUnsafeBytes(of: value.littleEndian) { bytes.append(contentsOf: $0) }
        return try ChaChaPoly.Nonce(data: bytes)
    }

    mutating func encrypt(ad: Data, _ plaintext: Data) throws -> Data {
        guard let key else { return plaintext }
        guard nonce < UInt64.max else { throw NoiseError.nonceExhausted }
        let sealed = try ChaChaPoly.seal(plaintext, using: key, nonce: Self.nonce(nonce), authenticating: ad)
        nonce += 1
        return sealed.ciphertext + sealed.tag
    }

    mutating func decrypt(ad: Data, _ ciphertext: Data) throws -> Data {
        guard let key else { return ciphertext }
        guard nonce < UInt64.max else { throw NoiseError.nonceExhausted }
        guard ciphertext.count >= Noise.tagLength else { throw NoiseError.shortMessage }
        let body = Data(ciphertext.prefix(ciphertext.count - Noise.tagLength))
        let tag = Data(ciphertext.suffix(Noise.tagLength))
        do {
            let box = try ChaChaPoly.SealedBox(nonce: Self.nonce(nonce), ciphertext: body, tag: tag)
            let plaintext = try ChaChaPoly.open(box, using: key, authenticating: ad)
            nonce += 1
            return plaintext
        } catch {
            throw NoiseError.decryptFailed
        }
    }
}

struct SymmetricState: Sendable {
    var chainingKey: Data
    var hash: Data
    var cipher = CipherState()

    init(protocolName: String) {
        let name = Data(protocolName.utf8)
        hash = name.count <= 32 ? name + Data(count: 32 - name.count) : Data(SHA256.hash(data: name))
        chainingKey = hash
    }

    static func hkdf(_ chainingKey: Data, _ material: Data, outputs: Int) -> [Data] {
        let temp = SymmetricKey(data: Data(HMAC<SHA256>.authenticationCode(for: material, using: SymmetricKey(data: chainingKey))))
        var results: [Data] = []
        var previous = Data()
        for index in 1...outputs {
            previous = Data(HMAC<SHA256>.authenticationCode(for: previous + Data([UInt8(index)]), using: temp))
            results.append(previous)
        }
        return results
    }

    mutating func mixHash(_ data: Data) {
        hash = Data(SHA256.hash(data: hash + data))
    }

    mutating func mixKey(_ material: Data) {
        let output = Self.hkdf(chainingKey, material, outputs: 2)
        chainingKey = output[0]
        cipher = CipherState(key: SymmetricKey(data: output[1]))
    }

    mutating func mixKeyAndHash(_ material: Data) {
        let output = Self.hkdf(chainingKey, material, outputs: 3)
        chainingKey = output[0]
        mixHash(output[1])
        cipher = CipherState(key: SymmetricKey(data: output[2]))
    }

    mutating func encryptAndHash(_ plaintext: Data) throws -> Data {
        let ciphertext = try cipher.encrypt(ad: hash, plaintext)
        mixHash(ciphertext)
        return ciphertext
    }

    mutating func decryptAndHash(_ ciphertext: Data) throws -> Data {
        let plaintext = try cipher.decrypt(ad: hash, ciphertext)
        mixHash(ciphertext)
        return plaintext
    }

    func split() -> (CipherState, CipherState) {
        let output = Self.hkdf(chainingKey, Data(), outputs: 2)
        return (CipherState(key: SymmetricKey(data: output[0])), CipherState(key: SymmetricKey(data: output[1])))
    }
}

public typealias NoisePrivateKey = Curve25519.KeyAgreement.PrivateKey
public typealias NoisePublicKey = Curve25519.KeyAgreement.PublicKey

public struct NoiseHandshake: Sendable {
    public let pattern: NoisePattern
    public let initiator: Bool
    private var state: SymmetricState
    private let localStatic: NoisePrivateKey
    private var localEphemeral: NoisePrivateKey?
    private var remoteEphemeral: NoisePublicKey?
    public private(set) var remoteStatic: NoisePublicKey?
    private let psk: Data?
    private var position = 0
    private var fixedEphemeral: NoisePrivateKey?

    public init(
        pattern: NoisePattern, initiator: Bool, prologue: Data, localStatic: NoisePrivateKey,
        remoteStatic: NoisePublicKey? = nil, psk: Data? = nil
    ) throws {
        try self.init(pattern: pattern, initiator: initiator, prologue: prologue, localStatic: localStatic,
                      remoteStatic: remoteStatic, psk: psk, ephemeral: nil)
    }

    package init(
        pattern: NoisePattern, initiator: Bool, prologue: Data, localStatic: NoisePrivateKey,
        remoteStatic: NoisePublicKey?, psk: Data?, ephemeral: NoisePrivateKey?
    ) throws {
        self.pattern = pattern
        self.initiator = initiator
        self.localStatic = localStatic
        self.remoteStatic = remoteStatic
        self.fixedEphemeral = ephemeral
        state = SymmetricState(protocolName: pattern.protocolName)
        state.mixHash(prologue)
        switch pattern {
        case .kk:
            guard let remoteStatic else { throw NoiseError.missingKey }
            guard psk == nil else { throw NoiseError.badPsk }
            self.psk = nil
            let mine = localStatic.publicKey.rawRepresentation
            let theirs = remoteStatic.rawRepresentation
            state.mixHash(initiator ? mine : theirs)
            state.mixHash(initiator ? theirs : mine)
        case .xxpsk3:
            guard let psk, psk.count == Noise.keyLength else { throw NoiseError.badPsk }
            self.psk = psk
        }
    }

    public var isFinished: Bool { position == pattern.messages.count }

    public var isMyTurn: Bool { !isFinished && (position % 2 == 0) == initiator }

    public var handshakeHash: Data { state.hash }

    public var handshakeStep: Int { position }

    public mutating func write(payload: Data = Data()) throws -> Data {
        guard isMyTurn else { throw NoiseError.outOfOrder }
        var message = Data()
        for token in pattern.messages[position] {
            switch token {
            case .e:
                let ephemeral = fixedEphemeral ?? NoisePrivateKey()
                fixedEphemeral = nil
                localEphemeral = ephemeral
                let raw = ephemeral.publicKey.rawRepresentation
                message += raw
                state.mixHash(raw)
                if psk != nil { state.mixKey(raw) }
            case .s:
                message += try state.encryptAndHash(localStatic.publicKey.rawRepresentation)
            case .ee, .es, .se, .ss:
                state.mixKey(try agree(token))
            case .psk:
                guard let psk else { throw NoiseError.badPsk }
                state.mixKeyAndHash(psk)
            }
        }
        message += try state.encryptAndHash(payload)
        guard message.count <= Noise.maxMessage else { throw NoiseError.messageTooLong }
        position += 1
        return message
    }

    public mutating func read(_ message: Data) throws -> Data {
        guard !isFinished, !isMyTurn else { throw NoiseError.outOfOrder }
        guard message.count <= Noise.maxMessage else { throw NoiseError.messageTooLong }
        var rest = Data(message)
        func take(_ count: Int) throws -> Data {
            guard rest.count >= count else { throw NoiseError.shortMessage }
            let head = Data(rest.prefix(count))
            rest = Data(rest.dropFirst(count))
            return head
        }
        for token in pattern.messages[position] {
            switch token {
            case .e:
                let raw = try take(Noise.keyLength)
                remoteEphemeral = try key(raw)
                state.mixHash(raw)
                if psk != nil { state.mixKey(raw) }
            case .s:
                let length = Noise.keyLength + (state.cipher.key == nil ? 0 : Noise.tagLength)
                remoteStatic = try key(state.decryptAndHash(try take(length)))
            case .ee, .es, .se, .ss:
                state.mixKey(try agree(token))
            case .psk:
                guard let psk else { throw NoiseError.badPsk }
                state.mixKeyAndHash(psk)
            }
        }
        let payload = try state.decryptAndHash(rest)
        position += 1
        return payload
    }

    public func transport() throws -> NoiseTransport {
        guard isFinished else { throw NoiseError.notFinished }
        let (first, second) = state.split()
        return initiator ? NoiseTransport(send: first, receive: second) : NoiseTransport(send: second, receive: first)
    }

    private func key(_ raw: Data) throws -> NoisePublicKey {
        do { return try NoisePublicKey(rawRepresentation: raw) } catch { throw NoiseError.badPublicKey }
    }

    private func agree(_ token: NoisePattern.Token) throws -> Data {
        let pair: (NoisePrivateKey?, NoisePublicKey?)
        switch token {
        case .ee: pair = (localEphemeral, remoteEphemeral)
        case .ss: pair = (localStatic, remoteStatic)
        case .es: pair = initiator ? (localEphemeral, remoteStatic) : (localStatic, remoteEphemeral)
        case .se: pair = initiator ? (localStatic, remoteEphemeral) : (localEphemeral, remoteStatic)
        default: throw NoiseError.outOfOrder
        }
        guard let mine = pair.0, let theirs = pair.1 else { throw NoiseError.missingKey }
        do {
            let shared = try mine.sharedSecretFromKeyAgreement(with: theirs)
            let bytes = shared.withUnsafeBytes { Data($0) }
            guard bytes.contains(where: { $0 != 0 }) else { throw NoiseError.badPublicKey }
            return bytes
        } catch {
            throw NoiseError.badPublicKey
        }
    }
}

public struct NoiseTransport: Sendable {
    var send: CipherState
    var receive: CipherState

    public static let maxPlaintext = Noise.maxMessage - Noise.tagLength

    public mutating func seal(_ plaintext: Data) throws -> Data {
        guard plaintext.count <= Self.maxPlaintext else { throw NoiseError.messageTooLong }
        return try send.encrypt(ad: Data(), plaintext)
    }

    public mutating func open(_ ciphertext: Data) throws -> Data {
        guard ciphertext.count <= Noise.maxMessage else { throw NoiseError.messageTooLong }
        return try receive.decrypt(ad: Data(), ciphertext)
    }
}
