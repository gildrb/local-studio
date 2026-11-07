import AppKit
import LocalStudioKit
import SwiftUI

struct ProvidersSettings: View {
    let store: StudioStore
    @State private var expanded: Set<String>

    init(store: StudioStore, expanded: Set<String> = []) {
        self.store = store
        _expanded = State(initialValue: expanded)
    }

    private var pages: PagesStore { store.pages }

    var body: some View {
        SettingsForm {
            SettingsSection(.providerList, footer: "Configured providers have credentials the agent daemon can use. Star models to pin them to the top of the model picker; hide models you never use to keep them out of it.") {
                if pages.providers.isEmpty {
                    Text("No providers reported yet. The list fills in once the agent daemon returns its model catalog.")
                        .foregroundStyle(Theme.secondaryText)
                }
                ForEach(pages.providers, id: \.id) { provider in
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
                        text: "Sign-in is not available from the agent daemon. Run `eukhe` in Terminal and use `/login` to sign in with a subscription or paste an API key; keys exported in your shell environment (for example ANTHROPIC_API_KEY or OPENAI_API_KEY) are picked up automatically. Refresh Providers afterwards."
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

private struct ProviderRow: View {
    let provider: ProviderStatus
    let hidden: Int

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(provider.configured ? Color.green : Theme.input)
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 2) {
                Text(provider.name)
                Text(summary)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
            }
            Spacer()
            Text(provider.configured ? "Configured" : "Not configured")
                .font(.system(size: 11.5))
                .foregroundStyle(provider.configured ? .primary : Theme.secondaryText)
        }
    }

    private var summary: String {
        let models = provider.modelCount == 1 ? "1 model" : "\(provider.modelCount) models"
        return hidden > 0 ? "\(models) · \(hidden) hidden" : models
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
