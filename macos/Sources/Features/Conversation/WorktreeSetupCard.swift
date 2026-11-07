import LocalStudioKit
import SwiftUI

struct WorktreeSetupCard: View {
    let stages: [SetupStage]
    let done: Bool
    let error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.system(size: 12, weight: .light))
                    .foregroundStyle(Theme.secondaryText)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.system(size: 12.5, weight: .medium))
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 4) {
                ForEach(stages.indices, id: \.self) { index in
                    StageRow(stage: stages[index])
                }
            }
            if let error {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(error == nil ? Theme.hairline : Color.red.opacity(0.3)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }

    private var title: String {
        if error != nil {
            return "Worktree setup failed"
        }
        return done ? "Worktree ready" : "Setting up worktree"
    }
}

private struct StageRow: View {
    let stage: SetupStage

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .light))
                .foregroundStyle(stage.state == .failed ? Color.red : Theme.secondaryText)
                .frame(width: 14)
                .accessibilityHidden(true)
            Text(stage.name)
                .font(.system(size: 12.5))
                .foregroundStyle(stage.state == .pending || stage.state == .skipped ? Theme.secondaryText : Color.primary)
            if let line = lastLine {
                Text(line)
                    .font(.system(size: 11.5, design: .monospaced))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 20)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(stage.name), \(stateLabel)")
        .help(stage.outputTail)
    }

    private var lastLine: String? {
        guard stage.state == .running || stage.state == .failed else { return nil }
        return stage.outputTail.split(whereSeparator: \.isNewline).last.map(String.init)
    }

    private var symbol: String {
        switch stage.state {
        case .pending: "clock"
        case .running: "circle.dotted"
        case .done: "checkmark"
        case .failed: "xmark"
        case .skipped: "minus"
        }
    }

    private var stateLabel: String {
        switch stage.state {
        case .pending: "pending"
        case .running: "running"
        case .done: "done"
        case .failed: "failed"
        case .skipped: "skipped"
        }
    }
}
