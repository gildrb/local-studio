import AppKit
import SwiftUI

enum Theme {
    static var canvas: Color { ThemeTokens.shared.color(.canvas) }
    static var sidebar: Color { ThemeTokens.shared.color(.sidebar) }
    static var card: Color { ThemeTokens.shared.color(.card) }
    static var primary: Color { ThemeTokens.shared.color(.primary) }
    static var hairline: Color { ThemeTokens.shared.color(.hairline) }
    static var input: Color { ThemeTokens.shared.color(.input) }
    static var hover: Color { ThemeTokens.shared.color(.hover) }
    static var selection: Color { ThemeTokens.shared.color(.selection) }
    static var selectionStroke: Color { ThemeTokens.shared.color(.selectionStroke) }
    static var message: Color { ThemeTokens.shared.color(.message) }
    static var text: Color { ThemeTokens.shared.color(.text) }
    static var secondaryText: Color { ThemeTokens.shared.color(.secondaryText) }
    static var chromeIcon: Color { ThemeTokens.shared.color(.chromeIcon) }
    static var tertiaryText: Color { ThemeTokens.shared.color(.tertiaryText) }
    static var success: Color { ThemeTokens.shared.color(.success) }
    static var warning: Color { ThemeTokens.shared.color(.warning) }
    static var danger: Color { ThemeTokens.shared.color(.danger) }
    static var working: Color { ThemeTokens.shared.color(.working) }
    static var woke: Color { ThemeTokens.shared.color(.woke) }
    static var overlay: Color { ThemeTokens.shared.color(.overlay) }
    static var shadow: Color { ThemeTokens.shared.color(.shadow) }
    static var code: Color { ThemeTokens.shared.color(.code) }
    static var codeText: Color { ThemeTokens.shared.color(.codeText) }
    static var terminal: Color { ThemeTokens.shared.color(.terminal) }
    static var diffAdded: Color { ThemeTokens.shared.color(.diffAdded) }
    static var diffRemoved: Color { ThemeTokens.shared.color(.diffRemoved) }
    static var diffAddedSurface: Color { ThemeTokens.shared.color(.diffAddedSurface) }
    static var diffRemovedSurface: Color { ThemeTokens.shared.color(.diffRemovedSurface) }
    static var diffAddedGutter: Color { ThemeTokens.shared.color(.diffAddedGutter) }
    static var diffRemovedGutter: Color { ThemeTokens.shared.color(.diffRemovedGutter) }
    static var diffHunk: Color { ThemeTokens.shared.color(.diffHunk) }

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
