import Foundation

struct VimLine {
    let start: Int
    let end: Int
    let contentsEnd: Int

    var hasBreak: Bool { end > contentsEnd }
    var isEmpty: Bool { contentsEnd == start }
}

enum VimCharKind {
    case space
    case word
    case punctuation
}

enum VimOperator: String {
    case delete = "d"
    case change = "c"
    case yank = "y"
}

enum VimMotion {
    case left
    case right
    case down
    case up
    case nextLine
    case wordForward
    case wordBackward
    case wordEnd
    case lineStart
    case firstNonBlank
    case lineEnd
    case documentStart
    case documentEnd

    init?(_ input: String) {
        switch input {
        case "h", "\u{7f}": self = .left
        case "l", " ": self = .right
        case "j": self = .down
        case "k": self = .up
        case "\r", "+": self = .nextLine
        case "w": self = .wordForward
        case "b": self = .wordBackward
        case "e": self = .wordEnd
        case "0": self = .lineStart
        case "^": self = .firstNonBlank
        case "$": self = .lineEnd
        case "G": self = .documentEnd
        default: return nil
        }
    }

    var vertical: Bool { self == .down || self == .up }

    var linewise: Bool {
        switch self {
        case .down, .up, .nextLine, .documentStart, .documentEnd: true
        default: false
        }
    }
}

struct VimRegister {
    var text = ""
    var linewise = false
}

struct VimText {
    let string: NSString

    init(_ text: String) {
        string = text as NSString
    }

    var length: Int { string.length }

    var lastLine: VimLine { line(at: length) }

    func line(at location: Int) -> VimLine {
        var start = 0
        var end = 0
        var contentsEnd = 0
        let clamped = min(max(location, 0), length)
        string.getLineStart(&start, end: &end, contentsEnd: &contentsEnd, for: NSRange(location: clamped, length: 0))
        return VimLine(start: start, end: end, contentsEnd: contentsEnd)
    }

    func line(number: Int) -> VimLine {
        var current = line(at: 0)
        var remaining = number - 1
        while remaining > 0, let below = lineBelow(current) {
            current = below
            remaining -= 1
        }
        return current
    }

    func lineBelow(_ line: VimLine) -> VimLine? {
        line.hasBreak ? self.line(at: line.end) : nil
    }

    func lineAbove(_ line: VimLine) -> VimLine? {
        line.start > 0 ? self.line(at: line.start - 1) : nil
    }

    func next(_ location: Int) -> Int {
        guard location < length else { return length }
        return NSMaxRange(string.rangeOfComposedCharacterSequence(at: max(location, 0)))
    }

    func previous(_ location: Int) -> Int {
        guard location > 0 else { return 0 }
        return string.rangeOfComposedCharacterSequence(at: min(location, length) - 1).location
    }

    func rest(_ location: Int) -> Int {
        let clamped = min(max(location, 0), length)
        let line = self.line(at: clamped)
        if clamped >= line.contentsEnd {
            return line.isEmpty ? line.start : previous(line.contentsEnd)
        }
        return string.rangeOfComposedCharacterSequence(at: clamped).location
    }

    func kind(at location: Int) -> VimCharKind {
        guard location >= 0, location < length else { return .space }
        guard let scalar = Unicode.Scalar(string.character(at: location)) else { return .word }
        if CharacterSet.whitespacesAndNewlines.contains(scalar) {
            return .space
        }
        if scalar == "_" || CharacterSet.alphanumerics.contains(scalar) {
            return .word
        }
        return .punctuation
    }

    func firstNonBlank(_ line: VimLine) -> Int {
        var location = line.start
        while location < line.contentsEnd, kind(at: location) == .space {
            location = next(location)
        }
        return location
    }

    func advance(_ location: Int, by count: Int, limit: Int) -> Int {
        var position = location
        for _ in 0 ..< count where position < limit {
            position = next(position)
        }
        return min(position, max(limit, location))
    }

    func retreat(_ location: Int, by count: Int, limit: Int) -> Int {
        var position = location
        for _ in 0 ..< count where position > limit {
            position = previous(position)
        }
        return max(position, min(limit, location))
    }

    func wordForward(from location: Int) -> Int {
        var position = location
        let start = kind(at: position)
        if start != .space {
            while position < length, kind(at: position) == start {
                position = next(position)
            }
        }
        while position < length, kind(at: position) == .space {
            position = next(position)
        }
        return position
    }

    func wordEnd(from location: Int) -> Int {
        var position = next(location)
        while position < length, kind(at: position) == .space {
            position = next(position)
        }
        guard position < length else { return previous(length) }
        return wordTail(from: position)
    }

    func wordTail(from location: Int) -> Int {
        var position = location
        let start = kind(at: position)
        while next(position) < length, kind(at: next(position)) == start {
            position = next(position)
        }
        return position
    }

    func wordBackward(from location: Int) -> Int {
        var position = previous(location)
        while position > 0, kind(at: position) == .space {
            position = previous(position)
        }
        let start = kind(at: position)
        while position > 0, kind(at: previous(position)) == start {
            position = previous(position)
        }
        return position
    }
}
