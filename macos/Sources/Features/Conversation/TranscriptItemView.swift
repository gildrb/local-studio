import LocalStudioKit
import SwiftUI

struct TranscriptItemView: View {
    let item: Item

    var body: some View {
        switch item.kind {
        case .user(let text, let images, _):
            UserMessageView(text: text, images: images)
        case .assistant(let blocks, let streaming, let error, _):
            AssistantMessageView(blocks: blocks, streaming: streaming, error: error)
        case .tool(_, let name, _, _, let arguments, let state, let output, _, _, _):
            ToolCardView(name: name, arguments: arguments, state: state, output: output)
        case .turnSummary(_, let durationMs, let toolCount):
            NoticeRowView(level: .info, text: "Worked for \(durationMs / 1_000)s · \(toolCount) tool calls")
        case .notice(let level, let text):
            NoticeRowView(level: level, text: text)
        case .compaction(let summary, let tokensBefore):
            CompactionRowView(summary: summary, tokensBefore: tokensBefore)
        }
    }
}

private struct UserMessageView: View {
    let text: String
    let images: UInt32

    var body: some View {
        HStack {
            Spacer(minLength: 80)
            VStack(alignment: .trailing, spacing: 4) {
                Text(text)
                    .textSelection(.enabled)
                if images > 0 {
                    Label("\(images) image\(images == 1 ? "" : "s")", systemImage: "photo")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.selection, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

private struct AssistantMessageView: View {
    let blocks: [Block]
    let streaming: Bool
    let error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .text(let text):
                    MarkdownText(text: text)
                case .thinking(let text):
                    ThinkingView(text: text)
                }
            }
            if streaming && blocks.isEmpty {
                ProgressView()
                    .controlSize(.small)
            }
            if let error {
                Label(error, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MarkdownText: View {
    let text: String

    var body: some View {
        Text(rendered)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var rendered: AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

private struct ThinkingView: View {
    let text: String
    @StateObject private var disclosure = Disclosure()

    var body: some View {
        DisclosureGroup(isExpanded: $disclosure.expanded) {
            Text(text)
                .font(.callout)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Label("Thinking", systemImage: "brain")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }
}

private struct ToolCardView: View {
    let name: String
    let arguments: String
    let state: ToolState
    let output: String
    @StateObject private var disclosure = Disclosure()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                stateIcon
                Text(name)
                    .font(.system(.body, design: .monospaced).weight(.semibold))
                Text(summary)
                    .font(.system(.callout, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer()
                Button(disclosure.expanded ? "Hide" : "Show") { disclosure.expanded.toggle() }
                    .buttonStyle(.link)
                    .font(.caption)
            }
            if disclosure.expanded {
                ScrollView(.horizontal) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(arguments)
                        if !output.isEmpty {
                            Divider()
                            Text(output)
                        }
                    }
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(8)
                }
                .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(nsColor: .separatorColor)))
    }

    private var summary: String {
        arguments.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: " ")
    }

    @ViewBuilder private var stateIcon: some View {
        switch state {
        case .pending:
            Image(systemName: "clock").foregroundStyle(.secondary)
        case .running:
            ProgressView().controlSize(.small)
        case .succeeded:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed:
            Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
        case .aborted:
            Image(systemName: "stop.circle").foregroundStyle(.orange)
        }
    }
}

private struct NoticeRowView: View {
    let level: NoticeLevel
    let text: String

    var body: some View {
        Label(text, systemImage: level.symbol)
            .font(.callout)
            .foregroundStyle(level.tint)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CompactionRowView: View {
    let summary: String
    let tokensBefore: UInt64
    @StateObject private var disclosure = Disclosure()

    var body: some View {
        DisclosureGroup(isExpanded: $disclosure.expanded) {
            Text(summary)
                .font(.callout)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Label("Context compacted from \(TokenCount(tokensBefore).text) tokens", systemImage: "rectangle.compress.vertical")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }
}

extension NoticeLevel {
    var symbol: String {
        switch self {
        case .info: "info.circle"
        case .warning: "exclamationmark.triangle"
        case .error: "xmark.octagon"
        }
    }

    var tint: Color {
        switch self {
        case .info: .secondary
        case .warning: .orange
        case .error: .red
        }
    }
}

struct TokenCount {
    let value: UInt64

    init(_ value: UInt64) {
        self.value = value
    }

    var text: String {
        switch value {
        case ..<1_000: "\(value)"
        case ..<1_000_000: String(format: "%.1fk", Double(value) / 1_000)
        default: String(format: "%.1fM", Double(value) / 1_000_000)
        }
    }
}

@MainActor
final class Disclosure: ObservableObject {
    @Published var expanded = false
}
