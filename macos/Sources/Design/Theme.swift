import AppKit
import SwiftUI

enum Theme {
    static let canvas = dynamic(dark: rgb(0.0392, 0.0392, 0.0392), light: rgb(0.9895, 0.9895, 0.9895))
    static let sidebar = dynamic(dark: rgb(0.068, 0.068, 0.068), light: rgb(0.98, 0.98, 0.98))
    static let card = dynamic(dark: rgb(0.068, 0.068, 0.068), light: rgb(1, 1, 1))
    static let primary = dynamic(dark: rgb(0.2044, 0.4198, 0.9449), light: rgb(0.1043, 0.3071, 0.8463))
    static let hairline = dynamic(dark: NSColor(white: 1, alpha: 0.06), light: rgb(0.894, 0.894, 0.906))
    static let input = dynamic(dark: NSColor(white: 1, alpha: 0.08), light: rgb(0.831, 0.831, 0.847))
    static let hover = dynamic(dark: NSColor(white: 1, alpha: 0.04), light: rgb(0.957, 0.957, 0.961))
    static let selection = dynamic(dark: NSColor(white: 1, alpha: 0.07), light: rgb(0.937, 0.937, 0.945))
    static let selectionStroke = dynamic(dark: NSColor(white: 1, alpha: 0.09), light: rgb(0.894, 0.894, 0.906))
    static let message = dynamic(dark: NSColor(white: 1, alpha: 0.06), light: rgb(0.957, 0.957, 0.961))
    static let secondaryText = dynamic(dark: rgb(0.5059, 0.5059, 0.5059), light: rgb(0.443, 0.443, 0.478))
    static let chromeIcon = dynamic(dark: NSColor(white: 1, alpha: 0.6), light: NSColor(white: 0, alpha: 0.55))
    static let tertiaryText = dynamic(dark: rgb(0.36, 0.36, 0.36), light: rgb(0.62, 0.62, 0.65))
    static let success = dynamic(dark: rgb(0.204, 0.827, 0.6), light: rgb(0.02, 0.588, 0.412))
    static let warning = dynamic(dark: rgb(0.984, 0.749, 0.141), light: rgb(0.851, 0.467, 0.024))
    static let danger = dynamic(dark: rgb(0.973, 0.443, 0.443), light: rgb(0.863, 0.149, 0.149))
    static let working = dynamic(dark: rgb(0.22, 0.741, 0.973), light: rgb(0.008, 0.518, 0.78))
    static let woke = dynamic(dark: rgb(0.984, 0.573, 0.235), light: rgb(0.918, 0.345, 0.047))
    static let overlay = dynamic(dark: rgb(0.086, 0.086, 0.086), light: rgb(1, 1, 1))
    static let shadow = dynamic(dark: NSColor(white: 0, alpha: 0.5), light: NSColor(white: 0, alpha: 0.14))

    enum Metrics {
        static let titlebarHeight: CGFloat = 52
        static let trafficLightsWidth: CGFloat = 78
        static let rowHeight: CGFloat = 32
        static let cardRowHeight: CGFloat = 56
        static let rowRadius: CGFloat = 10
        static let tile: CGFloat = 18
        static let sidebarInset: CGFloat = 8
        static let chromeButton: CGFloat = 28
        static let trailingChromeInset: CGFloat = 76
    }

    private static func rgb(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat) -> NSColor {
        NSColor(srgbRed: red, green: green, blue: blue, alpha: 1)
    }

    private static func dynamic(dark: NSColor, light: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
        })
    }
}

struct ChromeIconButton: View {
    let title: String
    let symbol: String
    let isOn: Bool
    let badge: Int
    let action: () -> Void
    @State private var hovering = false

    init(_ title: String, symbol: String, isOn: Bool = false, badge: Int = 0, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.isOn = isOn
        self.badge = badge
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .light))
                .foregroundStyle(isOn ? Color.primary : Theme.chromeIcon)
                .frame(width: Theme.Metrics.chromeButton, height: Theme.Metrics.chromeButton)
                .background(isOn ? Theme.selection : hovering ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        Text("\(badge)")
                            .font(.system(size: 9, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 14, minHeight: 14)
                            .background(Theme.primary, in: Capsule())
                            .offset(x: 3, y: -2)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
        .onHover { hovering = $0 }
    }
}

struct RowSurface: ViewModifier {
    let selected: Bool
    let hovering: Bool

    func body(content: Content) -> some View {
        content
            .background {
                let shape = RoundedRectangle(cornerRadius: Theme.Metrics.rowRadius, style: .continuous)
                if selected {
                    shape.fill(Theme.selection)
                        .overlay(shape.strokeBorder(Theme.selectionStroke, lineWidth: 0.8))
                } else if hovering {
                    shape.fill(Theme.hover)
                }
            }
    }
}

extension View {
    func rowSurface(selected: Bool, hovering: Bool) -> some View {
        modifier(RowSurface(selected: selected, hovering: hovering))
    }
}
