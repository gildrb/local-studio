import AppKit
import LocalStudioKit
import SwiftUI

struct PullRequestsPage: View {
    let store: StudioStore
    var leadingInset: CGFloat = 0
    @State private var filter: PullFilter = .open
    @State private var query = ""
    @State private var selected: UInt64?

    private var pages: PagesStore { store.pages }

    var body: some View {
        VStack(spacing: 0) {
            PageHeader("Pull Requests", leadingInset: leadingInset) {
                if !store.inbox.projects.isEmpty {
                    Picker("Project", selection: Binding(get: { project ?? "" }, set: { pages.loadPullRequests(project: $0) })) {
                        ForEach(store.inbox.projects, id: \.id) { project in
                            Text(project.name).tag(project.id)
                        }
                    }
                    .labelsHidden()
                    .fixedSize()
                    Picker("State", selection: $filter) {
                        ForEach(PullFilter.allCases, id: \.self) { filter in
                            Text(filter.title).tag(filter)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                    ChromeIconButton("Refresh", symbol: "arrow.clockwise") {
                        if let project { pages.loadPullRequests(project: project) }
                    }
                }
            }
            content
        }
        .background(Theme.canvas)
        .onAppear {
            if let project { pages.loadPullRequests(project: project) }
        }
    }

    private var project: String? {
        pages.pullsProject ?? store.inbox.currentProject ?? store.inbox.projects.first?.id
    }

    private var pulls: [PullRequest]? {
        guard let request = pages.pullsRequest else { return nil }
        return store.workspace.pullRequests[request]
    }

    private var visible: [PullRequest] {
        (pulls ?? []).filter { pull in
            filter.includes(pull.state)
                && (query.isEmpty || pull.title.localizedCaseInsensitiveContains(query) || "#\(pull.number)".contains(query)
                    || pull.head.localizedCaseInsensitiveContains(query))
        }
    }

    @ViewBuilder private var content: some View {
        if store.inbox.projects.isEmpty {
            PageEmptyState(symbol: "arrow.triangle.pull", title: "No projects yet", message: "Add a project to see its pull requests.")
        } else if let error = pages.pullsError {
            PageEmptyState(symbol: "exclamationmark.triangle", title: "Couldn’t load pull requests", message: error)
        } else if let pulls {
            HStack(spacing: 0) {
                VStack(spacing: 0) {
                    TextField("Filter pull requests", text: $query, prompt: Text("Filter by title, number or branch"))
                        .textFieldStyle(.roundedBorder)
                        .padding(10)
                    if visible.isEmpty {
                        PageEmptyState(
                            symbol: "arrow.triangle.pull",
                            title: pulls.isEmpty ? "No pull requests" : "Nothing matches",
                            message: pulls.isEmpty ? "This repository has no pull requests on GitHub yet." : nil
                        )
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 2) {
                                ForEach(visible, id: \.number) { pull in
                                    PullRow(pull: pull, selected: pull.number == current?.number) {
                                        selected = pull.number
                                    }
                                }
                            }
                            .padding(.horizontal, Theme.Metrics.sidebarInset)
                            .padding(.bottom, 10)
                        }
                    }
                }
                .frame(width: 360)
                .background(Theme.sidebar)
                Rectangle().fill(Theme.hairline).frame(width: 1)
                if let current {
                    PullDetail(pull: current)
                } else {
                    PageEmptyState(symbol: "arrow.triangle.pull", title: "Select a pull request")
                }
            }
        } else {
            PageEmptyState(symbol: "arrow.triangle.pull", title: "Loading pull requests…")
        }
    }

    private var current: PullRequest? {
        visible.first { $0.number == selected } ?? visible.first
    }
}

enum PullFilter: CaseIterable {
    case open, merged, closed, all

    var title: String {
        switch self {
        case .open: "Open"
        case .merged: "Merged"
        case .closed: "Closed"
        case .all: "All"
        }
    }

    func includes(_ state: String) -> Bool {
        switch self {
        case .open: state == "OPEN"
        case .merged: state == "MERGED"
        case .closed: state == "CLOSED"
        case .all: true
        }
    }
}

private struct PullRow: View {
    let pull: PullRequest
    let selected: Bool
    let select: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: select) {
            HStack(alignment: .top, spacing: 10) {
                PullStateIcon(state: pull.state)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 3) {
                    Text(pull.title)
                        .font(.system(size: 13))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 6) {
                        Text("#\(pull.number)")
                        Text(pull.head)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 4)
                        ChecksBadge(checks: pull.checks)
                    }
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .rowSurface(selected: selected, hovering: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .contextMenu {
            Button("Open in Browser") { open(pull) }
            Button("Copy Link") { copy(pull.url) }
        }
    }
}

private struct PullDetail: View {
    let pull: PullRequest

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    PullStateIcon(state: pull.state)
                    Text(stateTitle)
                        .font(.system(size: 12, weight: .medium))
                    Text("#\(pull.number)")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.secondaryText)
                }
                Text(pull.title)
                    .font(.system(size: 18, weight: .semibold))
                    .textSelection(.enabled)
                PageCard {
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
                        GridRow {
                            Text("Branch").foregroundStyle(Theme.secondaryText)
                            Text("\(pull.head) → \(pull.base)").textSelection(.enabled)
                        }
                        GridRow {
                            Text("Checks").foregroundStyle(Theme.secondaryText)
                            ChecksBadge(checks: pull.checks, labelled: true)
                        }
                        GridRow {
                            Text("Link").foregroundStyle(Theme.secondaryText)
                            Text(pull.url)
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .textSelection(.enabled)
                        }
                    }
                    .font(.system(size: 12.5))
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack {
                    Button("Open in Browser") { open(pull) }
                        .buttonStyle(.borderedProminent)
                    Button("Copy Link") { copy(pull.url) }
                }
            }
            .padding(24)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var stateTitle: String {
        switch pull.state {
        case "OPEN": "Open"
        case "MERGED": "Merged"
        case "CLOSED": "Closed"
        default: pull.state.capitalized
        }
    }
}

private struct PullStateIcon: View {
    let state: String

    var body: some View {
        Image(systemName: state == "MERGED" ? "arrow.triangle.merge" : (state == "CLOSED" ? "xmark.circle" : "arrow.triangle.pull"))
            .font(.system(size: 13, weight: .light))
            .foregroundStyle(color)
            .accessibilityLabel(state.capitalized)
    }

    private var color: Color {
        switch state {
        case "MERGED": .purple
        case "CLOSED": .red
        default: .green
        }
    }
}

private struct ChecksBadge: View {
    let checks: String
    var labelled = false

    var body: some View {
        if checks != "none" || labelled {
            HStack(spacing: 4) {
                Image(systemName: symbol)
                    .font(.system(size: 11, weight: .light))
                    .foregroundStyle(color)
                if labelled {
                    Text(label)
                }
            }
            .help(label)
        }
    }

    private var symbol: String {
        switch checks {
        case "passing": "checkmark.circle"
        case "failing": "xmark.circle"
        case "pending": "clock"
        default: "minus.circle"
        }
    }

    private var color: Color {
        switch checks {
        case "passing": .green
        case "failing": .red
        case "pending": .orange
        default: Theme.secondaryText
        }
    }

    private var label: String {
        switch checks {
        case "passing": "Checks passing"
        case "failing": "Checks failing"
        case "pending": "Checks running"
        default: "No checks"
        }
    }
}

@MainActor private func open(_ pull: PullRequest) {
    guard let url = URL(string: pull.url) else { return }
    NSWorkspace.shared.open(url)
}

@MainActor private func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
}
