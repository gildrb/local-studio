import AppKit
import LocalStudioKit
import SwiftUI

struct KeybindingsSettings: View {
    let pages: PagesStore
    @State private var recording: String?
    @Environment(\.settingsQuery) private var query

    static func matches(_ binding: Keybinding, _ query: String) -> Bool {
        query.isEmpty || binding.title.localizedCaseInsensitiveContains(query) || binding.command.localizedCaseInsensitiveContains(query)
            || ShortcutFormat.display(binding.shortcut).localizedCaseInsensitiveContains(query)
    }

    var body: some View {
        SettingsForm {
            if pages.keybindings.isEmpty {
                Section {
                    Text("Waiting for the core…")
                        .foregroundStyle(Theme.secondaryText)
                }
            } else if areas.isEmpty {
                Section {
                    Text("No shortcuts match “\(query)”.")
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            ForEach(areas, id: \.name) { area in
                Section {
                    ForEach(area.bindings, id: \.command) { binding in
                        KeybindingRow(binding: binding, pages: pages, recording: $recording)
                    }
                } header: {
                    Text(area.name)
                } footer: {
                    if area.name == areas.last?.name {
                        Text("Click a shortcut to record a new one; press Escape to cancel. Shortcuts marked Custom differ from the defaults.")
                            .font(.callout)
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
            }
        }
    }

    private var areas: [(name: String, bindings: [Keybinding])] {
        var order: [String] = []
        var grouped: [String: [Keybinding]] = [:]
        for binding in pages.keybindings where Self.matches(binding, query) {
            let area = Self.area(of: binding)
            if grouped[area] == nil { order.append(area) }
            grouped[area, default: []].append(binding)
        }
        return order.map { ($0, grouped[$0] ?? []) }
    }

    static func area(of binding: Keybinding) -> String {
        binding.title.components(separatedBy: ": ").first ?? binding.title
    }

    static func action(of binding: Keybinding) -> String {
        let parts = binding.title.components(separatedBy: ": ")
        return parts.count > 1 ? parts.dropFirst().joined(separator: ": ") : binding.title
    }
}

private struct KeybindingRow: View {
    let binding: Keybinding
    let pages: PagesStore
    @Binding var recording: String?

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(KeybindingsSettings.action(of: binding))
                if let when = binding.when {
                    Text(WhenClause.describe(when))
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            Spacer(minLength: 8)
            if binding.shortcut != binding.defaultShortcut {
                Text("Custom")
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(Theme.primary)
            }
            ShortcutRecorder(
                shortcut: binding.shortcut,
                recording: Binding(
                    get: { recording == binding.command },
                    set: { recording = $0 ? binding.command : nil }
                )
            ) { recorded in
                pages.setKeybinding(binding.command, shortcut: recorded)
            }
            Menu {
                Button("Reset to Default") {
                    pages.setKeybinding(binding.command, shortcut: binding.defaultShortcut)
                }
                .disabled(binding.shortcut == binding.defaultShortcut)
                Button("Remove Shortcut") {
                    pages.setKeybinding(binding.command, shortcut: nil)
                }
                .disabled(binding.shortcut == nil)
                Divider()
                Button("Copy Command ID") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(binding.command, forType: .string)
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 13, weight: .light))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("Shortcut options for \(binding.title)")
        }
    }
}

private struct ShortcutRecorder: View {
    let shortcut: String?
    @Binding var recording: Bool
    let record: (String) -> Void
    @State private var monitor: Any?

    var body: some View {
        Button {
            recording.toggle()
        } label: {
            Text(recording ? "Press shortcut…" : label)
                .font(.system(size: 12, weight: .medium, design: recording ? .default : .rounded))
                .foregroundStyle(recording ? Theme.primary : (shortcut == nil ? Theme.secondaryText : .primary))
                .padding(.horizontal, 8)
                .frame(minWidth: 64, minHeight: 22)
                .background(Theme.input, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay {
                    if recording {
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .strokeBorder(Theme.primary, lineWidth: 1)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(recording ? "Recording shortcut" : "Shortcut \(label)")
        .onChange(of: recording) { _, active in
            active ? start() : stop()
        }
        .onDisappear(perform: stop)
    }

    private var label: String {
        shortcut == nil ? "None" : ShortcutFormat.display(shortcut)
    }

    private func start() {
        stop()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == 53, event.modifierFlags.intersection(.deviceIndependentFlagsMask).isDisjoint(with: [.command, .control, .option, .shift]) {
                recording = false
                return nil
            }
            if let value = ShortcutFormat.record(event) {
                record(value)
                recording = false
            }
            return nil
        }
    }

    private func stop() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
        }
        monitor = nil
    }
}

enum ShortcutFormat {
    private static let names: [String: String] = [
        "return": "↩", "up": "↑", "down": "↓", "left": "←", "right": "→",
        "escape": "⎋", "tab": "⇥", "space": "Space", "delete": "⌫",
    ]

    private static let keyCodes: [UInt16: String] = [
        36: "return", 76: "return", 126: "up", 125: "down", 123: "left", 124: "right",
        53: "escape", 48: "tab", 49: "space", 51: "delete",
    ]

    static func display(_ shortcut: String?) -> String {
        guard let shortcut, !shortcut.isEmpty else { return "" }
        let (modifiers, key) = parse(shortcut)
        var glyphs = ""
        if modifiers.contains("ctrl") { glyphs += "⌃" }
        if modifiers.contains("option") { glyphs += "⌥" }
        if modifiers.contains("shift") { glyphs += "⇧" }
        if modifiers.contains("cmd") { glyphs += "⌘" }
        return glyphs + (names[key] ?? key.uppercased())
    }

    static func parse(_ shortcut: String) -> (modifiers: Set<String>, key: String) {
        if shortcut.hasSuffix("++") {
            let head = shortcut.dropLast(2).split(separator: "+").map(String.init)
            return (Set(head), "+")
        }
        var parts = shortcut.split(separator: "+").map(String.init)
        let key = parts.popLast() ?? ""
        return (Set(parts), key)
    }

    static func record(_ event: NSEvent) -> String? {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var parts: [String] = []
        if flags.contains(.command) { parts.append("cmd") }
        if flags.contains(.control) { parts.append("ctrl") }
        if flags.contains(.option) { parts.append("option") }
        if flags.contains(.shift) { parts.append("shift") }
        let key: String
        if let named = keyCodes[event.keyCode] {
            key = named
        } else if let base = event.characters(byApplyingModifiers: [])?.lowercased(), let first = base.first, !first.isWhitespace {
            key = String(first)
        } else {
            return nil
        }
        return (parts + [key]).joined(separator: "+")
    }

    static func keyboardShortcut(_ shortcut: String?) -> KeyboardShortcut? {
        guard let shortcut, !shortcut.isEmpty else { return nil }
        let (modifiers, key) = parse(shortcut)
        var flags: EventModifiers = []
        if modifiers.contains("cmd") { flags.insert(.command) }
        if modifiers.contains("ctrl") { flags.insert(.control) }
        if modifiers.contains("option") { flags.insert(.option) }
        if modifiers.contains("shift") { flags.insert(.shift) }
        let equivalents: [String: KeyEquivalent] = [
            "return": .return, "up": .upArrow, "down": .downArrow, "left": .leftArrow, "right": .rightArrow,
            "escape": .escape, "tab": .tab, "space": .space, "delete": .delete,
        ]
        if let named = equivalents[key] { return KeyboardShortcut(named, modifiers: flags) }
        guard key.count == 1, let character = key.first else { return nil }
        return KeyboardShortcut(KeyEquivalent(character), modifiers: flags)
    }
}

enum WhenClause {
    static func describe(_ clause: String) -> String {
        let terms: [(String, String)] = [
            ("!terminalFocus", "outside the terminal"), ("terminalFocus", "in the terminal"),
            ("!editableFocus", "outside text fields"), ("previewFocus", "in the browser"),
            ("modelPickerOpen", "with the model picker open"), ("usagePageOpen", "on the Usage page"),
            ("isDesktop", "in the app"),
        ]
        let described = clause.components(separatedBy: "&&").map { part -> String in
            let trimmed = part.trimmingCharacters(in: .whitespaces)
            return terms.first { $0.0 == trimmed }?.1 ?? trimmed
        }
        let joined = described.joined(separator: ", ")
        return joined.prefix(1).uppercased() + joined.dropFirst()
    }
}
