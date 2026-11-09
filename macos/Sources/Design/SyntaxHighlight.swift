import LocalStudioKit
import SwiftUI

enum SyntaxStyle {
    static func attributed(_ segments: [CodeSegment]) -> AttributedString {
        var result = AttributedString()
        append(segments, to: &result)
        return result
    }

    static func append(_ segments: [CodeSegment], to result: inout AttributedString) {
        for segment in segments {
            var part = AttributedString(segment.text)
            part[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] = Theme.syntax(segment.kind)
            if segment.kind == .comment {
                part[AttributeScopes.FoundationAttributes.InlinePresentationIntentAttribute.self] = .emphasized
            }
            result.append(part)
        }
    }

    static func plain(_ text: String) -> AttributedString {
        var part = AttributedString(text)
        part[AttributeScopes.SwiftUIAttributes.ForegroundColorAttribute.self] = Theme.syntax(.plain)
        return part
    }

    static func line(_ text: String, _ segments: [CodeSegment]) -> AttributedString {
        if text.isEmpty { return AttributedString(" ") }
        return segments.isEmpty ? plain(text) : attributed(segments)
    }
}

struct HighlightKey: Hashable, Sendable {
    let text: String
    let language: String?
    let path: String?
}

struct CodeHighlight: Equatable {
    let text: String
    let segments: [CodeSegment]
}

@MainActor
final class SyntaxHighlighter {
    static let shared = SyntaxHighlighter()

    private static let capacity = 256
    private static let inlineLimit = 2_048

    private struct Entry {
        let segments: [CodeSegment]
        var revision: Int
        var attributed: AttributedString?
    }

    private var entries: [HighlightKey: Entry] = [:]
    private var order: [HighlightKey] = []
    private var inflight: [HighlightKey: Task<[CodeSegment], Never>] = [:]
    private var jobs = 0
    private var warmed = false
    private var warming: Task<Void, Never>?

    private init() {}

    var busy: Bool {
        !inflight.isEmpty || jobs > 0
    }

    func warm() {
        guard !warmed, warming == nil else { return }
        warming = Task {
            _ = await run { LocalStudioKit.highlight(code: "fn main() {}", language: "rust", path: nil) }
            warmed = true
        }
    }

    func contains(_ key: HighlightKey) -> Bool {
        entries[key] != nil
    }

    func rendered(_ key: HighlightKey, revision: Int) -> AttributedString? {
        if var entry = entries[key] {
            if entry.revision == revision, let attributed = entry.attributed { return attributed }
            let attributed = SyntaxStyle.attributed(entry.segments)
            entry.revision = revision
            entry.attributed = attributed
            entries[key] = entry
            return attributed
        }
        guard warmed, key.text.utf8.count <= Self.inlineLimit else { return nil }
        let attributed = SyntaxStyle.attributed(store(key, LocalStudioKit.highlight(code: key.text, language: key.language, path: key.path)))
        entries[key]?.revision = revision
        entries[key]?.attributed = attributed
        return attributed
    }

    func cachedSegments(_ key: HighlightKey) -> [CodeSegment]? {
        if let entry = entries[key] { return entry.segments }
        guard warmed, key.text.utf8.count <= Self.inlineLimit else { return nil }
        return store(key, LocalStudioKit.highlight(code: key.text, language: key.language, path: key.path))
    }

    func segments(_ key: HighlightKey) async -> [CodeSegment] {
        if let entry = entries[key] { return entry.segments }
        if let task = inflight[key] { return await task.value }
        let task = Task.detached(priority: .userInitiated) {
            LocalStudioKit.highlight(code: key.text, language: key.language, path: key.path)
        }
        inflight[key] = task
        let segments = await task.value
        inflight[key] = nil
        warmed = true
        return store(key, segments)
    }

    func lines(_ lines: [String], language: String?, path: String?) async -> [[CodeSegment]] {
        await run { highlightLines(lines: lines, language: language, path: path) }
    }

    func run<Value: Sendable>(_ work: @escaping @Sendable () -> Value) async -> Value {
        jobs += 1
        let value = await Task.detached(priority: .userInitiated, operation: work).value
        jobs -= 1
        warmed = true
        return value
    }

    @discardableResult
    private func store(_ key: HighlightKey, _ segments: [CodeSegment]) -> [CodeSegment] {
        if entries[key] == nil {
            order.append(key)
            if order.count > Self.capacity {
                let overflow = order.count - Self.capacity
                for old in order.prefix(overflow) { entries[old] = nil }
                order.removeFirst(overflow)
            }
        }
        entries[key] = Entry(segments: segments, revision: -1, attributed: nil)
        return segments
    }
}
