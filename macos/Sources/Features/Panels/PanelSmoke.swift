import AppKit
import Combine
import Foundation
import LocalStudioKit
import SwiftUI

@MainActor
final class PanelSmoke {
    private enum Phase: String {
        case connecting
        case project
        case checking
        case finished
    }

    private let store: StudioStore
    private let output: URL
    private var phase = Phase.connecting
    private var subscription: AnyCancellable?
    private var repository = ""
    private var diff: DiffModel?
    private var files: FilesModel?
    private var preview: FilePreviewModel?
    private var session: TerminalSession?
    private var passed: Set<String> = []

    init(store: StudioStore, output: URL) {
        self.store = store
        self.output = output
    }

    func start() {
        subscription = store.didTick.sink { [weak self] in self?.advance() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in
            guard let self, phase != .finished else { return }
            finish(passed: false, "timed out while \(phase.rawValue); passed \(passed.sorted())")
        }
    }

    private func advance() {
        switch phase {
        case .connecting:
            guard store.connection == .ready else { return }
            do {
                repository = try Self.makeRepository()
            } catch {
                finish(passed: false, "could not create the git fixture: \(error.localizedDescription)")
                return
            }
            phase = .project
            store.inbox.addProject(path: repository)
        case .project:
            guard store.inbox.projects.contains(where: { $0.id == repository }) else { return }
            phase = .checking
            open()
        case .checking:
            check()
        case .finished:
            return
        }
    }

    private func open() {
        let workspace = store.workspace
        let panels = workspace.panels
        panels.focus(nil)
        store.inbox.selectProject(repository)
        let diff = DiffModel(project: repository, thread: nil, workspace: workspace, settings: panels.settings)
        diff.load()
        self.diff = diff
        let files = FilesModel(project: repository, workspace: workspace, panels: panels)
        files.load("")
        self.files = files
        let preview = FilePreviewModel(project: repository, relative: "notes.txt", line: 3, workspace: workspace)
        preview.load()
        self.preview = preview
        panels.terminalOpen = true
        session = panels.decks[repository]?.activeGroup?.sessions.first
        session?.write(Data("echo hi-from-panels\r".utf8))
    }

    private func check() {
        if case .failed(let message) = diff?.phase {
            return finish(passed: false, "diff failed: \(message)")
        }
        if case .failed(let message) = preview?.phase {
            return finish(passed: false, "read_file failed: \(message)")
        }
        if let failure = files?.failure {
            return finish(passed: false, "list_directory failed: \(failure)")
        }
        if case .failed(let message) = session?.status {
            return finish(passed: false, "terminal failed: \(message)")
        }
        if !passed.contains("diff"), let diff, diff.phase == .loaded {
            if let problem = Self.verify(diff) {
                return finish(passed: false, problem)
            }
            passed.insert("diff")
            print("ok diff: \(diff.files.map(\.path)) with correct line numbers")
        }
        if !passed.contains("files"), let files, let root = files.children[""] {
            let names = Set(root.map(\.name))
            guard names.isSuperset(of: ["notes.txt", "added.txt"]) else {
                return finish(passed: false, "list_directory returned \(names.sorted())")
            }
            passed.insert("files")
            print("ok files: \(names.sorted())")
        }
        if !passed.contains("preview"), let preview, preview.phase == .loaded {
            guard preview.lines.count == 10, preview.lines[2] == "line 3 changed" else {
                return finish(passed: false, "read_file returned \(preview.lines.count) lines")
            }
            passed.insert("preview")
            print("ok read_file: \(preview.lines.count) lines")
        }
        if !passed.contains("terminal"), let session, session.text.contains("\r\nhi-from-panels\r\n") || session.text.contains("\nhi-from-panels\r\n") {
            passed.insert("terminal")
            print("ok terminal \(session.terminal ?? "?"): \(session.buffer.count) bytes, echo output seen")
        }
        guard passed.count == 4, let diff else { return }
        diff.setAllCollapsed(false)
        if let problem = render(diff) {
            return finish(passed: false, problem)
        }
        session?.close()
        finish(passed: true, "diff, files, read_file and terminal round-trips; diff snapshot \(output.path)")
    }

    private static func verify(_ diff: DiffModel) -> String? {
        guard let notes = diff.files.first(where: { $0.path == "notes.txt" }) else {
            return "diff missing notes.txt: \(diff.files.map(\.path))"
        }
        guard notes.additions == 2, notes.deletions == 2, notes.hunks.count == 1 else {
            return "notes.txt stats +\(notes.additions) -\(notes.deletions) hunks \(notes.hunks.count)"
        }
        let lines = notes.hunks[0].lines
        let removed = lines.filter { $0.kind == .removed }.compactMap(\.oldLine)
        let added = lines.filter { $0.kind == .added }.compactMap(\.newLine)
        guard removed == [3, 8], added == [3, 8] else {
            return "notes.txt removed \(removed) added \(added)"
        }
        guard let context = lines.first(where: { $0.text == "line 5" }), context.oldLine == 5, context.newLine == 5 else {
            return "notes.txt context numbering wrong"
        }
        guard let added = diff.files.first(where: { $0.path == "added.txt" }), added.status == "added",
              added.hunks.first?.lines.compactMap(\.newLine) == [1, 2] else {
            return "added.txt missing or misnumbered"
        }
        guard !diff.sections.isEmpty else { return "diff rows were not built" }
        return nil
    }

    private func render(_ diff: DiffModel) -> String? {
        let frame = NSRect(x: 0, y: 0, width: 520, height: 560)
        let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .darkAqua)
        let host = NSHostingView(rootView: DiffSurfaceView(model: diff, panels: store.workspace.panels)
            .frame(width: frame.width, height: frame.height)
            .background(Theme.canvas)
            .environment(\.colorScheme, .dark))
        host.frame = frame
        window.contentView = host
        for _ in 0..<4 {
            host.layoutSubtreeIfNeeded()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
        }
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return "no bitmap for the diff view" }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        window.close()
        guard let data = bitmap.representation(using: .png, properties: [:]) else { return "PNG encoding failed" }
        do {
            try data.write(to: output)
        } catch {
            return error.localizedDescription
        }
        return nil
    }

    private static func makeRepository() throws -> String {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("ls-panels-\(UUID().uuidString.prefix(8))")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let notes = root.appendingPathComponent("notes.txt")
        let original = (1...10).map { "line \($0)" }
        try (original.joined(separator: "\n") + "\n").write(to: notes, atomically: true, encoding: .utf8)
        try git(root, ["init", "-q", "-b", "main"])
        try git(root, ["add", "-A"])
        try git(root, ["-c", "user.name=Local Studio", "-c", "user.email=smoke@localstudio.invalid", "commit", "-q", "-m", "fixture"])
        var changed = original
        changed[2] = "line 3 changed"
        changed[7] = "line 8 changed"
        try (changed.joined(separator: "\n") + "\n").write(to: notes, atomically: true, encoding: .utf8)
        try "first\nsecond\n".write(to: root.appendingPathComponent("added.txt"), atomically: true, encoding: .utf8)
        guard let resolved = realpath(root.path, nil) else { return root.path }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    private static func git(_ directory: URL, _ arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = arguments
        process.currentDirectoryURL = directory
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw CocoaError(.executableLoad, userInfo: [NSLocalizedDescriptionKey: "git \(arguments.joined(separator: " ")) exited \(process.terminationStatus)"])
        }
    }

    private func finish(passed: Bool, _ detail: String) {
        phase = .finished
        subscription = nil
        print(passed ? "PASS panels smoke: \(detail)" : "FAIL panels smoke: \(detail)")
        if passed {
            NSApp.terminate(nil)
        } else {
            store.stop()
            exit(1)
        }
    }
}
