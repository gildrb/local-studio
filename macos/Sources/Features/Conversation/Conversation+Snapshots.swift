import Foundation
import LocalStudioKit
import SwiftUI

extension SnapshotCatalog {
    @MainActor static var conversation: [SnapshotEntry] {
        [
            SnapshotEntry(
                name: "conversation-turn",
                size: CGSize(width: 900, height: 560),
                focus: "t1",
                updates: [
                    .thread(thread: "t1", info: ConversationFixtures.info),
                    .transcript(thread: "t1", op: .reset(items: ConversationFixtures.turn)),
                ],
                view: { store in AnyView(ThreadView(store: store, leadingInset: 0)) }
            ),
        ]
    }
}

enum ConversationFixtures {
    static let info = ThreadInfo(
        thread: "t1", project: nil, title: "run the smoke command", cwd: "/tmp",
        model: ModelRef(provider: "faux", id: "faux-1", name: "Faux Model", reasoning: false),
        thinkingLevel: "off", thinkingLevels: ["off", "low", "high"], access: .supervised,
        busy: false, runStartedAt: nil, compacting: false, retryAttempt: 0, queued: 0,
        context: ContextUsage(tokens: 17_800, window: 128_000), branch: nil, worktree: nil
    )

    static let turn: [Item] = [
        Item(id: 1, turn: 1, createdAt: nil, kind: .user(text: "run the smoke command", images: 0, entry: "8")),
        Item(id: 2, turn: 1, createdAt: nil, kind: .assistant(
            blocks: [.thinking(text: "planning the smoke"), .text(text: "Running the smoke command.")],
            streaming: false, error: nil, changedFiles: []
        )),
        Item(id: 3, turn: 1, createdAt: nil, kind: .tool(
            callId: "call-1", name: "bash", kind: .command, summary: "echo smoke-ok",
            arguments: "{\n  \"script\": \"echo smoke-ok\"\n}", state: .succeeded,
            output: "$ echo smoke-ok\nsmoke-ok\n", fileChange: nil, startedAt: nil, endedAt: nil
        )),
        Item(id: 4, turn: 1, createdAt: nil, kind: .turnSummary(turn: 1, durationMs: 1_037, toolCount: 1)),
        Item(id: 5, turn: 1, createdAt: nil, kind: .assistant(
            blocks: [.text(text: "Done: smoke-ok")], streaming: false, error: nil, changedFiles: []
        )),
    ]
}
