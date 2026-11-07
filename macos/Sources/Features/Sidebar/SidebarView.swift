import LocalStudioKit
import SwiftUI

struct SidebarView: View {
    let store: StudioStore
    @State private var query = ""
    @State private var settledExpanded = true

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                ForEach(active, id: \.id) { row in
                    ThreadCardRow(row: row, project: projectName(row), busy: isBusy(row), selected: isSelected(row)) {
                        store.select(row.id)
                    }
                }
                if !settled.isEmpty {
                    ShelfHeader(title: "Settled", count: settled.count, expanded: $settledExpanded)
                        .padding(.top, 10)
                    if settledExpanded {
                        ForEach(settled, id: \.id) { row in
                            ThreadSlimRow(row: row, project: projectName(row), selected: isSelected(row)) {
                                store.select(row.id)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, Theme.Metrics.sidebarInset)
            .padding(.vertical, 6)
        }
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 2) {
                SidebarSearchField(text: $query)
                ChromeIconButton("Filter Projects", symbol: "line.3.horizontal.decrease.circle") {}
                ChromeIconButton("Add Project", symbol: "folder") {}
            }
            .padding(.horizontal, Theme.Metrics.sidebarInset)
            .padding(.top, Theme.Metrics.titlebarHeight)
            .padding(.bottom, 6)
        }
        .overlay {
            if store.inbox.threads.isEmpty, store.connection == .ready {
                Text("No threads yet")
                    .font(.callout)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            SidebarFooter()
        }
        .scrollIndicators(.never)
    }

    private var filtered: [ThreadRow] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        guard !needle.isEmpty else { return store.inbox.threads }
        return store.inbox.threads.filter { $0.title.localizedCaseInsensitiveContains(needle) }
    }

    private var active: [ThreadRow] {
        filtered.filter { $0.shelf != .settled && $0.shelf != .snoozed }
    }

    private var settled: [ThreadRow] {
        filtered.filter { $0.shelf == .settled || $0.shelf == .snoozed }
    }

    private func isBusy(_ row: ThreadRow) -> Bool {
        row.status == .working
    }

    private func isSelected(_ row: ThreadRow) -> Bool {
        store.conversation.thread == row.id
    }

    private func projectName(_ row: ThreadRow) -> String {
        store.inbox.project(row.project)?.name ?? "No project"
    }
}

private struct ThreadCardRow: View {
    let row: ThreadRow
    let project: String
    let busy: Bool
    let selected: Bool
    let open: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: open) {
            HStack(alignment: .top, spacing: 9) {
                ProjectTile(name: project)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(project)
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.secondaryText)
                        Spacer(minLength: 4)
                        if busy {
                            Image(systemName: "circle.dotted")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Theme.primary)
                                .accessibilityLabel("Working")
                        } else {
                            Text(RelativeAge.text(millis: row.updatedAt))
                                .font(.system(size: 11.5))
                                .monospacedDigit()
                                .foregroundStyle(Theme.secondaryText)
                        }
                    }
                    Text(row.title)
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: Theme.Metrics.cardRowHeight)
            .contentShape(Rectangle())
            .rowSurface(selected: selected, hovering: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct ThreadSlimRow: View {
    let row: ThreadRow
    let project: String
    let selected: Bool
    let open: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: open) {
            HStack(spacing: 9) {
                ProjectTile(name: project)
                    .opacity(hovering || selected ? 1 : 0.55)
                Text(row.title)
                    .font(.system(size: 13))
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(RelativeAge.text(millis: row.updatedAt))
                    .font(.system(size: 11.5))
                    .monospacedDigit()
                    .foregroundStyle(Theme.secondaryText)
            }
            .padding(.horizontal, 10)
            .frame(height: Theme.Metrics.rowHeight)
            .contentShape(Rectangle())
            .rowSurface(selected: selected, hovering: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct ShelfHeader: View {
    let title: String
    let count: Int
    @Binding var expanded: Bool

    var body: some View {
        Button {
            expanded.toggle()
        } label: {
            HStack(spacing: 6) {
                Text(title)
                    .font(.system(size: 11.5, weight: .semibold))
                Text("\(count)")
                    .font(.system(size: 11.5))
                    .monospacedDigit()
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .rotationEffect(.degrees(expanded ? 0 : -90))
            }
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct ProjectTile: View {
    let name: String

    var body: some View {
        Text(initials)
            .font(.system(size: 8.5, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: Theme.Metrics.tile, height: Theme.Metrics.tile)
            .background(color.gradient, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
    }

    private var initials: String {
        let words = name.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        let letters = words.count > 1 ? words.prefix(2).compactMap(\.first) : Array(name.prefix(2))
        return String(letters).uppercased()
    }

    private var color: Color {
        let palette: [Color] = [.indigo, .purple, .pink, .orange, .teal, .blue, .green, .brown]
        let hash = name.unicodeScalars.reduce(UInt32(5381)) { ($0 &* 33) &+ $1.value }
        return palette[Int(hash % UInt32(palette.count))]
    }
}

private struct SidebarFooter: View {
    var body: some View {
        HStack(spacing: 0) {
            ChromeIconButton("Settings", symbol: "slider.horizontal.3") {}
            ChromeIconButton("Usage", symbol: "waveform.path.ecg") {}
            Spacer()
            ChromeIconButton("Local", symbol: "server.rack") {}
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }
}

enum RelativeAge {
    static func text(millis: Int64, now: Date = .now) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(millis) / 1_000)
        let seconds = max(0, now.timeIntervalSince(date))
        switch seconds {
        case ..<60: return "now"
        case ..<3_600: return "\(Int(seconds / 60))m"
        case ..<86_400: return "\(Int(seconds / 3_600))h"
        default: return "\(Int(seconds / 86_400))d"
        }
    }
}

private struct SidebarSearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12))
                .foregroundStyle(Theme.secondaryText)
            TextField("Search", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
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
