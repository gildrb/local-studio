import Charts
import LocalStudioKit
import SwiftUI

struct LocalPolling: ViewModifier {
    let pages: PagesStore

    func body(content: Content) -> some View {
        content.task {
            while !Task.isCancelled {
                pages.refreshLocal()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}

extension View {
    func localPolling(_ pages: PagesStore) -> some View {
        modifier(LocalPolling(pages: pages))
    }
}

struct MachineUI: Equatable {
    var open = false
    var editing: String?
    var reveal = false
    var armed: String?
    var choice: String?
    var sharing: UInt16?
}

struct LocalFleetSections: View {
    let store: StudioStore
    @State private var machines: [String: MachineUI] = [:]
    @State private var scanned = false
    @Environment(\.settingsQuery) private var query

    private var pages: PagesStore { store.pages }
    private var snapshot: LocalSnapshot? { pages.local }

    var body: some View {
        if let error = errorText {
            Section {
                Label {
                    Text(error)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .icon(.inline)
                        .foregroundStyle(.red)
                }
                if pages.localActionError != nil {
                    Button("Dismiss") { pages.dismissLocalActionError() }
                }
            }
        }
        SettingsSection(.fleet) {
            SettingRow(.machines) { machinesBlock }
        }
        if query.isEmpty || SettingKey.registry.matches(query) {
            LocalRegistrySection(store: store)
        }
        if query.isEmpty || SettingKey.localUsage.matches(query) {
            LocalUsageSection(usage: snapshot?.usage)
        }
        if query.isEmpty {
            Section("About Local") {
                Text("Local runs open models on machines you own. Each machine runs a small Local Studio controller; connected machines share their models, so any model loaded anywhere is available to every chat here. Machines on your Tailscale network are found automatically.")
                    .foregroundStyle(Theme.secondaryText)
                Text("Models load from the Local AI Registry: recipes tested on specific hardware, pinned to an exact image and weights. Loading works on Linux machines with NVIDIA GPUs and Docker, including RTX 3090, 4090, 5090, RTX PRO 6000 and DGX Spark. Macs can connect and serve models they already run.")
                    .foregroundStyle(Theme.secondaryText)
                if let url = URL(string: "https://local-ai-registry.vercel.app/?topic=hardware") {
                    Link("See supported hardware and models", destination: url)
                }
            }
        }
    }

    private var errorText: String? {
        pages.localActionError ?? snapshot?.error ?? (snapshot == nil ? pages.localError : nil)
    }

    @ViewBuilder private var machinesBlock: some View {
        HStack {
            Text("Machines")
                .font(.system(size: 13, weight: .semibold))
            Spacer()
            Button(pages.isPending(.scan) ? "Scanning…" : "Scan Tailnet") {
                pages.perform(.scanTailnet, pending: .scan)
            }
            .disabled(pages.isPending(.scan))
        }
        .onAppear {
            guard !scanned, snapshot?.tailnet == nil else { return }
            scanned = true
            pages.perform(.scanTailnet, pending: .scan)
        }
        if let snapshot {
            let machines = snapshot.controllers.filter(\.hasController)
            if machines.isEmpty {
                Text("No controller answered at \(LocalControllerAddress.effective(pages.settings)).")
                    .foregroundStyle(Theme.secondaryText)
            }
            ForEach(machines, id: \.url) { controller in
                MachineRow(controller: controller, pages: pages, ui: binding(controller.url))
            }
            ForEach(tailnetCandidates(snapshot), id: \.ip) { device in
                TailnetRow(device: device, pages: pages)
            }
        } else if pages.localError == nil {
            Text("Contacting controller…")
                .foregroundStyle(Theme.secondaryText)
        }
    }

    private func tailnetCandidates(_ snapshot: LocalSnapshot) -> [TailnetDevice] {
        (snapshot.tailnet?.devices ?? []).filter { device in
            !device.linked && (device.controllerUrl != nil || device.os == "linux" || device.os == "macOS")
        }
    }

    private func binding(_ url: String) -> Binding<MachineUI> {
        Binding(get: { machines[url] ?? MachineUI() }, set: { machines[url] = $0 })
    }
}

private struct StatusDot: View {
    let color: Color
    let help: String

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
            .help(help)
            .accessibilityLabel(help)
    }
}

private struct MachineRow: View {
    let controller: LocalController
    let pages: PagesStore
    @Binding var ui: MachineUI
    @FocusState private var renaming: Bool
    @State private var hovering = false

    var body: some View {
        DisclosureGroup(isExpanded: Binding(get: { ui.open && controller.reachable }, set: { ui.open = $0 })) {
            MachineDetails(controller: controller, pages: pages, ui: $ui)
        } label: {
            header
        }
        .disabled(!controller.reachable && !ui.open)
    }

    private var header: some View {
        HStack(spacing: 10) {
            dot
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if let editing = ui.editing {
                        TextField("Machine name", text: Binding(get: { editing }, set: { ui.editing = $0 }))
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 180)
                            .focused($renaming)
                            .onAppear { renaming = true }
                            .onSubmit(commitRename)
                            .onExitCommand { ui.editing = nil }
                            .onChange(of: renaming) { _, focused in
                                if !focused { ui.editing = nil }
                            }
                    } else {
                        Text(controller.name)
                            .font(.system(size: 13, weight: .medium))
                            .lineLimit(1)
                        if controller.reachable, hovering || pages.isPending(.rename(controller.target)) {
                            Button {
                                ui.editing = controller.name
                            } label: {
                                Image(systemName: pages.isPending(.rename(controller.target)) ? "clock" : "pencil")
                                    .icon(.control, .primary)
                                    .frame(width: 24, height: 24)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .help("Rename \(controller.name)")
                            .accessibilityLabel("Rename \(controller.name)")
                        }
                    }
                    Button {
                        ui.reveal.toggle()
                    } label: {
                        Text(controller.host)
                            .font(.system(size: 11.5))
                            .monospacedDigit()
                            .foregroundStyle(Theme.secondaryText)
                            .redacted(reason: ui.reveal ? [] : .placeholder)
                    }
                    .buttonStyle(.plain)
                    .help(ui.reveal ? "Hide address" : "Show address")
                    .accessibilityLabel(ui.reveal ? "Hide address" : "Show address")
                }
                Text(controller.summary)
                    .font(.system(size: 11.5))
                    .foregroundStyle(subtitleTone)
                    .lineLimit(1)
            }
            Spacer(minLength: 12)
            if let hardware = controller.hardware, hardware.memoryCapacityBytes > 0 {
                MemoryBar(hardware: hardware)
            }
        }
        .padding(.vertical, 2)
        .onHover { hovering = $0 }
    }

    @ViewBuilder private var dot: some View {
        switch controller.status {
        case .offline: StatusDot(color: .red, help: "Offline")
        case .serving: StatusDot(color: controller.endpoints.contains(where: \.stale) ? .orange : .green, help: "Serving")
        case .loading: StatusDot(color: .orange, help: "Loading")
        case .engineUnreachable: StatusDot(color: .orange, help: "Engine not answering")
        case .noModel: StatusDot(color: Theme.input, help: "Idle")
        }
    }

    private var subtitleTone: Color {
        switch controller.status {
        case .offline: .red
        case .engineUnreachable: .orange
        default: controller.endpoints.contains(where: \.stale) ? .orange : Theme.secondaryText
        }
    }

    private func commitRename() {
        let name = (ui.editing ?? "").trimmingCharacters(in: .whitespaces)
        ui.editing = nil
        guard !name.isEmpty, name != controller.name else { return }
        pages.perform(.rename(controller: controller.target, name: name), pending: .rename(controller.target))
    }
}

private struct MemoryBar: View {
    let hardware: LocalHardware

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.input)
                    Capsule()
                        .fill(Color.primary.opacity(0.85))
                        .frame(width: proxy.size.width * fraction)
                }
            }
            .frame(height: 5)
            Text("\(PageFormat.gigabytes(hardware.memoryUsedBytes)) / \(PageFormat.gigabytes(hardware.memoryCapacityBytes)) \(hardware.memoryLabel)")
                .font(.system(size: 11))
                .monospacedDigit()
                .foregroundStyle(Theme.secondaryText)
        }
        .frame(width: 168)
    }

    private var fraction: CGFloat {
        guard hardware.memoryCapacityBytes > 0 else { return 0 }
        return min(1, CGFloat(hardware.memoryUsedBytes) / CGFloat(hardware.memoryCapacityBytes))
    }
}

private struct MachineDetails: View {
    let controller: LocalController
    let pages: PagesStore
    @Binding var ui: MachineUI

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 2) {
                GridRow {
                    ForEach(metrics, id: \.0) { label, _ in
                        Text(label)
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                GridRow {
                    ForEach(metrics, id: \.0) { _, value in
                        Text(value)
                            .font(.system(size: 13, weight: .medium))
                            .monospacedDigit()
                            .lineLimit(1)
                    }
                }
            }
            ForEach(controller.endpoints, id: \.id) { endpoint in
                EndpointRow(controller: controller, endpoint: endpoint, pages: pages, ui: $ui)
                if ui.sharing == endpoint.port {
                    SharePanel(controller: controller.target, port: endpoint.port, pages: pages) {
                        ui.sharing = nil
                    }
                }
            }
            ForEach(controller.jobs, id: \.id) { job in
                HStack(spacing: 8) {
                    StatusDot(color: job.failed ? .red : .orange, help: job.failed ? "Failed" : "Loading")
                    Text(job.recipeId)
                        .lineLimit(1)
                    Text(job.detail)
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                    Spacer()
                    Button(job.failed ? "Dismiss" : "Cancel") {
                        pages.perform(.stopRun(controller: controller.target, run: job.id), pending: .stopRun(controller.target, job.id))
                    }
                    .controlSize(.small)
                    .disabled(pages.isPending(.stopRun(controller.target, job.id)))
                }
            }
            ModelLoader(controller: controller, pages: pages, ui: $ui)
        }
        .padding(.leading, 17)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var metrics: [(String, String)] {
        [
            ("Tokens served", controller.measuredRequests > 0 ? PageFormat.tokens(controller.tokens) : "—"),
            ("Requests", PageFormat.count(controller.requests)),
            ("Hardware", controller.hardware.map { $0.gpuSummary.isEmpty ? "\($0.cpus) CPUs" : $0.gpuSummary } ?? "—"),
            ("Models loaded", "\(controller.endpoints.filter { $0.state == .loaded }.count)"),
        ]
    }
}

private struct EndpointRow: View {
    let controller: LocalController
    let endpoint: LocalEndpoint
    let pages: PagesStore
    @Binding var ui: MachineUI

    private var armKey: String { "unload \(endpoint.port)" }

    var body: some View {
        HStack(spacing: 8) {
            dot
            Text(endpoint.models.isEmpty ? "No models listed" : endpoint.models.joined(separator: ", "))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            Text(endpoint.controllerId.isEmpty ? endpoint.address : ":\(String(endpoint.port))")
                .font(.system(size: 11.5))
                .monospacedDigit()
                .foregroundStyle(Theme.secondaryText)
            if endpoint.state != .loaded || endpoint.controllerId.isEmpty {
                Text(stateText)
                    .font(.system(size: 11.5))
                    .foregroundStyle(endpoint.state == .unreachable ? .orange : Theme.secondaryText)
                    .lineLimit(1)
                    .help(endpoint.error ?? stateText)
            } else if ui.armed == armKey {
                Button("Confirm Unload", role: .destructive) {
                    ui.armed = nil
                    pages.perform(.stopPort(controller: controller.target, port: endpoint.port), pending: .unload(controller.target, endpoint.port))
                }
                .controlSize(.small)
                .tint(.red)
                .buttonStyle(.borderedProminent)
            } else {
                Button(unloading ? "Unloading…" : "Unload") { ui.armed = armKey }
                    .controlSize(.small)
                    .disabled(unloading)
            }
            Button(ui.sharing == endpoint.port ? "Close" : "Share…") {
                if ui.sharing == endpoint.port {
                    ui.sharing = nil
                } else {
                    ui.sharing = endpoint.port
                    pages.perform(
                        .previewShare(controller: controller.target, port: endpoint.port),
                        pending: .previewShare(controller.target, endpoint.port)
                    )
                }
            }
            .controlSize(.small)
            .disabled(endpoint.state != .loaded || endpoint.controllerId.isEmpty)
        }
    }

    @ViewBuilder private var dot: some View {
        switch endpoint.state {
        case .loaded: StatusDot(color: endpoint.stale ? .orange : .green, help: endpoint.stale ? "Serving, not confirmed recently" : "Serving")
        case .empty: StatusDot(color: Theme.input, help: "No model loaded")
        case .unreachable: StatusDot(color: .orange, help: "Not answering")
        }
    }

    private var stateText: String {
        switch endpoint.state {
        case .loaded: endpoint.stale ? "not confirmed recently" : "serving"
        case .empty: "no model loaded"
        case .unreachable: "not answering"
        }
    }

    private var unloading: Bool {
        pages.isPending(.unload(controller.target, endpoint.port))
    }
}

private struct ModelLoader: View {
    let controller: LocalController
    let pages: PagesStore
    @Binding var ui: MachineUI

    private var ready: [LocalRecipe] { controller.recipes.filter(\.fits) }
    private var serving: [LocalEndpoint] { controller.endpoints.filter { $0.state == .loaded && !$0.controllerId.isEmpty } }

    private var reference: [LocalRecipe] {
        var seen = Set<String>()
        return controller.recipes.filter { recipe in
            !recipe.fits && seen.insert("\(recipe.model) \(recipe.cards) \(recipe.engine)").inserted
        }
    }

    private var picked: LocalRecipe? {
        ready.first { $0.id == ui.choice } ?? ready.first
    }

    private var armKey: String { "load" }
    private var loading: Bool { pages.isPending(.load(controller.target)) }

    var body: some View {
        if controller.recipes.isEmpty {
            Text(pages.local?.registry == nil ? "Reading the registry…" : "The registry has no recipes for this hardware yet.")
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.secondaryText)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(spacing: 8) {
                Picker("Model to load", selection: Binding(get: { picked?.id }, set: { ui.choice = $0; ui.armed = nil })) {
                    if !ready.isEmpty {
                        Section("Ready to load") {
                            ForEach(ready, id: \.id) { recipe in
                                Text("\(recipe.model) · \(recipe.detail)").tag(Optional(recipe.id))
                            }
                        }
                    }
                    if !reference.isEmpty {
                        Section("In the registry, not one-click yet") {
                            ForEach(reference, id: \.id) { recipe in
                                Text("\(recipe.model) · \(referenceDetail(recipe))")
                                    .tag(Optional(recipe.id))
                                    .selectionDisabled()
                            }
                        }
                    }
                    if picked == nil {
                        Text("No loadable model").tag(String?.none)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                if ui.armed == armKey {
                    Button("Unload \(serving.count) and Load", role: .destructive) { load(replace: true) }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                } else {
                    Button(loading ? "Loading…" : "Load") {
                        if serving.isEmpty {
                            load(replace: false)
                        } else {
                            ui.armed = armKey
                        }
                    }
                    .disabled(picked == nil || loading)
                }
            }
            Text(note)
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.secondaryText)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var note: String {
        var text = picked.map { "Recipe \($0.id) · \($0.detail)" }
            ?? "None of the \(reference.count) registry recipes for this hardware can load automatically yet. See the supported hardware below."
        if ui.armed == armKey, let picked {
            text += " Loading \(picked.model) unloads \(serving.flatMap(\.models).joined(separator: ", ")) first."
        }
        return text
    }

    private func referenceDetail(_ recipe: LocalRecipe) -> String {
        guard let blocked = recipe.blocked, !blocked.isEmpty else { return recipe.detail }
        let reason = blocked.split(whereSeparator: { $0 == ":" || $0 == ";" }).first.map(String.init) ?? blocked
        return "\(recipe.detail) · \(reason)"
    }

    private func load(replace: Bool) {
        ui.armed = nil
        guard let picked else { return }
        pages.perform(.runRecipe(controller: controller.target, recipe: picked.id, replace: replace), pending: .load(controller.target))
    }
}

private struct TailnetRow: View {
    let device: TailnetDevice
    let pages: PagesStore

    var body: some View {
        HStack(spacing: 10) {
            StatusDot(color: Theme.input, help: "Not connected")
            VStack(alignment: .leading, spacing: 2) {
                Text(device.controllerName ?? device.name)
                    .font(.system(size: 13, weight: .medium))
                Text(device.controllerUrl != nil ? "Controller found on your tailnet" : "\(device.os) · no controller yet")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
            }
            Spacer()
            if let url = device.controllerUrl {
                Button(pages.isPending(.connect(url)) ? "Connecting…" : "Connect") {
                    pages.perform(.connect(url: url), pending: .connect(url))
                }
                .disabled(pages.isPending(.connect(url)))
            } else {
                Button(pages.isPending(.deploy(device.ip)) ? "Installing…" : "Install") {
                    pages.perform(.deploy(ip: device.ip, name: device.name), pending: .deploy(device.ip))
                }
                .disabled(pages.isPending(.deploy(device.ip)))
            }
        }
    }
}

struct LocalUsageSection: View {
    let usage: LocalUsage?

    var body: some View {
        Section {
            if let usage {
                Grid(alignment: .leading, horizontalSpacing: 28, verticalSpacing: 2) {
                    GridRow {
                        ForEach(metrics(usage), id: \.0) { label, _ in
                            Text(label).font(.system(size: 11)).foregroundStyle(Theme.secondaryText)
                        }
                    }
                    GridRow {
                        ForEach(metrics(usage), id: \.0) { _, value in
                            Text(value).font(.system(size: 17, weight: .semibold)).monospacedDigit()
                        }
                    }
                }
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                if usage.daily.contains(where: { $0.tokens > 0 }) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Daily processed tokens")
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.secondaryText)
                        DailyBars(days: usage.daily, metric: .tokens, label: "Local models")
                            .frame(height: 120)
                    }
                    .padding(.vertical, 4)
                }
                if !usage.models.isEmpty {
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                        GridRow {
                            Text("Model").frame(maxWidth: .infinity, alignment: .leading)
                            Text("Requests").gridColumnAlignment(.trailing)
                            Text("Share").gridColumnAlignment(.trailing)
                            Text("Tokens").gridColumnAlignment(.trailing)
                        }
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.secondaryText)
                        ForEach(usage.models, id: \.model) { row in
                            GridRow {
                                Text(row.model).lineLimit(1).truncationMode(.middle).frame(maxWidth: .infinity, alignment: .leading)
                                Text(PageFormat.count(row.requests))
                                Text("\(Int(row.sharePercent.rounded()))%")
                                Text(row.measured ? PageFormat.tokens(row.tokens) : "—")
                            }
                            .monospacedDigit()
                        }
                    }
                }
            } else {
                Text("Usage appears once a controller answers.")
                    .foregroundStyle(Theme.secondaryText)
            }
        } header: {
            Text("Usage")
        } footer: {
            if let usage {
                Text("\(usage.models.isEmpty ? "No requests yet. " : "")Input + output tokens, including cached input, counted in UTC with weeks starting Monday. Tokens are known for \(PageFormat.count(usage.measuredRequests)) of \(PageFormat.count(usage.requests)) requests; traffic sent straight to an engine is not seen.")
                    .font(.callout)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
    }

    private func metrics(_ usage: LocalUsage) -> [(String, String)] {
        let shown: (UInt64) -> String = { usage.measuredRequests > 0 ? PageFormat.tokens($0) : "—" }
        return [
            ("Today", shown(usage.todayTokens)),
            ("This week", shown(usage.weekTokens)),
            ("All time", shown(usage.allTokens)),
            ("Requests", PageFormat.count(usage.requests)),
        ]
    }
}

enum UsageMetric: String, CaseIterable {
    case cost
    case tokens

    var title: String {
        switch self {
        case .cost: "Cost"
        case .tokens: "Tokens"
        }
    }
}

struct DailyBars: View {
    let days: [UsageDay]
    let metric: UsageMetric
    let label: String

    private static let parser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()

    var body: some View {
        Chart(points, id: \.date) { point in
            BarMark(
                x: .value("Day", point.date, unit: .day),
                y: .value(metric.title, point.value)
            )
            .foregroundStyle(Theme.primary)
            .cornerRadius(2)
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .day, count: max(1, points.count / 6))) { _ in
                AxisValueLabel(format: .dateTime.month(.abbreviated).day(), centered: true)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine().foregroundStyle(Theme.hairline)
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(metric == .cost ? PageFormat.cost(number) : PageFormat.tokens(UInt64(max(0, number))))
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
            }
        }
        .accessibilityLabel(label)
        .transaction { $0.animation = nil }
    }

    private var points: [(date: Date, value: Double)] {
        days.compactMap { day in
            guard let date = Self.parser.date(from: day.day) else { return nil }
            return (date, metric == .cost ? day.costUsd : Double(day.tokens))
        }
    }
}
