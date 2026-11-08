import AppKit
import LocalStudioKit
import SwiftUI
import Observation

struct MenuCommand: Equatable {
    var enabled: Bool
    var shortcut: KeyboardShortcut?
}

struct MenuState: Equatable {
    var commands: [String: MenuCommand] = [:]
    var sidebarVisible = true
    var terminalOpen = false
    var rightPanelOpen = false
    var hasProjects = false
    var hasSettings = false
    var colorScheme: LocalStudioKit.ColorScheme = .system
    var timeFormat: TimeFormat?
    var undoLabel: String?
    var row: ThreadRow?
    var project: String?
    var scripts: [ProjectScript] = []
    var jumpTitles: [String] = []
    var hasThread = false
    var onThread = false
}

@MainActor
final class CommandRefresh: ObservableObject {
    private static let coalescing = Duration.milliseconds(200)

    private let store: StudioStore
    private var known: Set<String> = []
    private var scheduled = false
    private(set) var state = MenuState()

    init(store: StudioStore) {
        self.store = store
        track()
    }

    func command(_ id: String) -> MenuCommand {
        if let command = state.commands[id] { return command }
        known.insert(id)
        let command = Self.command(id, store: store)
        state.commands[id] = command
        schedule()
        return command
    }

    private func schedule() {
        guard !scheduled else { return }
        scheduled = true
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.coalescing)
            self?.scheduled = false
            self?.track()
        }
    }

    private func track() {
        let next = withObservationTracking {
            snapshot()
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.schedule()
            }
        }
        if next != state {
            objectWillChange.send()
            state = next
        }
    }

    private func snapshot() -> MenuState {
        _ = store.commands.revision
        let inbox = store.inbox
        let settings = store.pages.settings
        let project = store.focusedProject
        var next = MenuState()
        for id in known {
            next.commands[id] = Self.command(id, store: store)
        }
        next.sidebarVisible = store.shell.sidebarVisible
        next.terminalOpen = store.panels.terminalOpen
        next.rightPanelOpen = store.panels.rightPanelOpen
        next.hasProjects = !inbox.projects.isEmpty
        next.hasSettings = settings != nil
        next.colorScheme = settings?.colorScheme ?? .system
        next.timeFormat = settings?.timeFormat
        next.undoLabel = inbox.undo?.label
        next.row = store.focusedRow
        next.project = project
        next.scripts = project.flatMap { inbox.projectScripts[$0] } ?? []
        next.jumpTitles = (1...9).map { number in
            guard let row = inbox.thread(inbox.jumpTarget(number)), !row.title.isEmpty else { return "Thread \(number)" }
            return row.title
        }
        next.hasThread = store.conversation.thread != nil
        next.onThread = store.shell.route == .thread
        return next
    }

    private static func command(_ id: String, store: StudioStore) -> MenuCommand {
        MenuCommand(enabled: store.canDispatch(id), shortcut: store.menuShortcut(id))
    }
}

struct StudioCommands: Commands {
    let store: StudioStore
    @ObservedObject var refresh: CommandRefresh

    var body: some Commands {
        let state = refresh.state
        CommandGroup(replacing: .newItem) {
            button("New Thread", "chat.new")
            button("New Thread in Current Project", "chat.newLocal")
            button("New Thread Here", "chat.newTab")
            button("New Thread Without a Project", "chat.newWithoutProject")
            Button("New Thread in Project…") { store.shell.palette = .newThread }
                .disabled(!state.hasProjects)
            Divider()
            Button("Add Project…") { store.addProjectInteractively() }
            Button("Clone Repository…") { store.shell.cloneShown = true }
            button("Open in Editor", "editor.openFavorite")
            button("Close Panel Tab", "rightPanel.close")
            button("Close Thread", "thread.close")
            Menu("Terminal") {
                button("New Terminal", "terminal.new")
                button("Split Horizontally", "terminal.split")
                button("Split Vertically", "terminal.splitVertical")
                button("Close Terminal", "terminal.close")
            }
        }
        CommandGroup(replacing: .saveItem) {
            Button("Close Window") { NSApp.keyWindow?.performClose(nil) }
                .keyboardShortcut("w", modifiers: [.command, .shift])
        }
        CommandGroup(replacing: .undoRedo) {
            Button(state.undoLabel.map { "Undo \($0)" } ?? "Undo") { store.dispatch("thread.undo") }
                .keyboardShortcut(refresh.command("thread.undo").shortcut ?? KeyboardShortcut("z"))
            Button("Redo") { NSApp.sendAction(Selector(("redo:")), to: nil, from: nil) }
                .keyboardShortcut("z", modifiers: [.command, .shift])
        }
        CommandGroup(after: .pasteboard) {
            Button("Paste as Text") { NSApp.sendAction(#selector(NSTextView.pasteAsPlainText(_:)), to: nil, from: nil) }
                .keyboardShortcut("v", modifiers: [.command, .shift])
        }
        CommandGroup(replacing: .sidebar) {
            button(state.sidebarVisible ? "Hide Sidebar" : "Show Sidebar", "sidebar.toggle")
            button(state.terminalOpen ? "Hide Terminal" : "Show Terminal", "terminal.toggle")
            button(state.rightPanelOpen ? "Hide Right Panel" : "Show Right Panel", "rightPanel.toggle")
            button("Toggle Diff", "diff.toggle")
            button("Previous Panel Tab", "rightPanel.previousTab")
            button("Next Panel Tab", "rightPanel.nextTab")
            button("Toggle Browser Preview", "preview.toggle")
            Divider()
            button("Command Palette", "commandPalette.toggle")
            button("Go to File…", "filePicker.toggle")
            button("Search Project…", "projectSearch.toggle")
            Divider()
            focusMenu(state)
            Menu("Browser") {
                button("Reload Page", "preview.refresh")
                button("Focus Address Bar", "preview.focusUrl")
                Divider()
                button("Zoom In", "preview.zoomIn")
                button("Zoom Out", "preview.zoomOut")
                button("Actual Size", "preview.resetZoom")
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
                button("Cycle Appearance", "appearance.cycle")
                button("Choose Appearance…", "theme.select")
                button("Theme Editor", "themeEditor.toggle")
            }
            .disabled(!state.hasSettings)
            Divider()
            button("Usage", "usage.open")
            Menu("Usage View") {
                button("Cost", "usage.cost")
                button("Tokens", "usage.tokens")
                button("Limits", "usage.limits")
                Divider()
                button("Last Day", "usage.period.day")
                button("Last Week", "usage.period.week")
                button("Last Month", "usage.period.month")
                button("Last Quarter", "usage.period.quarter")
            }
            Button("Local") { store.show(.local) }
            Button("Pull Requests") { store.show(.pullRequests) }
            Button("Archived Threads") { store.show(.archive) }
            Divider()
            button("Back", "navigation.back")
            button("Forward", "navigation.forward")
            Divider()
        }
        CommandMenu("Thread") {
            threadMenu(state)
        }
        CommandMenu("Composer") {
            button("Send Queued Message Now", "thread.steerQueuedMessage")
            button("Stash Prompt", "composer.stash")
            Divider()
            button("Choose Model…", "modelPicker.toggle")
            button("Previous Provider", "modelPicker.previousProvider")
            button("Next Provider", "modelPicker.nextProvider")
            Menu("Choose Model") {
                ForEach(1...9, id: \.self) { number in
                    button("Model \(number)", "modelPicker.jump.\(number)")
                }
            }
            Divider()
            button("Effort", "composer.effort")
            button("Access Mode", "composer.mode")
            button("Workspace", "composer.workspace")
            button("Branch", "composer.branch")
            button("Previous Worktree", "composer.previousWorktree")
            button("Host", "composer.host")
        }
        CommandGroup(replacing: .help) {
            Button("Supported Hardware and Models") {
                if let url = URL(string: "https://local-ai-registry.vercel.app/?topic=hardware") {
                    NSWorkspace.shared.open(url)
                }
            }
        }
    }

    @ViewBuilder
    private func threadMenu(_ state: MenuState) -> some View {
        let row = state.row
        let id = row?.id
        button(row?.pinned == true ? "Unpin" : "Pin", "thread.pin")
        button(row?.shelf == .settled ? "Un-settle" : "Settle", "thread.settle")
        if row?.shelf == .snoozed {
            Button("Wake") { if let id { store.inbox.snooze([id], until: nil) } }
        } else {
            Menu("Snooze") {
                ForEach(SnoozePreset.resolve(timeFormat: state.timeFormat)) { choice in
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
        button("Previous Thread", "thread.previous")
        button("Next Thread", "thread.next")
        button("Next Recent Thread", "thread.recentNext")
        button("Previous Recent Thread", "thread.recentPrevious")
        Menu("Go to Thread") {
            ForEach(1...9, id: \.self) { number in
                button(state.jumpTitles.indices.contains(number - 1) ? state.jumpTitles[number - 1] : "Thread \(number)", "thread.jump.\(number)")
            }
        }
        Divider()
        button("Copy Reference", "thread.copyReference")
        button("Copy Message", "timeline.copyMessage")
        button("Copy Pull Request Number", "pullRequest.copyNumber")
        Divider()
        let project = state.project
        Menu("Project Actions") {
            ForEach(state.scripts, id: \.id) { script in
                Button(script.name) { if let project { store.runProjectScript(script, in: project) } }
                    .keyboardShortcut(CoreShortcut.parse(script.keybinding))
            }
            if !state.scripts.isEmpty { Divider() }
            Button("Add Action…") { store.openProjectSettings(project) }
                .disabled(project == nil)
        }
        .disabled(project == nil)
        Button("Project Settings…") { store.openProjectSettings(project) }
            .disabled(project == nil)
    }

    private func focusMenu(_ state: MenuState) -> some View {
        Menu("Focus") {
            button("Next Region", "focus.next")
            button("Previous Region", "focus.previous")
            button("Cycle Regions", "focus.cycle")
            button("Cycle Regions Backward", "focus.cycleBack")
            Divider()
            Button("Sidebar") { store.focus(.sidebar) }
            Button("Timeline") { store.focus(.timeline) }
                .disabled(!state.hasThread || !state.onThread)
            button("Composer", "focus.composer")
            Button("Right Panel") { store.focus(.rightPanel) }
                .disabled(!state.onThread)
            Button("Terminal") { store.focus(.terminal) }
                .disabled(!state.onThread)
            Divider()
            Button("Search Threads") { store.focusSidebarSearch() }
        }
    }

    private var colorScheme: Binding<LocalStudioKit.ColorScheme> {
        Binding { refresh.state.colorScheme } set: { store.setColorScheme($0) }
    }

    private func button(_ title: String, _ command: String) -> CommandButton {
        CommandButton(store: store, title: title, command: command, state: refresh.command(command))
    }
}

private struct CommandButton: View {
    let store: StudioStore
    let title: String
    let command: String
    let state: MenuCommand

    var body: some View {
        Button(title) { store.dispatch(command) }
            .keyboardShortcut(state.shortcut)
            .disabled(!state.enabled)
    }
}
