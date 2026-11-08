import LocalStudioKit
import SwiftUI

struct UsageDashboard: View {
    let report: UsageReport
    let metric: UsageMetric
    let period: UsagePeriod
    let select: (UsagePeriod) -> Void
    @State private var width: CGFloat = 900

    private var column: CGFloat { max(160, width / 3) }
    private var hourly: Bool { report.seriesStepMs < 86_400_000 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.top, 34)
                    HStack(alignment: .top, spacing: 0) {
                        hero
                            .frame(minWidth: 0, maxWidth: column, alignment: .leading)
                        VStack(alignment: .leading, spacing: 10) {
                            Text(chartTitle)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.secondaryText)
                            DashboardSparkline(values: series, color: Theme.primary, label: chartTitle)
                                .frame(height: 76)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.top, 44)
                    DashboardFigureRow(column: column, figures: [otherMetric, requests, topModel])
                        .padding(.top, 48)
                    DashboardFigureRow(column: column, figures: [read, written, perRequest])
                        .padding(.top, 40)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
                Rectangle()
                    .fill(Theme.hairline)
                    .frame(width: 1)
                    .padding(.horizontal, 44)
                TokenSummary(
                    tokens: report.lifetime,
                    empty: "Counted from saved agent sessions as models answer.",
                    rows: [("Lifetime cost", PageFormat.cost(report.lifetimeCostUsd))]
                )
                .frame(width: 244, alignment: .leading)
            }
            Rectangle()
                .fill(Theme.hairline)
                .frame(height: 1)
                .padding(.top, 36)
                .padding(.bottom, 44)
            DailyHeatmap(
                values: metric == .cost ? report.dailyCostUsd : report.lifetime.daily.map { Double($0) },
                lastDay: report.lifetime.lastDay,
                label: metric == .cost ? "Cost per day, last year" : "Tokens per day, last year",
                format: metric == .cost ? PageFormat.cost : LocalFormat.tokens
            )
            Rectangle()
                .fill(Theme.hairline)
                .frame(height: 1)
                .padding(.top, 36)
                .padding(.bottom, 34)
            UsageModelTable(report: report, metric: metric)
            Text("Counted from every saved agent session across all projects, on the day each model answered. Read includes cached input as providers report it; requests count model responses.")
                .font(.system(size: 12))
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 28)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(UsagePeriods.heading(report.period))
                    .font(.system(size: 17, weight: .semibold))
                Text(headerDetail)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 12)
            HStack(spacing: 4) {
                ForEach(UsagePeriods.all, id: \.self) { option in
                    Button(UsagePeriods.title(option)) { select(option) }
                        .buttonStyle(DashboardButtonStyle(bordered: option == period))
                        .accessibilityAddTraits(option == period ? .isSelected : [])
                }
            }
        }
    }

    private var headerDetail: String {
        guard report.sessions > 0 else { return "No agent session used a model in this period." }
        return "\(Self.plural(report.sessions, "session")) · \(Self.plural(UInt64(report.byModel.count), "model"))"
    }

    @ViewBuilder private var hero: some View {
        let buckets = Double(max(1, report.series.count))
        let unit = hourly ? "hour" : "day"
        switch metric {
        case .tokens:
            DashboardHero(
                label: "Tokens",
                value: LocalFormat.compact(report.totalTokens),
                unit: "tokens",
                hint: "\(LocalFormat.compact(Double(report.totalTokens) / buckets)) per \(unit)"
            )
        case .cost:
            DashboardHero(
                label: "Cost",
                value: PageFormat.cost(report.costUsd),
                unit: "",
                hint: "\(PageFormat.cost(report.costUsd / buckets)) per \(unit)"
            )
        }
    }

    private var series: [Double] {
        report.series.map { metric == .cost ? $0.costUsd : Double($0.tokens) }
    }

    private var chartTitle: String {
        "\(metric.title), \(UsagePeriods.heading(report.period).lowercased())"
    }

    private var perMillion: String? {
        guard report.totalTokens > 0, report.costUsd > 0 else { return nil }
        return "\(PageFormat.cost(report.costUsd / Double(report.totalTokens) * 1_000_000)) per million tokens"
    }

    private var otherMetric: DashboardFigure {
        switch metric {
        case .tokens:
            DashboardFigure(label: "Cost", value: PageFormat.cost(report.costUsd), unit: "", hint: perMillion)
        case .cost:
            DashboardFigure(label: "Tokens", value: LocalFormat.compact(report.totalTokens), unit: "tokens", hint: perMillion)
        }
    }

    private var requests: DashboardFigure {
        DashboardFigure(
            label: "Requests",
            value: PageFormat.count(report.requests),
            unit: report.requests == 1 ? "request" : "requests",
            hint: report.sessions > 0 ? "in \(Self.plural(report.sessions, "session"))" : nil
        )
    }

    private var topModel: DashboardFigure {
        let top = metric == .cost ? report.byModel.max { $0.costUsd < $1.costUsd } : report.byModel.first
        guard let top else { return DashboardFigure(label: "Top model", value: nil, unit: "") }
        let share = metric == .cost
            ? (report.costUsd > 0 ? top.costUsd / report.costUsd : 0)
            : (report.totalTokens > 0 ? Double(top.tokens) / Double(report.totalTokens) : 0)
        return DashboardFigure(
            label: "Top model",
            value: top.model,
            unit: "",
            hint: "\(top.provider) · \(LocalFormat.percent(share * 100)) of \(metric == .cost ? "cost" : "tokens")"
        )
    }

    private var read: DashboardFigure {
        let cached = report.inputTokens > 0 ? Double(report.cacheReadTokens) / Double(report.inputTokens) * 100 : nil
        return DashboardFigure(
            label: "Read",
            value: LocalFormat.compact(report.inputTokens),
            unit: "tokens",
            hint: cached.map { "\(LocalFormat.percent($0)) from cache" }
        )
    }

    private var written: DashboardFigure {
        let share = report.totalTokens > 0 ? Double(report.outputTokens) / Double(report.totalTokens) * 100 : nil
        return DashboardFigure(
            label: "Written",
            value: LocalFormat.compact(report.outputTokens),
            unit: "tokens",
            hint: share.map { "\(LocalFormat.percent($0)) of all tokens" }
        )
    }

    private var perRequest: DashboardFigure {
        guard report.requests > 0 else { return DashboardFigure(label: "Per request", value: nil, unit: "tokens") }
        let count = Double(report.requests)
        return DashboardFigure(
            label: "Per request",
            value: LocalFormat.compact((Double(report.totalTokens) / count).rounded()),
            unit: "tokens",
            hint: "\(PageFormat.cost(report.costUsd / count)) each"
        )
    }

    private static func plural(_ count: UInt64, _ noun: String) -> String {
        "\(count.formatted()) \(noun)\(count == 1 ? "" : "s")"
    }
}

private struct UsageModelTable: View {
    let report: UsageReport
    let metric: UsageMetric

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("By model")
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
            if report.byModel.isEmpty {
                Text("No model answered in this period.")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondaryText)
            } else {
                Grid(alignment: .leading, horizontalSpacing: 28, verticalSpacing: 0) {
                    GridRow {
                        Text("Model").frame(maxWidth: .infinity, alignment: .leading)
                        Text("Share")
                        Text("Requests").gridColumnAlignment(.trailing)
                        Text("Tokens").gridColumnAlignment(.trailing)
                        Text("Cost").gridColumnAlignment(.trailing)
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.bottom, 8)
                    ForEach(rows, id: \.self) { row in
                        Rectangle().fill(Theme.hairline).frame(height: 1).gridCellUnsizedAxes(.horizontal)
                        GridRow {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.model).lineLimit(1).truncationMode(.middle)
                                Text(row.provider)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.secondaryText)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            ShareBar(fraction: share(row))
                            Text(PageFormat.count(row.requests))
                            Text(LocalFormat.compact(row.tokens))
                            Text(PageFormat.cost(row.costUsd))
                        }
                        .font(.system(size: 13))
                        .monospacedDigit()
                        .padding(.vertical, 9)
                    }
                }
            }
        }
    }

    private var rows: [UsageByModel] {
        metric == .cost ? report.byModel.sorted { $0.costUsd > $1.costUsd } : report.byModel
    }

    private func share(_ row: UsageByModel) -> Double {
        switch metric {
        case .cost: report.costUsd > 0 ? row.costUsd / report.costUsd : 0
        case .tokens: report.totalTokens > 0 ? Double(row.tokens) / Double(report.totalTokens) : 0
        }
    }
}

private struct ShareBar: View {
    let fraction: Double

    var body: some View {
        HStack(spacing: 8) {
            Capsule()
                .fill(Theme.text.opacity(0.06))
                .frame(width: 120, height: 5)
                .overlay(alignment: .leading) {
                    Capsule().fill(Theme.primary).frame(width: 120 * min(1, max(0, fraction)), height: 5)
                }
            Text(LocalFormat.percent(fraction * 100))
                .font(.system(size: 12))
                .foregroundStyle(Theme.secondaryText)
                .frame(width: 40, alignment: .trailing)
        }
    }
}

struct UsageLimits: View {
    let limits: [UsageLimit]
    let providers: [ProviderStatus]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Provider limits")
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
            if limits.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Label("No provider limits are known", systemImage: "hourglass")
                        .font(.system(size: 15, weight: .medium))
                    Text("A limit shows up here when a provider parks a session after it runs out of quota, with the time the session resumes. The agent daemon reports no other rate-limit windows.")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.secondaryText)
                        .frame(maxWidth: 560, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 6)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(limits.enumerated()), id: \.offset) { index, limit in
                        if index > 0 { Rectangle().fill(Theme.hairline).frame(height: 1) }
                        LimitRow(limit: limit, name: providers.first { $0.id == limit.provider }?.name ?? limit.provider)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct LimitRow: View {
    let limit: UsageLimit
    let name: String

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(name)
                    .font(.system(size: 15, weight: .medium))
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondaryText)
            }
            Spacer(minLength: 12)
            if let used = limit.usedPercent {
                Capsule()
                    .fill(Theme.text.opacity(0.06))
                    .frame(width: 160, height: 5)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(limit.parked ? Theme.warning : Theme.primary)
                            .frame(width: 160 * min(1, max(0, used / 100)), height: 5)
                    }
                Text(LocalFormat.percent(used))
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .frame(width: 44, alignment: .trailing)
            }
        }
        .padding(.vertical, 12)
    }

    private var detail: String {
        var parts = [limit.window.prefix(1).uppercased() + limit.window.dropFirst()]
        if limit.parked {
            if let resets = limit.resetsAt {
                let date = Date(timeIntervalSince1970: TimeInterval(resets) / 1000)
                parts.append("parked until \(date.formatted(date: .omitted, time: .shortened)) (\(PageFormat.until(resets)))")
            } else {
                parts.append("parked")
            }
        } else if let resets = limit.resetsAt {
            parts.append("resets \(PageFormat.until(resets))")
        }
        return parts.joined(separator: " · ")
    }
}
