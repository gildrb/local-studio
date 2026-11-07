import AppKit
import LocalStudioKit
import SwiftUI

struct SidebarView: View {
    let store: StudioStore
    @State private var viewport: CGFloat = 0
    @State private var highlighted = 0
    @FocusState private var searchFocused: Bool
    @State private var dropTarget: String?

    var body: some View {
        VStack(spacing: 0) {
            searchRow
                .padding(.top, Theme.Metrics.titlebarHeight)
            content
            if let undo = store.inbox.undo {
                UndoNotice(undo: undo, store: store)
            }
            SidebarFooter(store: store)
        }
        .background(alignment: .top) {
            TitlebarDragArea()
                .frame(height: Theme.Metrics.titlebarHeight)
        }
        .onExitCommand { store.inbox.clearSelection() }
        .onChange(of: store.shell.searchFocusRequest) {
            searchFocused = true
            DispatchQueue.main.async {
                (NSApp.keyWindow?.firstResponder as? NSTextView)?.moveToEndOfDocument(nil)
            }
        }
    }

    private var searchRow: some View {
        HStack(spacing: 2) {
            SidebarSearchField(text: Bindable(store.inbox).query, focused: $searchFocused) { key in
                handleSearchKey(key)
            }
            ProjectFilterButton(store: store)
            AddProjectMenu(store: store)
        }
        .padding(.horizontal, Theme.Metrics.sidebarInset)
        .padding(.bottom, 6)
    }

    @ViewBuilder private var content: some View {
        if !store.inbox.query.trimmingCharacters(in: .whitespaces).isEmpty {
            SearchResultsList(store: store, highlighted: highlighted)
        } else if store.inbox.projects.isEmpty, store.inbox.sections.isEmpty, store.connection == .ready || store.inbox.receivedThreads {
            NoProjectsSidebar(store: store)
        } else {
            TimelineView(.periodic(from: .now, by: 30)) { context in
                inbox(now: context.date)
            }
        }
    }

    private func inbox(now: Date) -> some View {
        let sections = store.inbox.sections
        let order = store.inbox.visibleOrder
        let hints = store.shell.commandHeld ? Dictionary(order.prefix(9).enumerated().map { ($1, $0 + 1) }, uniquingKeysWith: { first, _ in first }) : [:]
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        if store.shell.route == .thread, store.conversation.selectedID == nil {
                            DraftRow(store: store, selected: store.inbox.selection.isEmpty)
                        }
                        ForEach(sections.pinned, id: \.id) { row in
                            InboxRowView(store: store, row: row, variant: .card, now: now, jump: hints[row.id])
                                .pinnedDropTarget(store: store, before: row.id, target: $dropTarget)
                        }
                        if !sections.pinned.isEmpty {
                            Color.clear
                                .frame(height: 6)
                                .pinnedDropTarget(store: store, before: nil, target: $dropTarget)
                        }
                        ForEach(keyed(sections.active), id: \.key) { item in
                            let row = item.row
                            InboxRowView(store: store, row: row, variant: .card, now: now, jump: hints[row.id])
                        }
                        if sections.pinned.isEmpty, sections.active.isEmpty, sections.working.isEmpty {
                            EmptyInbox(store: store)
                        }
                    }
                    Spacer(minLength: 10)
                    LazyVStack(alignment: .leading, spacing: 2) {
                        shelf(.working, rows: sections.working, now: now, hints: hints, variant: .card)
                        shelf(.snoozed, rows: sections.snoozed, now: now, hints: hints, variant: .slim)
                        shelf(.settled, rows: sections.settled, now: now, hints: hints, variant: .slim)
                    }
                }
                .padding(.horizontal, Theme.Metrics.sidebarInset)
                .padding(.vertical, 4)
                .frame(minHeight: viewport, alignment: .top)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewport = $0 }
            .scrollIndicators(.never)
            .scrollContentBackground(.hidden)
            .onChange(of: store.shell.sidebarCursor) { _, cursor in
                if let cursor, store.shell.region == .sidebar {
                    proxy.scrollTo(cursor)
                }
            }
        }
    }

    @ViewBuilder
    private func shelf(_ shelf: InboxShelf, rows: [ThreadRow], now: Date, hints: [String: Int], variant: InboxRowView.Variant) -> some View {
        if !rows.isEmpty {
            let expanded = !store.inbox.collapsed.contains(shelf)
            ShelfHeader(shelf: shelf, count: rows.count, expanded: expanded) { store.inbox.toggleShelf(shelf) }
            if expanded {
                let visible = shelf == .settled ? Array(rows.prefix(store.inbox.settledLimit)) : rows
                ForEach(keyed(visible), id: \.key) { item in
                    let row = item.row
                    InboxRowView(store: store, row: row, variant: variant, now: now, jump: hints[row.id])
                }
                if shelf == .settled, rows.count > visible.count {
                    Button("Show \(min(InboxStore.settledPage, rows.count - visible.count)) more") {
                        store.inbox.showMoreSettled()
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 10)
                    .frame(height: 26)
                }
            }
        }
    }

    private func keyed(_ rows: [ThreadRow]) -> [KeyedRow] {
        rows.map { KeyedRow(key: store.inbox.key($0.id), row: $0) }
    }

    private func handleSearchKey(_ key: SearchKey) -> Bool {
        let results = store.inbox.searchEntries
        switch key {
        case .down:
            guard !results.isEmpty else { return leaveSearch() }
            highlighted = min(highlighted + 1, results.count - 1)
        case .up:
            guard !results.isEmpty else { return false }
            highlighted = max(highlighted - 1, 0)
        case .enter:
            guard results.indices.contains(highlighted) else { return false }
            store.open(results[highlighted].id)
            store.inbox.query = ""
            searchFocused = false
        case .escape:
            guard !store.inbox.query.isEmpty else { return leaveSearch() }
            store.inbox.query = ""
        case .changed:
            highlighted = 0
            return false
        }
        return true
    }

    private func leaveSearch() -> Bool {
        guard store.inbox.query.isEmpty else { return false }
        searchFocused = false
        store.focus(.sidebar)
        return true
    }
}

struct KeyedRow {
    let key: String
    let row: ThreadRow
}

enum SearchKey {
    case up
    case down
    case enter
    case escape
    case changed
}

struct SidebarSearchField: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    let onKey: (SearchKey) -> Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .light))
                .foregroundStyle(Theme.secondaryText)
                .accessibilityHidden(true)
            TextField("Search", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .focused(focused)
                .accessibilityLabel("Search threads")
                .onKeyPress(.downArrow) { onKey(.down) ? .handled : .ignored }
                .onKeyPress(.upArrow) { onKey(.up) ? .handled : .ignored }
                .onKeyPress(.return) { onKey(.enter) ? .handled : .ignored }
                .onKeyPress(.escape) { onKey(.escape) ? .handled : .ignored }
                .onChange(of: text) { _ = onKey(.changed) }
            if !text.isEmpty {
                Button("Clear Search", systemImage: "xmark.circle.fill") { text = "" }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .padding(.horizontal, 9)
        .frame(height: 28)
        .background(Theme.hover, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

struct SearchResultsList: View {
    let store: StudioStore
    let highlighted: Int

    var body: some View {
        let results = store.inbox.searchEntries
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(results.enumerated()), id: \.element.id) { offset, entry in
                        SearchResultRow(store: store, entry: entry, query: store.inbox.query, highlighted: offset == highlighted)
                            .id(entry.id)
                    }
                    if store.inbox.searchingMessages {
                        Text("Searching thread messages…")
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.secondaryText)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                    } else if results.isEmpty {
                        Text("No threads found")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.secondaryText)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 24)
                    }
                }
                .padding(.horizontal, Theme.Metrics.sidebarInset)
                .padding(.vertical, 4)
            }
            .scrollIndicators(.never)
            .onChange(of: highlighted) { _, value in
                if results.indices.contains(value) {
                    proxy.scrollTo(results[value].id)
                }
            }
        }
        .task(id: store.inbox.query) {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            store.inbox.searchMessages()
        }
    }
}

struct SearchResultRow: View {
    let store: StudioStore
    let entry: InboxSearchEntry
    let query: String
    let highlighted: Bool
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            ProjectTile(project: store.inbox.project(entry.project), size: 14)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(Self.highlight(entry.title.isEmpty ? "Untitled thread" : entry.title, query, size: 13))
                        .font(.system(size: 13))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if let updatedAt = entry.updatedAt {
                        Text(RelativeAge.text(millis: updatedAt))
                            .font(.system(size: 11.5))
                            .monospacedDigit()
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                if let snippet = entry.snippet, !snippet.isEmpty {
                    Text(Self.highlight(Self.excerpt(snippet, around: query), query, size: 11.5))
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(2)
                } else {
                    Text(store.inbox.projectName(entry.project) + (entry.branch.map { " · \($0)" } ?? ""))
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .rowSurface(selected: highlighted, hovering: hovering)
        .onHover { hovering = $0 }
        .onTapGesture {
            store.open(entry.id)
            store.inbox.query = ""
        }
        .contextMenu {
            if store.inbox.thread(entry.id) != nil {
                MenuNodes(nodes: ThreadActions.menu(store, for: entry.id, includeRename: false))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    static func highlight(_ text: String, _ query: String, size: CGFloat) -> AttributedString {
        var result = AttributedString(text)
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return result }
        var searchStart = result.startIndex
        while searchStart < result.endIndex, let range = result[searchStart...].range(of: needle, options: .caseInsensitive) {
            result[range][AttributeScopes.SwiftUIAttributes.FontAttribute.self] = .system(size: size, weight: .semibold)
            result[range][AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] = Theme.primary
            searchStart = range.upperBound
        }
        return result
    }

    static func excerpt(_ snippet: String, around query: String) -> String {
        let flat = snippet.split(whereSeparator: \.isNewline).joined(separator: " ")
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty, let range = flat.range(of: needle, options: .caseInsensitive) else { return flat }
        let lead = flat.distance(from: flat.startIndex, to: range.lowerBound)
        guard lead > 32 else { return flat }
        let start = flat.index(range.lowerBound, offsetBy: -24)
        return "…" + flat[start...].trimmingCharacters(in: .whitespaces)
    }
}

struct EmptyInbox: View {
    let store: StudioStore

    var body: some View {
        Text(message)
            .font(.system(size: 12))
            .foregroundStyle(Theme.secondaryText)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
    }

    private var message: String {
        if store.connection == .connecting, !store.inbox.receivedThreads {
            return "Connecting…"
        }
        if let filter = store.inbox.projectFilter {
            return "No threads in \(store.inbox.projectName(filter)) yet"
        }
        return "No threads yet"
    }
}

struct NoProjectsSidebar: View {
    let store: StudioStore

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "folder")
                .font(.system(size: 22, weight: .light))
                .foregroundStyle(Theme.chromeIcon)
                .accessibilityHidden(true)
            Text("No projects yet")
                .font(.system(size: 13, weight: .medium))
            Text("Add a folder to start a thread in it.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
            Button("Add Project") { store.addProjectInteractively() }
                .controlSize(.regular)
                .padding(.top, 2)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct UndoNotice: View {
    let undo: InboxUndo
    let store: StudioStore

    var body: some View {
        HStack(spacing: 8) {
            Text(undo.label)
                .font(.system(size: 12))
                .lineLimit(1)
            Spacer(minLength: 4)
            Button("Undo") { store.inbox.performUndo() }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.primary)
            Button("Dismiss", systemImage: "xmark") { store.inbox.dismissUndo() }
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Theme.secondaryText)
        }
        .padding(.horizontal, 12)
        .frame(height: 34)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metrics.rowRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.Metrics.rowRadius, style: .continuous).strokeBorder(Theme.hairline))
        .padding(.horizontal, Theme.Metrics.sidebarInset)
        .padding(.top, 6)
        .task(id: undo) {
            try? await Task.sleep(for: .seconds(8))
            if !Task.isCancelled, store.inbox.undo == undo {
                store.inbox.dismissUndo()
            }
        }
    }
}

private struct SidebarFooter: View {
    let store: StudioStore
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        HStack(spacing: 0) {
            if store.shell.route != .thread {
                Button {
                    store.goBack()
                } label: {
                    Label("Back", systemImage: "chevron.left")
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.chromeIcon)
                        .padding(.horizontal, 8)
                        .frame(height: Theme.Metrics.chromeButton)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Back to threads")
                Spacer()
            } else {
                ChromeIconButton("Settings", symbol: "slider.horizontal.3") { openSettings() }
                ChromeIconButton("Usage", symbol: "chart.bar") { store.show(.usage) }
                ChromeIconButton("Pull Requests", symbol: "arrow.trianglehead.pull") { store.show(.pullRequests) }
                Spacer()
                ChromeIconButton("Local", symbol: "server.rack") { store.show(.local) }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }
}

private struct AddProjectMenu: View {
    let store: StudioStore
    @State private var hovering = false

    var body: some View {
        Menu {
            Button("Open Folder…") { store.addProjectInteractively() }
            Button("Clone Repository…") { store.shell.cloneShown = true }
        } label: {
            Image(systemName: "folder")
                .font(.system(size: 15, weight: .light))
                .foregroundStyle(Theme.chromeIcon)
                .accessibilityHidden(true)
        } primaryAction: {
            store.addProjectInteractively()
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .frame(width: Theme.Metrics.chromeButton, height: Theme.Metrics.chromeButton)
        .background(hovering ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .onHover { hovering = $0 }
        .help("Add Project (hold for Clone Repository…)")
        .accessibilityLabel("Add Project")
    }
}
