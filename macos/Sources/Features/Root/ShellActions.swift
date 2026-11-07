import AppKit
import LocalStudioKit
import SwiftUI

extension StudioStore {
    var focusedThread: String? {
        conversation.thread
    }

    var focusedRow: ThreadRow? {
        inbox.thread(conversation.thread)
    }

    var focusedProject: String? {
        conversation.info?.project ?? focusedRow?.project ?? (conversation.thread == nil ? inbox.currentProject : nil)
    }

    func shortcut(_ command: String) -> KeyboardShortcut? {
        CoreShortcut.parse(pages.keybindings.first { $0.command == command }?.shortcut)
    }

    func shortcutText(_ command: String) -> String? {
        CoreShortcut.display(pages.keybindings.first { $0.command == command }?.shortcut)
    }

    func open(_ thread: String) {
        shell.record(from: conversation.thread, to: thread)
        shell.route = .thread
        shell.palette = nil
        select(thread)
    }

    func newThread(onBranchOf row: ThreadRow) {
        newThread(in: row.project)
        let options = conversation.newThread
        if let worktree = row.worktree {
            options.existingWorktree = worktree
            options.existingBranch = row.branch
        } else {
            options.chooseWorkspace(worktree: false)
        }
    }

    func newThread(in project: String?) {
        if conversation.thread != nil {
            shell.record(from: conversation.thread, to: nil)
        }
        inbox.selectProject(project)
        shell.route = .thread
        shell.palette = nil
        inbox.clearSelection()
        select(nil)
    }

    func newThreadCommand(currentProject: Bool) {
        if currentProject || inbox.projects.count <= 1 {
            newThread(in: focusedProject ?? inbox.currentProject ?? inbox.projects.first?.id)
        } else {
            shell.palette = .newThread
        }
    }

    func toggleSidebar() {
        shell.sidebarVisible.toggle()
    }

    func show(_ route: MainRoute) {
        shell.palette = nil
        shell.route = shell.route == route ? .thread : route
    }

    func goBack() {
        if shell.route != .thread {
            shell.route = .thread
            return
        }
        guard let target = shell.popBack(current: conversation.thread) else { return }
        select(target)
    }

    func goForward() {
        guard let target = shell.popForward(current: conversation.thread) else { return }
        shell.route = .thread
        select(target)
    }

    func stepThread(_ offset: Int) {
        guard let target = inbox.neighbor(of: conversation.thread, offset: offset) else { return }
        open(target)
    }

    func jumpToThread(_ number: Int) {
        guard let target = inbox.jumpTarget(number) else { return }
        open(target)
    }

    func addProjectInteractively() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "Add Project"
        panel.message = "Choose a folder to add as a project."
        if let base = pages.settings?.addProjectBaseDirectory, !base.isEmpty {
            panel.directoryURL = URL(fileURLWithPath: (base as NSString).expandingTildeInPath, isDirectory: true)
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        inbox.addProject(path: url.path)
        newThread(in: url.path)
    }

    func workspacePath(for row: ThreadRow?) -> String? {
        if let row {
            return row.worktree ?? inbox.project(row.project)?.path
        }
        if let info = conversation.info, !info.cwd.isEmpty {
            return info.worktree ?? info.cwd
        }
        return inbox.project(inbox.currentProject)?.path
    }

    func gitProject(for row: ThreadRow?) -> String? {
        if let row {
            return row.worktree ?? row.project
        }
        if let info = conversation.info {
            return info.worktree ?? info.project
        }
        return conversation.thread == nil ? inbox.currentProject : nil
    }

    func copyReference(_ id: String) {
        let row = inbox.thread(id)
        let status = gitProject(for: row).flatMap { workspace.gitStatus[$0] }
        let link = status.flatMap { status in
            status.pullRequest.flatMap { status.branch == row?.branch || row?.branch == nil ? $0.url : nil }
        }
        copy(link ?? id)
    }

    func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func togglePin(_ ids: [String]) {
        let pin = ids.contains { inbox.thread($0)?.pinned == false }
        if !pin, pages.settings?.confirmUnpin == true {
            shell.confirmation = .unpin(ids)
            return
        }
        inbox.setPinned(ids, pin)
    }

    func toggleSettle(_ ids: [String]) {
        let settle = ids.contains { inbox.thread($0)?.shelf != .settled }
        inbox.setSettled(ids, settle)
    }

    func archive(_ ids: [String]) {
        if pages.settings?.confirmArchive == true {
            shell.confirmation = .archive(ids)
        } else {
            inbox.setArchived(ids, true)
        }
    }

    func requestDelete(_ ids: [String]) {
        if pages.settings?.confirmDelete == false {
            delete(ids)
        } else {
            shell.confirmation = .delete(ids)
        }
    }

    func confirm(_ confirmation: ShellConfirmation) {
        shell.confirmation = nil
        switch confirmation {
        case .delete(let ids): delete(ids)
        case .archive(let ids): inbox.setArchived(ids, true)
        case .unpin(let ids): inbox.setPinned(ids, false)
        }
    }

    func undoOrSendUndo() {
        if let responder = NSApp.keyWindow?.firstResponder, responder is NSText {
            NSApp.sendAction(Selector(("undo:")), to: nil, from: nil)
        } else {
            inbox.performUndo()
        }
    }

    func setColorScheme(_ scheme: LocalStudioKit.ColorScheme) {
        guard var settings = pages.settings else { return }
        settings.colorScheme = scheme
        core.run { $0.updateSettings(settings: settings) }
    }

    func cycleColorScheme() {
        switch pages.settings?.colorScheme ?? .system {
        case .system: setColorScheme(.light)
        case .light: setColorScheme(.dark)
        case .dark: setColorScheme(.system)
        }
    }

    private func delete(_ ids: [String]) {
        if let focused = conversation.thread, ids.contains(focused) {
            select(inbox.neighbor(of: focused, offset: 1) ?? inbox.neighbor(of: focused, offset: -1))
        }
        inbox.delete(ids)
    }
}
