import AppKit
import SwiftUI

@MainActor
enum Motion {
    static var reducedOverride: Bool?

    static var reduced: Bool {
        reducedOverride ?? NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }

    static var structural: Animation? {
        reduced ? nil : .smooth(duration: 0.22)
    }

    static var reorder: Animation? {
        reduced ? nil : .snappy(duration: 0.3)
    }

    static var confirm: Animation? {
        reduced ? nil : .snappy(duration: 0.2)
    }
}

extension View {
    func motion<Value: Equatable>(_ animation: Animation?, value: Value) -> some View {
        transaction(value: value) { transaction in
            guard let animation else { return }
            transaction.disablesAnimations = false
            transaction.animation = animation
        }
    }
}
