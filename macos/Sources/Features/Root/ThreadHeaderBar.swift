import AppKit
import LocalStudioKit
import SwiftUI

struct ThreadHeaderBar: View {
    let store: StudioStore
    let leadingInset: CGFloat
    let trailingInset: CGFloat
    @State private var titleAnchor = ViewAnchor()
    @State private var hoveringTitle = false

    var body: some View {
        HStack(spacing: 8) {
            breadcrumb
            Spacer(minLength: 12)
            if store.shell.route == .thread {
                if let project = store.focusedProject, store.inbox.project(project) != nil {
                    ProjectScriptsControl(store: store, project: project)
                        .id(project)
                }
                OpenInEditorButton(path: store.workspacePath(for: store.focusedRow))
                if let project = gitProject {
                    GitActionsButton(store: store, project: project)
                        .task(id: project) {
                            if store.workspace.gitStatus[project] == nil {
                                store.core.run { $0.gitStatus(project: project) }
                            }
                        }
                }
            }
        }
        .padding(.leading, leadingInset)
        .padding(.trailing, trailingInset)
        .frame(height: Theme.Metrics.titlebarHeight)
        .background(TitlebarDragArea())
        .background(Theme.canvas)
        .onChange(of: probe, initial: true) { _, probe in
            store.shell.probe.header = probe
        }
        .sheet(item: sheetBinding(\.commitProject)) { item in
            CommitSheet(store: store, project: item.id)
        }
        .sheet(item: sheetBinding(\.pullRequestProject)) { item in
            PullRequestSheet(store: store, project: item.id, suggestedTitle: store.conversation.info?.title ?? store.focusedRow?.title ?? "")
        }
        .sheet(item: sheetBinding(\.publishProject)) { item in
            PublishRepositorySheet(store: store, project: item.id)
        }
    }

    @ViewBuilder private var breadcrumb: some View {
        if store.shell.route != .thread {
            HStack(spacing: 7) {
                Image(systemName: store.shell.route.symbol)
                    .font(.system(size: 13, weight: .light))
                    .foregroundStyle(Theme.chromeIcon)
                    .accessibilityHidden(true)
                Text(store.shell.route.title)
                    .font(.system(size: 13, weight: .medium))
            }
        } else {
            HStack(spacing: 7) {
                Button {
                    store.newThread(in: projectID)
                } label: {
                    HStack(spacing: 7) {
                        ProjectTile(project: store.inbox.project(projectID))
                        Text(projectName)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("New thread in \(projectName)")
                .accessibilityLabel(projectName)
                .accessibilityHint("Starts a new thread in this project")
                Text("/")
                    .foregroundStyle(Theme.tertiaryText)
                    .accessibilityHidden(true)
                title
            }
            .font(.system(size: 13))
        }
    }

    @ViewBuilder private var title: some View {
        if let thread = store.focusedThread {
            if store.shell.headerRenaming {
                InlineRenameField(title: titleText) { value in
                    store.shell.headerRenaming = false
                    store.inbox.rename(thread, to: value)
                } cancel: {
                    store.shell.headerRenaming = false
                }
                .frame(maxWidth: 360)
            } else {
                HStack(spacing: 4) {
                    Text(titleText)
                        .fontWeight(.medium)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Theme.secondaryText)
                        .opacity(hoveringTitle ? 1 : 0)
                        .accessibilityHidden(true)
                }
                .padding(.horizontal, 5)
                .padding(.vertical, 3)
                .background(hoveringTitle ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .background(AnchorView(anchor: titleAnchor))
                .contentShape(Rectangle())
                .onHover { hoveringTitle = $0 }
                .onTapGesture(count: 2) { store.shell.headerRenaming = true }
                .onTapGesture { showThreadMenu(thread) }
                .accessibilityElement(children: .ignore)
                .accessibilityAddTraits(.isButton)
                .accessibilityLabel(titleText)
                .accessibilityHint("Shows thread actions")
                .accessibilityAction { showThreadMenu(thread) }
                .accessibilityAction(named: "Rename") { store.shell.headerRenaming = true }
            }
        } else {
            Text("New thread")
                .fontWeight(.medium)
        }
    }

    private func showThreadMenu(_ thread: String) {
        var nodes = ThreadActions.menu(store, for: thread, includeRename: false)
        let position = nodes.firstIndex { $0.id == "divider-edit" }.map { $0 + 1 } ?? nodes.count
        nodes.insert(.action("Rename Thread", symbol: "pencil") { store.shell.headerRenaming = true }, at: position)
        NativeMenu.popUp(nodes, below: titleAnchor.view)
    }

    private var projectID: String? {
        store.focusedProject
    }

    private var projectName: String {
        store.inbox.project(projectID)?.name ?? "No project"
    }

    private var titleText: String {
        let title = store.conversation.info?.title ?? store.focusedRow?.title ?? ""
        return title.isEmpty ? "Untitled thread" : title
    }

    private var probe: HeaderProbe? {
        guard store.shell.route == .thread else { return nil }
        return HeaderProbe(thread: store.focusedThread, pending: nil, title: store.focusedThread == nil ? "New thread" : titleText, project: projectName)
    }

    private var gitProject: String? {
        guard let project = store.gitProject(for: store.focusedRow) else { return nil }
        guard store.inbox.project(project)?.isGit ?? true else { return nil }
        return project
    }

    private func sheetBinding(_ path: ReferenceWritableKeyPath<ShellState, String?>) -> Binding<ProjectSheetID?> {
        Binding {
            store.shell[keyPath: path].map(ProjectSheetID.init)
        } set: { value in
            store.shell[keyPath: path] = value?.id
        }
    }
}

struct PanelToggles: View {
    let store: StudioStore

    var body: some View {
        HStack(spacing: 4) {
            ChromeIconButton(title("Toggle Terminal", "terminal.toggle"), symbol: "terminal", isOn: store.panels.terminalOpen) {
                store.panels.toggleTerminal()
            }
            ChromeIconButton(title("Toggle Right Panel", "rightPanel.toggle"), symbol: "sidebar.trailing", isOn: store.panels.rightPanelOpen, badge: store.panels.liveAgentCount) {
                store.panels.toggleRightPanel()
            }
        }
        .padding(.trailing, 10)
        .frame(height: Theme.Metrics.titlebarHeight)
    }

    private func title(_ base: String, _ command: String) -> String {
        store.shortcutText(command).map { "\(base) (\($0))" } ?? base
    }
}
