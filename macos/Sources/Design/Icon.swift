import SwiftUI

enum IconSize {
    case tile
    case inline
    case control
    case toolbar
    case display

    var points: CGFloat {
        switch self {
        case .tile: 12
        case .inline: 12.5
        case .control: 14
        case .toolbar: 15
        case .display: 26
        }
    }

    var weight: Font.Weight {
        switch self {
        case .tile: .semibold
        case .inline, .control, .toolbar, .display: .regular
        }
    }

    var heavyWeight: Font.Weight {
        switch self {
        case .tile: .bold
        case .inline, .control, .toolbar, .display: .medium
        }
    }
}

enum IconTone {
    case primary
    case secondary
}

struct IconStyle: ViewModifier {
    let size: IconSize
    let tone: IconTone?
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.legibilityWeight) private var legibility

    func body(content: Content) -> some View {
        let styled = content
            .font(.system(size: size.points, weight: heavy ? size.heavyWeight : size.weight))
            .symbolRenderingMode(.monochrome)
            .imageScale(.medium)
        if let tone {
            styled.foregroundStyle(tone == .primary || heavy ? Theme.text : Theme.secondaryText)
        } else {
            styled
        }
    }

    private var heavy: Bool {
        contrast == .increased || legibility == .bold
    }
}

struct IconLabel: View {
    let title: String
    let symbol: String
    let size: IconSize

    init(_ title: String, symbol: String, size: IconSize = .inline) {
        self.title = title
        self.symbol = symbol
        self.size = size
    }

    var body: some View {
        Label {
            Text(title)
        } icon: {
            Image(systemName: symbol)
                .icon(size)
                .accessibilityHidden(true)
        }
    }
}

struct CloseIconButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .icon(.inline, .primary)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
    }
}

extension View {
    func icon(_ size: IconSize, _ tone: IconTone? = nil) -> some View {
        modifier(IconStyle(size: size, tone: tone))
    }
}
