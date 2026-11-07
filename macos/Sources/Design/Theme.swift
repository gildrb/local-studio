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

    enum Metrics {
        static let titlebarHeight: CGFloat = 52
        static let trafficLightsWidth: CGFloat = 78
        static let rowHeight: CGFloat = 32
        static let cardRowHeight: CGFloat = 54
        static let rowRadius: CGFloat = 10
        static let tile: CGFloat = 18
        static let sidebarInset: CGFloat = 8
        static let chromeButton: CGFloat = 28
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
    let action: () -> Void
    @State private var hovering = false

    init(_ title: String, symbol: String, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .light))
                .foregroundStyle(Theme.chromeIcon)
                .frame(width: Theme.Metrics.chromeButton, height: Theme.Metrics.chromeButton)
                .background(hovering ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
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
