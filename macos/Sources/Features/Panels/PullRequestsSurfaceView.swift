import AppKit
import LocalStudioKit
import SwiftUI

struct PullRequestsSurfaceView: View {
    @Bindable var model: PullRequestsModel
    let store: StudioStore
    let settings: LocalStudioKit.Settings?

    var body: some View {
        VStack(spacing: 0) {
            PanelToolbar {
                Text("Pull requests")
                    .font(.system(size: 12.5, weight: .medium))
                if model.phase == .loaded {
                    Text("\(model.pulls.count)")
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                        .monospacedDigit()
                        .accessibilityLabel("\(model.pulls.count) pull requests")
                }
                Spacer()
                PanelIconButton("Refresh", symbol: "arrow.clockwise") { model.load() }
            }
            switch model.phase {
            case .idle:
                PanelMessage(symbol: "clock", title: "Loading pull requests…")
            case .loading where model.pulls.isEmpty:
                PanelMessage(symbol: "clock", title: "Loading pull requests…")
            case .failed(let message) where model.pulls.isEmpty:
                PanelMessage(symbol: "exclamationmark.triangle", title: "Couldn’t load pull requests.", detail: message, actionTitle: "Try Again") { model.load() }
            default:
                if model.pulls.isEmpty {
                    PanelMessage(symbol: "arrow.triangle.pull", title: "No pull requests for this repository.")
                } else {
                    VSplitView {
                        ScrollView {
                            LazyVStack(spacing: 2) {
                                ForEach(model.pulls, id: \.number) { pull in
                                    PullRequestRow(pull: pull, selected: pull.number == model.selection) {
                                        model.selection = pull.number
                                    }
                                }
                            }
                            .padding(6)
                        }
                        .frame(minHeight: 110, idealHeight: 200)
                        if let detail = model.selectedDetail {
                            PullRequestDetailView(model: detail, store: store, settings: settings) {
                                model.load()
                            }
                            .frame(minHeight: 260)
                        }
                    }
                }
            }
        }
    }
}

private struct PullRequestRow: View {
    let pull: PullRequest
    let selected: Bool
    let select: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 9) {
            PullStateGlyph(state: pull.state)
            VStack(alignment: .leading, spacing: 2) {
                Text(pull.title)
                    .font(.system(size: 13))
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text("#\(pull.number)")
                        .monospacedDigit()
                    Text("·")
                    Text(pull.head)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.secondaryText)
            }
            Spacer(minLength: 6)
            ChecksGlyph(checks: pull.checks)
        }
        .padding(.horizontal, 10)
        .frame(height: Theme.Metrics.cardRowHeight - 6)
        .rowSurface(selected: selected, hovering: hovering)
        .contentShape(Rectangle())
        .onTapGesture(perform: select)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityLabel(pull.title)
        .accessibilityValue("#\(pull.number), \(stateLabel(pull.state)), \(checksLabel(pull.checks)), \(pull.head)")
        .accessibilityAction { select() }
        .contextMenu {
            Button("Open in Browser") { open(pull.url) }
            Button("Copy Link") { copy(pull.url) }
        }
    }
}

struct PullRequestDetailView: View {
    @Bindable var model: PullRequestDetailModel
    let store: StudioStore
    let settings: LocalStudioKit.Settings?
    var finished: () -> Void = {}

    var body: some View {
        let pull = model.current
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    PullStateGlyph(state: pull.state)
                    Text(pull.title)
                        .font(.system(size: 14.5, weight: .semibold))
                        .lineLimit(2)
                        .textSelection(.enabled)
                    Spacer(minLength: 0)
                }
                HStack(spacing: 6) {
                    Text("#\(pull.number)").monospacedDigit()
                    if let author = model.detail?.author {
                        Text("·")
                        Text(author)
                    }
                    Text("·")
                    Text(pull.head)
                        .font(.system(size: 11.5, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 9, weight: .light))
                        .accessibilityLabel("into")
                    Text(pull.base)
                        .font(.system(size: 11.5, design: .monospaced))
                    Spacer(minLength: 4)
                    PanelIconButton("Copy Link", symbol: "link") { copy(pull.url) }
                    PanelIconButton("Open in Browser", symbol: "arrow.up.right.circle") { open(pull.url) }
                }
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.secondaryText)
                PullRequestActionBar(store: store, project: model.project, pull: pull, state: model.actions) {
                    model.load()
                    finished()
                }
                Picker("Section", selection: $model.tab) {
                    ForEach(PullRequestTab.allCases) { tab in
                        Text(title(tab)).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.small)
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 10)
            PanelHairline()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func title(_ tab: PullRequestTab) -> String {
        guard let detail = model.detail else { return tab.rawValue }
        switch tab {
        case .summary: return tab.rawValue
        case .code: return "Code \(detail.files.count)"
        case .timeline: return "Timeline \(detail.timeline.count)"
        case .checks: return "Checks \(detail.checks.count)"
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .idle, .loading:
            PanelMessage(symbol: "clock", title: "Loading pull request…")
        case .failed(let message):
            PanelMessage(symbol: "exclamationmark.triangle", title: "Couldn’t load this pull request.", detail: message, actionTitle: "Try Again") { model.load() }
        case .loaded:
            if let detail = model.detail {
                switch model.tab {
                case .summary:
                    PullRequestSummary(detail: detail)
                case .code:
                    if detail.files.isEmpty {
                        PanelMessage(symbol: "plus.forwardslash.minus", title: "No file changes in this pull request.")
                    } else {
                        VStack(spacing: 0) {
                            PanelToolbar {
                                PanelDiffStat(additions: model.code.additions, deletions: model.code.deletions, colors: settings?.diffColors)
                                Text("\(detail.files.count) \(detail.files.count == 1 ? "file" : "files")")
                                    .font(.system(size: 11.5))
                                    .foregroundStyle(Theme.secondaryText)
                                Spacer()
                                PanelIconButton(model.code.layout == .split ? "Stacked Layout" : "Split Layout", symbol: model.code.layout == .split ? "rectangle" : "rectangle.split.2x1") {
                                    model.code.layout = model.code.layout == .split ? .stacked : .split
                                }
                                PanelIconButton(model.code.allCollapsed ? "Expand All Files" : "Collapse All Files", symbol: model.code.allCollapsed ? "chevron.down" : "chevron.up") {
                                    model.code.setAllCollapsed(!model.code.allCollapsed)
                                }
                            }
                            DiffList(model: model.code, palette: PanelPalette.diff(settings?.diffColors), fontSize: CGFloat(settings?.codeFontSize ?? 12), panels: nil)
                        }
                    }
                case .timeline:
                    PullRequestTimeline(events: detail.timeline)
                case .checks:
                    PullRequestChecks(checks: detail.checks)
                }
            }
        }
    }
}

private struct PullRequestSummary: View {
    let detail: PullRequestDetail

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 7) {
                    GridRow {
                        label("State")
                        Text(stateLabel(detail.pull.state))
                    }
                    GridRow {
                        label("Checks")
                        HStack(spacing: 5) {
                            ChecksGlyph(checks: detail.pull.checks)
                            Text(checksLabel(detail.pull.checks))
                        }
                    }
                    if let created = detail.createdAt {
                        GridRow {
                            label("Opened")
                            Text(date(created), format: .dateTime.day().month().year().hour().minute())
                        }
                    }
                    GridRow {
                        label("Changes")
                        let additions = detail.files.reduce(0) { $0 + $1.additions }
                        let deletions = detail.files.reduce(0) { $0 + $1.deletions }
                        Text("\(detail.files.count) files · +\(additions) −\(deletions)")
                            .monospacedDigit()
                    }
                }
                .font(.system(size: 12.5))
                if detail.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("No description provided.")
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.secondaryText)
                } else {
                    MarkdownView(text: detail.body, size: 13)
                        .textSelection(.enabled)
                }
                if !detail.comments.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Review comments")
                            .font(.system(size: 12.5, weight: .semibold))
                        ForEach(Array(detail.comments.enumerated()), id: \.offset) { _, comment in
                            ReviewComment(comment: comment)
                        }
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func label(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(Theme.secondaryText)
            .gridColumnAlignment(.trailing)
    }
}

private struct ReviewComment: View {
    let comment: PrComment

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text(comment.author)
                    .font(.system(size: 12, weight: .medium))
                if let path = comment.path {
                    Text(comment.line.map { "\(path):\($0)" } ?? path)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
                Spacer(minLength: 4)
                if let created = comment.createdAt {
                    Text(date(created), style: .relative)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            MarkdownView(text: comment.body, size: 12.5)
                .textSelection(.enabled)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.hairline))
    }
}

private struct PullRequestTimeline: View {
    let events: [PrEvent]

    var body: some View {
        if events.isEmpty {
            PanelMessage(symbol: "clock", title: "No activity yet.")
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(events.enumerated()), id: \.offset) { _, event in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: symbol(event.kind))
                                .font(.system(size: 12, weight: .light))
                                .foregroundStyle(tint(event.kind))
                                .frame(width: 16)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    Text(event.actor ?? "Someone")
                                        .fontWeight(.medium)
                                    Text(verb(event.kind))
                                        .foregroundStyle(Theme.secondaryText)
                                    Spacer(minLength: 4)
                                    if let created = event.createdAt {
                                        Text(date(created), style: .relative)
                                            .font(.system(size: 11))
                                            .foregroundStyle(Theme.secondaryText)
                                    }
                                }
                                .font(.system(size: 12.5))
                                if !event.text.isEmpty {
                                    Text(event.text)
                                        .font(.system(size: 12))
                                        .foregroundStyle(event.kind == "commit" ? Color.primary : Theme.secondaryText)
                                        .lineLimit(3)
                                        .textSelection(.enabled)
                                }
                            }
                        }
                        .padding(.vertical, 8)
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
            }
        }
    }

    private func symbol(_ kind: String) -> String {
        switch kind {
        case "opened": "arrow.triangle.pull"
        case "commit": "circle"
        case "comment": "text.bubble"
        case "review": "eye"
        case "merged": "arrow.triangle.merge"
        case "closed": "xmark.circle"
        default: "circle"
        }
    }

    private func tint(_ kind: String) -> Color {
        switch kind {
        case "opened": Theme.diffAdded
        case "merged": Theme.primary
        case "closed": Theme.diffRemoved
        default: Theme.secondaryText
        }
    }

    private func verb(_ kind: String) -> String {
        switch kind {
        case "opened": "opened this pull request"
        case "commit": "committed"
        case "comment": "commented"
        case "review": "reviewed"
        case "merged": "merged"
        case "closed": "closed this pull request"
        default: kind
        }
    }
}

private struct PullRequestChecks: View {
    let checks: [PrCheck]

    var body: some View {
        if checks.isEmpty {
            PanelMessage(symbol: "checkmark.circle", title: "No checks reported for this pull request.")
        } else {
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(Array(checks.enumerated()), id: \.offset) { _, check in
                        CheckRow(check: check)
                    }
                }
                .padding(6)
            }
        }
    }
}

private struct CheckRow: View {
    let check: PrCheck
    @State private var hovering = false

    var body: some View {
        let style = CheckStyle(check.state)
        HStack(spacing: 9) {
            Image(systemName: style.symbol)
                .font(.system(size: 13, weight: .light))
                .foregroundStyle(style.tint)
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(check.name)
                .font(.system(size: 13))
                .lineLimit(1)
            Spacer(minLength: 6)
            Text(style.label)
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.secondaryText)
            if let url = check.url {
                PanelIconButton("Open \(check.name)", symbol: "arrow.up.right.circle") { open(url) }
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 34)
        .rowSurface(selected: false, hovering: hovering)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
    }
}

private struct CheckStyle {
    let symbol: String
    let tint: Color
    let label: String

    init(_ state: String) {
        switch state {
        case "success":
            (symbol, tint, label) = ("checkmark.circle", Theme.diffAdded, "Passed")
        case "failure", "error", "timed_out", "cancelled", "action_required", "startup_failure":
            (symbol, tint, label) = ("xmark.circle", Theme.diffRemoved, state == "cancelled" ? "Cancelled" : "Failed")
        case "neutral", "skipped", "stale":
            (symbol, tint, label) = ("minus.circle", Theme.secondaryText, state == "skipped" ? "Skipped" : "Neutral")
        default:
            (symbol, tint, label) = ("clock", Theme.secondaryText, state.isEmpty ? "Pending" : state.replacingOccurrences(of: "_", with: " ").capitalized)
        }
    }
}

struct PullStateGlyph: View {
    let state: String

    var body: some View {
        let (symbol, tint): (String, Color) = switch state.uppercased() {
        case "MERGED": ("arrow.triangle.merge", Theme.primary)
        case "CLOSED": ("xmark.circle", Theme.diffRemoved)
        default: ("arrow.triangle.pull", Theme.diffAdded)
        }
        Image(systemName: symbol)
            .font(.system(size: 13, weight: .light))
            .foregroundStyle(tint)
            .frame(width: 18)
            .help(stateLabel(state))
            .accessibilityLabel(stateLabel(state))
    }
}

struct ChecksGlyph: View {
    let checks: String

    var body: some View {
        switch checks {
        case "passing":
            glyph("checkmark.circle", Theme.diffAdded)
        case "failing":
            glyph("xmark.circle", Theme.diffRemoved)
        case "pending":
            glyph("clock", Theme.secondaryText)
        default:
            EmptyView()
        }
    }

    private func glyph(_ symbol: String, _ tint: Color) -> some View {
        Image(systemName: symbol)
            .foregroundStyle(tint)
            .help(checksLabel(checks))
            .accessibilityLabel(checksLabel(checks))
    }
}

private func stateLabel(_ state: String) -> String {
    switch state.uppercased() {
    case "MERGED": "Merged"
    case "CLOSED": "Closed"
    default: "Open"
    }
}

private func checksLabel(_ checks: String) -> String {
    switch checks {
    case "passing": "All checks passed"
    case "failing": "Some checks failed"
    case "pending": "Checks running"
    default: "No checks"
    }
}

private func date(_ millis: Int64) -> Date {
    Date(timeIntervalSince1970: TimeInterval(millis) / 1000)
}

@MainActor
private func open(_ link: String) {
    if let url = URL(string: link) {
        NSWorkspace.shared.open(url)
    }
}

@MainActor
private func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
}
