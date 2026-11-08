import AppKit

@MainActor
enum Screen {
    static func composer(in window: NSWindow) -> ComposerNSTextView? {
        views(of: ComposerNSTextView.self, in: window).first { onScreen($0, in: window) }
    }

    static func composerFocused(in window: NSWindow) -> Bool {
        guard let composer = composer(in: window) else { return false }
        return window.firstResponder === composer
    }

    static func searchField(in window: NSWindow) -> NSTextField? {
        views(of: NSTextField.self, in: window).first { $0.placeholderString == "Search" && onScreen($0, in: window) }
    }

    static func searchText(in window: NSWindow) -> String {
        guard let field = searchField(in: window) else { return "" }
        return field.currentEditor()?.string ?? field.stringValue
    }

    static func responder(in window: NSWindow) -> String {
        guard let responder = window.firstResponder else { return "nil" }
        if let editor = responder as? NSTextView, editor.isFieldEditor, let field = editor.delegate as? NSTextField {
            return "field editor of “\(field.placeholderString ?? "?")”"
        }
        return "\(type(of: responder))"
    }

    static func bubbleShown(_ text: String, in window: NSWindow, probe: RenderProbe) -> Bool {
        guard let frame = probe.bubbles[text], let area = timelineArea(in: window) else { return false }
        return frame.intersects(area)
    }

    static func describeBubble(_ text: String, in window: NSWindow, probe: RenderProbe) -> String {
        let area = timelineArea(in: window).map { "\(Int($0.minX)),\(Int($0.minY)) \(Int($0.width))×\(Int($0.height))" } ?? "none"
        let frame = probe.bubbles[text].map { "\(Int($0.minX)),\(Int($0.minY)) \(Int($0.width))×\(Int($0.height))" } ?? "not drawn"
        return "bubble \(frame), timeline area \(area)"
    }

    private static func timelineArea(in window: NSWindow) -> CGRect? {
        guard let composer = composer(in: window), let content = window.contentView else { return nil }
        let anchor = composer.enclosingScrollView ?? composer
        let column = anchor.convert(anchor.bounds, to: content)
        let composerTop = content.isFlipped ? column.minY : content.bounds.height - column.maxY
        return CGRect(x: column.minX - 120, y: 52, width: column.width + 240, height: max(composerTop - 52, 0))
    }

    private static func onScreen(_ view: NSView, in window: NSWindow) -> Bool {
        guard view.window === window, !view.isHiddenOrHasHiddenAncestor, !view.visibleRect.isEmpty, let content = window.contentView else { return false }
        return view.convert(view.bounds, to: nil).intersects(content.frame)
    }

    private static func views<T: NSView>(of type: T.Type, in window: NSWindow) -> [T] {
        guard let root = window.contentView else { return [] }
        var found: [T] = []
        var stack: [NSView] = [root]
        while let view = stack.popLast() {
            if let match = view as? T {
                found.append(match)
            }
            stack.append(contentsOf: view.subviews)
        }
        return found
    }
}
