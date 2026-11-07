import SwiftUI

struct PageHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    var leadingInset: CGFloat = 0
    @ViewBuilder let trailing: Trailing

    init(_ title: String, subtitle: String? = nil, leadingInset: CGFloat = 0, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.subtitle = subtitle
        self.leadingInset = leadingInset
        self.trailing = trailing()
    }

    var body: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 12)
            trailing
        }
        .padding(.leading, 16 + leadingInset)
        .padding(.trailing, 12)
        .frame(height: Theme.Metrics.titlebarHeight)
        .background {
            Theme.canvas
                .contentShape(Rectangle())
                .gesture(WindowDragGesture())
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.hairline).frame(height: 1)
        }
    }
}

extension PageHeader where Trailing == EmptyView {
    init(_ title: String, subtitle: String? = nil, leadingInset: CGFloat = 0) {
        self.init(title, subtitle: subtitle, leadingInset: leadingInset) { EmptyView() }
    }
}

struct PageEmptyState: View {
    let symbol: String
    let title: String
    var message: String?

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 24, weight: .light))
                .foregroundStyle(Theme.chromeIcon)
            Text(title)
                .font(.system(size: 13, weight: .medium))
            if let message {
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 360)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}

struct PageCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metrics.rowRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Metrics.rowRadius, style: .continuous)
                    .strokeBorder(Theme.hairline, lineWidth: 1)
            }
    }
}

enum PageFormat {
    static func tokens(_ value: UInt64) -> String {
        let number = Double(value)
        switch value {
        case 1_000_000_000...: return String(format: "%.2fB", number / 1_000_000_000)
        case 1_000_000...: return String(format: "%.1fM", number / 1_000_000)
        case 10_000...: return String(format: "%.0fk", number / 1_000)
        case 1_000...: return String(format: "%.1fk", number / 1_000)
        default: return "\(value)"
        }
    }

    static func cost(_ value: Double) -> String {
        value.formatted(.currency(code: "USD").precision(.fractionLength(value >= 100 ? 0 : 2)))
    }

    static func count(_ value: UInt64) -> String {
        value.formatted(.number)
    }

    static func gigabytes(_ bytes: UInt64) -> String {
        let value = Double(bytes) / 1_073_741_824
        return value >= 100 ? String(format: "%.0f GB", value) : String(format: "%.1f GB", value)
    }

    static func relative(_ milliseconds: Int64, now: Date = .now) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000)
        let seconds = now.timeIntervalSince(date)
        switch seconds {
        case ..<60: return "now"
        case ..<3600: return "\(Int(seconds / 60))m"
        case ..<86_400: return "\(Int(seconds / 3600))h"
        default: return "\(Int(seconds / 86_400))d"
        }
    }
}
