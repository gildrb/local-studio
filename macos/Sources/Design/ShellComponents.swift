import AppKit
import LocalStudioKit
import SwiftUI

struct ProjectTile: View {
    let name: String
    var icon: String?
    var size: CGFloat = Theme.Metrics.tile
    var neutral = false

    var body: some View {
        Group {
            if let icon, !icon.isEmpty, NSImage(systemSymbolName: icon, accessibilityDescription: nil) != nil {
                Image(systemName: icon)
                    .font(.system(size: size * 0.6, weight: .semibold))
                    .symbolRenderingMode(.monochrome)
                    .foregroundStyle(.white)
            } else if let icon, !icon.isEmpty {
                Text(icon)
                    .font(.system(size: size * 0.7))
            } else {
                Text(initials)
                    .font(.system(size: size * 0.47, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .background(color.gradient, in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
        .accessibilityHidden(true)
    }

    private var initials: String {
        let words = name.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        let letters = words.count > 1 ? words.prefix(2).compactMap(\.first) : Array(name.prefix(2))
        return String(letters).uppercased()
    }

    private var color: Color {
        if neutral { return Theme.tertiaryText }
        let palette: [Color] = [.indigo, .purple, .pink, .orange, .teal, .blue, .green, .brown]
        let hash = name.unicodeScalars.reduce(UInt32(5381)) { ($0 &* 33) &+ $1.value }
        return palette[Int(hash % UInt32(palette.count))]
    }
}

extension ProjectTile {
    init(project: Project?, size: CGFloat = Theme.Metrics.tile) {
        self.init(name: project?.name ?? "No project", icon: project == nil ? "minus" : project?.icon, size: size, neutral: project == nil)
    }
}

enum TimeFormatting {
    static func time(_ date: Date, _ format: TimeFormat?) -> String {
        switch format ?? .locale {
        case .locale: date.formatted(date: .omitted, time: .shortened)
        case .twelveHour: fixed("h:mm a").string(from: date)
        case .twentyFourHour: fixed("HH:mm").string(from: date)
        }
    }

    static func dateTime(_ date: Date, _ format: TimeFormat?) -> String {
        "\(date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))), \(time(date, format))"
    }

    private static func fixed(_ pattern: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.dateFormat = pattern
        return formatter
    }
}

enum RelativeAge {
    static func text(millis: Int64, now: Date = .now) -> String {
        let seconds = max(0, now.timeIntervalSince1970 - TimeInterval(millis) / 1_000)
        switch seconds {
        case ..<60: return "now"
        case ..<3_600: return "\(Int(seconds / 60))m"
        case ..<86_400: return "\(Int(seconds / 3_600))h"
        default: return "\(Int(seconds / 86_400))d"
        }
    }

    static func countdown(millis: Int64, now: Date = .now) -> String {
        let remaining = TimeInterval(millis) / 1_000 - now.timeIntervalSince1970
        guard remaining > 0 else { return "now" }
        switch remaining {
        case ..<3_600: return "\(max(1, Int((remaining / 60).rounded(.up))))m"
        case ..<86_400: return "\(Int((remaining / 3_600).rounded(.up)))h"
        default: return "\(Int((remaining / 86_400).rounded(.up)))d"
        }
    }

    static func duration(since millis: Int64, now: Date = .now) -> String {
        let seconds = Int(max(0, now.timeIntervalSince1970 - TimeInterval(millis) / 1_000))
        switch seconds {
        case ..<60: return "\(seconds)s"
        case ..<3_600: return "\(seconds / 60)m"
        default: return "\(seconds / 3_600)h \(seconds % 3_600 / 60)m"
        }
    }
}

struct TitlebarDragArea: View {
    var body: some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(WindowDragGesture())
            .allowsWindowActivationEvents(true)
    }
}

struct MenuNode: Identifiable {
    enum Kind {
        case action(@MainActor () -> Void)
        case submenu([MenuNode])
        case divider
    }

    let id: String
    var title = ""
    var symbol: String?
    var destructive = false
    var enabled = true
    var checked = false
    var detail: String?
    let kind: Kind

    static func action(_ title: String, symbol: String? = nil, destructive: Bool = false, enabled: Bool = true, checked: Bool = false, detail: String? = nil, perform: @escaping @MainActor () -> Void) -> MenuNode {
        MenuNode(id: title, title: title, symbol: symbol, destructive: destructive, enabled: enabled, checked: checked, detail: detail, kind: .action(perform))
    }

    static func submenu(_ title: String, symbol: String? = nil, enabled: Bool = true, _ children: [MenuNode]) -> MenuNode {
        MenuNode(id: title, title: title, symbol: symbol, enabled: enabled, kind: .submenu(children))
    }

    static func divider(_ id: String) -> MenuNode {
        MenuNode(id: "divider-\(id)", kind: .divider)
    }

    var label: String {
        detail.map { "\(title)  \($0)" } ?? title
    }
}

struct MenuNodes: View {
    let nodes: [MenuNode]

    var body: some View {
        ForEach(nodes) { node in
            switch node.kind {
            case .divider:
                Divider()
            case .action(let perform):
                if node.checked {
                    Toggle(node.label, isOn: .constant(true))
                        .disabled(!node.enabled)
                } else {
                    Button(role: node.destructive ? .destructive : nil) {
                        perform()
                    } label: {
                        if let symbol = node.symbol {
                            Label { Text(node.label) } icon: { Image(systemName: symbol).accessibilityHidden(true) }
                        } else {
                            Text(node.label)
                        }
                    }
                    .disabled(!node.enabled)
                }
            case .submenu(let children):
                Menu {
                    MenuNodes(nodes: children)
                } label: {
                    if let symbol = node.symbol {
                        Label { Text(node.title) } icon: { Image(systemName: symbol).accessibilityHidden(true) }
                    } else {
                        Text(node.title)
                    }
                }
                .disabled(!node.enabled)
            }
        }
    }
}

@MainActor
final class ClosureMenuItem: NSMenuItem {
    private let handler: @MainActor () -> Void

    init(title: String, handler: @escaping @MainActor () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
    }

    @available(*, unavailable)
    required init(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    @objc private func fire() {
        handler()
    }
}

@MainActor
enum NativeMenu {
    static func build(_ nodes: [MenuNode]) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        for node in nodes {
            switch node.kind {
            case .divider:
                menu.addItem(.separator())
            case .action(let perform):
                let item = ClosureMenuItem(title: node.label, handler: perform)
                item.isEnabled = node.enabled
                item.state = node.checked ? .on : .off
                if let symbol = node.symbol {
                    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: node.title)
                }
                menu.addItem(item)
            case .submenu(let children):
                let item = NSMenuItem(title: node.title, action: nil, keyEquivalent: "")
                item.isEnabled = node.enabled
                if let symbol = node.symbol {
                    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: node.title)
                }
                item.submenu = build(children)
                menu.addItem(item)
            }
        }
        return menu
    }

    static func popUp(_ nodes: [MenuNode], below view: NSView?) {
        guard let view else { return }
        let menu = build(nodes)
        let location = NSPoint(x: 0, y: view.isFlipped ? view.bounds.maxY + 4 : -4)
        menu.popUp(positioning: nil, at: location, in: view)
    }
}

@MainActor
final class ViewAnchor {
    weak var view: NSView?
}

struct AnchorView: NSViewRepresentable {
    let anchor: ViewAnchor

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        anchor.view = view
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        anchor.view = nsView
    }
}

struct CoreShortcut {
    static func parse(_ value: String?) -> KeyboardShortcut? {
        guard let value, !value.isEmpty else { return nil }
        var parts = value.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        if value.hasSuffix("++") {
            parts.removeLast(2)
            parts.append("+")
        }
        guard let keyName = parts.popLast(), !keyName.isEmpty else { return nil }
        var modifiers: EventModifiers = []
        for part in parts {
            switch part {
            case "cmd": modifiers.insert(.command)
            case "ctrl": modifiers.insert(.control)
            case "option", "alt": modifiers.insert(.option)
            case "shift": modifiers.insert(.shift)
            default: return nil
            }
        }
        guard let key = key(keyName) else { return nil }
        return KeyboardShortcut(key, modifiers: modifiers)
    }

    static func display(_ value: String?) -> String? {
        guard let shortcut = parse(value) else { return nil }
        var text = ""
        if shortcut.modifiers.contains(.control) { text += "⌃" }
        if shortcut.modifiers.contains(.option) { text += "⌥" }
        if shortcut.modifiers.contains(.shift) { text += "⇧" }
        if shortcut.modifiers.contains(.command) { text += "⌘" }
        return text + glyph(shortcut.key)
    }

    private static func key(_ name: String) -> KeyEquivalent? {
        switch name {
        case "return", "enter": return .return
        case "up": return .upArrow
        case "down": return .downArrow
        case "left": return .leftArrow
        case "right": return .rightArrow
        case "escape": return .escape
        case "tab": return .tab
        case "space": return .space
        case "delete", "backspace": return .delete
        default:
            if name.count > 1, name.first == "f", let number = Int(name.dropFirst()), (1...12).contains(number),
               let scalar = UnicodeScalar(NSF1FunctionKey + number - 1) {
                return KeyEquivalent(Character(scalar))
            }
            guard name.count == 1, let character = name.first else { return nil }
            return KeyEquivalent(character)
        }
    }

    private static func functionKeyName(_ key: KeyEquivalent) -> String? {
        guard let scalar = key.character.unicodeScalars.first else { return nil }
        let offset = Int(scalar.value) - NSF1FunctionKey
        return (0..<12).contains(offset) ? "F\(offset + 1)" : nil
    }

    private static func glyph(_ key: KeyEquivalent) -> String {
        switch key {
        case .return: "↩"
        case .upArrow: "↑"
        case .downArrow: "↓"
        case .leftArrow: "←"
        case .rightArrow: "→"
        case .escape: "⎋"
        case .tab: "⇥"
        case .space: "Space"
        case .delete: "⌫"
        default: functionKeyName(key) ?? String(key.character).uppercased()
        }
    }
}

struct ShortcutHint: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(Theme.secondaryText)
    }
}
