import AppKit
import LocalStudioKit
import SwiftUI

struct PullRequestsPage: View {
    let store: StudioStore
    var leadingInset: CGFloat = 0
    var tab: PullTab = .summary
    @State private var filter: PullFilter = .open
    @State private var query = ""
    @State private var selected: UInt64?

    private var pages: PagesStore { store.pages }

    var body: some View {
        content
            .pageHeader {
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
                            guard let project else { return }
                            pages.loadPullRequests(project: project)
                            if let number = current?.number { pages.loadPullRequest(project: project, number: number) }
                        }
                    }
                }
            }
            .onAppear {
                if let project { pages.loadPullRequests(project: project) }
            }
            .onChange(of: current?.number, initial: true) { _, number in
                guard let number, let project, pages.pullDetailNumber != number || pages.pullDetailRequest == nil else { return }
                pages.loadPullRequest(project: project, number: number)
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

    private var current: PullRequest? {
        visible.first { $0.number == selected } ?? visible.first
    }

    private var detail: PullRequestDetail? {
        guard let current, pages.pullDetailNumber == current.number, let request = pages.pullDetailRequest else { return nil }
        return store.workspace.pullRequestDetails[request]
    }

    @ViewBuilder private var content: some View {
        if store.inbox.projects.isEmpty {
            PageEmptyState(symbol: "arrow.triangle.pull", title: "No projects yet", message: "Add a project to see its pull requests.")
        } else if let error = pages.pullsError {
            PageEmptyState(symbol: "exclamationmark.triangle.fill", title: "Couldn’t load pull requests", message: error)
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
                .frame(width: 340)
                .background(Theme.sidebar)
                Rectangle().fill(Theme.hairline).frame(width: 1)
                if let current {
                    PullDetailView(
                        store: store, project: project ?? "", pull: current, detail: detail,
                        error: pages.pullDetailNumber == current.number ? pages.pullDetailError : nil, tab: tab
                    )
                    .id(current.number)
                } else {
                    PageEmptyState(symbol: "arrow.triangle.pull", title: "Select a pull request")
                }
            }
        } else {
            PageEmptyState.loading("Loading pull requests…")
        }
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
            HStack(alignment: .top, spacing: 8) {
                PullStateGlyph(state: pull.state)
                    .padding(.top, 1)
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
                        ChecksGlyph(checks: pull.checks)
                    }
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .rowSurface(selected: selected, hovering: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .contextMenu {
            Button("Open in Browser") { openPull(pull) }
            Button("Copy Link") { copyText(pull.url) }
        }
    }
}

enum PullTab: Hashable {
    case summary, code, timeline, checks
}

private struct PullDetailView: View {
    let store: StudioStore
    let project: String
    let pull: PullRequest
    let detail: PullRequestDetail?
    let error: String?
    @State private var tab: PullTab
    @State private var diff: DiffModel?
    @State private var actions = PullRequestActionState()

    init(store: StudioStore, project: String, pull: PullRequest, detail: PullRequestDetail?, error: String?, tab: PullTab = .summary) {
        self.store = store
        self.project = project
        self.pull = pull
        self.detail = detail
        self.error = error
        _tab = State(initialValue: tab)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 12)
            Picker("Section", selection: $tab) {
                Text("Summary").tag(PullTab.summary)
                Text(detail.map { "Code (\($0.files.count))" } ?? "Code").tag(PullTab.code)
                Text("Timeline").tag(PullTab.timeline)
                Text(detail.map { "Checks (\($0.checks.count))" } ?? "Checks").tag(PullTab.checks)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .padding(.horizontal, 20)
            .padding(.bottom, 10)
            Rectangle().fill(Theme.hairline).frame(height: 1)
            body(for: tab)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .onChange(of: detail?.files, initial: true) { _, files in
            guard let files else { return }
            let model = DiffModel(project: project, thread: nil, workspace: store.workspace, settings: store.pages.settings)
            model.loaded(files, request: nil)
            diff = model
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                PullStateGlyph(state: pull.state)
                Text(pull.title)
                    .font(.system(size: 17, weight: .semibold))
                    .textSelection(.enabled)
                    .lineLimit(2)
            }
            HStack(spacing: 8) {
                Text(meta)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 8)
                Button("Copy Link") { copyText(pull.url) }
                Button("Open in Browser") { openPull(pull) }
            }
            .controlSize(.small)
            PullRequestActionBar(store: store, project: project, pull: pull, state: actions) {
                store.pages.loadPullRequests(project: project)
                store.pages.loadPullRequest(project: project, number: pull.number)
            }
        }
    }

    private var meta: String {
        var parts = ["#\(pull.number)"]
        if let author = detail?.author { parts.append(author) }
        parts.append("\(pull.head) → \(pull.base)")
        if let created = detail?.createdAt { parts.append("opened \(PageFormat.ago(created))") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private func body(for tab: PullTab) -> some View {
        if let detail {
            switch tab {
            case .summary: PullSummary(detail: detail)
            case .code: code(detail)
            case .timeline: PullTimeline(detail: detail)
            case .checks: PullChecks(checks: detail.checks)
            }
        } else if let error {
            PageEmptyState(symbol: "exclamationmark.triangle.fill", title: "Couldn’t load the pull request", message: error)
        } else {
            PageEmptyState.loading("Loading #\(pull.number)…")
        }
    }

    @ViewBuilder private func code(_ detail: PullRequestDetail) -> some View {
        if detail.files.isEmpty {
            PageEmptyState(symbol: "checkmark", title: "No file changes in this pull request.")
        } else if let diff {
            let settings = store.pages.settings
            DiffList(model: diff, palette: PanelPalette.diff(settings?.diffColors), fontSize: CGFloat(settings?.codeFontSize ?? 12), panels: store.panels)
        }
    }
}

private struct PullSummary: View {
    let detail: PullRequestDetail

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if detail.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("No description provided.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.secondaryText)
                } else {
                    MarkdownView(text: detail.body, size: 13)
                        .textSelection(.enabled)
                }
                PageCard {
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 9) {
                        GridRow {
                            Text("Branch").foregroundStyle(Theme.secondaryText)
                            Text("\(detail.pull.head) → \(detail.pull.base)").textSelection(.enabled)
                        }
                        GridRow {
                            Text("Checks").foregroundStyle(Theme.secondaryText)
                            HStack(spacing: 5) {
                                ChecksGlyph(checks: detail.checks.isEmpty ? detail.pull.checks : PullChecks.aggregate(detail.checks))
                                Text(PullChecks.summary(detail.checks))
                            }
                        }
                        GridRow {
                            Text("Changes").foregroundStyle(Theme.secondaryText)
                            HStack(spacing: 6) {
                                Text(detail.files.count == 1 ? "1 file" : "\(detail.files.count) files")
                                PanelDiffStat(
                                    additions: detail.files.reduce(0) { $0 + $1.additions },
                                    deletions: detail.files.reduce(0) { $0 + $1.deletions },
                                    colors: nil
                                )
                            }
                        }
                    }
                    .font(.system(size: 12.5))
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if !detail.comments.isEmpty {
                    Text(detail.comments.count == 1 ? "1 comment" : "\(detail.comments.count) comments")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.secondaryText)
                    ForEach(Array(detail.comments.enumerated()), id: \.offset) { _, comment in
                        PullComment(comment: comment)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct PullComment: View {
    let comment: PrComment

    var body: some View {
        PageCard {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(comment.author.isEmpty ? "Someone" : comment.author)
                        .font(.system(size: 12, weight: .medium))
                    if let path = comment.path {
                        Text(comment.line.map { "\(path):\($0)" } ?? path)
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer(minLength: 4)
                    if let created = comment.createdAt {
                        Text(PageFormat.ago(created))
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                MarkdownView(text: comment.body, size: 12.5)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct PullTimeline: View {
    let detail: PullRequestDetail

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(detail.timeline.enumerated()), id: \.offset) { index, event in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(spacing: 0) {
                            Image(systemName: symbol(event.kind))
                                .icon(.inline)
                                .foregroundStyle(tint(event.kind))
                                .frame(width: 24, height: 24)
                                .background(Theme.input, in: Circle())
                            if index + 1 < detail.timeline.count {
                                Rectangle().fill(Theme.hairline).frame(width: 1).frame(maxHeight: .infinity)
                            }
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(headline(event))
                                    .font(.system(size: 12.5, weight: .medium))
                                if let created = event.createdAt {
                                    Text(PageFormat.ago(created))
                                        .font(.system(size: 11.5))
                                        .foregroundStyle(Theme.secondaryText)
                                }
                            }
                            if !event.text.isEmpty {
                                Text(event.text)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.secondaryText)
                                    .lineLimit(3)
                                    .textSelection(.enabled)
                            }
                        }
                        .padding(.bottom, 14)
                    }
                }
                if detail.timeline.isEmpty {
                    Text("No activity yet.")
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            .padding(20)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func headline(_ event: PrEvent) -> String {
        let actor = event.actor ?? "Someone"
        switch event.kind {
        case "opened": return "\(actor) opened the pull request"
        case "commit": return "\(actor) committed"
        case "comment": return "\(actor) commented"
        case "review": return "\(actor) reviewed"
        case "merged": return "\(actor) merged"
        case "closed": return "Closed"
        default: return "\(actor) \(event.kind)"
        }
    }

    private func symbol(_ kind: String) -> String {
        switch kind {
        case "opened": "arrow.triangle.pull"
        case "commit": "circle"
        case "comment": "bubble.left"
        case "review": "eye"
        case "merged": "arrow.triangle.merge"
        case "closed": "xmark"
        default: "circle"
        }
    }

    private func tint(_ kind: String) -> Color {
        switch kind {
        case "merged": Theme.primary
        case "closed": Theme.diffRemoved
        case "opened": Theme.diffAdded
        default: Theme.text
        }
    }
}

private struct PullChecks: View {
    let checks: [PrCheck]

    static func outcome(_ state: String) -> String {
        switch state {
        case "success": "passing"
        case "failure", "error", "timed_out", "cancelled", "action_required", "startup_failure": "failing"
        case "pending", "in_progress", "queued", "expected", "waiting", "requested": "pending"
        default: "none"
        }
    }

    static func aggregate(_ checks: [PrCheck]) -> String {
        let outcomes = Set(checks.map { outcome($0.state) })
        for candidate in ["failing", "pending", "passing"] where outcomes.contains(candidate) {
            return candidate
        }
        return "none"
    }

    static func summary(_ checks: [PrCheck]) -> String {
        guard !checks.isEmpty else { return "No checks" }
        let outcomes = checks.map { outcome($0.state) }
        let failing = outcomes.filter { $0 == "failing" }.count
        let pending = outcomes.filter { $0 == "pending" }.count
        let passing = outcomes.filter { $0 == "passing" }.count
        var parts: [String] = []
        if failing > 0 { parts.append("\(failing) failing") }
        if pending > 0 { parts.append("\(pending) running") }
        if passing > 0 { parts.append("\(passing) passed") }
        let other = checks.count - failing - pending - passing
        if other > 0 { parts.append("\(other) skipped") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        if checks.isEmpty {
            PageEmptyState(symbol: "checkmark", title: "No checks", message: "This pull request has no status checks or check runs.")
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(Self.summary(checks))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.secondaryText)
                    PageCard {
                        VStack(spacing: 0) {
                            ForEach(Array(checks.enumerated()), id: \.offset) { index, check in
                                if index > 0 { Divider().padding(.leading, 40) }
                                HStack(spacing: 10) {
                                    ChecksGlyph(checks: Self.outcome(check.state))
                                        .frame(width: 18)
                                    Text(check.name)
                                        .font(.system(size: 12.5))
                                        .lineLimit(1)
                                    Spacer(minLength: 8)
                                    Text(check.state.replacingOccurrences(of: "_", with: " "))
                                        .font(.system(size: 11.5))
                                        .foregroundStyle(Theme.secondaryText)
                                    if let link = check.url, let url = URL(string: link) {
                                        Button("Details") { NSWorkspace.shared.open(url) }
                                            .controlSize(.small)
                                    }
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                            }
                        }
                    }
                }
                .padding(20)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

@MainActor private func openPull(_ pull: PullRequest) {
    guard let url = URL(string: pull.url) else { return }
    NSWorkspace.shared.open(url)
}

@MainActor private func copyText(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
}
