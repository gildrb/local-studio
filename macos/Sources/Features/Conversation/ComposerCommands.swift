import LocalStudioKit
import SwiftUI

struct ComposerCommands: ViewModifier {
    let store: StudioStore
    let project: String?
    let draftEmpty: Bool

    func body(content: Content) -> some View {
        let conversation = store.conversation
        let settings = store.pages.settings
        let levels = conversation.thinkingLevels(settings: settings)
        let draftWorkspace = conversation.thread == nil && store.inbox.project(store.inbox.currentProject)?.isGit == true
        content
            .studioCommand("composer.stash", in: store, enabled: !draftEmpty) {
                conversation.stashPrompt(project: project)
            }
            .studioCommand("thread.steerQueuedMessage", in: store, enabled: conversation.queued.contains { !$0.steering && !$0.sending }) {
                _ = conversation.steerQueuedMessage()
            }
            .studioCommand("modelPicker.toggle", in: store) {
                conversation.modelPickerPresented.toggle()
            }
            .studioCommand("composer.effort", in: store, enabled: levels.count > 1) {
                let current = conversation.thinkingLevel(settings: settings) ?? levels.first
                let index = current.flatMap { levels.firstIndex(of: $0) } ?? -1
                conversation.setThinkingLevel(levels[(index + 1) % levels.count])
            }
            .studioCommand("composer.mode", in: store) {
                let all = AccessMode.all
                let index = all.firstIndex(of: conversation.access(settings: settings)) ?? -1
                conversation.setAccess(all[(index + 1) % all.count])
            }
            .studioCommand("composer.workspace", in: store, enabled: draftWorkspace) {
                conversation.newThread.chooseWorkspace(worktree: !conversation.newThread.usesWorktree(settings))
            }
    }
}

struct ModelPickerJumpCommands: ViewModifier {
    let store: StudioStore
    let models: [ModelOption]
    let select: (ModelOption) -> Void
    @State private var owner = CommandOwner()

    func body(content: Content) -> some View {
        content
            .onAppear { register() }
            .onChange(of: models.map(\.key)) { register() }
            .onDisappear { store.commands.unregister(owner: owner) }
    }

    private func register() {
        store.commands.unregister(owner: owner)
        for (index, model) in models.prefix(9).enumerated() {
            store.commands.register("modelPicker.jump.\(index + 1)", owner: owner) { select(model) }
        }
    }
}
