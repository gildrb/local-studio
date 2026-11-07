import AppKit
import CoreText
import LocalStudioKit

struct TerminalFontSet {
    let regular: CTFont
    let bold: CTFont
    let italic: CTFont
    let boldItalic: CTFont
    let scale: CGFloat
    let cellWidth: CGFloat
    let cellHeight: CGFloat
    let baseline: CGFloat
    let lineWidth: CGFloat

    init(name: String, size: CGFloat, scale: CGFloat) {
        let base = (name.isEmpty ? nil : NSFont(name: name, size: size)) ?? NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
        let manager = NSFontManager.shared
        regular = base as CTFont
        bold = manager.convert(base, toHaveTrait: .boldFontMask) as CTFont
        italic = manager.convert(base, toHaveTrait: .italicFontMask) as CTFont
        boldItalic = manager.convert(manager.convert(base, toHaveTrait: .boldFontMask), toHaveTrait: .italicFontMask) as CTFont
        self.scale = scale
        var character = UniChar(77)
        var glyph = CGGlyph(0)
        CTFontGetGlyphsForCharacters(regular, &character, &glyph, 1)
        var advance = CGSize.zero
        CTFontGetAdvancesForGlyphs(regular, .horizontal, &glyph, &advance, 1)
        let ascent = CTFontGetAscent(regular)
        let descent = CTFontGetDescent(regular)
        let leading = CTFontGetLeading(regular)
        cellWidth = max(1, (advance.width * scale).rounded(.up)) / scale
        cellHeight = max(1, ((ascent + descent + leading) * scale).rounded(.up)) / scale
        baseline = (((cellHeight - ascent - descent) / 2 + ascent) * scale).rounded() / scale
        lineWidth = max(1, scale.rounded()) / scale
    }

    var cellWidthPixels: UInt32 { UInt32((cellWidth * scale).rounded()) }
    var cellHeightPixels: UInt32 { UInt32((cellHeight * scale).rounded()) }

    func font(bold isBold: Bool, italic isItalic: Bool) -> CTFont {
        switch (isBold, isItalic) {
        case (false, false): regular
        case (true, false): bold
        case (false, true): italic
        case (true, true): boldItalic
        }
    }
}

struct TerminalPalette {
    let background: CGColor
    let foreground: CGColor
    let cursor: CGColor
    let selection: CGColor
    let indicator: CGColor
    private let colors: [CGColor]

    init(_ palette: ThemePalette) {
        func color(_ value: RGBA) -> CGColor {
            CGColor(srgbRed: value.red, green: value.green, blue: value.blue, alpha: value.alpha)
        }
        background = color(palette[.terminal])
        foreground = color(palette[.terminalText])
        cursor = color(palette[.terminalCursor])
        selection = color(palette[.terminalSelection])
        indicator = color(palette[.terminalText]).copy(alpha: 0.35) ?? color(palette[.terminalText])
        let levels: [CGFloat] = [0, 95, 135, 175, 215, 255]
        var table = ThemeToken.ansi.map { color(palette[$0]) }
        for index in 0..<216 {
            table.append(CGColor(srgbRed: levels[index / 36] / 255, green: levels[(index / 6) % 6] / 255, blue: levels[index % 6] / 255, alpha: 1))
        }
        for index in 0..<24 {
            let level = CGFloat(8 + index * 10) / 255
            table.append(CGColor(srgbRed: level, green: level, blue: level, alpha: 1))
        }
        colors = table
    }

    func resolve(_ color: TerminalColor, fallback: CGColor) -> CGColor {
        switch color {
        case .default:
            fallback
        case .palette(let index):
            colors[Int(index)]
        case .rgb(let red, let green, let blue):
            CGColor(srgbRed: CGFloat(red) / 255, green: CGFloat(green) / 255, blue: CGFloat(blue) / 255, alpha: 1)
        }
    }

    func colors(for style: TerminalStyle) -> (foreground: CGColor, background: CGColor?) {
        var foreground = resolve(style.foreground, fallback: self.foreground)
        var background: CGColor? = style.background == .default ? nil : resolve(style.background, fallback: self.background)
        if style.inverse {
            let swapped = foreground
            foreground = background ?? self.background
            background = swapped
        }
        if style.faint {
            foreground = foreground.copy(alpha: foreground.alpha * 0.5) ?? foreground
        }
        return (foreground, background)
    }
}

struct TerminalGlyphRun {
    let font: CTFont
    let glyphs: [CGGlyph]
    let positions: [CGPoint]
}

@MainActor
final class TerminalShaper {
    private struct Key: Hashable {
        let text: String
        let cells: UInt16
        let wide: Bool
        let bold: Bool
        let italic: Bool
    }

    private static let limit = 4096
    private var cache: [Key: [TerminalGlyphRun]] = [:]

    func reset() {
        cache.removeAll()
    }

    func shape(_ run: TerminalRun, fonts: TerminalFontSet) -> [TerminalGlyphRun] {
        let key = Key(text: run.text, cells: run.cells, wide: run.wide, bold: run.style.bold, italic: run.style.italic)
        if let cached = cache[key] { return cached }
        if cache.count >= Self.limit {
            cache.removeAll(keepingCapacity: true)
        }
        let shaped = Self.layout(run, font: fonts.font(bold: run.style.bold, italic: run.style.italic), cellWidth: fonts.cellWidth)
        cache[key] = shaped
        return shaped
    }

    private static func layout(_ run: TerminalRun, font: CTFont, cellWidth: CGFloat) -> [TerminalGlyphRun] {
        let width = run.wide ? 2 : 1
        let scalars = run.text.unicodeScalars
        let perScalar = scalars.count * width == Int(run.cells)
        var cells: [Int] = []
        cells.reserveCapacity(run.text.utf16.count)
        for (index, scalar) in scalars.enumerated() {
            let cell = perScalar ? index * width : 0
            for _ in 0..<scalar.utf16.count {
                cells.append(cell)
            }
        }
        let attributed = NSAttributedString(string: run.text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
        let line = CTLineCreateWithAttributedString(attributed)
        let glyphRuns = (CTLineGetGlyphRuns(line) as NSArray).map { $0 as AnyObject }
        var result: [TerminalGlyphRun] = []
        for object in glyphRuns {
            let glyphRun = unsafeDowncast(object, to: CTRun.self)
            let count = CTRunGetGlyphCount(glyphRun)
            guard count > 0 else { continue }
            var glyphs = [CGGlyph](repeating: 0, count: count)
            CTRunGetGlyphs(glyphRun, CFRange(location: 0, length: 0), &glyphs)
            var indices = [CFIndex](repeating: 0, count: count)
            CTRunGetStringIndices(glyphRun, CFRange(location: 0, length: 0), &indices)
            let attributes = CTRunGetAttributes(glyphRun) as NSDictionary
            let runFont = (attributes[kCTFontAttributeName as String] as? NSFont).map { $0 as CTFont } ?? font
            let positions = indices.map { index in
                let cell = cells.indices.contains(index) ? cells[index] : 0
                return CGPoint(x: CGFloat(cell) * cellWidth, y: 0)
            }
            result.append(TerminalGlyphRun(font: runFont, glyphs: glyphs, positions: positions))
        }
        return result
    }
}
