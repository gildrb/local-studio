import LocalStudioKit
import SwiftUI

struct ProjectFilterButton: View {
    let store: StudioStore
    @State private var open = false

    var body: some View {
        Group {
            if let project = store.inbox.project(store.inbox.projectFilter) {
                Button {
                    open.toggle()
                } label: {
                    ProjectTile(project: project, size: 16)
                        .frame(width: Theme.Metrics.chromeButton, height: Theme.Metrics.chromeButton)
                        .background(Theme.selection, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Filtered by \(project.name)")
                .accessibilityLabel("Filter Projects")
            } else {
                ChromeIconButton("Filter Projects", symbol: "line.3.horizontal.decrease.circle") { open.toggle() }
            }
        }
        .popover(isPresented: $open, arrowEdge: .bottom) {
            ProjectFilterPopover(store: store) { open = false }
        }
    }
}

struct ProjectFilterPopover: View {
    let store: StudioStore
    let dismiss: () -> Void
    @State private var query = ""
    @State private var highlighted = 0

    var body: some View {
        VStack(spacing: 0) {
            TextField("Search projects…", text: $query)
                .textFieldStyle(.roundedBorder)
                .padding(10)
                .onKeyPress(.downArrow) {
                    highlighted = min(highlighted + 1, entries.count - 1)
                    return .handled
                }
                .onKeyPress(.upArrow) {
                    highlighted = max(highlighted - 1, 0)
                    return .handled
                }
                .onSubmit {
                    if entries.indices.contains(highlighted) {
                        choose(entries[highlighted])
                    }
                }
                .onChange(of: query) { highlighted = 0 }
            Divider()
            ScrollView {
                VStack(spacing: 1) {
                    if entries.isEmpty {
                        Text("No matching projects.")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.secondaryText)
                            .padding(.vertical, 14)
                    }
                    ForEach(Array(entries.enumerated()), id: \.offset) { offset, entry in
                        ProjectFilterRow(store: store, project: entry, checked: entry?.id == store.inbox.projectFilter, highlighted: offset == highlighted) {
                            choose(entry)
                        }
                    }
                }
                .padding(6)
            }
            .frame(maxHeight: 320)
        }
        .frame(width: 280)
    }

    private var entries: [Project?] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        let projects = store.inbox.projects.filter { needle.isEmpty || $0.name.localizedCaseInsensitiveContains(needle) || $0.path.localizedCaseInsensitiveContains(needle) }
        return (needle.isEmpty ? [nil] : []) + projects.map { Optional($0) }
    }

    private func choose(_ project: Project?) {
        store.inbox.projectFilter = project?.id
        dismiss()
    }
}

private struct ProjectFilterRow: View {
    let store: StudioStore
    let project: Project?
    let checked: Bool
    let highlighted: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let project {
                    ProjectTile(project: project, size: 16)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(project.name)
                            .font(.system(size: 13))
                        Text((project.path as NSString).abbreviatingWithTildeInPath)
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                } else {
                    Image(systemName: "square.grid.2x2")
                        .font(.system(size: 12, weight: .light))
                        .frame(width: 16)
                        .accessibilityHidden(true)
                    Text("All projects")
                        .font(.system(size: 13))
                }
                Spacer(minLength: 4)
                if checked || (project == nil && store.inbox.projectFilter == nil) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.primary)
                        .accessibilityLabel("Selected")
                }
            }
            .padding(.horizontal, 8)
            .frame(height: project == nil ? 30 : 38)
            .contentShape(Rectangle())
            .rowSurface(selected: highlighted, hovering: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .contextMenu {
            if let project {
                Button("New Thread in \(project.name)") { store.newThread(in: project.id) }
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.path)]) }
                Divider()
                Button("Remove Project", role: .destructive) { store.inbox.removeProject(project.id) }
            }
        }
    }
}
