import LocalStudioKit
import SwiftUI

struct UsagePage: View {
    let store: StudioStore
    var leadingInset: CGFloat = 0
    @State private var mode: UsageMode

    init(store: StudioStore, leadingInset: CGFloat = 0, mode: UsageMode = .tokens) {
        self.store = store
        self.leadingInset = leadingInset
        _mode = State(initialValue: mode)
    }

    private var pages: PagesStore { store.pages }
    private var metric: UsageMetric { mode == .cost ? .cost : .tokens }

    var body: some View {
        content
            .pageHeader {
                PageHeader("Usage", leadingInset: leadingInset) {
                    Picker("Metric", selection: $mode) {
                        ForEach(UsageMode.allCases, id: \.self) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                    Picker("Period", selection: Binding(get: { pages.usagePeriod }, set: { pages.loadUsage($0) })) {
                        ForEach(UsagePeriods.all, id: \.self) { period in
                            Text(UsagePeriods.title(period)).tag(period)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                    .disabled(mode == .limits)
                }
            }
            .studioCommand("usage.cost", in: store) { mode = .cost }
            .studioCommand("usage.tokens", in: store) { mode = .tokens }
            .studioCommand("usage.limits", in: store) { mode = .limits }
            .studioCommand("usage.period.day", in: store) { pages.loadUsage(.day) }
            .studioCommand("usage.period.week", in: store) { pages.loadUsage(.week) }
            .studioCommand("usage.period.month", in: store) { pages.loadUsage(.month) }
            .studioCommand("usage.period.quarter", in: store) { pages.loadUsage(.quarter) }
            .onAppear { pages.loadUsage(pages.usagePeriod) }
    }

    @ViewBuilder private var content: some View {
        if let report = pages.usage {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if mode == .limits {
                        LimitsView(limits: report.limits, providers: pages.providers)
                    } else {
                        totals(report)
                        PageCard {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(metric == .cost ? "Daily cost" : "Daily tokens")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Theme.secondaryText)
                                DailyBars(days: report.daily, metric: metric, label: "Usage per day")
                                    .frame(height: 180)
                            }
                            .padding(14)
                        }
                        ModelTable(report: report, metric: metric)
                        Text("Totals come from every saved agent session modified in the period, across all projects. Input includes cached reads as the provider reports them; requests count sessions with usage.")
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                .padding(20)
                .frame(maxWidth: 980)
                .frame(maxWidth: .infinity)
            }
            .overlay(alignment: .top) {
                if pages.usageLoading {
                    Text("Updating…")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.secondaryText)
                        .padding(.top, 6)
                }
            }
        } else if let error = pages.usageError {
            PageEmptyState(symbol: "exclamationmark.triangle", title: "Couldn’t load usage", message: error)
        } else {
            PageEmptyState.loading("Loading usage…")
        }
    }

    private func totals(_ report: UsageReport) -> some View {
        HStack(spacing: 12) {
            UsageTotal(label: "Cost", value: PageFormat.cost(report.costUsd), emphasized: metric == .cost)
            UsageTotal(label: "Total tokens", value: PageFormat.tokens(report.totalTokens), emphasized: metric == .tokens)
            UsageTotal(label: "Input", value: PageFormat.tokens(report.inputTokens))
            UsageTotal(label: "Output", value: PageFormat.tokens(report.outputTokens))
            UsageTotal(label: "Requests", value: PageFormat.count(report.requests))
        }
    }
}

enum UsagePeriods {
    static let all: [UsagePeriod] = [.day, .week, .month, .quarter]

    static func title(_ period: UsagePeriod) -> String {
        switch period {
        case .day: "24h"
        case .week: "7 days"
        case .month: "30 days"
        case .quarter: "90 days"
        }
    }
}

private struct UsageTotal: View {
    let label: String
    let value: String
    var emphasized = false

    var body: some View {
        PageCard {
            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                Text(value)
                    .font(.system(size: 20, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(emphasized ? Theme.primary : .primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ModelTable: View {
    let report: UsageReport
    let metric: UsageMetric

    var body: some View {
        PageCard {
            VStack(alignment: .leading, spacing: 0) {
                Text("By model")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 14)
                    .padding(.top, 12)
                    .padding(.bottom, 8)
                if report.byModel.isEmpty {
                    Text("No usage in this period.")
                        .foregroundStyle(Theme.secondaryText)
                        .padding(14)
                } else {
                    Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 0) {
                        GridRow {
                            Text("Model").frame(maxWidth: .infinity, alignment: .leading)
                            Text("Share")
                            Text("Requests").gridColumnAlignment(.trailing)
                            Text("Tokens").gridColumnAlignment(.trailing)
                            Text("Cost").gridColumnAlignment(.trailing)
                        }
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.secondaryText)
                        .padding(.bottom, 6)
                        ForEach(report.byModel, id: \.self) { row in
                            Divider().gridCellUnsizedAxes(.horizontal)
                            GridRow {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(row.model).lineLimit(1).truncationMode(.middle)
                                    Text(row.provider)
                                        .font(.system(size: 11))
                                        .foregroundStyle(Theme.secondaryText)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                ShareBar(fraction: share(row))
                                Text(PageFormat.count(row.requests))
                                Text(PageFormat.tokens(row.tokens))
                                Text(PageFormat.cost(row.costUsd))
                            }
                            .font(.system(size: 12.5))
                            .monospacedDigit()
                            .padding(.vertical, 7)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 8)
                }
            }
        }
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
        HStack(spacing: 6) {
            Capsule()
                .fill(Theme.input)
                .frame(width: 90, height: 5)
                .overlay(alignment: .leading) {
                    Capsule().fill(Theme.primary).frame(width: 90 * min(1, max(0, fraction)), height: 5)
                }
            Text("\(Int((fraction * 100).rounded()))%")
                .font(.system(size: 11))
                .foregroundStyle(Theme.secondaryText)
                .frame(width: 32, alignment: .trailing)
        }
    }
}

enum UsageMode: CaseIterable {
    case cost, tokens, limits

    var title: String {
        switch self {
        case .cost: "Cost"
        case .tokens: "Tokens"
        case .limits: "Limits"
        }
    }
}

private struct LimitsView: View {
    let limits: [UsageLimit]
    let providers: [ProviderStatus]

    var body: some View {
        PageCard {
            VStack(alignment: .leading, spacing: 0) {
                Text("Provider limits")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 14)
                    .padding(.top, 12)
                    .padding(.bottom, 8)
                if limits.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("No provider limits are known", systemImage: "hourglass")
                            .font(.system(size: 13, weight: .medium))
                        Text("A limit shows up here when a provider parks a session after it runs out of quota, with the time the session resumes. The agent daemon reports no other rate-limit windows.")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 14)
                } else {
                    ForEach(Array(limits.enumerated()), id: \.offset) { index, limit in
                        if index > 0 { Divider().padding(.leading, 14) }
                        LimitRow(limit: limit, name: providers.first { $0.id == limit.provider }?.name ?? limit.provider)
                    }
                    .padding(.bottom, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct LimitRow: View {
    let limit: UsageLimit
    let name: String

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.system(size: 13, weight: .medium))
                Text(detail)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
            }
            Spacer(minLength: 12)
            if let used = limit.usedPercent {
                Capsule()
                    .fill(Theme.input)
                    .frame(width: 140, height: 5)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(limit.parked ? Color.orange : Theme.primary)
                            .frame(width: 140 * min(1, max(0, used / 100)), height: 5)
                    }
                Text("\(Int(used.rounded()))%")
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .frame(width: 40, alignment: .trailing)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
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
