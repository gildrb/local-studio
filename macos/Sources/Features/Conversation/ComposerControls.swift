import AppKit
import LocalStudioKit
import SwiftUI

struct ComposerControls: View {
    let store: StudioStore
    let draft: ComposerDraft
    let project: String?
    let canSend: Bool
    let send: () -> Void

    var body: some View {
        let conversation = store.conversation
        let settings = store.pages.settings
        HStack(spacing: 2) {
            ComposerIconButton(title: "Attach files", symbol: "paperclip", action: attach)
            ModelPickerButton(store: store)
            ThinkingMenu(store: store)
            AccessMenu(store: store)
            StashMenu(store: store, project: project)
            Spacer(minLength: 8)
            if settings?.contextWindowMeter ?? true {
                ContextMeter(store: store)
            }
            if conversation.busy {
                RoundActionButton(title: "Stop generation", symbol: "stop.fill", size: 9, fill: .red, enabled: true) {
                    conversation.abort()
                }
                .keyboardShortcut(".", modifiers: .command)
            }
            RoundActionButton(
                title: sendTitle(busy: conversation.busy, steers: settings?.followUpBehavior == .steer),
                symbol: "arrow.up",
                size: 12,
                fill: Theme.primary,
                enabled: canSend,
                action: send
            )
        }
        .frame(height: 30)
    }

    private func sendTitle(busy: Bool, steers: Bool) -> String {
        guard busy else { return "Send message" }
        return steers ? "Steer the running turn (⌥↩ queues)" : "Queue message (⌥↩ steers)"
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
                .font(.system(size: 14, weight: .light))
                .foregroundStyle(Theme.chromeIcon)
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
                    .font(.system(size: 12, weight: .light))
                    .accessibilityHidden(true)
            }
            Text(title)
                .lineLimit(1)
            Image(systemName: "chevron.down")
                .font(.system(size: 8, weight: .medium))
                .opacity(0.7)
                .accessibilityHidden(true)
        }
        .font(.system(size: 12.5))
        .foregroundStyle(hovering ? Color.primary : Theme.secondaryText)
        .padding(.horizontal, 8)
        .frame(height: 28)
        .background(hovering ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(Rectangle())
    }
}

private struct RoundActionButton: View {
    let title: String
    let symbol: String
    let size: CGFloat
    let fill: Color
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(enabled ? Color.white : Theme.secondaryText)
                .frame(width: 28, height: 28)
                .background(enabled ? fill : Theme.input, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .help(title)
        .accessibilityLabel(title)
        .padding(.leading, 4)
    }
}

private struct ModelPickerButton: View {
    let store: StudioStore
    @State private var hovering = false

    var body: some View {
        let conversation = store.conversation
        Button {
            conversation.modelPickerPresented.toggle()
        } label: {
            ComposerChip(title: title, hovering: hovering || conversation.modelPickerPresented)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help("Model")
        .accessibilityLabel("Model: \(title)")
        .popover(isPresented: Bindable(conversation).modelPickerPresented, arrowEdge: .bottom) {
            ModelPickerPanel(store: store) { conversation.modelPickerPresented = false }
        }
    }

    private var title: String {
        store.conversation.currentModel(settings: store.pages.settings)?.name ?? "Model"
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
        VStack(spacing: 0) {
            if configured.count > 8 {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12, weight: .light))
                        .foregroundStyle(Theme.secondaryText)
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
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(sections) { section in
                            VStack(alignment: .leading, spacing: 0) {
                                Text(section.title)
                                    .font(.system(size: 11.5, weight: .medium))
                                    .foregroundStyle(Theme.secondaryText)
                                    .padding(.horizontal, 10)
                                    .padding(.top, section.id == sections.first?.id ? 4 : 10)
                                    .padding(.bottom, 3)
                                    .accessibilityAddTraits(.isHeader)
                                ForEach(section.models, id: \.key) { model in
                                    ModelRow(
                                        model: model,
                                        selected: current?.provider == model.provider && current?.id == model.id,
                                        favorite: conversation.isFavorite(model),
                                        hidden: conversation.isHidden(model)
                                    ) {
                                        conversation.selectModel(model)
                                        dismiss()
                                    } toggleFavorite: {
                                        conversation.setFavorite(model, !conversation.isFavorite(model))
                                    } toggleHidden: {
                                        conversation.setHidden(model, !conversation.isHidden(model))
                                    }
                                }
                            }
                        }
                    }
                    .padding(6)
                }
                .frame(maxHeight: 380)
                .fixedSize(horizontal: false, vertical: true)
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
        }
        .frame(width: 320)
        .task {
            if conversation.models.isEmpty {
                conversation.loadModels()
            }
        }
    }

    private func emptyText(configured: [ModelOption], hiddenCount: Int) -> String {
        if !store.conversation.modelsLoaded {
            return "Loading models…"
        }
        if configured.isEmpty {
            return "No configured providers. Sign in to a provider to choose a model."
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
                    if selected {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.primary)
                            .accessibilityHidden(true)
                    }
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
                        .font(.system(size: 11.5, weight: .light))
                        .foregroundStyle(Theme.secondaryText)
                        .frame(width: 20, height: 20)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Unhide model")
                .accessibilityLabel("Unhide \(model.name)")
            } else {
                Button(action: toggleFavorite) {
                    Image(systemName: favorite ? "star.fill" : "star")
                        .font(.system(size: 11.5, weight: .light))
                        .foregroundStyle(favorite ? Color.primary.opacity(0.8) : Theme.secondaryText)
                        .frame(width: 20, height: 20)
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

private struct ThinkingMenu: View {
    let store: StudioStore
    @State private var hovering = false

    var body: some View {
        let conversation = store.conversation
        let settings = store.pages.settings
        let levels = conversation.thinkingLevels(settings: settings)
        if let fallback = levels.first {
            let current = conversation.thinkingLevel(settings: settings) ?? fallback
            Menu {
                Picker("Thinking", selection: Binding(get: { current }, set: { conversation.setThinkingLevel($0) })) {
                    ForEach(levels, id: \.self) { level in
                        Text(Self.title(level)).tag(level)
                    }
                }
                .pickerStyle(.inline)
            } label: {
                ComposerChip(title: Self.title(current), hovering: hovering)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .onHover { hovering = $0 }
            .help("Thinking level")
            .accessibilityLabel("Thinking level: \(Self.title(current))")
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

private struct AccessMenu: View {
    let store: StudioStore
    @State private var hovering = false

    var body: some View {
        let conversation = store.conversation
        let current = conversation.access(settings: store.pages.settings)
        Menu {
            ForEach(AccessMode.all, id: \.self) { mode in
                Toggle(isOn: Binding(get: { current == mode }, set: { if $0 { conversation.setAccess(mode) } })) {
                    Text(mode.title)
                    Text(mode.detail)
                }
            }
        } label: {
            ComposerChip(title: current.title, symbol: current.symbol, hovering: hovering)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .onHover { hovering = $0 }
        .help("Access")
        .accessibilityLabel("Access: \(current.title)")
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
        case .auto: "Approve routine actions automatically; ask for the rest."
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
                        Circle().stroke(Theme.chromeIcon.opacity(0.22), lineWidth: 2)
                        Circle()
                            .trim(from: 0, to: fraction)
                            .stroke(fraction > 0.9 ? Color.red : Theme.chromeIcon, style: StrokeStyle(lineWidth: 2))
                            .rotationEffect(.degrees(-90))
                    }
                    .frame(width: 13, height: 13)
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
        if conversation.thread != nil {
            if let info = conversation.info, let branch = info.branch {
                strip {
                    Label(branch, systemImage: "arrow.triangle.branch")
                        .padding(.horizontal, 8)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Branch: \(branch)")
                    if info.worktree != nil {
                        Text("Worktree")
                            .padding(.horizontal, 4)
                    }
                }
            }
        } else if let project = store.inbox.project(store.inbox.currentProject), project.isGit {
            let options = conversation.newThread
            strip {
                if let branch = options.existingBranch, options.existingWorktree != nil {
                    Label("Worktree · \(branch)", systemImage: "lock")
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

private struct WorkspaceMenu: View {
    let options: NewThreadOptions
    let worktree: Bool
    @State private var hovering = false

    var body: some View {
        Menu {
            Picker("Workspace", selection: Binding(get: { worktree }, set: { options.chooseWorkspace(worktree: $0) })) {
                Label("Local checkout", systemImage: "folder").tag(false)
                Label("New worktree", systemImage: "arrow.triangle.branch").tag(true)
            }
            .pickerStyle(.inline)
        } label: {
            ComposerChip(
                title: worktree ? "New worktree" : "Local checkout",
                symbol: worktree ? "arrow.triangle.branch" : "folder",
                hovering: hovering
            )
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .onHover { hovering = $0 }
        .help("Workspace")
        .accessibilityLabel(worktree ? "Workspace: New worktree" : "Workspace: Local checkout")
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

private struct BaseBranchButton: View {
    let store: StudioStore
    let project: String
    @State private var presented = false
    @State private var hovering = false
    @State private var query = ""

    var body: some View {
        let options = store.conversation.newThread
        Button {
            presented.toggle()
        } label: {
            ComposerChip(title: "from " + (options.base ?? defaultBase), hovering: hovering || presented)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help("Base branch")
        .accessibilityLabel("Base branch: \(options.base ?? defaultBase)")
        .popover(isPresented: $presented, arrowEdge: .bottom) {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12, weight: .light))
                        .foregroundStyle(Theme.secondaryText)
                        .accessibilityHidden(true)
                    TextField("Search branches", text: $query)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13))
                }
                .padding(.horizontal, 12)
                .frame(height: 36)
                Rectangle().fill(Theme.hairline).frame(height: 1)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(branches, id: \.name) { branch in
                            BranchRow(branch: branch, selected: branch.name == (options.base ?? defaultBase)) {
                                options.base = branch.name
                                presented = false
                            }
                        }
                        if branches.isEmpty {
                            Text(store.conversation.branchRequest.flatMap { store.workspace.branches[$0] } == nil ? "Loading branches…" : "No matching branches.")
                                .font(.system(size: 12.5))
                                .foregroundStyle(Theme.secondaryText)
                                .padding(14)
                        }
                    }
                    .padding(6)
                }
                .frame(maxHeight: 300)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 300)
            .task(id: query) {
                try? await Task.sleep(for: .milliseconds(query.isEmpty ? 0 : 150))
                guard !Task.isCancelled else { return }
                store.conversation.loadBranches(project: project, query: query)
            }
        }
    }

    private var branches: [Branch] {
        store.conversation.branchRequest.flatMap { store.workspace.branches[$0] } ?? []
    }

    private var defaultBase: String {
        store.workspace.gitStatus[project]?.branch ?? "current branch"
    }
}

private struct BranchRow: View {
    let branch: Branch
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: branch.remote ? "globe" : "arrow.triangle.branch")
                    .font(.system(size: 11.5, weight: .light))
                    .foregroundStyle(Theme.secondaryText)
                    .frame(width: 16)
                    .accessibilityHidden(true)
                Text(branch.name)
                    .font(.system(size: 13))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                if branch.current {
                    Text("current")
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                }
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.primary)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 30)
            .contentShape(Rectangle())
            .rowSurface(selected: selected, hovering: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
