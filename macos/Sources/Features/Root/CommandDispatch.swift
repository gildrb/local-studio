import AppKit
import LocalStudioKit
import SwiftUI

extension StudioStore {
    private static let focusClauses = ["terminalFocus", "previewFocus", "modelPickerOpen", "usagePageOpen", "timelineFocus"]

    func binding(_ command: String) -> Keybinding? {
        pages.keybindingIndex.binding(command)
    }

    func dispatch(_ command: String) {
        if let chord = binding(command)?.shortcut {
            for other in pages.keybindingIndex.sharing(chord) where other.command != command && clauseHolds(other) && commands.canPerform(other.command) {
                commands.perform(other.command)
                shell.probe.ran(other.command)
                return
            }
        }
        if commands.perform(command) {
            shell.probe.ran(command)
            return
        }
        guard let action = builtin(command) else {
            shell.probe.ran(nil)
            return
        }
        action()
        shell.probe.ran(command)
    }

    func canDispatch(_ command: String) -> Bool {
        if builtin(command) != nil || commands.isRegistered(command) { return true }
        guard let chord = binding(command)?.shortcut else { return false }
        return pages.keybindingIndex.sharing(chord).contains { $0.command != command && commands.isRegistered($0.command) }
    }

    func menuShortcut(_ command: String) -> KeyboardShortcut? {
        guard let binding = binding(command), let chord = binding.shortcut else { return nil }
        if Self.isFocusScoped(binding) {
            let collides = pages.keybindingIndex.sharing(chord).contains { $0.command != command && !Self.isFocusScoped($0) }
            if collides { return nil }
            if binding.when?.contains("usagePageOpen") == true, shell.route != .usage { return nil }
            if binding.when?.contains("timelineFocus") == true, shell.region != .timeline || shell.route != .thread { return nil }
        } else {
            let peers = pages.keybindingIndex.sharing(chord).filter { !Self.isFocusScoped($0) }
            if peers.count > 1 {
                let owner = peers.first { builtin($0.command) != nil || commands.canPerform($0.command) } ?? peers[0]
                if owner.command != command { return nil }
            }
        }
        return CoreShortcut.parse(chord)
    }

    private static func isFocusScoped(_ binding: Keybinding) -> Bool {
        guard let when = binding.when else { return false }
        return focusClauses.contains { clause in
            when.contains(clause) && !when.contains("!\(clause)")
        }
    }

    private func clauseHolds(_ binding: Keybinding) -> Bool {
        guard let when = binding.when else { return true }
        if when.contains("previewFocus"), !when.contains("!previewFocus") { return shell.region == .rightPanel }
        if when.contains("timelineFocus"), !when.contains("!timelineFocus") { return shell.region == .timeline }
        return true
    }

    func builtin(_ command: String) -> (@MainActor () -> Void)? {
        let row = focusedRow
        switch command {
        case "sidebar.toggle": return { self.toggleSidebar() }
        case "navigation.back":
            guard shell.route != .thread || shell.canGoBack else { return nil }
            return { self.goBack() }
        case "navigation.forward":
            guard shell.canGoForward else { return nil }
            return { self.goForward() }
        case "terminal.toggle": return { self.panels.toggleTerminal() }
        case "rightPanel.toggle": return { self.panels.toggleRightPanel() }
        case "rightPanel.close":
            if let window = NSApp.keyWindow, window !== mainWindow { return { window.performClose(nil) } }
            guard panels.rightPanelOpen else { return nil }
            return { self.panels.closeActiveSurface() }
        case "diff.toggle": return { self.panels.toggleDiff() }
        case "commandPalette.toggle": return { self.togglePalette(.root) }
        case "filePicker.toggle": return { self.togglePalette(.goToFile) }
        case "projectSearch.toggle": return { self.togglePalette(.searchProject) }
        case "usage.open": return { self.show(.usage) }
        case "theme.select": return { self.togglePalette(.appearance) }
        case "appearance.cycle":
            guard pages.settings != nil else { return nil }
            return { self.cycleColorScheme() }
        case "chat.new": return { self.newThreadCommand(currentProject: false) }
        case "chat.newLocal": return { self.newThreadCommand(currentProject: true) }
        case "chat.newWithoutProject": return { self.newThread(in: nil) }
        case "chat.newTab": return { self.newThreadTab() }
        case "thread.close":
            if let window = NSApp.keyWindow, window !== mainWindow { return { window.performClose(nil) } }
            guard !panels.rightPanelOpen else { return nil }
            guard shell.route == .thread, conversation.selectedID != nil else { return { self.mainWindow?.performClose(nil) } }
            return { self.closeThread() }
        case "thread.recentNext": return { self.cycleRecent(1) }
        case "thread.recentPrevious": return { self.cycleRecent(-1) }
        case "focus.next", "focus.cycle": return { self.cycleFocus(1) }
        case "focus.previous", "focus.cycleBack": return { self.cycleFocus(-1) }
        case "focus.composer":
            guard shell.route == .thread else { return nil }
            return { self.focus(.composer) }
        case "rightPanel.previousTab":
            guard panels.rightPanelOpen, panels.surfaces.count > 1 else { return nil }
            return { self.stepPanelTab(-1) }
        case "rightPanel.nextTab":
            guard panels.rightPanelOpen, panels.surfaces.count > 1 else { return nil }
            return { self.stepPanelTab(1) }
        case "timeline.copyMessage":
            guard shell.region == .timeline, shell.timelineCursor != nil else { return nil }
            return { _ = self.copyTimelineMessage() }
        case "editor.openFavorite":
            guard let path = workspacePath(for: row) else { return nil }
            return { EditorLauncher.openFavorite(path) }
        case "thread.previous": return { self.stepThread(-1) }
        case "thread.next": return { self.stepThread(1) }
        case "thread.undo": return { self.undoOrSendUndo() }
        case "thread.copyReference": return row.map { row in { self.copyReference(row.id) } }
        case "thread.settle": return row.map { row in { self.toggleSettle([row.id]) } }
        case "thread.pin": return row.map { row in { self.togglePin([row.id]) } }
        case "thread.steerQueuedMessage":
            guard let thread = conversation.thread, let queued = conversation.queued.first(where: { !$0.sending }) else { return nil }
            return { self.core.run { $0.sendQueuedNow(thread: thread, queued: queued.id) } }
        case "pullRequest.copyNumber":
            guard let pull = gitProject(for: row).flatMap({ workspace.gitStatus[$0]?.pullRequest }) else { return nil }
            return { self.copy("#\(pull.number)") }
        default:
            guard command.hasPrefix("thread.jump."), let number = Int(command.dropFirst("thread.jump.".count)),
                  inbox.jumpTarget(number) != nil else { return nil }
            return { self.jumpToThread(number) }
        }
    }

    func togglePalette(_ page: PalettePage) {
        shell.palette = shell.palette == page ? nil : page
    }
}
