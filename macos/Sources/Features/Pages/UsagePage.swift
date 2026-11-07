import LocalStudioKit
import SwiftUI

struct UsagePage: View {
    let store: StudioStore
    var leadingInset: CGFloat = 0
    @State private var metric: UsageMetric = .tokens
    @FocusState private var focused: Bool

    private var pages: PagesStore { store.pages }

    var body: some View {
        VStack(spacing: 0) {
            PageHeader("Usage", leadingInset: leadingInset) {
                Picker("Metric", selection: $metric) {
                    ForEach(UsageMetric.allCases, id: \.self) { metric in
                        Text(metric.title).tag(metric)
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
            }
            content
        }
        .background(Theme.canvas)
        .background { shortcuts }
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: .down) { press in
            guard press.modifiers.isEmpty else { return .ignored }
            if matches(press, command: "usage.cost") {
                metric = .cost
                return .handled
            }
            if matches(press, command: "usage.tokens") {
                metric = .tokens
                return .handled
            }
            return .ignored
        }
        .onAppear {
            focused = true
            pages.loadUsage(pages.usagePeriod)
        }
    }

    @ViewBuilder private var content: some View {
        if let report = pages.usage {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
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
            PageEmptyState(symbol: "chart.bar", title: "Loading usage…")
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

    private var shortcuts: some View {
        ZStack {
            ForEach(UsagePeriods.all, id: \.self) { period in
                if let shortcut = shortcut(for: UsagePeriods.command(period)) {
                    Button(UsagePeriods.title(period)) { pages.loadUsage(period) }
                        .keyboardShortcut(shortcut)
                }
            }
        }
        .opacity(0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func shortcut(for command: String) -> KeyboardShortcut? {
        ShortcutFormat.keyboardShortcut(pages.keybindings.first { $0.command == command }?.shortcut)
    }

    private func matches(_ press: KeyPress, command: String) -> Bool {
        guard let shortcut = pages.keybindings.first(where: { $0.command == command })?.shortcut else { return false }
        return shortcut == press.characters.lowercased()
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

    static func command(_ period: UsagePeriod) -> String {
        switch period {
        case .day: "usage.period.day"
        case .week: "usage.period.week"
        case .month: "usage.period.month"
        case .quarter: "usage.period.quarter"
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
