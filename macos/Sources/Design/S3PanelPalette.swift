import AppKit
import LocalStudioKit
import SwiftUI

enum PanelPalette {
    static let addedText = dynamic(dark: rgb(0.34, 0.80, 0.50), light: rgb(0.10, 0.50, 0.24))
    static let removedText = dynamic(dark: rgb(0.96, 0.42, 0.42), light: rgb(0.76, 0.16, 0.16))
    static let addedLine = dynamic(dark: NSColor(srgbRed: 0.18, green: 0.70, blue: 0.38, alpha: 0.10), light: NSColor(srgbRed: 0.18, green: 0.62, blue: 0.32, alpha: 0.10))
    static let removedLine = dynamic(dark: NSColor(srgbRed: 0.92, green: 0.30, blue: 0.30, alpha: 0.10), light: NSColor(srgbRed: 0.86, green: 0.22, blue: 0.22, alpha: 0.09))
    static let addedGutter = dynamic(dark: NSColor(srgbRed: 0.18, green: 0.70, blue: 0.38, alpha: 0.16), light: NSColor(srgbRed: 0.18, green: 0.62, blue: 0.32, alpha: 0.16))
    static let removedGutter = dynamic(dark: NSColor(srgbRed: 0.92, green: 0.30, blue: 0.30, alpha: 0.16), light: NSColor(srgbRed: 0.86, green: 0.22, blue: 0.22, alpha: 0.14))
    static let blueText = dynamic(dark: rgb(0.42, 0.66, 1.0), light: rgb(0.10, 0.36, 0.82))
    static let orangeText = dynamic(dark: rgb(1.0, 0.62, 0.30), light: rgb(0.74, 0.36, 0.04))
    static let blueLine = dynamic(dark: NSColor(srgbRed: 0.25, green: 0.50, blue: 1.0, alpha: 0.11), light: NSColor(srgbRed: 0.20, green: 0.45, blue: 0.95, alpha: 0.09))
    static let orangeLine = dynamic(dark: NSColor(srgbRed: 1.0, green: 0.55, blue: 0.20, alpha: 0.11), light: NSColor(srgbRed: 0.95, green: 0.50, blue: 0.10, alpha: 0.10))
    static let blueGutter = dynamic(dark: NSColor(srgbRed: 0.25, green: 0.50, blue: 1.0, alpha: 0.18), light: NSColor(srgbRed: 0.20, green: 0.45, blue: 0.95, alpha: 0.15))
    static let orangeGutter = dynamic(dark: NSColor(srgbRed: 1.0, green: 0.55, blue: 0.20, alpha: 0.18), light: NSColor(srgbRed: 0.95, green: 0.50, blue: 0.10, alpha: 0.16))
    static let hunk = dynamic(dark: NSColor(white: 1, alpha: 0.03), light: NSColor(srgbRed: 0.94, green: 0.95, blue: 0.97, alpha: 1))
    static let terminalForeground = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? NSColor(white: 0.86, alpha: 1) : NSColor(white: 0.13, alpha: 1)
    }
    static let terminalBackground = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            ? NSColor(srgbRed: 0.0392, green: 0.0392, blue: 0.0392, alpha: 1)
            : NSColor(srgbRed: 0.9895, green: 0.9895, blue: 0.9895, alpha: 1)
    }

    struct Diff {
        let addedText: Color
        let removedText: Color
        let addedLine: Color
        let removedLine: Color
        let addedGutter: Color
        let removedGutter: Color
    }

    static func diff(_ colors: DiffColors?) -> Diff {
        switch colors {
        case .blueOrange:
            Diff(addedText: blueText, removedText: orangeText, addedLine: blueLine, removedLine: orangeLine, addedGutter: blueGutter, removedGutter: orangeGutter)
        case .redGreen, nil:
            Diff(addedText: addedText, removedText: removedText, addedLine: addedLine, removedLine: removedLine, addedGutter: addedGutter, removedGutter: removedGutter)
        }
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
