import Foundation

enum ThemeImportError: LocalizedError {
    case notJSON
    case noCanvas
    case noColors

    var errorDescription: String? {
        switch self {
        case .notJSON: "The file is not a JSON theme."
        case .noCanvas: "That VS Code theme has no \u{201C}editor.background\u{201D} color, so there is nothing to build a palette from."
        case .noColors: "The theme file has no colors."
        }
    }
}

enum ThemeImport {
    static func load(_ data: Data, taken: Set<String>) throws -> ThemeDefinition {
        guard let object = try? JSONSerialization.jsonObject(with: data, options: [.json5Allowed]) as? [String: Any] else {
            throw ThemeImportError.notJSON
        }
        if isVSCode(object) {
            return try vsCode(object, taken: taken)
        }
        return try themeFile(object, taken: taken)
    }

    static func isVSCode(_ object: [String: Any]) -> Bool {
        if (object["version"] as? Int) == 1 { return false }
        let colors = object["colors"] as? [String: Any] ?? [:]
        return colors.keys.contains { $0.contains(".") } || object["tokenColors"] is [Any]
    }

    private static func themeFile(_ object: [String: Any], taken: Set<String>) throws -> ThemeDefinition {
        guard let rawColors = object["colors"] as? [String: Any] else { throw ThemeImportError.noColors }
        let colors = rawColors.compactMapValues { value -> String? in
            guard let text = value as? String, ThemeColorParser.parse(text) != nil else { return nil }
            return text
        }
        guard !colors.isEmpty else { throw ThemeImportError.noColors }
        let name = (object["name"] as? String) ?? (object["label"] as? String) ?? "Imported theme"
        let appearance = (object["appearance"] as? String).flatMap(ThemeAppearance.init(rawValue:)) ?? appearanceOf(colors["canvas"])
        var variants: [String: [String: String]] = [:]
        for (key, value) in object["variants"] as? [String: Any] ?? [:] {
            guard let mode = ThemeAppearance(rawValue: key), mode != appearance, let roles = value as? [String: Any] else { continue }
            variants[mode.rawValue] = roles.compactMapValues { $0 as? String }
        }
        let requested = (object["id"] as? String).map { $0.lowercased() }
        let builtInIds = Set(ThemeLibrary.builtIns.map(\.id))
        let id = requested.flatMap { taken.contains($0) || builtInIds.contains($0) ? nil : $0 }
            ?? ThemeLibrary.identifier(for: name, taken: taken)
        return ThemeDefinition(id: id, label: String(name.prefix(48)), appearance: appearance, colors: colors, variants: variants.isEmpty ? nil : variants)
    }

    private static func appearanceOf(_ canvas: String?) -> ThemeAppearance {
        guard let canvas = canvas.flatMap(ThemeColorParser.parse) else { return .dark }
        return canvas.luminance < 0.179 ? .dark : .light
    }

    private static func humanize(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard !trimmed.contains(" "), trimmed.contains(where: { "-_.".contains($0) }) else { return trimmed }
        return trimmed.split(whereSeparator: { "-_.".contains($0) })
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    private static func vsCode(_ object: [String: Any], taken: Set<String>) throws -> ThemeDefinition {
        let raw = object["colors"] as? [String: Any] ?? [:]
        func pick(_ keys: String...) -> RGBA? {
            for key in keys {
                if let text = raw[key] as? String, let color = ThemeColorParser.parse(text) { return color }
            }
            return nil
        }
        guard let canvasColor = pick("editor.background", "editorPane.background") else { throw ThemeImportError.noCanvas }
        let canvas = canvasColor.flattened(over: RGBA(red: 0, green: 0, blue: 0))
        let type = (object["type"] as? String)?.lowercased()
        let appearance: ThemeAppearance = switch type {
        case "light", "hc-light": .light
        case "dark", "hc-black": .dark
        default: canvas.luminance < 0.179 ? .dark : .light
        }
        let ink = appearance == .dark ? RGBA(red: 1, green: 1, blue: 1) : RGBA(red: 0, green: 0, blue: 0)
        func readable(_ surface: RGBA, _ fallback: RGBA, _ keys: String...) -> RGBA {
            for key in keys {
                if let text = raw[key] as? String, let color = ThemeColorParser.parse(text) {
                    let solid = color.flattened(over: surface)
                    if solid.contrast(with: surface) >= 4.5 { return solid }
                }
            }
            if fallback.contrast(with: surface) >= 4.5 { return fallback }
            return surface.luminance < 0.179 ? RGBA(red: 1, green: 1, blue: 1) : RGBA(red: 0, green: 0, blue: 0)
        }
        func solid(_ base: RGBA, _ keys: String...) -> RGBA? {
            for key in keys {
                if let text = raw[key] as? String, let color = ThemeColorParser.parse(text) { return color.flattened(over: base) }
            }
            return nil
        }
        let text = readable(canvas, canvas.mixed(with: ink, amount: 0.9), "editor.foreground", "foreground")
        let muted = readable(canvas, text.mixed(with: canvas, amount: 0.42), "descriptionForeground", "disabledForeground")
        let sidebar = solid(canvas, "sideBar.background", "activityBar.background")
            ?? (appearance == .dark ? canvas.mixed(with: RGBA(red: 0, green: 0, blue: 0), amount: 0.25) : canvas.mixed(with: text, amount: 0.02))
        let sidebarText = readable(sidebar, text, "sideBar.foreground")
        let accent = solid(canvas, "focusBorder", "button.background", "textLink.foreground", "activityBarBadge.background", "progressBar.background", "badge.background")
            ?? ThemeColorParser.parse(ThemeLibrary.bundle?.standard[appearance.rawValue]?["accent"] ?? "") ?? RGBA(red: 0.2, green: 0.42, blue: 0.94)
        let action = solid(canvas, "button.background") ?? accent
        let terminal = solid(canvas, "terminal.background", "panel.background") ?? canvas
        var colors = ThemeLibrary.bundle?.standard[appearance.rawValue] ?? [:]
        let roles: [String: RGBA] = [
            "canvas": canvas, "chrome": canvas, "toolbar": canvas, "toolbarForeground": text,
            "toolbarBorder": solid(canvas, "panel.border", "editorGroup.border") ?? canvas.mixed(with: text, amount: 0.1),
            "toolbarControl": canvas.mixed(with: text, amount: 0.04), "toolbarControlForeground": text,
            "toolbarControlHover": canvas.mixed(with: text, amount: 0.07),
            "surface": solid(canvas, "editorWidget.background") ?? canvas.mixed(with: text, amount: 0.035),
            "surfaceRaised": solid(canvas, "editorWidget.background", "dropdown.background") ?? canvas.mixed(with: text, amount: 0.035),
            "surfaceOverlay": solid(canvas, "menu.background", "quickInput.background", "dropdown.background") ?? canvas.mixed(with: text, amount: 0.05),
            "text": text, "textMuted": muted, "placeholder": readable(canvas, muted, "input.placeholderForeground"),
            "secondaryLabel": muted, "iconMuted": muted, "mutedForeground": muted,
            "border": solid(canvas, "panel.border", "editorGroup.border", "contrastBorder") ?? canvas.mixed(with: text, amount: 0.1),
            "input": solid(canvas, "input.border", "dropdown.border") ?? canvas.mixed(with: text, amount: 0.14),
            "focus": accent, "accent": accent, "accentForeground": readable(accent, RGBA(red: 1, green: 1, blue: 1), "button.foreground"),
            "errorForeground": readable(canvas, ThemeColorParser.parse(colors["errorForeground"] ?? "") ?? text, "editorError.foreground", "errorForeground"),
            "warningForeground": readable(canvas, ThemeColorParser.parse(colors["warningForeground"] ?? "") ?? text, "editorWarning.foreground"),
            "accentSurface": solid(canvas, "list.activeSelectionBackground", "list.hoverBackground") ?? canvas.mixed(with: text, amount: 0.07),
            "messageSurface": canvas.mixed(with: text, amount: 0.07), "messageForeground": text,
            "messageAction": action, "messageActionForeground": readable(action, RGBA(red: 1, green: 1, blue: 1), "button.foreground"),
            "codeBackground": solid(canvas, "textCodeBlock.background") ?? canvas.mixed(with: text, amount: 0.035), "codeForeground": text,
            "sidebar": sidebar, "sidebarForeground": sidebarText, "sidebarMutedForeground": sidebarText.mixed(with: sidebar, amount: 0.4),
            "sidebarBorder": solid(sidebar, "sideBar.border") ?? sidebar.mixed(with: sidebarText, amount: 0.08),
            "sidebarRowHover": solid(sidebar, "list.hoverBackground") ?? sidebar.mixed(with: sidebarText, amount: 0.05),
            "sidebarRowActive": solid(sidebar, "list.inactiveSelectionBackground", "list.hoverBackground") ?? sidebar.mixed(with: sidebarText, amount: 0.09),
            "sidebarRowSelected": solid(sidebar, "list.activeSelectionBackground") ?? sidebar.mixed(with: sidebarText, amount: 0.07),
            "terminalBackground": terminal, "terminalForeground": readable(terminal, text, "terminal.foreground"),
            "terminalCursor": solid(terminal, "terminalCursor.foreground", "editorCursor.foreground") ?? accent,
            "terminalSelection": solid(terminal, "terminal.selectionBackground", "editor.selectionBackground") ?? terminal.mixed(with: text, amount: 0.2),
        ]
        for (role, color) in roles {
            colors[role] = color.hex
        }
        let name = [object["displayName"], object["name"]].compactMap { $0 as? String }.map(humanize).first { !$0.isEmpty } ?? "VS Code theme"
        return ThemeDefinition(
            id: ThemeLibrary.identifier(for: name, taken: taken), label: String(name.prefix(48)),
            appearance: appearance, colors: colors, variants: nil
        )
    }
}
