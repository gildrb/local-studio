import AppKit
import CoreGraphics

struct KeyChord: Equatable, CustomStringConvertible {
    let keyCode: UInt16
    let characters: String
    let ignoring: String
    let flags: NSEvent.ModifierFlags
    let spec: String

    var description: String {
        CoreShortcut.display(spec) ?? spec
    }

    static func parse(_ spec: String) -> KeyChord? {
        var parts = spec.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        if spec.hasSuffix("++") {
            parts.removeLast(2)
            parts.append("+")
        }
        guard let name = parts.popLast(), !name.isEmpty else { return nil }
        var flags: NSEvent.ModifierFlags = []
        for part in parts {
            switch part {
            case "cmd": flags.insert(.command)
            case "ctrl": flags.insert(.control)
            case "option", "alt": flags.insert(.option)
            case "shift": flags.insert(.shift)
            default: return nil
            }
        }
        if let special = special[name] {
            let text = String(Character(UnicodeScalar(special.scalar) ?? " "))
            if special.function { flags.formUnion([.function]) }
            return KeyChord(keyCode: special.code, characters: text, ignoring: text, flags: flags, spec: spec)
        }
        let lower = name.lowercased()
        guard let code = codes[lower] else { return nil }
        let typed = flags.contains(.shift) ? (shifted[lower] ?? lower.uppercased()) : lower
        return KeyChord(keyCode: code, characters: typed, ignoring: typed, flags: flags, spec: spec)
    }

    static func character(_ character: Character) -> KeyChord? {
        let text = String(character)
        if let code = codes[text] {
            return KeyChord(keyCode: code, characters: text, ignoring: text, flags: [], spec: text)
        }
        if let base = shifted.first(where: { $0.value == text })?.key ?? (text.lowercased() != text ? text.lowercased() : nil),
           let code = codes[base] {
            return KeyChord(keyCode: code, characters: text, ignoring: text, flags: .shift, spec: "shift+\(base)")
        }
        return nil
    }

    private struct Special {
        let code: UInt16
        let scalar: Int
        let function: Bool
    }

    private static let special: [String: Special] = {
        var keys: [String: Special] = [
            "return": Special(code: 36, scalar: 13, function: false),
            "enter": Special(code: 36, scalar: 13, function: false),
            "tab": Special(code: 48, scalar: 9, function: false),
            "space": Special(code: 49, scalar: 32, function: false),
            "escape": Special(code: 53, scalar: 27, function: false),
            "delete": Special(code: 51, scalar: 127, function: false),
            "backspace": Special(code: 51, scalar: 127, function: false),
            "left": Special(code: 123, scalar: NSLeftArrowFunctionKey, function: true),
            "right": Special(code: 124, scalar: NSRightArrowFunctionKey, function: true),
            "down": Special(code: 125, scalar: NSDownArrowFunctionKey, function: true),
            "up": Special(code: 126, scalar: NSUpArrowFunctionKey, function: true),
        ]
        let functionCodes: [UInt16] = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111]
        for (index, code) in functionCodes.enumerated() {
            keys["f\(index + 1)"] = Special(code: code, scalar: NSF1FunctionKey + index, function: true)
        }
        return keys
    }()

    private static let codes: [String: UInt16] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
        "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25,
        "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
        "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50, " ": 49,
    ]

    private static let shifted: [String: String] = [
        "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
        "[": "{", "]": "}", "=": "+", "-": "_", ";": ":", "'": "\"", ",": "<", ".": ">", "/": "?", "\\": "|", "`": "~",
    ]
}

@MainActor
enum KeyDriver {
    static var keyMonitor: ((NSEvent) -> Bool)?
    static var flagsMonitor: ((NSEvent) -> Void)?
    private(set) static var native = 0
    private(set) static var emulated = 0

    private static func deliver(_ event: NSEvent, in window: NSWindow) {
        if window.isKeyWindow, NSApp.isActive {
            native += 1
            NSApp.sendEvent(event)
            return
        }
        emulated += 1
        switch event.type {
        case .flagsChanged:
            flagsMonitor?(event)
            window.sendEvent(event)
        case .keyDown:
            if keyMonitor?(event) == true { return }
            if !event.modifierFlags.isDisjoint(with: [.command, .control]) {
                if window.performKeyEquivalent(with: event) { return }
                if NSApp.mainMenu?.performKeyEquivalent(with: event) == true { return }
            }
            window.sendEvent(event)
        default:
            window.sendEvent(event)
        }
    }

    static func press(_ chord: KeyChord, in window: NSWindow, hold: Bool = false) {
        let modifiers = chord.flags.intersection([.command, .control, .option, .shift])
        if !modifiers.isEmpty {
            flags(modifiers, in: window)
        }
        send(.keyDown, chord, in: window)
        send(.keyUp, chord, in: window)
        if !modifiers.isEmpty, !hold {
            flags([], in: window)
        }
    }

    static func release(in window: NSWindow) {
        flags([], in: window)
    }

    static func type(_ text: String, in window: NSWindow) {
        for character in text {
            guard let chord = KeyChord.character(character) else { continue }
            send(.keyDown, chord, in: window)
            send(.keyUp, chord, in: window)
        }
    }

    static func flags(_ flags: NSEvent.ModifierFlags, in window: NSWindow) {
        let target = window.attachedSheet ?? window
        guard let event = NSEvent.keyEvent(
            with: .flagsChanged, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: target.windowNumber, context: nil, characters: "", charactersIgnoringModifiers: "", isARepeat: false,
            keyCode: flags.contains(.control) ? 59 : flags.contains(.command) ? 55 : 0
        ) else { return }
        deliver(event, in: target)
    }

    static func scroll(_ delta: CGFloat, at point: NSPoint, in window: NSWindow) {
        let phases: [Int64] = [1, 2, 2, 2, 4]
        let location = window.convertPoint(toScreen: point)
        let height = NSScreen.screens.first?.frame.height ?? 0
        for phase in phases {
            let step = phase == 2 ? Int32(delta / 3) : 0
            guard let cgEvent = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: step, wheel2: 0, wheel3: 0) else { continue }
            cgEvent.location = CGPoint(x: location.x, y: height - location.y)
            cgEvent.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
            guard let event = NSEvent(cgEvent: cgEvent) else { continue }
            window.sendEvent(event)
        }
    }

    static func click(at point: NSPoint, in window: NSWindow) {
        let timestamp = ProcessInfo.processInfo.systemUptime
        let events = [NSEvent.EventType.leftMouseDown, .leftMouseUp].compactMap { type in
            NSEvent.mouseEvent(
                with: type, location: point, modifierFlags: [], timestamp: timestamp, windowNumber: window.windowNumber,
                context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0
            )
        }
        guard events.count == 2 else { return }
        if window.isKeyWindow, NSApp.isActive {
            native += 1
        } else {
            emulated += 1
        }
        events.forEach { NSApp.postEvent($0, atStart: false) }
    }

    private static func send(_ type: NSEvent.EventType, _ chord: KeyChord, in window: NSWindow) {
        let target = window.attachedSheet ?? window
        guard let event = NSEvent.keyEvent(
            with: type, location: .zero, modifierFlags: chord.flags, timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: target.windowNumber, context: nil, characters: chord.characters,
            charactersIgnoringModifiers: chord.ignoring, isARepeat: false, keyCode: chord.keyCode
        ) else { return }
        deliver(event, in: target)
    }
}
