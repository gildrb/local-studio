import AppKit
import LocalStudioKit
import SwiftUI
import Observation

@MainActor
final class CommandRefresh: ObservableObject {
    private let store: StudioStore

    init(store: StudioStore) {
        self.store = store
        track()
    }

    private func track() {
        withObservationTracking {
            read()
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.objectWillChange.send()
                self?.track()
            }
        }
    }

    private func read() {
        _ = store.pages.keybindings
        _ = store.pages.settings?.colorScheme
        _ = store.shell.sidebarVisible
        _ = store.shell.route
        _ = store.shell.canGoBack
        _ = store.shell.canGoForward
        _ = store.panels.terminalOpen
        _ = store.panels.rightPanelOpen
        _ = store.conversation.thread
        _ = store.conversation.info?.project
        _ = store.inbox.threads
        _ = store.inbox.visibleOrder
        _ = store.inbox.projects
        _ = store.inbox.undo
        _ = store.connection
        _ = store.commands.revision
        _ = store.conversation.queued
        _ = store.pages.settings?.timeFormat
        _ = store.workspace.gitStatus
    }
}

struct StudioCommands: Commands {
    let store: StudioStore
    @ObservedObject var refresh: CommandRefresh

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            CommandButton(store: store, title: "New Thread", command: "chat.new")
            CommandButton(store: store, title: "New Thread in Current Project", command: "chat.newLocal")
            CommandButton(store: store, title: "New Thread Without a Project", command: "chat.newWithoutProject")
            Button("New Thread in Project…") { store.shell.palette = .newThread }
                .disabled(store.inbox.projects.isEmpty)
            Divider()
            Button("Add Project…") { store.addProjectInteractively() }
            Button("Clone Repository…") { store.shell.cloneShown = true }
            CommandButton(store: store, title: "Open in Editor", command: "editor.openFavorite")
            CommandButton(store: store, title: "Close Panel Tab", command: "rightPanel.close")
            Menu("Terminal") {
                CommandButton(store: store, title: "New Terminal", command: "terminal.new")
                CommandButton(store: store, title: "Split Horizontally", command: "terminal.split")
                CommandButton(store: store, title: "Split Vertically", command: "terminal.splitVertical")
                CommandButton(store: store, title: "Close Terminal", command: "terminal.close")
            }
        }
        CommandGroup(replacing: .undoRedo) {
            Button(undoTitle) { store.dispatch("thread.undo") }
                .keyboardShortcut(store.menuShortcut("thread.undo") ?? KeyboardShortcut("z"))
            Button("Redo") { NSApp.sendAction(Selector(("redo:")), to: nil, from: nil) }
                .keyboardShortcut("z", modifiers: [.command, .shift])
        }
        CommandGroup(after: .pasteboard) {
            Button("Paste as Text") { NSApp.sendAction(#selector(NSTextView.pasteAsPlainText(_:)), to: nil, from: nil) }
                .keyboardShortcut("v", modifiers: [.command, .shift])
        }
        CommandGroup(replacing: .sidebar) {
            CommandButton(store: store, title: store.shell.sidebarVisible ? "Hide Sidebar" : "Show Sidebar", command: "sidebar.toggle")
            CommandButton(store: store, title: store.panels.terminalOpen ? "Hide Terminal" : "Show Terminal", command: "terminal.toggle")
            CommandButton(store: store, title: store.panels.rightPanelOpen ? "Hide Right Panel" : "Show Right Panel", command: "rightPanel.toggle")
            CommandButton(store: store, title: "Toggle Diff", command: "diff.toggle")
            CommandButton(store: store, title: "Toggle Browser Preview", command: "preview.toggle")
            Divider()
            CommandButton(store: store, title: "Command Palette", command: "commandPalette.toggle")
            CommandButton(store: store, title: "Go to File…", command: "filePicker.toggle")
            CommandButton(store: store, title: "Search Project…", command: "projectSearch.toggle")
            Divider()
            Menu("Browser") {
                CommandButton(store: store, title: "Reload Page", command: "preview.refresh")
                CommandButton(store: store, title: "Focus Address Bar", command: "preview.focusUrl")
                Divider()
                CommandButton(store: store, title: "Zoom In", command: "preview.zoomIn")
                CommandButton(store: store, title: "Zoom Out", command: "preview.zoomOut")
                CommandButton(store: store, title: "Actual Size", command: "preview.resetZoom")
            }
            Menu("Appearance") {
                Picker("Appearance", selection: colorScheme) {
                    Text("System").tag(LocalStudioKit.ColorScheme.system)
                    Text("Light").tag(LocalStudioKit.ColorScheme.light)
                    Text("Dark").tag(LocalStudioKit.ColorScheme.dark)
                }
                .pickerStyle(.inline)
                .labelsHidden()
                Divider()
                CommandButton(store: store, title: "Cycle Appearance", command: "appearance.cycle")
                CommandButton(store: store, title: "Choose Appearance…", command: "theme.select")
                CommandButton(store: store, title: "Theme Editor", command: "themeEditor.toggle")
            }
            .disabled(store.pages.settings == nil)
            Divider()
            CommandButton(store: store, title: "Usage", command: "usage.open")
            Menu("Usage View") {
                CommandButton(store: store, title: "Cost", command: "usage.cost")
                CommandButton(store: store, title: "Tokens", command: "usage.tokens")
                CommandButton(store: store, title: "Limits", command: "usage.limits")
                Divider()
                CommandButton(store: store, title: "Last Day", command: "usage.period.day")
                CommandButton(store: store, title: "Last Week", command: "usage.period.week")
                CommandButton(store: store, title: "Last Month", command: "usage.period.month")
                CommandButton(store: store, title: "Last Quarter", command: "usage.period.quarter")
            }
            Button("Local") { store.show(.local) }
            Button("Pull Requests") { store.show(.pullRequests) }
            Button("Archived Threads") { store.show(.archive) }
            Divider()
            CommandButton(store: store, title: "Back", command: "navigation.back")
            CommandButton(store: store, title: "Forward", command: "navigation.forward")
            Divider()
        }
        CommandMenu("Thread") {
            threadMenu
        }
        CommandMenu("Composer") {
            CommandButton(store: store, title: "Send Queued Message Now", command: "thread.steerQueuedMessage")
            CommandButton(store: store, title: "Stash Prompt", command: "composer.stash")
            Divider()
            CommandButton(store: store, title: "Choose Model…", command: "modelPicker.toggle")
            CommandButton(store: store, title: "Previous Provider", command: "modelPicker.previousProvider")
            CommandButton(store: store, title: "Next Provider", command: "modelPicker.nextProvider")
            Menu("Choose Model") {
                ForEach(1...9, id: \.self) { number in
                    CommandButton(store: store, title: "Model \(number)", command: "modelPicker.jump.\(number)")
                }
            }
            Divider()
            CommandButton(store: store, title: "Effort", command: "composer.effort")
            CommandButton(store: store, title: "Access Mode", command: "composer.mode")
            CommandButton(store: store, title: "Workspace", command: "composer.workspace")
            CommandButton(store: store, title: "Branch", command: "composer.branch")
            CommandButton(store: store, title: "Previous Worktree", command: "composer.previousWorktree")
            CommandButton(store: store, title: "Host", command: "composer.host")
        }
        CommandGroup(replacing: .help) {
            Button("Supported Hardware and Models") {
                if let url = URL(string: "https://local-ai-registry.vercel.app/?topic=hardware") {
                    NSWorkspace.shared.open(url)
                }
            }
        }
    }

    @ViewBuilder private var threadMenu: some View {
        let row = store.focusedRow
        let id = row?.id
        CommandButton(store: store, title: row?.pinned == true ? "Unpin" : "Pin", command: "thread.pin")
        CommandButton(store: store, title: row?.shelf == .settled ? "Un-settle" : "Settle", command: "thread.settle")
        if row?.shelf == .snoozed {
            Button("Wake") { if let id { store.inbox.snooze([id], until: nil) } }
        } else {
            Menu("Snooze") {
                ForEach(SnoozePreset.resolve(timeFormat: store.pages.settings?.timeFormat)) { choice in
                    Button(choice.label) {
                        guard let id, let preset = SnoozePreset.resolve().first(where: { $0.id == choice.id }) else { return }
                        store.inbox.snooze([id], until: preset.millis)
                    }
                }
                Divider()
                Button("Custom…") { if let id { store.shell.snoozeTargets = [id] } }
            }
            .disabled(row == nil)
        }
        Button("Rename…") { store.shell.headerRenaming = true }
            .disabled(row == nil)
        Button("Regenerate Title") { if let id { store.inbox.regenerateTitles([id]) } }
            .disabled(row == nil)
        Button("Restart Agent Session") { if let id { store.inbox.restart(id) } }
            .disabled(row == nil)
        Button(row?.unread == true ? "Mark as Read" : "Mark as Unread") { if let row { store.inbox.markUnread([row.id], !row.unread) } }
            .disabled(row == nil)
        Button("Archive") { if let id { store.archive([id]) } }
            .disabled(row == nil || row?.status == .working)
        Button("Delete…") { if let id { store.requestDelete([id]) } }
            .disabled(row == nil)
        Divider()
        CommandButton(store: store, title: "Previous Thread", command: "thread.previous")
        CommandButton(store: store, title: "Next Thread", command: "thread.next")
        Menu("Go to Thread") {
            ForEach(1...9, id: \.self) { number in
                CommandButton(store: store, title: jumpTitle(number), command: "thread.jump.\(number)")
            }
        }
        Divider()
        CommandButton(store: store, title: "Copy Reference", command: "thread.copyReference")
        CommandButton(store: store, title: "Copy Pull Request Number", command: "pullRequest.copyNumber")
        Divider()
        Button("Project Settings…") { store.openProjectSettings(store.focusedProject) }
            .disabled(store.focusedProject == nil)
    }

    private var undoTitle: String {
        store.inbox.undo.map { "Undo \($0.label)" } ?? "Undo"
    }

    private var colorScheme: Binding<LocalStudioKit.ColorScheme> {
        Binding { store.pages.settings?.colorScheme ?? .system } set: { store.setColorScheme($0) }
    }

    private func jumpTitle(_ number: Int) -> String {
        guard let row = store.inbox.thread(store.inbox.jumpTarget(number)) else { return "Thread \(number)" }
        return row.title.isEmpty ? "Thread \(number)" : row.title
    }
}

private struct CommandButton: View {
    let store: StudioStore
    let title: String
    let command: String

    var body: some View {
        Button(title) { store.dispatch(command) }
            .keyboardShortcut(store.menuShortcut(command))
            .disabled(!store.canDispatch(command))
    }
}
