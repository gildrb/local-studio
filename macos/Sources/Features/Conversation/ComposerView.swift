import AppKit
import LocalStudioKit
import SwiftUI

struct ComposerView: View {
    let store: StudioStore
    @State private var height: CGFloat = 18
    @State private var trigger: ComposerTrigger?
    @State private var highlighted = 0
    @State private var recall: PromptRecall?
    @State private var showsModels = false

    var body: some View {
        let conversation = store.conversation
        let draft = conversation.composer(project: project)
        let suggestions = trigger.map { suggestions(for: $0) } ?? []
        VStack(alignment: .leading, spacing: 0) {
            if let trigger {
                SuggestionList(
                    suggestions: suggestions,
                    highlighted: min(highlighted, max(suggestions.count - 1, 0)),
                    empty: emptyText(for: trigger)
                ) { accept($0, draft: draft) }
                Rectangle().fill(Theme.hairline).frame(height: 1)
            }
            if !draft.images.isEmpty || !draft.files.isEmpty {
                AttachmentStrip(draft: draft)
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
            }
            ComposerTextView(
                draft: draft,
                fontSize: promptSize,
                focusToken: conversation.focusRequest,
                height: $height,
                onCaret: { text, caret in caretMoved(text: text, caret: caret) },
                onKey: { key, caret in handle(key, caret: caret, draft: draft, suggestions: suggestions) },
                onImage: { data, mime in draft.attach(image: data, mimeType: mime) },
                onFiles: { urls in draft.attach(urls: urls, project: project) }
            )
            .frame(height: min(max(height, 18), 220))
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
            .padding(.top, 14)
            .padding(.bottom, 6)
            ComposerControls(
                store: store,
                draft: draft,
                project: project,
                canSend: canSend(draft),
                showsModels: $showsModels
            ) { submit(steer: false) }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
        }
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.input))
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

    private var providerReady: Bool {
        let models = store.conversation.models
        return models.isEmpty || models.contains(where: \.configured)
    }

    private var placeholder: String {
        let conversation = store.conversation
        switch store.connection {
        case .connecting: return "Connecting to Eukhe…"
        case .lost(let reason): return reason
        case .ready: break
        }
        if !conversation.approvals.isEmpty {
            return "Resolve this approval request to continue"
        }
        if !providerReady {
            return "Enable a provider in Settings to send a message"
        }
        if conversation.busy {
            return "Queue a follow-up, or press ⌥↩ to steer"
        }
        return "Ask anything, @tag files, or / for commands"
    }

    private func canSend(_ draft: ComposerDraft) -> Bool {
        store.connection == .ready && store.conversation.approvals.isEmpty && providerReady && !draft.isEmpty
    }

    private func submit(steer: Bool) {
        let draft = store.conversation.composer(project: project)
        guard canSend(draft) else { return }
        store.conversation.submit(project: project, steer: steer, settings: store.pages.settings)
        trigger = nil
        recall = nil
    }

    private func caretMoved(text: String, caret: Int) {
        if let recall, recall.text != text {
            self.recall = nil
        }
        let next = ComposerTrigger.detect(in: text, caret: caret, mentions: project != nil)
        guard next != trigger else { return }
        if next?.kind != trigger?.kind || next?.query != trigger?.query {
            highlighted = 0
        }
        trigger = next
        if case .command? = next?.kind, !store.conversation.commandsLoaded {
            store.conversation.loadCommands(project: project)
        }
        if next == nil {
            store.conversation.clearMentions()
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
            case .submit where !suggestions.isEmpty, .tab where !suggestions.isEmpty:
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
        case .submit:
            if let approval = store.conversation.approvals.first, draft.isEmpty {
                store.conversation.answer(approval, .approve)
                return true
            }
            submit(steer: false)
            return true
        case .steer:
            submit(steer: true)
            return true
        case .up:
            return recallPrevious(draft: draft, caret: caret)
        case .down:
            return recallNext(draft: draft, caret: caret)
        case .tab, .escape:
            return false
        }
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

    private func suggestions(for trigger: ComposerTrigger) -> [ComposerSuggestion] {
        let query = trigger.query.lowercased()
        switch trigger.kind {
        case .command:
            var items: [ComposerSuggestion] = [
                ComposerSuggestion(id: "builtin:model", title: "/model", detail: "Switch response model for this thread", symbol: "command", action: .models),
            ]
            if store.conversation.thread != nil {
                items.append(ComposerSuggestion(id: "builtin:compact", title: "/compact", detail: "Compact the conversation context", symbol: "command", action: .compact))
            }
            for command in store.conversation.commands {
                let name = command.name.hasPrefix("/") ? String(command.name.dropFirst()) : command.name
                guard name != "model", name != "compact" || store.conversation.thread == nil else { continue }
                items.append(ComposerSuggestion(
                    id: "command:\(command.source):\(name)",
                    title: "/" + name,
                    detail: command.description,
                    symbol: command.source == "skill" ? "book" : "command",
                    action: .insert("/" + name + " ")
                ))
            }
            guard !query.isEmpty else { return items }
            let prefixed = items.filter { $0.title.dropFirst().lowercased().hasPrefix(query) }
            let contained = items.filter { !$0.title.dropFirst().lowercased().hasPrefix(query) && $0.title.lowercased().contains(query) }
            return prefixed + contained
        case .mention:
            guard let request = store.conversation.mentionRequest else { return [] }
            return (store.workspace.searchResults[request] ?? []).map { hit in
                let name = URL(fileURLWithPath: hit.relative).lastPathComponent
                return ComposerSuggestion(
                    id: "file:\(hit.relative)",
                    title: name.isEmpty ? hit.relative : name,
                    detail: hit.preview,
                    symbol: hit.relative.hasSuffix("/") ? "folder" : "doc",
                    action: .insert("@" + hit.relative + " ")
                )
            }
        }
    }

    private func emptyText(for trigger: ComposerTrigger) -> String {
        switch trigger.kind {
        case .command: store.conversation.commandsLoaded ? "No matching command." : "Loading commands…"
        case .mention:
            store.conversation.mentionRequest.flatMap { store.workspace.searchResults[$0] } == nil
                ? "Searching workspace files…" : "No matching files or folders."
        }
    }

    private func accept(_ suggestion: ComposerSuggestion, draft: ComposerDraft) {
        guard let trigger else { return }
        let text = draft.text as NSString
        let range = NSRange(location: trigger.start, length: min(trigger.end, text.length) - trigger.start)
        switch suggestion.action {
        case .insert(let value):
            draft.text = text.replacingCharacters(in: range, with: value)
        case .models:
            draft.text = text.replacingCharacters(in: range, with: "")
            showsModels = true
        case .compact:
            draft.text = text.replacingCharacters(in: range, with: "")
            store.conversation.compact()
        }
        self.trigger = nil
        store.conversation.clearMentions()
    }
}

struct PromptRecall {
    let index: Int
    let stash: String
    let text: String
}

struct ComposerTrigger: Equatable, Hashable {
    enum Kind: Hashable {
        case command
        case mention
    }

    let kind: Kind
    let query: String
    let start: Int
    let end: Int

    static func detect(in text: String, caret: Int, mentions: Bool) -> ComposerTrigger? {
        let string = text as NSString
        guard caret <= string.length else { return nil }
        var start = caret
        while start > 0 {
            let scalar = string.character(at: start - 1)
            if let unicode = Unicode.Scalar(scalar), CharacterSet.whitespacesAndNewlines.contains(unicode) {
                break
            }
            start -= 1
        }
        let token = string.substring(with: NSRange(location: start, length: caret - start))
        if token.hasPrefix("/"), start == 0 {
            return ComposerTrigger(kind: .command, query: String(token.dropFirst()), start: start, end: caret)
        }
        if mentions, token.hasPrefix("@") {
            return ComposerTrigger(kind: .mention, query: String(token.dropFirst()), start: start, end: caret)
        }
        return nil
    }
}

struct ComposerSuggestion: Identifiable {
    enum Action {
        case insert(String)
        case models
        case compact
    }

    let id: String
    let title: String
    let detail: String
    let symbol: String
    let action: Action
}

private struct SuggestionList: View {
    let suggestions: [ComposerSuggestion]
    let highlighted: Int
    let empty: String
    let accept: (ComposerSuggestion) -> Void

    var body: some View {
        if suggestions.isEmpty {
            Text(empty)
                .font(.system(size: 12.5))
                .foregroundStyle(Theme.secondaryText)
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(suggestions.enumerated()), id: \.element.id) { index, suggestion in
                            SuggestionRow(suggestion: suggestion, selected: index == highlighted) { accept(suggestion) }
                                .id(suggestion.id)
                        }
                    }
                    .padding(6)
                }
                .frame(maxHeight: min(CGFloat(suggestions.count) * 30 + 12, 228))
                .onChange(of: highlighted) { _, index in
                    guard suggestions.indices.contains(index) else { return }
                    proxy.scrollTo(suggestions[index].id)
                }
            }
        }
    }
}

private struct SuggestionRow: View {
    let suggestion: ComposerSuggestion
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: suggestion.symbol)
                    .font(.system(size: 12, weight: .light))
                    .foregroundStyle(Theme.secondaryText)
                    .frame(width: 16)
                Text(suggestion.title)
                    .font(.system(size: 13))
                    .lineLimit(1)
                Text(suggestion.detail)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(height: 30)
            .contentShape(Rectangle())
            .rowSurface(selected: selected, hovering: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct AttachmentStrip: View {
    let draft: ComposerDraft

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(draft.images) { image in
                    ZStack(alignment: .topTrailing) {
                        Group {
                            if let thumbnail = image.thumbnail {
                                Image(nsImage: thumbnail)
                                    .resizable()
                                    .scaledToFill()
                            } else {
                                Image(systemName: "photo")
                                    .foregroundStyle(Theme.secondaryText)
                            }
                        }
                        .frame(width: 52, height: 52)
                        .background(Theme.message)
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Theme.hairline))
                        RemoveBadge(title: "Remove image") {
                            draft.images.removeAll { $0.id == image.id }
                        }
                        .offset(x: 5, y: -5)
                    }
                    .padding(.top, 5)
                    .padding(.trailing, 5)
                }
                ForEach(draft.files, id: \.self) { file in
                    HStack(spacing: 6) {
                        Image(systemName: "doc")
                            .font(.system(size: 11.5, weight: .light))
                            .foregroundStyle(Theme.secondaryText)
                        Text(URL(fileURLWithPath: file).lastPathComponent)
                            .font(.system(size: 12))
                            .lineLimit(1)
                        Button {
                            draft.files.removeAll { $0 == file }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(Theme.secondaryText)
                        }
                        .buttonStyle(.plain)
                        .help("Remove file")
                    }
                    .padding(.horizontal, 9)
                    .frame(height: 26)
                    .background(Theme.message, in: Capsule())
                    .help(file)
                }
            }
        }
    }
}

private struct RemoveBadge: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(Color.primary)
                .frame(width: 18, height: 18)
                .background(Theme.card, in: Circle())
                .overlay(Circle().strokeBorder(Theme.input))
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
    }
}
