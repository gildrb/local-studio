import AppKit
import SwiftUI

struct PickerRow: Identifiable {
    let id: String
    let title: String
    let symbol: String?
    let subtitle: String?
    let detail: String?
    let checked: Bool
    let enabled: Bool
    let destructive: Bool
    let keepsOpen: Bool
    let section: String?
    let action: @MainActor () -> Void

    init(
        id: String? = nil,
        title: String,
        symbol: String? = nil,
        subtitle: String? = nil,
        detail: String? = nil,
        checked: Bool = false,
        enabled: Bool = true,
        destructive: Bool = false,
        keepsOpen: Bool = false,
        section: String? = nil,
        action: @escaping @MainActor () -> Void
    ) {
        self.id = id ?? title
        self.title = title
        self.symbol = symbol
        self.subtitle = subtitle
        self.detail = detail
        self.checked = checked
        self.enabled = enabled
        self.destructive = destructive
        self.keepsOpen = keepsOpen
        self.section = section
        self.action = action
    }
}

private struct PickerGroup: Identifiable {
    let id: Int
    let title: String?
    var rows: [PickerRow]
}

struct PickerPanel: View {
    let title: String?
    let rows: [PickerRow]
    let query: Binding<String>?
    let prompt: String
    let emptyText: String?
    let width: CGFloat
    let maxHeight: CGFloat
    let dismiss: () -> Void
    @State private var highlighted: String?
    @State private var typed = ""
    @State private var typedAt = Date.distantPast
    @State private var mouse: CGPoint?
    @FocusState private var focused: Bool

    init(
        title: String? = nil,
        rows: [PickerRow],
        query: Binding<String>? = nil,
        prompt: String = "Search",
        emptyText: String? = nil,
        width: CGFloat = 280,
        maxHeight: CGFloat = 380,
        dismiss: @escaping () -> Void
    ) {
        self.title = title
        self.rows = rows
        self.query = query
        self.prompt = prompt
        self.emptyText = emptyText
        self.width = width
        self.maxHeight = maxHeight
        self.dismiss = dismiss
    }

    var body: some View {
        ScrollViewReader { proxy in
            VStack(spacing: 0) {
                if let query {
                    searchField(query, proxy: proxy)
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                }
                if rows.isEmpty {
                    if let emptyText {
                        Text(emptyText)
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.secondaryText)
                            .multilineTextAlignment(.center)
                            .padding(20)
                            .frame(maxWidth: .infinity)
                    }
                } else {
                    list
                }
            }
            .frame(width: width)
            .modifier(PickerKeyFocus(active: query == nil, focused: $focused) { handle($0, proxy: proxy) })
        }
        .onAppear {
            highlighted = initialHighlight
            focused = true
        }
        .onChange(of: rows.map(\.id)) { resync() }
    }

    private func searchField(_ text: Binding<String>, proxy: ScrollViewProxy) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .icon(.inline, .secondary)
                .accessibilityHidden(true)
            TextField(prompt, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .focused($focused)
                .onKeyPress(phases: [.down, .repeat]) { handle($0, proxy: proxy) }
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if let title {
                    header(title, first: true)
                }
                ForEach(groups) { group in
                    if group.id > 0, group.title == nil {
                        Rectangle()
                            .fill(Theme.hairline)
                            .frame(height: 1)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 5)
                    }
                    if let section = group.title {
                        header(section, first: group.id == 0 && title == nil)
                    }
                    ForEach(group.rows) { row in
                        PickerRowView(row: row, highlighted: highlighted == row.id) {
                            hover(row)
                        } activate: {
                            activate(row)
                        }
                        .id(row.id)
                    }
                }
            }
            .padding(6)
        }
        .frame(maxHeight: maxHeight)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func header(_ text: String, first: Bool) -> some View {
        Text(text)
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 10)
            .padding(.top, first ? 4 : 10)
            .padding(.bottom, 3)
            .accessibilityAddTraits(.isHeader)
    }

    private var groups: [PickerGroup] {
        var groups: [PickerGroup] = []
        for row in rows {
            if let last = groups.last, last.title == row.section {
                groups[groups.count - 1].rows.append(row)
            } else {
                groups.append(PickerGroup(id: groups.count, title: row.section, rows: [row]))
            }
        }
        return groups
    }

    private var initialHighlight: String? {
        (rows.first { $0.checked && $0.enabled } ?? rows.first(where: \.enabled))?.id
    }

    private func resync() {
        let enabled = rows.filter(\.enabled)
        if let query, !query.wrappedValue.isEmpty {
            highlighted = enabled.first?.id
        } else if !enabled.contains(where: { $0.id == highlighted }) {
            highlighted = initialHighlight
        }
    }

    private func handle(_ press: KeyPress, proxy: ScrollViewProxy) -> KeyPress.Result {
        switch press.key {
        case .downArrow:
            move(1, proxy: proxy)
        case .upArrow:
            move(-1, proxy: proxy)
        case .return:
            if let row = rows.first(where: { $0.id == highlighted }) {
                activate(row)
            }
        case .escape:
            dismiss()
        default:
            return query == nil ? typeSelect(press, proxy: proxy) : .ignored
        }
        return .handled
    }

    private func move(_ step: Int, proxy: ScrollViewProxy) {
        let enabled = rows.filter(\.enabled)
        guard !enabled.isEmpty else { return }
        let next = enabled.firstIndex { $0.id == highlighted }.map { min(max($0 + step, 0), enabled.count - 1) } ?? (step > 0 ? 0 : enabled.count - 1)
        reveal(enabled[next].id, proxy: proxy)
    }

    private func typeSelect(_ press: KeyPress, proxy: ScrollViewProxy) -> KeyPress.Result {
        let typeable = CharacterSet.alphanumerics.union(.punctuationCharacters).union(.symbols).union(.whitespaces)
        let characters = press.characters.lowercased()
        guard press.modifiers.subtracting([.shift, .capsLock]).isEmpty, !characters.isEmpty,
              characters.unicodeScalars.allSatisfy({ typeable.contains($0) }) else { return .ignored }
        let now = Date()
        let prefix = now.timeIntervalSince(typedAt) > 1 ? characters : typed + characters
        typed = prefix
        typedAt = now
        let enabled = rows.filter(\.enabled)
        let current = enabled.firstIndex { $0.id == highlighted }
        let start = min(current.map { prefix.count == 1 ? $0 + 1 : $0 } ?? 0, enabled.count)
        let ordered = Array(enabled[start...]) + enabled[..<start]
        if let match = ordered.first(where: { $0.title.lowercased().hasPrefix(prefix) }) {
            reveal(match.id, proxy: proxy)
        }
        return .handled
    }

    private func reveal(_ id: String, proxy: ScrollViewProxy) {
        highlighted = id
        proxy.scrollTo(id)
    }

    private func hover(_ row: PickerRow) {
        let location = NSEvent.mouseLocation
        guard row.enabled, location != mouse else { return }
        mouse = location
        highlighted = row.id
    }

    private func activate(_ row: PickerRow) {
        guard row.enabled else { return }
        row.action()
        if !row.keepsOpen {
            dismiss()
        }
    }
}

private struct PickerKeyFocus: ViewModifier {
    let active: Bool
    let focused: FocusState<Bool>.Binding
    let handle: (KeyPress) -> KeyPress.Result

    @ViewBuilder
    func body(content: Content) -> some View {
        if active {
            content
                .focusable()
                .focusEffectDisabled()
                .focused(focused)
                .onKeyPress(phases: [.down, .repeat], action: handle)
        } else {
            content
        }
    }
}

private struct PickerRowView: View {
    let row: PickerRow
    let highlighted: Bool
    let hover: () -> Void
    let activate: () -> Void

    var body: some View {
        Button(action: activate) {
            HStack(alignment: row.subtitle == nil ? .center : .firstTextBaseline, spacing: 8) {
                if let symbol = row.symbol {
                    Image(systemName: symbol)
                        .icon(.inline)
                        .foregroundStyle(row.destructive ? Theme.danger : Theme.text)
                        .frame(width: 18)
                        .accessibilityHidden(true)
                }
                labels
                Spacer(minLength: 0)
                if let detail = row.detail {
                    Text(detail)
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                }
                Image(systemName: "checkmark")
                    .icon(.inline)
                    .foregroundStyle(Theme.primary)
                    .frame(width: 16)
                    .opacity(row.checked ? 1 : 0)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, row.subtitle == nil ? 0 : 5)
            .frame(minHeight: 30)
            .contentShape(Rectangle())
            .rowSurface(selected: row.checked, hovering: highlighted && row.enabled)
        }
        .buttonStyle(.plain)
        .disabled(!row.enabled)
        .opacity(row.enabled ? 1 : 0.45)
        .onContinuousHover { phase in
            if case .active = phase {
                hover()
            }
        }
        .accessibilityLabel(row.title)
        .accessibilityValue([row.subtitle, row.detail].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(row.checked ? .isSelected : [])
    }

    private var labels: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(row.title)
                .font(.system(size: 13))
                .foregroundStyle(row.destructive ? Theme.danger : Color.primary)
                .lineLimit(1)
                .truncationMode(.middle)
            if let subtitle = row.subtitle {
                Text(subtitle)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct PickerChipButton<Panel: View>: View {
    let title: String
    let symbol: String?
    let help: String
    let label: String
    let panel: @MainActor (@escaping () -> Void) -> Panel
    private let external: Binding<Bool>?
    @State private var presented = false
    @State private var hovering = false

    init(
        title: String,
        symbol: String? = nil,
        help: String,
        label: String,
        presented: Binding<Bool>? = nil,
        @ViewBuilder panel: @escaping @MainActor (@escaping () -> Void) -> Panel
    ) {
        self.title = title
        self.symbol = symbol
        self.help = help
        self.label = label
        external = presented
        self.panel = panel
    }

    private var shown: Binding<Bool> {
        external ?? $presented
    }

    var body: some View {
        Button {
            shown.wrappedValue.toggle()
        } label: {
            ComposerChip(title: title, symbol: symbol, hovering: hovering || shown.wrappedValue)
        }
        .buttonStyle(.plain)
        .fixedSize()
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(label)
        .popover(isPresented: shown, arrowEdge: .bottom) {
            panel { shown.wrappedValue = false }
        }
    }
}

extension PickerChipButton where Panel == PickerPanel {
    init(title: String, symbol: String? = nil, help: String, label: String, panelTitle: String? = nil, width: CGFloat = 280, rows: [PickerRow]) {
        self.init(title: title, symbol: symbol, help: help, label: label) { dismiss in
            PickerPanel(title: panelTitle, rows: rows, width: width, dismiss: dismiss)
        }
    }
}
