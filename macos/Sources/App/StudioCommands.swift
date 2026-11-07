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
    }
}

struct StudioCommands: Commands {
    let store: StudioStore
    @ObservedObject var refresh: CommandRefresh

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Thread") { store.newThreadCommand(currentProject: false) }
                .keyboardShortcut(store.shortcut("chat.new"))
                .disabled(store.inbox.projects.isEmpty && store.connection != .ready)
            Button("New Thread in Current Project") { store.newThreadCommand(currentProject: true) }
                .keyboardShortcut(store.shortcut("chat.newLocal"))
            Button("New Thread Without a Project") { store.newThread(in: nil) }
                .keyboardShortcut(store.shortcut("chat.newWithoutProject"))
            Button("New Thread in Project…") { store.shell.palette = .newThread }
                .disabled(store.inbox.projects.isEmpty)
            Divider()
            Button("Add Project…") { store.addProjectInteractively() }
            Button("Open in Editor") { EditorLauncher.openFavorite(store.workspacePath(for: store.focusedRow)) }
                .keyboardShortcut(store.shortcut("editor.openFavorite"))
                .disabled(store.workspacePath(for: store.focusedRow) == nil)
            Button("Close Panel Tab") { store.panels.closeActiveSurface() }
                .keyboardShortcut(store.panels.rightPanelOpen ? store.shortcut("rightPanel.close") : nil)
                .disabled(!store.panels.rightPanelOpen)
        }
        CommandGroup(replacing: .undoRedo) {
            Button(undoTitle) { store.undoOrSendUndo() }
                .keyboardShortcut(store.shortcut("thread.undo") ?? KeyboardShortcut("z"))
            Button("Redo") { NSApp.sendAction(Selector(("redo:")), to: nil, from: nil) }
                .keyboardShortcut("z", modifiers: [.command, .shift])
        }
        CommandGroup(after: .pasteboard) {
            Button("Paste as Text") { NSApp.sendAction(#selector(NSTextView.pasteAsPlainText(_:)), to: nil, from: nil) }
                .keyboardShortcut("v", modifiers: [.command, .shift])
        }
        CommandGroup(replacing: .sidebar) {
            Button(store.shell.sidebarVisible ? "Hide Sidebar" : "Show Sidebar") { store.toggleSidebar() }
                .keyboardShortcut(store.shortcut("sidebar.toggle"))
            Button(store.panels.terminalOpen ? "Hide Terminal" : "Show Terminal") { store.panels.toggleTerminal() }
                .keyboardShortcut(store.shortcut("terminal.toggle"))
            Button(store.panels.rightPanelOpen ? "Hide Right Panel" : "Show Right Panel") { store.panels.toggleRightPanel() }
                .keyboardShortcut(store.shortcut("rightPanel.toggle"))
            Button("Toggle Diff") { store.panels.toggleDiff() }
                .keyboardShortcut(store.shortcut("diff.toggle"))
            Divider()
            Button("Command Palette") { togglePalette(.root) }
                .keyboardShortcut(store.shortcut("commandPalette.toggle"))
            Button("Go to File…") { togglePalette(.goToFile) }
                .keyboardShortcut(store.shortcut("filePicker.toggle"))
            Button("Search Project…") { togglePalette(.searchProject) }
                .keyboardShortcut(store.shortcut("projectSearch.toggle"))
            Divider()
            Menu("Appearance") {
                Picker("Appearance", selection: colorScheme) {
                    Text("System").tag(LocalStudioKit.ColorScheme.system)
                    Text("Light").tag(LocalStudioKit.ColorScheme.light)
                    Text("Dark").tag(LocalStudioKit.ColorScheme.dark)
                }
                .pickerStyle(.inline)
                .labelsHidden()
                Divider()
                Button("Cycle Appearance") { store.cycleColorScheme() }
                    .keyboardShortcut(store.shortcut("appearance.cycle"))
            }
            .disabled(store.pages.settings == nil)
            Divider()
            Button("Usage") { store.show(.usage) }
                .keyboardShortcut(store.shortcut("usage.open"))
            Button("Local") { store.show(.local) }
            Button("Pull Requests") { store.show(.pullRequests) }
            Button("Archived Threads") { store.show(.archive) }
            Divider()
            Button("Back") { store.goBack() }
                .keyboardShortcut(store.shortcut("navigation.back"))
                .disabled(store.shell.route == .thread && !store.shell.canGoBack)
            Button("Forward") { store.goForward() }
                .keyboardShortcut(store.shortcut("navigation.forward"))
                .disabled(!store.shell.canGoForward)
            Divider()
        }
        CommandMenu("Thread") {
            threadMenu
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
        Button(row?.pinned == true ? "Unpin" : "Pin") { if let id { store.togglePin([id]) } }
            .keyboardShortcut(store.shortcut("thread.pin"))
            .disabled(row == nil)
        Button(row?.shelf == .settled ? "Un-settle" : "Settle") { if let id { store.toggleSettle([id]) } }
            .keyboardShortcut(store.shortcut("thread.settle"))
            .disabled(row == nil)
        if row?.shelf == .snoozed {
            Button("Wake") { if let id { store.inbox.snooze([id], until: nil) } }
        } else {
            Menu("Snooze") {
                ForEach(SnoozePreset.resolve()) { choice in
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
        Button(row?.unread == true ? "Mark as Read" : "Mark as Unread") { if let row { store.inbox.markUnread([row.id], !row.unread) } }
            .disabled(row == nil)
        Button("Archive") { if let id { store.archive([id]) } }
            .disabled(row == nil || row?.status == .working)
        Button("Delete…") { if let id { store.requestDelete([id]) } }
            .disabled(row == nil)
        Divider()
        Button("Previous Thread") { store.stepThread(-1) }
            .keyboardShortcut(store.shortcut("thread.previous"))
        Button("Next Thread") { store.stepThread(1) }
            .keyboardShortcut(store.shortcut("thread.next"))
        Menu("Go to Thread") {
            ForEach(1...9, id: \.self) { number in
                Button(jumpTitle(number)) { store.jumpToThread(number) }
                    .keyboardShortcut(store.shortcut("thread.jump.\(number)"))
                    .disabled(store.inbox.jumpTarget(number) == nil)
            }
        }
        Divider()
        Button("Copy Reference") { if let id { store.copyReference(id) } }
            .keyboardShortcut(store.shortcut("thread.copyReference"))
            .disabled(row == nil)
    }

    private var undoTitle: String {
        store.inbox.undo.map { "Undo \($0.label)" } ?? "Undo"
    }

    private var colorScheme: Binding<LocalStudioKit.ColorScheme> {
        Binding { store.pages.settings?.colorScheme ?? .system } set: { store.setColorScheme($0) }
    }

    private func togglePalette(_ page: PalettePage) {
        store.shell.palette = store.shell.palette == page ? nil : page
    }

    private func jumpTitle(_ number: Int) -> String {
        guard let row = store.inbox.thread(store.inbox.jumpTarget(number)) else { return "Thread \(number)" }
        return row.title.isEmpty ? "Thread \(number)" : row.title
    }
}
