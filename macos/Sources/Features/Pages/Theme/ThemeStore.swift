import AppKit
import LocalStudioKit
import Observation
import SwiftUI
import Synchronization

enum ThemeToken: String, CaseIterable, Sendable {
    case canvas, sidebar, card, primary, hairline, input, hover, selection, selectionStroke, message
    case text, secondaryText, chromeIcon, tertiaryText, success, warning, danger, working, woke, overlay, shadow
    case code, codeText, terminal, terminalText, terminalCursor, terminalSelection
    case diffAdded, diffRemoved, diffAddedSurface, diffRemovedSurface, diffAddedGutter, diffRemovedGutter, diffHunk
    case terminalAnsiBlack, terminalAnsiRed, terminalAnsiGreen, terminalAnsiYellow
    case terminalAnsiBlue, terminalAnsiMagenta, terminalAnsiCyan, terminalAnsiWhite
    case terminalAnsiBrightBlack, terminalAnsiBrightRed, terminalAnsiBrightGreen, terminalAnsiBrightYellow
    case terminalAnsiBrightBlue, terminalAnsiBrightMagenta, terminalAnsiBrightCyan, terminalAnsiBrightWhite
    case syntaxDefault, syntaxComment, syntaxKeyword, syntaxOperator, syntaxString, syntaxFunction, syntaxType
    case syntaxProperty, syntaxConstant, syntaxNumber, syntaxParameter, syntaxBuiltin, syntaxPunctuation

    static let ansi: [ThemeToken] = [
        .terminalAnsiBlack, .terminalAnsiRed, .terminalAnsiGreen, .terminalAnsiYellow,
        .terminalAnsiBlue, .terminalAnsiMagenta, .terminalAnsiCyan, .terminalAnsiWhite,
        .terminalAnsiBrightBlack, .terminalAnsiBrightRed, .terminalAnsiBrightGreen, .terminalAnsiBrightYellow,
        .terminalAnsiBrightBlue, .terminalAnsiBrightMagenta, .terminalAnsiBrightCyan, .terminalAnsiBrightWhite,
    ]

    var role: String? {
        switch self {
        case .canvas: "canvas"
        case .sidebar: "sidebar"
        case .card: "surface"
        case .primary: "accent"
        case .hairline: "border"
        case .input: "input"
        case .hover: "sidebarRowHover"
        case .selection: "sidebarRowActive"
        case .message: "messageSurface"
        case .text: "text"
        case .secondaryText: "textMuted"
        case .chromeIcon: "iconMuted"
        case .tertiaryText: "placeholder"
        case .warning: "warningForeground"
        case .danger: "errorForeground"
        case .overlay: "surfaceOverlay"
        case .code: "codeBackground"
        case .codeText: "codeForeground"
        case .terminal: "terminalBackground"
        case .terminalText: "terminalForeground"
        case .selectionStroke, .working, .woke, .shadow: nil
        default: rawValue
        }
    }

    var isText: Bool {
        switch self {
        case .text, .secondaryText, .chromeIcon, .tertiaryText, .codeText: true
        case .syntaxDefault, .syntaxComment, .syntaxKeyword, .syntaxOperator, .syntaxString, .syntaxFunction, .syntaxType: true
        case .syntaxProperty, .syntaxConstant, .syntaxNumber, .syntaxParameter, .syntaxBuiltin, .syntaxPunctuation: true
        default: false
        }
    }

    var isBorder: Bool {
        switch self {
        case .hairline, .input, .selectionStroke: true
        default: false
        }
    }
}

struct ThemePalette: Equatable, Sendable {
    var colors: [ThemeToken: RGBA]

    subscript(_ token: ThemeToken) -> RGBA {
        colors[token] ?? RGBA(red: 0, green: 0, blue: 0, alpha: 0)
    }
}

enum LegacyPalette {
    private static func gray(_ value: Double, _ alpha: Double = 1) -> RGBA { RGBA(red: value, green: value, blue: value, alpha: alpha) }
    private static func rgb(_ red: Double, _ green: Double, _ blue: Double, _ alpha: Double = 1) -> RGBA {
        RGBA(red: red, green: green, blue: blue, alpha: alpha)
    }

    private static let ansi = Dictionary(uniqueKeysWithValues: zip(ThemeToken.ansi, [
        "#000000", "#c23621", "#25bc24", "#adad27", "#492ee1", "#d338d3", "#33bbc8", "#cbcccd",
        "#818383", "#fc391f", "#31e722", "#eaec23", "#5833ff", "#f935f8", "#14f0f0", "#e9ebeb",
    ].compactMap(ThemeColorParser.parse)))

    private static func syntax(_ values: [ThemeToken: String]) -> [ThemeToken: RGBA] {
        values.compactMapValues(ThemeColorParser.parse)
    }

    private static let darkSyntax = syntax([
        .syntaxComment: "#8c929f", .syntaxKeyword: "#93beff", .syntaxOperator: "#b4bed2", .syntaxString: "#83d494",
        .syntaxFunction: "#d0aafc", .syntaxType: "#44d4e2", .syntaxProperty: "#78c8f6", .syntaxConstant: "#e8b273",
        .syntaxNumber: "#f9a870", .syntaxParameter: "#ffa282", .syntaxBuiltin: "#62d1dd", .syntaxPunctuation: "#9ea5b2",
    ])

    private static let lightSyntax = syntax([
        .syntaxComment: "#696f7b", .syntaxKeyword: "#345fb2", .syntaxOperator: "#454d5e", .syntaxString: "#007834",
        .syntaxFunction: "#764aa2", .syntaxType: "#007789", .syntaxProperty: "#006c9d", .syntaxConstant: "#8d5400",
        .syntaxNumber: "#9d4700", .syntaxParameter: "#a24019", .syntaxBuiltin: "#007583", .syntaxPunctuation: "#585e69",
    ])

    static let dark = ThemePalette(colors: [
        .canvas: gray(0.0392), .sidebar: gray(0.068), .card: gray(0.068), .primary: rgb(0.2044, 0.4198, 0.9449),
        .hairline: gray(1, 0.06), .input: gray(1, 0.08), .hover: gray(1, 0.04), .selection: gray(1, 0.07),
        .selectionStroke: gray(1, 0.09), .message: gray(1, 0.06), .text: gray(1, 0.85), .secondaryText: gray(0.5059),
        .chromeIcon: gray(1, 0.6), .tertiaryText: gray(0.36), .success: rgb(0.204, 0.827, 0.6), .warning: rgb(0.984, 0.749, 0.141),
        .danger: rgb(0.973, 0.443, 0.443), .working: rgb(0.22, 0.741, 0.973), .woke: rgb(0.984, 0.573, 0.235),
        .overlay: gray(0.086), .shadow: gray(0, 0.5),
        .code: gray(1, 0.036), .codeText: gray(1, 0.85), .syntaxDefault: gray(1, 0.85), .terminal: gray(0.0392), .terminalText: gray(0.86),
        .terminalCursor: rgb(0.2044, 0.4198, 0.9449), .terminalSelection: gray(1, 0.18),
        .diffAdded: rgb(0.34, 0.80, 0.50), .diffRemoved: rgb(0.96, 0.42, 0.42),
        .diffAddedSurface: rgb(0.18, 0.70, 0.38, 0.10), .diffRemovedSurface: rgb(0.92, 0.30, 0.30, 0.10),
        .diffAddedGutter: rgb(0.18, 0.70, 0.38, 0.16), .diffRemovedGutter: rgb(0.92, 0.30, 0.30, 0.16), .diffHunk: gray(1, 0.03),
    ].merging(ansi) { current, _ in current }.merging(darkSyntax) { current, _ in current })

    static let light = ThemePalette(colors: [
        .canvas: gray(0.9895), .sidebar: gray(0.98), .card: gray(1), .primary: rgb(0.1043, 0.3071, 0.8463),
        .hairline: rgb(0.894, 0.894, 0.906), .input: rgb(0.831, 0.831, 0.847), .hover: rgb(0.957, 0.957, 0.961),
        .selection: rgb(0.937, 0.937, 0.945), .selectionStroke: rgb(0.894, 0.894, 0.906), .message: rgb(0.957, 0.957, 0.961),
        .text: gray(0, 0.85), .secondaryText: rgb(0.443, 0.443, 0.478), .chromeIcon: gray(0, 0.55),
        .tertiaryText: rgb(0.62, 0.62, 0.65), .success: rgb(0.02, 0.588, 0.412), .warning: rgb(0.851, 0.467, 0.024),
        .danger: rgb(0.863, 0.149, 0.149), .working: rgb(0.008, 0.518, 0.78), .woke: rgb(0.918, 0.345, 0.047),
        .overlay: gray(1), .shadow: gray(0, 0.14),
        .code: rgb(0.957, 0.957, 0.961, 0.6), .codeText: gray(0, 0.85), .syntaxDefault: gray(0, 0.85), .terminal: gray(0.9895), .terminalText: gray(0.13),
        .terminalCursor: rgb(0.1043, 0.3071, 0.8463), .terminalSelection: gray(0, 0.12),
        .diffAdded: rgb(0.10, 0.50, 0.24), .diffRemoved: rgb(0.76, 0.16, 0.16),
        .diffAddedSurface: rgb(0.18, 0.62, 0.32, 0.10), .diffRemovedSurface: rgb(0.86, 0.22, 0.22, 0.09),
        .diffAddedGutter: rgb(0.18, 0.62, 0.32, 0.16), .diffRemovedGutter: rgb(0.86, 0.22, 0.22, 0.14), .diffHunk: rgb(0.94, 0.95, 0.97),
    ].merging(ansi) { current, _ in current }.merging(lightSyntax) { current, _ in current })

    static func palette(_ appearance: ThemeAppearance) -> ThemePalette {
        appearance == .dark ? dark : light
    }
}

struct ThemeSettingsSnapshot: Equatable {
    var themeId: String
    var custom: String
    var contrast: UInt32
    var glass: UInt32
    var scheme: LocalStudioKit.ColorScheme
    var interfaceFont: String
    var interfaceFontSize: UInt32
    var smoothing: Bool
}

@Observable
final class ThemeTokens: @unchecked Sendable {
    static let shared = ThemeTokens()

    private(set) var revision = 0
    @ObservationIgnored private let cache = Mutex<[ThemeToken: Color]>([:])
    @ObservationIgnored private let opaqueOverlay = Mutex<Color>(.clear)

    private init() {
        let palettes: [ThemeAppearance: ThemePalette] = [.dark: LegacyPalette.dark, .light: LegacyPalette.light]
        cache.withLock { $0 = Self.colors(palettes) }
        opaqueOverlay.withLock { $0 = Self.opaque(palettes) }
    }

    func color(_ token: ThemeToken) -> Color {
        _ = revision
        return cache.withLock { $0[token] } ?? .clear
    }

    func solidOverlay() -> Color {
        _ = revision
        return opaqueOverlay.withLock { $0 }
    }

    @MainActor func publish(_ palettes: [ThemeAppearance: ThemePalette]) {
        let colors = Self.colors(palettes)
        cache.withLock { $0 = colors }
        opaqueOverlay.withLock { $0 = Self.opaque(palettes) }
        revision += 1
    }

    private static func opaque(_ palettes: [ThemeAppearance: ThemePalette]) -> Color {
        let dark = (palettes[.dark]?[.overlay].nsColor ?? .clear).withAlphaComponent(1)
        let light = (palettes[.light]?[.overlay].nsColor ?? .clear).withAlphaComponent(1)
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
        })
    }

    private static func colors(_ palettes: [ThemeAppearance: ThemePalette]) -> [ThemeToken: Color] {
        var colors: [ThemeToken: Color] = [:]
        for token in ThemeToken.allCases {
            let dark = palettes[.dark]?[token].nsColor ?? .clear
            let light = palettes[.light]?[token].nsColor ?? .clear
            colors[token] = Color(nsColor: NSColor(name: nil) { appearance in
                appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
            })
        }
        return colors
    }
}

@MainActor
@Observable
final class ThemeStore {
    static let shared = ThemeStore()

    private(set) var custom: [ThemeDefinition] = []
    private(set) var activeId = ThemeLibrary.defaultId
    private(set) var contrast: UInt32 = 100
    private(set) var glass: UInt32 = 80
    private(set) var interfaceFont: Font?
    private(set) var editorOpen = false
    var preview: ThemeDefinition? {
        didSet { if preview != oldValue { rebuild() } }
    }

    @ObservationIgnored private(set) var palettes: [ThemeAppearance: ThemePalette] = [.dark: LegacyPalette.dark, .light: LegacyPalette.light]
    @ObservationIgnored private var snapshot: ThemeSettingsSnapshot?
    @ObservationIgnored let builtIns = ThemeLibrary.builtIns

    private init() {
        rebuild()
        _ = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated { ThemeStore.shared.rebuild() }
        }
    }

    var themes: [ThemeDefinition] {
        builtIns + custom
    }

    var active: ThemeDefinition {
        themes.first { $0.id == activeId } ?? ThemeLibrary.standard
    }

    func isCustom(_ id: String) -> Bool {
        custom.contains { $0.id == id }
    }

    func apply(_ settings: LocalStudioKit.Settings) {
        let next = ThemeSettingsSnapshot(
            themeId: settings.theme ?? ThemeLibrary.defaultId, custom: settings.customThemes, contrast: settings.contrast,
            glass: settings.glassOpacity, scheme: settings.colorScheme, interfaceFont: settings.interfaceFont,
            interfaceFontSize: settings.interfaceFontSize, smoothing: settings.fontSmoothing
        )
        if !editorOpen, preview != nil { preview = nil }
        guard next != snapshot else { return }
        let previous = snapshot
        snapshot = next
        if previous?.custom != next.custom {
            custom = ThemeLibrary.decodeCustom(next.custom)
        }
        activeId = themes.contains { $0.id == next.themeId } ? next.themeId : ThemeLibrary.defaultId
        contrast = next.contrast
        glass = next.glass
        let size = CGFloat(next.interfaceFontSize)
        if next.interfaceFont.isEmpty {
            interfaceFont = size == 13 ? nil : .system(size: size)
        } else {
            interfaceFont = .custom(next.interfaceFont, size: size)
        }
        if previous?.smoothing != next.smoothing {
            if next.smoothing {
                UserDefaults.standard.removeObject(forKey: "AppleFontSmoothing")
            } else {
                UserDefaults.standard.set(0, forKey: "AppleFontSmoothing")
            }
        }
        rebuild()
        applyAppearance(next.scheme)
    }

    func setEditorOpen(_ open: Bool) {
        editorOpen = open
    }

    func resolvedAppearance(for scheme: LocalStudioKit.ColorScheme) -> NSAppearance.Name? {
        let modes = (preview ?? active).modes
        if modes.count == 1, let only = modes.first {
            return only == .dark ? .darkAqua : .aqua
        }
        switch scheme {
        case .system: return nil
        case .light: return .aqua
        case .dark: return .darkAqua
        }
    }

    private func applyAppearance(_ scheme: LocalStudioKit.ColorScheme) {
        let name = resolvedAppearance(for: scheme)
        let target = name.flatMap(NSAppearance.init(named:))
        if NSApp?.appearance?.name != target?.name {
            NSApp?.appearance = target
        }
    }

    private func rebuild() {
        let theme = preview ?? active
        var next: [ThemeAppearance: ThemePalette] = [:]
        for appearance in ThemeAppearance.allCases {
            var palette = theme.id == ThemeLibrary.defaultId && preview == nil
                ? LegacyPalette.palette(appearance)
                : Self.resolve(theme, appearance)
            palette = Self.adjust(palette, contrast: Double(contrast), appearance: appearance)
            let opaque = WindowActivity.reducesTransparency
            palette.colors[.overlay]?.alpha = opaque ? 1 : 0.7 + 0.3 * Double(min(glass, 100)) / 100
            next[appearance] = palette
        }
        palettes = next
        ThemeTokens.shared.publish(next)
        if let scheme = snapshot?.scheme { applyAppearance(scheme) }
    }

    static func resolve(_ theme: ThemeDefinition, _ appearance: ThemeAppearance) -> ThemePalette {
        let legacy = LegacyPalette.palette(appearance)
        let source = theme.colors(for: appearance) ?? theme.colors(for: theme.appearance) ?? [:]
        let standard = ThemeLibrary.bundle?.standard[appearance.rawValue] ?? [:]
        func role(_ name: String) -> RGBA? {
            (source[name] ?? standard[name]).flatMap(ThemeColorParser.parse)
        }
        var colors = legacy.colors
        for token in ThemeToken.allCases {
            if let name = token.role, let value = role(name) { colors[token] = value }
        }
        if source["syntaxDefault"] == nil, let code = colors[.codeText] { colors[.syntaxDefault] = code }
        let text = colors[.text] ?? legacy[.text]
        let canvas = colors[.canvas] ?? legacy[.canvas]
        colors[.selectionStroke] = (colors[.input] ?? legacy[.input]).mixed(with: text, amount: 0.06)
        colors[.tertiaryText] = (colors[.tertiaryText] ?? legacy[.tertiaryText]).mixed(with: canvas, amount: 0.3)
        return ThemePalette(colors: colors)
    }

    static func adjust(_ palette: ThemePalette, contrast: Double, appearance: ThemeAppearance) -> ThemePalette {
        guard contrast != 100 else { return palette }
        let base = min(contrast, 100) / 100
        let boost = max(contrast - 100, 0) / 100
        let borderBoost = boost / 4
        let target = appearance == .dark ? RGBA(red: 1, green: 1, blue: 1) : RGBA(red: 0, green: 0, blue: 0)
        let background = palette[.canvas]
        let text = palette[.text]
        var colors = palette.colors
        for token in ThemeToken.allCases {
            guard var value = colors[token] else { continue }
            if token.isText {
                let alpha = value.alpha
                value = value.mixed(with: background, amount: 1 - base).mixed(with: target, amount: boost)
                value.alpha = alpha
            } else if token.isBorder {
                value.alpha *= base
                value = value.mixed(with: RGBA(red: text.red, green: text.green, blue: text.blue, alpha: value.alpha), amount: borderBoost)
            } else {
                continue
            }
            colors[token] = value
        }
        return ThemePalette(colors: colors)
    }
}

struct ThemeRoot: ViewModifier {
    func body(content: Content) -> some View {
        let store = ThemeStore.shared
        content
            .font(store.interfaceFont)
            .foregroundStyle(Theme.text)
            .tint(Theme.primary)
    }
}

extension View {
    func themeRoot() -> some View {
        modifier(ThemeRoot())
    }
}
