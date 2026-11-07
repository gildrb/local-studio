import Charts
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
                Label(error, systemImage: "exclamationmark.triangle")
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
                Label(error, systemImage: "exclamationmark.triangle")
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
            PageEmptyState(symbol: "bolt.horizontal.circle", title: "No Local controller answers", message: error)
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

    var body: some View {
        switch state {
        case .serving: Circle().fill(Theme.success).frame(width: 7, height: 7)
        case .loading: Circle().fill(Theme.warning).frame(width: 7, height: 7)
        case .idle: Circle().fill(Theme.tertiaryText).frame(width: 7, height: 7)
        case .offline: Circle().strokeBorder(Theme.secondaryText, lineWidth: 1.5).frame(width: 7, height: 7)
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
                    let active = controller.url == selected
                    let state = MachineState(controller)
                    Button { select(controller.url) } label: {
                        HStack(spacing: 7) {
                            MachineDot(state: state)
                            Text(controller.name)
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
                    .accessibilityLabel("\(controller.name), \(state.label)")
                    .accessibilityAddTraits(active ? .isSelected : [])
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
            Image(systemName: "circle.slash")
                .font(.system(size: 17))
                .foregroundStyle(Theme.text)
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

private struct LocalDashboardButtonStyle: ButtonStyle {
    var bordered = false

    func makeBody(configuration: Configuration) -> some View {
        LocalDashboardButtonBody(configuration: configuration, bordered: bordered)
    }
}

private struct LocalDashboardButtonBody: View {
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
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.warning)
                            .padding(.top, 14)
                    }
                    HStack(alignment: .top, spacing: 0) {
                        decode.frame(width: column, alignment: .leading)
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Decode, last 24 hours")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.secondaryText)
                            LocalDecodeSparkline(values: dashboard?.decodeSeries ?? [], color: Theme.primary)
                                .frame(height: 76)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.top, 44)
                    LocalFigureRow(column: column, figures: [firstToken, inFlight, kvCache])
                        .padding(.top, 48)
                    LocalFigureRow(column: column, figures: [gpuFigure, memoryFigure, powerFigure])
                        .padding(.top, 40)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
                Rectangle()
                    .fill(Theme.hairline)
                    .frame(width: 1)
                    .padding(.horizontal, 44)
                LocalTokenSummary(tokens: dashboard?.tokens)
                    .frame(width: 244, alignment: .leading)
            }
            Rectangle()
                .fill(Theme.hairline)
                .frame(height: 1)
                .padding(.top, 36)
                .padding(.bottom, 44)
            LocalTokenHeatmap(tokens: dashboard?.tokens)
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
                Label(loading ? "Switching…" : endpoint == nil ? "Load model…" : "Switch model…", systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(LocalDashboardButtonStyle(bordered: true))
            .disabled(loading)
            if let endpoint, let model {
                let unloading = pages.isPending(.unload(target, endpoint.port))
                Button { stopping = true } label: {
                    Label(unloading ? "Stopping…" : "Stop model…", systemImage: "stop")
                }
                .buttonStyle(LocalDashboardButtonStyle())
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

    private var decode: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Decode")
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(dashboard?.decodeTps.map(LocalFormat.decimal) ?? "—")
                    .font(.system(size: 44, weight: .semibold))
                    .monospacedDigit()
                Text("tok/s")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondaryText)
            }
            Text(decodeHint)
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
        }
    }

    private var decodeHint: String {
        guard let dashboard else { return " " }
        if let perRequest = dashboard.perRequestTps { return "\(LocalFormat.decimal(perRequest)) per request" }
        if dashboard.decodeTps != nil { return "No requests in flight" }
        return dashboard.engines.isEmpty ? "No engine running" : "The engine reports no metrics"
    }

    private var firstToken: LocalFigure {
        LocalFigure(
            label: "First token",
            value: dashboard?.firstTokenMs.map(LocalFormat.whole),
            unit: "ms",
            hint: dashboard?.firstTokenBestMs.map { "best \(LocalFormat.whole($0)) ms" }
        )
    }

    private var inFlight: LocalFigure {
        let running = dashboard?.running
        let waiting = dashboard?.waiting.flatMap { $0 > 0 ? "\($0) waiting" : nil }
        let peak = dashboard?.runningPeak.map { "peak \($0)" }
        return LocalFigure(
            label: "In flight",
            value: running.map { "\($0)" },
            unit: running == 1 ? "request" : "requests",
            hint: peak.map { [$0, waiting].compactMap { $0 }.joined(separator: ", ") } ?? waiting
        )
    }

    private var kvCache: LocalFigure {
        LocalFigure(
            label: "KV cache",
            value: dashboard?.kvPercent.map(LocalFormat.whole),
            unit: "% used",
            hint: dashboard?.kvPeakPercent.map { "peak \(LocalFormat.percent($0))" }
        )
    }

    private var gpuFigure: LocalFigure {
        guard let dashboard else { return LocalFigure(label: "GPUs", value: nil, unit: "cards") }
        let count = dashboard.gpus.count
        return LocalFigure(
            label: "GPUs",
            value: "\(count)",
            unit: count == 1 ? "card" : "cards",
            hint: dashboard.gpuName.isEmpty ? "No NVIDIA GPU reported" : dashboard.gpuName
        )
    }

    private var memoryFigure: LocalFigure {
        guard let dashboard, dashboard.memoryTotalBytes > 0 else { return LocalFigure(label: "Memory", value: nil, unit: "GB") }
        let used = LocalFormat.gigabytes(dashboard.memoryUsedBytes)
        let total = LocalFormat.gigabytes(dashboard.memoryTotalBytes)
        let free = LocalFormat.gigabytes(dashboard.memoryTotalBytes - min(dashboard.memoryUsedBytes, dashboard.memoryTotalBytes))
        return LocalFigure(label: "Memory", value: used, unit: "of \(total) GB", hint: "\(free) GB free")
    }

    private var powerFigure: LocalFigure {
        guard let dashboard, let watts = dashboard.powerWatts else { return LocalFigure(label: "Power", value: nil, unit: "W") }
        let limit = dashboard.powerLimitWatts.map { "limit \(LocalFormat.whole($0)) W" }
        guard let flag = LocalGpuFlag.worst(dashboard.gpus) else {
            return LocalFigure(label: "Power", value: LocalFormat.whole(watts), unit: "W", hint: limit)
        }
        return LocalFigure(label: "Power", value: LocalFormat.whole(watts), unit: "W", hint: flag.text, tone: flag.tone)
    }
}

enum LocalFigureTone {
    case plain, warning, danger
}

struct LocalGpuFlag {
    let text: String
    let tone: LocalFigureTone
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

struct LocalFigure {
    let label: String
    let value: String?
    let unit: String
    var hint: String?
    var tone: LocalFigureTone = .plain
}

private struct LocalFigureRow: View {
    let column: CGFloat
    let figures: [LocalFigure]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(figures, id: \.label) { figure in
                LocalFigureView(figure: figure)
                    .frame(width: column, alignment: .leading)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct LocalFigureView: View {
    let figure: LocalFigure

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(figure.label)
                .font(.system(size: 13))
                .foregroundStyle(Theme.secondaryText)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(figure.value ?? "—")
                    .font(.system(size: 22, weight: .semibold))
                    .monospacedDigit()
                Text(figure.unit)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondaryText)
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

struct LocalDecodeSparkline: View {
    let values: [Double]
    let color: Color

    var body: some View {
        let peak = values.max() ?? 0
        Chart(Array(values.enumerated()), id: \.offset) { point in
            AreaMark(x: .value("Time", point.offset), y: .value("tok/s", point.element))
                .interpolationMethod(.catmullRom)
                .foregroundStyle(.linearGradient(colors: [color.opacity(0.22), color.opacity(0)], startPoint: .top, endPoint: .bottom))
            LineMark(x: .value("Time", point.offset), y: .value("tok/s", point.element))
                .interpolationMethod(.catmullRom)
                .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                .foregroundStyle(color)
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .chartXScale(domain: 0...max(1, values.count - 1))
        .chartYScale(domain: 0...max(1, peak * 1.05))
        .accessibilityLabel("Decode, last 24 hours, peak \(LocalFormat.decimal(peak)) tokens per second")
        .transaction { $0.animation = nil }
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
        Double(value).formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
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
