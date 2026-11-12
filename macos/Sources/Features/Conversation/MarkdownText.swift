import AppKit
import LocalStudioKit
import SwiftUI

final class MarkdownLayoutManager: NSLayoutManager {
    var containerOrigin = NSPoint.zero

    override func fillBackgroundRectArray(_ rectArray: UnsafePointer<NSRect>, count rectCount: Int, forCharacterRange charRange: NSRange, color: NSColor) {
        guard let container = textContainers.first else {
            super.fillBackgroundRectArray(rectArray, count: rectCount, forCharacterRange: charRange, color: color)
            return
        }
        let origin = containerOrigin
        let text = (textStorage?.string ?? "") as NSString
        let glyphs = glyphRange(forCharacterRange: charRange, actualCharacterRange: nil)
        var rects: [NSRect] = []
        enumerateLineFragments(forGlyphRange: glyphs) { fragment, used, _, line, _ in
            let range = NSIntersectionRange(line, glyphs)
            guard range.length > 0 else { return }
            var characters = self.characterRange(forGlyphRange: range, actualGlyphRange: nil)
            while characters.length > 0, [0x0A, 0x2028, 0x200B].contains(text.character(at: NSMaxRange(characters) - 1)) {
                characters.length -= 1
            }
            while characters.length > 0, text.character(at: characters.location) == 0x09 {
                characters.location += 1
                characters.length -= 1
            }
            var box: NSRect
            if characters.length > 0 {
                box = self.boundingRect(forGlyphRange: self.glyphRange(forCharacterRange: characters, actualCharacterRange: nil), in: container)
            } else {
                let point = self.location(forGlyphAt: range.location)
                box = NSRect(x: fragment.minX + point.x, y: 0, width: 4, height: 0)
            }
            box.origin.y = used.minY
            box.size.height = used.height
            rects.append(box.offsetBy(dx: origin.x, dy: origin.y))
        }
        guard !rects.isEmpty else { return }
        super.fillBackgroundRectArray(rects, count: rects.count, forCharacterRange: charRange, color: color)
    }
}

extension NSAttributedString.Key {
    static let markdownMarker = NSAttributedString.Key("LocalStudioMarkdownMarker")
    static let markdownQuote = NSAttributedString.Key("LocalStudioMarkdownQuote")
    static let markdownRule = NSAttributedString.Key("LocalStudioMarkdownRule")
    static let markdownCell = NSAttributedString.Key("LocalStudioMarkdownCell")
    static let markdownGroup = NSAttributedString.Key("LocalStudioMarkdownGroup")
}

extension NSResponder {
    var capturesKeys: Bool {
        if let view = self as? MarkdownNSTextView {
            return view.selectedRange().length > 0
        }
        return self is NSText
    }
}

final class MarkdownCodeMark: NSObject {
    let index: Int
    let language: String?
    let code: String

    init(index: Int, language: String?, code: String) {
        self.index = index
        self.language = language
        self.code = code
    }
}

final class MarkdownCellMark: NSObject {
    let table: Int
    let row: Int
    let column: Int

    init(table: Int, row: Int, column: Int) {
        self.table = table
        self.row = row
        self.column = column
    }
}

struct MarkdownSource: Hashable {
    let text: String
    let size: CGFloat
    let secondary: Bool
}

final class MarkdownPart {
    let start: Int
    let end: Int
    let last: Bool
    let context: MarkdownContext
    let next: MarkdownContext
    let string: NSAttributedString
    let codeBlocks: [MarkdownCodeBlock]
    let pending: [HighlightKey]
    let revision: Int

    @MainActor
    init(text: String, start: Int, end: Int, last: Bool, context: MarkdownContext, size: CGFloat, secondary: Bool, revision: Int) {
        self.start = start
        self.end = end
        self.last = last
        self.context = context
        self.revision = revision
        let document = MarkdownParser.parse(text, context: context)
        var builder = MarkdownStringBuilder(size: size, secondary: secondary, context: context)
        builder.build(document, trim: last)
        string = builder.output
        codeBlocks = builder.codeBlocks
        pending = builder.pending
        next = MarkdownContext(
            started: context.started || !document.blocks.isEmpty,
            afterList: document.endsInList,
            groups: builder.group,
            tables: builder.tables,
            codes: context.codes + builder.codeBlocks.count
        )
    }

    @MainActor
    func current(_ revision: Int) -> Bool {
        revision == self.revision && !pending.contains(where: SyntaxHighlighter.shared.contains)
    }
}

final class MarkdownRendering {
    let source: MarkdownSource
    let parts: [MarkdownPart]
    let scan: MarkdownScan
    let codeBlocks: [MarkdownCodeBlock]
    let pending: [HighlightKey]
    let revision: Int

    init(source: MarkdownSource, parts: [MarkdownPart], scan: MarkdownScan, revision: Int) {
        self.source = source
        self.parts = parts
        self.scan = scan
        self.revision = revision
        var blocks: [MarkdownCodeBlock] = []
        var location = 0
        for part in parts {
            for block in part.codeBlocks {
                blocks.append(MarkdownCodeBlock(range: NSRange(location: block.range.location + location, length: block.range.length), mark: block.mark))
            }
            location += part.string.length
        }
        codeBlocks = blocks
        pending = parts.flatMap(\.pending)
    }

    @MainActor
    func current(_ revision: Int) -> Bool {
        revision == self.revision && !pending.contains(where: SyntaxHighlighter.shared.contains)
    }
}

struct MarkdownScan {
    private(set) var offset = 0
    private(set) var boundaries: [Int] = []
    private(set) var references = false
    private var blank = false
    private var fence: (marker: UInt8, count: Int)?
    private var html: [UInt8]?

    private static let space: UInt8 = 0x20
    private static let tab: UInt8 = 0x09
    private static let htmlBlocks: [(open: [UInt8], close: [UInt8])] = [
        ("<!--", "-->"), ("<?", "?>"), ("<![CDATA[", "]]>"),
        ("<script", "</script>"), ("<pre", "</pre>"), ("<style", "</style>"), ("<textarea", "</textarea>"),
    ].map { (Array($0.0.utf8), Array($0.1.utf8)) }

    mutating func advance(_ bytes: UnsafeBufferPointer<UInt8>) {
        var start = offset
        var index = offset
        while index < bytes.count {
            if bytes[index] == 0x0A {
                line(bytes, start, index)
                start = index + 1
            }
            index += 1
        }
        offset = start
    }

    private mutating func line(_ bytes: UnsafeBufferPointer<UInt8>, _ start: Int, _ end: Int) {
        var first = start
        while first < end, bytes[first] == Self.space, first - start < 4 {
            first += 1
        }
        let indent = first - start
        let shallow = indent <= 3 && (first == end || bytes[first] != Self.tab)
        if let open = fence {
            if shallow, closes(open, bytes, first, end) {
                fence = nil
            }
            blank = false
            return
        }
        if let close = html {
            if Self.find(close, bytes, first, end) {
                html = nil
            }
            blank = false
            return
        }
        if (start ..< end).allSatisfy({ Self.isBlank(bytes[$0]) }) {
            blank = true
            return
        }
        if blank, indent == 0, bytes[start] != Self.tab, Self.opensBlock(bytes, start, end) {
            boundaries.append(start)
        }
        blank = false
        guard shallow else { return }
        let marker = bytes[first]
        if marker == 0x60 || marker == 0x7E {
            var count = 0
            while first + count < end, bytes[first + count] == marker {
                count += 1
            }
            if count >= 3, marker == 0x7E || !(first + count ..< end).contains(where: { bytes[$0] == 0x60 }) {
                fence = (marker, count)
            }
        } else if marker == 0x3C {
            for block in Self.htmlBlocks where Self.matches(block.open, bytes, first, end) {
                if !Self.find(block.close, bytes, first + block.open.count, end) {
                    html = block.close
                }
                return
            }
            if first + 2 < end, bytes[first + 1] == 0x21, (bytes[first + 2] | 0x20) >= 0x61, (bytes[first + 2] | 0x20) <= 0x7A,
               !Self.find([0x3E], bytes, first + 2, end) {
                html = [0x3E]
            }
        } else if marker == 0x5B, Self.find([0x5D, 0x3A], bytes, first, end) {
            references = true
        }
    }

    private func closes(_ open: (marker: UInt8, count: Int), _ bytes: UnsafeBufferPointer<UInt8>, _ first: Int, _ end: Int) -> Bool {
        var index = first
        while index < end, bytes[index] == open.marker {
            index += 1
        }
        guard index - first >= open.count else { return false }
        return (index ..< end).allSatisfy { Self.isBlank(bytes[$0]) }
    }

    private static func opensBlock(_ bytes: UnsafeBufferPointer<UInt8>, _ start: Int, _ end: Int) -> Bool {
        let first = bytes[start]
        let after: (Int) -> Bool = { $0 >= end || isBlank(bytes[$0]) }
        switch first {
        case 0x2D, 0x2B, 0x2A:
            return !after(start + 1)
        case 0x3C:
            return false
        case 0x30 ... 0x39:
            var index = start
            while index < end, index - start < 9, (0x30 ... 0x39).contains(bytes[index]) {
                index += 1
            }
            return !(index < end && (bytes[index] == 0x2E || bytes[index] == 0x29) && after(index + 1))
        default:
            return true
        }
    }

    private static func isBlank(_ byte: UInt8) -> Bool {
        byte == space || byte == tab || byte == 0x0D
    }

    private static func matches(_ needle: [UInt8], _ bytes: UnsafeBufferPointer<UInt8>, _ at: Int, _ end: Int) -> Bool {
        guard end - at >= needle.count else { return false }
        for (offset, byte) in needle.enumerated() where (bytes[at + offset] | (byte >= 0x61 ? 0x20 : 0)) != byte {
            return false
        }
        return true
    }

    private static func find(_ needle: [UInt8], _ bytes: UnsafeBufferPointer<UInt8>, _ from: Int, _ end: Int) -> Bool {
        var index = from
        while index + needle.count <= end {
            if matches(needle, bytes, index, end) { return true }
            index += 1
        }
        return false
    }
}

struct MarkdownCodeBlock {
    let range: NSRange
    let mark: MarkdownCodeMark
}

enum MarkdownMetrics {
    static let codeHeader: CGFloat = 30
    static let codeTop: CGFloat = codeHeader + 1 + 10
    static let codeBottom: CGFloat = 10
    static let codeInset: CGFloat = 12
    static let codeRadius: CGFloat = 10
    static let quoteIndent: CGFloat = 12
    static let listIndent: CGFloat = 20
}

@MainActor
enum MarkdownRenderer {
    private static let storage: NSCache<NSString, MarkdownRendering> = {
        let cache = NSCache<NSString, MarkdownRendering>()
        cache.countLimit = 400
        return cache
    }()

    static func rendering(_ source: MarkdownSource, after previous: MarkdownRendering? = nil) -> MarkdownRendering {
        let revision = ThemeTokens.shared.revision
        if let previous, previous.source == source, previous.current(revision) {
            return previous
        }
        let key = "\(source.size)|\(source.secondary)|\(source.text)" as NSString
        if let cached = storage.object(forKey: key), cached.current(revision) {
            return cached
        }
        let base = previous.flatMap { $0.source.size == source.size && $0.source.secondary == source.secondary ? $0 : nil }
        var text = source.text
        let rendering = text.withUTF8 { build(source, $0, base: base, revision: revision) }
        storage.setObject(rendering, forKey: key)
        return rendering
    }

    private static func build(_ source: MarkdownSource, _ bytes: UnsafeBufferPointer<UInt8>, base: MarkdownRendering?, revision: Int) -> MarkdownRendering {
        var scan = MarkdownScan()
        var matched = 0
        if let base {
            var old = base.source.text
            matched = old.withUTF8 { old in
                if shares(bytes, old, old.count) { return old.count }
                return shares(bytes, old, base.scan.offset) ? base.scan.offset : 0
            }
            if matched >= base.scan.offset {
                scan = base.scan
            }
        }
        scan.advance(bytes)
        let starts = scan.references ? [0] : [0] + scan.boundaries
        var parts: [MarkdownPart] = []
        var context = MarkdownContext()
        for (index, start) in starts.enumerated() {
            let last = index == starts.count - 1
            let end = last ? bytes.count : starts[index + 1]
            if let base, index < base.parts.count, case let old = base.parts[index],
               old.start == start, old.end == end, end <= matched, old.last == last, old.context == context, old.current(revision) {
                parts.append(old)
            } else {
                let text = String(bytes: UnsafeBufferPointer(rebasing: bytes[start ..< end]), encoding: .utf8) ?? ""
                parts.append(MarkdownPart(
                    text: text, start: start, end: end, last: last, context: context,
                    size: source.size, secondary: source.secondary, revision: revision
                ))
            }
            context = parts[parts.count - 1].next
        }
        return MarkdownRendering(source: source, parts: parts, scan: scan, revision: revision)
    }

    private static func shares(_ bytes: UnsafeBufferPointer<UInt8>, _ old: UnsafeBufferPointer<UInt8>, _ count: Int) -> Bool {
        guard count > 0 else { return true }
        guard bytes.count >= count, old.count >= count, let lhs = bytes.baseAddress, let rhs = old.baseAddress else { return false }
        return memcmp(lhs, rhs, count) == 0
    }
}

@MainActor
private struct MarkdownStringBuilder {
    let size: CGFloat
    let secondary: Bool
    let output = NSMutableAttributedString()
    var codeBlocks: [MarkdownCodeBlock] = []
    var pending: [HighlightKey] = []
    private(set) var group: Int
    private(set) var tables: Int
    private let codeBase: Int
    private let textColor: NSColor
    private let secondaryColor: NSColor
    private let inlineCodeBackground: NSColor
    private let linkColor: NSColor

    init(size: CGFloat, secondary: Bool, context: MarkdownContext) {
        self.size = size
        self.secondary = secondary
        group = context.groups
        tables = context.tables
        codeBase = context.codes
        secondaryColor = NSColor(Theme.secondaryText)
        textColor = secondary ? secondaryColor : .labelColor
        inlineCodeBackground = NSColor(Theme.message)
        linkColor = NSColor(Theme.primary)
    }

    mutating func build(_ document: MarkdownDocument, trim: Bool) {
        for block in document.blocks {
            if block.spacing != 5 {
                group += 1
            }
            switch block.kind {
            case .paragraph(let content, let depth, let marker, let quote):
                paragraph(content, depth: depth, marker: marker, quote: quote, spacing: block.spacing)
            case .heading(let level, let content):
                heading(content, level: level, spacing: block.spacing)
            case .code(let language, let code):
                self.code(code, language: language, spacing: block.spacing)
            case .rule:
                rule(spacing: block.spacing)
            case .table(let rows):
                table(rows, spacing: block.spacing)
            }
        }
        if trim, output.length > 0, output.string.hasSuffix("\n") {
            output.deleteCharacters(in: NSRange(location: output.length - 1, length: 1))
        }
    }

    private mutating func paragraph(_ content: AttributedString, depth: Int, marker: String?, quote: Int, spacing: CGFloat) {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 3
        style.paragraphSpacingBefore = spacing
        let base = CGFloat(quote) * MarkdownMetrics.quoteIndent + CGFloat(max(depth - 1, 0)) * MarkdownMetrics.listIndent
        if depth > 0 {
            style.firstLineHeadIndent = marker == nil ? base + MarkdownMetrics.listIndent : base
            style.headIndent = base + MarkdownMetrics.listIndent
            style.tabStops = [
                NSTextTab(textAlignment: .right, location: base + 14),
                NSTextTab(textAlignment: .left, location: base + MarkdownMetrics.listIndent),
            ]
        } else {
            style.firstLineHeadIndent = base
            style.headIndent = base
        }
        let font = NSFont.systemFont(ofSize: size)
        var attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: quote > 0 ? secondaryColor : textColor,
            .paragraphStyle: style,
            .markdownGroup: group,
        ]
        if quote > 0 {
            attributes[.markdownQuote] = quote
        }
        if depth > 0, let marker {
            var markerAttributes = attributes
            markerAttributes[.foregroundColor] = secondaryColor
            markerAttributes[.font] = NSFont.monospacedDigitSystemFont(ofSize: size, weight: .regular)
            markerAttributes[.markdownMarker] = depth
            output.append(NSAttributedString(string: "\t\(marker)\t", attributes: markerAttributes))
        }
        append(content, attributes: attributes, font: font)
        output.append(NSAttributedString(string: "\n", attributes: attributes))
    }

    private mutating func heading(_ content: AttributedString, level: Int, spacing: CGFloat) {
        let style = NSMutableParagraphStyle()
        style.paragraphSpacingBefore = spacing + (level <= 2 ? 8 : 4)
        let font = NSFont.systemFont(ofSize: headingSize(level), weight: .semibold)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: textColor, .paragraphStyle: style, .markdownGroup: group,
        ]
        append(content, attributes: attributes, font: font)
        output.append(NSAttributedString(string: "\n", attributes: attributes))
    }

    private mutating func code(_ code: String, language: String?, spacing: CGFloat) {
        let mark = MarkdownCodeMark(index: codeBase + codeBlocks.count, language: language, code: code)
        let lines = (code.isEmpty ? "\u{200B}" : code).components(separatedBy: "\n")
        let font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        let key = HighlightKey(text: code, language: language, path: nil)
        let segments = code.isEmpty ? [] : SyntaxHighlighter.shared.cachedSegments(key)
        if segments == nil {
            pending.append(key)
        }
        let start = output.length
        for (index, line) in lines.enumerated() {
            let style = NSMutableParagraphStyle()
            style.lineSpacing = 2.5
            style.firstLineHeadIndent = MarkdownMetrics.codeInset
            style.headIndent = MarkdownMetrics.codeInset
            style.tailIndent = -MarkdownMetrics.codeInset
            style.lineBreakMode = .byCharWrapping
            style.paragraphSpacingBefore = index == 0 ? spacing + MarkdownMetrics.codeTop : 0
            style.paragraphSpacing = index == lines.count - 1 ? MarkdownMetrics.codeBottom : 0
            let attributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: NSColor(Theme.syntax(.plain)),
                .paragraphStyle: style,
                .markdownGroup: group,
            ]
            output.append(NSAttributedString(string: line + "\n", attributes: attributes))
        }
        let range = NSRange(location: start, length: output.length - start)
        if let segments {
            var location = start
            for segment in segments {
                let length = (segment.text as NSString).length
                let clipped = NSIntersectionRange(NSRange(location: location, length: length), range)
                if clipped.length > 0 {
                    output.addAttribute(.foregroundColor, value: NSColor(Theme.syntax(segment.kind)), range: clipped)
                    if segment.kind == .comment {
                        output.addAttribute(.font, value: Self.italic(font), range: clipped)
                    }
                }
                location += length
            }
        }
        codeBlocks.append(MarkdownCodeBlock(range: NSRange(location: start, length: max(output.length - start - 1, 1)), mark: mark))
    }

    private mutating func rule(spacing: CGFloat) {
        let style = NSMutableParagraphStyle()
        style.paragraphSpacingBefore = spacing + 4
        style.paragraphSpacing = 4
        output.append(NSAttributedString(string: "\u{200B}\n", attributes: [
            .font: NSFont.systemFont(ofSize: 2),
            .paragraphStyle: style,
            .markdownRule: true,
            .markdownGroup: group,
        ]))
    }

    private mutating func table(_ rows: [[AttributedString]], spacing: CGFloat) {
        let table = NSTextTable()
        table.numberOfColumns = max(rows.map(\.count).max() ?? 1, 1)
        table.collapsesBorders = true
        table.hidesEmptyCells = false
        table.setWidth(spacing, type: .absoluteValueType, for: .margin, edge: .minY)
        table.setWidth(1, type: .absoluteValueType, for: .margin, edge: .maxX)
        tables += 1
        let hairline = NSColor(Theme.hairline)
        let header = NSColor(Theme.message)
        for (row, cells) in rows.enumerated() {
            for (column, cell) in cells.enumerated() {
                let block = NSTextTableBlock(table: table, startingRow: row, rowSpan: 1, startingColumn: column, columnSpan: 1)
                block.setBorderColor(hairline)
                block.setWidth(1, type: .absoluteValueType, for: .border)
                block.setWidth(10, type: .absoluteValueType, for: .padding, edge: .minX)
                block.setWidth(10, type: .absoluteValueType, for: .padding, edge: .maxX)
                block.setWidth(6, type: .absoluteValueType, for: .padding, edge: .minY)
                block.setWidth(6, type: .absoluteValueType, for: .padding, edge: .maxY)
                block.setValue(320, type: .absoluteValueType, for: .maximumWidth)
                if row == 0 {
                    block.backgroundColor = header
                }
                let style = NSMutableParagraphStyle()
                style.textBlocks = [block]
                let font = NSFont.systemFont(ofSize: size - 0.5, weight: row == 0 ? .semibold : .regular)
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: font,
                    .foregroundColor: textColor,
                    .paragraphStyle: style,
                    .markdownCell: MarkdownCellMark(table: tables, row: row, column: column),
                    .markdownGroup: group,
                ]
                append(cell, attributes: attributes, font: font)
                output.append(NSAttributedString(string: "\n", attributes: attributes))
            }
        }
    }

    private func append(_ content: AttributedString, attributes: [NSAttributedString.Key: Any], font: NSFont) {
        for run in content.runs {
            var text = String(content[run.range].characters)
            if text.contains("\n") {
                text = text.replacingOccurrences(of: "\n", with: "\u{2028}")
            }
            var runAttributes = attributes
            var runFont = font
            if let intent = run[AttributeScopes.FoundationAttributes.InlinePresentationIntentAttribute.self] {
                if intent.contains(.code) {
                    runFont = NSFont.monospacedSystemFont(ofSize: max(size - 1, 10), weight: .regular)
                    runAttributes[.backgroundColor] = inlineCodeBackground
                }
                if intent.contains(.stronglyEmphasized) {
                    runFont = NSFontManager.shared.convert(runFont, toHaveTrait: .boldFontMask)
                }
                if intent.contains(.emphasized) {
                    runFont = Self.italic(runFont)
                }
                if intent.contains(.strikethrough) {
                    runAttributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
                }
            }
            if let link = run[AttributeScopes.FoundationAttributes.LinkAttribute.self] {
                runAttributes[.link] = link
                runAttributes[.foregroundColor] = linkColor
            }
            runAttributes[.font] = runFont
            output.append(NSAttributedString(string: text, attributes: runAttributes))
        }
    }

    private static func italic(_ font: NSFont) -> NSFont {
        NSFont(descriptor: font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.italic)), size: font.pointSize) ?? font
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

enum MarkdownCopy {
    static func text(_ string: NSAttributedString, ranges: [NSRange]) -> String {
        ranges.map { text(string, range: $0) }.joined(separator: "\n")
    }

    static func rich(_ string: NSAttributedString, ranges: [NSRange], type: NSAttributedString.DocumentType) -> Data? {
        let output = NSMutableAttributedString()
        for range in ranges {
            if output.length > 0 {
                output.append(NSAttributedString(string: "\n"))
            }
            output.append(string.attributedSubstring(from: range))
        }
        let whole = NSRange(location: 0, length: output.length)
        output.removeAttribute(.foregroundColor, range: whole)
        output.removeAttribute(.backgroundColor, range: whole)
        var tables: [ObjectIdentifier: NSTextTable] = [:]
        output.enumerateAttribute(.paragraphStyle, in: whole, options: []) { value, run, _ in
            guard let style = (value as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle else { return }
            style.paragraphSpacingBefore = min(style.paragraphSpacingBefore, 12)
            style.textBlocks = style.textBlocks.map { block -> NSTextBlock in
                guard let cell = block as? NSTextTableBlock else { return block }
                let table = tables[ObjectIdentifier(cell.table)] ?? plainTable(columns: cell.table.numberOfColumns)
                tables[ObjectIdentifier(cell.table)] = table
                let copy = NSTextTableBlock(
                    table: table, startingRow: cell.startingRow, rowSpan: cell.rowSpan, startingColumn: cell.startingColumn, columnSpan: cell.columnSpan
                )
                copy.setBorderColor(.gray)
                copy.setWidth(1, type: .absoluteValueType, for: .border)
                copy.setWidth(6, type: .absoluteValueType, for: .padding)
                return copy
            }
            output.addAttribute(.paragraphStyle, value: style, range: run)
        }
        return try? output.data(from: whole, documentAttributes: [.documentType: type])
    }

    private static func plainTable(columns: Int) -> NSTextTable {
        let table = NSTextTable()
        table.numberOfColumns = columns
        table.collapsesBorders = true
        table.hidesEmptyCells = false
        return table
    }

    private static func text(_ string: NSAttributedString, range: NSRange) -> String {
        let source = string.string as NSString
        var parts: [(group: Int, text: String)] = []
        var row: (table: Int, row: Int)?
        var cells: [String] = []
        var rowGroup = 0

        func flushRow() {
            guard row != nil else { return }
            parts.append((rowGroup, cells.joined(separator: "\t")))
            row = nil
            cells = []
        }

        source.enumerateSubstrings(in: range, options: [.byParagraphs, .substringNotRequired]) { _, paragraph, _, _ in
            guard paragraph.length > 0 || paragraph.location < source.length else { return }
            let location = min(paragraph.location, max(source.length - 1, 0))
            let attributes = string.attributes(at: location, effectiveRange: nil)
            let group = attributes[.markdownGroup] as? Int ?? 0
            let cell = attributes[.markdownCell] as? MarkdownCellMark
            if let current = row, cell.map({ ($0.table, $0.row) != (current.table, current.row) }) ?? true {
                flushRow()
            }
            guard attributes[.markdownRule] == nil else { return }
            let text = visible(string, paragraph)
            if let cell {
                if row == nil {
                    row = (cell.table, cell.row)
                    rowGroup = group
                }
                cells.append(text.trimmingCharacters(in: .whitespaces))
            } else {
                parts.append((group, text))
            }
        }
        flushRow()
        var result = ""
        var previous: Int?
        for part in parts {
            if let previous {
                result += previous == part.group ? "\n" : "\n\n"
            }
            result += part.text
            previous = part.group
        }
        return result
    }

    private static func visible(_ string: NSAttributedString, _ range: NSRange) -> String {
        var text = ""
        string.enumerateAttribute(.markdownMarker, in: range, options: []) { value, run, _ in
            let piece = string.attributedSubstring(from: run).string
            guard let depth = value as? Int else {
                text += piece
                return
            }
            let marker = piece.trimmingCharacters(in: .whitespaces)
            if !marker.isEmpty {
                text += String(repeating: "\t", count: max(depth - 1, 0)) + marker + " "
            }
        }
        return text.replacingOccurrences(of: "\u{2028}", with: "\n").replacingOccurrences(of: "\u{200B}", with: "")
    }
}

struct MarkdownText: NSViewRepresentable {
    let source: MarkdownSource

    func makeNSView(context: Context) -> MarkdownNSTextView {
        MarkdownNSTextView()
    }

    func updateNSView(_ view: MarkdownNSTextView, context: Context) {
        view.show(source)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView view: MarkdownNSTextView, context: Context) -> CGSize? {
        view.show(source)
        let width = proposal.width.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? 680
        return CGSize(width: width, height: view.height(for: width))
    }
}

@MainActor
private final class MarkdownMeasure {
    static let probes = 3

    let layout: NSLayoutManager
    let container: NSTextContainer
    private var boxes: [NSRect] = []
    private var boxWidth: CGFloat = 0
    private var measured: (width: CGFloat, height: CGFloat, offset: CGFloat)?

    init(layout: NSLayoutManager, container: NSTextContainer) {
        self.layout = layout
        self.container = container
    }

    func invalidate(codes: Int) {
        measured = nil
        if boxes.count > codes {
            boxes.removeSubrange(codes...)
        }
    }

    func measure(_ width: CGFloat, _ blocks: [MarkdownCodeBlock]) -> (height: CGFloat, offset: CGFloat) {
        if let measured, measured.width == width { return (measured.height, measured.offset) }
        if container.size.width != width {
            container.size = NSSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        }
        layout.ensureLayout(for: container)
        let boxes = rawBoxes(blocks)
        let offset = max(0, -(boxes.first?.minY ?? 0))
        let bottom = max(layout.usedRect(for: container).maxY, boxes.last?.maxY ?? 0)
        let height = ceil(bottom + offset)
        measured = (width, height, offset)
        return (height, offset)
    }

    func rawBoxes(_ blocks: [MarkdownCodeBlock]) -> [NSRect] {
        let width = container.size.width
        if width != boxWidth {
            boxes = []
            boxWidth = width
        }
        if boxes.count > blocks.count {
            boxes.removeSubrange(blocks.count...)
        }
        while boxes.count < blocks.count {
            let lines = lineBounds(blocks[boxes.count].range)
            boxes.append(lines.isNull ? .null : NSRect(
                x: 0, y: lines.minY - MarkdownMetrics.codeTop,
                width: width, height: lines.height + MarkdownMetrics.codeTop + MarkdownMetrics.codeBottom
            ))
        }
        return boxes.filter { !$0.isNull }
    }

    func lineBounds(_ range: NSRange) -> NSRect {
        let glyphs = layout.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        var result = NSRect.null
        layout.enumerateLineFragments(forGlyphRange: glyphs) { _, used, _, _, _ in
            result = result.union(used)
        }
        return result
    }
}

final class MarkdownNSTextView: NSTextView {
    private(set) var rendering: MarkdownRendering?
    private var offset: CGFloat = 0
    private var headers: [NSHostingView<CodeBlockHeader>] = []
    private let main: MarkdownMeasure
    private var probes: [MarkdownMeasure] = []
    private var framed = false
    private var highlighting = false

    init() {
        let storage = NSTextStorage()
        let layout = MarkdownLayoutManager()
        layout.allowsNonContiguousLayout = false
        layout.backgroundLayoutEnabled = false
        storage.addLayoutManager(layout)
        let container = NSTextContainer(size: NSSize(width: 600, height: CGFloat.greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        container.widthTracksTextView = true
        layout.addTextContainer(container)
        main = MarkdownMeasure(layout: layout, container: container)
        super.init(frame: NSRect(x: 0, y: 0, width: 600, height: 20), textContainer: container)
        isEditable = false
        isSelectable = true
        isRichText = true
        importsGraphics = false
        drawsBackground = false
        textContainerInset = .zero
        isVerticallyResizable = false
        isHorizontallyResizable = false
        usesFontPanel = false
        allowsUndo = false
        linkTextAttributes = [.foregroundColor: NSColor(Theme.primary), .cursor: NSCursor.pointingHand]
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var textContainerOrigin: NSPoint {
        NSPoint(x: 0, y: offset)
    }

    func show(_ source: MarkdownSource) {
        show(MarkdownRenderer.rendering(source, after: rendering))
    }

    func show(_ next: MarkdownRendering) {
        guard next !== rendering, let textStorage else { return }
        let previous = rendering
        rendering = next
        var shared = 0
        var location = 0
        var codes = 0
        if let previous {
            let limit = min(previous.parts.count, next.parts.count)
            while shared < limit, previous.parts[shared] === next.parts[shared] {
                location += next.parts[shared].string.length
                codes += next.parts[shared].codeBlocks.count
                shared += 1
            }
        }
        let top = lineTop(location)
        let replacement = NSMutableAttributedString()
        for part in next.parts[shared...] {
            replacement.append(part.string)
        }
        textStorage.replaceCharacters(in: NSRange(location: location, length: textStorage.length - location), with: replacement)
        main.invalidate(codes: codes)
        for probe in probes {
            probe.invalidate(codes: codes)
        }
        syncHeaders(from: codes)
        needsLayout = true
        setNeedsDisplay(NSRect(x: 0, y: top, width: bounds.width, height: max(bounds.height - top, 0)))
        highlightPending()
    }

    func height(for width: CGFloat) -> CGFloat {
        let blocks = rendering?.codeBlocks ?? []
        guard !framed || width == main.container.size.width else {
            return probe(width).measure(width, blocks).height
        }
        let (height, next) = main.measure(width, blocks)
        if next != offset {
            offset = next
            needsDisplay = true
        }
        (layoutManager as? MarkdownLayoutManager)?.containerOrigin = NSPoint(x: 0, y: offset)
        return height
    }

    private func probe(_ width: CGFloat) -> MarkdownMeasure {
        if let index = probes.firstIndex(where: { $0.container.size.width == width }) {
            let probe = probes.remove(at: index)
            probes.insert(probe, at: 0)
            return probe
        }
        if probes.count >= MarkdownMeasure.probes {
            textStorage?.removeLayoutManager(probes.removeLast().layout)
        }
        let layout = NSLayoutManager()
        layout.allowsNonContiguousLayout = false
        layout.backgroundLayoutEnabled = false
        textStorage?.addLayoutManager(layout)
        let container = NSTextContainer(size: NSSize(width: width, height: CGFloat.greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        layout.addTextContainer(container)
        let probe = MarkdownMeasure(layout: layout, container: container)
        probes.insert(probe, at: 0)
        return probe
    }

    override func setFrameSize(_ newSize: NSSize) {
        let old = frame.size
        super.setFrameSize(newSize)
        if window != nil {
            framed = true
        }
        if newSize.width != old.width {
            _ = height(for: newSize.width)
            needsLayout = true
        } else if newSize.height > old.height {
            setNeedsDisplay(NSRect(x: 0, y: old.height, width: newSize.width, height: newSize.height - old.height))
        }
    }

    override func layout() {
        super.layout()
        let boxes = codeBoxes()
        for (index, header) in headers.enumerated() {
            guard index < boxes.count else { break }
            let frame = NSRect(x: boxes[index].minX, y: boxes[index].minY, width: boxes[index].width, height: MarkdownMetrics.codeHeader)
            if header.frame != frame {
                header.frame = frame
            }
        }
    }

    override func drawBackground(in rect: NSRect) {
        super.drawBackground(in: rect)
        guard let layoutManager, let textContainer, let textStorage else { return }
        let hairline = NSColor(Theme.hairline)
        let code = NSColor(Theme.code)
        for box in codeBoxes() where box.intersects(rect) {
            let path = NSBezierPath(roundedRect: box.insetBy(dx: 0.5, dy: 0.5), xRadius: MarkdownMetrics.codeRadius, yRadius: MarkdownMetrics.codeRadius)
            code.setFill()
            path.fill()
            hairline.setStroke()
            path.lineWidth = 1
            path.stroke()
            hairline.setFill()
            NSRect(x: box.minX, y: box.minY + MarkdownMetrics.codeHeader, width: box.width, height: 1).fill()
        }
        let whole = NSRange(location: 0, length: textStorage.length)
        let origin = textContainerOrigin
        let glyphs = layoutManager.glyphRange(forBoundingRect: rect.offsetBy(dx: -origin.x, dy: -origin.y), in: textContainer)
        let visible = layoutManager.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
        NSColor(Theme.input).setFill()
        var drawn = NSRange(location: NSNotFound, length: 0)
        textStorage.enumerateAttribute(.markdownQuote, in: visible, options: .longestEffectiveRangeNotRequired) { value, range, _ in
            guard let depth = value as? Int, !NSLocationInRange(range.location, drawn) else { return }
            var full = range
            _ = textStorage.attribute(.markdownQuote, at: range.location, longestEffectiveRange: &full, in: whole)
            drawn = full
            let lines = self.main.lineBounds(full)
            guard !lines.isNull else { return }
            for level in 0 ..< depth {
                let bar = NSRect(x: origin.x + CGFloat(level) * MarkdownMetrics.quoteIndent, y: lines.minY + origin.y, width: 2.5, height: lines.height)
                NSBezierPath(roundedRect: bar, xRadius: 1.25, yRadius: 1.25).fill()
            }
        }
        hairline.setFill()
        textStorage.enumerateAttribute(.markdownRule, in: visible, options: .longestEffectiveRangeNotRequired) { value, range, _ in
            guard value != nil else { return }
            let glyphs = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            guard glyphs.length > 0 else { return }
            let used = layoutManager.lineFragmentUsedRect(forGlyphAt: glyphs.location, effectiveRange: nil)
            NSRect(x: origin.x, y: origin.y + used.midY, width: self.bounds.width, height: 1).fill()
        }
    }

    override var writablePasteboardTypes: [NSPasteboard.PasteboardType] {
        [.string, .rtf, .html]
    }

    override func writeSelection(to pboard: NSPasteboard, type: NSPasteboard.PasteboardType) -> Bool {
        guard let textStorage else { return false }
        let ranges = selectedRanges.map(\.rangeValue).filter { $0.length > 0 }
        guard !ranges.isEmpty else { return false }
        switch type {
        case .string:
            return pboard.setString(MarkdownCopy.text(textStorage, ranges: ranges), forType: .string)
        case .rtf:
            return MarkdownCopy.rich(textStorage, ranges: ranges, type: .rtf).map { pboard.setData($0, forType: .rtf) } ?? false
        case .html:
            return MarkdownCopy.rich(textStorage, ranges: ranges, type: .html).map { pboard.setData($0, forType: .html) } ?? false
        default:
            return super.writeSelection(to: pboard, type: type)
        }
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned {
            setSelectedRange(NSRange(location: selectedRange().location, length: 0))
        }
        return resigned
    }

    private func lineTop(_ location: Int) -> CGFloat {
        guard location > 0, let layoutManager else { return 0 }
        let glyph = layoutManager.glyphIndexForCharacter(at: location - 1)
        return max(layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil).minY + textContainerOrigin.y, 0)
    }

    private func codeBoxes() -> [NSRect] {
        let origin = textContainerOrigin
        return main.rawBoxes(rendering?.codeBlocks ?? []).map { $0.offsetBy(dx: origin.x, dy: origin.y) }
    }

    private func syncHeaders(from first: Int) {
        let blocks = rendering?.codeBlocks ?? []
        while headers.count > blocks.count {
            headers.removeLast().removeFromSuperview()
        }
        for index in min(first, headers.count) ..< blocks.count {
            let header = CodeBlockHeader(language: blocks[index].mark.language, code: blocks[index].mark.code)
            if index < headers.count {
                if headers[index].rootView != header {
                    headers[index].rootView = header
                }
            } else {
                let view = NSHostingView(rootView: header)
                view.sizingOptions = []
                addSubview(view)
                headers.append(view)
            }
        }
    }

    private func highlightPending() {
        guard let rendering, !rendering.pending.isEmpty, !highlighting else { return }
        highlighting = true
        let keys = rendering.pending
        Task { [weak self] in
            for key in keys {
                _ = await SyntaxHighlighter.shared.segments(key)
            }
            guard let self else { return }
            highlighting = false
            if let current = self.rendering {
                show(MarkdownRenderer.rendering(current.source, after: current))
            }
        }
    }
}

struct CodeBlockHeader: View, Equatable {
    let language: String?
    let code: String

    var body: some View {
        HStack(spacing: 6) {
            Text(language?.isEmpty == false ? language ?? "" : "text")
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.secondaryText)
            Spacer(minLength: 8)
            CopyButton(text: code, size: 12)
        }
        .padding(.leading, 12)
        .padding(.trailing, 4)
        .frame(height: MarkdownMetrics.codeHeader)
    }
}
