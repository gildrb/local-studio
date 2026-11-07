import LocalStudioKit
import SwiftUI

struct ProjectDefaultsSection: View {
    let store: StudioStore
    let project: String

    var body: some View {
        let overrides = store.inbox.projectSettings[project]
        let settings = overrides?.settings ?? ProjectSettings(defaultProvider: nil, defaultModel: nil, defaultThinkingLevel: nil, defaultAccess: nil, newThreadWorkspace: nil, newWorktreesStartFromOrigin: nil)
        let effective = overrides?.effective ?? store.pages.settings
        Section {
            Picker("Default model", selection: modelBinding(settings)) {
                Text(inherit(effectiveModel(effective))).tag(ModelKey?.none)
                Divider()
                ForEach(models, id: \.self) { key in
                    Text(modelName(key)).tag(ModelKey?.some(key))
                }
            }
            Picker("Thinking level", selection: binding(settings, \.defaultThinkingLevel)) {
                Text(inherit(effective?.defaultThinkingLevel ?? "model default")).tag(String?.none)
                Divider()
                ForEach(thinkingLevels, id: \.self) { level in
                    Text(level.capitalized).tag(String?.some(level))
                }
            }
            Picker("Permissions", selection: binding(settings, \.defaultAccess)) {
                Text(inherit(effective.map { Self.accessTitle($0.defaultAccess) } ?? "Supervised")).tag(AccessMode?.none)
                Divider()
                ForEach([AccessMode.supervised, .autoAcceptEdits, .auto, .fullAccess], id: \.self) { mode in
                    Text(Self.accessTitle(mode)).tag(AccessMode?.some(mode))
                }
            }
            Picker("New threads", selection: binding(settings, \.newThreadWorkspace)) {
                Text(inherit(effective.map { Self.workspaceTitle($0.newThreadWorkspace) } ?? "Local checkout")).tag(NewThreadWorkspace?.none)
                Divider()
                Text(Self.workspaceTitle(.local)).tag(NewThreadWorkspace?.some(.local))
                Text(Self.workspaceTitle(.worktree)).tag(NewThreadWorkspace?.some(.worktree))
            }
            Picker("New worktrees start from origin", selection: binding(settings, \.newWorktreesStartFromOrigin)) {
                Text(inherit(effective.map { $0.newWorktreesStartFromOrigin ? "On" : "Off" } ?? "On")).tag(Bool?.none)
                Divider()
                Text("On").tag(Bool?.some(true))
                Text("Off").tag(Bool?.some(false))
            }
        } header: {
            Text("Defaults for this project")
        } footer: {
            Text("Choose Inherit to follow Settings → General.")
                .foregroundStyle(Theme.secondaryText)
        }
        .disabled(overrides == nil)
        .task(id: project) {
            if store.conversation.models.isEmpty { store.conversation.loadModels() }
        }
    }

    private var models: [ModelKey] {
        store.conversation.models.filter(\.configured).map { ModelKey(provider: $0.provider, model: $0.id) }
    }

    private var thinkingLevels: [String] {
        var seen: [String] = []
        for model in store.conversation.models where model.configured {
            for level in model.thinkingLevels where !seen.contains(level) { seen.append(level) }
        }
        return seen
    }

    private func modelName(_ key: ModelKey) -> String {
        let name = store.conversation.models.first { $0.provider == key.provider && $0.id == key.model }?.name ?? key.model
        return "\(name) · \(key.provider)"
    }

    private func effectiveModel(_ settings: LocalStudioKit.Settings?) -> String {
        guard let settings, let provider = settings.defaultProvider, let model = settings.defaultModel else { return "first available model" }
        return modelName(ModelKey(provider: provider, model: model))
    }

    private func inherit(_ value: String) -> String {
        "Inherit (\(value))"
    }

    private func modelBinding(_ settings: ProjectSettings) -> Binding<ModelKey?> {
        Binding {
            guard let provider = settings.defaultProvider, let model = settings.defaultModel else { return nil }
            return ModelKey(provider: provider, model: model)
        } set: { key in
            var next = settings
            next.defaultProvider = key?.provider
            next.defaultModel = key?.model
            store.inbox.updateProjectSettings(project, next)
        }
    }

    private func binding<Value>(_ settings: ProjectSettings, _ path: WritableKeyPath<ProjectSettings, Value>) -> Binding<Value> {
        Binding { settings[keyPath: path] } set: { value in
            var next = settings
            next[keyPath: path] = value
            store.inbox.updateProjectSettings(project, next)
        }
    }

    static func accessTitle(_ mode: AccessMode) -> String {
        switch mode {
        case .supervised: "Supervised"
        case .autoAcceptEdits: "Auto-accept edits"
        case .auto: "Auto"
        case .fullAccess: "Full access"
        }
    }

    static func workspaceTitle(_ workspace: NewThreadWorkspace) -> String {
        switch workspace {
        case .local: "Local checkout"
        case .worktree: "New worktree"
        }
    }
}

struct ProjectScriptsSection: View {
    let store: StudioStore
    let project: String
    @State private var editing: ScriptDraft?
    @State private var importing = false

    var body: some View {
        let scripts = store.inbox.projectScripts[project] ?? []
        Section {
            if scripts.isEmpty {
                Text("No actions yet. Actions are shell commands you run from the thread header, like a dev server or tests.")
                    .foregroundStyle(Theme.secondaryText)
            }
            ForEach(Array(scripts.enumerated()), id: \.element.id) { offset, script in
                ScriptRow(script: script) {
                    editing = ScriptDraft(script)
                }
                .contextMenu {
                    Button("Edit…") { editing = ScriptDraft(script) }
                    Button("Move Up") { move(scripts, from: offset, by: -1) }
                        .disabled(offset == 0)
                    Button("Move Down") { move(scripts, from: offset, by: 1) }
                        .disabled(offset == scripts.count - 1)
                    Divider()
                    Button("Delete", role: .destructive) { save(scripts.filter { $0.id != script.id }) }
                }
            }
            HStack {
                Button("Add Action…") { editing = ScriptDraft(nil) }
                Button(importing ? "Importing…" : "Import from t3.json") { importScripts() }
                    .disabled(importing)
            }
        } header: {
            Text("Actions")
        } footer: {
            Text("Right-click an action to reorder or delete it. Imports read t3.json or local-studio.json in the project root.")
                .foregroundStyle(Theme.secondaryText)
        }
        .sheet(item: $editing) { draft in
            ScriptEditorSheet(draft: draft) { script in
                var next = scripts
                if let index = next.firstIndex(where: { $0.id == script.id }) {
                    next[index] = script
                } else {
                    next.append(script)
                }
                save(next)
            }
        }
    }

    private func move(_ scripts: [ProjectScript], from offset: Int, by delta: Int) {
        var next = scripts
        let target = offset + delta
        guard next.indices.contains(target) else { return }
        next.swapAt(offset, target)
        save(next)
    }

    private func save(_ scripts: [ProjectScript]) {
        store.inbox.saveProjectScripts(project, scripts)
    }

    private func importScripts() {
        importing = true
        store.inbox.importProjectScripts(project) { outcome in
            importing = false
            GitRunner.report(store, outcome)
        }
    }
}

private struct ScriptRow: View {
    let script: ProjectScript
    let edit: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: script.icon.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil) == nil ? nil : $0 } ?? "play")
                .font(.system(size: 13, weight: .light))
                .frame(width: 18)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(script.name)
                Text(script.command)
                    .font(.system(size: 11.5, design: .monospaced))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 8)
            if let shortcut = CoreShortcut.display(script.keybinding) {
                ShortcutHint(text: shortcut)
            }
            if script.runOnWorktreeSetup {
                Text("Setup")
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 5)
                    .frame(height: 16)
                    .background(Theme.input, in: Capsule())
            }
            Button("Edit…", action: edit)
        }
        .accessibilityElement(children: .combine)
    }
}

struct ScriptDraft: Identifiable {
    let id: String
    var name: String
    var command: String
    var icon: String?
    var keybinding: String
    var runOnWorktreeSetup: Bool
    var waitForSetup: Bool
    let isNew: Bool

    init(_ script: ProjectScript?) {
        id = script?.id ?? UUID().uuidString.lowercased()
        name = script?.name ?? ""
        command = script?.command ?? ""
        icon = script?.icon
        keybinding = script?.keybinding ?? ""
        runOnWorktreeSetup = script?.runOnWorktreeSetup ?? false
        waitForSetup = script?.waitForSetup ?? false
        isNew = script == nil
    }

    var script: ProjectScript {
        let binding = keybinding.trimmingCharacters(in: .whitespaces).lowercased()
        return ProjectScript(
            id: id, name: name.trimmingCharacters(in: .whitespaces), command: command, icon: icon,
            keybinding: binding.isEmpty ? nil : binding, runOnWorktreeSetup: runOnWorktreeSetup, waitForSetup: waitForSetup
        )
    }
}

struct ScriptEditorSheet: View {
    @State var draft: ScriptDraft
    let save: (ProjectScript) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var iconPicker = false

    var body: some View {
        Form {
            Section {
                TextField("Name", text: $draft.name, prompt: Text("Dev server"))
                TextField("Command", text: $draft.command, prompt: Text("bun run dev"), axis: .vertical)
                    .lineLimit(2...6)
                    .font(.system(size: 12.5, design: .monospaced))
                LabeledContent("Icon") {
                    HStack(spacing: 8) {
                        Image(systemName: draft.icon ?? "play")
                            .font(.system(size: 14, weight: .light))
                            .accessibilityHidden(true)
                        Button("Choose…") { iconPicker = true }
                            .popover(isPresented: $iconPicker, arrowEdge: .bottom) {
                                ProjectIconPicker(current: draft.icon) { icon in
                                    draft.icon = icon
                                    iconPicker = false
                                }
                            }
                    }
                }
                TextField("Keyboard shortcut", text: $draft.keybinding, prompt: Text("cmd+shift+r"))
                if !draft.keybinding.isEmpty, CoreShortcut.display(draft.keybinding) == nil {
                    Text("Use modifiers cmd, ctrl, option, shift joined with +, then a key.")
                        .font(.callout)
                        .foregroundStyle(Theme.danger)
                }
                Toggle("Run when a worktree is set up", isOn: $draft.runOnWorktreeSetup)
                Toggle("Wait for setup to finish before the agent starts", isOn: $draft.waitForSetup)
                    .disabled(!draft.runOnWorktreeSetup)
            } header: {
                Text(draft.isNew ? "Add action" : "Edit action")
            }
        }
        .formStyle(.grouped)
        .safeAreaInset(edge: .bottom) {
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(draft.isNew ? "Add" : "Save") {
                    save(draft.script)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(draft.name.trimmingCharacters(in: .whitespaces).isEmpty || draft.command.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(16)
        }
        .frame(width: 480, height: 420)
    }
}
