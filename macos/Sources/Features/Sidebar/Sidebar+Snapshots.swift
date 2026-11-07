import Foundation
import LocalStudioKit
import SwiftUI

extension SnapshotCatalog {
    @MainActor static var shell: [SnapshotEntry] {
        let sidebar = CGSize(width: 288, height: 860)
        return [
            SnapshotEntry(name: "shell-sidebar-no-projects", size: CGSize(width: 288, height: 560), updates: [.connection(state: .ready), .projects(projects: []), .threads(threads: [])]) { store in
                AnyView(SidebarView(store: store))
            },
            SnapshotEntry(name: "shell-sidebar-empty-project", size: CGSize(width: 288, height: 560), updates: [.connection(state: .ready), .projects(projects: ShellFixtures.projects), .threads(threads: [])]) { store in
                AnyView(SidebarView(store: store))
            },
            SnapshotEntry(name: "shell-sidebar-populated", size: sidebar, focus: "t-active-1", updates: ShellFixtures.updates) { store in
                AnyView(SidebarView(store: store))
            },
            SnapshotEntry(name: "shell-sidebar-draft-hints", size: sidebar, updates: ShellFixtures.updates) { store in
                store.inbox.selection = ["t-active-2", "t-pinned"]
                store.shell.commandHeld = true
                store.inbox.collapsed = [.snoozed]
                return AnyView(SidebarView(store: store))
            },
            SnapshotEntry(name: "shell-sidebar-search", size: CGSize(width: 288, height: 560), focus: "t-active-1", updates: ShellFixtures.updates) { store in
                store.inbox.query = "sidebar"
                return AnyView(SidebarView(store: store))
            },
            SnapshotEntry(name: "shell-sidebar-filtered", size: CGSize(width: 288, height: 560), focus: "t-active-1", updates: ShellFixtures.updates) { store in
                store.inbox.projectFilter = "/Users/demo/eukhe"
                return AnyView(SidebarView(store: store))
            },
            SnapshotEntry(name: "shell-project-filter", size: CGSize(width: 280, height: 300), updates: ShellFixtures.updates) { store in
                store.inbox.projectFilter = "/Users/demo/local-studio"
                return AnyView(ProjectFilterPopover(store: store) {}.background(Theme.overlay))
            },
            SnapshotEntry(name: "shell-header", size: CGSize(width: 980, height: 52), focus: "t-active-1", updates: ShellFixtures.updates + ShellFixtures.focused) { store in
                AnyView(ThreadHeaderBar(store: store, leadingInset: 16, trailingInset: Theme.Metrics.trailingChromeInset)
                    .overlay(alignment: .trailing) { PanelToggles(store: store) })
            },
            SnapshotEntry(name: "shell-header-clean", size: CGSize(width: 980, height: 52), focus: "t-pinned", updates: ShellFixtures.updates + ShellFixtures.focusedClean) { store in
                AnyView(ThreadHeaderBar(store: store, leadingInset: 16, trailingInset: Theme.Metrics.trailingChromeInset)
                    .overlay(alignment: .trailing) { PanelToggles(store: store) })
            },
            SnapshotEntry(name: "shell-palette-root", size: CGSize(width: 700, height: 560), focus: "t-active-1", updates: ShellFixtures.updates + ShellFixtures.focused) { store in
                AnyView(CommandPalette(store: store, page: .root).padding(.top, 20).frame(maxHeight: .infinity, alignment: .top))
            },
            SnapshotEntry(name: "shell-palette-new-thread", size: CGSize(width: 700, height: 360), updates: ShellFixtures.updates) { store in
                AnyView(CommandPalette(store: store, page: .newThread).padding(.top, 20).frame(maxHeight: .infinity, alignment: .top))
            },
            SnapshotEntry(name: "shell-palette-files", size: CGSize(width: 700, height: 300), focus: "t-active-1", updates: ShellFixtures.updates + ShellFixtures.focused) { store in
                AnyView(CommandPalette(store: store, page: .goToFile).padding(.top, 20).frame(maxHeight: .infinity, alignment: .top))
            },
            SnapshotEntry(name: "shell-commit-sheet", size: CGSize(width: 440, height: 210), focus: "t-active-1", updates: ShellFixtures.updates + ShellFixtures.focused) { store in
                AnyView(CommitSheet(store: store, project: "/Users/demo/local-studio").background(Theme.overlay))
            },
            SnapshotEntry(name: "shell-window", size: CGSize(width: 1280, height: 800), focus: "t-active-1", updates: ShellFixtures.updates + ShellFixtures.focused) { store in
                AnyView(RootView(store: store))
            },
            SnapshotEntry(name: "shell-window-collapsed-toast", size: CGSize(width: 1100, height: 640), focus: "t-active-1", updates: ShellFixtures.updates + ShellFixtures.focused + [.notice(level: .error, text: "Push failed: the remote rejected the update (fetch first).")]) { store in
                store.shell.sidebarVisible = false
                return AnyView(RootView(store: store))
            },
            SnapshotEntry(name: "shell-window-palette", size: CGSize(width: 1280, height: 800), focus: "t-active-1", updates: ShellFixtures.updates + ShellFixtures.focused) { store in
                store.shell.palette = .root
                return AnyView(RootView(store: store))
            },
            SnapshotEntry(name: "shell-window-page", size: CGSize(width: 1100, height: 640), updates: ShellFixtures.updates) { store in
                store.shell.route = .usage
                return AnyView(RootView(store: store))
            },
        ]
    }
}

enum ShellFixtures {
    static let projects = [
        Project(id: "/Users/demo/local-studio", name: "local-studio", path: "/Users/demo/local-studio", icon: nil, isGit: true),
        Project(id: "/Users/demo/eukhe", name: "eukhe", path: "/Users/demo/eukhe", icon: nil, isGit: true),
        Project(id: "/Users/demo/dashboards", name: "dashboards", path: "/Users/demo/dashboards", icon: "chart.bar", isGit: false),
    ]

    private static func ago(_ minutes: Double) -> Int64 {
        Int64((Date.now.timeIntervalSince1970 - minutes * 60) * 1_000)
    }

    private static func row(
        _ id: String, _ project: Int?, _ title: String, shelf: Shelf, status: ThreadStatus = .idle, minutes: Double,
        pinned: Bool = false, unread: Bool = false, branch: String? = nil, provider: String? = nil, model: String? = nil,
        diff: (UInt32, UInt32) = (0, 0), snoozeHours: Double? = nil
    ) -> ThreadRow {
        ThreadRow(
            id: id, project: project.map { projects[$0].id }, title: title, shelf: shelf, status: status,
            statusSince: status == .idle ? nil : ago(minutes), updatedAt: ago(minutes),
            snoozedUntil: snoozeHours.map { Int64((Date.now.timeIntervalSince1970 + $0 * 3_600) * 1_000) },
            pinned: pinned, unread: unread, branch: branch, worktree: nil, provider: provider, model: model,
            additions: diff.0, deletions: diff.1, note: nil, archived: false
        )
    }

    static let threads: [ThreadRow] = [
        row("t-pinned", 0, "Native shell parity plan", shelf: .pinned, minutes: 180, pinned: true, branch: "core/eukhe", provider: "anthropic", model: "claude-opus"),
        row("t-active-1", 0, "Sidebar inbox with shelves and snooze", shelf: .active, status: .working, minutes: 3, branch: "swift/s1", provider: "openai-codex", model: "gpt-5", diff: (248, 37)),
        row("t-active-2", 1, "Approve the daemon socket migration", shelf: .active, status: .approval, minutes: 12, branch: "feat/socket-path", provider: "anthropic", model: "claude-sonnet"),
        row("t-active-3", 0, "Fix flaky terminal resize test", shelf: .active, status: .failed, minutes: 26, branch: "fix/pty-resize", diff: (12, 4)),
        row("t-active-4", 2, "Usage chart colours match dashboards", shelf: .active, status: .done, minutes: 41, unread: true, provider: "google"),
        row("t-active-5", 1, "Woke: review retry backoff", shelf: .active, status: .woke, minutes: 70),
        row("t-active-6", nil, "Summarize the release notes", shelf: .active, minutes: 300),
        row("t-snoozed-1", 0, "Revisit command palette paging", shelf: .snoozed, minutes: 900, snoozeHours: 2.5),
        row("t-snoozed-2", 1, "Check controller fleet keys", shelf: .snoozed, minutes: 2_000, snoozeHours: 40),
    ] + (1...13).map { index in
        row("t-settled-\(index)", index % 3, "Settled thread number \(index)", shelf: .settled, minutes: Double(index) * 1_500)
    }

    static let keybindings: [Keybinding] = [
        ("sidebar.toggle", "cmd+b"), ("terminal.toggle", "cmd+j"), ("rightPanel.toggle", "cmd+option+b"),
        ("commandPalette.toggle", "cmd+k"), ("filePicker.toggle", "cmd+p"), ("projectSearch.toggle", "cmd+shift+f"),
        ("chat.new", "cmd+n"), ("chat.newLocal", "cmd+shift+n"), ("chat.newWithoutProject", "cmd+option+n"),
        ("appearance.cycle", "cmd+option+shift+a"), ("usage.open", "cmd+u"), ("thread.pin", "cmd+shift+p"),
        ("thread.settle", "cmd+shift+s"), ("thread.copyReference", "cmd+shift+c"),
    ].map { Keybinding(command: $0.0, title: $0.0, shortcut: $0.1, defaultShortcut: $0.1, when: nil) }

    static let updates: [Update] = [
        .connection(state: .ready),
        .projects(projects: projects),
        .threads(threads: threads),
        .keybindings(bindings: keybindings),
    ]

    static let focused: [Update] = [
        .thread(thread: "t-active-1", info: ThreadInfo(
            thread: "t-active-1", project: projects[0].id, title: "Sidebar inbox with shelves and snooze", cwd: projects[0].path,
            model: ModelRef(provider: "openai-codex", id: "gpt-5", name: "GPT-5", reasoning: true),
            thinkingLevel: "medium", thinkingLevels: ["low", "medium", "high"], access: .supervised,
            busy: true, runStartedAt: ago(3), compacting: false, retryAttempt: 0, queued: 0,
            context: nil, branch: "swift/s1", worktree: nil
        )),
        .gitStatus(project: projects[0].id, status: GitStatus(
            branch: "swift/s1", upstream: "origin/swift/s1", ahead: 2, behind: 0, dirty: true,
            defaultBranch: "main", pullRequest: nil, isRepo: true, changedFiles: 7
        )),
    ]

    static let focusedClean: [Update] = [
        .gitStatus(project: projects[0].id, status: GitStatus(
            branch: "core/eukhe", upstream: "origin/core/eukhe", ahead: 0, behind: 0, dirty: false, defaultBranch: "main",
            pullRequest: PullRequest(number: 412, title: "Native shell", url: "https://github.com/demo/local-studio/pull/412", state: "OPEN", checks: "passing", head: "core/eukhe", base: "main"),
            isRepo: true, changedFiles: 0
        )),
    ]
}
