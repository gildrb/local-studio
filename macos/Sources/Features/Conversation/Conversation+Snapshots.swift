import AppKit
import Foundation
import LocalStudioKit
import SwiftUI

extension SnapshotCatalog {
    @MainActor static var conversation: [SnapshotEntry] {
        let thread: @MainActor (StudioStore) -> AnyView = { store in
            store.receive([.connection(state: .ready)])
            return AnyView(ThreadView(store: store, leadingInset: 0))
        }
        let fixtures = ConversationFixtures.self
        return [
            SnapshotEntry(
                name: "conversation-draft-hero",
                size: CGSize(width: 980, height: 640),
                updates: [.projects(projects: [fixtures.project]), fixtures.modelsUpdate],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-draft-worktree",
                size: CGSize(width: 980, height: 640),
                updates: [.projects(projects: [fixtures.project]), fixtures.modelsUpdate],
                view: { store in
                    store.conversation.newThread.worktree = true
                    store.conversation.newThread.access = .autoAcceptEdits
                    store.conversation.composer(project: fixtures.project.id).text = "Prototype the new onboarding flow"
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-slash-menu",
                size: CGSize(width: 980, height: 640),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: Array(fixtures.compaction.suffix(2)))),
                ],
                view: { store in
                    store.conversation.composer(project: nil).text = "/"
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-draft-no-project",
                size: CGSize(width: 980, height: 640),
                updates: [fixtures.modelsUpdate],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-streaming",
                size: CGSize(width: 980, height: 720),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.info(busy: true)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.streaming)),
                ],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-settled-folded",
                size: CGSize(width: 980, height: 760),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.settled)),
                ],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-settled-expanded",
                size: CGSize(width: 980, height: 900),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.settled)),
                ],
                view: { store in
                    store.conversation.toggleFold(6)
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-markdown",
                size: CGSize(width: 980, height: 1_400),
                focus: "t1",
                updates: [
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.markdown)),
                ],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-changed-files",
                size: CGSize(width: 980, height: 620),
                focus: "t1",
                updates: [
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.changedFiles)),
                ],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-queued",
                size: CGSize(width: 980, height: 680),
                focus: "t1",
                updates: [
                    .thread(thread: "t1", info: fixtures.info(busy: true)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.queuedTurn)),
                    .queue(thread: "t1", queued: [
                        QueuedMessage(id: "q1", text: "Also run the linter once the tests pass", steering: false, sending: false),
                        QueuedMessage(id: "q2", text: "Prefer the existing helper in Theme.swift", steering: true, sending: false),
                    ]),
                ],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-approval",
                size: CGSize(width: 980, height: 720),
                focus: "t1",
                updates: [
                    .thread(thread: "t1", info: fixtures.info(busy: true)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.approvalTurn)),
                    .approvals(thread: "t1", approvals: fixtures.approvals),
                ],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-errors",
                size: CGSize(width: 980, height: 700),
                focus: "t1",
                updates: [
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.errors)),
                ],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-compaction",
                size: CGSize(width: 980, height: 640),
                focus: "t1",
                updates: [
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.compaction)),
                ],
                view: { store in
                    store.conversation.composer(project: nil).text = "Summarize what changed since the compaction"
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-attachments",
                size: CGSize(width: 980, height: 560),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: Array(fixtures.changedFiles.prefix(1)))),
                ],
                view: { store in
                    let draft = store.conversation.composer(project: nil)
                    draft.text = "Match the spacing in these screenshots"
                    draft.attach(image: fixtures.swatch(.systemBlue), mimeType: "image/png")
                    draft.attach(image: fixtures.swatch(.systemOrange), mimeType: "image/png")
                    draft.files = ["macos/Sources/Design/Theme.swift"]
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-long",
                size: CGSize(width: 980, height: 820),
                focus: "t1",
                updates: [
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.long)),
                ],
                view: { store in
                    precondition(store.conversation.entries.count == 200)
                    return thread(store)
                }
            ),
        ]
    }
}

enum ConversationFixtures {
    static let base: Int64 = 1_794_064_920_000

    static let project = Project(
        id: "/Users/gil/Repos/local-studio", name: "local-studio", path: "/Users/gil/Repos/local-studio", icon: nil, isGit: true
    )

    static let models: [ModelOption] = [
        ModelOption(
            provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true,
            thinkingLevels: ["off", "low", "medium", "high"], contextWindow: 200_000, configured: true
        ),
        ModelOption(
            provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true,
            thinkingLevels: ["minimal", "low", "medium", "high"], contextWindow: 400_000, configured: true
        ),
    ]

    static let modelsUpdate = Update.models(models: models, favorites: [ModelKey(provider: "anthropic", model: "claude-sonnet-4-5")], hidden: [])

    static func info(busy: Bool) -> ThreadInfo {
        ThreadInfo(
            thread: "t1", project: nil, title: "Tighten the composer spacing", cwd: "/Users/gil/Repos/local-studio",
            model: ModelRef(provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true),
            thinkingLevel: "medium", thinkingLevels: ["off", "low", "medium", "high"], access: .supervised,
            busy: busy, runStartedAt: busy ? Int64(Date.now.timeIntervalSince1970 * 1_000) - 12_400 : nil,
            compacting: false, retryAttempt: 0, queued: 0,
            context: ContextUsage(tokens: 57_600, window: 200_000), branch: nil, worktree: nil
        )
    }

    static func user(_ id: UInt64, turn: UInt64, _ text: String, images: UInt32 = 0) -> Item {
        Item(id: id, turn: turn, createdAt: base + Int64(id) * 20_000, kind: .user(text: text, images: images, entry: "e\(id)"))
    }

    static func assistant(_ id: UInt64, turn: UInt64, _ blocks: [Block], streaming: Bool = false, error: String? = nil, files: [FileChange] = []) -> Item {
        Item(id: id, turn: turn, createdAt: base + Int64(id) * 20_000, kind: .assistant(
            blocks: blocks, streaming: streaming, error: error, changedFiles: files
        ))
    }

    static func tool(_ id: UInt64, turn: UInt64, _ kind: ToolKind, _ summary: String, state: ToolState = .succeeded, output: String = "", change: FileChange? = nil) -> Item {
        Item(id: id, turn: turn, createdAt: base + Int64(id) * 20_000, kind: .tool(
            callId: "call-\(id)", name: "tool", kind: kind, summary: summary, arguments: "{}", state: state,
            output: output, fileChange: change, startedAt: nil, endedAt: nil
        ))
    }

    static let themeChange = FileChange(
        path: "macos/Sources/Design/Theme.swift", additions: 12, deletions: 4,
        diff: "@@ -12,6 +12,8 @@\n-    static let rowRadius: CGFloat = 8\n+    static let rowRadius: CGFloat = 10\n+    static let composerRadius: CGFloat = 20\n"
    )

    static let composerChange = FileChange(path: "macos/Sources/Features/Conversation/ComposerView.swift", additions: 48, deletions: 17, diff: "")

    static let streaming: [Item] = [
        user(1, turn: 1, "The composer feels cramped. Tighten the spacing to match Rex and keep the footer controls on one line.", images: 2),
        assistant(2, turn: 1, [
            .thinking(text: "The composer padding is 14pt today; Rex uses 16pt horizontally with a 20pt radius."),
            .text(text: "I'll compare the composer against the design tokens first."),
        ]),
        tool(3, turn: 1, .read, "Read macos/Sources/Design/Theme.swift"),
        tool(4, turn: 1, .search, "Search “composer” in macos/Sources"),
        tool(5, turn: 1, .edit, "Edit ComposerView.swift", change: composerChange),
        tool(6, turn: 1, .command, "swift build --package-path macos", state: .running),
    ]

    static let settled: [Item] = [
        user(1, turn: 1, "The composer feels cramped. Tighten the spacing to match Rex and keep the footer controls on one line."),
        assistant(2, turn: 1, [
            .thinking(text: "The composer padding is 14pt today; Rex uses 16pt horizontally with a 20pt radius."),
            .text(text: "I'll compare the composer against the design tokens first."),
        ]),
        tool(3, turn: 1, .read, "Read macos/Sources/Design/Theme.swift", output: "enum Theme {\n    static let canvas = …\n}\n"),
        tool(4, turn: 1, .edit, "Edit ComposerView.swift", change: composerChange),
        tool(5, turn: 1, .command, "swift build --package-path macos", output: "Build complete! (5.45s)\n"),
        Item(id: 6, turn: 1, createdAt: base + 120_000, kind: .turnSummary(turn: 1, durationMs: 192_000, toolCount: 3)),
        assistant(7, turn: 1, [
            .thinking(text: "Everything builds; summarize."),
            .text(text: "The composer now uses **16pt** horizontal padding and a **20pt** corner radius, and the footer keeps the model, thinking and access controls on one line."),
        ], files: [composerChange, themeChange]),
        user(8, turn: 2, "Looks good. Can you also make the send button round?"),
    ]

    static let markdown: [Item] = [
        user(1, turn: 1, "How should the timeline render tool output?"),
        assistant(2, turn: 1, [.text(text: """
        ## Rendering plan

        The timeline keeps **one row per item** and updates rows in place, so streaming never re-diffs the whole list. Inline `code`, *emphasis* and [links](https://developer.apple.com) render natively.

        ### Steps

        1. Parse the markdown once per text revision.
        2. Group runs by their block identity:
           - paragraphs and headings become `Text`
           - code blocks get a monospaced card with a copy button
        3. Cache the parsed document by its text.

        > Tool rows stay compact: one line each, expandable to the full output.

        ```swift
        let document = MarkdownCache.document(for: text)
        for block in document.blocks {
            render(block)
        }
        ```

        | Row | Height | Expands |
        |-----|--------|---------|
        | Tool | 26pt | Output |
        | Fold | 22pt | Turn |

        ---

        That's all it needs.
        """)]),
    ]

    static let changedFiles: [Item] = [
        user(1, turn: 1, "Apply the new radius tokens everywhere."),
        assistant(2, turn: 1, [.text(text: "Updated the radius tokens and every call site that hard-coded them.")], files: [
            themeChange,
            composerChange,
            FileChange(path: "macos/Sources/Features/Sidebar/SidebarView.swift", additions: 3, deletions: 3, diff: ""),
            FileChange(path: "README.md", additions: 1, deletions: 0, diff: ""),
        ]),
    ]

    static let queuedTurn: [Item] = [
        user(1, turn: 1, "Run the test suite and fix whatever fails."),
        assistant(2, turn: 1, [.text(text: "Running the suite now.")]),
        tool(3, turn: 1, .command, "cargo test --workspace", state: .running),
    ]

    static let approvalTurn: [Item] = [
        user(1, turn: 1, "Clean the build folder and rebuild."),
        assistant(2, turn: 1, [.thinking(text: "Need to remove build/ first."), .text(text: "I'll remove the stale build output first.")]),
        tool(3, turn: 1, .command, "rm -rf macos/build && nu macos/build.nu", state: .pending),
    ]

    static let approvals: [Approval] = [
        Approval(
            requestId: "r1", step: 3, command: "rm -rf macos/build && nu macos/build.nu",
            effects: ["write", "delete"], agent: "main"
        ),
        Approval(requestId: "r2", step: 4, command: "git push origin HEAD", effects: ["network"], agent: nil),
    ]

    static let errors: [Item] = [
        user(1, turn: 1, "Deploy the preview build."),
        tool(2, turn: 1, .command, "nu scripts/deploy.nu --preview", state: .failed, output: "error: missing PREVIEW_TOKEN\n"),
        Item(id: 3, turn: 1, createdAt: base + 60_000, kind: .notice(level: .warning, text: "The provider is rate limited; retrying in 20s.")),
        assistant(4, turn: 1, [.text(text: "The deploy script needs a preview token.")], error: "Request failed: 529 overloaded"),
        Item(id: 5, turn: 1, createdAt: base + 100_000, kind: .notice(level: .error, text: "The agent stopped after 3 failed attempts.")),
        Item(id: 6, turn: 1, createdAt: base + 120_000, kind: .notice(level: .info, text: "Model switched to GPT-5.")),
    ]

    static let compaction: [Item] = [
        user(1, turn: 1, "Keep going with the refactor."),
        assistant(2, turn: 1, [.text(text: "Moved the store helpers into ConversationStore.")]),
        Item(id: 3, turn: 2, createdAt: base + 80_000, kind: .compaction(
            summary: "The user is refactoring the native conversation view. Done so far: store helpers moved.", tokensBefore: 182_400
        )),
        user(4, turn: 2, "Now wire the composer pickers."),
        assistant(5, turn: 2, [.text(text: "Wired the model, thinking and access pickers to the core.")]),
    ]

    static let long: [Item] = (0..<40).flatMap { index -> [Item] in
        let turn = UInt64(index + 1)
        let first = UInt64(index * 5 + 1)
        return [
            user(first, turn: turn, "Step \(index + 1): adjust the next view."),
            assistant(first + 1, turn: turn, [.thinking(text: "Plan step \(index + 1)."), .text(text: "Looking at the view.")]),
            tool(first + 2, turn: turn, .edit, "Edit View\(index + 1).swift"),
            Item(id: first + 3, turn: turn, createdAt: base, kind: .turnSummary(turn: turn, durationMs: UInt64(index + 3) * 7_000, toolCount: 1)),
            assistant(first + 4, turn: turn, [.text(text: "Step \(index + 1) is done; the view uses the shared tokens now.")]),
        ]
    }

    static func swatch(_ color: NSColor) -> Data {
        let image = NSImage(size: NSSize(width: 96, height: 96), flipped: false) { rect in
            color.setFill()
            rect.fill()
            NSColor.white.withAlphaComponent(0.35).setFill()
            NSRect(x: 12, y: 12, width: 72, height: 24).fill()
            return true
        }
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else { return Data() }
        return png
    }
}
