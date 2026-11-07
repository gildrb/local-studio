import LocalStudioKit
import SwiftUI

struct ArchivePage: View {
    let store: StudioStore
    var embedded = false
    var leadingInset: CGFloat = 0
    @State private var pendingDelete: ThreadRow?
    @Environment(\.settingsQuery) private var query

    private var pages: PagesStore { store.pages }

    var body: some View {
        content
            .pageHeader {
                if !embedded {
                    PageHeader("Archive", subtitle: pages.archiveLoaded ? countLabel : nil, leadingInset: leadingInset)
                }
            }
        .onAppear { pages.loadArchived() }
        .confirmationDialog(
            "Delete “\(pendingDelete?.title ?? "")”?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete Thread", role: .destructive) {
                if let thread = pendingDelete { pages.deleteArchived(thread.id) }
                pendingDelete = nil
            }
        } message: {
            Text("The thread and its saved session are removed permanently.")
        }
    }

    @ViewBuilder private var content: some View {
        if !pages.archiveLoaded {
            PageEmptyState.loading("Loading archived threads…")
        } else if pages.archived.isEmpty {
            PageEmptyState(symbol: "archivebox", title: "No archived threads", message: "Archived threads leave the sidebar and wait here until you restore or delete them.")
        } else {
            SettingsForm {
                ForEach(groups, id: \.id) { group in
                    Section(group.name) {
                        ForEach(group.threads, id: \.id) { thread in
                            ArchiveRow(thread: thread) {
                                pages.unarchive(thread.id)
                            } delete: {
                                if pages.settings?.confirmDelete ?? true {
                                    pendingDelete = thread
                                } else {
                                    pages.deleteArchived(thread.id)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private var countLabel: String {
        pages.archived.count == 1 ? "1 thread" : "\(pages.archived.count) threads"
    }

    private var groups: [(id: String, name: String, threads: [ThreadRow])] {
        let filter = embedded && !SettingKey.archivedThreads.matches(query) ? query : ""
        var order: [String] = []
        var grouped: [String: [ThreadRow]] = [:]
        for thread in pages.archived where filter.isEmpty || thread.title.localizedCaseInsensitiveContains(filter) {
            let key = thread.project ?? ""
            if grouped[key] == nil { order.append(key) }
            grouped[key, default: []].append(thread)
        }
        return order.map { key in
            let name = key.isEmpty ? "No project" : (store.inbox.project(key)?.name ?? URL(filePath: key).lastPathComponent)
            return (key, name, grouped[key] ?? [])
        }
    }
}

private struct ArchiveRow: View {
    let thread: ThreadRow
    let unarchive: () -> Void
    let delete: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(thread.title.isEmpty ? "Untitled thread" : thread.title)
                    .lineLimit(1)
                Text(detail)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button("Unarchive", action: unarchive)
                .controlSize(.small)
            Menu {
                Button("Unarchive", action: unarchive)
                Divider()
                Button("Delete…", role: .destructive, action: delete)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 13, weight: .light))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("More actions for \(thread.title)")
        }
        .contextMenu {
            Button("Unarchive", action: unarchive)
            Button("Delete…", role: .destructive, action: delete)
        }
    }

    private var detail: String {
        let age = PageFormat.relative(thread.updatedAt)
        var parts: [String] = [age == "now" ? "Updated just now" : "Updated \(age) ago"]
        if let branch = thread.branch { parts.append(branch) }
        if thread.additions + thread.deletions > 0 { parts.append("+\(thread.additions) −\(thread.deletions)") }
        if let model = thread.model { parts.append(model) }
        return parts.joined(separator: " · ")
    }
}
