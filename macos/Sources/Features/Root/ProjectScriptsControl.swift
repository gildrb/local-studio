import LocalStudioKit
import SwiftUI

extension StudioStore {
    func runProjectScript(_ script: ProjectScript, in project: String) {
        UserDefaults.standard.set(script.id, forKey: ProjectScriptsControl.lastKey(project))
        panels.runProjectScript(project: project, script: script)
    }
}

struct ProjectScriptsControl: View {
    let store: StudioStore
    let project: String
    @AppStorage private var lastScript: String

    init(store: StudioStore, project: String) {
        self.store = store
        self.project = project
        _lastScript = AppStorage(wrappedValue: "", Self.lastKey(project))
    }

    static func lastKey(_ project: String) -> String {
        "lastProjectScript.\(project)"
    }

    var body: some View {
        let scripts = store.inbox.projectScripts[project] ?? []
        let preferred = scripts.first { $0.id == lastScript } ?? scripts.first
        Group {
            if let preferred {
                Menu {
                    ForEach(scripts, id: \.id) { script in
                        Button {
                            store.runProjectScript(script, in: project)
                        } label: {
                            Text(script.name)
                            if let shortcut = CoreShortcut.display(script.keybinding) {
                                Text(shortcut)
                            }
                        }
                    }
                    Divider()
                    Button("Add Action…") { store.openProjectSettings(project) }
                    Button("Import from local-studio.json") { importScripts() }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: symbol(preferred))
                            .icon(.inline)
                            .accessibilityHidden(true)
                        Text(preferred.name)
                            .lineLimit(1)
                    }
                } primaryAction: {
                    store.runProjectScript(preferred, in: project)
                }
                .help("Run \(preferred.name): \(preferred.command)")
                .accessibilityLabel("Run \(preferred.name)")
            } else {
                Menu {
                    Button("Add Action…") { store.openProjectSettings(project) }
                    Button("Import from local-studio.json") { importScripts() }
                } label: {
                    Image(systemName: "play.fill")
                        .icon(.control)
                        .accessibilityHidden(true)
                }
                .help("Project actions")
                .accessibilityLabel("Project actions")
            }
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .fixedSize()
        .task(id: project) {
            if store.inbox.projectScripts[project] == nil {
                store.inbox.loadProjectSettings(project)
            }
        }
    }

    private func symbol(_ script: ProjectScript) -> String {
        guard let icon = script.icon, NSImage(systemSymbolName: icon, accessibilityDescription: nil) != nil else { return "play.fill" }
        return icon
    }

    private func importScripts() {
        store.inbox.importProjectScripts(project) { outcome in
            GitRunner.report(store, outcome)
        }
    }
}
