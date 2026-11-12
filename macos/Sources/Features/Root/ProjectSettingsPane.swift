import AppKit
import LocalStudioKit
import SwiftUI

extension StudioStore {
    func openProjectSettings(_ project: String?) {
        shell.settingsProject = project ?? inbox.currentProject
        openSettings(.project)
    }

    func openSettings(_ pane: SettingsPane) {
        shell.settingsRequest = pane
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
    }
}

struct ProjectSettingsPane: View {
    let store: StudioStore
    @State private var confirmRemove = false
    @State private var iconPicker = false

    var body: some View {
        SettingsForm {
            if store.inbox.projects.isEmpty {
                Section {
                    Text("No projects yet. Add a folder from the sidebar to configure it here.")
                        .foregroundStyle(Theme.secondaryText)
                    Button("Add Project…") { store.addProjectInteractively() }
                }
            } else if let project {
                Section {
                    Picker("Project", selection: projectBinding) {
                        ForEach(store.inbox.projects, id: \.id) { item in
                            Text(item.name).tag(item.id)
                        }
                    }
                }
                Section {
                    CommitTextField(title: "Name", value: project.name) { store.inbox.renameProject(project.id, to: $0) }
                    LabeledContent("Icon") {
                        HStack(spacing: 8) {
                            ProjectTile(project: project, size: 22)
                            Button("Choose…") { iconPicker = true }
                                .popover(isPresented: $iconPicker, arrowEdge: .bottom) {
                                    ProjectIconPicker(current: project.icon) { icon in
                                        store.inbox.setProjectIcon(project.id, icon)
                                        iconPicker = false
                                    }
                                }
                            if project.icon != nil {
                                Button("Use Initials") { store.inbox.setProjectIcon(project.id, nil) }
                            }
                        }
                    }
                } header: {
                    Text("Identity")
                }
                Section {
                    LabeledContent("Location") {
                        Text((project.path as NSString).abbreviatingWithTildeInPath)
                            .textSelection(.enabled)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    LabeledContent("Repository") {
                        Text(repositoryText(project))
                    }
                    HStack {
                        Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.path)]) }
                        Button("New Thread in Project") { store.newThread(in: project.id) }
                    }
                } header: {
                    Text("Checkout")
                }
                ProjectDefaultsSection(store: store, project: project.id)
                ProjectScriptsSection(store: store, project: project.id)
                Section {
                    Button("Remove Project…", role: .destructive) { confirmRemove = true }
                } footer: {
                    Text("Removing a project keeps its folder and its threads; they move to \"No project\".")
                        .foregroundStyle(Theme.secondaryText)
                }
                .alert("Remove \(project.name)?", isPresented: $confirmRemove) {
                    Button("Remove", role: .destructive) { store.inbox.removeProject(project.id) }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("The folder on disk is not touched.")
                }
            }
        }
        .task(id: project?.id) {
            guard let project else { return }
            store.inbox.loadProjectSettings(project.id)
            if project.isGit, store.workspace.gitStatus[project.id] == nil {
                store.core.run { $0.gitStatus(project: project.id) }
            }
        }
    }

    private var project: Project? {
        store.inbox.project(store.shell.settingsProject) ?? store.inbox.project(store.focusedProject) ?? store.inbox.projects.first
    }

    private var projectBinding: Binding<String> {
        Binding { project?.id ?? "" } set: { store.shell.settingsProject = $0 }
    }

    private func repositoryText(_ project: Project) -> String {
        guard project.isGit else { return "Not a git repository" }
        guard let status = store.workspace.gitStatus[project.id] else { return "Git repository" }
        let branch = status.branch ?? "detached HEAD"
        return status.hasRemote ? "\(branch) · \(status.upstream ?? "no upstream")" : "\(branch) · no remote"
    }
}

struct ProjectIconPicker: View {
    let current: String?
    let choose: (String?) -> Void
    @State private var emoji = ""

    private static let symbols = [
        "folder", "shippingbox", "hammer", "wrench", "terminal", "globe", "server.rack", "cpu",
        "doc", "book", "graduationcap", "flask", "leaf", "flame", "bolt", "star",
        "heart", "camera", "music.note", "gamecontroller", "paintbrush", "chart.bar", "cart", "lock",
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(30), spacing: 6), count: 8), spacing: 6) {
                ForEach(Self.symbols, id: \.self) { symbol in
                    Button {
                        choose(symbol)
                    } label: {
                        Image(systemName: symbol)
                            .icon(.control)
                            .frame(width: 30, height: 30)
                            .background(current == symbol ? Theme.selection : .clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(symbol)
                    .accessibilityLabel(symbol.replacingOccurrences(of: ".", with: " "))
                }
            }
            HStack(spacing: 8) {
                TextField("Emoji", text: $emoji)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 90)
                    .onSubmit { useEmoji() }
                Button("Use Emoji") { useEmoji() }
                    .disabled(emoji.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(14)
    }

    private func useEmoji() {
        let value = emoji.trimmingCharacters(in: .whitespaces)
        guard let first = value.first else { return }
        choose(String(first))
    }
}
