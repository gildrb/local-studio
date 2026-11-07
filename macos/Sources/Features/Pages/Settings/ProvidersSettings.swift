import AppKit
import LocalStudioKit
import SwiftUI

extension StudioStore {
    func openProvidersSettings() {
        shell.settingsRequest = .providers
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
    }
}

struct ProvidersSettings: View {
    let store: StudioStore
    @State private var expanded: Set<String>
    @State private var sheet: EndpointSheetRequest?
    @State private var removing: ProviderStatus?

    init(store: StudioStore, expanded: Set<String> = [], sheet: EndpointSheetRequest? = nil) {
        self.store = store
        _expanded = State(initialValue: expanded)
        _sheet = State(initialValue: sheet)
    }

    private var pages: PagesStore { store.pages }

    var body: some View {
        SettingsForm {
            if !pages.providerErrors.isEmpty || pages.providerActionError != nil {
                Section {
                    ForEach(pages.providerErrors, id: \.self) { error in
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Theme.warning)
                    }
                    if let error = pages.providerActionError {
                        HStack(alignment: .firstTextBaseline) {
                            Label(error, systemImage: "xmark.octagon")
                                .foregroundStyle(Theme.danger)
                            Spacer()
                            Button("Dismiss") { pages.dismissProviderActionError() }
                        }
                    }
                }
            }
            SettingsSection(.providerKeys, footer: "Keys are saved in Eukhe's auth.json, readable only by you, and apply without restarting. A key exported in the agent's environment works too.") {
                SettingRow(.apiKeys) {
                    ForEach(builtIns, id: \.id) { provider in
                        ProviderKeyRow(provider: provider, pending: pages.isProviderPending(provider.id)) { key in
                            pages.setProviderKey(provider.id, key: key)
                        } remove: {
                            pages.setProviderKey(provider.id, key: nil)
                        }
                    }
                }
            }
            SettingsSection(.customEndpoints, footer: "Any OpenAI-compatible, OpenAI Responses or Anthropic Messages server. Its models are listed from the server's /models endpoint.") {
                SettingRow(.customEndpoints) {
                    if customs.isEmpty {
                        Text("No custom endpoints.")
                            .foregroundStyle(Theme.secondaryText)
                    }
                    ForEach(customs, id: \.id) { provider in
                        EndpointRow(provider: provider, pending: pages.isProviderPending(provider.id)) {
                            sheet = EndpointSheetRequest(provider: provider)
                        } refresh: {
                            pages.refreshProviderModels(provider.id)
                        } remove: {
                            removing = provider
                        }
                    }
                    HStack {
                        Spacer()
                        Button("Add Endpoint…") { sheet = EndpointSheetRequest(provider: nil) }
                    }
                }
            }
            SettingsSection(.localEngines, footer: "Engines the Local controller found running. Using one adds it as an endpoint routed through the controller.") {
                SettingRow(.localEngines) {
                    if pages.engines.isEmpty {
                        Text("No engines are running on the Local fleet.")
                            .foregroundStyle(Theme.secondaryText)
                    }
                    ForEach(pages.engines, id: \.id) { engine in
                        EngineRow(engine: engine, pending: pages.isProviderPending(engine.id)) {
                            pages.useLocalEngine(engine)
                        }
                    }
                }
            }
            SettingsSection(.providerList, footer: "Star models to pin them to the top of the model picker; hide models you never use to keep them out of it.") {
                SettingRow(.providers) {
                    if usable.isEmpty {
                        Text(pages.providersLoaded ? "No provider is configured yet." : "Loading providers…")
                            .foregroundStyle(Theme.secondaryText)
                    }
                    ForEach(usable, id: \.id) { provider in
                        DisclosureGroup(isExpanded: expansion(provider.id)) {
                            let models = store.conversation.models.filter { $0.provider == provider.id }
                            if models.isEmpty {
                                Text("No models in the catalog.")
                                    .foregroundStyle(Theme.secondaryText)
                            }
                            ForEach(models, id: \.self) { model in
                                ModelRow(
                                    model: model, favorite: isFavorite(model), hidden: isHidden(model)
                                ) { favorite in
                                    pages.setFavorite(provider: model.provider, model: model.id, favorite: favorite)
                                } hide: { hidden in
                                    pages.setHiddenModel(provider: model.provider, model: model.id, hidden: hidden)
                                }
                            }
                        } label: {
                            ProviderRow(provider: provider, hidden: hiddenCount(provider.id))
                        }
                    }
                    HStack {
                        Spacer()
                        Button("Refresh Providers") { pages.loadProviders() }
                    }
                }
            }
            SettingsSection(.hiddenModels, footer: "Hidden models are left out of the model picker.") {
                SettingRow(.hiddenModels) {
                    if store.conversation.hiddenModels.isEmpty {
                        Text("No hidden models.")
                            .foregroundStyle(Theme.secondaryText)
                    }
                    ForEach(store.conversation.hiddenModels, id: \.self) { key in
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(displayName(key))
                                Text("\(providerName(key.provider)) · \(key.model)")
                                    .font(.system(size: 11.5))
                                    .foregroundStyle(Theme.secondaryText)
                            }
                            Spacer()
                            Button("Unhide") {
                                pages.setHiddenModel(provider: key.provider, model: key.model, hidden: false)
                            }
                        }
                    }
                }
            }
            SettingsSection(.providerSignIn) {
                SettingRow(.signIn) {
                    SettingsNote(
                        symbol: "terminal",
                        text: "Subscriptions such as ChatGPT, Claude or GitHub Copilot sign in from Terminal: run `eukhe` and use `/login`, then Refresh Providers."
                    )
                    HStack {
                        Spacer()
                        Button("Open Terminal") {
                            if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") {
                                NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
                            }
                        }
                    }
                }
            }
        }
        .sheet(item: $sheet) { request in
            EndpointSheet(pages: pages, editing: request.provider, seed: request.seed)
        }
        .confirmationDialog(
            "Remove \(removing?.name ?? "the endpoint")?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            presenting: removing
        ) { provider in
            Button("Remove", role: .destructive) { pages.removeCustomProvider(provider.id) }
        } message: { _ in
            Text("Its models leave the model picker and its saved key is deleted.")
        }
    }

    private var builtIns: [ProviderStatus] {
        pages.providers.filter { $0.kind == .builtIn }
    }

    private var customs: [ProviderStatus] {
        pages.providers.filter { $0.kind == .custom }
    }

    private var usable: [ProviderStatus] {
        pages.providers.filter { $0.configured && $0.modelCount > 0 }
    }

    private func expansion(_ id: String) -> Binding<Bool> {
        Binding(
            get: { expanded.contains(id) },
            set: { open in
                if open { expanded.insert(id) } else { expanded.remove(id) }
            }
        )
    }

    private func isFavorite(_ model: ModelOption) -> Bool {
        store.conversation.favorites.contains { $0.provider == model.provider && $0.model == model.id }
    }

    private func isHidden(_ model: ModelOption) -> Bool {
        store.conversation.hiddenModels.contains { $0.provider == model.provider && $0.model == model.id }
    }

    private func hiddenCount(_ provider: String) -> Int {
        store.conversation.hiddenModels.filter { $0.provider == provider }.count
    }

    private func displayName(_ key: ModelKey) -> String {
        store.conversation.models.first { $0.provider == key.provider && $0.id == key.model }?.name ?? key.model
    }

    private func providerName(_ id: String) -> String {
        pages.providers.first { $0.id == id }?.name ?? id
    }
}

extension ProviderStatus {
    var credentialText: String {
        switch credential {
        case .storedKey: "Key saved"
        case .signedIn: "Signed in"
        case .environment: envVar.map { "From \($0)" } ?? "From the environment"
        case .modelsJson: "Key in models.json"
        case .notRequired: "No key needed"
        case .missing: envVar.map { "Not set · \($0) also works" } ?? "Not set"
        }
    }

    var modelsText: String {
        modelCount == 1 ? "1 model" : "\(modelCount) models"
    }
}

extension ProviderApi {
    var title: String {
        switch self {
        case .openAiCompatible: "OpenAI-compatible"
        case .openAiResponses: "OpenAI Responses"
        case .anthropic: "Anthropic Messages"
        }
    }
}

private struct StatusDot: View {
    let on: Bool

    var body: some View {
        Circle()
            .fill(on ? Theme.success : Theme.input)
            .frame(width: 7, height: 7)
            .accessibilityHidden(true)
    }
}

private struct ProviderKeyRow: View {
    let provider: ProviderStatus
    let pending: Bool
    let save: (String) -> Void
    let remove: () -> Void
    @State private var draft = ""

    var body: some View {
        LabeledContent {
            HStack(spacing: 8) {
                SecureField("\(provider.name) API key", text: $draft, prompt: Text(provider.credential == .storedKey ? "Replace key" : "Paste key"))
                    .labelsHidden()
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 190)
                    .onSubmit(commit)
                if !trimmed.isEmpty {
                    Button("Save", action: commit)
                        .disabled(pending)
                } else if provider.credential == .storedKey {
                    Button("Remove", role: .destructive, action: remove)
                        .disabled(pending)
                }
            }
        } label: {
            HStack(spacing: 8) {
                StatusDot(on: provider.configured)
                VStack(alignment: .leading, spacing: 2) {
                    Text(provider.name)
                    Text(provider.modelCount > 0 ? "\(provider.credentialText) · \(provider.modelsText)" : provider.credentialText)
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                }
            }
        }
    }

    private var trimmed: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func commit() {
        let key = trimmed
        guard !key.isEmpty, !pending else { return }
        save(key)
        draft = ""
    }
}

private struct EndpointRow: View {
    let provider: ProviderStatus
    let pending: Bool
    let edit: () -> Void
    let refresh: () -> Void
    let remove: () -> Void

    var body: some View {
        LabeledContent {
            HStack(spacing: 6) {
                Button(action: refresh) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12, weight: .light))
                        .foregroundStyle(Theme.chromeIcon)
                }
                .buttonStyle(.borderless)
                .help("Refresh models from the endpoint")
                .accessibilityLabel("Refresh \(provider.name) models")
                Button("Edit…", action: edit)
                Button(action: remove) {
                    Image(systemName: "trash")
                        .font(.system(size: 12, weight: .light))
                        .foregroundStyle(Theme.chromeIcon)
                }
                .buttonStyle(.borderless)
                .help("Remove the endpoint")
                .accessibilityLabel("Remove \(provider.name)")
            }
            .disabled(pending)
        } label: {
            HStack(spacing: 8) {
                StatusDot(on: provider.configured)
                VStack(alignment: .leading, spacing: 2) {
                    Text(provider.name)
                    Text(detail)
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }

    private var detail: String {
        [provider.baseUrl, provider.api?.title, provider.modelsText, provider.credentialText].compactMap(\.self).joined(separator: " · ")
    }
}

private struct EngineRow: View {
    let engine: LocalEngine
    let pending: Bool
    let use: () -> Void

    var body: some View {
        LabeledContent {
            if engine.added {
                Text("Added")
                    .foregroundStyle(Theme.secondaryText)
            } else {
                Button("Use", action: use)
                    .disabled(pending)
                    .accessibilityLabel("Use \(engine.models.first ?? "the engine") on port \(engine.port)")
            }
        } label: {
            HStack(spacing: 8) {
                StatusDot(on: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(engine.models.joined(separator: ", "))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text("\(engine.controller) · port \(String(engine.port))")
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                }
            }
        }
    }
}

private struct ProviderRow: View {
    let provider: ProviderStatus
    let hidden: Int

    var body: some View {
        HStack(spacing: 10) {
            StatusDot(on: provider.configured)
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.name)
                Text(summary)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
            }
            Spacer()
        }
    }

    private var summary: String {
        hidden > 0 ? "\(provider.modelsText) · \(hidden) hidden" : provider.modelsText
    }
}

private struct ModelRow: View {
    let model: ModelOption
    let favorite: Bool
    let hidden: Bool
    let toggle: (Bool) -> Void
    let hide: (Bool) -> Void

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(model.name)
                    .foregroundStyle(hidden ? Theme.secondaryText : .primary)
                Text(detail)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
            }
            Spacer()
            Button {
                hide(!hidden)
            } label: {
                Image(systemName: hidden ? "eye.slash" : "eye")
                    .font(.system(size: 12, weight: .light))
                    .foregroundStyle(Theme.chromeIcon)
            }
            .buttonStyle(.borderless)
            .help(hidden ? "Show in the model picker" : "Hide from the model picker")
            .accessibilityLabel(hidden ? "Show \(model.name) in the model picker" : "Hide \(model.name) from the model picker")
            Button {
                toggle(!favorite)
            } label: {
                Image(systemName: favorite ? "star.fill" : "star")
                    .font(.system(size: 12, weight: .light))
                    .foregroundStyle(favorite ? Color.yellow : Theme.chromeIcon)
            }
            .buttonStyle(.borderless)
            .help(favorite ? "Remove from favorites" : "Add to favorites")
            .accessibilityLabel(favorite ? "Remove \(model.name) from favorites" : "Add \(model.name) to favorites")
        }
        .padding(.leading, 28)
    }

    private var detail: String {
        var parts = [model.id]
        if model.contextWindow > 0 {
            parts.append("\(model.contextWindow / 1000)k context")
        }
        if model.reasoning { parts.append("reasoning") }
        if !model.configured { parts.append("unavailable") }
        return parts.joined(separator: " · ")
    }
}
