import Charts
import SwiftUI

struct DashboardTab<Leading: View>: View {
    let title: String
    let active: Bool
    var accessibility: String?
    let select: () -> Void
    @ViewBuilder var leading: Leading

    var body: some View {
        Button(action: select) {
            HStack(spacing: 7) {
                leading
                Text(title)
                    .lineLimit(1)
            }
            .font(.system(size: 13, weight: active ? .medium : .regular))
            .foregroundStyle(active ? Theme.text : Theme.secondaryText)
            .padding(.horizontal, 7)
            .padding(.vertical, 8)
            .overlay(alignment: .bottom) {
                if active {
                    Rectangle().fill(Theme.text).frame(height: 2)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibility ?? title)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

extension DashboardTab where Leading == EmptyView {
    init(title: String, active: Bool, select: @escaping () -> Void) {
        self.init(title: title, active: active, accessibility: nil, select: select) { EmptyView() }
    }
}

struct DashboardButtonStyle: ButtonStyle {
    var bordered = false

    func makeBody(configuration: Configuration) -> some View {
        DashboardButtonBody(configuration: configuration, bordered: bordered)
    }
}

private struct DashboardButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let bordered: Bool
    @State private var hovering = false
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(enabled ? Theme.text : Theme.secondaryText)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(configuration.isPressed || (hovering && enabled) ? Theme.hover : bordered ? Theme.card : .clear)
            )
            .overlay {
                if bordered {
                    RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(Theme.hairline)
                }
            }
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
    }
}

struct DashboardHero: View {
    let label: String
    let value: String?
    let unit: String
    let hint: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(value ?? "—")
                    .font(.system(size: 44, weight: .semibold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(unit)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondaryText)
            }
            Text(hint)
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

enum DashboardTone {
    case plain, warning, danger
}

struct DashboardFigure {
    let label: String
    let value: String?
    let unit: String
    var hint: String?
    var tone: DashboardTone = .plain
}

struct DashboardFigureRow: View {
    let column: CGFloat
    let figures: [DashboardFigure]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(figures, id: \.label) { figure in
                DashboardFigureView(figure: figure)
                    .frame(minWidth: 0, maxWidth: column, alignment: .leading)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct DashboardFigureView: View {
    let figure: DashboardFigure

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(figure.label)
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(figure.value ?? "—")
                    .font(.system(size: 22, weight: .semibold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(figure.unit)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .fixedSize()
            }
            hint
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var hint: some View {
        switch figure.tone {
        case .plain:
            Text(figure.hint ?? " ")
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
        case .warning, .danger:
            Label(figure.hint ?? "", systemImage: "exclamationmark.triangle")
                .font(.system(size: 13))
                .foregroundStyle(figure.tone == .danger ? Theme.danger : Theme.warning)
                .lineLimit(1)
        }
    }
}

struct DashboardSparkline: View {
    let values: [Double]
    let color: Color
    let label: String

    var body: some View {
        let peak = values.max() ?? 0
        Chart(Array(values.enumerated()), id: \.offset) { point in
            AreaMark(x: .value("Time", point.offset), y: .value("Value", point.element))
                .interpolationMethod(.catmullRom)
                .foregroundStyle(.linearGradient(colors: [color.opacity(0.22), color.opacity(0)], startPoint: .top, endPoint: .bottom))
            LineMark(x: .value("Time", point.offset), y: .value("Value", point.element))
                .interpolationMethod(.catmullRom)
                .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                .foregroundStyle(color)
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .chartXScale(domain: 0...max(1, values.count - 1))
        .chartYScale(domain: 0...(peak > 0 ? peak * 1.05 : 1))
        .accessibilityLabel(label)
        .transaction { $0.animation = nil }
    }
}
