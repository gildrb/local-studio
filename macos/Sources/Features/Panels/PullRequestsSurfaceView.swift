import AppKit
import LocalStudioKit
import SwiftUI

struct PullRequestsSurfaceView: View {
    @Bindable var model: PullRequestsModel

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
                        .frame(minHeight: 120)
                        if let selected = model.selected {
                            PullRequestDetailView(pull: selected)
                                .frame(minHeight: 180)
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
        .contextMenu {
            Button("Open in Browser") { open(pull) }
            Button("Copy Link") { copy(pull.url) }
        }
    }
}

struct PullRequestDetailView: View {
    let pull: PullRequest

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    PullStateGlyph(state: pull.state)
                    Text(pull.title)
                        .font(.system(size: 15, weight: .semibold))
                        .textSelection(.enabled)
                    Spacer(minLength: 0)
                }
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 7) {
                    GridRow {
                        label("Number")
                        Text("#\(pull.number)").monospacedDigit()
                    }
                    GridRow {
                        label("State")
                        Text(stateLabel(pull.state))
                    }
                    GridRow {
                        label("Checks")
                        HStack(spacing: 5) {
                            ChecksGlyph(checks: pull.checks)
                            Text(checksLabel(pull.checks))
                        }
                    }
                    GridRow {
                        label("Branches")
                        HStack(spacing: 5) {
                            Text(pull.head).textSelection(.enabled)
                            Image(systemName: "arrow.right")
                                .font(.system(size: 10, weight: .light))
                                .foregroundStyle(Theme.secondaryText)
                            Text(pull.base).textSelection(.enabled)
                        }
                        .font(.system(size: 12, design: .monospaced))
                    }
                }
                .font(.system(size: 12.5))
                HStack(spacing: 8) {
                    Button("Open in Browser") { open(pull) }
                        .keyboardShortcut(.defaultAction)
                    Button("Copy Link") { copy(pull.url) }
                }
                .controlSize(.small)
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

struct PullStateGlyph: View {
    let state: String

    var body: some View {
        let (symbol, tint): (String, Color) = switch state.uppercased() {
        case "MERGED": ("arrow.triangle.merge", Theme.primary)
        case "CLOSED": ("xmark.circle", PanelPalette.removedText)
        default: ("arrow.triangle.pull", PanelPalette.addedText)
        }
        Image(systemName: symbol)
            .font(.system(size: 13, weight: .light))
            .foregroundStyle(tint)
            .frame(width: 18)
            .help(stateLabel(state))
    }
}

struct ChecksGlyph: View {
    let checks: String

    var body: some View {
        switch checks {
        case "passing":
            Image(systemName: "checkmark.circle").foregroundStyle(PanelPalette.addedText).help("Checks passing")
        case "failing":
            Image(systemName: "xmark.circle").foregroundStyle(PanelPalette.removedText).help("Checks failing")
        case "pending":
            Image(systemName: "clock").foregroundStyle(Theme.secondaryText).help("Checks pending")
        default:
            EmptyView()
        }
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

@MainActor
private func open(_ pull: PullRequest) {
    if let url = URL(string: pull.url) {
        NSWorkspace.shared.open(url)
    }
}

@MainActor
private func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
}
