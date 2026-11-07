import Foundation
import Observation

struct StashedPrompt: Identifiable, Equatable, Codable {
    var id = UUID()
    var text: String
    var files: [String]
    var contexts: [ComposerContext]
    var created = Date()

    var title: String {
        let line = text.split(whereSeparator: \.isNewline).first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        if !line.isEmpty {
            return line
        }
        return contexts.first?.title ?? files.first ?? "Empty prompt"
    }
}

@MainActor
@Observable
final class ComposerStash {
    private(set) var prompts: [String: [StashedPrompt]] = [:]
    @ObservationIgnored private let file: URL?

    init(file: URL? = ComposerStash.defaultFile) {
        self.file = file
        guard let file, let data = try? Data(contentsOf: file),
              let stored = try? JSONDecoder().decode([String: [StashedPrompt]].self, from: data) else { return }
        prompts = stored
    }

    static var defaultFile: URL? {
        guard !CommandLine.arguments.contains("+snapshot") else { return nil }
        return StudioPaths.dataDirectory.appending(path: "composer-stash.json")
    }

    func list(_ project: String) -> [StashedPrompt] {
        prompts[project] ?? []
    }

    func park(_ prompt: StashedPrompt, project: String) {
        prompts[project, default: []].insert(prompt, at: 0)
        save()
    }

    func remove(_ id: UUID, project: String) {
        prompts[project]?.removeAll { $0.id == id }
        if prompts[project]?.isEmpty == true {
            prompts[project] = nil
        }
        save()
    }

    func clear(project: String) {
        prompts[project] = nil
        save()
    }

    private func save() {
        guard let file else { return }
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(prompts).write(to: file, options: .atomic)
        } catch {
            return
        }
    }
}
