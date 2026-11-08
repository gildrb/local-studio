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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                content
            }
            .padding(.horizontal, 40)
            .padding(.top, 12)
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .pageHeader {
            PageHeader("Usage", subtitle: pages.usageLoading ? "Updating…" : "Saved agent sessions, all projects", leadingInset: leadingInset) {
                ChromeIconButton("Refresh", symbol: "arrow.clockwise") { pages.loadUsage(pages.usagePeriod) }
            }
        }
        .background(Theme.canvas)
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
        HStack(spacing: 6) {
            ForEach(UsageMode.allCases, id: \.self) { tab in
                DashboardTab(title: tab.title, active: mode == tab) { mode = tab }
            }
        }
        if let report = pages.usage {
            if mode == .limits {
                UsageLimits(limits: report.limits, providers: pages.providers)
                    .padding(.top, 34)
            } else {
                UsageDashboard(report: report, metric: mode == .cost ? .cost : .tokens, period: pages.usagePeriod) { pages.loadUsage($0) }
            }
        } else if let error = pages.usageError {
            PageEmptyState(symbol: "exclamationmark.triangle", title: "Couldn’t load usage", message: error)
                .frame(minHeight: 360)
        } else {
            PageEmptyState.loading("Loading usage…")
                .frame(minHeight: 360)
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

    static func heading(_ period: UsagePeriod) -> String {
        switch period {
        case .day: "Last 24 hours"
        case .week: "Last 7 days"
        case .month: "Last 30 days"
        case .quarter: "Last 90 days"
        }
    }
}

enum UsageMode: CaseIterable {
    case tokens, cost, limits

    var title: String {
        switch self {
        case .tokens: "Tokens"
        case .cost: "Cost"
        case .limits: "Limits"
        }
    }
}
