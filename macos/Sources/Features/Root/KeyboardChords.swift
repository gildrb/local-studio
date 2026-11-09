import AppKit
import LocalStudioKit

extension StudioStore {
    private static let positiveClauses = ["terminalFocus", "previewFocus", "modelPickerOpen", "usagePageOpen", "timelineFocus", "editableFocus"]

    func routeChord(_ event: NSEvent, responder: NSResponder?) -> Bool {
        guard let spec = ShortcutFormat.record(event) else { return false }
        let flags = event.modifierFlags.intersection([.command, .control])
        let function = ShortcutFormat.parse(spec).key.range(of: "^f[0-9]+$", options: .regularExpression) != nil
        if responder?.capturesKeys == true || responder is TerminalSurfaceView, flags.isEmpty, !function {
            return false
        }
        guard let command = chordCommand(spec, responder: responder) ?? ShortcutFormat.recordShifted(event).flatMap({ chordCommand($0, responder: responder) }) else {
            return false
        }
        dispatch(command)
        return true
    }

    func chordCommand(_ spec: String, responder: NSResponder?) -> String? {
        let chord = ShortcutFormat.parse(spec)
        let candidates = pages.keybindings.filter { binding in
            guard let shortcut = binding.shortcut else { return false }
            let parsed = ShortcutFormat.parse(shortcut)
            return parsed.key == chord.key && parsed.modifiers == chord.modifiers && clause(binding.when, responder: responder)
        }
        let ordered = candidates.sorted { Self.specificity($0.when) > Self.specificity($1.when) }
        return ordered.first { builtin($0.command) != nil || commands.canPerform($0.command) }?.command
    }

    func clause(_ when: String?, responder: NSResponder?) -> Bool {
        guard let when else { return true }
        return when.components(separatedBy: "&&").allSatisfy { part in
            let token = part.trimmingCharacters(in: .whitespaces)
            let negated = token.hasPrefix("!")
            let name = negated ? String(token.dropFirst()) : token
            return holds(name, responder: responder) != negated
        }
    }

    private func holds(_ name: String, responder: NSResponder?) -> Bool {
        switch name {
        case "terminalFocus": responder is TerminalSurfaceView
        case "previewFocus": shell.route == .thread && shell.region == .rightPanel && responder?.capturesKeys != true
        case "modelPickerOpen": conversation.modelPickerPresented
        case "usagePageOpen": shell.route == .usage
        case "timelineFocus": shell.route == .thread && shell.region == .timeline && responder?.capturesKeys != true
        case "editableFocus": responder?.capturesKeys == true
        default: true
        }
    }

    private static func specificity(_ when: String?) -> Int {
        guard let when else { return 0 }
        return positiveClauses.filter { when.contains($0) && !when.contains("!\($0)") }.count
    }
}
