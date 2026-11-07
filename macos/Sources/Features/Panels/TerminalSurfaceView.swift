import AppKit
import CoreText
import LocalStudioKit

@MainActor
final class TerminalSurfaceView: NSView, @preconcurrency NSTextInputClient, NSMenuItemValidation {
    private static let blinkInterval: TimeInterval = 0.6
    private static let modifierKeys: [UInt16: NSEvent.ModifierFlags] = [
        0x38: .shift, 0x3C: .shift, 0x3B: .control, 0x3E: .control,
        0x3A: .option, 0x3D: .option, 0x37: .command, 0x36: .command, 0x39: .capsLock,
    ]

    var onFocus: (() -> Void)?
    var blinkEnabled = true {
        didSet { updateBlink() }
    }

    private(set) var session: TerminalSession?
    private var fonts: TerminalFontSet
    private var fontName = ""
    private var fontSize: CGFloat = 12
    private var palette: TerminalPalette
    private let shaper = TerminalShaper()
    private var lines: [[[TerminalGlyphRun]]?] = []
    private var focused = false
    private var blinkVisible = true
    private var blinkTimer: Timer?
    private var keyTexts: [String]?
    private var marked = NSMutableAttributedString()
    private var scrollRemainder: CGFloat = 0
    private var observers: [NSObjectProtocol] = []

    init(palette: ThemePalette, fontName: String, fontSize: CGFloat) {
        self.palette = TerminalPalette(palette)
        self.fontName = fontName
        self.fontSize = fontSize
        fonts = TerminalFontSet(name: fontName, size: fontSize, scale: NSScreen.main?.backingScaleFactor ?? 2)
        super.init(frame: NSRect(x: 0, y: 0, width: 480, height: 240))
        wantsLayer = true
        layerContentsRedrawPolicy = .onSetNeedsDisplay
        setAccessibilityRole(.textArea)
        setAccessibilityLabel("Terminal")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    func attach(_ session: TerminalSession) {
        self.session = session
        lines = Array(repeating: nil, count: session.grid.rows.count)
        session.attach(self) { [weak self] damage in
            self?.apply(damage)
        }
        needsDisplay = true
        resizeGrid()
    }

    func detach() {
        session?.detach(self)
        session = nil
        stopBlink()
    }

    func setFont(name: String, size: CGFloat) {
        guard name != fontName || size != fontSize else { return }
        fontName = name
        fontSize = size
        rebuildFonts()
    }

    func setPalette(_ palette: ThemePalette) {
        self.palette = TerminalPalette(palette)
        needsDisplay = true
    }

    private func rebuildFonts() {
        fonts = TerminalFontSet(name: fontName, size: fontSize, scale: window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2)
        shaper.reset()
        lines = Array(repeating: nil, count: lines.count)
        needsDisplay = true
        resizeGrid()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        if let scale = window?.backingScaleFactor, scale != fonts.scale {
            rebuildFonts()
        }
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
        observers = []
        guard let window else {
            stopBlink()
            return
        }
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.focusChanged() }
            })
        }
        if window.backingScaleFactor != fonts.scale {
            rebuildFonts()
        }
        focusChanged()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        resizeGrid()
    }

    private func resizeGrid() {
        guard let session, bounds.width > 0, bounds.height > 0 else { return }
        let columns = Int((bounds.width / fonts.cellWidth).rounded(.down))
        let rows = Int((bounds.height / fonts.cellHeight).rounded(.down))
        session.resize(columns: columns, rows: rows, cellWidth: fonts.cellWidthPixels, cellHeight: fonts.cellHeightPixels)
    }

    private func apply(_ damage: TerminalDamage) {
        guard let session else { return }
        let grid = session.grid
        if damage.full || lines.count != grid.rows.count {
            lines = Array(repeating: nil, count: grid.rows.count)
            needsDisplay = true
        } else {
            for row in damage.rows {
                lines[row] = nil
                setNeedsDisplay(rowRect(row))
            }
            if damage.previousCursor != grid.cursor {
                setNeedsDisplay(rowRect(Int(damage.previousCursor.row)))
                setNeedsDisplay(rowRect(Int(grid.cursor.row)))
            }
        }
        if damage.previousCursor.column != grid.cursor.column || damage.previousCursor.row != grid.cursor.row {
            blinkVisible = true
        }
        updateBlink()
    }

    private func rowRect(_ row: Int) -> NSRect {
        NSRect(x: 0, y: CGFloat(row) * fonts.cellHeight, width: bounds.width, height: fonts.cellHeight)
    }

    private func cursorRect(_ cursor: TerminalCursor) -> NSRect {
        NSRect(
            x: CGFloat(cursor.column) * fonts.cellWidth,
            y: CGFloat(cursor.row) * fonts.cellHeight,
            width: fonts.cellWidth * (cursor.wide ? 2 : 1),
            height: fonts.cellHeight
        )
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        let dirtyRect = dirtyRect.intersection(bounds)
        guard !dirtyRect.isEmpty else { return }
        context.saveGState()
        defer { context.restoreGState() }
        context.clip(to: dirtyRect)
        context.setFillColor(palette.background)
        context.fill(dirtyRect)
        guard let session else { return }
        let grid = session.grid
        if lines.count != grid.rows.count {
            lines = Array(repeating: nil, count: grid.rows.count)
        }
        let first = max(0, Int((dirtyRect.minY / fonts.cellHeight).rounded(.down)))
        let last = min(grid.rows.count - 1, Int((dirtyRect.maxY / fonts.cellHeight).rounded(.up)) - 1)
        if first <= last {
            for index in first...last {
                drawRow(index, grid: grid, in: context)
            }
        }
        drawCursor(grid, in: context)
        drawIndicator(grid, in: context)
        drawMarkedText(grid)
    }

    private func glyphs(_ index: Int, row: TerminalRow) -> [[TerminalGlyphRun]] {
        if let cached = lines[index] {
            return cached
        }
        let shaped = row.runs.map { run in
            shaper.shape(run, fonts: fonts).map { piece in
                TerminalGlyphRun(
                    font: piece.font,
                    glyphs: piece.glyphs,
                    positions: piece.positions.map { CGPoint(x: $0.x + CGFloat(run.column) * fonts.cellWidth, y: 0) }
                )
            }
        }
        lines[index] = shaped
        return shaped
    }

    private func drawRow(_ index: Int, grid: TerminalGrid, in context: CGContext, foreground override: CGColor? = nil) {
        let row = grid.rows[index]
        let top = CGFloat(index) * fonts.cellHeight
        if override == nil {
            for run in row.runs {
                guard let background = palette.colors(for: run.style).background else { continue }
                context.setFillColor(background)
                context.fill(CGRect(x: CGFloat(run.column) * fonts.cellWidth, y: top, width: CGFloat(run.cells) * fonts.cellWidth, height: fonts.cellHeight))
            }
            if let selection = row.selection {
                context.setFillColor(palette.selection)
                let width = CGFloat(Int(selection.end) - Int(selection.start) + 1) * fonts.cellWidth
                context.fill(CGRect(x: CGFloat(selection.start) * fonts.cellWidth, y: top, width: width, height: fonts.cellHeight))
            }
        }
        let shaped = glyphs(index, row: row)
        context.saveGState()
        context.textMatrix = .identity
        context.translateBy(x: 0, y: top + fonts.baseline)
        context.scaleBy(x: 1, y: -1)
        for (run, pieces) in zip(row.runs, shaped) where !run.style.invisible {
            context.setFillColor(override ?? palette.colors(for: run.style).foreground)
            for piece in pieces {
                CTFontDrawGlyphs(piece.font, piece.glyphs, piece.positions, piece.glyphs.count, context)
            }
        }
        context.restoreGState()
        if override == nil {
            drawDecorations(row, top: top, in: context)
        }
    }

    private func drawDecorations(_ row: TerminalRow, top: CGFloat, in context: CGContext) {
        for run in row.runs where run.style.underline != .none || run.style.strikethrough || run.style.overline {
            let colors = palette.colors(for: run.style)
            let x = CGFloat(run.column) * fonts.cellWidth
            let width = CGFloat(run.cells) * fonts.cellWidth
            let thickness = fonts.lineWidth
            if run.style.underline != .none {
                context.setFillColor(palette.resolve(run.style.underlineColor, fallback: colors.foreground))
                let y = top + fonts.baseline + thickness * 2
                context.fill(CGRect(x: x, y: y, width: width, height: thickness))
                if run.style.underline == .double {
                    context.fill(CGRect(x: x, y: y + thickness * 2, width: width, height: thickness))
                }
            }
            context.setFillColor(colors.foreground)
            if run.style.strikethrough {
                context.fill(CGRect(x: x, y: top + fonts.cellHeight / 2, width: width, height: thickness))
            }
            if run.style.overline {
                context.fill(CGRect(x: x, y: top, width: width, height: thickness))
            }
        }
    }

    private func drawCursor(_ grid: TerminalGrid, in context: CGContext) {
        let cursor = grid.cursor
        guard cursor.visible, marked.length == 0, Int(cursor.row) < grid.rows.count else { return }
        let rect = cursorRect(cursor)
        let active = focused && (window?.isKeyWindow ?? false)
        let shape: TerminalCursorShape = active ? cursor.shape : .blockHollow
        if active && !blinkVisible && blinking { return }
        context.setFillColor(palette.cursor)
        context.setStrokeColor(palette.cursor)
        let line = fonts.lineWidth
        switch shape {
        case .block:
            context.fill(rect)
            context.saveGState()
            context.clip(to: rect)
            drawRow(Int(cursor.row), grid: grid, in: context, foreground: palette.background)
            context.restoreGState()
        case .blockHollow:
            context.setLineWidth(line)
            context.stroke(rect.insetBy(dx: line / 2, dy: line / 2))
        case .bar:
            context.fill(CGRect(x: rect.minX, y: rect.minY, width: line * 2, height: rect.height))
        case .underline:
            context.fill(CGRect(x: rect.minX, y: rect.maxY - line * 2, width: rect.width, height: line * 2))
        }
    }

    private func drawIndicator(_ grid: TerminalGrid, in context: CGContext) {
        let total = grid.scrollbackLength + UInt64(grid.rows.count)
        guard grid.viewportOffset < grid.scrollbackLength, total > 0, bounds.height > 0 else { return }
        let height = max(12, bounds.height * CGFloat(grid.rows.count) / CGFloat(total))
        let y = (bounds.height - height) * CGFloat(grid.viewportOffset) / CGFloat(max(grid.scrollbackLength, 1))
        context.setFillColor(palette.indicator)
        let rect = CGRect(x: bounds.width - 5, y: y, width: 3, height: height)
        context.addPath(CGPath(roundedRect: rect, cornerWidth: 1.5, cornerHeight: 1.5, transform: nil))
        context.fillPath()
    }

    private func drawMarkedText(_ grid: TerminalGrid) {
        guard marked.length > 0 else { return }
        let cursor = grid.cursor
        let origin = CGPoint(x: CGFloat(cursor.column) * fonts.cellWidth, y: CGFloat(cursor.row) * fonts.cellHeight)
        let text = NSMutableAttributedString(attributedString: marked)
        let range = NSRange(location: 0, length: text.length)
        text.addAttributes([
            .font: fonts.regular as NSFont,
            .foregroundColor: NSColor(cgColor: palette.foreground) ?? .textColor,
            .backgroundColor: NSColor(cgColor: palette.background) ?? .textBackgroundColor,
            .underlineStyle: NSUnderlineStyle.single.rawValue,
        ], range: range)
        text.draw(at: origin)
    }

    private var blinking: Bool {
        guard blinkEnabled, let session, session.grid.cursor.blinking, session.grid.cursor.visible else { return false }
        return !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }

    private func updateBlink() {
        let active = focused && (window?.isKeyWindow ?? false)
        guard active, blinking else {
            stopBlink()
            return
        }
        if blinkTimer == nil {
            let timer = Timer(timeInterval: Self.blinkInterval, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.toggleBlink() }
            }
            timer.tolerance = Self.blinkInterval / 4
            RunLoop.main.add(timer, forMode: .common)
            blinkTimer = timer
        }
    }

    private func stopBlink() {
        blinkTimer?.invalidate()
        blinkTimer = nil
        if !blinkVisible, let session {
            blinkVisible = true
            setNeedsDisplay(cursorRect(session.grid.cursor))
        }
    }

    private func toggleBlink() {
        guard let session else { return }
        blinkVisible.toggle()
        setNeedsDisplay(cursorRect(session.grid.cursor))
    }

    private func focusChanged() {
        let active = focused && (window?.isKeyWindow ?? false)
        session?.focus(active)
        blinkVisible = true
        if let session {
            setNeedsDisplay(cursorRect(session.grid.cursor))
        }
        updateBlink()
    }

    override func becomeFirstResponder() -> Bool {
        focused = true
        focusChanged()
        return true
    }

    override func resignFirstResponder() -> Bool {
        focused = false
        focusChanged()
        return true
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .iBeam)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas {
            removeTrackingArea(area)
        }
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .activeInKeyWindow, .inVisibleRect], owner: self))
    }

    private func mods(_ flags: NSEvent.ModifierFlags) -> TerminalMods {
        TerminalMods(
            shift: flags.contains(.shift),
            control: flags.contains(.control),
            alt: flags.contains(.option),
            superKey: flags.contains(.command),
            capsLock: flags.contains(.capsLock)
        )
    }

    private func point(_ event: NSEvent) -> CGPoint {
        let location = convert(event.locationInWindow, from: nil)
        return CGPoint(x: location.x * fonts.scale, y: location.y * fonts.scale)
    }

    private func mouse(_ action: TerminalMouseAction, _ button: TerminalMouseButton?, _ event: NSEvent) {
        let location = point(event)
        session?.mouse(TerminalMouse(action: action, button: button, x: Double(location.x), y: Double(location.y), mods: mods(event.modifierFlags)))
    }

    private func reportsMouse(_ event: NSEvent) -> Bool {
        (session?.grid.mouseTracking ?? false) && !event.modifierFlags.contains(.shift)
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        onFocus?()
        mouse(.press, .left, event)
    }

    override func mouseDragged(with event: NSEvent) {
        mouse(.motion, .left, event)
    }

    override func mouseUp(with event: NSEvent) {
        mouse(.release, .left, event)
    }

    override func mouseMoved(with event: NSEvent) {
        guard session?.grid.mouseTracking == true else { return }
        mouse(.motion, nil, event)
    }

    override func rightMouseDown(with event: NSEvent) {
        guard reportsMouse(event) else {
            super.rightMouseDown(with: event)
            return
        }
        mouse(.press, .right, event)
    }

    override func rightMouseUp(with event: NSEvent) {
        guard reportsMouse(event) else {
            super.rightMouseUp(with: event)
            return
        }
        mouse(.release, .right, event)
    }

    override func otherMouseDown(with event: NSEvent) {
        mouse(.press, .middle, event)
    }

    override func otherMouseDragged(with event: NSEvent) {
        mouse(.motion, .middle, event)
    }

    override func otherMouseUp(with event: NSEvent) {
        mouse(.release, .middle, event)
    }

    override func scrollWheel(with event: NSEvent) {
        let delta = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY / fonts.cellHeight : event.scrollingDeltaY * 3
        scrollRemainder += delta
        let lines = scrollRemainder.rounded(.towardZero)
        guard lines != 0 else { return }
        scrollRemainder -= lines
        let location = point(event)
        session?.scroll(TerminalScroll(lines: Int32(clamping: -Int(lines)), x: Double(location.x), y: Double(location.y), mods: mods(event.modifierFlags)))
    }

    private func text(_ event: NSEvent, removing flags: NSEvent.ModifierFlags) -> String? {
        event.characters(byApplyingModifiers: event.modifierFlags.subtracting(flags))
    }

    private func sendKey(_ event: NSEvent, _ action: TerminalKeyAction, text: String?, composing: Bool) {
        let unshifted = event.characters(byApplyingModifiers: [])?.unicodeScalars.first?.value ?? 0
        session?.key(TerminalKey(action: action, code: UInt32(event.keyCode), mods: mods(event.modifierFlags), text: text, unshifted: unshifted, composing: composing))
        blinkVisible = true
    }

    override func keyDown(with event: NSEvent) {
        let action: TerminalKeyAction = event.isARepeat ? .repeat : .press
        if event.modifierFlags.contains(.option), !hasMarkedText() {
            sendKey(event, action, text: text(event, removing: [.option, .control, .command]), composing: false)
            return
        }
        let wasComposing = hasMarkedText()
        keyTexts = []
        interpretKeyEvents([event])
        let texts = keyTexts ?? []
        keyTexts = nil
        if !texts.isEmpty {
            for text in texts {
                sendKey(event, action, text: text, composing: false)
            }
        } else if wasComposing || hasMarkedText() {
            sendKey(event, action, text: nil, composing: true)
        } else {
            sendKey(event, action, text: text(event, removing: [.control, .command]), composing: false)
        }
    }

    override func keyUp(with event: NSEvent) {
        sendKey(event, .release, text: nil, composing: false)
    }

    override func flagsChanged(with event: NSEvent) {
        guard let flag = Self.modifierKeys[event.keyCode] else { return }
        sendKey(event, event.modifierFlags.contains(flag) ? .press : .release, text: nil, composing: false)
    }

    override func doCommand(by selector: Selector) {}

    @objc func copy(_ sender: Any?) {
        session?.copy(.selection)
    }

    @objc func paste(_ sender: Any?) {
        guard let text = NSPasteboard.general.string(forType: .string), !text.isEmpty else { return }
        session?.paste(text)
    }

    @objc override func selectAll(_ sender: Any?) {
        session?.select(.all)
    }

    @objc func copyRecentOutput(_ sender: Any?) {
        session?.copy(.recent(TerminalSession.recentLines))
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        switch menuItem.action {
        case #selector(copy(_:)):
            session?.grid.hasSelection ?? false
        case #selector(paste(_:)):
            NSPasteboard.general.string(forType: .string) != nil
        default:
            true
        }
    }

    override func accessibilityValue() -> Any? {
        session?.grid.lines.joined(separator: "\n")
    }

    func insertText(_ string: Any, replacementRange: NSRange) {
        let text = (string as? NSAttributedString)?.string ?? (string as? String) ?? ""
        unmarkText()
        guard !text.isEmpty else { return }
        if keyTexts != nil {
            keyTexts?.append(text)
        } else {
            session?.write(Data(text.utf8))
        }
    }

    func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
        if let attributed = string as? NSAttributedString {
            marked = NSMutableAttributedString(attributedString: attributed)
        } else {
            marked = NSMutableAttributedString(string: (string as? String) ?? "")
        }
        if let session {
            setNeedsDisplay(rowRect(Int(session.grid.cursor.row)))
        }
    }

    func unmarkText() {
        guard marked.length > 0 else { return }
        marked = NSMutableAttributedString()
        if let session {
            setNeedsDisplay(rowRect(Int(session.grid.cursor.row)))
        }
    }

    func selectedRange() -> NSRange {
        NSRange(location: NSNotFound, length: 0)
    }

    func markedRange() -> NSRange {
        marked.length > 0 ? NSRange(location: 0, length: marked.length) : NSRange(location: NSNotFound, length: 0)
    }

    func hasMarkedText() -> Bool {
        marked.length > 0
    }

    func attributedSubstring(forProposedRange range: NSRange, actualRange: NSRangePointer?) -> NSAttributedString? {
        nil
    }

    func validAttributesForMarkedText() -> [NSAttributedString.Key] {
        []
    }

    func firstRect(forCharacterRange range: NSRange, actualRange: NSRangePointer?) -> NSRect {
        guard let session, let window else { return .zero }
        let rect = convert(cursorRect(session.grid.cursor), to: nil)
        return window.convertToScreen(rect)
    }

    func characterIndex(for point: NSPoint) -> Int {
        NSNotFound
    }
}
