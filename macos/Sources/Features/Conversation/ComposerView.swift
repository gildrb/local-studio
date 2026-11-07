import AppKit
import LocalStudioKit
import SwiftUI

struct ComposerView: View {
    let store: StudioStore
    @State private var height: CGFloat = 18
    @State private var trigger: ComposerTrigger?
    @State private var highlighted = 0
    @State private var recall: PromptRecall?
    @State private var hovering = false

    var body: some View {
        let conversation = store.conversation
        let draft = conversation.composer(project: project)
        let source = ComposerSuggestionSource(store: store)
        let suggestions = trigger.map { source.items(for: $0) } ?? []
        let resting = isResting(draft)
        VStack(alignment: .leading, spacing: 0) {
            if let trigger, !resting {
                SuggestionList(
                    suggestions: suggestions,
                    highlighted: min(highlighted, max(suggestions.count - 1, 0)),
                    empty: source.emptyText(for: trigger)
                ) { accept($0, draft: draft) }
                Rectangle().fill(Theme.hairline).frame(height: 1)
            }
            if !resting, !draft.images.isEmpty || !draft.files.isEmpty || !draft.contexts.isEmpty {
                AttachmentStrip(draft: draft)
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
            }
            ComposerTextView(
                draft: draft,
                fontSize: promptSize,
                focusToken: conversation.focusRequest,
                markdownShortcuts: store.pages.settings?.richTextComposer ?? true,
                height: $height,
                onCaret: { text, caret in caretMoved(text: text, caret: caret) },
                onKey: { key, caret in handle(key, caret: caret, draft: draft, suggestions: suggestions) },
                onImage: { data, mime in draft.attach(image: data, mimeType: mime) },
                onFiles: { urls in draft.attach(urls: urls, project: project) }
            )
            .frame(height: resting ? lineHeight : min(max(height, lineHeight), 220))
            .overlay(alignment: .topLeading) {
                if draft.text.isEmpty {
                    Text(placeholder)
                        .font(.system(size: promptSize))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                        .allowsHitTesting(false)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, resting ? 11 : 14)
            .padding(.bottom, resting ? 11 : 6)
            if !resting {
                ComposerControls(
                    store: store,
                    draft: draft,
                    project: project,
                    canSend: canSend(draft)
                ) { submit(alternate: false) }
                .padding(.horizontal, 8)
                .padding(.bottom, 8)
            }
        }
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.input))
        .onHover { hovering = $0 }
        .task(id: project) {
            conversation.draftProject = project
        }
        .task(id: trigger) {
            guard let trigger, case .mention = trigger.kind, let project else { return }
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            conversation.searchMentions(trigger.query, project: project)
        }
    }

    private var project: String? {
        if store.conversation.thread != nil {
            return store.conversation.info?.project
        }
        return store.inbox.currentProject
    }

    private var promptSize: CGFloat {
        CGFloat(store.pages.settings?.promptFontSize ?? 14)
    }

    private var lineHeight: CGFloat {
        ceil(NSFont.systemFont(ofSize: promptSize).boundingRectForFont.height)
    }

    private var placeholder: String {
        let conversation = store.conversation
        if !conversation.approvals.isEmpty {
            return "Resolve this approval request to continue"
        }
        if conversation.providerUnavailable {
            return "Enable a provider in Settings to send a message"
        }
        if store.connection != .ready {
            return "Ask for changes, send follow-ups, or attach images"
        }
        return "Ask anything, @tag files/folders, $use skills, or / for commands"
    }

    private func isResting(_ draft: ComposerDraft) -> Bool {
        let conversation = store.conversation
        return store.pages.settings?.collapseComposerOnScroll == true && conversation.thread != nil
            && !conversation.followsEnd && draft.isEmpty && trigger == nil && !hovering
    }

    private func canSend(_ draft: ComposerDraft) -> Bool {
        store.connection == .ready && store.conversation.approvals.isEmpty
            && !store.conversation.providerUnavailable && !draft.isEmpty
    }

    private func submit(alternate: Bool) {
        let draft = store.conversation.composer(project: project)
        guard canSend(draft) else { return }
        let defaultBranch = project.flatMap { store.workspace.gitStatus[$0]?.defaultBranch }
        store.conversation.submit(project: project, alternate: alternate, settings: store.pages.settings, defaultBranch: defaultBranch)
        trigger = nil
        recall = nil
    }

    private func caretMoved(text: String, caret: Int) {
        if let recall, recall.text != text {
            self.recall = nil
        }
        let next = ComposerTrigger.detect(in: text, caret: caret, project: project != nil)
        guard next != trigger else { return }
        if next?.kind != trigger?.kind || next?.query != trigger?.query {
            highlighted = 0
        }
        let conversation = store.conversation
        switch next?.kind {
        case .command?, .skill?:
            if !conversation.commandsLoaded {
                conversation.loadCommands(project: project)
            }
        case .pullRequest?:
            if let project, conversation.pullsProject != project {
                conversation.loadPullRequests(project: project)
            }
        case .mention?, nil:
            break
        }
        trigger = next
        if next == nil {
            conversation.clearMentions()
        }
    }

    private func handle(_ key: ComposerKey, caret: Int, draft: ComposerDraft, suggestions: [ComposerSuggestion]) -> Bool {
        if trigger != nil {
            switch key {
            case .up where !suggestions.isEmpty:
                highlighted = max(min(highlighted, suggestions.count - 1) - 1, 0)
                return true
            case .down where !suggestions.isEmpty:
                highlighted = min(highlighted + 1, suggestions.count - 1)
                return true
            case .enter(false, false, false) where !suggestions.isEmpty, .tab where !suggestions.isEmpty:
                accept(suggestions[min(highlighted, suggestions.count - 1)], draft: draft)
                return true
            case .escape:
                trigger = nil
                return true
            default:
                break
            }
        }
        switch key {
        case .enter(let shift, let command, let option):
            return enter(shift: shift, command: command, option: option, draft: draft)
        case .up:
            return recallPrevious(draft: draft, caret: caret)
        case .down:
            return recallNext(draft: draft, caret: caret)
        case .tab, .escape:
            return false
        }
    }

    private func enter(shift: Bool, command: Bool, option: Bool, draft: ComposerDraft) -> Bool {
        let conversation = store.conversation
        if !shift, let approval = conversation.approvals.first, draft.isEmpty {
            conversation.answer(approval, .approve)
            return true
        }
        if option {
            guard !shift else { return false }
            submit(alternate: conversation.busy)
            return true
        }
        let intent = SubmitIntent.resolve(
            shift: shift, command: command, running: conversation.busy,
            shortcut: store.pages.settings?.sendShortcut ?? .enter, text: draft.text
        )
        switch intent {
        case nil:
            return false
        case .send?:
            submit(alternate: false)
        case .alternate?:
            submit(alternate: true)
        }
        return true
    }

    private func recallPrevious(draft: ComposerDraft, caret: Int) -> Bool {
        let history = store.conversation.promptHistory()
        let length = (draft.text as NSString).length
        guard !history.isEmpty, caret == 0 || (recall != nil && caret == length) else { return false }
        let index: Int
        let stash: String
        if let recall {
            guard recall.index > 0 else { return true }
            index = recall.index - 1
            stash = recall.stash
        } else {
            index = history.count - 1
            stash = draft.text
        }
        recall = PromptRecall(index: index, stash: stash, text: history[index])
        draft.text = history[index]
        return true
    }

    private func recallNext(draft: ComposerDraft, caret: Int) -> Bool {
        guard let recall, caret == (draft.text as NSString).length else { return false }
        let history = store.conversation.promptHistory()
        if recall.index + 1 < history.count {
            self.recall = PromptRecall(index: recall.index + 1, stash: recall.stash, text: history[recall.index + 1])
            draft.text = history[recall.index + 1]
        } else {
            self.recall = nil
            draft.text = recall.stash
        }
        return true
    }

    private func accept(_ suggestion: ComposerSuggestion, draft: ComposerDraft) {
        guard let trigger else { return }
        let text = draft.text as NSString
        let range = NSRange(location: trigger.start, length: min(trigger.end, text.length) - trigger.start)
        let conversation = store.conversation
        switch suggestion.action {
        case .insert(let value):
            draft.text = text.replacingCharacters(in: range, with: value)
        case .models:
            draft.text = text.replacingCharacters(in: range, with: "")
            conversation.modelPickerPresented = true
        case .compact:
            draft.text = text.replacingCharacters(in: range, with: "")
            conversation.compact()
        case .skill(let name):
            let rest = text.replacingCharacters(in: range, with: "").trimmingCharacters(in: .whitespaces)
            draft.text = "/" + name + " " + rest
        case .pullRequest(let pull):
            draft.text = text.replacingCharacters(in: range, with: "#\(pull.number) ")
            conversation.attachPullRequest(pull, to: draft)
        }
        self.trigger = nil
        conversation.clearMentions()
    }
}

enum SubmitIntent {
    case send
    case alternate

    static func resolve(shift: Bool, command: Bool, running: Bool, shortcut: SendShortcut, text: String) -> SubmitIntent? {
        let requiresModifier = shortcut == .modEnter || (shortcut == .modEnterMultiline && text.contains(where: \.isNewline))
        if requiresModifier, !command {
            return nil
        }
        if shift, !(requiresModifier && command && running) {
            return nil
        }
        if running, command, !requiresModifier || shift {
            return .alternate
        }
        return .send
    }
}

struct PromptRecall {
    let index: Int
    let stash: String
    let text: String
}
