import AppKit
import Foundation
import LocalStudioKit
import SwiftUI

extension SnapshotCatalog {
    @MainActor static var panels: [SnapshotEntry] {
        let size = CGSize(width: 481, height: 760)
        return [
            panelEntry("panels-launcher", size: size, focus: PanelFixtures.thread, updates: PanelFixtures.base + PanelFixtures.thread(agents: true)) { _ in },
            panelEntry("panels-launcher-noproject", size: size, updates: []) { _ in },
            panelEntry("panels-tabs", size: size, updates: PanelFixtures.base) { store in
                let panels = store.workspace.panels
                panels.openSurface(.browser)
                panels.openSurface(.files)
                panels.openFile(project: PanelFixtures.project, relative: "macos/Sources/Features/Panels/RightPanelView.swift", line: nil)
                panels.openSurface(.diff)
                PanelFixtures.feedDiff(store)
            },
            panelEntry("panels-diff-loading", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.diff)
            },
            panelEntry("panels-diff-stacked", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.diff)
                PanelFixtures.feedDiff(store)
            },
            panelEntry("panels-diff-split", size: CGSize(width: 761, height: 760), width: 760, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.diff)
                PanelFixtures.feedDiff(store)
                if case .diff(let model) = store.workspace.panels.activeContent?.content {
                    model.layout = .split
                }
            },
            panelEntry("panels-diff-collapsed", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.diff)
                PanelFixtures.feedDiff(store)
                if case .diff(let model) = store.workspace.panels.activeContent?.content {
                    model.toggle(PanelFixtures.diffFiles[0].path)
                    model.toggle(PanelFixtures.diffFiles[2].path)
                }
            },
            panelEntry("panels-diff-empty", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.diff)
                guard case .diff(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
                store.receive([.diff(request: request, files: [])])
            },
            panelEntry("panels-diff-error", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.diff)
                guard case .diff(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
                store.receive([.requestFailed(request: request, message: "fatal: bad revision 'origin/main'")])
            },
            panelEntry("panels-files-loading", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.files)
            },
            panelEntry("panels-files", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.files)
                PanelFixtures.feedFiles(store)
            },
            panelEntry("panels-files-error", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.files)
                guard case .files(let model) = store.workspace.panels.activeContent?.content, let request = model.requests[""] else { return }
                store.receive([.requestFailed(request: request, message: "Path is outside the project.")])
            },
            panelEntry("panels-file-loading", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openFile(project: PanelFixtures.project, relative: "core/src/workspace/terminal.rs", line: nil)
            },
            panelEntry("panels-file-text", size: size, updates: PanelFixtures.base) { store in
                PanelFixtures.feedFile(store, relative: "core/src/workspace/terminal.rs", line: 9, content: .text(text: PanelFixtures.rustSource, language: "rust"))
            },
            panelEntry("panels-file-image", size: size, updates: PanelFixtures.base) { store in
                PanelFixtures.feedFile(store, relative: "assets/dev/icon.png", line: nil, content: .image(mimeType: "image/png", data: PanelFixtures.png))
            },
            panelEntry("panels-file-binary", size: size, updates: PanelFixtures.base) { store in
                PanelFixtures.feedFile(store, relative: "target/debug/eukhe-daemon", line: nil, content: .binary(size: 48_213_504))
            },
            panelEntry("panels-file-toolarge", size: size, updates: PanelFixtures.base) { store in
                PanelFixtures.feedFile(store, relative: "Cargo.lock", line: nil, content: .tooLarge(size: 3_400_112))
            },
            panelEntry("panels-file-error", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openFile(project: PanelFixtures.project, relative: "missing.txt", line: nil)
                guard case .file(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
                store.receive([.requestFailed(request: request, message: "No such file or directory (os error 2)")])
            },
            panelEntry("panels-terminal", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.terminal)
                guard case .terminal(let group) = store.workspace.panels.activeContent?.content, let session = group.sessions.first else { return }
                PanelFixtures.feedTerminal(store, session: session, terminal: "pty-panel", output: PanelFixtures.terminalOutput)
            },
            panelEntry("panels-browser", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.browser)
            },
            panelEntry("panels-prs-loading", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.pullRequests)
            },
            panelEntry("panels-prs", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.pullRequests)
                guard case .pullRequests(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
                store.receive([.pullRequests(request: request, pulls: PanelFixtures.pulls)])
                PanelFixtures.feedDetail(store, model.selectedDetail)
            },
            panelEntry("panels-prs-empty", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.pullRequests)
                guard case .pullRequests(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
                store.receive([.pullRequests(request: request, pulls: [])])
            },
            panelEntry("panels-prs-error", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.pullRequests)
                guard case .pullRequests(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
                store.receive([.requestFailed(request: request, message: "gh: To use GitHub CLI, run: gh auth login")])
            },
            panelEntry("panels-pr-loading", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.pullRequest)
            },
            panelEntry("panels-pr-summary", size: size, updates: PanelFixtures.base) { store in
                PanelFixtures.openDetail(store, tab: .summary)
            },
            panelEntry("panels-pr-code", size: size, updates: PanelFixtures.base) { store in
                PanelFixtures.openDetail(store, tab: .code)
            },
            panelEntry("panels-pr-timeline", size: size, updates: PanelFixtures.base) { store in
                PanelFixtures.openDetail(store, tab: .timeline)
            },
            panelEntry("panels-pr-checks", size: size, updates: PanelFixtures.base) { store in
                PanelFixtures.openDetail(store, tab: .checks)
            },
            panelEntry("panels-pr-error", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.pullRequest)
                guard case .pullRequest(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
                store.receive([.requestFailed(request: request, message: "gh: Could not resolve to a PullRequest with the number of 412.")])
            },
            panelEntry("panels-device-loading", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.device)
            },
            panelEntry("panels-device", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.device)
                guard case .device(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
                store.receive([.devices(request: request, devices: PanelFixtures.devices)])
                if let pixel = PanelFixtures.devices.first(where: { $0.name == "Pixel 9 API 35" }) {
                    model.boot(pixel)
                }
            },
            panelEntry("panels-device-empty", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.device)
                guard case .device(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
                store.receive([
                    .notice(level: .info, text: "Android devices need adb (Android SDK platform-tools)."),
                    .devices(request: request, devices: []),
                ])
                model.reason = "Android devices need adb (Android SDK platform-tools)."
            },
            panelEntry("panels-device-error", size: size, updates: PanelFixtures.base) { store in
                store.workspace.panels.openSurface(.device)
                guard case .device(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
                store.receive([.requestFailed(request: request, message: "xcrun simctl list timed out after 10 s.")])
            },
            panelEntry("panels-agents-empty", size: size, focus: PanelFixtures.thread, updates: PanelFixtures.base + PanelFixtures.thread(agents: false)) { store in
                store.workspace.panels.openSurface(.agents)
            },
            panelEntry("panels-agents", size: size, focus: PanelFixtures.thread, updates: PanelFixtures.base + PanelFixtures.thread(agents: true)) { store in
                store.workspace.panels.openSurface(.agents)
            },
            drawerEntry("drawer-single") { store in
                store.workspace.panels.terminalOpen = true
                PanelFixtures.feedDeck(store)
            },
            drawerEntry("drawer-side-by-side") { store in
                store.workspace.panels.terminalOpen = true
                store.workspace.panels.deck(for: PanelFixtures.project).split(.sideBySide)
                PanelFixtures.feedDeck(store)
            },
            drawerEntry("drawer-stacked", height: 560) { store in
                store.workspace.panels.terminalOpen = true
                store.workspace.panels.terminalHeight = 420
                store.workspace.panels.deck(for: PanelFixtures.project).split(.stacked)
                PanelFixtures.feedDeck(store)
            },
            drawerEntry("drawer-tabs-exited") { store in
                let panels = store.workspace.panels
                panels.terminalOpen = true
                panels.deck(for: PanelFixtures.project).newTerminal()
                PanelFixtures.feedDeck(store)
                if let session = panels.deck(for: PanelFixtures.project).activeGroup?.sessions.first, let terminal = session.terminal {
                    store.receive([.terminalExited(terminal: terminal, code: 0)])
                }
            },
            drawerEntry("drawer-empty") { store in
                let panels = store.workspace.panels
                panels.terminalOpen = true
                panels.deck(for: PanelFixtures.project).closeFocused()
            },
            drawerEntry("drawer-noproject", updates: []) { store in
                store.workspace.panels.terminalOpen = true
            },
            SnapshotEntry(name: "panels-miniplayer", size: CGSize(width: 900, height: 560), updates: PanelFixtures.base) { store in
                let panels = store.workspace.panels
                panels.openSurface(.browser)
                if case .browser(let model) = panels.activeContent?.content {
                    model.address = "localhost:5173"
                    model.go()
                    panels.float(model)
                }
                return AnyView(ZStack {
                    Theme.canvas
                    PanelMessage(symbol: "bubble.left.and.text.bubble.right", title: "Thread", detail: "The floating preview stays above the chat column.")
                    PreviewMiniPlayerView(store: store)
                })
            },
        ]
    }

    @MainActor private static func panelEntry(
        _ name: String,
        size: CGSize,
        width: CGFloat = 480,
        focus: String? = nil,
        updates: [Update],
        prepare: @escaping @MainActor (StudioStore) -> Void
    ) -> SnapshotEntry {
        SnapshotEntry(name: name, size: size, focus: focus, updates: updates) { store in
            let panels = store.workspace.panels
            panels.focus(focus)
            panels.rightPanelWidth = width
            panels.rightPanelOpen = true
            prepare(store)
            return AnyView(RightPanelView(store: store))
        }
    }

    @MainActor private static func drawerEntry(
        _ name: String,
        height: CGFloat = 420,
        updates: [Update] = PanelFixtures.base,
        prepare: @escaping @MainActor (StudioStore) -> Void
    ) -> SnapshotEntry {
        SnapshotEntry(name: name, size: CGSize(width: 900, height: height), updates: updates) { store in
            store.workspace.panels.terminalHeight = 300
            prepare(store)
            return AnyView(VStack(spacing: 0) {
                Theme.canvas
                TerminalDrawerView(store: store)
            })
        }
    }
}

@MainActor
enum PanelFixtures {
    static let project = "/Users/demo/Repos/local-studio"
    static let thread = "thread-panels"
    static let now = Int64(Date().timeIntervalSince1970 * 1000)

    static let branchPull = PullRequest(
        number: 412,
        title: "Native right panel and terminal drawer",
        url: "https://github.com/gildrb/local-studio/pull/412",
        state: "OPEN",
        checks: "pending",
        head: "feat/panels",
        base: "main"
    )

    static func feedDetail(_ store: StudioStore, _ model: PullRequestDetailModel?) {
        guard let model, let request = model.request else { return }
        store.receive([.pullRequestDetail(request: request, detail: detail(model.pull))])
    }

    static func openDetail(_ store: StudioStore, tab: PullRequestTab) {
        store.workspace.panels.openSurface(.pullRequest)
        guard case .pullRequest(let model) = store.workspace.panels.activeContent?.content else { return }
        feedDetail(store, model)
        model.tab = tab
        if tab == .code {
            model.code.setAllCollapsed(false)
        }
    }

    static func detail(_ pull: PullRequest) -> PullRequestDetail {
        PullRequestDetail(
            pull: pull,
            body: """
            Ports the right panel and the terminal drawer to the native app.

            - **Diff**: working tree, branch and per-turn scopes with stacked and split layouts
            - **Terminal**: SwiftTerm over the core's PTY, with splits
            - **Files**, **Browser**, **Pull requests**, **Agents** and **Devices** surfaces

            Closes #377.
            """,
            author: "gildrb",
            createdAt: now - 86_400_000 * 2,
            files: Array(diffFiles.prefix(3)),
            comments: [
                PrComment(author: "reviewer", body: "Should the drawer remember its height per project?", createdAt: now - 7_200_000, path: "macos/Sources/Features/Panels/TerminalViews.swift", line: 21),
            ],
            timeline: [
                PrEvent(kind: "opened", actor: "gildrb", createdAt: now - 86_400_000 * 2, text: pull.title),
                PrEvent(kind: "commit", actor: "gildrb", createdAt: now - 86_400_000, text: "feat(macos): right panel surfaces and terminal drawer"),
                PrEvent(kind: "review", actor: "reviewer", createdAt: now - 7_200_000, text: "CHANGES_REQUESTED: drawer height per project"),
                PrEvent(kind: "commit", actor: "gildrb", createdAt: now - 3_600_000, text: "fix(macos): remember drawer height"),
                PrEvent(kind: "comment", actor: "reviewer", createdAt: now - 1_800_000, text: "Looks good now."),
            ],
            checks: [
                PrCheck(name: "macOS build", state: "success", url: "https://github.com/gildrb/local-studio/actions/runs/1"),
                PrCheck(name: "cargo clippy", state: "success", url: "https://github.com/gildrb/local-studio/actions/runs/2"),
                PrCheck(name: "SwiftLint", state: "failure", url: "https://github.com/gildrb/local-studio/actions/runs/3"),
                PrCheck(name: "Linux build", state: "in_progress", url: nil),
                PrCheck(name: "Docs preview", state: "skipped", url: nil),
            ]
        )
    }

    static let devices: [Device] = [
        Device(id: "8C1F2D3A-1111", name: "iPhone 17 Pro", platform: .iosSimulator, state: "Booted", runtime: "iOS 26.1"),
        Device(id: "8C1F2D3A-2222", name: "iPhone 17", platform: .iosSimulator, state: "Shutdown", runtime: "iOS 26.1"),
        Device(id: "8C1F2D3A-3333", name: "iPad Pro 13-inch (M5)", platform: .iosSimulator, state: "Shutdown", runtime: "iOS 26.1"),
        Device(id: "8C1F2D3A-4444", name: "iPhone SE (3rd generation)", platform: .iosSimulator, state: "Shutdown", runtime: "iOS 18.6"),
        Device(id: "Pixel_9_API_35", name: "Pixel 9 API 35", platform: .androidEmulator, state: "Shutdown", runtime: "Android"),
        Device(id: "emulator-5554", name: "Medium Phone API 36", platform: .androidEmulator, state: "Booted", runtime: "Android"),
        Device(id: "R5CT30ABCDE", name: "Galaxy S24", platform: .androidDevice, state: "Booted", runtime: nil),
    ]

    static let pulls: [PullRequest] = [
        branchPull,
        PullRequest(number: 409, title: "Core: coalesce terminal output to 16 ms frames", url: "https://github.com/gildrb/local-studio/pull/409", state: "MERGED", checks: "passing", head: "core/terminal-coalesce", base: "main"),
        PullRequest(number: 405, title: "Diff: respect hide-whitespace setting in turn scopes", url: "https://github.com/gildrb/local-studio/pull/405", state: "OPEN", checks: "failing", head: "fix/diff-whitespace", base: "main"),
        PullRequest(number: 398, title: "Drop the legacy plan side panel", url: "https://github.com/gildrb/local-studio/pull/398", state: "CLOSED", checks: "none", head: "chore/plan-panel", base: "main"),
    ]

    static var base: [Update] {
        [
            .projects(projects: [Project(id: project, name: "local-studio", path: project, icon: nil, isGit: true)]),
            .gitStatus(project: project, status: GitStatus(
                branch: "feat/panels",
                upstream: "origin/feat/panels",
                ahead: 2,
                behind: 0,
                dirty: true,
                defaultBranch: "main",
                pullRequest: branchPull,
                isRepo: true,
                changedFiles: 4,
                hasRemote: true
            )),
        ]
    }

    static func thread(agents: Bool) -> [Update] {
        let row = ThreadRow(
            id: thread, project: project, title: "Build the native panels", shelf: .working, status: .working,
            statusSince: now - 300_000, updatedAt: now, snoozedUntil: nil, pinned: false, unread: false,
            branch: "feat/panels", worktree: nil, provider: "anthropic", model: "claude-opus", additions: 214, deletions: 37,
            note: nil, archived: false, autoSettle: true, liveAgents: agents ? 2 : 0, fanOut: nil, pullRequest: nil
        )
        var items: [Item] = [
            Item(id: 1, turn: 1, createdAt: now - 900_000, kind: .user(text: "Build the panels", images: 0, entry: nil, thumbnails: [])),
            Item(id: 2, turn: 1, createdAt: now - 600_000, kind: .turnSummary(turn: 1, durationMs: 192_000, toolCount: 14)),
            Item(id: 3, turn: 2, createdAt: now - 400_000, kind: .turnSummary(turn: 2, durationMs: 64_000, toolCount: 5)),
        ]
        if agents {
            items += [
                agent(4, "Audit split diff pairing against git output", state: .running, started: now - 140_000, ended: nil, output: "Reading core/src/workspace/diff.rs\nComparing 3 hunks…"),
                agent(5, "Port drawer height clamp from ThreadTerminalDrawer.logic.ts", state: .running, started: now - 40_000, ended: nil, output: ""),
                agent(6, "Find every caller of open_terminal", state: .succeeded, started: now - 500_000, ended: now - 452_000, output: "core/src/workspace/api.rs:211\nmacos/Sources/Features/Studio/WorkspaceStore.swift:118"),
                agent(7, "Check SwiftTerm license", state: .failed, started: now - 700_000, ended: now - 691_000, output: "Network unavailable."),
            ]
        }
        return [.threads(threads: [row]), .transcript(thread: thread, op: .reset(items: items))]
    }

    private static func agent(_ id: UInt64, _ summary: String, state: ToolState, started: Int64, ended: Int64?, output: String) -> Item {
        Item(id: id, turn: 3, createdAt: started, kind: .tool(
            callId: "call-\(id)", name: "Task", kind: .agent, summary: summary, arguments: "{}", state: state,
            output: output, fileChange: nil, startedAt: started, endedAt: ended
        ))
    }

    static let diffFiles: [FileDiff] = [
        FileDiff(path: "macos/Sources/Features/Panels/RightPanelView.swift", oldPath: nil, status: "modified", additions: 5, deletions: 2, binary: false, hunks: [
            hunk("@@ -12,7 +12,10 @@ struct RightPanelView: View {", old: 12, new: 12, [
                (" ", "    var body: some View {"),
                (" ", "        HStack(spacing: 0) {"),
                ("-", "            Divider()"),
                ("-", "            content"),
                ("+", "            if !panels.rightPanelMaximized {"),
                ("+", "                ResizeHandle(axis: .horizontal, cursor: .columnResize, gesture: resize)"),
                ("+", "            }"),
                ("+", "            VStack(spacing: 0) { PanelTabStrip(panels: panels); content }"),
                ("+", "                .background(Theme.canvas)"),
                (" ", "        }"),
                (" ", "        .frame(width: panels.rightPanelWidth)"),
                (" ", "    }"),
            ]),
        ]),
        FileDiff(path: "core/src/workspace/terminal.rs", oldPath: nil, status: "modified", additions: 4, deletions: 3, binary: false, hunks: [
            hunk("@@ -88,6 +88,7 @@ impl Terminals {", old: 88, new: 88, [
                (" ", "    pub fn open(&self, project: &Path, cols: u16, rows: u16) -> Result<String, TerminalError> {"),
                (" ", "        let shell = login_shell();"),
                ("-", "        let size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };"),
                ("+", "        let size = PtySize { rows: rows.max(1), cols: cols.max(2), pixel_width: 0, pixel_height: 0 };"),
                ("+", "        tracing::debug!(%cols, %rows, \"opening pty\");"),
                (" ", "        let pair = native_pty_system().openpty(size)?;"),
                (" ", "        let mut command = CommandBuilder::new(&shell);"),
            ]),
            hunk("@@ -141,8 +142,8 @@ impl Terminals {", old: 141, new: 142, [
                (" ", "    fn coalesce(&self, chunk: &[u8]) {"),
                ("-", "        if self.pending.len() > 32 * 1024 {"),
                ("-", "            self.flush();"),
                ("+", "        if self.pending.len() > 64 * 1024 {"),
                ("+", "            self.flush_now();"),
                (" ", "        }"),
                (" ", "    }"),
            ]),
        ]),
        FileDiff(path: "docs/panels.md", oldPath: nil, status: "added", additions: 5, deletions: 0, binary: false, hunks: [
            hunk("@@ -0,0 +1,5 @@", old: 0, new: 1, [
                ("+", "# Panels"),
                ("+", ""),
                ("+", "The right panel hosts Diff, Files, Terminal, Browser, Pull requests and Agents surfaces."),
                ("+", "The terminal drawer sits under the chat column (⌘J), between 180 pt and 75% of the column."),
                ("+", "Every surface talks to the Rust core; nothing is mocked."),
            ]),
        ]),
        FileDiff(path: "assets/dev/panel-icon.png", oldPath: nil, status: "added", additions: 0, deletions: 0, binary: true, hunks: []),
    ]

    static func hunk(_ header: String, old: UInt32, new: UInt32, _ lines: [(String, String)]) -> DiffHunk {
        var oldLine = old
        var newLine = new
        var result: [DiffLine] = []
        for (sign, text) in lines {
            switch sign {
            case "+":
                result.append(DiffLine(kind: .added, oldLine: nil, newLine: newLine, text: text))
                newLine += 1
            case "-":
                result.append(DiffLine(kind: .removed, oldLine: oldLine, newLine: nil, text: text))
                oldLine += 1
            default:
                result.append(DiffLine(kind: .context, oldLine: oldLine, newLine: newLine, text: text))
                oldLine += 1
                newLine += 1
            }
        }
        return DiffHunk(header: header, lines: result)
    }

    static func feedDiff(_ store: StudioStore) {
        guard case .diff(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
        store.receive([.diff(request: request, files: diffFiles)])
    }

    static func feedFiles(_ store: StudioStore) {
        guard case .files(let model) = store.workspace.panels.activeContent?.content, let root = model.requests[""] else { return }
        store.receive([.files(request: root, entries: [
            FileEntry(name: ".github", relative: ".github", directory: true, size: 0),
            FileEntry(name: "core", relative: "core", directory: true, size: 0),
            FileEntry(name: "macos", relative: "macos", directory: true, size: 0),
            FileEntry(name: "Cargo.toml", relative: "Cargo.toml", directory: false, size: 1_284),
            FileEntry(name: "README.md", relative: "README.md", directory: false, size: 6_310),
            FileEntry(name: "rust-toolchain.toml", relative: "rust-toolchain.toml", directory: false, size: 74),
        ])])
        guard let macos = model.rows.first(where: { $0.id == "macos" })?.entry else { return }
        model.activate(macos)
        guard let request = model.requests["macos"] else { return }
        store.receive([.files(request: request, entries: [
            FileEntry(name: "Sources", relative: "macos/Sources", directory: true, size: 0),
            FileEntry(name: "AGENTS.md", relative: "macos/AGENTS.md", directory: false, size: 812),
            FileEntry(name: "Package.swift", relative: "macos/Package.swift", directory: false, size: 1_520),
            FileEntry(name: "build.nu", relative: "macos/build.nu", directory: false, size: 4_602),
        ])])
        if let sources = model.rows.first(where: { $0.id == "macos/Sources" })?.entry {
            model.activate(sources)
        }
        model.selection = "macos/Package.swift"
    }

    static func feedFile(_ store: StudioStore, relative: String, line: UInt32?, content: FileContent) {
        store.workspace.panels.openFile(project: project, relative: relative, line: line)
        guard case .file(let model) = store.workspace.panels.activeContent?.content, let request = model.request else { return }
        store.receive([.fileContent(request: request, path: relative, content: content)])
    }

    static func feedTerminal(_ store: StudioStore, session: TerminalSession, terminal: String, output: String) {
        guard let request = session.request else { return }
        store.receive([
            .terminalOpened(request: request, terminal: terminal),
            .terminalOutput(terminal: terminal, data: Data(output.utf8)),
        ])
    }

    static func feedDeck(_ store: StudioStore) {
        let deck = store.workspace.panels.deck(for: project)
        var index = 0
        for group in deck.groups {
            for session in group.sessions where session.terminal == nil {
                index += 1
                feedTerminal(store, session: session, terminal: "pty-\(index)", output: index == 1 ? terminalOutput : secondOutput)
            }
        }
    }

    static let terminalOutput = [
        "\u{1b}[1;34m~/Repos/local-studio\u{1b}[0m on \u{1b}[35m feat/panels\u{1b}[0m \u{1b}[33m!2\u{1b}[0m",
        "\u{1b}[32m❯\u{1b}[0m git status --short",
        " \u{1b}[31mM\u{1b}[0m core/src/workspace/terminal.rs",
        " \u{1b}[31mM\u{1b}[0m macos/Sources/Features/Panels/RightPanelView.swift",
        "\u{1b}[32m??\u{1b}[0m docs/panels.md",
        "",
        "\u{1b}[1;34m~/Repos/local-studio\u{1b}[0m on \u{1b}[35m feat/panels\u{1b}[0m \u{1b}[33m!2\u{1b}[0m",
        "\u{1b}[32m❯\u{1b}[0m cargo test -p local-studio-core terminal",
        "\u{1b}[1;32m   Compiling\u{1b}[0m local-studio-core v0.1.0",
        "\u{1b}[1;32m    Finished\u{1b}[0m `test` profile [unoptimized + debuginfo] target(s) in 4.21s",
        "\u{1b}[1;32m     Running\u{1b}[0m unittests src/lib.rs",
        "test workspace::terminal::opens_login_shell ... \u{1b}[32mok\u{1b}[0m",
        "test workspace::terminal::coalesces_output ... \u{1b}[32mok\u{1b}[0m",
        "",
        "test result: \u{1b}[32mok\u{1b}[0m. 2 passed; 0 failed; 0 ignored",
        "",
        "\u{1b}[1;34m~/Repos/local-studio\u{1b}[0m on \u{1b}[35m feat/panels\u{1b}[0m \u{1b}[33m!2\u{1b}[0m",
        "\u{1b}[32m❯\u{1b}[0m ",
    ].joined(separator: "\r\n")

    static let secondOutput = [
        "\u{1b}[1;34m~/Repos/local-studio/macos\u{1b}[0m",
        "\u{1b}[32m❯\u{1b}[0m swift build",
        "Building for debugging...",
        "[42/42] Linking LocalStudio",
        "Build complete! (12.84s)",
        "",
        "\u{1b}[1;34m~/Repos/local-studio/macos\u{1b}[0m",
        "\u{1b}[32m❯\u{1b}[0m ",
    ].joined(separator: "\r\n")

    static let rustSource = """
    use std::path::Path;

    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    use crate::workspace::TerminalError;

    impl Terminals {
        pub fn open(&self, project: &Path, cols: u16, rows: u16) -> Result<String, TerminalError> {
            let shell = login_shell();
            let size = PtySize { rows: rows.max(1), cols: cols.max(2), pixel_width: 0, pixel_height: 0 };
            let pair = native_pty_system().openpty(size)?;
            let mut command = CommandBuilder::new(&shell);
            command.arg("-l");
            command.cwd(project);
            command.env("TERM", "xterm-256color");
            let child = pair.slave.spawn_command(command)?;
            let id = self.next_id();
            self.spawn_reader(&id, pair.master.try_clone_reader()?);
            self.children.lock().insert(id.clone(), child);
            Ok(id)
        }

        fn coalesce(&self, chunk: &[u8]) {
            if self.pending.len() > 64 * 1024 {
                self.flush_now();
            }
        }
    }

    """

    static var png: Data {
        let size = NSSize(width: 160, height: 120)
        let image = NSImage(size: size, flipped: false) { rect in
            NSColor(srgbRed: 0.2044, green: 0.4198, blue: 0.9449, alpha: 1).setFill()
            NSBezierPath(roundedRect: rect.insetBy(dx: 8, dy: 8), xRadius: 22, yRadius: 22).fill()
            NSColor.white.setFill()
            NSBezierPath(ovalIn: NSRect(x: 58, y: 38, width: 44, height: 44)).fill()
            return true
        }
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let data = bitmap.representation(using: .png, properties: [:]) else { return Data() }
        return data
    }
}
