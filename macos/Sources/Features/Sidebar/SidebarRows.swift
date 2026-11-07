import AppKit
import LocalStudioKit
import SwiftUI

struct StatusBadge: View {
    let row: ThreadRow
    let now: Date

    var body: some View {
        if let glyph = Self.glyph(row.status) {
            HStack(spacing: 4) {
                Image(systemName: glyph.symbol)
                    .font(.system(size: 11, weight: .regular))
                    .accessibilityHidden(true)
                Text(label(glyph.title))
                    .font(.system(size: 11.5))
                    .monospacedDigit()
            }
            .foregroundStyle(glyph.tint)
            .lineLimit(1)
            .fixedSize()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label(glyph.title))
        } else {
            Text(RelativeAge.text(millis: row.updatedAt, now: now))
                .font(.system(size: 11.5))
                .monospacedDigit()
                .foregroundStyle(Theme.secondaryText)
                .fixedSize()
        }
    }

    private func label(_ title: String) -> String {
        guard row.status == .working, let since = row.statusSince else { return title }
        return "\(title) \(RelativeAge.duration(since: since, now: now))"
    }

    static func glyph(_ status: ThreadStatus) -> (symbol: String, title: String, tint: Color)? {
        switch status {
        case .idle: nil
        case .working: ("circle.dotted", "Working", Theme.working)
        case .approval: ("exclamationmark.shield", "Approval", Theme.warning)
        case .failed: ("exclamationmark.circle", "Failed", Theme.danger)
        case .done: ("checkmark.circle", "Done", Theme.success)
        case .woke: ("alarm", "Woke", Theme.woke)
        }
    }
}

struct JumpHint: View {
    let number: Int

    var body: some View {
        Text("⌘\(number)")
            .font(.system(size: 10.5, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 5)
            .frame(height: 17)
            .background(Theme.input, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

struct RowActionButton: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(Theme.chromeIcon)
                .accessibilityHidden(true)
                .frame(width: 20, height: 20)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
    }
}

struct RowSnoozeMenu: View {
    let store: StudioStore
    let ids: [String]

    var body: some View {
        Menu {
            MenuNodes(nodes: ThreadActions.snoozeMenu(store, ids))
        } label: {
            Image(systemName: "clock")
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(Theme.chromeIcon)
                .accessibilityHidden(true)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .frame(width: 20, height: 20)
        .help("Snooze")
        .accessibilityLabel("Snooze")
    }
}

struct InboxRowView: View {
    enum Variant {
        case card
        case slim
    }

    let store: StudioStore
    let row: ThreadRow
    let variant: Variant
    let now: Date
    let jump: Int?
    @State private var hovering = false

    var body: some View {
        Group {
            switch variant {
            case .card: card
            case .slim: slim
            }
        }
        .contentShape(Rectangle())
        .rowSurface(selected: highlighted, hovering: hovering)
        .opacity(row.status == .working && !highlighted ? 0.85 : 1)
        .onHover { hovering = $0 }
        .onTapGesture { click() }
        .contextMenu { MenuNodes(nodes: ThreadActions.menu(store, for: row.id)) }
        .draggable(row.id) {
            Text(row.title.isEmpty ? "Untitled thread" : row.title)
                .font(.system(size: 13, weight: .medium))
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .accessibilityElement(children: store.inbox.renaming == row.id ? .contain : .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(highlighted ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { store.open(row.id) }
        .accessibilityAction(named: row.pinned ? "Unpin" : "Pin") { store.togglePin([row.id]) }
        .accessibilityAction(named: row.shelf == .settled ? "Un-settle" : "Settle") { store.toggleSettle([row.id]) }
        .help(tooltip)
    }

    private var accessibilityText: String {
        var parts = [row.title.isEmpty ? "Untitled thread" : row.title, store.inbox.projectName(row.project)]
        if let glyph = StatusBadge.glyph(row.status) { parts.append(glyph.title) }
        if row.pinned { parts.append("Pinned") }
        if row.unread { parts.append("Unread") }
        if row.shelf == .snoozed, let until = row.snoozedUntil { parts.append("Wakes in \(RelativeAge.countdown(millis: until, now: now))") }
        if let branch = row.branch { parts.append("Branch \(branch)") }
        return parts.joined(separator: ", ")
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                ProjectTile(project: project, size: 14)
                Text(store.inbox.projectName(row.project))
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if row.pinned {
                    Image(systemName: "pin")
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.tertiaryText)
                        .accessibilityHidden(true)
                }
                trailing
            }
            .frame(height: 18)
            titleLine
            if hasMeta {
                metaLine
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(minHeight: hasMeta ? Theme.Metrics.cardRowHeight : 46, alignment: .leading)
    }

    private var slim: some View {
        HStack(spacing: 8) {
            ProjectTile(project: project, size: 14)
                .opacity(hovering || highlighted ? 1 : 0.45)
            if row.unread {
                UnreadDot()
            }
            titleText(weight: .regular)
            if row.pinned {
                Image(systemName: "pin")
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.tertiaryText)
                    .accessibilityHidden(true)
            }
            Spacer(minLength: 4)
            if let jump {
                JumpHint(number: jump)
            } else if hovering {
                slimAction
            } else if row.status == .woke {
                Text("Woke")
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(Theme.woke)
                    .padding(.horizontal, 6)
                    .frame(height: 17)
                    .background(Theme.woke.opacity(0.14), in: Capsule())
            } else if row.shelf == .snoozed, let until = row.snoozedUntil {
                Label(RelativeAge.countdown(millis: until, now: now), systemImage: "clock")
                    .labelStyle(.titleAndIcon)
                    .font(.system(size: 11.5))
                    .monospacedDigit()
                    .foregroundStyle(Theme.secondaryText)
            } else {
                StatusBadge(row: row, now: now)
            }
        }
        .padding(.horizontal, 10)
        .frame(height: Theme.Metrics.rowHeight)
    }

    @ViewBuilder private var trailing: some View {
        if let jump {
            JumpHint(number: jump)
        } else if hovering {
            HStack(spacing: 2) {
                RowSnoozeMenu(store: store, ids: store.inbox.targets(for: row.id))
                RowActionButton(title: "Settle", symbol: "checkmark") { store.inbox.setSettled(store.inbox.targets(for: row.id), true) }
            }
        } else {
            StatusBadge(row: row, now: now)
        }
    }

    @ViewBuilder private var slimAction: some View {
        switch row.shelf {
        case .snoozed:
            RowActionButton(title: "Wake Thread Now", symbol: "alarm") { store.inbox.snooze([row.id], until: nil) }
        case .settled:
            RowActionButton(title: "Un-settle", symbol: "arrow.uturn.backward") { store.inbox.setSettled([row.id], false) }
        case .pinned, .active, .working:
            RowActionButton(title: "Settle", symbol: "checkmark") { store.inbox.setSettled([row.id], true) }
        }
    }

    private var titleLine: some View {
        HStack(spacing: 6) {
            if row.unread {
                UnreadDot()
            }
            titleText(weight: row.unread ? .semibold : .medium)
        }
        .frame(height: 18)
    }

    @ViewBuilder
    private func titleText(weight: Font.Weight) -> some View {
        if store.inbox.renaming == row.id {
            InlineRenameField(title: row.title) { store.inbox.rename(row.id, to: $0) } cancel: {
                store.inbox.renaming = nil
            }
        } else {
            Text(row.title.isEmpty ? "Untitled thread" : row.title)
                .font(.system(size: 13, weight: weight))
                .foregroundStyle(row.shelf == .settled && !highlighted ? Theme.secondaryText : Color.primary)
                .lineLimit(1)
        }
    }

    private var metaLine: some View {
        HStack(spacing: 6) {
            if let branch = row.branch {
                Image(systemName: row.worktree == nil ? "arrow.triangle.branch" : "folder")
                    .font(.system(size: 9.5))
                    .accessibilityHidden(true)
                Text(branch)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 4)
            if row.additions > 0 || row.deletions > 0 {
                HStack(spacing: 4) {
                    Text("+\(row.additions)").foregroundStyle(Theme.success)
                    Text("−\(row.deletions)").foregroundStyle(Theme.danger)
                }
                .font(.system(size: 10.5, design: .monospaced))
            }
            if let provider = row.provider {
                Text(provider)
                    .lineLimit(1)
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(Theme.tertiaryText)
        .frame(height: 15)
    }

    private var hasMeta: Bool {
        row.branch != nil || row.additions > 0 || row.deletions > 0 || row.provider != nil
    }

    private var project: Project? {
        store.inbox.project(row.project)
    }

    private var highlighted: Bool {
        store.inbox.selection.contains(row.id) || (store.inbox.selection.isEmpty && store.shell.route == .thread && store.focusedThread == row.id)
    }

    private var tooltip: String {
        var lines = [row.title, store.inbox.projectName(row.project)]
        if let branch = row.branch { lines.append(branch) }
        if let model = row.model { lines.append([row.provider, model].compactMap(\.self).joined(separator: " · ")) }
        if let note = row.note { lines.append(note) }
        return lines.joined(separator: "\n")
    }

    private func click() {
        let flags = NSEvent.modifierFlags
        if NSApp.currentEvent?.clickCount == 2, flags.isDisjoint(with: [.command, .shift]) {
            store.inbox.renaming = row.id
            return
        }
        if flags.contains(.command) {
            store.inbox.toggleSelection(row.id, focused: store.focusedThread)
        } else if flags.contains(.shift) {
            store.inbox.extendSelection(to: row.id)
        } else {
            store.inbox.clearSelection()
            store.inbox.selectionAnchor = row.id
            store.open(row.id)
        }
    }
}

struct UnreadDot: View {
    var body: some View {
        Circle()
            .fill(Theme.primary)
            .frame(width: 6, height: 6)
            .accessibilityLabel("Unread")
    }
}

struct InlineRenameField: View {
    let title: String
    let commit: (String) -> Void
    let cancel: () -> Void
    @State private var text = ""
    @State private var finished = false
    @FocusState private var focused: Bool

    var body: some View {
        TextField("Thread title", text: $text)
            .textFieldStyle(.plain)
            .font(.system(size: 13, weight: .medium))
            .padding(.horizontal, 4)
            .background(Theme.input, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            .focused($focused)
            .onAppear {
                text = title
                focused = true
            }
            .onSubmit { finish(commit: true) }
            .onExitCommand { finish(commit: false) }
            .onChange(of: focused) { _, isFocused in
                if !isFocused { finish(commit: true) }
            }
    }

    private func finish(commit shouldCommit: Bool) {
        guard !finished else { return }
        finished = true
        if shouldCommit {
            commit(text)
        } else {
            cancel()
        }
    }
}

struct DraftRow: View {
    let store: StudioStore
    let selected: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "pencil")
                .font(.system(size: 12, weight: .light))
                .foregroundStyle(Theme.chromeIcon)
                .frame(width: 14)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text("New thread")
                    .font(.system(size: 13, weight: .medium))
                Text(store.inbox.currentProject.map { store.inbox.projectName($0) } ?? "No project")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
            }
            Spacer(minLength: 4)
        }
        .padding(.horizontal, 10)
        .frame(height: 44)
        .contentShape(Rectangle())
        .rowSurface(selected: selected, hovering: hovering)
        .onHover { hovering = $0 }
        .onTapGesture { store.newThread(in: store.inbox.currentProject) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

struct ShelfHeader: View {
    let shelf: InboxShelf
    let count: Int
    let expanded: Bool
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 6) {
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .frame(width: 10)
                    .accessibilityHidden(true)
                Text(shelf.title)
                    .font(.system(size: 11.5, weight: .semibold))
                Text("\(count)")
                    .font(.system(size: 11.5))
                    .monospacedDigit()
                Spacer()
            }
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(shelf.title), \(count) threads, \(expanded ? "expanded" : "collapsed")")
    }
}

private struct PinnedDropTarget: ViewModifier {
    let store: StudioStore
    let before: String?
    @Binding var target: String?

    private var key: String {
        before ?? "pinned-end"
    }

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if target == key {
                    Capsule()
                        .fill(Theme.primary)
                        .frame(height: 2)
                        .offset(y: -2)
                        .accessibilityHidden(true)
                }
            }
            .dropDestination(for: String.self) { items, _ in
                target = nil
                guard let id = items.first, store.inbox.thread(id) != nil else { return false }
                store.inbox.movePinned(id, before: before)
                return true
            } isTargeted: { inside in
                if inside {
                    target = key
                } else if target == key {
                    target = nil
                }
            }
    }
}

extension View {
    func pinnedDropTarget(store: StudioStore, before: String?, target: Binding<String?>) -> some View {
        modifier(PinnedDropTarget(store: store, before: before, target: target))
    }
}
