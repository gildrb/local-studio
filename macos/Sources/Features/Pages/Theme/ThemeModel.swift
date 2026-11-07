import AppKit
import Foundation

enum ThemeAppearance: String, Codable, CaseIterable, Sendable {
    case light
    case dark
}

struct ThemeDefinition: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var label: String
    var appearance: ThemeAppearance
    var colors: [String: String]
    var variants: [String: [String: String]]?

    var modes: [ThemeAppearance] {
        ThemeAppearance.allCases.filter { colors(for: $0) != nil }
    }

    func colors(for appearance: ThemeAppearance) -> [String: String]? {
        if appearance == self.appearance { return colors }
        return variants?[appearance.rawValue]
    }

    func file() -> ThemeFile {
        ThemeFile(version: 1, id: id, name: label, appearance: appearance, colors: colors, variants: variants)
    }
}

struct ThemeFile: Codable {
    var version: Int?
    var id: String?
    var name: String?
    var label: String?
    var appearance: ThemeAppearance?
    var colors: [String: String]
    var variants: [String: [String: String]]?

    init(version: Int?, id: String?, name: String?, appearance: ThemeAppearance?, colors: [String: String], variants: [String: [String: String]]?) {
        self.version = version
        self.id = id
        self.name = name
        self.appearance = appearance
        self.colors = colors
        self.variants = variants
    }
}

struct RGBA: Equatable, Sendable {
    var red: Double
    var green: Double
    var blue: Double
    var alpha: Double

    var nsColor: NSColor {
        NSColor(srgbRed: red, green: green, blue: blue, alpha: alpha)
    }

    var hex: String {
        let channels = [red, green, blue].map { Int(($0 * 255).rounded()).clamped(to: 0...255) }
        return String(format: "#%02x%02x%02x", channels[0], channels[1], channels[2])
    }

    var luminance: Double {
        func linear(_ value: Double) -> Double {
            value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    init?(_ color: NSColor) {
        guard let srgb = color.usingColorSpace(.sRGB) else { return nil }
        self.init(red: srgb.redComponent, green: srgb.greenComponent, blue: srgb.blueComponent, alpha: srgb.alphaComponent)
    }

    func mixed(with other: RGBA, amount: Double) -> RGBA {
        let weight = amount.clamped(to: 0...1)
        return RGBA(
            red: red + (other.red - red) * weight,
            green: green + (other.green - green) * weight,
            blue: blue + (other.blue - blue) * weight,
            alpha: alpha + (other.alpha - alpha) * weight
        )
    }

    func flattened(over base: RGBA) -> RGBA {
        RGBA(
            red: red * alpha + base.red * (1 - alpha),
            green: green * alpha + base.green * (1 - alpha),
            blue: blue * alpha + base.blue * (1 - alpha)
        )
    }

    func contrast(with other: RGBA) -> Double {
        let lighter = max(luminance, other.luminance)
        let darker = min(luminance, other.luminance)
        return (lighter + 0.05) / (darker + 0.05)
    }
}

private extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

enum ThemeColorParser {
    static func parse(_ raw: String) -> RGBA? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if value.hasPrefix("#") { return hex(String(value.dropFirst())) }
        if value.hasPrefix("oklch(") { return oklch(arguments(value)) }
        if value.hasPrefix("rgb(") || value.hasPrefix("rgba(") { return rgb(arguments(value)) }
        return nil
    }

    private static func arguments(_ value: String) -> [String] {
        guard let open = value.firstIndex(of: "("), let close = value.lastIndex(of: ")"), open < close else { return [] }
        return value[value.index(after: open)..<close]
            .replacingOccurrences(of: ",", with: " ")
            .replacingOccurrences(of: "/", with: " / ")
            .split(separator: " ")
            .map(String.init)
    }

    private static func number(_ token: String, percentScale: Double) -> Double? {
        if token.hasSuffix("%") {
            return Double(token.dropLast()).map { $0 / 100 * percentScale }
        }
        return Double(token)
    }

    private static func alphaValue(_ parts: [String]) -> Double {
        guard let slash = parts.firstIndex(of: "/"), parts.indices.contains(slash + 1) else { return 1 }
        return number(parts[slash + 1], percentScale: 1) ?? 1
    }

    private static func hex(_ digits: String) -> RGBA? {
        let expanded: String
        switch digits.count {
        case 3, 4: expanded = digits.map { "\($0)\($0)" }.joined()
        case 6, 8: expanded = digits
        default: return nil
        }
        guard let value = UInt64(expanded, radix: 16) else { return nil }
        let hasAlpha = expanded.count == 8
        let shift: UInt64 = hasAlpha ? 8 : 0
        return RGBA(
            red: Double((value >> (16 + shift)) & 0xff) / 255,
            green: Double((value >> (8 + shift)) & 0xff) / 255,
            blue: Double((value >> shift) & 0xff) / 255,
            alpha: hasAlpha ? Double(value & 0xff) / 255 : 1
        )
    }

    private static func rgb(_ parts: [String]) -> RGBA? {
        let channels = parts.filter { $0 != "/" }
        guard channels.count >= 3,
              let red = number(channels[0], percentScale: 255),
              let green = number(channels[1], percentScale: 255),
              let blue = number(channels[2], percentScale: 255) else { return nil }
        let alpha = parts.contains("/") ? alphaValue(parts) : (channels.count > 3 ? number(channels[3], percentScale: 1) ?? 1 : 1)
        return RGBA(red: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
    }

    private static func oklch(_ parts: [String]) -> RGBA? {
        let channels = parts.prefix { $0 != "/" }
        guard channels.count >= 3,
              let lightness = number(channels[channels.startIndex], percentScale: 1),
              let chroma = number(channels[channels.startIndex + 1], percentScale: 0.4) else { return nil }
        let hue = Double(channels[channels.startIndex + 2].replacingOccurrences(of: "deg", with: "")) ?? 0
        let radians = hue * .pi / 180
        let labA = chroma * cos(radians)
        let labB = chroma * sin(radians)
        let lPrime = lightness + 0.3963377774 * labA + 0.2158037573 * labB
        let mPrime = lightness - 0.1055613458 * labA - 0.0638541728 * labB
        let sPrime = lightness - 0.0894841775 * labA - 1.2914855480 * labB
        let long = lPrime * lPrime * lPrime
        let medium = mPrime * mPrime * mPrime
        let short = sPrime * sPrime * sPrime
        let red = 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short
        let green = -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short
        let blue = -0.0041960863 * long - 0.7034186147 * medium + 1.7076147010 * short
        func encode(_ value: Double) -> Double {
            let clamped = value.clamped(to: 0...1)
            return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * pow(clamped, 1 / 2.4) - 0.055
        }
        return RGBA(red: encode(red), green: encode(green), blue: encode(blue), alpha: alphaValue(parts))
    }
}

enum ThemeLibrary {
    static let defaultId = "local-studio"

    struct Bundle: Decodable {
        let roles: [String]
        let standard: [String: [String: String]]
        let themes: [ThemeDefinition]
    }

    static let bundle: Bundle? = try? JSONDecoder().decode(Bundle.self, from: Data(BuiltInThemeData.json.utf8))

    static var roles: [String] { bundle?.roles ?? [] }

    static var standard: ThemeDefinition {
        ThemeDefinition(
            id: defaultId, label: "Local Studio", appearance: .dark,
            colors: bundle?.standard["dark"] ?? [:],
            variants: bundle?.standard["light"].map { ["light": $0] }
        )
    }

    static var builtIns: [ThemeDefinition] {
        [standard] + (bundle?.themes ?? [])
    }

    static func decodeCustom(_ json: String) -> [ThemeDefinition] {
        guard !json.isEmpty, let data = json.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([ThemeDefinition].self, from: data)) ?? []
    }

    static func encodeCustom(_ themes: [ThemeDefinition]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(themes), let json = String(bytes: data, encoding: .utf8) else { return "" }
        return json
    }

    static func identifier(for name: String, taken: Set<String>) -> String {
        let slug = name.lowercased()
            .map { $0.isLetter || $0.isNumber ? String($0) : "-" }
            .joined()
            .split(separator: "-")
            .joined(separator: "-")
        var base = String(slug.prefix(40))
        if base.isEmpty { base = "theme" }
        if taken.contains(base) || base == defaultId || base == "light" || base == "dark" || base == "system" { base += "-custom" }
        var candidate = base
        var index = 2
        while taken.contains(candidate) {
            candidate = "\(base)-\(index)"
            index += 1
        }
        return candidate
    }
}
