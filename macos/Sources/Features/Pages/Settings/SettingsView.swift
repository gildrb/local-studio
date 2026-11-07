import AppKit
import LocalStudioKit
import SwiftUI

struct SettingsView: View {
    let store: StudioStore
    @State private var selection: SettingsPane? = .general
    @State private var query = ""
    @State private var backStack: [SettingsPane] = []
    @State private var forwardStack: [SettingsPane] = []
    @State private var travelling = false

    init(store: StudioStore, pane: SettingsPane = .general, query: String = "") {
        self.store = store
        _selection = State(initialValue: pane)
        _query = State(initialValue: query)
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(visiblePanes) { pane in
                    Label {
                        Text(pane.title)
                    } icon: {
                        SettingsPaneIcon(pane: pane)
                    }
                    .tag(pane)
                }
            }
            .listStyle(.sidebar)
            .searchable(text: $query, placement: .sidebar, prompt: "Search Settings")
            .navigationSplitViewColumnWidth(min: 220, ideal: 230, max: 280)
            .toolbar(removing: .sidebarToggle)
        } detail: {
            detail
                .environment(\.settingsQuery, detailQuery)
                .scrollEdgeEffectStyle(.hard, for: .top)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.canvas)
                .navigationTitle(selection?.title ?? "Settings")
                .toolbar(removing: .title)
                .toolbar {
                    ToolbarItem(placement: .navigation) {
                        ControlGroup {
                            Button("Back", systemImage: "chevron.left", action: goBack)
                                .disabled(backStack.isEmpty)
                            Button("Forward", systemImage: "chevron.right", action: goForward)
                                .disabled(forwardStack.isEmpty)
                        }
                        .controlGroupStyle(.navigation)
                    }
                    ToolbarItem(placement: .navigation) {
                        Text(selection?.title ?? "Settings")
                            .font(.system(size: 15, weight: .semibold))
                            .fixedSize()
                            .padding(.horizontal, 6)
                    }
                    .sharedBackgroundVisibility(.hidden)
                }
        }
        .navigationSplitViewStyle(.balanced)
        .themeRoot()
        .background(SettingsWindowStyle())
        .frame(minWidth: 720, minHeight: 480)
        .transaction { $0.disablesAnimations = true }
        .onChange(of: selection) { previous, _ in
            guard !travelling else {
                travelling = false
                return
            }
            if let previous {
                backStack.append(previous)
                forwardStack.removeAll()
            }
        }
        .onChange(of: query) { _, _ in
            if let selection, visiblePanes.contains(selection) { return }
            selection = visiblePanes.first
        }
        .onAppear {
            store.pages.loadProviders()
            consumeSettingsRequest()
        }
        .onChange(of: store.shell.settingsRequest) { consumeSettingsRequest() }
    }

    private func consumeSettingsRequest() {
        guard let request = store.shell.settingsRequest else { return }
        store.shell.settingsRequest = nil
        selection = request
    }

    @ViewBuilder private var detail: some View {
        switch selection ?? .general {
        case .project: ProjectSettingsPane(store: store)
        case .general: GeneralSettings(store: store)
        case .appearance: AppearanceSettings(pages: store.pages)
        case .keybindings: KeybindingsSettings(pages: store.pages)
        case .snapshots: SnapShotSettings(pages: store.pages) { navigate(to: $0) }
        case .providers: ProvidersSettings(store: store)
        case .sourceControl: SourceControlSettings(store: store)
        case .storage: StorageSettings(pages: store.pages)
        case .local: LocalSettings(store: store)
        case .connections: ConnectionsSettings(store: store, open: { navigate(to: $0) })
        case .archive: ArchivePage(store: store, embedded: true)
        }
    }

    private var visiblePanes: [SettingsPane] {
        SettingsPane.allCases.filter(matches)
    }

    private var detailQuery: String {
        guard let selection, !selection.title.localizedCaseInsensitiveContains(query) else { return "" }
        return query
    }

    private func matches(_ pane: SettingsPane) -> Bool {
        if query.isEmpty || pane.title.localizedCaseInsensitiveContains(query) { return true }
        if SettingKey.allCases.contains(where: { $0.group.pane == pane && $0.matches(query) }) { return true }
        guard pane == .keybindings else { return false }
        return store.pages.keybindings.contains { KeybindingsSettings.matches($0, query) }
    }

    private func navigate(to pane: SettingsPane) {
        selection = pane
    }

    private func goBack() {
        guard let target = backStack.popLast() else { return }
        if let selection { forwardStack.append(selection) }
        travelling = true
        selection = target
    }

    private func goForward() {
        guard let target = forwardStack.popLast() else { return }
        if let selection { backStack.append(selection) }
        travelling = true
        selection = target
    }
}

struct SettingsForm<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        Form {
            content
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Theme.canvas)
    }
}

struct ModelChoicePicker: View {
    let title: String
    let models: [ModelOption]
    let provider: String?
    let model: String?
    var automatic = "Automatic"
    let choose: (ModelKey?) -> Void

    var body: some View {
        Picker(title, selection: Binding(get: { current }, set: { choose($0) })) {
            Text(automatic).tag(ModelKey?.none)
            ForEach(groups, id: \.provider) { group in
                Section(group.provider) {
                    ForEach(group.models, id: \.self) { option in
                        Text(option.name).tag(Optional(ModelKey(provider: option.provider, model: option.id)))
                    }
                }
            }
            if let current, !models.contains(where: { $0.provider == current.provider && $0.id == current.model }) {
                Text("\(current.model) (\(current.provider))").tag(Optional(current))
            }
        }
        .pickerStyle(.menu)
    }

    private var current: ModelKey? {
        guard let provider, let model else { return nil }
        return ModelKey(provider: provider, model: model)
    }

    private var groups: [(provider: String, models: [ModelOption])] {
        let configured = models.filter(\.configured)
        var order: [String] = []
        var grouped: [String: [ModelOption]] = [:]
        for option in configured {
            if grouped[option.provider] == nil { order.append(option.provider) }
            grouped[option.provider, default: []].append(option)
        }
        return order.map { ($0, grouped[$0] ?? []) }
    }
}

private struct SettingsWindowStyle: NSViewRepresentable {
    func makeNSView(context: Context) -> StyledWindowView {
        StyledWindowView()
    }

    func updateNSView(_ view: StyledWindowView, context: Context) {}

    final class StyledWindowView: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window else { return }
            window.toolbarStyle = .unified
            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            window.styleMask.insert(.fullSizeContentView)
        }
    }
}
