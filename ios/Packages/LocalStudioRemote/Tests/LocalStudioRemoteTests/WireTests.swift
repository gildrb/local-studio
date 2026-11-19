import Foundation
import Testing
@testable import LocalStudioRemote

@Test func needsAnswerNotificationDecodes() throws {
    let json = #"{"op":"update","seq":5,"update":{"type":"notification","thread":"t1","kind":"needs_answer","title":"x","body":"y"}}"#
    guard case let .update(seq, .notification(note)) = try FrameCodec.decode(Data(json.utf8)) else {
        Issue.record("a needs_answer notification did not decode as a notification update")
        return
    }
    #expect(seq == 5)
    #expect(note.kind.rawValue == "needs_answer")
}
