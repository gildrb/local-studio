import Foundation
import LocalStudioKit
import SwiftUI

extension SnapshotCatalog {
    @MainActor static var pages: [SnapshotEntry] {
        settingsEntries + liveEntries + windowEntries + [
            SnapshotEntry(
                name: "pages-settings-search",
                size: settingsSize,
                updates: PagesFixtures.base,
                view: { store in AnyView(SettingsView(store: store, pane: .general, query: "diff")) }
            ),
            SnapshotEntry(
                name: "pages-settings-loading",
                size: settingsSize,
                updates: [],
                view: { store in AnyView(SettingsView(store: store, pane: .general)) }
            ),
            SnapshotEntry(
                name: "pages-settings-providers-expanded",
                size: CGSize(width: 640, height: 600),
                updates: PagesFixtures.base,
                view: { store in AnyView(ProvidersSettings(store: store, expanded: ["anthropic"])) }
            ),
            SnapshotEntry(
                name: "pages-local-dashboard",
                size: dashboardSize,
                updates: PagesFixtures.base + dashboardUpdates,
                view: { store in AnyView(LocalPage(store: store)) }
            ),
            SnapshotEntry(
                name: "pages-local-offline-machine",
                size: CGSize(width: 1100, height: 640),
                updates: PagesFixtures.base + dashboardUpdates,
                view: { store in AnyView(LocalPage(store: store, selected: PagesFixtures.dgxSpark.url)) }
            ),
            SnapshotEntry(
                name: "pages-local-idle",
                size: dashboardSize,
                updates: PagesFixtures.base + [
                    .local(request: "fixture", snapshot: PagesFixtures.idleSnapshot),
                    .localDashboard(dashboard: PagesFixtures.idleDashboard),
                ],
                view: { store in AnyView(LocalPage(store: store)) }
            ),
            SnapshotEntry(
                name: "pages-local-unreachable",
                size: CGSize(width: 1000, height: 560),
                updates: PagesFixtures.base + [.local(request: "fixture", snapshot: PagesFixtures.offlineSnapshot)],
                view: { store in AnyView(LocalPage(store: store)) }
            ),
            SnapshotEntry(
                name: "pages-local-loading",
                size: CGSize(width: 1000, height: 560),
                updates: PagesFixtures.base,
                view: { store in AnyView(LocalPage(store: store)) }
            ),
            SnapshotEntry(
                name: "pages-usage",
                size: CGSize(width: 1100, height: 820),
                updates: PagesFixtures.base,
                view: { store in
                    store.pages.loadUsage(.month)
                    store.receive([.usage(request: "fixture", report: PagesFixtures.usage)])
                    return AnyView(UsagePage(store: store))
                }
            ),
            SnapshotEntry(
                name: "pages-usage-loading",
                size: CGSize(width: 1100, height: 400),
                updates: PagesFixtures.base,
                view: { store in AnyView(UsagePage(store: store)) }
            ),
            SnapshotEntry(
                name: "pages-usage-limits",
                size: CGSize(width: 1100, height: 420),
                updates: PagesFixtures.base,
                view: { store in
                    store.pages.loadUsage(.month)
                    store.receive([.usage(request: "fixture", report: PagesFixtures.usageWithLimits)])
                    return AnyView(UsagePage(store: store, mode: .limits))
                }
            ),
            SnapshotEntry(
                name: "pages-usage-limits-empty",
                size: CGSize(width: 1100, height: 360),
                updates: PagesFixtures.base,
                view: { store in
                    store.pages.loadUsage(.month)
                    store.receive([.usage(request: "fixture", report: PagesFixtures.usage)])
                    return AnyView(UsagePage(store: store, mode: .limits))
                }
            ),
        ] + pullEntries + [
            SnapshotEntry(
                name: "pages-pull-requests-empty",
                size: CGSize(width: 1100, height: 420),
                updates: PagesFixtures.base + [.pullRequests(request: "fixture", pulls: [])],
                view: { store in
                    store.pages.showPullRequests(project: PagesFixtures.projects[0].id, request: "fixture")
                    return AnyView(PullRequestsPage(store: store))
                }
            ),
            SnapshotEntry(
                name: "pages-archive",
                size: CGSize(width: 900, height: 560),
                updates: PagesFixtures.base + [.archivedThreads(request: "fixture", threads: PagesFixtures.archived)],
                view: { store in AnyView(ArchivePage(store: store)) }
            ),
            SnapshotEntry(
                name: "pages-archive-empty",
                size: CGSize(width: 900, height: 360),
                updates: PagesFixtures.base + [.archivedThreads(request: "fixture", threads: [])],
                view: { store in AnyView(ArchivePage(store: store)) }
            ),
        ] + themeEntries + dashboardThemeEntries
    }

    private static let settingsSize = CGSize(width: 860, height: 680)
    private static let dashboardSize = CGSize(width: 1740, height: 940)

    private static var dashboardUpdates: [Update] {
        [.local(request: "fixture", snapshot: PagesFixtures.dashboardSnapshot), .localDashboard(dashboard: PagesFixtures.dashboard)]
    }

    @MainActor private static func themed(_ id: String, custom: [ThemeDefinition] = []) -> [Update] {
        var settings = PagesFixtures.settings
        settings.theme = id
        settings.colorScheme = .system
        settings.customThemes = ThemeLibrary.encodeCustom(custom)
        return PagesFixtures.base + [.settings(settings: settings)]
    }

    @MainActor private static var dashboardThemeEntries: [SnapshotEntry] {
        [
            SnapshotEntry(
                name: "pages-local-dashboard-gildrb",
                size: dashboardSize,
                updates: themed("gildrb") + dashboardUpdates,
                view: { store in AnyView(LocalPage(store: store)) }
            ),
        ]
    }

    @MainActor private static var themeEntries: [SnapshotEntry] {
        let imported = (try? ThemeImport.load(Data(PagesFixtures.vsCodeTheme.utf8), taken: [])).map { [$0] } ?? []
        return [
            SnapshotEntry(
                name: "pages-theme-grove-settings",
                size: settingsSize,
                updates: themed("grove"),
                view: { store in AnyView(SettingsView(store: store, pane: .appearance)) }
            ),
            SnapshotEntry(
                name: "pages-theme-ocean-window",
                size: CGSize(width: 1180, height: 720),
                updates: themed("ocean") + [.archivedThreads(request: "fixture", threads: PagesFixtures.archived)],
                view: { store in
                    store.shell.route = .archive
                    return AnyView(RootView(store: store))
                }
            ),
            SnapshotEntry(
                name: "pages-theme-editor",
                size: CGSize(width: 360, height: 760),
                updates: themed("gildrb"),
                view: { store in
                    let model = ThemeEditorModel(source: ThemeStore.shared.active)
                    return AnyView(ThemeEditorView(pages: store.pages, model: model) {}.themeRoot())
                }
            ),
            SnapshotEntry(
                name: "pages-theme-vscode-import",
                size: CGSize(width: 1180, height: 720),
                updates: themed(imported.first?.id ?? "", custom: imported) + [.local(request: "fixture", snapshot: PagesFixtures.localSnapshot)],
                view: { store in
                    store.shell.route = .local
                    return AnyView(RootView(store: store))
                }
            ),
            SnapshotEntry(
                name: "pages-theme-picker",
                size: CGSize(width: 520, height: 420),
                updates: themed("iris", custom: imported),
                view: { store in AnyView(ThemePickerView(pages: store.pages)) }
            ),
        ] + codeEntries("gildrb", theme: "gildrb") + codeEntries("vscode", theme: imported.first?.id ?? "", custom: imported, only: true)
            + codeEntries("default", theme: ThemeLibrary.defaultId) + [
            SnapshotEntry(
                name: "pages-theme-default-reset",
                size: CGSize(width: 200, height: 60),
                updates: themed("local-studio"),
                view: { _ in AnyView(Text("Default theme").padding()) }
            ),
        ]
    }

    @MainActor private static func codeEntries(_ name: String, theme: String, custom: [ThemeDefinition] = [], only: Bool = false) -> [SnapshotEntry] {
        let code = SnapshotEntry(
            name: "pages-theme-\(name)-code",
            size: CGSize(width: 640, height: 900),
            updates: themed(theme, custom: custom),
            view: { _ in
                AnyView(VStack(alignment: .leading, spacing: 12) {
                    CodeBlockView(language: "rust", code: PanelFixtures.rustSource)
                    CodeBlockView(language: "ts", code: PagesFixtures.typeScriptSource)
                    DiffStat(additions: 214, deletions: 37)
                    Spacer(minLength: 0)
                }.padding(16).themeRoot())
            }
        )
        guard !only else { return [code] }
        return [
            code,
            SnapshotEntry(
                name: "pages-theme-\(name)-diff",
                size: CGSize(width: 761, height: 760),
                updates: themed(theme) + PanelFixtures.base,
                view: { store in
                    let panels = store.workspace.panels
                    panels.rightPanelWidth = 760
                    panels.rightPanelOpen = true
                    panels.openSurface(.diff)
                    PanelFixtures.feedDiff(store)
                    if case .diff(let model) = panels.activeContent?.content {
                        model.layout = .split
                        model.setAllCollapsed(false)
                    }
                    return AnyView(RightPanelView(store: store))
                }
            ),
            SnapshotEntry(
                name: "pages-theme-\(name)-file",
                size: CGSize(width: 481, height: 760),
                updates: themed(theme) + PanelFixtures.base,
                view: { store in
                    store.workspace.panels.rightPanelWidth = 480
                    store.workspace.panels.rightPanelOpen = true
                    PanelFixtures.feedFile(store, relative: "core/src/workspace/terminal.rs", line: 9, content: .text(text: PanelFixtures.rustSource, language: "rust"))
                    return AnyView(RightPanelView(store: store))
                }
            ),
            SnapshotEntry(
                name: "pages-theme-\(name)-terminal",
                size: CGSize(width: 900, height: 420),
                updates: themed(theme) + PanelFixtures.base,
                view: { store in
                    store.workspace.panels.terminalHeight = 300
                    store.workspace.panels.terminalOpen = true
                    store.workspace.panels.deck(for: PanelFixtures.project).split(.sideBySide)
                    PanelFixtures.feedDeck(store)
                    return AnyView(VStack(spacing: 0) {
                        Theme.canvas
                        TerminalDrawerView(store: store)
                    })
                }
            ),
        ]
    }

    @MainActor private static var pullEntries: [SnapshotEntry] {
        let tabs: [(String, PullTab)] = [("summary", .summary), ("code", .code), ("timeline", .timeline), ("checks", .checks)]
        return tabs.map { name, tab in
            SnapshotEntry(
                name: "pages-pull-requests-\(name)",
                size: CGSize(width: 1180, height: 680),
                updates: PagesFixtures.base + [
                    .pullRequests(request: "fixture", pulls: PagesFixtures.pulls),
                    .pullRequestDetail(request: "fixture-detail", detail: PagesFixtures.pullDetail),
                ],
                view: { store in
                    store.pages.showPullRequests(project: PagesFixtures.projects[0].id, request: "fixture")
                    store.pages.showPullRequest(number: PagesFixtures.pullDetail.pull.number, request: "fixture-detail")
                    return AnyView(PullRequestsPage(store: store, tab: tab))
                }
            )
        }
    }

    @MainActor private static var settingsEntries: [SnapshotEntry] {
        SettingsPane.allCases.map { pane in
            var updates = PagesFixtures.base
            switch pane {
            case .archive:
                updates.append(.archivedThreads(request: "fixture", threads: PagesFixtures.archived))
            case .local:
                updates.append(.local(request: "fixture", snapshot: PagesFixtures.localSnapshot))
            default:
                break
            }
            return SnapshotEntry(
                name: "pages-settings-\(pane.rawValue)",
                size: settingsSize,
                updates: updates,
                view: { store in AnyView(SettingsView(store: store, pane: pane)) }
            )
        }
    }

    @MainActor private static var windowEntries: [SnapshotEntry] {
        let routes: [(String, MainRoute)] = [("local", .local), ("usage", .usage), ("pull-requests", .pullRequests), ("archive", .archive)]
        return routes.flatMap { name, route in
            [true, false].map { sidebar in
                SnapshotEntry(
                    name: "pages-window-\(name)\(sidebar ? "" : "-collapsed")",
                    size: CGSize(width: 1280, height: 820),
                    updates: PagesFixtures.base + [
                        .local(request: "fixture", snapshot: PagesFixtures.localSnapshot),
                        .localDashboard(dashboard: PagesFixtures.dashboard),
                        .archivedThreads(request: "fixture", threads: PagesFixtures.archived),
                        .pullRequests(request: "fixture", pulls: PagesFixtures.pulls),
                    ],
                    view: { store in
                        store.pages.showPullRequests(project: PagesFixtures.projects[0].id, request: "fixture")
                        store.pages.loadUsage(.month)
                        store.receive([.usage(request: "fixture", report: PagesFixtures.usage)])
                        store.shell.route = route
                        store.shell.sidebarVisible = sidebar
                        return AnyView(RootView(store: store))
                    }
                )
            }
        }
    }
}

extension SnapshotCatalog {
    @MainActor fileprivate static var liveEntries: [SnapshotEntry] {
        guard ProcessInfo.processInfo.environment["LOCAL_STUDIO_SNAPSHOT_LIVE"] == "1" else { return [] }
        return [
            SnapshotEntry(
                name: "pages-local-live",
                size: dashboardSize,
                updates: [],
                view: { store in
                    captureLiveLocal(store)
                    return AnyView(LocalPage(store: store))
                }
            ),
        ]
    }

    @MainActor private static func captureLiveLocal(_ store: StudioStore) {
        guard store.core.studio == nil else { return }
        do {
            try store.start()
        } catch {
            print("live snapshot: \(error.localizedDescription)")
            return
        }
        let pump: (TimeInterval, () -> Bool) -> Void = { timeout, done in
            let deadline = Date().addingTimeInterval(timeout)
            while Date() < deadline, !done() {
                RunLoop.main.run(until: Date().addingTimeInterval(0.05))
            }
        }
        store.pages.refreshLocal()
        pump(90) { store.pages.local != nil || store.pages.localError != nil }
        let controllers = store.pages.local?.controllers ?? []
        guard let machine = controllers.first(where: { $0.reachable && !$0.endpoints.isEmpty }) ?? controllers.first(where: \.reachable) else {
            store.stop()
            return
        }
        store.pages.watchLocalDashboard(machine.target)
        pump(90) {
            guard let dashboard = store.pages.localDashboard else { return false }
            return dashboard.error != nil || (dashboard.decodeTps != nil && (dashboard.tokens.daily.last ?? 0) > 0)
        }
        store.stop()
    }
}
