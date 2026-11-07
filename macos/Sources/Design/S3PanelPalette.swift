import AppKit
import LocalStudioKit
import SwiftUI

enum PanelPalette {
    static let blueText = dynamic(dark: rgb(0.42, 0.66, 1.0), light: rgb(0.10, 0.36, 0.82))
    static let orangeText = dynamic(dark: rgb(1.0, 0.62, 0.30), light: rgb(0.74, 0.36, 0.04))
    static let blueLine = dynamic(dark: NSColor(srgbRed: 0.25, green: 0.50, blue: 1.0, alpha: 0.11), light: NSColor(srgbRed: 0.20, green: 0.45, blue: 0.95, alpha: 0.09))
    static let orangeLine = dynamic(dark: NSColor(srgbRed: 1.0, green: 0.55, blue: 0.20, alpha: 0.11), light: NSColor(srgbRed: 0.95, green: 0.50, blue: 0.10, alpha: 0.10))
    static let blueGutter = dynamic(dark: NSColor(srgbRed: 0.25, green: 0.50, blue: 1.0, alpha: 0.18), light: NSColor(srgbRed: 0.20, green: 0.45, blue: 0.95, alpha: 0.15))
    static let orangeGutter = dynamic(dark: NSColor(srgbRed: 1.0, green: 0.55, blue: 0.20, alpha: 0.18), light: NSColor(srgbRed: 0.95, green: 0.50, blue: 0.10, alpha: 0.16))

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
            Diff(
                addedText: Theme.diffAdded, removedText: Theme.diffRemoved, addedLine: Theme.diffAddedSurface,
                removedLine: Theme.diffRemovedSurface, addedGutter: Theme.diffAddedGutter, removedGutter: Theme.diffRemovedGutter
            )
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
