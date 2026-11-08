import LocalStudioKit
import SwiftUI

struct TokenSummary: View {
    let tokens: TokenHistory?
    let empty: String
    var rows: [(label: String, value: String?)] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(since)
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
            Text(tokens.map { LocalFormat.compact($0.total) } ?? "—")
                .font(.system(size: 44, weight: .bold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(split)
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 0) {
                row("Last 7 days", tokens.map { LocalFormat.compact($0.lastWeek) })
                Rectangle().fill(Theme.hairline).frame(height: 1)
                row("Busiest day", busiest)
                Rectangle().fill(Theme.hairline).frame(height: 1)
                row("Active days", tokens.map { "\($0.activeDays.formatted()) of \($0.trackedDays.formatted())" })
                ForEach(Array(rows.enumerated()), id: \.offset) { _, extra in
                    Rectangle().fill(Theme.hairline).frame(height: 1)
                    row(extra.label, extra.value)
                }
            }
            .padding(.top, 26)
        }
        .padding(.top, 2)
    }

    private var since: String {
        guard let day = tokens?.sinceDay, let date = LocalFormat.date(day) else { return "Tokens" }
        return "Tokens since \(LocalFormat.day(date, year: true))"
    }

    private var split: String {
        guard let tokens else { return " " }
        guard tokens.total > 0 else { return empty }
        return "\(LocalFormat.compact(tokens.read)) read, \(LocalFormat.compact(tokens.written)) written"
    }

    private var busiest: String? {
        guard let tokens, let day = tokens.busiestDay, let date = LocalFormat.date(day) else { return tokens == nil ? nil : "—" }
        return "\(LocalFormat.compact(tokens.busiestTokens)), \(LocalFormat.day(date, year: false))"
    }

    private func row(_ label: String, _ value: String?) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(Theme.secondaryText)
            Spacer(minLength: 8)
            Text(value ?? "—")
                .monospacedDigit()
                .lineLimit(1)
        }
        .font(.system(size: 13))
        .padding(.vertical, 8)
    }
}

struct DailyHeatmap: View {
    let values: [Double]?
    let lastDay: String?
    let label: String
    let format: (Double) -> String
    @State private var width: CGFloat = 900
    @State private var hovered: Int?

    var body: some View {
        let layout = HeatmapLayout(values: values, lastDay: lastDay, width: width)
        VStack(alignment: .leading, spacing: 10) {
            HeatmapGrid(
                layout: layout,
                empty: Theme.text.opacity(0.06),
                accent: Theme.primary,
                label: Theme.secondaryText
            )
            .equatable()
            .frame(height: layout.height)
            .overlay(alignment: .topLeading) {
                if let hovered, let frame = layout.frame(of: hovered) {
                    RoundedRectangle(cornerRadius: layout.radius, style: .continuous)
                        .strokeBorder(Theme.text.opacity(0.7), lineWidth: 1.5)
                        .frame(width: frame.width, height: frame.height)
                        .offset(x: frame.minX, y: frame.minY)
                        .allowsHitTesting(false)
                }
            }
            .onContinuousHover { phase in
                switch phase {
                case .active(let point): hovered = layout.index(at: point)
                case .ended: hovered = nil
                }
            }
            .accessibilityElement()
            .accessibilityLabel(label)
            .accessibilityValue(caption(layout))
            HStack(spacing: 6) {
                Text(caption(layout))
                    .foregroundStyle(Theme.secondaryText)
                    .monospacedDigit()
                Spacer()
                Text("Less")
                    .foregroundStyle(Theme.secondaryText)
                ForEach(0..<5, id: \.self) { level in
                    Circle()
                        .fill(level == 0 ? Theme.text.opacity(0.06) : Theme.primary.opacity(HeatmapLayout.opacities[level]))
                        .frame(width: 9, height: 9)
                }
                Text("More")
                    .foregroundStyle(Theme.secondaryText)
            }
            .font(.system(size: 11.5))
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    private func caption(_ layout: HeatmapLayout) -> String {
        guard let values, let index = hovered ?? (values.isEmpty ? nil : values.count - 1),
              let date = layout.date(of: index) else { return " " }
        return "\(LocalFormat.day(date, year: true)): \(format(values[index]))"
    }
}

struct HeatmapLayout: Equatable {
    static let opacities: [Double] = [0, 0.3, 0.5, 0.75, 1]
    static let columns = 53
    static let gap: CGFloat = 3
    static let labelHeight: CGFloat = 20

    let daily: [Double]
    let levels: [Int]
    let width: CGFloat
    let lastRow: Int
    let last: Date
    let months: [(column: Int, title: String)]

    static func == (lhs: HeatmapLayout, rhs: HeatmapLayout) -> Bool {
        lhs.daily == rhs.daily && lhs.width == rhs.width && lhs.lastRow == rhs.lastRow && lhs.last == rhs.last
    }

    init(values: [Double]?, lastDay: String?, width: CGFloat) {
        let daily = values ?? Array(repeating: 0, count: Self.columns * 7)
        let calendar = Self.calendar
        let last = lastDay.flatMap(LocalFormat.date) ?? calendar.startOfDay(for: .now)
        let weekday = calendar.component(.weekday, from: last)
        let lastRow = (weekday - Calendar.current.firstWeekday + 7) % 7
        let nonzero = daily.filter { $0 > 0 }.sorted()
        let scale = nonzero.isEmpty ? 1 : nonzero[min(nonzero.count - 1, nonzero.count * 9 / 10)]
        self.daily = daily
        self.levels = daily.map { value in value <= 0 ? 0 : 1 + min(3, Int(4 * value / scale)) }
        self.width = width
        self.lastRow = lastRow
        self.last = last
        var months: [(column: Int, title: String)] = []
        let symbols = calendar.shortStandaloneMonthSymbols
        for column in 0..<Self.columns {
            let offset = (Self.columns - 1 - column) * 7 + lastRow
            guard let top = calendar.date(byAdding: .day, value: -offset, to: last),
                  calendar.component(.day, from: top) <= 7 else { continue }
            months.append((column, symbols[calendar.component(.month, from: top) - 1]))
        }
        self.months = months
    }

    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        calendar.locale = .current
        return calendar
    }

    var pitch: CGFloat { (width + Self.gap) / CGFloat(Self.columns) }
    var cell: CGFloat { max(2, pitch - Self.gap) }
    var radius: CGFloat { cell * 0.2 }
    var height: CGFloat { Self.labelHeight + pitch * 7 - Self.gap }

    func position(of index: Int) -> (column: Int, row: Int)? {
        let offset = daily.count - 1 - index
        let slot = (Self.columns - 1) * 7 + lastRow - offset
        guard index >= 0, index < daily.count, slot >= 0 else { return nil }
        return (slot / 7, slot % 7)
    }

    func frame(of index: Int) -> CGRect? {
        position(of: index).map { CGRect(x: CGFloat($0.column) * pitch, y: Self.labelHeight + CGFloat($0.row) * pitch, width: cell, height: cell) }
    }

    func index(at point: CGPoint) -> Int? {
        guard point.y >= Self.labelHeight, point.x >= 0 else { return nil }
        let column = Int(point.x / pitch)
        let row = Int((point.y - Self.labelHeight) / pitch)
        guard column < Self.columns, row < 7 else { return nil }
        let index = daily.count - 1 - ((Self.columns - 1) * 7 + lastRow - (column * 7 + row))
        return index >= 0 && index < daily.count ? index : nil
    }

    func date(of index: Int) -> Date? {
        Self.calendar.date(byAdding: .day, value: index - (daily.count - 1), to: last)
    }
}

private struct HeatmapGrid: View, Equatable {
    let layout: HeatmapLayout
    let empty: Color
    let accent: Color
    let label: Color

    var body: some View {
        Canvas { context, size in
            for month in layout.months {
                let text = context.resolve(Text(month.title).font(.system(size: 11)).foregroundStyle(label))
                let x = CGFloat(month.column) * layout.pitch
                let fits = x + text.measure(in: size).width <= size.width
                context.draw(text, at: CGPoint(x: fits ? x : size.width, y: 0), anchor: fits ? .topLeading : .topTrailing)
            }
            var shading = Array(repeating: Path(), count: HeatmapLayout.opacities.count)
            for index in layout.daily.indices {
                guard let frame = layout.frame(of: index) else { continue }
                shading[layout.levels[index]].addRoundedRect(in: frame, cornerSize: CGSize(width: layout.radius, height: layout.radius), style: .continuous)
            }
            for (level, path) in shading.enumerated() {
                context.fill(path, with: .color(level == 0 ? empty : accent.opacity(HeatmapLayout.opacities[level])))
            }
        }
    }
}
