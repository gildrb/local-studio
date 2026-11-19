import CryptoKit
import Foundation
import Testing
@testable import LocalStudioRemote

/// Both ends of a handshake in this process, one message at a time.
private func run(_ initiator: inout NoiseHandshake, _ responder: inout NoiseHandshake, payload: Data = Data()) throws {
    while !initiator.isFinished || !responder.isFinished {
        if initiator.isMyTurn {
            _ = try responder.read(try initiator.write(payload: payload))
        } else {
            _ = try initiator.read(try responder.write(payload: payload))
        }
    }
}

@Suite struct NoiseTests {
    let prologue = Data("local-studio-remote/1\n{}".utf8)

    @Test func kkHandshakeAgreesAndCarriesTraffic() throws {
        let phone = NoisePrivateKey()
        let machine = NoisePrivateKey()
        var initiator = try NoiseHandshake(pattern: .kk, initiator: true, prologue: prologue, localStatic: phone, remoteStatic: machine.publicKey)
        var responder = try NoiseHandshake(pattern: .kk, initiator: false, prologue: prologue, localStatic: machine, remoteStatic: phone.publicKey)
        try run(&initiator, &responder)
        #expect(initiator.handshakeHash == responder.handshakeHash)
        var out = try initiator.transport()
        var back = try responder.transport()
        let hello = Data(#"{"op":"hello"}"#.utf8)
        #expect(try back.open(try out.seal(hello)) == hello)
        #expect(try out.open(try back.seal(hello)) == hello)
    }

    @Test func xxpsk3LearnsBothStaticKeys() throws {
        let psk = Data((0..<32).map { UInt8($0) })
        let phone = NoisePrivateKey()
        let machine = NoisePrivateKey()
        var initiator = try NoiseHandshake(pattern: .xxpsk3, initiator: true, prologue: prologue, localStatic: phone, psk: psk)
        var responder = try NoiseHandshake(pattern: .xxpsk3, initiator: false, prologue: prologue, localStatic: machine, psk: psk)
        try run(&initiator, &responder)
        #expect(initiator.remoteStatic?.rawRepresentation == machine.publicKey.rawRepresentation)
        #expect(responder.remoteStatic?.rawRepresentation == phone.publicKey.rawRepresentation)
    }

    @Test func xxpsk3WithTheWrongSecretFailsOnTheThirdMessage() throws {
        var initiator = try NoiseHandshake(pattern: .xxpsk3, initiator: true, prologue: prologue, localStatic: NoisePrivateKey(), psk: Data(repeating: 1, count: 32))
        var responder = try NoiseHandshake(pattern: .xxpsk3, initiator: false, prologue: prologue, localStatic: NoisePrivateKey(), psk: Data(repeating: 2, count: 32))
        _ = try responder.read(try initiator.write())
        _ = try initiator.read(try responder.write())
        #expect(throws: NoiseError.decryptFailed) { _ = try responder.read(try initiator.write()) }
    }

    @Test func aDifferentPrologueBreaksKK() throws {
        let phone = NoisePrivateKey()
        let machine = NoisePrivateKey()
        var initiator = try NoiseHandshake(pattern: .kk, initiator: true, prologue: prologue, localStatic: phone, remoteStatic: machine.publicKey)
        var responder = try NoiseHandshake(pattern: .kk, initiator: false, prologue: prologue + Data("x".utf8), localStatic: machine, remoteStatic: phone.publicKey)
        #expect(throws: NoiseError.decryptFailed) { _ = try responder.read(try initiator.write()) }
    }
}
