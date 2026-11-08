import Foundation
import LocalStudioKit

@MainActor
enum SmokeModel {
    static let key = ModelKey(provider: "anthropic", model: "claude-haiku-5-5")
    static let thinking = "low"
    static let label = "\(key.provider)/\(key.model) thinking \(thinking)"

    static func configured(_ conversation: ConversationStore) -> Bool {
        conversation.models.contains { $0.provider == key.provider && $0.id == key.model && $0.configured }
    }

    static func select(_ conversation: ConversationStore) -> Bool {
        guard conversation.modelsLoaded, configured(conversation) else { return false }
        conversation.newThread.model = key
        conversation.newThread.thinkingLevel = thinking
        return true
    }

    static func bash(_ command: String) -> String {
        "Use the bash tool to run exactly this command once: `\(command)`. Then reply with only the word done."
    }

    static func reply(_ items: [Item], after prompt: String) -> String? {
        guard let start = items.lastIndex(where: { if case .user(let text, _, _, _) = $0.kind { text.contains(prompt) } else { false } }) else { return nil }
        let text = items[items.index(after: start)...].compactMap { item -> String? in
            guard case .assistant(let blocks, false, _, _) = item.kind else { return nil }
            return blocks.compactMap { block in if case .text(let text) = block { text } else { nil } }.joined()
        }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    static func toolSucceeded(_ items: [Item], output mark: String) -> Bool {
        items.contains { item in
            if case .tool(_, _, _, _, _, .succeeded, let output, _, _, _) = item.kind { output.contains(mark) } else { false }
        }
    }
}
