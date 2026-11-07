import AppKit
import LocalStudioKit
import SwiftUI

struct SnapshotEntry {
    let name: String
    let size: CGSize
    var focus: String?
    let updates: [Update]
    let view: @MainActor (StudioStore) -> AnyView
}

enum SnapshotCatalog {
    @MainActor static var all: [SnapshotEntry] {
        shell + conversation + panels + pages
    }
}

@MainActor
enum Snapshots {
    static func run(into directory: URL, matching filter: String?) -> Int32 {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            print("FAIL snapshots: \(error.localizedDescription)")
            return 1
        }
        var written = 0
        for entry in SnapshotCatalog.all where filter.map({ entry.name.contains($0) }) ?? true {
            for (suffix, name) in [("dark", NSAppearance.Name.darkAqua), ("light", NSAppearance.Name.aqua)] {
                guard let appearance = NSAppearance(named: name) else { continue }
                let url = directory.appendingPathComponent("\(entry.name)-\(suffix).png")
                var failure: String?
                appearance.performAsCurrentDrawingAppearance {
                    failure = render(entry, scheme: suffix == "dark" ? .dark : .light, to: url)
                }
                if let failure {
                    print("FAIL snapshot \(entry.name)-\(suffix): \(failure)")
                    return 1
                }
                written += 1
                print("snapshot \(url.path)")
            }
        }
        print("PASS snapshots: \(written) images")
        return 0
    }

    private static func render(_ entry: SnapshotEntry, scheme: SwiftUI.ColorScheme, to url: URL) -> String? {
        let store = StudioStore(launch: nil)
        if let focus = entry.focus {
            store.select(focus)
        }
        store.receive(entry.updates)
        let frame = NSRect(origin: .zero, size: entry.size)
        let style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
        let window = NSWindow(contentRect: frame, styleMask: style, backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        let host = NSHostingView(rootView: entry.view(store)
            .frame(width: entry.size.width, height: entry.size.height)
            .background(Theme.canvas))
        host.frame = frame
        window.contentView = host
        for _ in 0..<4 {
            host.layoutSubtreeIfNeeded()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
        }
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return "no bitmap for the view" }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        window.close()
        guard let data = bitmap.representation(using: .png, properties: [:]) else { return "PNG encoding failed" }
        do {
            try data.write(to: url)
        } catch {
            return error.localizedDescription
        }
        return nil
    }
}
