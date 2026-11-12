import LocalStudioKit
import SwiftUI

struct LocalPage: View {
    let store: StudioStore
    var leadingInset: CGFloat = 0
    @State private var selected: String?
    @State private var lastModels: [String: String] = [:]
    @Environment(\.scenePhase) private var scenePhase

    init(store: StudioStore, leadingInset: CGFloat = 0, selected: String? = nil) {
        self.store = store
        self.leadingInset = leadingInset
        _selected = State(initialValue: selected)
    }

    private var pages: PagesStore { store.pages }
    private var controllers: [LocalController] { pages.local?.controllers ?? [] }

    private var current: LocalController? {
        controllers.first { $0.url == selected }
            ?? controllers.first { $0.reachable && !$0.endpoints.isEmpty }
            ?? controllers.first(where: \.reachable)
            ?? controllers.first
    }

    private var watchTarget: String? {
        guard scenePhase != .background, let current, current.reachable else { return nil }
        return current.target
    }

    var body: some View {
        ScrollView {
            content
                .padding(.horizontal, 40)
                .padding(.top, 12)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .pageHeader {
            PageHeader("Local", subtitle: subtitle, leadingInset: leadingInset) {
                ChromeIconButton("Manage Machines", symbol: "server.rack") { store.openSettings(.local) }
                ChromeIconButton("Refresh", symbol: "arrow.clockwise") { pages.refreshLocal() }
            }
        }
        .background(Theme.canvas)
        .localPolling(pages)
        .task(id: watchTarget) { pages.watchLocalDashboard(watchTarget) }
        .onDisappear { pages.watchLocalDashboard(nil) }
        .onChange(of: pages.local, initial: true) { _, snapshot in
            for controller in snapshot?.controllers ?? [] {
                if let model = controller.endpoints.first?.models.first {
                    lastModels[controller.url] = model
                }
            }
        }
    }

    private var subtitle: String {
        guard !controllers.isEmpty else { return LocalControllerAddress.effective(pages.settings) }
        let online = controllers.filter(\.reachable).count
        return "\(online) of \(controllers.count) machine\(controllers.count == 1 ? "" : "s") online"
    }

    @ViewBuilder private var content: some View {
        if let error = pages.localActionError {
            HStack(spacing: 8) {
                IconLabel(error, symbol: "exclamationmark.triangle.fill")
                    .foregroundStyle(Theme.danger)
                    .textSelection(.enabled)
                Spacer()
                Button("Dismiss") { pages.dismissLocalActionError() }
            }
            .font(.system(size: 12.5))
            .padding(.bottom, 12)
        }
        if let snapshot = pages.local, !snapshot.controllers.isEmpty {
            if let error = snapshot.error {
                IconLabel(error, symbol: "exclamationmark.triangle.fill")
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.warning)
                    .textSelection(.enabled)
                    .padding(.bottom, 10)
            }
            LocalMachineTabs(controllers: snapshot.controllers, selected: current?.url) { selected = $0 }
            if let current {
                if current.reachable {
                    LocalMachineDashboard(
                        controller: current,
                        dashboard: pages.localDashboard.flatMap { $0.controller == current.target ? $0 : nil },
                        pages: pages
                    )
                    .id(current.url)
                } else {
                    LocalOfflineMachine(name: current.name, lastModel: lastModels[current.url])
                }
            }
        } else if let error = pages.local?.error ?? pages.localError {
            PageEmptyState(symbol: "exclamationmark.triangle.fill", title: "No Local controller answers", message: error)
                .frame(minHeight: 360)
        } else {
            PageEmptyState(symbol: "server.rack", title: "Contacting the Local controller…")
                .frame(minHeight: 360)
        }
    }
}

private enum MachineState {
    case serving, loading, idle, offline

    init(_ controller: LocalController) {
        if !controller.reachable {
            self = .offline
        } else if !controller.endpoints.isEmpty {
            self = .serving
        } else if controller.jobs.contains(where: { !$0.failed }) {
            self = .loading
        } else {
            self = .idle
        }
    }

    var label: String {
        switch self {
        case .serving: "serving"
        case .loading: "loading"
        case .idle: "idle"
        case .offline: "offline"
        }
    }
}

private struct MachineDot: View {
    let state: MachineState
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiate

    var body: some View {
        if differentiate {
            Image(systemName: symbol)
                .icon(.inline, .primary)
                .accessibilityHidden(true)
        } else {
            switch state {
            case .serving: Circle().fill(Theme.success).frame(width: 7, height: 7)
            case .loading: Circle().fill(Theme.warning).frame(width: 7, height: 7)
            case .idle: Circle().fill(Theme.tertiaryText).frame(width: 7, height: 7)
            case .offline: Circle().strokeBorder(Theme.secondaryText, lineWidth: 1.5).frame(width: 7, height: 7)
            }
        }
    }

    private var symbol: String {
        switch state {
        case .serving: "checkmark"
        case .loading: "hourglass"
        case .idle: "minus"
        case .offline: "xmark"
        }
    }
}

private struct LocalMachineTabs: View {
    let controllers: [LocalController]
    let selected: String?
    let select: (String) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(controllers, id: \.url) { controller in
                    let state = MachineState(controller)
                    DashboardTab(
                        title: controller.name,
                        active: controller.url == selected,
                        accessibility: "\(controller.name), \(state.label)",
                        select: { select(controller.url) },
                        leading: { MachineDot(state: state) }
                    )
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}

private struct LocalOfflineMachine: View {
    let name: String
    let lastModel: String?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "xmark")
                .icon(.toolbar, .primary)
                .frame(width: 40, height: 40)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Theme.hairline) }
                .padding(.bottom, 4)
            Text("\(name) is offline")
                .font(.system(size: 15, weight: .medium))
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
        }
        .frame(maxWidth: .infinity, minHeight: 420)
    }

    private var message: String {
        let reconnect = "It shows live figures again once it reconnects."
        guard let lastModel else { return reconnect }
        return "It last ran \(lastModel). \(reconnect)"
    }
}

private struct LocalMachineDashboard: View {
    let controller: LocalController
    let dashboard: LocalDashboard?
    let pages: PagesStore
    @State private var switching = false
    @State private var stopping = false
    @State private var width: CGFloat = 900

    private var endpoint: LocalEndpoint? { controller.endpoints.first }
    private var model: String? { endpoint.map { $0.models.joined(separator: ", ") } }
    private var job: LocalJob? { controller.jobs.first }
    private var column: CGFloat { max(160, width / 3) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.top, 34)
                    if let error = dashboard?.error {
                        IconLabel(error, symbol: "exclamationmark.triangle.fill")
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.warning)
                            .padding(.top, 14)
                    }
                    HStack(alignment: .top, spacing: 0) {
                        DashboardHero(
                            label: "Decode",
                            value: dashboard?.decodeTps.map(LocalFormat.decimal),
                            unit: "tok/s",
                            hint: decodeHint
                        )
                        .frame(minWidth: 0, maxWidth: column, alignment: .leading)
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Decode, last 24 hours")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.secondaryText)
                            DashboardSparkline(values: decodeSeries, color: Theme.primary, label: decodeLabel)
                                .frame(height: 76)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.top, 44)
                    DashboardFigureRow(column: column, figures: [firstToken, inFlight, kvCache])
                        .padding(.top, 48)
                    DashboardFigureRow(column: column, figures: [gpuFigure, memoryFigure, powerFigure])
                        .padding(.top, 40)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
                Rectangle()
                    .fill(Theme.hairline)
                    .frame(width: 1)
                    .padding(.horizontal, 44)
                TokenSummary(tokens: dashboard?.tokens, empty: "Counted from engine metrics as models serve requests.")
                    .frame(width: 244, alignment: .leading)
            }
            Rectangle()
                .fill(Theme.hairline)
                .frame(height: 1)
                .padding(.top, 36)
                .padding(.bottom, 44)
            DailyHeatmap(
                values: dashboard.map { $0.tokens.daily.map { Double($0) } },
                lastDay: dashboard?.tokens.lastDay,
                label: "Tokens per day, last year",
                format: LocalFormat.tokens
            )
        }
        .sheet(isPresented: $switching) {
            LocalSwitchModelSheet(controller: controller, pages: pages)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(model ?? job.map { "Loading \($0.recipeId)" } ?? "No model loaded")
                    .font(.system(size: 17, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                Text(headerDetail)
                    .font(.system(size: 13))
                    .foregroundStyle(job?.failed == true ? Theme.danger : Theme.secondaryText)
                    .lineLimit(2)
            }
            Spacer(minLength: 12)
            actions
        }
    }

    private var headerDetail: String {
        if let endpoint {
            let loaded = dashboard?.engines.first { $0.port == endpoint.port }?.loadedAtMs.map(LocalFormat.loaded) ?? "Serving on port \(endpoint.port)"
            let others = controller.endpoints.count - 1
            return others > 0 ? "\(loaded) · \(others) more engine\(others == 1 ? "" : "s") running" : loaded
        }
        if let job { return job.detail }
        return "\(controller.name) is idle. Load a model from the registry to serve it."
    }

    @ViewBuilder private var actions: some View {
        let target = controller.target
        let loading = pages.isPending(.load(target))
        HStack(spacing: 10) {
            Button { switching = true } label: {
                IconLabel(loading ? "Switching…" : endpoint == nil ? "Load model…" : "Switch model…", symbol: "arrow.left.arrow.right")
            }
            .buttonStyle(DashboardButtonStyle(bordered: true))
            .disabled(loading)
            if let endpoint, let model {
                let unloading = pages.isPending(.unload(target, endpoint.port))
                Button { stopping = true } label: {
                    IconLabel(unloading ? "Stopping…" : "Stop model…", symbol: "stop.fill")
                }
                .buttonStyle(DashboardButtonStyle())
                .disabled(unloading)
                .confirmationDialog("Stop \(model)?", isPresented: $stopping) {
                    Button("Stop model", role: .destructive) {
                        pages.perform(.stopPort(controller: target, port: endpoint.port), pending: .unload(target, endpoint.port))
                    }
                    Button("Keep running", role: .cancel) {}
                } message: {
                    Text(stopMessage)
                }
            }
        }
    }

    private var stopMessage: String {
        let idle = "\(controller.name) serves nothing until a model loads again."
        guard let running = dashboard?.running, running > 0 else { return idle }
        return "Its \(running) request\(running == 1 ? "" : "s") in flight end\(running == 1 ? "s" : "") now, and \(idle)"
    }

    private var decodeSeries: [Double] { dashboard?.decodeSeries ?? [] }

    private var decodeLabel: String {
        "Decode, last 24 hours, peak \(LocalFormat.decimal(decodeSeries.max() ?? 0)) tokens per second"
    }

    private var decodeHint: String {
        guard let dashboard else { return " " }
        if let perRequest = dashboard.perRequestTps { return "\(LocalFormat.decimal(perRequest)) per request" }
        if dashboard.decodeTps != nil { return "No requests in flight" }
        return dashboard.engines.isEmpty ? "No engine running" : "The engine reports no metrics"
    }

    private var firstToken: DashboardFigure {
        DashboardFigure(
            label: "First token",
            value: dashboard?.firstTokenMs.map(LocalFormat.whole),
            unit: "ms",
            hint: dashboard?.firstTokenBestMs.map { "best \(LocalFormat.whole($0)) ms" }
        )
    }

    private var inFlight: DashboardFigure {
        let running = dashboard?.running
        let waiting = dashboard?.waiting.flatMap { $0 > 0 ? "\($0) waiting" : nil }
        let peak = dashboard?.runningPeak.map { "peak \($0)" }
        return DashboardFigure(
            label: "In flight",
            value: running.map { "\($0)" },
            unit: running == 1 ? "request" : "requests",
            hint: peak.map { [$0, waiting].compactMap { $0 }.joined(separator: ", ") } ?? waiting
        )
    }

    private var kvCache: DashboardFigure {
        DashboardFigure(
            label: "KV cache",
            value: dashboard?.kvPercent.map(LocalFormat.whole),
            unit: "% used",
            hint: dashboard?.kvPeakPercent.map { "peak \(LocalFormat.percent($0))" }
        )
    }

    private var gpuFigure: DashboardFigure {
        guard let dashboard else { return DashboardFigure(label: "GPUs", value: nil, unit: "cards") }
        let count = dashboard.gpus.count
        return DashboardFigure(
            label: "GPUs",
            value: "\(count)",
            unit: count == 1 ? "card" : "cards",
            hint: dashboard.gpuName.isEmpty ? "No NVIDIA GPU reported" : dashboard.gpuName
        )
    }

    private var memoryFigure: DashboardFigure {
        guard let dashboard, dashboard.memoryTotalBytes > 0 else { return DashboardFigure(label: "Memory", value: nil, unit: "GB") }
        let used = LocalFormat.gigabytes(dashboard.memoryUsedBytes)
        let total = LocalFormat.gigabytes(dashboard.memoryTotalBytes)
        let free = LocalFormat.gigabytes(dashboard.memoryTotalBytes - min(dashboard.memoryUsedBytes, dashboard.memoryTotalBytes))
        return DashboardFigure(label: "Memory", value: used, unit: "of \(total) GB", hint: "\(free) GB free")
    }

    private var powerFigure: DashboardFigure {
        guard let dashboard, let watts = dashboard.powerWatts else { return DashboardFigure(label: "Power", value: nil, unit: "W") }
        let limit = dashboard.powerLimitWatts.map { "limit \(LocalFormat.whole($0)) W" }
        guard let flag = LocalGpuFlag.worst(dashboard.gpus) else {
            return DashboardFigure(label: "Power", value: LocalFormat.whole(watts), unit: "W", hint: limit)
        }
        return DashboardFigure(label: "Power", value: LocalFormat.whole(watts), unit: "W", hint: flag.text, tone: flag.tone)
    }
}

struct LocalGpuFlag {
    let text: String
    let tone: DashboardTone
    let rank: Int

    static func worst(_ gpus: [LocalGpuTelemetry]) -> LocalGpuFlag? {
        var flags: [LocalGpuFlag] = []
        for gpu in gpus {
            let name = "G\(gpu.index)"
            if let temperature = gpu.temperatureC, temperature >= 88 {
                flags.append(LocalGpuFlag(text: "\(name) too hot, \(LocalFormat.whole(temperature)) °C", tone: .danger, rank: 3))
            }
            if let watts = gpu.powerWatts, let limit = gpu.powerLimitWatts, watts.rounded() > limit.rounded() {
                flags.append(LocalGpuFlag(text: "\(name) \(LocalFormat.whole(watts.rounded() - limit.rounded())) W over limit", tone: .warning, rank: 2))
            }
            if let temperature = gpu.temperatureC, (80..<88).contains(temperature) {
                flags.append(LocalGpuFlag(text: "\(name) running warm, \(LocalFormat.whole(temperature)) °C", tone: .warning, rank: 1))
            }
        }
        guard let worst = flags.max(by: { $0.rank < $1.rank }) else { return nil }
        let others = flags.count - 1
        return others > 0 ? LocalGpuFlag(text: "\(worst.text), \(others) more", tone: worst.tone, rank: worst.rank) : worst
    }
}

private struct LocalSwitchModelSheet: View {
    let controller: LocalController
    let pages: PagesStore
    @State private var choice: String?
    @Environment(\.dismiss) private var dismiss

    private var ready: [LocalRecipe] { controller.recipes.filter(\.fits) }
    private var replacing: Bool { !controller.endpoints.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(replacing ? "Switch the model on \(controller.name)" : "Load a model on \(controller.name)")
                .font(.system(size: 15, weight: .semibold))
            if ready.isEmpty {
                Text(controller.recipes.isEmpty
                    ? "The registry has no recipes for this machine's hardware yet."
                    : "None of the \(controller.recipes.count) registry recipes for this hardware can load automatically yet.")
                    .foregroundStyle(Theme.secondaryText)
            } else {
                Picker("Model", selection: Binding(get: { choice ?? ready.first?.id }, set: { choice = $0 })) {
                    ForEach(ready, id: \.id) { recipe in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(recipe.model)
                            Text(recipe.detail)
                                .font(.system(size: 11.5))
                                .foregroundStyle(Theme.secondaryText)
                        }
                        .tag(Optional(recipe.id))
                    }
                }
                .pickerStyle(.radioGroup)
                .labelsHidden()
            }
            if replacing {
                Text("Switching stops \(controller.endpoints.flatMap(\.models).joined(separator: ", ")) first; its requests in flight end.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
            }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(replacing ? "Switch" : "Load") {
                    if let recipe = choice ?? ready.first?.id {
                        pages.perform(.runRecipe(controller: controller.target, recipe: recipe, replace: replacing), pending: .load(controller.target))
                    }
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(ready.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 480)
    }
}

enum LocalFormat {
    private static let dayParser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .gmt
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    static func compact(_ value: UInt64) -> String {
        compact(Double(value))
    }

    static func compact(_ value: Double) -> String {
        value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
    }

    static func tokens(_ value: Double) -> String {
        "\(compact(value)) token\(value == 1 ? "" : "s")"
    }

    static func decimal(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(1)))
    }

    static func whole(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0)))
    }

    static func percent(_ value: Double) -> String {
        (value / 100).formatted(.percent.precision(.fractionLength(0)))
    }

    static func gigabytes(_ bytes: UInt64) -> String {
        whole(Double(bytes) / 1_073_741_824)
    }

    static func date(_ day: String) -> Date? {
        dayParser.date(from: day)
    }

    static func day(_ date: Date, year: Bool) -> String {
        var style = Date.FormatStyle.dateTime.day().month(.abbreviated)
        if year {
            style = style.year()
        }
        style.timeZone = .gmt
        return date.formatted(style)
    }

    static func loaded(_ milliseconds: Int64) -> String {
        let seconds = max(0, Date.now.timeIntervalSince1970 - TimeInterval(milliseconds) / 1000)
        let (count, unit): (Int, String) = switch seconds {
        case ..<60: (0, "")
        case ..<3600: (Int(seconds / 60), "minute")
        case ..<86_400: (Int(seconds / 3600), "hour")
        default: (Int(seconds / 86_400), "day")
        }
        guard count > 0 else { return "Loaded just now" }
        return "Loaded \(count.formatted()) \(unit)\(count == 1 ? "" : "s") ago"
    }
}
