import AppKit
import SwiftUI

enum ComposerKey {
    case submit
    case steer
    case up
    case down
    case tab
    case escape
}

struct ComposerTextView: NSViewRepresentable {
    let draft: ComposerDraft
    let fontSize: CGFloat
    let focusToken: Int
    @Binding var height: CGFloat
    let onCaret: (String, Int) -> Void
    let onKey: (ComposerKey, Int) -> Bool
    let onImage: (Data, String) -> Void
    let onFiles: ([URL]) -> Void

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
        scrollView.documentView = textView
        context.coordinator.textView = textView
        context.coordinator.focusToken = focusToken
        DispatchQueue.main.async {
            textView.window?.makeFirstResponder(textView)
            context.coordinator.measure()
            context.coordinator.reportCaret()
        }
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = context.coordinator.textView else { return }
        textView.onImage = onImage
        textView.onFiles = onFiles
        if textView.font?.pointSize != fontSize {
            textView.font = .systemFont(ofSize: fontSize)
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
            case #selector(NSResponder.insertNewline(_:)):
                if NSApp.currentEvent?.modifierFlags.contains(.shift) == true {
                    textView.insertNewlineIgnoringFieldEditor(nil)
                    return true
                }
                if NSApp.currentEvent?.modifierFlags.contains(.option) == true {
                    return parent.onKey(.steer, caret)
                }
                return parent.onKey(.submit, caret)
            case #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
                return parent.onKey(.steer, caret)
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
