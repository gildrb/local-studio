import AppKit
import SwiftUI

enum PaletteCommand {
    case up, down, pageUp, pageDown, first, last, submit, cancel, deleteBackward

    init?(_ selector: Selector) {
        switch selector {
        case #selector(NSResponder.moveUp(_:)): self = .up
        case #selector(NSResponder.moveDown(_:)): self = .down
        case #selector(NSResponder.scrollPageUp(_:)), #selector(NSResponder.pageUp(_:)): self = .pageUp
        case #selector(NSResponder.scrollPageDown(_:)), #selector(NSResponder.pageDown(_:)): self = .pageDown
        case #selector(NSResponder.scrollToBeginningOfDocument(_:)), #selector(NSResponder.moveToBeginningOfDocument(_:)): self = .first
        case #selector(NSResponder.scrollToEndOfDocument(_:)), #selector(NSResponder.moveToEndOfDocument(_:)): self = .last
        case #selector(NSResponder.insertNewline(_:)): self = .submit
        case #selector(NSResponder.cancelOperation(_:)): self = .cancel
        case #selector(NSResponder.deleteBackward(_:)): self = .deleteBackward
        default: return nil
        }
    }
}

struct PaletteField: NSViewRepresentable {
    let placeholder: String
    let text: String
    let changed: (String) -> Void
    let command: (PaletteCommand) -> Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> FirstResponderField {
        let field = FirstResponderField()
        field.isBordered = false
        field.isBezeled = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 15)
        field.lineBreakMode = .byTruncatingTail
        field.cell?.isScrollable = true
        field.cell?.wraps = false
        field.delegate = context.coordinator
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return field
    }

    func updateNSView(_ field: FirstResponderField, context: Context) {
        context.coordinator.parent = self
        if field.stringValue != text {
            field.stringValue = text
        }
        field.textColor = NSColor(Theme.text)
        if field.placeholderAttributedString?.string != placeholder {
            field.placeholderAttributedString = NSAttributedString(string: placeholder, attributes: [
                .font: NSFont.systemFont(ofSize: 15),
                .foregroundColor: NSColor(Theme.secondaryText),
            ])
            field.setAccessibilityPlaceholderValue(placeholder)
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: PaletteField

        init(_ parent: PaletteField) {
            self.parent = parent
        }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            parent.changed(field.stringValue)
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            guard let command = PaletteCommand(selector) else { return false }
            return parent.command(command)
        }
    }
}

final class FirstResponderField: NSTextField {
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard let window, window.firstResponder !== currentEditor() else { return }
        window.makeFirstResponder(self)
    }
}
