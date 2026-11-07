import LocalStudioKit
import SwiftUI

struct PaletteItem: Identifiable {
    enum Icon {
        case symbol(String)
        case project(Project?)
        case status(ThreadRow)
    }

    let id: String
    let group: String
    let title: String
    var subtitle: String?
    var icon: Icon = .symbol("circle")
    var shortcut: String?
    var checked = false
    let action: @MainActor () -> Void
}

struct CommandPalette: View {
    let store: StudioStore
    let page: PalettePage
    @Environment(\.openSettings) private var openSettings
    @State private var query = ""
    @State private var highlighted = 0
    @State private var request: String?
    @State private var failure: String?
    @FocusState private var focused: Bool

    var body: some View {
        let items = items
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                if page != .root {
                    Button {
                        go(.root)
                    } label: {
                        Text(pageTitle)
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(Theme.secondaryText)
                            .padding(.horizontal, 7)
                            .frame(height: 20)
                            .background(Theme.input, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .help("Back to all commands")
                } else {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14, weight: .light))
                        .foregroundStyle(Theme.secondaryText)
                        .accessibilityHidden(true)
                }
                TextField(placeholder, text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
                    .focused($focused)
                    .onKeyPress(.downArrow) {
                        highlighted = min(highlighted + 1, max(items.count - 1, 0))
                        return .handled
                    }
                    .onKeyPress(.upArrow) {
                        highlighted = max(highlighted - 1, 0)
                        return .handled
                    }
                    .onKeyPress(.escape) {
                        if page != .root {
                            go(.root)
                        } else {
                            store.shell.palette = nil
                        }
                        return .handled
                    }
                    .onKeyPress(.delete) {
                        guard query.isEmpty, page != .root else { return .ignored }
                        go(.root)
                        return .handled
                    }
                    .onSubmit {
                        if items.indices.contains(highlighted) {
                            items[highlighted].action()
                        }
                    }
            }
            .padding(.horizontal, 14)
            .frame(height: 46)
            Divider()
            list(items)
        }
        .frame(width: 600)
        .background(Theme.overlay, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline))
        .shadow(color: Theme.shadow, radius: 24, y: 10)
        .onAppear { focused = true }
        .onChange(of: query) { highlighted = 0 }
        .onChange(of: page) {
            query = ""
            highlighted = 0
            request = nil
            failure = nil
            focused = true
        }
        .task(id: SearchToken(page: page, query: query)) {
            await search()
        }
    }

    private func list(_ items: [PaletteItem]) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    if items.isEmpty {
                        Text(emptyText)
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.secondaryText)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 22)
                    }
                    ForEach(Array(items.enumerated()), id: \.element.id) { offset, item in
                        if offset == 0 || items[offset - 1].group != item.group {
                            Text(item.group)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Theme.secondaryText)
                                .padding(.horizontal, 10)
                                .padding(.top, offset == 0 ? 4 : 10)
                                .padding(.bottom, 3)
                        }
                        PaletteRow(item: item, highlighted: offset == highlighted)
                            .id(item.id)
                            .onTapGesture { item.action() }
                            .onHover { if $0 { highlighted = offset } }
                            .accessibilityElement(children: .combine)
                            .accessibilityAddTraits(offset == highlighted ? [.isButton, .isSelected] : .isButton)
                            .accessibilityAction { item.action() }
                    }
                }
                .padding(6)
            }
            .frame(maxHeight: 400)
            .fixedSize(horizontal: false, vertical: true)
            .scrollIndicators(.never)
            .onChange(of: highlighted) { _, value in
                if items.indices.contains(value) {
                    proxy.scrollTo(items[value].id)
                }
            }
        }
    }

    private var pageTitle: String {
        switch page {
        case .root: ""
        case .newThread: "New thread in"
        case .goToFile: "Go to file"
        case .searchProject: "Search project"
        case .appearance: "Appearance"
        }
    }

    private var placeholder: String {
        switch page {
        case .root: "Search commands, threads and projects"
        case .newThread: "Search projects…"
        case .goToFile: "Search files by name…"
        case .searchProject: "Search text in \(store.inbox.project(store.focusedProject)?.name ?? "the project")…"
        case .appearance: "Choose appearance"
        }
    }

    private var emptyText: String {
        if let failure { return failure }
        switch page {
        case .goToFile, .searchProject:
            if searchRoot == nil { return "Open a thread in a project to search its files." }
            if query.trimmingCharacters(in: .whitespaces).isEmpty { return "Type to search." }
            return request != nil && results == nil ? "Searching…" : "No matches."
        case .newThread: return "No matching projects."
        case .root, .appearance: return "No matching commands."
        }
    }

    private var items: [PaletteItem] {
        switch page {
        case .root: rootItems
        case .newThread: projectItems
        case .appearance: appearanceItems
        case .goToFile, .searchProject: fileItems
        }
    }

    private var rootItems: [PaletteItem] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        let matches: (String) -> Bool = { needle.isEmpty || $0.localizedCaseInsensitiveContains(needle) }
        var result = actions.filter { matches($0.title) }
        let threads = store.inbox.threads
        if needle.isEmpty {
            result += threads.sorted { $0.updatedAt > $1.updatedAt }.prefix(6).map { threadItem($0, group: "Recent Threads") }
        } else {
            result += store.inbox.projects.filter { matches($0.name) }.map { project in
                PaletteItem(id: "project-\(project.id)", group: "Projects", title: project.name, subtitle: (project.path as NSString).abbreviatingWithTildeInPath, icon: .project(project)) {
                    store.newThread(in: project.id)
                }
            }
            result += threads.filter { matches($0.title) }.prefix(20).map { threadItem($0, group: "Threads") }
        }
        return result
    }

    private var actions: [PaletteItem] {
        let group = "Actions"
        let current = store.inbox.project(store.focusedProject ?? store.inbox.currentProject)
        var items = [
            PaletteItem(id: "new", group: group, title: current.map { "New Thread in \($0.name)" } ?? "New Thread", icon: .symbol("plus"), shortcut: store.shortcutText("chat.newLocal")) {
                store.newThread(in: current?.id)
            },
            PaletteItem(id: "new-in", group: group, title: "New Thread in…", icon: .symbol("plus"), shortcut: store.shortcutText("chat.new")) { go(.newThread) },
            PaletteItem(id: "new-none", group: group, title: "New Thread Without a Project", icon: .symbol("plus"), shortcut: store.shortcutText("chat.newWithoutProject")) {
                store.newThread(in: nil)
            },
            PaletteItem(id: "add-project", group: group, title: "Add Project…", icon: .symbol("folder")) {
                store.shell.palette = nil
                store.addProjectInteractively()
            },
            PaletteItem(id: "clone", group: group, title: "Clone Repository…", icon: .symbol("arrow.down.circle")) {
                store.shell.palette = nil
                store.shell.cloneShown = true
            },
            PaletteItem(id: "file", group: group, title: "Go to File…", icon: .symbol("doc"), shortcut: store.shortcutText("filePicker.toggle")) { go(.goToFile) },
            PaletteItem(id: "search", group: group, title: "Search Project…", icon: .symbol("magnifyingglass"), shortcut: store.shortcutText("projectSearch.toggle")) { go(.searchProject) },
            PaletteItem(id: "settings", group: group, title: "Open Settings", icon: .symbol("slider.horizontal.3"), shortcut: "⌘,") {
                store.shell.palette = nil
                openSettings()
            },
            PaletteItem(id: "sidebar", group: group, title: "Toggle Sidebar", icon: .symbol("sidebar.leading"), shortcut: store.shortcutText("sidebar.toggle")) {
                store.shell.palette = nil
                store.toggleSidebar()
            },
            PaletteItem(id: "terminal", group: group, title: "Toggle Terminal", icon: .symbol("terminal"), shortcut: store.shortcutText("terminal.toggle")) {
                store.shell.palette = nil
                store.panels.toggleTerminal()
            },
            PaletteItem(id: "panel", group: group, title: "Toggle Right Panel", icon: .symbol("sidebar.trailing"), shortcut: store.shortcutText("rightPanel.toggle")) {
                store.shell.palette = nil
                store.panels.toggleRightPanel()
            },
            PaletteItem(id: "appearance", group: group, title: "Change Appearance…", icon: .symbol("circle.lefthalf.filled"), shortcut: store.shortcutText("appearance.cycle")) { go(.appearance) },
            PaletteItem(id: "usage", group: group, title: "Show Usage", icon: .symbol("chart.bar"), shortcut: store.shortcutText("usage.open")) { store.show(.usage) },
            PaletteItem(id: "local", group: group, title: "Show Local Models", icon: .symbol("server.rack")) { store.show(.local) },
            PaletteItem(id: "pulls", group: group, title: "Show Pull Requests", icon: .symbol("arrow.trianglehead.pull")) { store.show(.pullRequests) },
            PaletteItem(id: "archive", group: group, title: "Show Archived Threads", icon: .symbol("archivebox")) { store.show(.archive) },
        ]
        if let row = store.focusedRow {
            items += [
                PaletteItem(id: "pin", group: group, title: row.pinned ? "Unpin Thread" : "Pin Thread", icon: .symbol("pin"), shortcut: store.shortcutText("thread.pin")) {
                    store.shell.palette = nil
                    store.togglePin([row.id])
                },
                PaletteItem(id: "settle", group: group, title: row.shelf == .settled ? "Un-settle Thread" : "Settle Thread", icon: .symbol("checkmark"), shortcut: store.shortcutText("thread.settle")) {
                    store.shell.palette = nil
                    store.toggleSettle([row.id])
                },
                PaletteItem(id: "rename", group: group, title: "Rename Thread", icon: .symbol("pencil")) {
                    store.shell.palette = nil
                    store.shell.headerRenaming = true
                },
                PaletteItem(id: "regenerate", group: group, title: "Regenerate Thread Title", icon: .symbol("sparkles")) {
                    store.shell.palette = nil
                    store.inbox.regenerateTitles([row.id])
                },
                PaletteItem(id: "restart", group: group, title: "Restart Agent Session", icon: .symbol("arrow.clockwise")) {
                    store.shell.palette = nil
                    store.inbox.restart(row.id)
                },
                PaletteItem(id: "copy-ref", group: group, title: "Copy Thread Reference", icon: .symbol("doc.on.doc"), shortcut: store.shortcutText("thread.copyReference")) {
                    store.shell.palette = nil
                    store.copyReference(row.id)
                },
            ]
        }
        return items
    }

    private var projectItems: [PaletteItem] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        var result = store.inbox.projects.filter { needle.isEmpty || $0.name.localizedCaseInsensitiveContains(needle) }.map { project in
            PaletteItem(id: project.id, group: "Projects", title: project.name, subtitle: (project.path as NSString).abbreviatingWithTildeInPath, icon: .project(project), checked: project.id == store.inbox.currentProject) {
                store.newThread(in: project.id)
            }
        }
        if needle.isEmpty || "No project".localizedCaseInsensitiveContains(needle) {
            result.append(PaletteItem(id: "none", group: "Other", title: "No project", icon: .symbol("circle.dashed")) { store.newThread(in: nil) })
        }
        return result
    }

    private var appearanceItems: [PaletteItem] {
        let current = store.pages.settings?.colorScheme
        let options: [(LocalStudioKit.ColorScheme, String, String)] = [(.system, "System", "circle.lefthalf.filled"), (.light, "Light", "sun.max"), (.dark, "Dark", "moon")]
        return options.map { scheme, title, symbol in
            PaletteItem(id: title, group: "Appearance", title: title, icon: .symbol(symbol), checked: current == scheme) {
                store.shell.palette = nil
                store.setColorScheme(scheme)
            }
        }
    }

    private var fileItems: [PaletteItem] {
        guard let root = searchRoot, let results else { return [] }
        return results.enumerated().map { offset, hit in
            let name = (hit.relative as NSString).lastPathComponent
            let title = hit.line.map { "\(name):\($0)" } ?? name
            let subtitle = page == .searchProject ? hit.preview : (hit.relative as NSString).deletingLastPathComponent
            return PaletteItem(id: "\(offset)-\(hit.relative)-\(hit.line ?? 0)", group: page == .goToFile ? "Files" : hit.relative, title: page == .goToFile ? title : "\(hit.line.map { "\($0)" } ?? "")  \(hit.preview)", subtitle: page == .goToFile ? subtitle : nil, icon: .symbol(page == .goToFile ? "doc" : "text.alignleft")) {
                store.shell.palette = nil
                store.panels.openFile(project: root, relative: hit.relative, line: hit.line)
            }
        }
    }

    private var searchRoot: String? {
        store.workspacePath(for: store.focusedRow)
    }

    private var results: [SearchHit]? {
        request.flatMap { store.workspace.searchResults[$0] }
    }

    private func threadItem(_ row: ThreadRow, group: String) -> PaletteItem {
        PaletteItem(id: "\(group)-\(row.id)", group: group, title: row.title.isEmpty ? "Untitled thread" : row.title, subtitle: store.inbox.projectName(row.project), icon: .status(row)) {
            store.open(row.id)
        }
    }

    private func go(_ page: PalettePage) {
        store.shell.palette = page
    }

    private func search() async {
        guard page == .goToFile || page == .searchProject, let root = searchRoot else { return }
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else {
            request = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(120))
        guard !Task.isCancelled else { return }
        failure = nil
        let id = store.requests.issue { outcome in
            if case .failed(let message) = outcome { failure = message }
        }
        request = id
        let files = page == .goToFile
        store.core.run { studio in
            if files {
                studio.searchFiles(request: id, project: root, query: needle, limit: 50)
            } else {
                studio.searchText(request: id, project: root, query: needle, limit: 100)
            }
        }
    }

    private struct SearchToken: Hashable {
        let page: PalettePage
        let query: String
    }
}

private struct PaletteRow: View {
    let item: PaletteItem
    let highlighted: Bool

    var body: some View {
        HStack(spacing: 10) {
            icon
                .frame(width: 18)
            Text(item.title)
                .font(.system(size: 13))
                .lineLimit(1)
            if let subtitle = item.subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 8)
            if item.checked {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.primary)
                    .accessibilityLabel("Selected")
            }
            if let shortcut = item.shortcut {
                ShortcutHint(text: shortcut)
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .contentShape(Rectangle())
        .rowSurface(selected: highlighted, hovering: false)
    }

    @ViewBuilder private var icon: some View {
        switch item.icon {
        case .symbol(let name):
            Image(systemName: name)
                .font(.system(size: 13, weight: .light))
                .foregroundStyle(Theme.chromeIcon)
                .accessibilityHidden(true)
        case .project(let project):
            ProjectTile(project: project, size: 16)
        case .status(let row):
            if let glyph = StatusBadge.glyph(row.status) {
                Image(systemName: glyph.symbol)
                    .font(.system(size: 12))
                    .foregroundStyle(glyph.tint)
                    .accessibilityLabel(glyph.title)
            } else {
                Image(systemName: "bubble.left")
                    .font(.system(size: 12, weight: .light))
                    .foregroundStyle(Theme.chromeIcon)
                    .accessibilityHidden(true)
            }
        }
    }
}
