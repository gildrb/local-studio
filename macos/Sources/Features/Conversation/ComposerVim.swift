import AppKit

enum VimMode: Equatable, Sendable {
    case normal
    case insert

    var label: String {
        switch self {
        case .normal: "NORMAL"
        case .insert: "INSERT"
        }
    }
}

struct VimKey: Equatable {
    static let escape = "\u{1b}"

    let characters: String
    let control: Bool

    init(characters: String, control: Bool = false) {
        self.characters = characters
        self.control = control
    }

    init?(event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard !flags.contains(.command) else { return nil }
        let control = flags.contains(.control)
        guard let raw = control ? event.charactersIgnoringModifiers?.lowercased() : event.characters,
              raw.unicodeScalars.count == 1, let scalar = raw.unicodeScalars.first,
              !(0xF700...0xF8FF).contains(scalar.value) else { return nil }
        self.init(characters: raw == "\u{3}" ? "\r" : raw, control: control)
    }
}

@MainActor
final class ComposerVim {
    private(set) var mode = VimMode.insert
    var onMode: (@MainActor (VimMode) -> Void)?
    private var count = 0
    private var pendingOperator: VimOperator?
    private var operatorCount = 0
    private var prefixG = false
    private var column: Int?
    private var columnAnchor = -1
    private var register = VimRegister()

    private var pending: Bool { count > 0 || pendingOperator != nil || prefixG }

    func reset() {
        mode = .insert
        clearPending()
        column = nil
    }

    func handle(_ key: VimKey, in textView: NSTextView) -> Bool {
        switch mode {
        case .insert:
            guard key.characters == VimKey.escape, !key.control else { return false }
            enterNormal(textView)
            return true
        case .normal:
            return normal(key, in: textView)
        }
    }

    func feed(_ keys: String, in textView: NSTextView) {
        for character in keys {
            let key = VimKey(characters: String(character))
            guard !handle(key, in: textView), mode == .insert else { continue }
            textView.undoManager?.beginUndoGrouping()
            textView.insertText(key.characters, replacementRange: textView.selectedRange())
            textView.undoManager?.endUndoGrouping()
        }
    }

    private func normal(_ key: VimKey, in textView: NSTextView) -> Bool {
        let input = key.characters
        if input == VimKey.escape {
            let consumed = pending
            clearPending()
            return consumed
        }
        if key.control {
            clearPending()
            if input == "r" {
                history(redo: true, times: 1, in: textView)
            }
            return true
        }
        if input.count == 1, let digit = Int(input), digit > 0 || count > 0 {
            count = min(count * 10 + digit, 9_999)
            return true
        }
        var motion = VimMotion(input)
        if prefixG {
            prefixG = false
            guard input == "g" else {
                clearPending()
                return true
            }
            motion = .documentStart
        } else if input == "g" {
            prefixG = true
            return true
        }
        if let op = pendingOperator {
            let raw = count > 0 || operatorCount > 0 ? max(count, 1) * max(operatorCount, 1) : 0
            clearPending()
            if motion == nil, input == op.rawValue {
                linewise(op, count: max(raw, 1), in: textView)
            } else if let motion {
                apply(op, motion: motion, raw: raw, in: textView)
            }
            return true
        }
        let raw = count
        clearPending()
        if let motion {
            move(motion, raw: raw, in: textView)
        } else {
            command(input, raw: raw, in: textView)
        }
        return true
    }

    private func clearPending() {
        count = 0
        pendingOperator = nil
        operatorCount = 0
        prefixG = false
    }

    private func command(_ input: String, raw: Int, in textView: NSTextView) {
        let text = VimText(textView.string)
        let caret = text.rest(textView.selectedRange().location)
        let line = text.line(at: caret)
        let count = max(raw, 1)
        column = nil
        switch input {
        case "d", "c", "y":
            pendingOperator = VimOperator(rawValue: input)
            operatorCount = raw
        case "x":
            perform(.delete, NSRange(caret ..< text.advance(caret, by: count, limit: line.contentsEnd)), in: textView)
        case "X":
            perform(.delete, NSRange(text.retreat(caret, by: count, limit: line.start) ..< caret), in: textView)
        case "s":
            perform(.change, NSRange(caret ..< text.advance(caret, by: count, limit: line.contentsEnd)), in: textView)
        case "D", "C":
            perform(input == "D" ? .delete : .change, NSRange(caret ..< max(caret, line.contentsEnd)), in: textView)
        case "S":
            linewise(.change, count: count, in: textView)
        case "Y":
            linewise(.yank, count: count, in: textView)
        case "p", "P":
            put(after: input == "p", count: count, in: textView)
        case "u":
            history(redo: false, times: count, in: textView)
        default:
            enter(input, caret: caret, line: line, text: text, in: textView)
        }
    }

    private func enter(_ input: String, caret: Int, line: VimLine, text: VimText, in textView: NSTextView) {
        switch input {
        case "i":
            enterInsert(at: caret, in: textView)
        case "a":
            enterInsert(at: caret < line.contentsEnd ? text.next(caret) : caret, in: textView)
        case "A":
            enterInsert(at: line.contentsEnd, in: textView)
        case "I":
            enterInsert(at: text.firstNonBlank(line), in: textView)
        case "o":
            guard replace(NSRange(location: line.contentsEnd, length: 0), with: "\n", in: textView) else { return }
            enterInsert(at: line.contentsEnd + 1, in: textView)
        case "O":
            guard replace(NSRange(location: line.start, length: 0), with: "\n", in: textView) else { return }
            enterInsert(at: line.start, in: textView)
        default:
            break
        }
    }

    private func move(_ motion: VimMotion, raw: Int, in textView: NSTextView) {
        let text = VimText(textView.string)
        let location = textView.selectedRange().location
        if !motion.vertical || location != columnAnchor {
            column = nil
        }
        let caret = text.rest(location)
        guard let target = target(of: motion, from: caret, raw: raw, text: text) else { return }
        let destination = text.rest(target)
        place(destination, in: textView)
        columnAnchor = destination
        if motion == .lineEnd {
            column = .max
        }
    }

    private func apply(_ op: VimOperator, motion: VimMotion, raw: Int, in textView: NSTextView) {
        let text = VimText(textView.string)
        let caret = text.rest(textView.selectedRange().location)
        column = nil
        if op == .change, motion == .wordForward, text.kind(at: caret) != .space {
            var end = text.wordTail(from: caret)
            for _ in 1 ..< max(raw, 1) {
                end = text.wordEnd(from: end)
            }
            perform(op, NSRange(caret ..< text.next(end)), in: textView)
            return
        }
        guard var target = target(of: motion, from: caret, raw: raw, text: text) else { return }
        column = nil
        if motion.linewise {
            lines(op, from: text.line(at: min(caret, target)), to: text.line(at: max(caret, target)), in: textView)
            return
        }
        let line = text.line(at: caret)
        if motion == .wordForward, target > line.contentsEnd, caret < line.contentsEnd {
            target = line.contentsEnd
        }
        let lower = min(caret, target)
        let upper = motion == .wordEnd ? text.next(max(caret, target)) : max(caret, target)
        perform(op, NSRange(lower ..< upper), in: textView)
    }

    private func target(of motion: VimMotion, from caret: Int, raw: Int, text: VimText) -> Int? {
        let count = max(raw, 1)
        let line = text.line(at: caret)
        switch motion {
        case .left:
            return text.retreat(caret, by: count, limit: line.start)
        case .right:
            return text.advance(caret, by: count, limit: line.contentsEnd)
        case .down, .up:
            guard let destination = vertical(from: line, count: count, down: motion == .down, text: text) else { return nil }
            let goal = column ?? caret - line.start
            column = goal
            return goal >= destination.contentsEnd - destination.start ? destination.contentsEnd : destination.start + goal
        case .nextLine:
            return vertical(from: line, count: count, down: true, text: text).map { text.firstNonBlank($0) }
        case .wordForward, .wordBackward, .wordEnd:
            var position = caret
            for _ in 0 ..< count {
                switch motion {
                case .wordForward: position = text.wordForward(from: position)
                case .wordBackward: position = text.wordBackward(from: position)
                default: position = text.wordEnd(from: position)
                }
            }
            return position
        case .lineStart:
            return line.start
        case .firstNonBlank:
            return text.firstNonBlank(line)
        case .lineEnd:
            return (vertical(from: line, count: count - 1, down: true, text: text) ?? line).contentsEnd
        case .documentStart:
            return text.firstNonBlank(raw > 0 ? text.line(number: raw) : text.line(at: 0))
        case .documentEnd:
            return text.firstNonBlank(raw > 0 ? text.line(number: raw) : text.lastLine)
        }
    }

    private func vertical(from line: VimLine, count: Int, down: Bool, text: VimText) -> VimLine? {
        var current = line
        var moved = 0
        while moved < count, let next = down ? text.lineBelow(current) : text.lineAbove(current) {
            current = next
            moved += 1
        }
        return moved == 0 && count > 0 ? nil : current
    }
}

extension ComposerVim {
    private func perform(_ op: VimOperator, _ range: NSRange, in textView: NSTextView) {
        let text = VimText(textView.string)
        if range.length > 0 {
            register = VimRegister(text: text.string.substring(with: range), linewise: false)
        }
        switch op {
        case .yank:
            place(text.rest(range.location), in: textView)
        case .delete:
            guard range.length > 0, replace(range, with: "", in: textView) else { return }
            place(VimText(textView.string).rest(range.location), in: textView)
        case .change:
            if range.length > 0 {
                replace(range, with: "", in: textView)
            }
            enterInsert(at: range.location, in: textView)
        }
    }

    private func linewise(_ op: VimOperator, count: Int, in textView: NSTextView) {
        let text = VimText(textView.string)
        let first = text.line(at: text.rest(textView.selectedRange().location))
        var last = first
        for _ in 1 ..< max(count, 1) {
            guard let below = text.lineBelow(last) else { break }
            last = below
        }
        lines(op, from: first, to: last, in: textView)
    }

    private func lines(_ op: VimOperator, from first: VimLine, to last: VimLine, in textView: NSTextView) {
        let text = VimText(textView.string)
        let body = text.string.substring(with: NSRange(first.start ..< last.contentsEnd))
        register = VimRegister(text: body + "\n", linewise: true)
        switch op {
        case .yank:
            let caret = textView.selectedRange().location
            if caret > last.contentsEnd || caret < first.start {
                place(text.rest(text.firstNonBlank(first)), in: textView)
            }
        case .change:
            let start = text.firstNonBlank(first)
            replace(NSRange(start ..< max(start, last.contentsEnd)), with: "", in: textView)
            enterInsert(at: start, in: textView)
        case .delete:
            let range: NSRange
            if last.hasBreak {
                range = NSRange(first.start ..< last.end)
            } else if first.start > 0 {
                range = NSRange(first.start - 1 ..< last.contentsEnd)
            } else {
                range = NSRange(location: 0, length: text.length)
            }
            guard replace(range, with: "", in: textView) else { return }
            let updated = VimText(textView.string)
            place(updated.rest(updated.firstNonBlank(updated.line(at: range.location))), in: textView)
        }
    }

    private func put(after: Bool, count: Int, in textView: NSTextView) {
        guard !register.text.isEmpty else { return }
        let text = VimText(textView.string)
        let caret = text.rest(textView.selectedRange().location)
        let line = text.line(at: caret)
        let body = String(repeating: register.text, count: count)
        let length = (body as NSString).length
        guard register.linewise else {
            let location = after && caret < line.contentsEnd ? text.next(caret) : caret
            guard replace(NSRange(location: location, length: 0), with: body, in: textView) else { return }
            place(VimText(textView.string).rest(location + length - 1), in: textView)
            return
        }
        let location: Int
        let inserted: String
        if !after {
            location = line.start
            inserted = body
        } else if line.hasBreak {
            location = line.end
            inserted = body
        } else {
            location = line.contentsEnd
            inserted = "\n" + (body as NSString).substring(to: length - 1)
        }
        guard replace(NSRange(location: location, length: 0), with: inserted, in: textView) else { return }
        let updated = VimText(textView.string)
        let start = after && !line.hasBreak ? location + 1 : location
        place(updated.rest(updated.firstNonBlank(updated.line(at: start))), in: textView)
    }

    private func history(redo: Bool, times: Int, in textView: NSTextView) {
        guard let undoManager = textView.undoManager else { return }
        textView.breakUndoCoalescing()
        for _ in 0 ..< max(times, 1) {
            if redo, undoManager.canRedo {
                undoManager.redo()
            } else if !redo, undoManager.canUndo {
                undoManager.undo()
            } else {
                break
            }
        }
        column = nil
        place(VimText(textView.string).rest(textView.selectedRange().location), in: textView)
    }

    @discardableResult
    private func replace(_ range: NSRange, with string: String, in textView: NSTextView) -> Bool {
        textView.breakUndoCoalescing()
        let undoManager = textView.undoManager
        undoManager?.beginUndoGrouping()
        defer { undoManager?.endUndoGrouping() }
        guard textView.shouldChangeText(in: range, replacementString: string), let storage = textView.textStorage else { return false }
        storage.replaceCharacters(in: range, with: string)
        textView.didChangeText()
        return true
    }

    private func enterNormal(_ textView: NSTextView) {
        textView.breakUndoCoalescing()
        clearPending()
        column = nil
        let text = VimText(textView.string)
        let selection = textView.selectedRange()
        let line = text.line(at: selection.location)
        let back = selection.length == 0 && selection.location > line.start
        place(text.rest(back ? text.previous(selection.location) : selection.location), in: textView)
        setMode(.normal)
    }

    private func enterInsert(at location: Int, in textView: NSTextView) {
        place(location, in: textView)
        setMode(.insert)
    }

    private func place(_ location: Int, in textView: NSTextView) {
        let range = NSRange(location: location, length: 0)
        textView.setSelectedRange(range)
        textView.scrollRangeToVisible(range)
    }

    private func setMode(_ next: VimMode) {
        guard mode != next else { return }
        mode = next
        onMode?(next)
    }
}
