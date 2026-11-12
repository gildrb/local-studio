import AppKit
import LocalStudioKit
import SwiftUI

struct ComposerControls: View {
    let store: StudioStore
    let draft: ComposerDraft
    let project: String?
    let canSend: Bool
    var compact = false
    let send: () -> Void

    var body: some View {
        let conversation = store.conversation
        let settings = store.pages.settings
        let title = modelTitle
        let levels = conversation.thinkingLevels(settings: settings)
        let level = conversation.thinkingLevel(settings: settings)
        HStack(spacing: 2) {
            HStack(spacing: 2) {
                ComposerIconButton(title: "Attach files", symbol: "paperclip", action: attach)
                ModelPickerButton(store: store, title: title, presented: conversation.modelPickerPresented)
                    .equatable()
                ThinkingMenu(store: store, levels: levels, current: level)
                    .equatable()
                ServiceTierMenu(store: store, tiers: conversation.serviceTiers(settings: settings), current: conversation.serviceTier(settings: settings))
                    .equatable()
                AccessMenu(store: store, current: conversation.access(settings: settings))
                    .equatable()
                StashMenu(store: store, project: project, prompts: conversation.stash.list(conversation.stashKey(project: project)), canStash: !draft.isEmpty)
                    .equatable()
                GoalChip(goal: conversation.info?.goal)
                    .equatable()
            }
            .opacity(compact ? 0 : 1)
            .allowsHitTesting(!compact)
            .accessibilityHidden(compact)
            Spacer(minLength: 8)
            if settings?.contextWindowMeter ?? true {
                ContextMeter(store: store)
                    .opacity(compact ? 0 : 1)
                    .allowsHitTesting(!compact)
                    .accessibilityHidden(compact)
            }
            if conversation.busy {
                RoundActionButton(title: "Stop generation", label: compact ? nil : "Stop", symbol: "stop.fill", fill: .red, enabled: true) {
                    conversation.abort()
                }
                .keyboardShortcut(".", modifiers: .command)
            }
            RoundActionButton(
                title: sendTitle(busy: conversation.busy, steers: settings?.followUpBehavior == .steer),
                label: compact ? nil : sendLabel(busy: conversation.busy, steers: settings?.followUpBehavior == .steer),
                symbol: "arrow.up",
                fill: Theme.primary,
                enabled: canSend,
                action: send
            )
        }
        .frame(height: 30)
        .onChange(of: ComposerProbe(model: title, thinking: levels.first.map { ThinkingMenu.title(level ?? $0) }), initial: true) { _, probe in
            store.shell.probe.composer = probe
        }
    }

    private var modelTitle: String {
        let conversation = store.conversation
        let fanOut = conversation.newThread.fanOutModels(available: conversation.models)
        if conversation.thread == nil, fanOut.count >= 2 {
            return "\(fanOut.count) models"
        }
        return conversation.currentModel(settings: store.pages.settings)?.name ?? "Model"
    }

    private func sendTitle(busy: Bool, steers: Bool) -> String {
        guard busy else { return "Send message" }
        return steers ? "Steer the running turn (⌥↩ queues)" : "Queue message (⌥↩ steers)"
    }

    private func sendLabel(busy: Bool, steers: Bool) -> String {
        guard busy else { return "Send" }
        return steers ? "Steer" : "Queue"
    }

    private func attach() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.prompt = "Attach"
        if let project {
            panel.directoryURL = URL(fileURLWithPath: project, isDirectory: true)
        }
        guard panel.runModal() == .OK else { return }
        draft.attach(urls: panel.urls, project: project)
    }
}

struct ComposerIconButton: View {
    let title: String
    let symbol: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .icon(.control, .primary)
                .frame(width: 28, height: 28)
                .background(hovering ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
        .onHover { hovering = $0 }
    }
}

struct ComposerChip: View {
    let title: String
    var symbol: String?
    var hovering = false

    var body: some View {
        HStack(spacing: 5) {
            if let symbol {
                Image(systemName: symbol)
                    .icon(.inline)
                    .accessibilityHidden(true)
            }
            Text(title)
                .lineLimit(1)
            Image(systemName: "chevron.down")
                .icon(.inline)
                .accessibilityHidden(true)
        }
        .font(.system(size: 12.5))
        .foregroundStyle(hovering ? Color.primary : Theme.text)
        .padding(.horizontal, 8)
        .frame(height: 28)
        .background(hovering ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(Rectangle())
    }
}

private struct RoundActionButton: View {
    let title: String
    let label: String?
    let symbol: String
    let fill: Color
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: symbol)
                    .icon(.inline)
                if let label {
                    Text(label)
                        .font(.system(size: 12.5, weight: .semibold))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(enabled ? Color.white : Theme.secondaryText)
            .padding(.horizontal, label == nil ? 0 : 11)
            .frame(minWidth: 28, minHeight: 28)
            .background(enabled ? fill : Theme.input, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .help(title)
        .accessibilityLabel(title)
        .padding(.leading, 4)
    }
}

private struct ModelPickerButton: View, Equatable {
    let store: StudioStore
    let title: String
    let presented: Bool
    @State private var hovering = false

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.store === rhs.store && lhs.title == rhs.title && lhs.presented == rhs.presented
    }

    var body: some View {
        let conversation = store.conversation
        Button {
            conversation.modelPickerPresented.toggle()
        } label: {
            ComposerChip(title: title, hovering: hovering || presented)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help("Model")
        .accessibilityLabel("Model: \(title)")
        .popover(isPresented: Binding { presented } set: { conversation.modelPickerPresented = $0 }, arrowEdge: .bottom) {
            ModelPickerPanel(store: store) { conversation.modelPickerPresented = false }
        }
    }
}

private struct ModelSection: Identifiable {
    let id: String
    let title: String
    let models: [ModelOption]
}

struct ModelPickerPanel: View {
    let store: StudioStore
    let dismiss: () -> Void
    @State private var query = ""
    @State private var showsHidden: Bool
    @State private var focusedProvider: String?

    init(store: StudioStore, revealHidden: Bool = false, dismiss: @escaping () -> Void) {
        self.store = store
        self.dismiss = dismiss
        _showsHidden = State(initialValue: revealHidden)
    }

    var body: some View {
        let conversation = store.conversation
        let configured = conversation.models.filter(\.configured)
        let hiddenCount = configured.filter(conversation.isHidden).count
        let sections = sections(configured)
        let current = conversation.currentModel(settings: store.pages.settings)
        let jumps = jumpOrder(sections)
        let providers = sections.map(\.id).filter { $0 != "favorites" && $0 != "hidden" }
        VStack(spacing: 0) {
            if configured.count > 8 {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .icon(.inline, .secondary)
                        .accessibilityHidden(true)
                    TextField("Search models", text: $query)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13))
                }
                .padding(.horizontal, 12)
                .frame(height: 36)
                Rectangle().fill(Theme.hairline).frame(height: 1)
            }
            if sections.isEmpty {
                Text(emptyText(configured: configured, hiddenCount: hiddenCount))
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .padding(20)
                    .frame(maxWidth: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(sections) { section in
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(section.title)
                                        .font(.system(size: 11.5, weight: .medium))
                                        .foregroundStyle(section.id == focusedProvider ? Color.primary : Theme.secondaryText)
                                        .padding(.horizontal, 10)
                                        .padding(.top, section.id == sections.first?.id ? 4 : 10)
                                        .padding(.bottom, 3)
                                        .accessibilityAddTraits(.isHeader)
                                    ForEach(section.models, id: \.key) { model in
                                        let firstAppearance = section.id == "favorites" || !conversation.isFavorite(model)
                                        ModelRow(
                                            model: model,
                                            selected: multi ? options.isFanOut(model) : current?.provider == model.provider && current?.id == model.id,
                                            favorite: conversation.isFavorite(model),
                                            hidden: conversation.isHidden(model),
                                            jump: firstAppearance ? jumps.firstIndex { $0.key == model.key }.flatMap { $0 < 9 ? $0 + 1 : nil } : nil
                                        ) {
                                            choose(model, current: current)
                                        } toggleFavorite: {
                                            conversation.setFavorite(model, !conversation.isFavorite(model))
                                        } toggleHidden: {
                                            conversation.setHidden(model, !conversation.isHidden(model))
                                        }
                                    }
                                }
                                .id(section.id)
                            }
                        }
                        .padding(6)
                    }
                    .frame(maxHeight: 380)
                    .fixedSize(horizontal: false, vertical: true)
                    .onChange(of: focusedProvider) { _, provider in
                        guard let provider else { return }
                        proxy.scrollTo(provider, anchor: .top)
                    }
                }
            }
            if hiddenCount > 0 || showsHidden {
                Rectangle().fill(Theme.hairline).frame(height: 1)
                Toggle(isOn: $showsHidden) {
                    Text(hiddenCount == 1 ? "Show 1 hidden model" : "Show \(hiddenCount) hidden models")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.secondaryText)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .padding(.horizontal, 12)
                .frame(height: 34)
            }
            if conversation.thread == nil, configured.count > 1 {
                Rectangle().fill(Theme.hairline).frame(height: 1)
                Toggle(isOn: Binding(get: { options.multiModel }, set: { setMulti($0, current: current) })) {
                    Text(multi ? "Run on \(options.fanOut.count) models (⌘-click to add)" : "Run on several models")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.secondaryText)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .help("Start one thread per selected model, each in its own worktree")
            }
            Rectangle().fill(Theme.hairline).frame(height: 1)
            AddProviderRow {
                dismiss()
                store.openProvidersSettings()
            }
        }
        .frame(width: 320)
        .modifier(ModelPickerJumpCommands(store: store, models: jumps) { model in
            choose(model, current: current)
        })
        .studioCommand("modelPicker.previousProvider", in: store, enabled: providers.count > 1) {
            step(-1, providers: providers, current: current)
        }
        .studioCommand("modelPicker.nextProvider", in: store, enabled: providers.count > 1) {
            step(1, providers: providers, current: current)
        }
        .task {
            if conversation.models.isEmpty {
                conversation.loadModels()
            }
        }
    }

    private var options: NewThreadOptions {
        store.conversation.newThread
    }

    private var multi: Bool {
        store.conversation.thread == nil && options.multiModel
    }

    private func setMulti(_ on: Bool, current: ModelOption?) {
        options.multiModel = on
        if on, options.fanOut.isEmpty, let current {
            options.toggleFanOut(current)
        }
    }

    private func step(_ delta: Int, providers: [String], current: ModelOption?) {
        let index = (focusedProvider ?? current?.provider).flatMap(providers.firstIndex(of:)) ?? (delta > 0 ? -1 : providers.count)
        focusedProvider = providers[(index + delta + providers.count) % providers.count]
    }

    private func choose(_ model: ModelOption, current: ModelOption?) {
        let commandClick = NSApp.currentEvent?.modifierFlags.contains(.command) == true
        if store.conversation.thread == nil, commandClick || options.multiModel {
            if !options.multiModel {
                setMulti(true, current: current)
            }
            if !(commandClick && options.fanOut.count == 1 && options.isFanOut(model)) {
                options.toggleFanOut(model)
            }
            return
        }
        store.conversation.selectModel(model)
        dismiss()
    }

    private func jumpOrder(_ sections: [ModelSection]) -> [ModelOption] {
        var seen = Set<String>()
        return sections.filter { $0.id != "hidden" }.flatMap(\.models).filter { seen.insert($0.key).inserted }
    }

    private func emptyText(configured: [ModelOption], hiddenCount: Int) -> String {
        if !store.conversation.modelsLoaded {
            return "Loading models…"
        }
        if configured.isEmpty {
            return "No configured providers. Add a key or an endpoint to choose a model."
        }
        if hiddenCount == configured.count, !showsHidden {
            return "Every model is hidden."
        }
        return "No models match “\(query)”."
    }

    private func sections(_ configured: [ModelOption]) -> [ModelSection] {
        let conversation = store.conversation
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let matching = needle.isEmpty ? configured : configured.filter {
            $0.name.lowercased().contains(needle) || $0.id.lowercased().contains(needle) || $0.provider.lowercased().contains(needle)
        }
        let visible = matching.filter { !conversation.isHidden($0) }
        var sections: [ModelSection] = []
        let favorites = visible.filter(conversation.isFavorite)
        if !favorites.isEmpty {
            sections.append(ModelSection(id: "favorites", title: "Favorites", models: favorites))
        }
        var order: [String] = []
        var grouped: [String: [ModelOption]] = [:]
        for model in visible {
            if grouped[model.provider] == nil {
                order.append(model.provider)
            }
            grouped[model.provider, default: []].append(model)
        }
        for provider in order.sorted(by: { providerName($0) < providerName($1) }) {
            sections.append(ModelSection(id: provider, title: providerName(provider), models: grouped[provider] ?? []))
        }
        let hidden = matching.filter(conversation.isHidden)
        if showsHidden, !hidden.isEmpty {
            sections.append(ModelSection(id: "hidden", title: "Hidden", models: hidden))
        }
        return sections
    }

    private func providerName(_ provider: String) -> String {
        store.pages.providers.first { $0.id == provider }?.name ?? provider.capitalized
    }
}

private struct AddProviderRow: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "plus")
                    .icon(.inline, .primary)
                    .frame(width: 18)
                    .accessibilityHidden(true)
                Text("Add Provider…")
                    .font(.system(size: 13))
                Spacer()
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(hovering ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .padding(4)
        .help("Add an API key or a custom endpoint in Settings → Providers")
        .accessibilityLabel("Add Provider")
    }
}

extension ModelOption {
    var key: String {
        provider + "/" + id
    }
}

private struct ModelRow: View {
    let model: ModelOption
    let selected: Bool
    let favorite: Bool
    let hidden: Bool
    let jump: Int?
    let select: () -> Void
    let toggleFavorite: () -> Void
    let toggleHidden: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            Button(action: select) {
                HStack(spacing: 8) {
                    Text(model.name)
                        .font(.system(size: 13))
                        .lineLimit(1)
                    if model.contextWindow > 0 {
                        Text(TokenCount(model.contextWindow).text)
                            .font(.system(size: 11.5))
                            .monospacedDigit()
                            .foregroundStyle(Theme.secondaryText)
                    }
                    Spacer(minLength: 0)
                    if let jump {
                        Text("⌘\(jump)")
                            .font(.system(size: 11))
                            .monospacedDigit()
                            .foregroundStyle(Theme.secondaryText.opacity(0.8))
                            .accessibilityHidden(true)
                    }
                    Image(systemName: "checkmark")
                        .icon(.inline)
                        .foregroundStyle(Theme.primary)
                        .frame(width: 16)
                        .opacity(selected ? 1 : 0)
                        .accessibilityHidden(true)
                }
                .opacity(hidden ? 0.55 : 1)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.name)
            .accessibilityAddTraits(selected ? .isSelected : [])
            if hidden {
                Button(action: toggleHidden) {
                    Image(systemName: "eye")
                        .icon(.inline, .primary)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Unhide model")
                .accessibilityLabel("Unhide \(model.name)")
            } else {
                Button(action: toggleFavorite) {
                    Image(systemName: favorite ? "star.fill" : "star")
                        .icon(.inline, .primary)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .opacity(favorite || hovering ? 1 : 0)
                .help(favorite ? "Remove from favorites" : "Add to favorites")
                .accessibilityLabel(favorite ? "Remove \(model.name) from favorites" : "Add \(model.name) to favorites")
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 30)
        .rowSurface(selected: selected, hovering: hovering)
        .onHover { hovering = $0 }
        .contextMenu {
            Button(hidden ? "Unhide Model" : "Hide Model", action: toggleHidden)
            if !hidden {
                Button(favorite ? "Remove from Favorites" : "Add to Favorites", action: toggleFavorite)
            }
        }
    }
}

struct ThinkingMenu: View, Equatable {
    let store: StudioStore
    let levels: [String]
    let current: String?

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.store === rhs.store && lhs.levels == rhs.levels && lhs.current == rhs.current
    }

    var body: some View {
        if let fallback = levels.first {
            let current = current ?? fallback
            let conversation = store.conversation
            PickerChipButton(
                title: Self.title(current),
                help: "Thinking level",
                label: "Thinking level: \(Self.title(current))",
                panelTitle: "Thinking",
                width: 220,
                rows: Self.rows(levels: levels, current: current) { conversation.setThinkingLevel($0) }
            )
        }
    }

    static func rows(levels: [String], current: String, select: @escaping @MainActor (String) -> Void) -> [PickerRow] {
        levels.map { level in
            PickerRow(id: level, title: title(level), checked: level == current) { select(level) }
        }
    }

    static func title(_ level: String) -> String {
        switch level {
        case "off": "Thinking off"
        case "xhigh": "Extra high"
        default: level.capitalized
        }
    }
}

struct ServiceTierMenu: View, Equatable {
    let store: StudioStore
    let tiers: [String]
    let current: String?

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.store === rhs.store && lhs.tiers == rhs.tiers && lhs.current == rhs.current
    }

    var body: some View {
        if !tiers.isEmpty {
            let conversation = store.conversation
            PickerChipButton(
                title: current.map(Self.title) ?? "Standard",
                symbol: current == nil ? nil : "bolt",
                help: "Speed (service tier)",
                label: "Speed: \(current.map(Self.title) ?? "Standard")",
                panelTitle: "Speed",
                width: 220,
                rows: Self.rows(tiers: tiers, current: current) { conversation.setServiceTier($0) }
            )
        }
    }

    static func rows(tiers: [String], current: String?, select: @escaping @MainActor (String?) -> Void) -> [PickerRow] {
        [PickerRow(id: "standard", title: "Standard", checked: current == nil) { select(nil) }]
            + tiers.map { tier in
                PickerRow(id: "tier-" + tier, title: title(tier), symbol: "bolt", checked: tier == current) { select(tier) }
            }
    }

    static func title(_ tier: String) -> String {
        switch tier {
        case "priority", "fast": "Fast"
        case "ultrafast": "Ultrafast"
        case "flex": "Flex"
        default: tier.capitalized
        }
    }
}

private struct GoalChip: View, Equatable {
    let goal: Goal?
    @State private var presented = false
    @State private var hovering = false

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.goal == rhs.goal
    }

    var body: some View {
        if let goal {
            Button {
                presented.toggle()
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "flag")
                        .icon(.inline)
                        .accessibilityHidden(true)
                    Text(goal.active ? "Goal" : goal.status.capitalized)
                        .lineLimit(1)
                    Text(TokenCount(goal.tokensUsed).text)
                        .monospacedDigit()
                        .foregroundStyle(Theme.secondaryText.opacity(0.8))
                }
                .font(.system(size: 12.5))
                .foregroundStyle(hovering || presented ? Color.primary : Theme.text)
                .padding(.horizontal, 8)
                .frame(height: 28)
                .background(hovering ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .help(goal.objective)
            .accessibilityLabel("Goal: \(goal.objective), \(goal.status)")
            .popover(isPresented: $presented, arrowEdge: .bottom) {
                GoalPopover(goal: goal)
            }
        }
    }
}

private struct GoalPopover: View {
    let goal: Goal

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Goal")
                .font(.system(size: 13, weight: .semibold))
            Text(goal.objective)
                .font(.system(size: 12.5))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow {
                    Text("Status").foregroundStyle(Theme.secondaryText)
                    Text(goal.active ? "\(goal.status.capitalized) · active" : goal.status.capitalized)
                }
                GridRow {
                    Text("Tokens").foregroundStyle(Theme.secondaryText)
                    Text(goal.tokenBudget.map { "\(TokenCount(goal.tokensUsed).text) of \(TokenCount($0).text)" } ?? TokenCount(goal.tokensUsed).text)
                        .monospacedDigit()
                }
                GridRow {
                    Text("Time").foregroundStyle(Theme.secondaryText)
                    Text(WorkDuration(milliseconds: goal.timeUsedSeconds * 1_000).text)
                        .monospacedDigit()
                }
            }
            .font(.system(size: 12))
            if let budget = goal.tokenBudget, budget > 0 {
                ProgressView(value: min(Double(goal.tokensUsed) / Double(budget), 1))
                    .tint(Theme.primary)
            }
        }
        .padding(16)
        .frame(width: 280)
    }
}

struct AccessMenu: View, Equatable {
    let store: StudioStore
    let current: AccessMode

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.store === rhs.store && lhs.current == rhs.current
    }

    var body: some View {
        let conversation = store.conversation
        PickerChipButton(
            title: current.title,
            symbol: current.symbol,
            help: "Access",
            label: "Access: \(current.title)",
            panelTitle: "Access",
            width: 300,
            rows: Self.rows(current: current) { conversation.setAccess($0) }
        )
    }

    static func rows(current: AccessMode, select: @escaping @MainActor (AccessMode) -> Void) -> [PickerRow] {
        AccessMode.all.map { mode in
            PickerRow(id: mode.title, title: mode.title, symbol: mode.symbol, subtitle: mode.detail, checked: mode == current) { select(mode) }
        }
    }
}

extension AccessMode {
    static let all: [AccessMode] = [.supervised, .autoAcceptEdits, .auto, .fullAccess]

    var title: String {
        switch self {
        case .supervised: "Supervised"
        case .autoAcceptEdits: "Auto-accept edits"
        case .auto: "Auto"
        case .fullAccess: "Full access"
        }
    }

    var detail: String {
        switch self {
        case .supervised: "Ask before commands and file changes."
        case .autoAcceptEdits: "Apply file edits without asking; ask before commands."
        case .auto: "Approve routine actions; ask before the rest."
        case .fullAccess: "Allow commands and edits without prompts."
        }
    }

    var symbol: String {
        switch self {
        case .supervised: "lock"
        case .autoAcceptEdits: "pencil"
        case .auto: "sparkles"
        case .fullAccess: "lock.open"
        }
    }
}

private struct ContextMeter: View {
    let store: StudioStore
    @State private var presented = false
    @State private var hovering = false

    var body: some View {
        if let info = store.conversation.info, let context = info.context, context.window > 0 {
            let fraction = min(Double(context.tokens) / Double(context.window), 1)
            Button {
                presented.toggle()
            } label: {
                HStack(spacing: 5) {
                    ZStack {
                        Circle().stroke(Theme.text.opacity(0.25), lineWidth: 2.5)
                        Circle()
                            .trim(from: 0, to: fraction)
                            .stroke(fraction > 0.9 ? Color.red : Theme.text, style: StrokeStyle(lineWidth: 2.5))
                            .rotationEffect(.degrees(-90))
                    }
                    .frame(width: 14, height: 14)
                    Text("\(Int((fraction * 100).rounded()))%")
                        .font(.system(size: 11.5))
                        .monospacedDigit()
                        .foregroundStyle(hovering || presented ? Color.primary : Theme.secondaryText)
                }
                .padding(.horizontal, 7)
                .frame(height: 28)
                .background(hovering ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .help("Context window: \(Int((fraction * 100).rounded()))% used")
            .accessibilityLabel("Context window: \(Int((fraction * 100).rounded()))% used")
            .popover(isPresented: $presented, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Context window")
                        .font(.system(size: 13, weight: .semibold))
                    Text("\(Int((fraction * 100).rounded()))% · \(TokenCount(context.tokens).text) / \(TokenCount(context.window).text) tokens")
                        .font(.system(size: 12.5))
                        .monospacedDigit()
                        .foregroundStyle(Theme.secondaryText)
                    ProgressView(value: fraction)
                        .tint(fraction > 0.9 ? .red : Theme.primary)
                    Button("Compact Context") {
                        store.conversation.compact()
                        presented = false
                    }
                    .disabled(info.busy || info.compacting)
                }
                .padding(16)
                .frame(width: 260)
            }
        }
    }
}

struct ThreadContextStrip: View {
    let store: StudioStore

    var body: some View {
        let conversation = store.conversation
        if let thread = conversation.thread {
            let row = store.inbox.thread(thread)
            strip {
                if let branch = conversation.info?.branch ?? row?.branch {
                    IconLabel(branch, symbol: "arrow.triangle.branch")
                        .padding(.horizontal, 8)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Branch: \(branch)")
                    if (conversation.info?.worktree ?? row?.worktree) != nil {
                        Text("Worktree")
                            .padding(.horizontal, 4)
                    }
                }
            }
        } else if let project = store.inbox.project(store.inbox.currentProject), project.isGit {
            let options = conversation.newThread
            strip {
                if options.fanOutModels(available: conversation.models).count >= 2 {
                    IconLabel("One new worktree per model", symbol: "arrow.triangle.branch")
                        .padding(.horizontal, 8)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Workspace: one new worktree per model")
                } else if let branch = options.existingBranch, options.existingWorktree != nil {
                    IconLabel("Worktree · \(branch)", symbol: "lock")
                        .padding(.horizontal, 8)
                        .help(options.existingWorktree ?? "")
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Existing worktree: \(branch)")
                    Button("Change") { options.chooseWorkspace(worktree: false) }
                        .buttonStyle(.link)
                        .font(.system(size: 12))
                } else {
                    WorkspaceMenu(options: options, worktree: options.usesWorktree(store.pages.settings))
                    if options.usesWorktree(store.pages.settings) {
                        BaseBranchButton(store: store, project: project.id)
                        BranchNameField(options: options)
                    }
                }
            }
        }
    }

    private func strip<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 2) {
            content()
            Spacer(minLength: 0)
        }
        .font(.system(size: 12))
        .foregroundStyle(Theme.secondaryText)
        .frame(height: 28)
        .padding(.horizontal, 6)
    }
}

struct WorkspaceMenu: View {
    let options: NewThreadOptions
    let worktree: Bool

    var body: some View {
        PickerChipButton(
            title: worktree ? "New worktree" : "Local checkout",
            symbol: worktree ? "arrow.triangle.branch" : "folder",
            help: "Workspace",
            label: worktree ? "Workspace: New worktree" : "Workspace: Local checkout",
            panelTitle: "Workspace",
            width: 220,
            rows: Self.rows(worktree: worktree) { options.chooseWorkspace(worktree: $0) }
        )
    }

    static func rows(worktree: Bool, choose: @escaping @MainActor (Bool) -> Void) -> [PickerRow] {
        [
            PickerRow(id: "local", title: "Local checkout", symbol: "folder", checked: !worktree) { choose(false) },
            PickerRow(id: "worktree", title: "New worktree", symbol: "arrow.triangle.branch", checked: worktree) { choose(true) },
        ]
    }
}

private struct BranchNameField: View {
    @Bindable var options: NewThreadOptions

    var body: some View {
        TextField("Branch name", text: $options.branch, prompt: Text("Branch name (automatic)").foregroundStyle(Theme.secondaryText))
            .textFieldStyle(.plain)
            .font(.system(size: 12.5))
            .frame(width: 200)
            .padding(.horizontal, 8)
    }
}

struct BaseBranchButton: View {
    let store: StudioStore
    let project: String
    @State private var query = ""

    var body: some View {
        let options = store.conversation.newThread
        let base = options.base ?? defaultBase
        let rows = Self.rows(branches, selected: base) { options.base = $0 }
        let empty = store.conversation.branchRequest.flatMap { store.workspace.branches[$0] } == nil ? "Loading branches…" : "No matching branches."
        let presented = Binding { options.branchPickerOpen } set: { options.branchPickerOpen = $0 }
        PickerChipButton(title: "from " + base, help: "Base branch", label: "Base branch: \(base)", presented: presented) { dismiss in
            PickerPanel(rows: rows, query: $query, prompt: "Search branches", emptyText: empty, width: 300, maxHeight: 300, dismiss: dismiss)
                .task(id: query) {
                    try? await Task.sleep(for: .milliseconds(query.isEmpty ? 0 : 150))
                    guard !Task.isCancelled else { return }
                    store.conversation.loadBranches(project: project, query: query)
                }
        }
    }

    static func rows(_ branches: [Branch], selected: String, choose: @escaping @MainActor (String) -> Void) -> [PickerRow] {
        branches.map { branch in
            PickerRow(
                id: branch.name,
                title: branch.name,
                symbol: branch.remote ? "globe" : "arrow.triangle.branch",
                detail: branch.current ? "current" : nil,
                checked: branch.name == selected
            ) { choose(branch.name) }
        }
    }

    private var branches: [Branch] {
        store.conversation.branchRequest.flatMap { store.workspace.branches[$0] } ?? []
    }

    private var defaultBase: String {
        store.workspace.gitStatus[project]?.branch ?? "current branch"
    }
}
