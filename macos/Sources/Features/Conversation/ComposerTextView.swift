import AppKit
import SwiftUI

enum ComposerKey {
    case enter(shift: Bool, command: Bool, option: Bool)
    case up
    case down
    case tab
    case escape
}

struct ComposerTextView: NSViewRepresentable {
    let draft: ComposerDraft
    let fontSize: CGFloat
    let focusToken: Int
    let markdownShortcuts: Bool
    let vimMode: Bool
    @Binding var height: CGFloat
    let onCaret: (String, Int) -> Void
    let onKey: (ComposerKey, Int) -> Bool
    let onImage: (Data, String) -> Void
    let onFiles: ([URL]) -> Void
    let onVimMode: (VimMode) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        let size = scrollView.contentSize
        let textView = ComposerNSTextView(frame: NSRect(origin: .zero, size: size))
        textView.minSize = NSSize(width: 0, height: size.height)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.autoresizingMask = [.width]
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.textContainer?.containerSize = NSSize(width: size.width, height: CGFloat.greatestFiniteMagnitude)
        textView.textContainer?.widthTracksTextView = true
        textView.drawsBackground = false
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.font = .systemFont(ofSize: fontSize)
        textView.textColor = .labelColor
        textView.insertionPointColor = .labelColor
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.registerForDraggedTypes([.fileURL, .png, .tiff])
        textView.setAccessibilityLabel("Message")
        textView.string = draft.text
        textView.setSelectedRange(NSRange(location: (draft.text as NSString).length, length: 0))
        textView.delegate = context.coordinator
        textView.vimEnabled = vimMode
        let coordinator = context.coordinator
        textView.vim.onMode = { [weak coordinator] mode in coordinator?.parent.onVimMode(mode) }
        scrollView.documentView = textView
        context.coordinator.textView = textView
        context.coordinator.draft = draft
        context.coordinator.focusToken = focusToken
        textView.focusOnWindow = true
        DispatchQueue.main.async {
            if let window = textView.window {
                textView.focusOnWindow = false
                window.makeFirstResponder(textView)
            }
            context.coordinator.measure()
            context.coordinator.reportCaret()
            coordinator.parent.onVimMode(textView.vim.mode)
        }
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = context.coordinator.textView else { return }
        textView.onImage = onImage
        textView.onFiles = onFiles
        textView.onKey = onKey
        textView.markdownShortcuts = markdownShortcuts
        if textView.vimEnabled != vimMode {
            textView.vimEnabled = vimMode
            let coordinator = context.coordinator
            let mode = textView.vim.mode
            DispatchQueue.main.async {
                coordinator.parent.onVimMode(mode)
            }
        }
        if textView.font?.pointSize != fontSize {
            textView.font = .systemFont(ofSize: fontSize)
        }
        if context.coordinator.draft !== draft {
            context.coordinator.draft = draft
            textView.undoManager?.removeAllActions(withTarget: textView)
            if let storage = textView.textStorage {
                textView.undoManager?.removeAllActions(withTarget: storage)
            }
        }
        if textView.string != draft.text {
            context.coordinator.updating = true
            textView.string = draft.text
            textView.setSelectedRange(NSRange(location: (draft.text as NSString).length, length: 0))
            context.coordinator.updating = false
            let coordinator = context.coordinator
            DispatchQueue.main.async {
                coordinator.measure()
                coordinator.reportCaret()
            }
        }
        if context.coordinator.focusToken != focusToken {
            context.coordinator.focusToken = focusToken
            textView.window?.makeFirstResponder(textView)
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ComposerTextView
        weak var textView: ComposerNSTextView?
        weak var draft: ComposerDraft?
        var focusToken = 0
        var updating = false

        init(_ parent: ComposerTextView) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard let textView else { return }
            parent.draft.text = textView.string
            measure()
            reportCaret()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            if !updating {
                reportCaret()
            }
        }

        func reportCaret() {
            guard let textView else { return }
            parent.onCaret(textView.string, textView.selectedRange().location)
        }

        func measure() {
            guard let textView, let container = textView.textContainer, let layout = textView.layoutManager else {
                return
            }
            layout.ensureLayout(for: container)
            let lineHeight = ceil((textView.font ?? .systemFont(ofSize: parent.fontSize)).boundingRectForFont.height)
            let measured = max(ceil(layout.usedRect(for: container).height), lineHeight)
            if measured != parent.height {
                parent.height = measured
            }
        }

        func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            let caret = textView.selectedRange().location
            switch selector {
            case #selector(NSResponder.insertNewline(_:)), #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
                let flags = NSApp.currentEvent?.modifierFlags ?? []
                let key = ComposerKey.enter(shift: flags.contains(.shift), command: flags.contains(.command), option: flags.contains(.option))
                if !parent.onKey(key, caret) {
                    textView.insertNewlineIgnoringFieldEditor(nil)
                }
                return true
            case #selector(NSResponder.moveUp(_:)):
                return parent.onKey(.up, caret)
            case #selector(NSResponder.moveDown(_:)):
                return parent.onKey(.down, caret)
            case #selector(NSResponder.insertTab(_:)):
                return parent.onKey(.tab, caret)
            case #selector(NSResponder.cancelOperation(_:)):
                return parent.onKey(.escape, caret)
            default:
                return false
            }
        }
    }
}

final class ComposerNSTextView: NSTextView {
    var onImage: ((Data, String) -> Void)?
    var onFiles: (([URL]) -> Void)?
    var onKey: ((ComposerKey, Int) -> Bool)?
    var markdownShortcuts = false
    var focusOnWindow = false
    private(set) lazy var vim = ComposerVim()
    var vimEnabled = false {
        didSet {
            if !vimEnabled {
                vim.reset()
            }
        }
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard focusOnWindow, let window else { return }
        focusOnWindow = false
        window.makeFirstResponder(self)
    }

    override func keyDown(with event: NSEvent) {
        if vimEnabled, !hasMarkedText(), let key = VimKey(event: event), vim.handle(key, in: self) {
            return
        }
        let returnKeys: Set<UInt16> = [36, 76]
        if returnKeys.contains(event.keyCode), event.modifierFlags.contains(.command), !hasMarkedText() {
            let flags = event.modifierFlags
            let key = ComposerKey.enter(shift: flags.contains(.shift), command: true, option: flags.contains(.option))
            if onKey?(key, selectedRange().location) == true {
                return
            }
        }
        super.keyDown(with: event)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard markdownShortcuts, window?.firstResponder === self, flags == .command,
              let key = event.charactersIgnoringModifiers?.lowercased() else {
            return super.performKeyEquivalent(with: event)
        }
        switch key {
        case "b": wrapSelection(in: "**")
        case "i": wrapSelection(in: "_")
        case "e": wrapSelection(in: "`")
        default: return super.performKeyEquivalent(with: event)
        }
        return true
    }

    private func wrapSelection(in marker: String) {
        let range = selectedRange()
        let selected = (string as NSString).substring(with: range)
        insertText(marker + selected + marker, replacementRange: range)
        if selected.isEmpty {
            setSelectedRange(NSRange(location: range.location + (marker as NSString).length, length: 0))
        }
    }

    override func paste(_ sender: Any?) {
        if attach(from: NSPasteboard.general) {
            return
        }
        pasteAsPlainText(sender)
    }

    override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        if attach(from: sender.draggingPasteboard) {
            return true
        }
        return super.performDragOperation(sender)
    }

    private func attach(from pasteboard: NSPasteboard) -> Bool {
        let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL], !urls.isEmpty {
            onFiles?(urls)
            return true
        }
        if let png = pasteboard.data(forType: .png) {
            onImage?(png, "image/png")
            return true
        }
        if let tiff = pasteboard.data(forType: .tiff), let image = NSBitmapImageRep(data: tiff),
           let png = image.representation(using: .png, properties: [:]) {
            onImage?(png, "image/png")
            return true
        }
        return false
    }
}
