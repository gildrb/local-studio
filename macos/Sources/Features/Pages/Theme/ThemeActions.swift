import AppKit
import Foundation
import UniformTypeIdentifiers

extension PagesStore {
    func selectTheme(_ id: String) {
        update { $0.theme = id == ThemeLibrary.defaultId ? nil : id }
    }

    func installTheme(_ theme: ThemeDefinition, select: Bool) {
        var list = ThemeStore.shared.custom
        if let index = list.firstIndex(where: { $0.id == theme.id }) {
            list[index] = theme
        } else {
            list.append(theme)
        }
        let json = ThemeLibrary.encodeCustom(list)
        update {
            $0.customThemes = json
            if select { $0.theme = theme.id }
        }
    }

    func removeTheme(_ id: String) {
        let json = ThemeLibrary.encodeCustom(ThemeStore.shared.custom.filter { $0.id != id })
        update {
            $0.customThemes = json
            if $0.theme == id { $0.theme = nil }
        }
    }

    func importTheme() -> String? {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = true
        panel.prompt = "Import"
        panel.message = "Choose a Local Studio theme file or a VS Code color theme (*-color-theme.json)."
        guard panel.runModal() == .OK else { return nil }
        var failures: [String] = []
        var taken = Set(ThemeStore.shared.themes.map(\.id))
        var last: ThemeDefinition?
        for url in panel.urls {
            do {
                let theme = try ThemeImport.load(try Data(contentsOf: url), taken: taken)
                taken.insert(theme.id)
                installTheme(theme, select: false)
                last = theme
            } catch {
                failures.append("\(url.lastPathComponent): \(error.localizedDescription)")
            }
        }
        if let last { selectTheme(last.id) }
        return failures.isEmpty ? nil : failures.joined(separator: "\n")
    }

    func exportTheme(_ theme: ThemeDefinition) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.nameFieldStringValue = "\(theme.id).json"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(theme.file()) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
