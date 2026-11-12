import Foundation
import LocalStudioKit

enum PagesFixtures {
    static let now = Int64(Date().timeIntervalSince1970 * 1000)

    static var settings: Settings {
        Settings(
            defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5", defaultThinkingLevel: "medium",
            defaultAccess: .autoAcceptEdits, newThreadWorkspace: .worktree, newWorktreesStartFromOrigin: true,
            workingSection: true, autoSettleMerged: true, autoSettleInactive: true, autoSettleInactiveDays: 3,
            notifications: .notificationsAndSound, inAppNotifications: false, timeFormat: .locale,
            responseStreaming: .paragraph, hideWhitespace: true, diffFilesCollapsed: true, diffLayout: .stacked,
            proactivePanels: false, showSkillsInSlashMenu: true, richTextComposer: true, collapseComposerOnScroll: true,
            sendShortcut: .enter, vimMode: false, followUpBehavior: .queue, continueThreadsAfterRestart: false,
            addProjectBaseDirectory: "/Users/gil/Repos", confirmUnpin: false, confirmArchive: false, confirmDelete: true,
            quitConfirmation: .hold, textGenerationProvider: nil, textGenerationModel: nil, contextWindowMeter: false,
            colorScheme: .dark, theme: nil, contrast: 100, diffColors: .redGreen, chatWidth: .normal,
            interfaceFont: "", interfaceFontSize: 13, promptFont: "", promptFontSize: 14, codeFont: "", codeFontSize: 12,
            terminalFont: "", terminalFontSize: 12, terminalScrollback: 10_000, terminalCursorBlink: false,
            fontSmoothing: true, wordWrap: true, openLinksIn: .system,
            autoPull: false, mergeMethod: .squash, gitFetchIntervalSeconds: 30, writingStyle: .conventionalCommits,
            writingInstructions: "", followPrTemplates: true, sourceControlProvider: nil, sourceControlModel: nil,
            worktreeCleanupAfterDays: 7, worktreeCleanupOnMerge: true, worktreeCleanupOnDelete: true,
            worktreeCleanupUnchanged: false, localControllerUrl: "", fleetKey: "fk_live_8c1d", startController: true,
            onboardingCompleted: true, customThemes: "", glassOpacity: 80, snapshotEnabled: true, snapshotIncludeText: true,
            snapshotPlaySound: true, snapshotSound: .softPop, snapshotFlash: true, snapshotAnimations: true
        )
    }

    static let vsCodeTheme = """
    {
      "name": "dracula-soft",
      "type": "dark",
      "colors": {
        "editor.background": "#282a36",
        "editor.foreground": "#f8f8f2",
        "sideBar.background": "#21222c",
        "sideBar.foreground": "#f8f8f2",
        "focusBorder": "#bd93f9",
        "button.background": "#bd93f9",
        "button.foreground": "#282a36",
        "list.hoverBackground": "#44475a75",
        "list.inactiveSelectionBackground": "#44475a",
        "panel.border": "#bd93f950",
        "input.border": "#191a21",
        "descriptionForeground": "#a0a4c0",
        "editorError.foreground": "#ff5555",
        "editorWarning.foreground": "#ffb86c",
        "terminal.background": "#282a36"
      },
      "tokenColors": [
        { "scope": ["comment", "punctuation.definition.comment"], "settings": { "foreground": "#6272a4", "fontStyle": "italic" } },
        { "scope": "keyword, storage.type, storage.modifier", "settings": { "foreground": "#ff79c6" } },
        { "scope": "keyword.operator", "settings": { "foreground": "#ff79c6" } },
        { "scope": ["string", "punctuation.definition.string"], "settings": { "foreground": "#f1fa8c" } },
        { "scope": ["entity.name.function", "support.function"], "settings": { "foreground": "#50fa7b" } },
        { "scope": ["entity.name.type", "support.type", "support.class"], "settings": { "foreground": "#8be9fd", "fontStyle": "italic" } },
        { "scope": ["constant.numeric", "constant.language"], "settings": { "foreground": "#bd93f9" } },
        { "scope": "variable.parameter", "settings": { "foreground": "#ffb86c", "fontStyle": "italic" } },
        { "scope": "variable.language", "settings": { "foreground": "#bd93f9", "fontStyle": "italic" } }
      ]
    }
    """

    static let typeScriptSource = """
    import { readFile } from "node:fs/promises";

    // Load the fleet manifest and keep only reachable engines.
    export interface Engine { name: string; port: number; healthy?: boolean }

    export async function reachable(path: string, limit = 8): Promise<Engine[]> {
      const engines: Engine[] = JSON.parse(await readFile(path, "utf8"));
      return engines.filter((engine) => engine.healthy !== false).slice(0, limit);
    }
    """

    static let keybindings: [Keybinding] = [
        Keybinding(command: "sidebar.toggle", title: "Sidebar: Toggle", shortcut: "cmd+b", defaultShortcut: "cmd+b", when: nil),
        Keybinding(command: "navigation.back", title: "Navigation: Back", shortcut: "cmd+[", defaultShortcut: "cmd+[", when: "!terminalFocus"),
        Keybinding(command: "navigation.forward", title: "Navigation: Forward", shortcut: "cmd+]", defaultShortcut: "cmd+]", when: "!terminalFocus"),
        Keybinding(command: "terminal.toggle", title: "Terminal: Toggle", shortcut: "cmd+j", defaultShortcut: "cmd+j", when: nil),
        Keybinding(command: "terminal.split", title: "Terminal: Split", shortcut: "cmd+d", defaultShortcut: "cmd+d", when: "terminalFocus"),
        Keybinding(command: "terminal.new", title: "Terminal: New", shortcut: "cmd+n", defaultShortcut: "cmd+n", when: "terminalFocus"),
        Keybinding(command: "rightPanel.toggle", title: "Right Panel: Toggle", shortcut: "cmd+option+b", defaultShortcut: "cmd+option+b", when: nil),
        Keybinding(command: "diff.toggle", title: "Diff: Toggle", shortcut: "cmd+shift+d", defaultShortcut: "cmd+d", when: "!terminalFocus"),
        Keybinding(command: "commandPalette.toggle", title: "Command Palette: Toggle", shortcut: "cmd+k", defaultShortcut: "cmd+k", when: "!terminalFocus"),
        Keybinding(command: "chat.new", title: "Chat: New", shortcut: "cmd+n", defaultShortcut: "cmd+n", when: "!terminalFocus"),
        Keybinding(command: "chat.newWithoutProject", title: "Chat: New Without Project", shortcut: nil, defaultShortcut: "cmd+option+n", when: nil),
        Keybinding(command: "thread.settle", title: "Thread: Settle", shortcut: "cmd+shift+s", defaultShortcut: "cmd+shift+s", when: nil),
        Keybinding(command: "thread.undo", title: "Thread: Undo", shortcut: "cmd+z", defaultShortcut: "cmd+z", when: "!terminalFocus && !editableFocus"),
        Keybinding(command: "usage.cost", title: "Usage: Cost", shortcut: "c", defaultShortcut: "c", when: "usagePageOpen"),
        Keybinding(command: "usage.tokens", title: "Usage: Tokens", shortcut: "t", defaultShortcut: "t", when: "usagePageOpen"),
        Keybinding(command: "usage.period.day", title: "Usage: Period: Past 24h", shortcut: "cmd+shift+1", defaultShortcut: "cmd+shift+1", when: "usagePageOpen"),
        Keybinding(command: "usage.period.week", title: "Usage: Period: 7 days", shortcut: "cmd+shift+2", defaultShortcut: "cmd+shift+2", when: "usagePageOpen"),
        Keybinding(command: "snapshot.capture", title: "SnapShot: Capture", shortcut: "cmd+option+shift+s", defaultShortcut: "cmd+option+shift+s", when: nil),
    ]

    static let models: [ModelOption] = [
        ModelOption(provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true, thinkingLevels: ["off", "low", "medium", "high"], contextWindow: 200_000, configured: true, serviceTiers: []),
        ModelOption(provider: "anthropic", id: "claude-opus-4-1", name: "Claude Opus 4.1", reasoning: true, thinkingLevels: ["off", "low", "medium", "high"], contextWindow: 200_000, configured: true, serviceTiers: []),
        ModelOption(provider: "openai-codex", id: "gpt-5-codex", name: "GPT-5 Codex", reasoning: true, thinkingLevels: ["minimal", "low", "medium", "high"], contextWindow: 400_000, configured: true, serviceTiers: ["auto", "flex", "priority"]),
        ModelOption(provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", reasoning: true, thinkingLevels: [], contextWindow: 1_000_000, configured: false, serviceTiers: []),
        ModelOption(provider: "ollama", id: "qwen3-coder:30b", name: "qwen3-coder:30b", reasoning: false, thinkingLevels: [], contextWindow: 131_072, configured: true, serviceTiers: []),
        ModelOption(provider: "ollama", id: "llama3.3:70b", name: "llama3.3:70b", reasoning: false, thinkingLevels: [], contextWindow: 131_072, configured: true, serviceTiers: []),
    ]

    static let favorites = [ModelKey(provider: "anthropic", model: "claude-sonnet-4-5")]

    static func builtIn(_ id: String, _ name: String, _ env: String, _ credential: ProviderCredential = .missing, models: UInt32 = 0) -> ProviderStatus {
        ProviderStatus(
            id: id, name: name, kind: .builtIn, configured: credential != .missing, credential: credential,
            modelCount: models, envVar: env, baseUrl: nil, api: nil, models: []
        )
    }

    static let endpointModels = [
        ProviderModel(id: "qwen3-coder:30b", name: "qwen3-coder:30b", contextWindow: 131_072),
        ProviderModel(id: "llama3.3:70b", name: "llama3.3:70b", contextWindow: 131_072),
    ]

    static let ollama = ProviderStatus(
        id: "ollama", name: "Ollama", kind: .custom, configured: true, credential: .notRequired, modelCount: 2,
        envVar: nil, baseUrl: "http://127.0.0.1:11434/v1", api: .openAiCompatible, models: endpointModels
    )

    static let providers: [ProviderStatus] = [
        builtIn("openai", "OpenAI", "OPENAI_API_KEY", models: 38),
        builtIn("anthropic", "Anthropic", "ANTHROPIC_API_KEY", .storedKey, models: 2),
        builtIn("google", "Google Gemini", "GEMINI_API_KEY", models: 1),
        builtIn("openrouter", "OpenRouter", "OPENROUTER_API_KEY", .environment, models: 0),
        builtIn("groq", "Groq", "GROQ_API_KEY", models: 12),
        builtIn("mistral", "Mistral", "MISTRAL_API_KEY", models: 9),
        builtIn("xai", "xAI", "XAI_API_KEY", models: 7),
        builtIn("deepseek", "DeepSeek", "DEEPSEEK_API_KEY", models: 2),
        ollama,
        ProviderStatus(
            id: "team-gateway", name: "Team Gateway", kind: .custom, configured: true, credential: .storedKey, modelCount: 3,
            envVar: nil, baseUrl: "https://llm.example.com/v1", api: .openAiResponses, models: []
        ),
        ProviderStatus(
            id: "openai-codex", name: "OpenAI Codex", kind: .other, configured: true, credential: .signedIn, modelCount: 1,
            envVar: nil, baseUrl: nil, api: nil, models: []
        ),
    ]

    static let engines: [LocalEngine] = [
        LocalEngine(
            id: "studio:8080", controller: "studio", port: 8080, baseUrl: "http://127.0.0.1:18091/v1",
            models: ["qwen3-coder-30b-a3b"], provider: "local-studio-8080", added: true
        ),
        LocalEngine(
            id: "studio:8081", controller: "studio", port: 8081, baseUrl: "http://127.0.0.1:18091/v1",
            models: ["gpt-oss-120b"], provider: "local-studio-8081", added: false
        ),
    ]

    static let projects: [Project] = [
        Project(id: "/Users/gil/Repos/local-studio", name: "local-studio", path: "/Users/gil/Repos/local-studio", icon: nil, isGit: true),
        Project(id: "/Users/gil/Repos/eukhe", name: "eukhe", path: "/Users/gil/Repos/eukhe", icon: nil, isGit: true),
    ]

    static var base: [Update] {
        [
            .connection(state: .ready),
            .projects(projects: projects),
            .settings(settings: settings),
            .keybindings(bindings: keybindings),
            .models(models: models, favorites: favorites, hidden: [ModelKey(provider: "anthropic", model: "claude-opus-4-1")]),
            .providers(providers: providers, engines: engines, errors: []),
            .daemon(socket: "/Users/gil/.eukhe/daemon.sock", version: "0.10.0", pid: 48211),
        ]
    }

    static func thread(_ id: String, _ title: String, project: String?, hoursAgo: Double, branch: String? = nil) -> ThreadRow {
        ThreadRow(
            id: id, project: project, title: title, shelf: .settled, status: .idle, statusSince: nil,
            updatedAt: now - Int64(hoursAgo * 3_600_000), snoozedUntil: nil, pinned: false, unread: false,
            branch: branch, worktree: nil, provider: "anthropic", model: "claude-sonnet-4-5",
            additions: branch == nil ? 0 : 42, deletions: branch == nil ? 0 : 7, note: nil, archived: true, autoSettle: true,
            liveAgents: 0, fanOut: nil, pullRequest: nil
        )
    }

    static let archived: [ThreadRow] = [
        thread("a1", "Port the settings search index", project: projects[0].id, hoursAgo: 3, branch: "settings-search"),
        thread("a2", "Investigate flaky terminal resize", project: projects[0].id, hoursAgo: 30),
        thread("a3", "Draft daemon reconnect strategy", project: projects[1].id, hoursAgo: 80, branch: "reconnect"),
        thread("a4", "Quick question about tokio select", project: nil, hoursAgo: 200),
    ]

    static func days(_ count: Int, seed: [UInt64]) -> [UsageDay] {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return (0..<count).map { index in
            let date = Date().addingTimeInterval(-Double(count - 1 - index) * 86_400)
            let tokens = seed[index % seed.count] * UInt64(1 + index % 3)
            return UsageDay(day: formatter.string(from: date), tokens: tokens, costUsd: Double(tokens) / 1_000_000 * 4.2)
        }
    }

    static var usage: UsageReport {
        let history = TokenHistory(
            sinceDay: nil, total: 0, read: 0, written: 0, lastWeek: 0, busiestDay: nil, busiestTokens: 0, activeDays: 0, trackedDays: 0,
            daily: Array(repeating: 0, count: 378), lastDay: "2026-11-08"
        )
        return UsageReport(
            period: .month, totalTokens: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0, requests: 0, sessions: 0,
            byModel: [], series: [], seriesStepMs: 86_400_000, lifetime: history, lifetimeCostUsd: 0,
            dailyCostUsd: Array(repeating: 0, count: 378), limits: []
        )
    }

    static var usageWithLimits: UsageReport {
        var report = usage
        report.limits = [
            UsageLimit(provider: "openai-codex", window: "quota park", usedPercent: 100, resetsAt: now + 2 * 3_600_000 + 1_200_000, parked: true),
            UsageLimit(provider: "anthropic", window: "quota park", usedPercent: 100, resetsAt: nil, parked: true),
        ]
        return report
    }

    static var pullDetail: PullRequestDetail {
        let file = FileDiff(
            path: "macos/Sources/Features/Pages/Settings/SettingsView.swift", oldPath: nil, status: "modified", additions: 4, deletions: 2, binary: false,
            hunks: [DiffHunk(header: "@@ -51,9 +51,11 @@ struct SettingsView: View {", lines: [
                DiffLine(kind: .context, oldLine: 51, newLine: 51, text: "        .background(Theme.canvas)"),
                DiffLine(kind: .removed, oldLine: 52, newLine: nil, text: "        .navigationTitle(selection?.title ?? \"Settings\")"),
                DiffLine(kind: .removed, oldLine: 53, newLine: nil, text: "        .toolbar {"),
                DiffLine(kind: .added, oldLine: nil, newLine: 52, text: "        .navigationTitle(selection?.title ?? \"Settings\")"),
                DiffLine(kind: .added, oldLine: nil, newLine: 53, text: "        .toolbar(removing: .title)"),
                DiffLine(kind: .added, oldLine: nil, newLine: 54, text: "        .toolbar {"),
                DiffLine(kind: .added, oldLine: nil, newLine: 55, text: "            ToolbarItem(placement: .navigation) {"),
                DiffLine(kind: .context, oldLine: 54, newLine: 56, text: "                ControlGroup {"),
            ])]
        )
        let added = FileDiff(
            path: "macos/Sources/Features/Pages/UsagePage.swift", oldPath: nil, status: "added", additions: 2, deletions: 0, binary: false,
            hunks: [DiffHunk(header: "@@ -0,0 +1,2 @@", lines: [
                DiffLine(kind: .added, oldLine: nil, newLine: 1, text: "import LocalStudioKit"),
                DiffLine(kind: .added, oldLine: nil, newLine: 2, text: "import SwiftUI"),
            ])]
        )
        return PullRequestDetail(
            pull: pulls[0],
            body: "Native **Settings** window with grouped forms.\n\n- Rex-style sidebar with search\n- Every control writes through `updateSettings`\n- Snapshot catalog for each pane",
            author: "gildrb", createdAt: now - 3 * 86_400_000,
            files: [file, added],
            comments: [
                PrComment(author: "reviewer", body: "Looks great. Could the search also match keybindings?", createdAt: now - 2 * 86_400_000, path: nil, line: nil),
                PrComment(author: "gildrb", body: "Done: keybinding titles match too.", createdAt: now - 86_400_000, path: "macos/Sources/Features/Pages/Settings/SettingsView.swift", line: 112),
            ],
            timeline: [
                PrEvent(kind: "opened", actor: "gildrb", createdAt: now - 3 * 86_400_000, text: "Native settings window with grouped forms"),
                PrEvent(kind: "commit", actor: "gildrb", createdAt: now - 3 * 86_400_000 + 600_000, text: "feat(macos): settings window"),
                PrEvent(kind: "comment", actor: "reviewer", createdAt: now - 2 * 86_400_000, text: "Looks great. Could the search also match keybindings?"),
                PrEvent(kind: "review", actor: "reviewer", createdAt: now - 86_400_000, text: "APPROVED"),
            ],
            checks: [
                PrCheck(name: "build (macos-26)", state: "success", url: "https://github.com/gildrb/local-studio/actions/runs/1"),
                PrCheck(name: "swiftlint", state: "success", url: nil),
                PrCheck(name: "smoke", state: "in_progress", url: "https://github.com/gildrb/local-studio/actions/runs/2"),
                PrCheck(name: "cargo clippy", state: "failure", url: "https://github.com/gildrb/local-studio/actions/runs/3"),
            ]
        )
    }

    static let pulls: [PullRequest] = [
        PullRequest(number: 412, title: "Native settings window with grouped forms", url: "https://github.com/gildrb/local-studio/pull/412", state: "OPEN", checks: "passing", head: "swift/s4", base: "main"),
        PullRequest(number: 409, title: "Core: stream usage aggregation from saved sessions", url: "https://github.com/gildrb/local-studio/pull/409", state: "OPEN", checks: "pending", head: "core/usage", base: "main"),
        PullRequest(number: 401, title: "Fix terminal drawer resize jitter", url: "https://github.com/gildrb/local-studio/pull/401", state: "MERGED", checks: "passing", head: "fix/terminal-resize", base: "main"),
        PullRequest(number: 398, title: "Experiment: GPUI sidebar", url: "https://github.com/gildrb/local-studio/pull/398", state: "CLOSED", checks: "failing", head: "gpui-sidebar", base: "main"),
    ]

    static let gib: UInt64 = 1_073_741_824

    static var studio: LocalController {
        LocalController(
            target: "", url: "http://127.0.0.1:18091", id: "ctl-studio", name: "studio", host: "127.0.0.1", local: true,
            hasController: true, reachable: true, status: .serving, headline: "qwen3-coder-30b-a3b", detail: "studio · port 8001",
            summary: "qwen3-coder-30b-a3b", note: nil, elsewhere: nil, error: nil, version: "0.9.2",
            hardware: LocalHardware(
                cpus: 32, memoryTotalBytes: 128 * gib, memoryFreeBytes: 60 * gib,
                gpus: [
                    LocalGpu(index: 0, name: "NVIDIA GeForce RTX 4090", card: "rtx-4090", memoryUsedMib: 20_480, memoryTotalMib: 24_564, busy: true),
                    LocalGpu(index: 1, name: "NVIDIA GeForce RTX 4090", card: "rtx-4090", memoryUsedMib: 19_900, memoryTotalMib: 24_564, busy: true),
                ],
                memoryUsedBytes: 39 * gib, memoryCapacityBytes: 48 * gib, memoryLabel: "VRAM", gpuSummary: "2× RTX 4090"
            ),
            endpoints: [
                LocalEndpoint(
                    id: "ep-1", controllerId: "ctl-studio", port: 8001, pid: 4411, models: ["qwen3-coder-30b-a3b"], state: .loaded, stale: false,
                    error: nil, confirmedAtMs: nil, latencyMs: 9, address: "127.0.0.1:8001", provider: nil, jobId: "run-1"
                ),
            ],
            jobs: [],
            recipes: [
                LocalRecipe(id: "qwen3-coder-30b-vllm-2x4090", model: "qwen3-coder-30b-a3b", card: "rtx-4090", engine: "vllm", cards: 2, context: 131_072, tokensPerSecond: 85, fits: true, blocked: nil, detail: "2 of 2 GPUs · full rig · vllm · 131k context · 85 tok/s"),
                LocalRecipe(id: "gpt-oss-20b-llamacpp-1x4090", model: "gpt-oss-20b", card: "rtx-4090", engine: "llama.cpp", cards: 1, context: 65_536, tokensPerSecond: 140, fits: true, blocked: nil, detail: "1 of 2 GPUs · llama.cpp · 66k context · 140 tok/s"),
                LocalRecipe(id: "glm-4.6-sglang-8xh100", model: "glm-4.6", card: "h100", engine: "sglang", cards: 8, context: 200_000, tokensPerSecond: nil, fits: false, blocked: "needs 8 GPUs; captured h100 record from lab", detail: "8 of 2 GPUs · sglang"),
            ],
            requests: 1_284, tokens: 9_430_000, measuredRequests: 1_120
        )
    }

    static var laptop: LocalController {
        LocalController(
            target: "http://100.88.4.12:18091", url: "http://100.88.4.12:18091", id: "ctl-mbp", name: "gil-mbp", host: "100.88.4.12", local: false,
            hasController: true, reachable: true, status: .loading, headline: "Loading gpt-oss-20b-mlx on gil-mbp",
            detail: "downloading 40% · weights 6.1 / 15.2 GB", summary: "Loading gpt-oss-20b-mlx", note: nil, elsewhere: nil, error: nil, version: "0.9.2",
            hardware: LocalHardware(
                cpus: 14, memoryTotalBytes: 64 * gib, memoryFreeBytes: 30 * gib, gpus: [],
                memoryUsedBytes: 34 * gib, memoryCapacityBytes: 64 * gib, memoryLabel: "Memory", gpuSummary: "Apple M4 Max"
            ),
            endpoints: [],
            jobs: [LocalJob(id: "run-7", recipeId: "gpt-oss-20b-mlx", port: 8002, phase: "downloading", progress: 0.4, message: "weights 6.1 / 15.2 GB", failed: false, detail: "downloading 40% · weights 6.1 / 15.2 GB")],
            recipes: [],
            requests: 96, tokens: 410_000, measuredRequests: 96
        )
    }

    static var offline: LocalController { offlineMachine(name: "rig-02", host: "100.88.4.40") }

    static var localUsage: LocalUsage {
        LocalUsage(
            todayTokens: 380_000, weekTokens: 2_240_000, allTokens: 9_840_000, requests: 1_380, measuredRequests: 1_216,
            daily: days(30, seed: [120_000, 340_000, 90_000, 410_000, 0, 220_000]),
            models: [
                LocalModelUsage(model: "qwen3-coder-30b-a3b", requests: 1_102, sharePercent: 79.9, tokens: 8_900_000, measured: true),
                LocalModelUsage(model: "gpt-oss-20b", requests: 278, sharePercent: 20.1, tokens: 940_000, measured: true),
            ]
        )
    }

    static var registry: LocalRegistry {
        LocalRegistry(
            controller: "", all: false, commit: "4f2a9c1e7b", error: nil,
            matches: [LocalRegistryMatch(name: "NVIDIA GeForce RTX 4090", memoryGb: 24, count: 2, hardwareId: "rtx-4090", hardwareName: "RTX 4090")],
            total: 64,
            models: [
                RegistryModel(repo: "Qwen/Qwen3-Coder-30B-A3B-Instruct", variants: [
                    RegistryVariant(id: "qwen3-coder-30b-vllm-2x4090", status: "verified", engine: "vllm", hardwareId: "rtx-4090", hardwareCount: 2, format: "safetensors", precision: "fp8", sizeGb: 31.2, launchKind: "docker", evidence: true, recommended: true, fits: true),
                    RegistryVariant(id: "qwen3-coder-30b-llamacpp-1x4090", status: "community", engine: "llama.cpp", hardwareId: "rtx-4090", hardwareCount: 1, format: "gguf", precision: "q4_k_m", sizeGb: 18.6, launchKind: "docker", evidence: false, recommended: false, fits: true),
                ]),
                RegistryModel(repo: "openai/gpt-oss-20b", variants: [
                    RegistryVariant(id: "gpt-oss-20b-llamacpp-1x4090", status: "verified", engine: "llama.cpp", hardwareId: "rtx-4090", hardwareCount: 1, format: "gguf", precision: "mxfp4", sizeGb: 12.1, launchKind: "docker", evidence: true, recommended: true, fits: true),
                ]),
                RegistryModel(repo: "zai-org/GLM-4.6", variants: [
                    RegistryVariant(id: "glm-4.6-sglang-8xh100", status: "verified", engine: "sglang", hardwareId: "h100", hardwareCount: 8, format: "safetensors", precision: "fp8", sizeGb: 355, launchKind: "docker", evidence: true, recommended: false, fits: false),
                ]),
            ],
            downloads: [LocalDownload(recipe: "gpt-oss-20b-llamacpp-1x4090", state: "downloaded")]
        )
    }

    static var localSnapshot: LocalSnapshot {
        LocalSnapshot(
            controllers: [studio, laptop, offline], registry: registry, usage: localUsage,
            tailnet: LocalTailnet(available: true, devices: [
                TailnetDevice(name: "rig-03", ip: "100.88.4.41", os: "linux", controllerUrl: nil, controllerName: nil, linked: false),
                TailnetDevice(name: "mini", ip: "100.88.4.50", os: "macOS", controllerUrl: "http://100.88.4.50:18091", controllerName: "mac-mini", linked: false),
            ]),
            record: nil, share: nil, autoModel: "qwen3-coder-30b-a3b", generatedAt: nil, error: nil
        )
    }

    static var offlineSnapshot: LocalSnapshot {
        LocalSnapshot(
            controllers: [offline], registry: nil,
            usage: LocalUsage(todayTokens: 0, weekTokens: 0, allTokens: 0, requests: 0, measuredRequests: 0, daily: [], models: []),
            tailnet: nil, record: nil, share: nil, autoModel: nil, generatedAt: nil,
            error: "Local controller unavailable at http://127.0.0.1:18091: connection refused"
        )
    }
}
