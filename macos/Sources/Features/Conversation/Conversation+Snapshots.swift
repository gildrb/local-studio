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
                name: "conversation-model-picker",
                size: CGSize(width: 320, height: 300),
                focus: "t1",
                updates: [fixtures.pickerModelsUpdate, .thread(thread: "t1", info: fixtures.info(busy: false))],
                view: { store in AnyView(ModelPickerPanel(store: store) {}.background(Theme.card)) }
            ),
            SnapshotEntry(
                name: "conversation-model-picker-hidden",
                size: CGSize(width: 320, height: 380),
                focus: "t1",
                updates: [fixtures.pickerModelsUpdate, .thread(thread: "t1", info: fixtures.info(busy: false))],
                view: { store in AnyView(ModelPickerPanel(store: store, revealHidden: true) {}.background(Theme.card)) }
            ),
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
                name: "conversation-draft-no-provider",
                size: CGSize(width: 980, height: 640),
                updates: [
                    .projects(projects: [fixtures.project]),
                    .models(models: fixtures.models.map { model in
                        var model = model
                        model.configured = false
                        return model
                    }, favorites: [], hidden: []),
                ],
                view: thread
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
            SnapshotEntry(
                name: "conversation-composer-stash-context",
                size: CGSize(width: 980, height: 560),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: Array(fixtures.changedFiles.prefix(1)))),
                ],
                view: { store in
                    let conversation = store.conversation
                    conversation.stash.park(StashedPrompt(text: "Refactor the diff panel toolbar", files: [], contexts: []), project: "")
                    conversation.stash.park(StashedPrompt(text: "Write release notes for 0.4", files: [], contexts: []), project: "")
                    conversation.draftProject = nil
                    conversation.attachContext(text: "$ swift build\nerror: missing return\n1 error", source: "Terminal")
                    let draft = conversation.composer(project: nil)
                    conversation.attachPullRequest(fixtures.pulls[0], to: draft)
                    draft.text = "Fix the build error from the terminal and update #482 "
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-slash-kinds",
                size: CGSize(width: 980, height: 620),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: Array(fixtures.compaction.suffix(2)))),
                ],
                view: { store in
                    fixtures.loadCommands(store)
                    store.conversation.composer(project: nil).text = "/"
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-skill-menu",
                size: CGSize(width: 980, height: 560),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: Array(fixtures.compaction.suffix(2)))),
                ],
                view: { store in
                    fixtures.loadSkills(store)
                    store.conversation.composer(project: nil).text = "Review the diff with $"
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-pull-request-menu",
                size: CGSize(width: 980, height: 560),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.projectInfo),
                    .transcript(thread: "t1", op: .reset(items: Array(fixtures.compaction.suffix(2)))),
                ],
                view: { store in
                    store.conversation.loadPullRequests(project: fixtures.project.id)
                    if let request = store.conversation.pullsRequest {
                        store.receive([.pullRequests(request: request, pulls: fixtures.pulls)])
                    }
                    store.conversation.composer(project: fixtures.project.id).text = "Rebase onto #4"
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-resting-composer",
                size: CGSize(width: 980, height: 620),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .settings(settings: fixtures.settings { $0.collapseComposerOnScroll = true }),
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.settled)),
                ],
                view: { store in
                    store.conversation.followsEnd = false
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-worktree-setup",
                size: CGSize(width: 980, height: 640),
                updates: [.projects(projects: [fixtures.project]), fixtures.modelsUpdate],
                view: { store in
                    fixtures.startDraft(store, setup: [
                        SetupStage(name: "Create worktree", state: .done, outputTail: "Preparing worktree (new branch 'local-studio/3f9a2c1d')"),
                        SetupStage(name: "Run setup script", state: .running, outputTail: "bun install\nResolving dependencies\nInstalled 412 packages"),
                        SetupStage(name: "Start agent", state: .pending, outputTail: ""),
                    ], done: false, error: nil)
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-worktree-setup-failed",
                size: CGSize(width: 980, height: 640),
                updates: [.projects(projects: [fixtures.project]), fixtures.modelsUpdate],
                view: { store in
                    fixtures.startDraft(store, setup: [
                        SetupStage(name: "Create worktree", state: .done, outputTail: ""),
                        SetupStage(name: "Run setup script", state: .failed, outputTail: "error: lockfile had changes, but lockfile is frozen"),
                        SetupStage(name: "Start agent", state: .skipped, outputTail: ""),
                    ], done: true, error: "The setup script exited with status 1.")
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-user-images",
                size: CGSize(width: 980, height: 640),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: [
                        fixtures.userWithImages(1, "Match these two screens", colors: [.systemBlue, .systemOrange, .systemGreen]),
                        fixtures.assistant(2, turn: 1, [.text(text: "Both screens use a 20pt corner radius; I'll match it.")]),
                        fixtures.userWithImages(3, "", colors: [.systemPurple]),
                    ])),
                ],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-subagents",
                size: CGSize(width: 980, height: 640),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.goalInfo),
                    .transcript(thread: "t1", op: .reset(items: fixtures.agentTurn)),
                    .subagents(thread: "t1", agents: fixtures.agents),
                ],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-fan-out-picker",
                size: CGSize(width: 320, height: 300),
                updates: [fixtures.modelsUpdate],
                view: { store in
                    let options = store.conversation.newThread
                    options.multiModel = true
                    options.fanOut = fixtures.models.map { ModelKey(provider: $0.provider, model: $0.id) }
                    return AnyView(ModelPickerPanel(store: store) {}.background(Theme.card))
                }
            ),
            SnapshotEntry(
                name: "conversation-fan-out-draft",
                size: CGSize(width: 980, height: 640),
                updates: [.projects(projects: [fixtures.project]), fixtures.modelsUpdate],
                view: { store in
                    let options = store.conversation.newThread
                    options.model = ModelKey(provider: "openai", model: "gpt-5")
                    options.serviceTier = "priority"
                    options.multiModel = true
                    options.fanOut = fixtures.models.map { ModelKey(provider: $0.provider, model: $0.id) }
                    store.conversation.composer(project: fixtures.project.id).text = "Try both models on the onboarding flow"
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-streaming-paragraph",
                size: CGSize(width: 980, height: 560),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .settings(settings: fixtures.settings { $0.timeFormat = .twentyFourHour }),
                    .thread(thread: "t1", info: fixtures.info(busy: true)),
                    .transcript(thread: "t1", op: .reset(items: [
                        fixtures.user(1, turn: 1, "Explain the fold rules."),
                        fixtures.assistant(2, turn: 1, [.text(text: """
                        A settled turn folds its work behind a **Worked for** row.

                        Thinking blocks fold with the turn, while a single trailing tool call joins the fo
                        """)], streaming: true),
                    ])),
                ],
                view: thread
            ),
            SnapshotEntry(
                name: "conversation-vim-indicator",
                size: CGSize(width: 980, height: 640),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .settings(settings: fixtures.settings { $0.vimMode = true }),
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.settled)),
                ],
                view: { store in
                    store.conversation.composer(project: nil).text = "Round the send button and keep it 28pt"
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "conversation-timeline-focus",
                size: CGSize(width: 980, height: 640),
                focus: "t1",
                updates: [
                    fixtures.modelsUpdate,
                    .thread(thread: "t1", info: fixtures.info(busy: false)),
                    .transcript(thread: "t1", op: .reset(items: fixtures.settled)),
                ],
                view: { store in
                    store.shell.region = .timeline
                    store.shell.timelineCursor = store.conversation.rows.dropLast().last?.id
                    return thread(store)
                }
            ),
            SnapshotEntry(
                name: "picker-access",
                size: CGSize(width: 300, height: 250),
                updates: [],
                view: { _ in
                    AnyView(PickerPanel(title: "Access", rows: AccessMenu.rows(current: .autoAcceptEdits) { _ in }, width: 300) {}.background(Theme.card))
                }
            ),
            SnapshotEntry(
                name: "picker-thinking",
                size: CGSize(width: 220, height: 200),
                updates: [],
                view: { _ in
                    let rows = ThinkingMenu.rows(levels: ["off", "low", "medium", "high", "xhigh"], current: "high") { _ in }
                    return AnyView(PickerPanel(title: "Thinking", rows: rows, width: 220) {}.background(Theme.card))
                }
            ),
            SnapshotEntry(
                name: "picker-branches",
                size: CGSize(width: 300, height: 220),
                updates: [],
                view: { _ in
                    let branches = [
                        Branch(name: "main", remote: false, current: true, worktree: nil),
                        Branch(name: "swift/k", remote: false, current: false, worktree: "/Users/gil/Repos/ls-k"),
                        Branch(name: "feature/picker-panels", remote: false, current: false, worktree: nil),
                        Branch(name: "origin/main", remote: true, current: false, worktree: nil),
                        Branch(name: "origin/release/0.9", remote: true, current: false, worktree: nil),
                    ]
                    let rows = BaseBranchButton.rows(branches, selected: "swift/k") { _ in }
                    let panel = PickerPanel(rows: rows, query: .constant(""), prompt: "Search branches", width: 300, maxHeight: 300) {}
                    return AnyView(panel.background(Theme.card))
                }
            ),
            SnapshotEntry(
                name: "picker-project",
                size: CGSize(width: 300, height: 210),
                updates: [],
                view: { _ in
                    let other = Project(id: "/Users/gil/Repos/eukhe", name: "eukhe", path: "/Users/gil/Repos/eukhe", icon: nil, isGit: true)
                    let rows = ProjectMenu.rows(projects: [fixtures.project, other], current: fixtures.project.id) { _ in } add: {}
                    return AnyView(PickerPanel(rows: rows, width: 300) {}.background(Theme.card))
                }
            ),
            SnapshotEntry(
                name: "picker-stash",
                size: CGSize(width: 300, height: 210),
                updates: [],
                view: { _ in
                    let prompts = [
                        StashedPrompt(text: "Round the send button and keep it 28pt", files: [], contexts: [], created: .now.addingTimeInterval(-3_600)),
                        StashedPrompt(text: "Audit the settings panes for contrast", files: [], contexts: [], created: .now.addingTimeInterval(-86_400 * 2)),
                    ]
                    let rows = StashMenu.rows(prompts: prompts, canStash: false, restore: { _ in }, stash: {}, clear: {})
                    return AnyView(PickerPanel(rows: rows, width: 300) {}.background(Theme.card))
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
            thinkingLevels: ["off", "low", "medium", "high"], contextWindow: 200_000, configured: true, serviceTiers: []
        ),
        ModelOption(
            provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true,
            thinkingLevels: ["minimal", "low", "medium", "high"], contextWindow: 400_000, configured: true,
            serviceTiers: ["auto", "flex", "priority"]
        ),
    ]

    static let modelsUpdate = Update.models(models: models, favorites: [ModelKey(provider: "anthropic", model: "claude-sonnet-4-5")], hidden: [])

    static let pulls: [PullRequest] = [
        PullRequest(
            number: 482, title: "Composer stash and triggers", url: "https://github.com/gildrb/local-studio/pull/482",
            state: "OPEN", checks: "passing", head: "swift/s2", base: "main"
        ),
        PullRequest(
            number: 479, title: "Right panel tabs", url: "https://github.com/gildrb/local-studio/pull/479",
            state: "MERGED", checks: "passing", head: "swift/s3", base: "main"
        ),
        PullRequest(
            number: 455, title: "Settings window", url: "https://github.com/gildrb/local-studio/pull/455",
            state: "CLOSED", checks: "failing", head: "swift/s4", base: "main"
        ),
    ]

    static let commands: [SlashCommand] = [
        SlashCommand(name: "review", description: "Review the current diff", source: "prompt", kind: .template),
        SlashCommand(name: "skill:release-notes", description: "Draft release notes from merged PRs", source: "skill", kind: .skill),
        SlashCommand(name: "skill:swift-lint", description: "Fix SwiftLint violations", source: "skill", kind: .skill),
        SlashCommand(name: "todo", description: "Track tasks for this thread", source: "extension", kind: .command),
    ]

    static var projectInfo: ThreadInfo {
        var info = info(busy: false)
        info.project = project.id
        return info
    }

    static func settings(_ change: (inout LocalStudioKit.Settings) -> Void) -> LocalStudioKit.Settings {
        var settings = PagesFixtures.settings
        change(&settings)
        return settings
    }

    @MainActor
    static func loadCommands(_ store: StudioStore) {
        store.conversation.loadCommands(project: nil)
        if let request = store.conversation.commandsRequest {
            store.receive([.commands(request: request, commands: commands)])
        }
    }

    static let skills: [SkillEntry] = [
        SkillEntry(name: "release-notes", description: "Draft release notes from merged PRs", source: .repo, path: ".eukhe/skills/release-notes"),
        SkillEntry(name: "swift-lint", description: "Fix SwiftLint violations", source: .project, path: "macos/.skills/swift-lint"),
        SkillEntry(name: "web-search", description: "Search the web and cite sources", source: .system, path: "/usr/share/eukhe/skills/web-search"),
    ]

    @MainActor
    static func loadSkills(_ store: StudioStore) {
        store.conversation.loadSkills(project: nil)
        if let request = store.conversation.skillsRequest {
            store.receive([.skills(request: request, skills: skills)])
        }
    }

    @MainActor
    static func startDraft(_ store: StudioStore, setup stages: [SetupStage], done: Bool, error: String?) {
        store.receive([.connection(state: .ready)])
        let conversation = store.conversation
        conversation.newThread.chooseWorkspace(worktree: true)
        conversation.composer(project: project.id).text = "Prototype the onboarding flow in a worktree."
        conversation.submit(project: project.id, alternate: false, settings: nil)
        if let draft = conversation.pendingDraft {
            store.receive([.worktreeSetup(thread: draft, stages: stages, done: done, error: error)])
        }
    }

    static func userWithImages(_ id: UInt64, _ text: String, colors: [NSColor]) -> Item {
        let thumbnails = colors.map { ImageThumbnail(mimeType: "image/png", data: swatch($0), width: 1_280, height: 960) }
        return Item(id: id, turn: id, createdAt: base + Int64(id) * 20_000, kind: .user(
            text: text, images: UInt32(thumbnails.count), entry: "e\(id)", thumbnails: thumbnails
        ))
    }

    static var goalInfo: ThreadInfo {
        var info = info(busy: true)
        info.goal = Goal(
            objective: "Ship the native onboarding flow with tests", status: "running", active: true,
            tokensUsed: 184_200, tokenBudget: 500_000, timeUsedSeconds: 1_312
        )
        info.serviceTiers = ["auto", "flex", "priority"]
        info.serviceTier = "priority"
        return info
    }

    static let agentTurn: [Item] = [
        user(1, turn: 1, "Audit the three settings panes in parallel."),
        assistant(2, turn: 1, [.text(text: "I'll split the audit across three agents.")]),
        tool(3, turn: 1, .read, "Read macos/Sources/Features/Pages/Settings"),
        tool(4, turn: 1, .agent, "Spawn 3 agents: audit General, Appearance and Providers", state: .running),
    ]

    static let agents: [Subagent] = [
        Subagent(
            id: "a1", title: "General pane", status: "running", running: true, startedAt: nil, durationMs: nil,
            tokens: 18_400, currentTool: "Read GeneralSettings.swift", note: nil, model: "claude-sonnet-4-5", answer: nil
        ),
        Subagent(
            id: "a2", title: "Appearance pane", status: "done", running: false, startedAt: nil, durationMs: 94_000,
            tokens: 31_200, currentTool: nil, note: "2 issues found", model: "claude-sonnet-4-5", answer: "Contrast slider is inert."
        ),
        Subagent(
            id: "a3", title: "Providers pane", status: "failed", running: false, startedAt: nil, durationMs: 12_000,
            tokens: 2_100, currentTool: nil, note: "Rate limited", model: "gpt-5", answer: nil
        ),
    ]

    static let pickerModelsUpdate = Update.models(
        models: models + [
            ModelOption(
                provider: "anthropic", id: "claude-opus-4-1", name: "Claude Opus 4.1", reasoning: true,
                thinkingLevels: ["off", "low", "medium", "high"], contextWindow: 200_000, configured: true, serviceTiers: []
            ),
            ModelOption(
                provider: "openai", id: "gpt-4.1-mini", name: "GPT-4.1 mini", reasoning: false,
                thinkingLevels: [], contextWindow: 1_000_000, configured: true, serviceTiers: []
            ),
        ],
        favorites: [ModelKey(provider: "anthropic", model: "claude-sonnet-4-5")],
        hidden: [ModelKey(provider: "openai", model: "gpt-4.1-mini"), ModelKey(provider: "anthropic", model: "claude-opus-4-1")]
    )

    static func info(busy: Bool) -> ThreadInfo {
        ThreadInfo(
            thread: "t1", project: nil, title: "Tighten the composer spacing", cwd: "/Users/gil/Repos/local-studio",
            model: ModelRef(provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true),
            thinkingLevel: "medium", thinkingLevels: ["off", "low", "medium", "high"], access: .supervised,
            busy: busy, runStartedAt: busy ? Int64(Date.now.timeIntervalSince1970 * 1_000) - 12_400 : nil,
            compacting: false, retryAttempt: 0, queued: 0,
            context: ContextUsage(tokens: 57_600, window: 200_000), branch: nil, worktree: nil,
            serviceTier: nil, serviceTiers: [], goal: nil
        )
    }

    static func user(_ id: UInt64, turn: UInt64, _ text: String, images: UInt32 = 0) -> Item {
        Item(id: id, turn: turn, createdAt: base + Int64(id) * 20_000, kind: .user(text: text, images: images, entry: "e\(id)", thumbnails: []))
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
