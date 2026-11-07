import AppKit
import LocalStudioKit
import SwiftUI

struct ComposerTrigger: Equatable, Hashable {
    enum Kind: Hashable {
        case command
        case mention
        case skill
        case pullRequest
    }

    let kind: Kind
    let query: String
    let start: Int
    let end: Int

    static func detect(in text: String, caret: Int, project: Bool) -> ComposerTrigger? {
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
        let query = String(token.dropFirst())
        if token.hasPrefix("/"), start == 0 {
            return ComposerTrigger(kind: .command, query: query, start: start, end: caret)
        }
        if token.hasPrefix("$") {
            return ComposerTrigger(kind: .skill, query: query, start: start, end: caret)
        }
        if project, token.hasPrefix("@") {
            return ComposerTrigger(kind: .mention, query: query, start: start, end: caret)
        }
        if project, token.hasPrefix("#") {
            return ComposerTrigger(kind: .pullRequest, query: query, start: start, end: caret)
        }
        return nil
    }
}

struct ComposerSuggestion: Identifiable {
    enum Action {
        case insert(String)
        case models
        case compact
        case pullRequest(PullRequest)
    }

    let id: String
    let title: String
    let detail: String
    let symbol: String
    var badge: String?
    let action: Action
}

@MainActor
struct ComposerSuggestionSource {
    let store: StudioStore

    func items(for trigger: ComposerTrigger) -> [ComposerSuggestion] {
        let query = trigger.query.lowercased()
        let conversation = store.conversation
        switch trigger.kind {
        case .command:
            var items = [
                ComposerSuggestion(id: "builtin:model", title: "/model", detail: "Switch response model for this thread", symbol: "command", badge: "Built-in", action: .models),
            ]
            if conversation.thread != nil {
                items.append(ComposerSuggestion(id: "builtin:compact", title: "/compact", detail: "Compact the conversation context", symbol: "command", badge: "Built-in", action: .compact))
            }
            let showsSkills = store.pages.settings?.showSkillsInSlashMenu ?? true
            for command in conversation.commands where showsSkills || command.kind != .skill {
                let name = Self.bare(command.name)
                guard name != "model", name != "compact" || conversation.thread == nil else { continue }
                items.append(ComposerSuggestion(
                    id: "command:\(command.source):\(name)",
                    title: "/" + name,
                    detail: command.description,
                    symbol: command.kind == .skill ? "book" : command.kind == .template ? "text.alignleft" : "command",
                    badge: Self.kind(command.kind),
                    action: .insert("/" + name + " ")
                ))
            }
            return Self.ranked(items, query: query) { String($0.title.dropFirst()) }
        case .skill:
            let items = conversation.skills.map { skill in
                ComposerSuggestion(
                    id: "skill:\(skill.path)", title: "$" + skill.name, detail: skill.description, symbol: "book",
                    badge: Self.source(skill.source), action: .insert("$" + skill.name + " ")
                )
            }
            return Self.ranked(items, query: query) { String($0.title.dropFirst()) }
        case .mention:
            guard let request = conversation.mentionRequest else { return [] }
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
        case .pullRequest:
            let pulls = conversation.pullsRequest.flatMap { store.workspace.pullRequests[$0] } ?? []
            let matching = pulls.filter { pull in
                query.isEmpty || String(pull.number).hasPrefix(query) || pull.title.lowercased().contains(query)
            }
            return matching.prefix(30).map { pull in
                ComposerSuggestion(
                    id: "pull:\(pull.number)", title: "#\(pull.number)", detail: pull.title,
                    symbol: "arrow.triangle.pull", badge: pull.state.capitalized, action: .pullRequest(pull)
                )
            }
        }
    }

    func emptyText(for trigger: ComposerTrigger) -> String {
        let conversation = store.conversation
        switch trigger.kind {
        case .command:
            return conversation.commandsLoaded ? "No matching command." : "Loading commands…"
        case .skill:
            return conversation.skillsLoaded ? "No matching skill." : "Loading skills…"
        case .mention:
            return conversation.mentionRequest.flatMap { store.workspace.searchResults[$0] } == nil
                ? "Searching workspace files…" : "No matching files or folders."
        case .pullRequest:
            if let error = conversation.pullsError {
                return "Couldn’t load pull requests: \(error)"
            }
            return conversation.pullsRequest.flatMap { store.workspace.pullRequests[$0] } == nil
                ? "Loading pull requests…" : "No matching pull requests."
        }
    }

    private static func bare(_ name: String) -> String {
        name.hasPrefix("/") ? String(name.dropFirst()) : name
    }

    private static func kind(_ kind: CommandKind) -> String {
        switch kind {
        case .command: "Command"
        case .template: "Template"
        case .skill: "Skill"
        }
    }

    private static func source(_ source: SkillSource) -> String {
        switch source {
        case .app: "App"
        case .repo: "Repo"
        case .project: "Project"
        case .personal: "Personal"
        case .system: "System"
        }
    }

    private static func ranked(_ items: [ComposerSuggestion], query: String, key: (ComposerSuggestion) -> String) -> [ComposerSuggestion] {
        guard !query.isEmpty else { return items }
        let prefixed = items.filter { key($0).lowercased().hasPrefix(query) }
        let contained = items.filter { !key($0).lowercased().hasPrefix(query) && key($0).lowercased().contains(query) }
        return prefixed + contained
    }
}

struct SuggestionList: View {
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
                    .accessibilityHidden(true)
                Text(suggestion.title)
                    .font(.system(size: 13))
                    .lineLimit(1)
                Text(suggestion.detail)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                if let badge = suggestion.badge {
                    Text(badge)
                        .font(.system(size: 10.5))
                        .foregroundStyle(Theme.secondaryText)
                        .padding(.horizontal, 6)
                        .frame(height: 17)
                        .background(Theme.hover, in: Capsule())
                        .overlay(Capsule().strokeBorder(Theme.hairline))
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 30)
            .contentShape(Rectangle())
            .rowSurface(selected: selected, hovering: hovering)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(suggestion.badge.map { "\(suggestion.title), \(suggestion.detail), \($0)" } ?? "\(suggestion.title), \(suggestion.detail)")
    }
}
