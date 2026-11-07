import AppKit
import LocalStudioKit
import SwiftUI

struct CloneRepositorySheet: View {
    let store: StudioStore
    var startThread = true
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var parent = ""
    @State private var busy = false
    @State private var failure: String?

    var body: some View {
        Form {
            Section {
                TextField("Repository", text: $url, prompt: Text("https://github.com/owner/repo or owner/repo"))
                LabeledContent("Clone into") {
                    HStack(spacing: 8) {
                        Text((parent as NSString).abbreviatingWithTildeInPath)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .foregroundStyle(Theme.secondaryText)
                        Button("Choose…") { chooseParent() }
                    }
                }
            } header: {
                Text("Clone repository")
            } footer: {
                Text(failure ?? "The repository is cloned into a new folder inside the chosen one and added as a project.")
                    .foregroundStyle(failure == nil ? Theme.secondaryText : Theme.danger)
            }
        }
        .formStyle(.grouped)
        .safeAreaInset(edge: .bottom) {
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(busy ? "Cloning…" : "Clone") { clone() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(busy || url.trimmingCharacters(in: .whitespaces).isEmpty || parent.isEmpty)
            }
            .padding(16)
        }
        .frame(width: 480, height: 270)
        .onAppear {
            let base = store.pages.settings?.addProjectBaseDirectory ?? ""
            parent = base.isEmpty ? NSHomeDirectory() : (base as NSString).expandingTildeInPath
        }
    }

    private func chooseParent() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Choose"
        panel.directoryURL = URL(fileURLWithPath: parent, isDirectory: true)
        guard panel.runModal() == .OK, let chosen = panel.url else { return }
        parent = chosen.path
    }

    private func clone() {
        busy = true
        failure = nil
        store.inbox.cloneProject(url: url.trimmingCharacters(in: .whitespaces), parent: parent) { outcome in
            busy = false
            switch outcome {
            case .done(let path):
                store.post(.info, "Cloned into \((path as NSString).abbreviatingWithTildeInPath)")
                if startThread { store.newThread(in: path) } else { store.inbox.selectProject(path) }
                dismiss()
            case .failed(let message):
                failure = message
            }
        }
    }
}
