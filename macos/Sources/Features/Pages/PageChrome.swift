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
        .padding(.trailing, Theme.Metrics.trailingChromeInset)
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

extension View {
    func pageHeader<Header: View>(@ViewBuilder _ header: () -> Header) -> some View {
        frame(maxWidth: .infinity, maxHeight: .infinity)
            .safeAreaInset(edge: .top, spacing: 0, content: header)
            .background(Theme.canvas)
    }
}

struct PageEmptyState: View {
    let symbol: String?
    let title: String
    var message: String?

    static func loading(_ title: String) -> PageEmptyState {
        PageEmptyState(symbol: nil, title: title)
    }

    var body: some View {
        VStack(spacing: 8) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 24, weight: .light))
                    .foregroundStyle(Theme.chromeIcon)
            } else {
                LogoMark(style: .coin)
                    .frame(width: 30, height: 30)
                    .accessibilityHidden(true)
            }
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
        let style = FloatingPointFormatStyle<Double>.Currency(code: "USD")
        switch value {
        case 100...: return value.formatted(style.precision(.fractionLength(0)))
        case 0.01...: return value.formatted(style.precision(.fractionLength(2)))
        case let small where small > 0: return value.formatted(style.precision(.significantDigits(1...2)))
        default: return value.formatted(style.precision(.fractionLength(2)))
        }
    }

    static func count(_ value: UInt64) -> String {
        value.formatted(.number)
    }

    static func gigabytes(_ bytes: UInt64) -> String {
        let value = Double(bytes) / 1_073_741_824
        return value >= 100 ? String(format: "%.0f GB", value) : String(format: "%.1f GB", value)
    }

    static func ago(_ milliseconds: Int64) -> String {
        let age = relative(milliseconds)
        return age == "now" ? "just now" : "\(age) ago"
    }

    static func until(_ milliseconds: Int64, now: Date = .now) -> String {
        let seconds = Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000).timeIntervalSince(now)
        switch seconds {
        case ..<60: return "in under a minute"
        case ..<3600: return "in \(Int(seconds / 60))m"
        case ..<86_400: return "in \(Int(seconds / 3600))h \(Int(seconds.truncatingRemainder(dividingBy: 3600) / 60))m"
        default: return "in \(Int(seconds / 86_400))d"
        }
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
