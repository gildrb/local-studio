import LocalStudioKit
import SwiftUI

struct EndpointSeed {
    var name = ""
    var baseUrl = ""
    var api = ProviderApi.openAiCompatible
    var discovered: [ProviderModel]?
    var error: String?
}

struct EndpointSheetRequest: Identifiable {
    let id = UUID()
    let provider: ProviderStatus?
    var seed: EndpointSeed?
}

struct EndpointSheet: View {
    let pages: PagesStore
    let editing: ProviderStatus?
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var baseUrl: String
    @State private var api: ProviderApi
    @State private var key = ""
    @State private var clearKey = false
    @State private var preset = -1
    @State private var discovered: [ProviderModel]?
    @State private var testedBase: String?
    @State private var selected: Set<String>
    @State private var testing = false
    @State private var saving = false
    @State private var error: String?

    private let presets = endpointPresets()

    init(pages: PagesStore, editing: ProviderStatus?, seed: EndpointSeed? = nil) {
        self.pages = pages
        self.editing = editing
        let seed = seed ?? EndpointSeed(
            name: editing?.name ?? "",
            baseUrl: editing?.baseUrl ?? "",
            api: editing?.api ?? .openAiCompatible
        )
        _name = State(initialValue: seed.name)
        _baseUrl = State(initialValue: seed.baseUrl)
        _api = State(initialValue: seed.api)
        _discovered = State(initialValue: seed.discovered)
        _testedBase = State(initialValue: seed.discovered == nil ? nil : seed.baseUrl)
        _error = State(initialValue: seed.error)
        let existing = Set(editing?.models.map(\.id) ?? [])
        let found = Set(seed.discovered?.map(\.id) ?? [])
        _selected = State(initialValue: existing.isEmpty ? found : existing)
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(editing == nil ? "Add Endpoint" : "Edit \(editing?.name ?? "Endpoint")")
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 18)
            Form {
                Section {
                    if editing == nil {
                        Picker("Preset", selection: $preset) {
                            Text("Custom").tag(-1)
                            ForEach(presets.indices, id: \.self) { index in
                                Text(presets[index].name).tag(index)
                            }
                        }
                        .onChange(of: preset) { _, index in apply(preset: index) }
                    }
                    TextField("Name", text: $name, prompt: Text("My Endpoint"))
                    TextField("Base URL", text: $baseUrl, prompt: Text(verbatim: "https://api.example.com/v1"))
                        .onChange(of: baseUrl) { _, next in invalidate(unless: next) }
                    Picker("API", selection: $api) {
                        Text(ProviderApi.openAiCompatible.title).tag(ProviderApi.openAiCompatible)
                        Text(ProviderApi.openAiResponses.title).tag(ProviderApi.openAiResponses)
                        Text(ProviderApi.anthropic.title).tag(ProviderApi.anthropic)
                    }
                    .onChange(of: api) { _, _ in invalidate(unless: nil) }
                    SecureField("API key", text: $key, prompt: Text(keyPrompt))
                        .disabled(clearKey)
                    if editing?.credential == .storedKey {
                        Toggle("Remove the saved key", isOn: $clearKey)
                    }
                } footer: {
                    Text("The key is saved in Eukhe's auth.json, readable only by you. Leave it empty for local servers that need none.")
                        .font(.callout)
                        .foregroundStyle(Theme.secondaryText)
                }
                Section {
                    HStack {
                        Button(testing ? "Testing…" : "Test Connection", action: test)
                            .disabled(testing || trimmedBase.isEmpty)
                        Spacer()
                        if let discovered {
                            Text("\(selected.count) of \(discovered.count) enabled")
                                .foregroundStyle(Theme.secondaryText)
                        }
                    }
                    if let error {
                        IconLabel(error, symbol: "exclamationmark.triangle.fill")
                            .foregroundStyle(Theme.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let discovered {
                        ForEach(discovered, id: \.id) { model in
                            Toggle(isOn: binding(model.id)) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(model.name)
                                    if let detail = detail(model) {
                                        Text(detail)
                                            .font(.system(size: 11.5))
                                            .foregroundStyle(Theme.secondaryText)
                                    }
                                }
                            }
                            .toggleStyle(.checkbox)
                        }
                        HStack {
                            Button("Select All") { selected = Set(discovered.map(\.id)) }
                            Button("Select None") { selected = [] }
                        }
                    }
                } header: {
                    Text("Models")
                } footer: {
                    Text(modelsFooter)
                        .font(.callout)
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .contentMargins(.top, 4, for: .scrollContent)
            Rectangle().fill(Theme.hairline).frame(height: 1)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(editing == nil ? "Add" : "Save", action: save)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canSave)
            }
            .padding(16)
        }
        .frame(width: 500, height: 600)
        .background(Theme.canvas)
        .transaction { $0.disablesAnimations = true }
    }

    private var trimmedBase: String {
        baseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedKey: String {
        key.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var keyPrompt: String {
        if editing?.credential == .storedKey {
            return clearKey ? "The saved key will be removed" : "Saved · type to replace"
        }
        return "Optional"
    }

    private var modelsFooter: String {
        if discovered != nil {
            return "Only enabled models appear in the model picker."
        }
        if editing != nil {
            return "Test the connection to change which models are enabled; otherwise the current \(editing?.modelsText ?? "models") stay."
        }
        return "Test the connection to list the endpoint's models."
    }

    private var canSave: Bool {
        guard !saving, !trimmedName.isEmpty, !trimmedBase.isEmpty else { return false }
        if let discovered {
            return !discovered.isEmpty && !selected.isEmpty
        }
        return editing != nil
    }

    private func detail(_ model: ProviderModel) -> String? {
        var parts: [String] = []
        if model.name != model.id { parts.append(model.id) }
        if model.contextWindow > 0 { parts.append("\(model.contextWindow / 1000)k context") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func binding(_ id: String) -> Binding<Bool> {
        Binding(
            get: { selected.contains(id) },
            set: { on in
                if on { selected.insert(id) } else { selected.remove(id) }
            }
        )
    }

    private func apply(preset index: Int) {
        guard presets.indices.contains(index) else { return }
        let preset = presets[index]
        name = preset.name
        baseUrl = preset.baseUrl
        api = preset.api
    }

    private func invalidate(unless next: String?) {
        if let next, next == testedBase { return }
        discovered = nil
        testedBase = nil
        error = nil
    }

    private func test() {
        testing = true
        error = nil
        let storedKey = editing.flatMap { trimmedKey.isEmpty && !clearKey ? $0.id : nil }
        pages.discoverModels(baseUrl: trimmedBase, api: api, key: trimmedKey.isEmpty ? nil : trimmedKey, provider: storedKey) { outcome in
            testing = false
            switch outcome {
            case .models(let base, let models):
                let existing = Set(editing?.models.map(\.id) ?? []).intersection(models.map(\.id))
                selected = existing.isEmpty ? Set(models.map(\.id)) : existing
                testedBase = base
                baseUrl = base
                discovered = models
                if trimmedName.isEmpty {
                    name = URL(string: base)?.host() ?? base
                }
            case .failed(let message):
                discovered = nil
                testedBase = nil
                error = message
            }
        }
    }

    private func save() {
        let models = discovered.map { found in found.filter { selected.contains($0.id) } }
        let change: ProviderKey = clearKey ? .clear : trimmedKey.isEmpty ? .keep : .set(key: trimmedKey)
        let provider = CustomProvider(name: trimmedName, baseUrl: testedBase ?? trimmedBase, api: api, key: change, models: models)
        saving = true
        error = nil
        let finished: (RequestOutcome) -> Void = { outcome in
            saving = false
            switch outcome {
            case .done: dismiss()
            case .failed(let message): error = message
            }
        }
        if let editing {
            pages.updateCustomProvider(editing.id, provider, finished: finished)
        } else {
            pages.addCustomProvider(provider, finished: finished)
        }
    }
}
