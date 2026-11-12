import AppKit
import SwiftUI

struct SettingsTile: View {
    let symbol: String
    let color: NSColor
    var size: CGFloat = 20

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.25, style: .continuous)
            .fill(Color(nsColor: color).gradient)
            .overlay {
                RoundedRectangle(cornerRadius: size * 0.25, style: .continuous)
                    .strokeBorder(.white.opacity(0.14), lineWidth: 0.5)
            }
            .overlay {
                Image(systemName: symbol)
                    .resizable()
                    .scaledToFit()
                    .icon(.tile)
                    .foregroundStyle(.white)
                    .frame(width: size * 0.65, height: size * 0.65)
            }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
