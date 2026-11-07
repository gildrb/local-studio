import AppKit
import Foundation
import SwiftUI

struct MarkdownView: View {
    let text: String
    var size: CGFloat = 13.5
    var secondary = false

    var body: some View {
        let document = MarkdownCache.document(for: text)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(document.blocks) { block in
                MarkdownBlockView(block: block, size: size, secondary: secondary)
                    .padding(.top, block.spacing)
            }
        }
        .tint(Theme.primary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    let size: CGFloat
    let secondary: Bool

    var body: some View {
        switch block.kind {
        case .paragraph(let content, let depth, let marker, let quote):
            paragraph(content, depth: depth, marker: marker)
                .padding(.leading, quote > 0 ? 12 : 0)
                .overlay(alignment: .leading) {
                    if quote > 0 {
                        Capsule().fill(Theme.input).frame(width: 2.5)
                    }
                }
                .foregroundStyle(secondary || quote > 0 ? Theme.secondaryText : Color.primary)
        case .heading(let level, let content):
            Text(content)
                .font(.system(size: headingSize(level), weight: .semibold))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, level <= 2 ? 8 : 4)
        case .code(let language, let code):
            CodeBlockView(language: language, code: code)
        case .rule:
            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.vertical, 4)
        case .table(let rows):
            MarkdownTableView(rows: rows, size: size)
        }
    }

    private func paragraph(_ content: AttributedString, depth: Int, marker: String?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if depth > 0 {
                Text(marker ?? "")
                    .foregroundStyle(Theme.secondaryText)
                    .monospacedDigit()
                    .frame(minWidth: 14, alignment: .trailing)
            }
            Text(content)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(3)
        }
        .font(.system(size: size))
        .padding(.leading, CGFloat(max(depth - 1, 0)) * 20)
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case 1: size + 6
        case 2: size + 3.5
        case 3: size + 1.5
        default: size
        }
    }
}

private struct MarkdownTableView: View {
    let rows: [[AttributedString]]
    let size: CGFloat

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(rows.indices, id: \.self) { index in
                    GridRow {
                        ForEach(rows[index].indices, id: \.self) { column in
                            Text(rows[index][column])
                                .font(.system(size: size - 0.5, weight: index == 0 ? .semibold : .regular))
                                .textSelection(.enabled)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .frame(maxWidth: 320, alignment: .leading)
                        }
                    }
                    .background(index == 0 ? Theme.message : Color.clear)
                    if index < rows.count - 1 {
                        Rectangle().fill(Theme.hairline).frame(height: 1).gridCellUnsizedAxes(.horizontal)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.hairline))
        }
    }
}

struct CodeBlockView: View {
    let language: String?
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(language?.isEmpty == false ? language ?? "" : "text")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                Spacer(minLength: 8)
                CopyButton(text: code, size: 12)
            }
            .padding(.leading, 12)
            .padding(.trailing, 4)
            .frame(height: 30)
            Rectangle().fill(Theme.hairline).frame(height: 1)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .foregroundStyle(Theme.codeText)
                    .font(.system(size: 12, design: .monospaced))
                    .lineSpacing(2.5)
                    .textSelection(.enabled)
                    .fixedSize()
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
            }
        }
        .background(Theme.code, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline))
    }
}

struct CopyButton: View {
    let text: String
    var size: CGFloat = 13
    @State private var copied = false

    var body: some View {
        MessageActionButton(copied ? "Copied" : "Copy", symbol: copied ? "checkmark" : "doc.on.doc", size: size) {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            copied = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                copied = false
            }
        }
    }
}

struct MessageActionButton: View {
    let title: String
    let symbol: String
    let size: CGFloat
    let action: () -> Void
    @State private var hovering = false

    init(_ title: String, symbol: String, size: CGFloat = 13, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.size = size
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size, weight: .light))
                .foregroundStyle(hovering ? Color.primary : Theme.secondaryText)
                .frame(width: 24, height: 24)
                .background(hovering ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
        .onHover { hovering = $0 }
    }
}

struct MarkdownDocument {
    let blocks: [MarkdownBlock]
}

struct MarkdownBlock: Identifiable {
    enum Kind {
        case paragraph(AttributedString, depth: Int, marker: String?, quote: Int)
        case heading(Int, AttributedString)
        case code(String?, String)
        case rule
        case table([[AttributedString]])
    }

    let id: Int
    let kind: Kind
    let spacing: CGFloat
}

@MainActor
enum MarkdownCache {
    private final class Box {
        let document: MarkdownDocument

        init(_ document: MarkdownDocument) {
            self.document = document
        }
    }

    private static let storage: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 400
        return cache
    }()

    static func document(for text: String) -> MarkdownDocument {
        let key = text as NSString
        if let box = storage.object(forKey: key) {
            return box.document
        }
        let document = MarkdownParser.parse(text)
        storage.setObject(Box(document), forKey: key)
        return document
    }
}

enum MarkdownParser {
    private struct Pending {
        var leaf: Int
        var kind: MarkdownBlock.Kind
        var list: Int?
        var table: (row: Int, column: Int)?
    }

    static func parse(_ text: String) -> MarkdownDocument {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .full,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        guard let parsed = try? AttributedString(markdown: text, options: options) else {
            return MarkdownDocument(blocks: [MarkdownBlock(id: 0, kind: .paragraph(AttributedString(text), depth: 0, marker: nil, quote: 0), spacing: 0)])
        }
        var blocks: [MarkdownBlock] = []
        var pending: Pending?
        var seenItems = Set<Int>()
        var previousList: Int?

        func flush() {
            guard let current = pending else { return }
            let spacing: CGFloat
            if blocks.isEmpty {
                spacing = 0
            } else if current.list != nil, previousList != nil {
                spacing = 5
            } else {
                spacing = 12
            }
            blocks.append(MarkdownBlock(id: blocks.count, kind: current.kind, spacing: spacing))
            previousList = current.list
            pending = nil
        }

        for run in parsed.runs {
            let components = run[AttributeScopes.FoundationAttributes.PresentationIntentAttribute.self]?.components ?? []
            var fragment = AttributedString(parsed[run.range])
            style(&fragment, inline: run[AttributeScopes.FoundationAttributes.InlinePresentationIntentAttribute.self])
            guard let leaf = components.first else {
                if case .paragraph(var content, let depth, let marker, let quote)? = pending?.kind {
                    content += fragment
                    pending?.kind = .paragraph(content, depth: depth, marker: marker, quote: quote)
                } else {
                    flush()
                    pending = Pending(leaf: -1, kind: .paragraph(fragment, depth: 0, marker: nil, quote: 0))
                }
                continue
            }
            if let table = components.first(where: { if case .table = $0.kind { true } else { false } }) {
                if pending?.leaf != table.identity {
                    flush()
                    pending = Pending(leaf: table.identity, kind: .table([]))
                }
                appendCell(fragment, components: components, pending: &pending)
                continue
            }
            if pending?.leaf == leaf.identity {
                switch pending?.kind {
                case .paragraph(var content, let depth, let marker, let quote)?:
                    content += fragment
                    pending?.kind = .paragraph(content, depth: depth, marker: marker, quote: quote)
                case .heading(let level, var content)?:
                    content += fragment
                    pending?.kind = .heading(level, content)
                case .code(let language, let code)?:
                    pending?.kind = .code(language, code + String(fragment.characters))
                case .rule?, .table?, nil:
                    break
                }
                continue
            }
            flush()
            switch leaf.kind {
            case .header(let level):
                pending = Pending(leaf: leaf.identity, kind: .heading(level, fragment))
            case .codeBlock(let language):
                pending = Pending(leaf: leaf.identity, kind: .code(language, String(fragment.characters)))
            case .thematicBreak:
                pending = Pending(leaf: leaf.identity, kind: .rule)
            default:
                let lists = components.filter { component in
                    switch component.kind {
                    case .orderedList, .unorderedList: true
                    default: false
                    }
                }
                let quote = components.filter { if case .blockQuote = $0.kind { true } else { false } }.count
                var marker: String?
                if components.count > 2, case .listItem(let ordinal) = components[1].kind, seenItems.insert(components[1].identity).inserted {
                    if case .orderedList = components[2].kind {
                        marker = "\(ordinal)."
                    } else {
                        marker = ["•", "◦", "▪"][(lists.count - 1) % 3]
                    }
                }
                pending = Pending(
                    leaf: leaf.identity,
                    kind: .paragraph(fragment, depth: lists.count, marker: marker, quote: quote),
                    list: lists.last?.identity
                )
            }
        }
        flush()
        let trimmed = blocks.map { block -> MarkdownBlock in
            guard case .code(let language, let code) = block.kind else { return block }
            var body = code
            while body.hasSuffix("\n") {
                body.removeLast()
            }
            return MarkdownBlock(id: block.id, kind: .code(language, body), spacing: block.spacing)
        }
        return MarkdownDocument(blocks: trimmed)
    }

    private static func appendCell(
        _ fragment: AttributedString,
        components: [PresentationIntent.IntentType],
        pending: inout Pending?
    ) {
        var row = 0
        var column = 0
        for component in components {
            switch component.kind {
            case .tableCell(let index): column = index
            case .tableRow(let index): row = index
            case .tableHeaderRow: row = 0
            default: break
            }
        }
        guard case .table(var rows)? = pending?.kind else { return }
        while rows.count <= row {
            rows.append([])
        }
        if pending?.table?.row == row, pending?.table?.column == column, !rows[row].isEmpty {
            rows[row][rows[row].count - 1] += fragment
        } else {
            rows[row].append(fragment)
        }
        pending?.kind = .table(rows)
        pending?.table = (row, column)
    }

    private static func style(_ fragment: inout AttributedString, inline: InlinePresentationIntent?) {
        guard let inline else { return }
        if inline.contains(.code) {
            fragment[AttributeScopes.SwiftUIAttributes.FontAttribute.self] = .system(size: 12.5, design: .monospaced)
            fragment[AttributeScopes.SwiftUIAttributes.BackgroundColorAttribute.self] = Theme.message
        }
        if inline.contains(.lineBreak) {
            fragment = AttributedString("\n")
        } else if inline.contains(.softBreak) {
            fragment = AttributedString(" ")
        }
    }
}
