import LocalStudioKit
import SwiftUI

struct TimelineRowView: View {
    let row: TimelineRow
    let store: StudioStore

    var body: some View {
        switch row {
        case .entry(let entry, let hidesThinking):
            TimelineEntryView(entry: entry, hidesThinking: hidesThinking, store: store)
        case .tools(let entries):
            ToolGroupView(entries: entries, store: store)
        case .fold(let entry, let expanded):
            TurnFoldRow(entry: entry, expanded: expanded) {
                store.conversation.toggleFold(entry.id)
            }
        }
    }
}

private struct TimelineEntryView: View {
    let entry: TimelineEntry
    let hidesThinking: Bool
    let store: StudioStore

    var body: some View {
        let item = entry.item
        switch item.kind {
        case .user(let text, let images, let anchor, let thumbnails):
            UserBubble(
                id: item.id, text: text, images: images, thumbnails: thumbnails,
                createdAt: item.createdAt, anchor: anchor, store: store
            )
        case .assistant(let blocks, let streaming, let error, let changedFiles):
            AssistantMessage(
                blocks: blocks, streaming: streaming, error: error, changedFiles: changedFiles,
                createdAt: item.createdAt, hidesThinking: hidesThinking,
                openDiff: { path in store.panels.openDiff(path: path) }
            )
        case .notice(let level, let text):
            NoticeRow(level: level, text: text)
        case .compaction(let summary, let tokensBefore):
            CompactionDivider(summary: summary, tokensBefore: tokensBefore)
        case .tool, .turnSummary:
            EmptyView()
        }
    }
}

private struct UserBubble: View {
    let id: UInt64
    let text: String
    let images: UInt32
    let thumbnails: [ImageThumbnail]
    let createdAt: Int64?
    let anchor: String?
    let store: StudioStore
    @State private var hovering = false
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            if !thumbnails.isEmpty {
                ThumbnailGrid(id: id, thumbnails: thumbnails) { index in
                    if let anchor {
                        store.conversation.openGallery(entry: anchor, thumbnails: thumbnails, index: index)
                    }
                }
            }
            if !text.isEmpty {
                VStack(alignment: .trailing, spacing: 6) {
                    Text(text)
                        .font(.system(size: 13.5))
                        .lineSpacing(3)
                        .lineLimit(collapsible && !expanded ? 14 : nil)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    if collapsible {
                        Button(expanded ? "Show less" : "Show more") { expanded.toggle() }
                            .buttonStyle(.plain)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Theme.message, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            if images > 0, thumbnails.isEmpty {
                Label(images == 1 ? "1 image" : "\(images) images", systemImage: "photo")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Theme.hover, in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.hairline))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(images == 1 ? "1 image attached" : "\(images) images attached")
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 96)
        .hoverActions(alignment: .bottomTrailing, hovering: $hovering) {
            if let createdAt {
                TimestampText(millis: createdAt)
                    .padding(.trailing, 4)
            }
            if let anchor {
                UserMessageEditButton(anchor: anchor, store: store)
            }
            CopyButton(text: text, size: 12)
        }
    }

    private var collapsible: Bool {
        text.count > 1_200 || text.reduce(0) { $1 == "\n" ? $0 + 1 : $0 } > 16
    }
}

private struct UserMessageEditButton: View {
    let anchor: String
    let store: StudioStore

    var body: some View {
        if !store.conversation.busy {
            MessageActionButton("Edit from here", symbol: "arrow.uturn.backward", size: 12) {
                store.conversation.editFromHere(entry: anchor)
            }
        }
    }
}

extension EnvironmentValues {
    @Entry var responseStreaming: ResponseStreaming = .paragraph
    @Entry var timeFormat: TimeFormat = .locale
}

private struct TimestampText: View {
    let millis: Int64
    @Environment(\.timeFormat) private var timeFormat

    var body: some View {
        let date = Date(timeIntervalSince1970: TimeInterval(millis) / 1_000)
        Text(Self.format(date, timeFormat))
            .font(.system(size: 11.5))
            .monospacedDigit()
            .foregroundStyle(Theme.secondaryText)
            .help(date.formatted(date: .complete, time: .standard))
    }

    static func format(_ date: Date, _ format: TimeFormat) -> String {
        switch format {
        case .locale:
            return date.formatted(.dateTime.hour().minute())
        case .twelveHour, .twentyFourHour:
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = format == .twelveHour ? "h:mm a" : "HH:mm"
            return formatter.string(from: date)
        }
    }
}

private struct AssistantMessage: View {
    let blocks: [Block]
    let streaming: Bool
    let error: String?
    let changedFiles: [FileChange]
    let createdAt: Int64?
    let hidesThinking: Bool
    let openDiff: (String) -> Void
    @State private var hovering = false
    @Environment(\.responseStreaming) private var responseStreaming

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(blocks.indices, id: \.self) { index in
                switch blocks[index] {
                case .thinking(let text):
                    if !hidesThinking {
                        ThinkingBlock(text: text, live: streaming && index == blocks.count - 1)
                    }
                case .text(let text):
                    if let shown = StreamingText.visible(text, streaming: streaming && index == blocks.count - 1, mode: responseStreaming) {
                        MarkdownView(text: shown)
                    }
                }
            }
            if !streaming, error == nil, answer.isEmpty, !blocks.contains(where: \.isThinking) {
                Text("(empty response)")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondaryText)
            }
            if let error {
                Label {
                    Text(error).textSelection(.enabled)
                } icon: {
                    Image(systemName: "exclamationmark.triangle").accessibilityHidden(true)
                }
                .font(.system(size: 12.5))
                .foregroundStyle(.red)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.red.opacity(0.25)))
            }
            if !changedFiles.isEmpty {
                ChangedFilesCard(files: changedFiles, openDiff: openDiff)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .hoverActions(alignment: .bottomLeading, hovering: $hovering) {
            if !streaming, !answer.isEmpty {
                CopyButton(text: answer, size: 12)
                if let createdAt {
                    TimestampText(millis: createdAt)
                        .padding(.leading, 4)
                }
            }
        }
    }

    private var answer: String {
        blocks.compactMap { block in
            if case .text(let text) = block { text } else { nil }
        }
        .joined(separator: "\n\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct HoverActions<Actions: View>: ViewModifier {
    let alignment: Alignment
    @Binding var hovering: Bool
    @ViewBuilder let actions: () -> Actions

    static var height: CGFloat { 24 }

    func body(content: Content) -> some View {
        content
            .padding(.bottom, Self.height)
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
            .overlay(alignment: alignment) {
                if hovering {
                    HStack(spacing: 2, content: actions)
                        .frame(height: Self.height)
                }
            }
            .padding(.bottom, -Self.height)
    }
}

extension View {
    fileprivate func hoverActions<Actions: View>(
        alignment: Alignment,
        hovering: Binding<Bool>,
        @ViewBuilder actions: @escaping () -> Actions
    ) -> some View {
        modifier(HoverActions(alignment: alignment, hovering: hovering, actions: actions))
    }
}

enum StreamingText {
    static func visible(_ text: String, streaming: Bool, mode: ResponseStreaming) -> String? {
        guard streaming else { return text }
        switch mode {
        case .token:
            return text
        case .turn:
            return nil
        case .paragraph:
            guard let boundary = text.range(of: "\n\n", options: .backwards) else { return nil }
            let settled = String(text[..<boundary.lowerBound])
            return settled.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : settled
        }
    }
}

extension Block {
    var isThinking: Bool {
        if case .thinking = self { true } else { false }
    }
}

private struct ThinkingBlock: View {
    let text: String
    let live: Bool
    @State private var expanded = false
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                expanded.toggle()
            } label: {
                HStack(spacing: 6) {
                    Text(live ? "Thinking" : "Thought")
                        .foregroundStyle(hovering ? Color.primary : Theme.secondaryText)
                    if !live, !expanded, let preview {
                        Text(preview)
                            .foregroundStyle(Theme.secondaryText.opacity(0.75))
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(Theme.secondaryText)
                        .accessibilityHidden(true)
                }
                .font(.system(size: 12.5))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            if expanded {
                MarkdownView(text: text, size: 12.5, secondary: true)
                    .padding(.leading, 12)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(Theme.input).frame(width: 1.5)
                    }
            }
        }
    }

    private var preview: String? {
        text.split(whereSeparator: \.isNewline)
            .lazy
            .map { $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "*#_ ")) }
            .first { !$0.isEmpty }
    }
}

private struct ToolGroupView: View {
    let entries: [TimelineEntry]
    let store: StudioStore
    @State private var showsAll = false

    private static let visible = 6

    var body: some View {
        let hidden = showsAll ? 0 : max(entries.count - Self.visible, 0)
        VStack(alignment: .leading, spacing: 0) {
            if hidden > 0 {
                Button {
                    showsAll = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 12, weight: .light))
                            .frame(width: 16)
                            .accessibilityHidden(true)
                        Text(hidden == 1 ? "1 earlier tool call" : "\(hidden) earlier tool calls")
                        Spacer(minLength: 0)
                    }
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.secondaryText)
                    .frame(height: 26)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            ForEach(entries.suffix(entries.count - hidden)) { entry in
                if entry.isAgentCall {
                    AgentSpawnRow(entry: entry, store: store)
                } else {
                    ToolRow(entry: entry)
                }
            }
        }
    }
}

private struct ToolRow: View {
    let entry: TimelineEntry
    @State private var expanded = false
    @State private var hovering = false

    var body: some View {
        if case .tool(_, let name, let kind, let summary, let arguments, let state, let output, let change, _, _) = entry.item.kind {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    expanded.toggle()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: kind.symbol)
                            .font(.system(size: 12, weight: .light))
                            .foregroundStyle(Theme.secondaryText)
                            .frame(width: 16)
                            .accessibilityHidden(true)
                        Text(summary.isEmpty ? name : summary)
                            .foregroundStyle(hovering || expanded ? Color.primary : Theme.secondaryText)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        if let change, change.additions + change.deletions > 0 {
                            DiffStat(additions: change.additions, deletions: change.deletions)
                        }
                        if state == .failed {
                            Text("Failed")
                                .foregroundStyle(.red)
                        }
                        Spacer(minLength: 8)
                        ToolStateGlyph(state: state)
                        Image(systemName: expanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(Theme.secondaryText)
                            .frame(width: 10)
                            .opacity(hovering || expanded ? 1 : 0)
                            .accessibilityHidden(true)
                    }
                    .font(.system(size: 12.5))
                    .frame(height: 26)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                if expanded {
                    ToolOutput(text: detail(arguments: arguments, output: output, change: change), diff: change != nil && output.isEmpty, path: change?.path)
                        .padding(.leading, 24)
                        .padding(.bottom, 6)
                }
            }
        }
    }

    private func detail(arguments: String, output: String, change: FileChange?) -> String {
        if !output.isEmpty {
            return output
        }
        if let change, !change.diff.isEmpty {
            return change.diff
        }
        return arguments
    }
}

private struct ToolStateGlyph: View {
    let state: ToolState

    var body: some View {
        switch state {
        case .pending:
            glyph("clock", Theme.secondaryText, "Pending")
        case .running:
            glyph("circle.dotted", Theme.secondaryText, "Running")
        case .succeeded:
            glyph("checkmark", Theme.secondaryText.opacity(0.7), "Succeeded")
        case .failed:
            glyph("xmark", .red, "Failed")
        case .aborted:
            glyph("minus.circle", Theme.secondaryText, "Stopped")
        }
    }

    private func glyph(_ symbol: String, _ color: Color, _ help: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 11, weight: .light))
            .foregroundStyle(color)
            .frame(width: 14)
            .help(help)
            .accessibilityLabel(help)
    }
}

private struct InlineDiff: Equatable, Sendable {
    let text: String
    let lines: [[CodeSegment]?]

    init(_ text: String, path: String?) {
        let raw = text.split(separator: "\n", omittingEmptySubsequences: false)
        var old: [String] = []
        var new: [String] = []
        var oldSlots: [Int] = []
        var newSlots: [Int] = []
        for (index, line) in raw.enumerated() where !Self.header(line) {
            let code = String(line.dropFirst())
            switch line.first {
            case "+":
                new.append(code)
                newSlots.append(index)
            case "-":
                old.append(code)
                oldSlots.append(index)
            case " ":
                old.append(code)
                oldSlots.append(index)
                new.append(code)
                newSlots.append(index)
            default:
                break
            }
        }
        var lines = [[CodeSegment]?](repeating: nil, count: raw.count)
        for (slot, segments) in zip(oldSlots, highlightLines(lines: old, language: nil, path: path)) {
            lines[slot] = segments
        }
        for (slot, segments) in zip(newSlots, highlightLines(lines: new, language: nil, path: path)) {
            lines[slot] = segments
        }
        self.text = text
        self.lines = lines
    }

    static func header(_ line: Substring) -> Bool {
        line.hasPrefix("+++") || line.hasPrefix("---") || line.hasPrefix("@@")
    }
}

private struct ToolOutput: View {
    let text: String
    let diff: Bool
    let path: String?
    @State private var highlighted: InlineDiff?

    private static let limit = 24_000

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            Text(rendered)
                .foregroundStyle(Theme.codeText)
                .font(.system(size: 11.5, design: .monospaced))
                .lineSpacing(2)
                .textSelection(.enabled)
                .fixedSize()
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 260)
        .fixedSize(horizontal: false, vertical: true)
        .background(Theme.code, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.hairline))
        .task(id: diff ? trimmed : "") {
            guard diff else { return }
            let text = trimmed
            let path = path
            let result = await SyntaxHighlighter.shared.run { InlineDiff(text, path: path) }
            guard !Task.isCancelled else { return }
            highlighted = result
        }
    }

    private var trimmed: String {
        let body = text.hasSuffix("\n") ? String(text.dropLast()) : text
        guard body.count > Self.limit else { return body }
        return "…\n" + body.suffix(Self.limit)
    }

    private var rendered: AttributedString {
        let body = trimmed
        guard diff else { return AttributedString(body) }
        let segments = highlighted?.text == body ? highlighted?.lines ?? [] : []
        var result = AttributedString()
        for (index, line) in body.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            var part: AttributedString
            let header = InlineDiff.header(line)
            if !header, let sign = line.first, segments.indices.contains(index), let code = segments[index] {
                part = AttributedString(String(sign))
                part[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] = sign == "+" ? Theme.diffAdded : sign == "-" ? Theme.diffRemoved : Theme.secondaryText
                SyntaxStyle.append(code, to: &part)
            } else {
                part = AttributedString(line)
                if line.hasPrefix("+"), !header {
                    part[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] = Theme.diffAdded
                } else if line.hasPrefix("-"), !header {
                    part[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] = Theme.diffRemoved
                } else if line.hasPrefix("@@") {
                    part[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] = Theme.secondaryText
                }
            }
            if !header, line.hasPrefix("+") || line.hasPrefix("-") {
                part[AttributeScopes.SwiftUIAttributes.BackgroundColorAttribute.self] = line.hasPrefix("+") ? Theme.diffAddedSurface : Theme.diffRemovedSurface
            }
            result += part
            result += AttributedString("\n")
        }
        return result
    }
}

private struct TurnFoldRow: View {
    let entry: TimelineEntry
    let expanded: Bool
    let toggle: () -> Void
    @State private var hovering = false

    var body: some View {
        if case .turnSummary(_, let duration, let tools) = entry.item.kind {
            Button(action: toggle) {
                HStack(spacing: 6) {
                    Text("Worked for \(WorkDuration(milliseconds: duration).text)")
                        .foregroundStyle(hovering ? Color.primary : Theme.secondaryText)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(Theme.secondaryText)
                        .accessibilityHidden(true)
                    Rectangle()
                        .fill(Theme.hairline)
                        .frame(height: 1)
                        .padding(.leading, 6)
                }
                .font(.system(size: 12.5))
                .frame(height: 22)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(tools == 1 ? "1 tool call" : "\(tools) tool calls")
            .onHover { hovering = $0 }
        }
    }
}

struct WorkDuration {
    let milliseconds: UInt64

    var text: String {
        let seconds = milliseconds / 1_000
        switch seconds {
        case ..<1: return "\(max(milliseconds, 1))ms"
        case ..<60: return "\(seconds)s"
        case ..<3_600: return "\(seconds / 60)m \(seconds % 60)s"
        default: return "\(seconds / 3_600)h \((seconds % 3_600) / 60)m"
        }
    }
}

struct DiffStat: View {
    let additions: UInt32
    let deletions: UInt32

    var body: some View {
        HStack(spacing: 4) {
            Text("+\(additions)").foregroundStyle(Theme.diffAdded)
            Text("−\(deletions)").foregroundStyle(Theme.diffRemoved)
        }
        .font(.system(size: 11.5).monospacedDigit())
    }
}

private struct ChangedFilesCard: View {
    let files: [FileChange]
    let openDiff: ((String) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(files.count == 1 ? "1 file changed" : "\(files.count) files changed")
                    .font(.system(size: 12.5, weight: .medium))
                DiffStat(additions: files.reduce(0) { $0 + $1.additions }, deletions: files.reduce(0) { $0 + $1.deletions })
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
            Rectangle().fill(Theme.hairline).frame(height: 1)
            VStack(spacing: 0) {
                ForEach(files, id: \.path) { file in
                    ChangedFileRow(file: file, open: openDiff.map { open in { open(file.path) } })
                }
            }
            .padding(4)
        }
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline))
    }
}

private struct ChangedFileRow: View {
    let file: FileChange
    let open: (() -> Void)?
    @State private var hovering = false

    var body: some View {
        if let open {
            Button(action: open) { content }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                .help("Open diff")
        } else {
            content
        }
    }

    private var content: some View {
        let url = URL(fileURLWithPath: file.path)
        let directory = url.deletingLastPathComponent().relativePath
        return HStack(spacing: 8) {
            Image(systemName: "doc")
                .font(.system(size: 12, weight: .light))
                .foregroundStyle(Theme.secondaryText)
                .frame(width: 16)
                .accessibilityHidden(true)
            Text(url.lastPathComponent)
                .font(.system(size: 12.5))
                .lineLimit(1)
            if directory != ".", !directory.isEmpty {
                Text(directory)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 8)
            DiffStat(additions: file.additions, deletions: file.deletions)
        }
        .padding(.horizontal, 8)
        .frame(height: 28)
        .contentShape(Rectangle())
        .rowSurface(selected: false, hovering: hovering)
    }
}

private struct NoticeRow: View {
    let level: NoticeLevel
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: level.symbol)
                .font(.system(size: 12, weight: .light))
                .accessibilityHidden(true)
            Text(text)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 12.5))
        .foregroundStyle(level.tint)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CompactionDivider: View {
    let summary: String
    let tokensBefore: UInt64
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                expanded.toggle()
            } label: {
                HStack(spacing: 10) {
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    Label("Context compacted from \(TokenCount(tokensBefore).text) tokens", systemImage: "arrow.down.right.and.arrow.up.left")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.secondaryText)
                        .fixedSize()
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Context compacted from \(TokenCount(tokensBefore).text) tokens")
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(expanded ? "Hide summary" : "Show summary")
            if expanded, !summary.isEmpty {
                MarkdownView(text: summary, size: 12.5, secondary: true)
            }
        }
    }
}

struct WorkingRow: View {
    let info: ThreadInfo
    let waitingForApproval: Bool

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(waitingForApproval ? Color.orange : Theme.primary)
                .frame(width: 6, height: 6)
            if let started = info.runStartedAt, !waitingForApproval, !info.compacting, info.retryAttempt == 0 {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text("Working for \(elapsed(since: started, now: context.date))")
                        .monospacedDigit()
                }
            } else {
                Text(label)
            }
        }
        .font(.system(size: 12.5))
        .foregroundStyle(Theme.secondaryText)
        .frame(height: 22)
    }

    private var label: String {
        if waitingForApproval {
            return "Waiting for approval"
        }
        if info.compacting {
            return "Compacting context…"
        }
        if info.retryAttempt > 0 {
            return "Retrying (attempt \(info.retryAttempt))…"
        }
        return "Working…"
    }

    private func elapsed(since started: Int64, now: Date) -> String {
        let milliseconds = max(Int64(now.timeIntervalSince1970 * 1_000) - started, 0)
        return WorkDuration(milliseconds: UInt64(milliseconds / 1_000 * 1_000)).text
    }
}

struct QueuedBubble: View {
    let message: QueuedMessage
    let store: StudioStore

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(message.text)
                .font(.system(size: 13.5))
                .lineSpacing(3)
                .lineLimit(8)
                .foregroundStyle(Theme.secondaryText)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(Theme.input, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                )
            HStack(spacing: 2) {
                Label(status, systemImage: "clock")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                    .help(message.steering ? "Sends after the next tool call" : "Sends when the turn ends")
                    .padding(.trailing, 4)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(status)
                if !message.steering, !message.sending {
                    MessageActionButton("Send now", symbol: "arrow.up", size: 12) {
                        store.conversation.sendNow(message)
                    }
                }
                if !message.sending {
                    MessageActionButton("Cancel and return to the composer", symbol: "xmark", size: 12) {
                        store.conversation.cancelQueued(message)
                    }
                }
            }
            .frame(height: 24)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 96)
    }

    private var status: String {
        if message.sending {
            return "Sending"
        }
        return message.steering ? "Steering" : "Queued"
    }
}

extension ToolKind {
    var symbol: String {
        switch self {
        case .read: "eye"
        case .edit: "pencil"
        case .command: "terminal"
        case .search: "magnifyingglass"
        case .web: "globe"
        case .agent: "person"
        case .other: "wrench"
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
        case .info: Theme.secondaryText
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
