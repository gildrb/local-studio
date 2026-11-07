import AppKit
import SwiftUI

struct EditorApp: Identifiable, Equatable {
    let id: String
    let name: String
    let url: URL

    var icon: NSImage {
        let image = NSWorkspace.shared.icon(forFile: url.path)
        image.size = NSSize(width: 16, height: 16)
        return image
    }
}

@MainActor
enum EditorLauncher {
    static let favoriteKey = "favoriteEditor"

    private static let candidates: [(String, String)] = [
        ("com.apple.dt.Xcode", "Xcode"),
        ("com.microsoft.VSCode", "VS Code"),
        ("com.todesktop.230313mzl4w4u92", "Cursor"),
        ("dev.zed.Zed", "Zed"),
        ("com.apple.finder", "Finder"),
        ("com.apple.Terminal", "Terminal"),
        ("com.mitchellh.ghostty", "Ghostty"),
        ("com.googlecode.iterm2", "iTerm"),
    ]

    static let installed: [EditorApp] = candidates.compactMap { bundle, name in
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle).map { EditorApp(id: bundle, name: name, url: $0) }
    }

    static func favorite(_ stored: String) -> EditorApp? {
        installed.first { $0.id == stored } ?? installed.first
    }

    static func open(_ path: String, with app: EditorApp) {
        let target = URL(fileURLWithPath: path, isDirectory: true)
        NSWorkspace.shared.open([target], withApplicationAt: app.url, configuration: NSWorkspace.OpenConfiguration())
    }

    static func openFavorite(_ path: String?) {
        guard let path, let app = favorite(UserDefaults.standard.string(forKey: favoriteKey) ?? "") else { return }
        open(path, with: app)
    }
}

struct OpenInEditorButton: View {
    let path: String?
    @AppStorage(EditorLauncher.favoriteKey) private var favoriteID = ""

    var body: some View {
        let favorite = EditorLauncher.favorite(favoriteID)
        Menu {
            if EditorLauncher.installed.isEmpty {
                Text("No installed editors found")
            }
            ForEach(EditorLauncher.installed) { app in
                Button {
                    favoriteID = app.id
                    open(with: app)
                } label: {
                    Label {
                        Text("Open in \(app.name)")
                    } icon: {
                        Image(nsImage: app.icon).accessibilityHidden(true)
                    }
                }
            }
        } label: {
            HStack(spacing: 5) {
                if let favorite {
                    Image(nsImage: favorite.icon).accessibilityHidden(true)
                }
                Text("Open")
            }
        } primaryAction: {
            if let favorite {
                open(with: favorite)
            }
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .fixedSize()
        .disabled(path == nil)
        .help(favorite.map { "Open in \($0.name)" } ?? "Open in editor")
        .accessibilityLabel(favorite.map { "Open in \($0.name)" } ?? "Open in editor")
    }

    private func open(with app: EditorApp) {
        guard let path else { return }
        EditorLauncher.open(path, with: app)
    }
}
