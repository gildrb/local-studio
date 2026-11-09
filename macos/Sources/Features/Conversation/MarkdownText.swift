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
    static let markdownPrefix = NSAttributedString.Key("LocalStudioMarkdownPrefix")
    static let markdownMarker = NSAttributedString.Key("LocalStudioMarkdownMarker")
    static let markdownCode = NSAttributedString.Key("LocalStudioMarkdownCode")
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

final class MarkdownRendering {
    let source: MarkdownSource
    let string: NSAttributedString
    let codeBlocks: [MarkdownCodeBlock]
    let pending: [HighlightKey]
    let revision: Int

    init(source: MarkdownSource, string: NSAttributedString, codeBlocks: [MarkdownCodeBlock], pending: [HighlightKey], revision: Int) {
        self.source = source
        self.string = string
        self.codeBlocks = codeBlocks
        self.pending = pending
        self.revision = revision
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

    static func rendering(_ source: MarkdownSource) -> MarkdownRendering {
        let revision = ThemeTokens.shared.revision
        let key = "\(source.size)|\(source.secondary)|\(source.text)" as NSString
        if let cached = storage.object(forKey: key), cached.revision == revision,
           !cached.pending.contains(where: SyntaxHighlighter.shared.contains) {
            return cached
        }
        var builder = MarkdownStringBuilder(size: source.size, secondary: source.secondary)
        builder.build(MarkdownCache.document(for: source.text))
        let rendering = MarkdownRendering(
            source: source, string: builder.output, codeBlocks: builder.codeBlocks, pending: builder.pending, revision: revision
        )
        storage.setObject(rendering, forKey: key)
        return rendering
    }
}

@MainActor
private struct MarkdownStringBuilder {
    let size: CGFloat
    let secondary: Bool
    let output = NSMutableAttributedString()
    var codeBlocks: [MarkdownCodeBlock] = []
    var pending: [HighlightKey] = []
    private var group = 0
    private var tables = 0
    private let textColor: NSColor
    private let secondaryColor: NSColor
    private let inlineCodeBackground: NSColor
    private let linkColor: NSColor

    init(size: CGFloat, secondary: Bool) {
        self.size = size
        self.secondary = secondary
        secondaryColor = NSColor(Theme.secondaryText)
        textColor = secondary ? secondaryColor : .labelColor
        inlineCodeBackground = NSColor(Theme.message)
        linkColor = NSColor(Theme.primary)
    }

    mutating func build(_ document: MarkdownDocument) {
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
        if output.length > 0, output.string.hasSuffix("\n") {
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
        let start = output.length
        var prefix = String(repeating: "  ", count: max(depth - 1, 0))
        if depth > 0, let marker {
            var markerAttributes = attributes
            markerAttributes[.foregroundColor] = secondaryColor
            markerAttributes[.font] = NSFont.monospacedDigitSystemFont(ofSize: size, weight: .regular)
            markerAttributes[.markdownMarker] = true
            output.append(NSAttributedString(string: "\t\(marker)\t", attributes: markerAttributes))
            prefix += marker.hasSuffix(".") ? "\(marker) " : "- "
        } else if depth > 0 {
            prefix += "  "
        }
        if quote > 0 {
            prefix = String(repeating: "> ", count: quote) + prefix
        }
        append(content, attributes: attributes, font: font)
        output.append(NSAttributedString(string: "\n", attributes: attributes))
        if !prefix.isEmpty {
            output.addAttribute(.markdownPrefix, value: prefix, range: NSRange(location: start, length: 1))
        }
    }

    private mutating func heading(_ content: AttributedString, level: Int, spacing: CGFloat) {
        let style = NSMutableParagraphStyle()
        style.paragraphSpacingBefore = spacing + (level <= 2 ? 8 : 4)
        let font = NSFont.systemFont(ofSize: headingSize(level), weight: .semibold)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: textColor, .paragraphStyle: style, .markdownGroup: group,
        ]
        let start = output.length
        append(content, attributes: attributes, font: font)
        output.append(NSAttributedString(string: "\n", attributes: attributes))
        output.addAttribute(.markdownPrefix, value: String(repeating: "#", count: level) + " ", range: NSRange(location: start, length: 1))
    }

    private mutating func code(_ code: String, language: String?, spacing: CGFloat) {
        let mark = MarkdownCodeMark(index: codeBlocks.count, language: language, code: code)
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
                .markdownCode: mark,
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
    static func text(_ string: NSAttributedString, range: NSRange) -> String {
        let source = string.string as NSString
        var fences = false
        string.enumerateAttribute(.markdownCode, in: range, options: []) { value, _, stop in
            if value == nil {
                fences = true
                stop.pointee = true
            }
        }
        var parts: [(group: Int, text: String)] = []
        var openCode: MarkdownCodeMark?
        var codeLines: [String] = []
        var codeGroup = 0
        var row: (table: Int, row: Int)?
        var cells: [String] = []
        var rowGroup = 0

        func flushCode() {
            guard let mark = openCode else { return }
            let body = codeLines.joined(separator: "\n")
            parts.append((codeGroup, fences ? "```\(mark.language ?? "")\n\(body)\n```" : body))
            openCode = nil
            codeLines = []
        }
        func flushRow() {
            guard let current = row else { return }
            var line = "| " + cells.joined(separator: " | ") + " |"
            if current.row == 0 {
                line += "\n|" + String(repeating: " --- |", count: cells.count)
            }
            parts.append((rowGroup, line))
            row = nil
            cells = []
        }

        source.enumerateSubstrings(in: range, options: [.byParagraphs, .substringNotRequired]) { _, paragraph, _, _ in
            guard paragraph.length > 0 || paragraph.location < source.length else { return }
            let location = min(paragraph.location, max(source.length - 1, 0))
            let attributes = string.attributes(at: location, effectiveRange: nil)
            let group = attributes[.markdownGroup] as? Int ?? 0
            let text = visible(string, paragraph)
            let code = attributes[.markdownCode] as? MarkdownCodeMark
            let cell = attributes[.markdownCell] as? MarkdownCellMark
            if code !== openCode {
                flushCode()
            }
            if let current = row, cell.map({ ($0.table, $0.row) != (current.table, current.row) }) ?? true {
                flushRow()
            }
            if let code {
                openCode = code
                codeGroup = group
                codeLines.append(text)
            } else if let cell {
                if row == nil {
                    row = (cell.table, cell.row)
                    rowGroup = group
                }
                cells.append(text.trimmingCharacters(in: .whitespaces))
            } else if attributes[.markdownRule] != nil {
                parts.append((group, "---"))
            } else {
                let starts = paragraph.location == 0 || source.character(at: paragraph.location - 1) == 0x0A
                let prefix = starts ? attributes[.markdownPrefix] as? String ?? "" : ""
                parts.append((group, prefix + text))
            }
        }
        flushCode()
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
            guard value == nil else { return }
            text += string.attributedSubstring(from: run).string
        }
        return text.replacingOccurrences(of: "\u{2028}", with: "\n").replacingOccurrences(of: "\u{200B}", with: "")
    }
}

struct MarkdownText: NSViewRepresentable {
    let rendering: MarkdownRendering

    func makeNSView(context: Context) -> MarkdownNSTextView {
        MarkdownNSTextView()
    }

    func updateNSView(_ view: MarkdownNSTextView, context: Context) {
        view.show(rendering)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView view: MarkdownNSTextView, context: Context) -> CGSize? {
        view.show(rendering)
        let width = proposal.width.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? 680
        return CGSize(width: width, height: view.height(for: width))
    }
}

final class MarkdownNSTextView: NSTextView {
    private(set) var rendering: MarkdownRendering?
    private var measured: (width: CGFloat, height: CGFloat)?
    private var offset: CGFloat = 0
    private var headers: [NSHostingView<CodeBlockHeader>] = []
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

    func show(_ next: MarkdownRendering) {
        guard next !== rendering else { return }
        let previous = rendering
        rendering = next
        let selection = selectedRanges
        textStorage?.setAttributedString(next.string)
        if previous?.string.length == next.string.length {
            selectedRanges = selection
        }
        measured = nil
        syncHeaders()
        needsLayout = true
        needsDisplay = true
        highlightPending()
    }

    func height(for width: CGFloat) -> CGFloat {
        if let measured, measured.width == width { return measured.height }
        guard let layoutManager, let textContainer else { return 0 }
        textContainer.size = NSSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        layoutManager.ensureLayout(for: textContainer)
        let boxes = rawCodeBoxes()
        offset = max(0, -(boxes.map(\.minY).min() ?? 0))
        (layoutManager as? MarkdownLayoutManager)?.containerOrigin = NSPoint(x: 0, y: offset)
        let bottom = max(layoutManager.usedRect(for: textContainer).maxY, boxes.map(\.maxY).max() ?? 0)
        let height = ceil(bottom + offset)
        measured = (width, height)
        return height
    }

    override func setFrameSize(_ newSize: NSSize) {
        let changed = newSize.width != frame.width
        super.setFrameSize(newSize)
        if changed {
            _ = height(for: newSize.width)
            needsLayout = true
        }
    }

    override func layout() {
        super.layout()
        let boxes = codeBoxes()
        for (index, header) in headers.enumerated() {
            guard index < boxes.count else { break }
            header.frame = NSRect(x: boxes[index].minX, y: boxes[index].minY, width: boxes[index].width, height: MarkdownMetrics.codeHeader)
        }
    }

    override func drawBackground(in rect: NSRect) {
        super.drawBackground(in: rect)
        guard let rendering, let layoutManager else { return }
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
        let string = rendering.string
        let whole = NSRange(location: 0, length: string.length)
        let origin = textContainerOrigin
        NSColor(Theme.input).setFill()
        string.enumerateAttribute(.markdownQuote, in: whole, options: []) { value, range, _ in
            guard let depth = value as? Int else { return }
            let lines = self.lineBounds(range)
            guard !lines.isNull else { return }
            for level in 0 ..< depth {
                let bar = NSRect(x: origin.x + CGFloat(level) * MarkdownMetrics.quoteIndent, y: lines.minY + origin.y, width: 2.5, height: lines.height)
                NSBezierPath(roundedRect: bar, xRadius: 1.25, yRadius: 1.25).fill()
            }
        }
        hairline.setFill()
        string.enumerateAttribute(.markdownRule, in: whole, options: []) { value, range, _ in
            guard value != nil else { return }
            let glyphs = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            guard glyphs.length > 0 else { return }
            let used = layoutManager.lineFragmentUsedRect(forGlyphAt: glyphs.location, effectiveRange: nil)
            NSRect(x: origin.x, y: origin.y + used.midY, width: self.bounds.width, height: 1).fill()
        }
    }

    override func copy(_ sender: Any?) {
        guard let textStorage else { return }
        let ranges = selectedRanges.map(\.rangeValue).filter { $0.length > 0 }
        guard !ranges.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(ranges.map { MarkdownCopy.text(textStorage, range: $0) }.joined(separator: "\n"), forType: .string)
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned {
            setSelectedRange(NSRange(location: selectedRange().location, length: 0))
        }
        return resigned
    }

    private func lineBounds(_ range: NSRange) -> NSRect {
        guard let layoutManager else { return .null }
        let glyphs = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        var result = NSRect.null
        layoutManager.enumerateLineFragments(forGlyphRange: glyphs) { _, used, _, _, _ in
            result = result.union(used)
        }
        return result
    }

    private func rawCodeBoxes() -> [NSRect] {
        guard let rendering, let textContainer else { return [] }
        return rendering.codeBlocks.compactMap { block in
            let lines = lineBounds(block.range)
            guard !lines.isNull else { return nil }
            return NSRect(
                x: 0, y: lines.minY - MarkdownMetrics.codeTop,
                width: textContainer.size.width, height: lines.height + MarkdownMetrics.codeTop + MarkdownMetrics.codeBottom
            )
        }
    }

    private func codeBoxes() -> [NSRect] {
        let origin = textContainerOrigin
        return rawCodeBoxes().map { $0.offsetBy(dx: origin.x, dy: origin.y) }
    }

    private func syncHeaders() {
        let blocks = rendering?.codeBlocks ?? []
        while headers.count > blocks.count {
            headers.removeLast().removeFromSuperview()
        }
        for (index, block) in blocks.enumerated() {
            let header = CodeBlockHeader(language: block.mark.language, code: block.mark.code)
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
                show(MarkdownRenderer.rendering(current.source))
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
