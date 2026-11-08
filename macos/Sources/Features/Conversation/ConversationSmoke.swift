import AppKit
import Combine
import Foundation
import LocalStudioKit

@MainActor
final class ConversationSmoke {
    private enum Phase: String {
        case connecting
        case project
        case opening
        case approval
        case queued
        case cancelled
        case steering
        case approved
        case settled
        case image
        case editing
        case fanOut
        case setupProject
        case setup
        case finished
    }

    private let store: StudioStore
    private var phase = Phase.connecting
    private var subscription: AnyCancellable?
    private var thread: String?
    private var anchor: String?
    private var imageRequest: String?
    private var before: Set<String> = []
    private var repository: String?

    private static let prompt = SmokeModel.bash("echo smoke-ok > smoke.txt && cat smoke.txt")
    private static let followUp = "Reply with only the word queued."
    private static let cancelled = "cancel me"

    init(store: StudioStore) {
        self.store = store
    }

    func start() {
        subscription = store.didTick.sink { [weak self] in self?.advance() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 180) { [weak self] in
            guard let self, phase != .finished else { return }
            finish(passed: false, "timed out while \(phase.rawValue)")
        }
    }

    private func advance() {
        let conversation = store.conversation
        switch phase {
        case .connecting:
            guard store.connection == .ready else { return }
            move(to: .project, "connected")
            store.inbox.addProject(path: ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory())
            conversation.loadModels()
            conversation.loadCommands(project: nil)
        case .project:
            guard let project = store.inbox.currentProject, !store.inbox.projects.isEmpty, conversation.modelsLoaded else { return }
            guard !conversation.providerUnavailable, SmokeModel.select(conversation), let model = conversation.currentModel(settings: store.pages.settings),
                  model.provider == SmokeModel.key.provider, model.id == SmokeModel.key.model else {
                finish(passed: false, "\(SmokeModel.label) is not a configured model among \(conversation.models.count) models")
                return
            }
            if let failure = composerChecks(project: project) {
                finish(passed: false, failure)
                return
            }
            conversation.newThread.access = .supervised
            conversation.composer(project: project).text = Self.prompt
            conversation.composer(project: project).attach(image: Self.png, mimeType: "image/png")
            conversation.submit(project: project, alternate: false, settings: store.pages.settings)
            move(to: .opening, "composer started a supervised thread in \(project) on the real model \(SmokeModel.label)")
        case .opening:
            guard let thread = conversation.thread else { return }
            self.thread = thread
            move(to: .approval, "thread \(thread) focused")
        case .approval:
            guard let approval = conversation.approvals.first, conversation.busy else { return }
            print("     approval \(approval.command) \(approval.effects)")
            for text in [Self.followUp, Self.cancelled] {
                conversation.composer(project: nil).text = text
                conversation.submit(project: nil, alternate: false, settings: nil)
            }
            move(to: .queued, "approval card pending while the turn runs; queued two follow-ups")
        case .queued:
            guard conversation.queued.count == 2, let cancel = conversation.queued.first(where: { $0.text == Self.cancelled }) else { return }
            conversation.cancelQueued(cancel)
            move(to: .cancelled, "queue shows both messages; cancelled one")
        case .cancelled:
            guard conversation.queued.count == 1, conversation.composer(project: nil).text == Self.cancelled,
                  conversation.queued.first?.text == Self.followUp else { return }
            let binding = store.pages.keybindings.first { $0.command == "thread.steerQueuedMessage" }?.shortcut ?? "unbound"
            guard conversation.steerQueuedMessage() else {
                finish(passed: false, "⌘⇧Enter found no queued message to steer")
                return
            }
            conversation.composer(project: nil).text = ""
            move(to: .steering, "cancelled message returned to the composer; thread.steerQueuedMessage (\(binding)) steered the other")
        case .steering:
            guard conversation.queued.allSatisfy({ $0.steering || $0.sending }), let approval = conversation.approvals.first else { return }
            conversation.answer(approval, .approve)
            move(to: .approved, "queued message moved to steering; approved the command")
        case .approved:
            guard conversation.approvals.isEmpty else { return }
            move(to: .settled, "approval cleared")
        case .settled:
            let items = conversation.items
            guard let info = conversation.info, !info.busy, conversation.queued.isEmpty,
                  let last = items.last, case .assistant(_, false, _, _) = last.kind,
                  SmokeModel.reply(items, after: Self.followUp) != nil, SmokeModel.toolSucceeded(items, output: "smoke-ok") else { return }
            guard let anchor = items.lazy.compactMap({ item -> String? in
                if case .user(Self.prompt, _, let entry, _) = item.kind { entry } else { nil }
            }).first else { return }
            for item in items {
                print("     item \(item.id) turn \(item.turn) \(item.kind)".prefix(400))
            }
            let users = items.compactMap { item -> String? in if case .user(let text, _, _, _) = item.kind { text } else { nil } }
            let promptAt = users.firstIndex { $0.contains(Self.prompt) }
            let followUpAt = users.firstIndex { $0.contains(Self.followUp) }
            guard let promptAt, let followUpAt, promptAt < followUpAt, !users.contains(where: { $0.contains(Self.cancelled) }) else {
                finish(passed: false, "the transcript order of the prompt and the queued follow-up is wrong: \(users)")
                return
            }
            let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
            let written = (try? String(contentsOfFile: (home as NSString).appendingPathComponent("smoke.txt"), encoding: .utf8)) ?? ""
            guard written.trimmingCharacters(in: .whitespacesAndNewlines) == "smoke-ok" else {
                finish(passed: false, "the approved bash call did not write smoke.txt (found “\(written)”)")
                return
            }
            print("     \(conversation.rows.count) timeline rows for \(items.count) items")
            let thumbnails = items.lazy.compactMap { item -> [ImageThumbnail]? in
                if case .user(Self.prompt, _, _, let thumbnails) = item.kind { thumbnails } else { nil }
            }.first ?? []
            guard let thumbnail = thumbnails.first else {
                finish(passed: false, "the attached image has no thumbnail in the transcript")
                return
            }
            self.anchor = anchor
            imageRequest = conversation.loadMessageImage(entry: anchor, index: 0)
            move(to: .image, "follow-up from the queue landed; the attached image shows a \(thumbnail.width)×\(thumbnail.height) thumbnail")
        case .image:
            guard let imageRequest else { return }
            if let error = conversation.messageImageErrors[imageRequest] {
                finish(passed: false, "loadMessageImage failed: \(error)")
                return
            }
            guard let image = conversation.messageImages[imageRequest], let anchor else { return }
            conversation.composer(project: nil).text = ""
            conversation.editFromHere(entry: anchor)
            move(to: .editing, "loadMessageImage returned the full \(image.mimeType) (\(image.data.count) bytes); editing from the first prompt")
        case .editing:
            let rewound = !conversation.items.contains { if case .user(Self.followUp, _, _, _) = $0.kind { true } else { false } }
            guard let thread, rewound, conversation.composer(project: nil).text == Self.prompt, conversation.thread == thread else { return }
            print("ok   edit from here filled the composer with the first prompt")
            startFanOut()
        case .fanOut:
            let started = store.inbox.threads.filter { !before.contains($0.id) }
            if let failed = started.first(where: { $0.status == .failed }) {
                finish(passed: false, "fan-out thread \(failed.id) failed")
                return
            }
            guard started.count >= 2, started.allSatisfy({ $0.status == .done || $0.status == .idle }) else { return }
            move(to: .setupProject, "fan-out over \(SmokeModel.label) ×2 answered in \(started.count) threads")
            guard let repository = Self.makeRepository() else {
                finish(passed: true, "git is unavailable; worktree setup cancel skipped")
                return
            }
            self.repository = URL(fileURLWithPath: repository).resolvingSymlinksInPath().path
            store.select(nil)
            store.inbox.addProject(path: repository)
        case .setupProject:
            guard let project = repositoryProject() else { return }
            if conversation.thread != nil {
                store.select(nil)
            }
            store.inbox.selectProject(project)
            conversation.newThread.chooseWorkspace(worktree: true)
            conversation.composer(project: project).text = "work in a worktree"
            conversation.submit(project: project, alternate: false, settings: store.pages.settings)
            move(to: .setup, "started a draft in a new worktree of \(project)")
        case .setup:
            guard let draft = conversation.pendingDraft else {
                finish(passed: true, "the worktree was ready before Cancel could run; setup cancel not exercised")
                return
            }
            if let notice = store.notice, notice.level == .error {
                finish(passed: false, "starting the worktree draft failed: \(notice.text)")
                return
            }
            guard conversation.worktreeSetup[draft] != nil, let project = repositoryProject() else { return }
            conversation.cancelWorktreeSetup()
            guard conversation.pendingDraft == nil, conversation.composer(project: project).text == "work in a worktree" else {
                finish(passed: false, "cancelling the worktree setup did not return the prompt to the composer")
                return
            }
            finish(passed: true, "cancelWorktreeSetup(\(draft)) stopped the setup and returned the prompt to the composer")
        case .finished:
            return
        }
    }

    private func repositoryProject() -> String? {
        guard let repository else { return nil }
        let canonical = { (path: String) in URL(fileURLWithPath: path).resolvingSymlinksInPath().path }
        return store.inbox.projects.first { canonical($0.id) == repository || canonical($0.path) == repository }?.id
    }

    private func startFanOut() {
        let conversation = store.conversation
        let key = SmokeModel.key
        before = Set(store.inbox.threads.map(\.id))
        store.select(nil)
        store.inbox.selectProject(nil)
        conversation.newThread.multiModel = true
        conversation.newThread.fanOut = [key, key]
        conversation.composer(project: nil).text = "Reply with only the word fan."
        conversation.submit(project: nil, alternate: false, settings: store.pages.settings)
        move(to: .fanOut, "startThreads over \(key.provider)/\(key.model) ×2")
    }

    private static func makeRepository() -> String? {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let path = (home as NSString).appendingPathComponent("repo")
        try? FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
        let steps = [["init", "-q"], ["-c", "user.name=Smoke", "-c", "user.email=smoke@local", "commit", "-q", "--allow-empty", "-m", "init"]]
        for arguments in steps {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            process.arguments = arguments
            process.currentDirectoryURL = URL(fileURLWithPath: path)
            guard (try? process.run()) != nil else { return nil }
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
        }
        return path
    }

    private static var png: Data {
        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: 16, pixelsHigh: 12, bitsPerSample: 8, samplesPerPixel: 4,
            hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        )
        bitmap?.setColor(.systemBlue, atX: 0, y: 0)
        return bitmap?.representation(using: .png, properties: [:]) ?? Data()
    }

    private func composerChecks(project: String) -> String? {
        let conversation = store.conversation
        let draft = conversation.composer(project: project)
        draft.text = "stash me"
        let key = conversation.stashKey(project: project)
        guard conversation.stashPrompt(project: project), draft.isEmpty, let parked = conversation.stash.list(key).first, parked.text == "stash me" else {
            return "⌘S did not park the draft"
        }
        conversation.restoreStash(parked, project: project)
        guard draft.text == "stash me", conversation.stash.list(key).isEmpty else { return "restoring the stash did not refill the composer" }
        draft.clear()
        print("ok   ⌘S parked the draft and the stash menu restored it")
        let kinds: [(String, Bool, ComposerTrigger.Kind?)] = [
            ("/mo", true, .command), ("$sk", true, .skill), ("@src", true, .mention), ("#12", true, .pullRequest),
            ("#12", false, nil), ("say /mo", true, nil), ("$", false, .skill),
        ]
        for (text, hasProject, expected) in kinds {
            let found = ComposerTrigger.detect(in: text, caret: (text as NSString).length, project: hasProject)?.kind
            guard found == expected else { return "trigger for “\(text)” was \(String(describing: found))" }
        }
        let commands = ComposerSuggestionSource(store: store).items(for: ComposerTrigger(kind: .command, query: "mo", start: 0, end: 3))
        guard commands.first?.title == "/model", commands.first?.badge == "Built-in" else { return "the / menu lost /model" }
        let skills = ComposerSuggestionSource(store: store).items(for: ComposerTrigger(kind: .skill, query: "", start: 0, end: 1))
        print("ok   triggers / $ @ # detected; / menu \(commands.count) items, $ menu \(skills.count) skills (\(conversation.commands.count) commands loaded)")
        struct Case {
            let shift: Bool
            let command: Bool
            let running: Bool
            let shortcut: SendShortcut
            let text: String
            let expected: SubmitIntent?
        }
        let cases = [
            Case(shift: false, command: false, running: false, shortcut: .enter, text: "a", expected: .send),
            Case(shift: true, command: false, running: false, shortcut: .enter, text: "a", expected: nil),
            Case(shift: false, command: true, running: true, shortcut: .enter, text: "a", expected: .alternate),
            Case(shift: false, command: false, running: false, shortcut: .modEnter, text: "a", expected: nil),
            Case(shift: false, command: true, running: false, shortcut: .modEnter, text: "a", expected: .send),
            Case(shift: false, command: false, running: false, shortcut: .modEnterMultiline, text: "a\nb", expected: nil),
            Case(shift: false, command: false, running: false, shortcut: .modEnterMultiline, text: "a", expected: .send),
            Case(shift: true, command: true, running: true, shortcut: .modEnter, text: "a", expected: .alternate),
        ]
        for check in cases {
            let intent = SubmitIntent.resolve(shift: check.shift, command: check.command, running: check.running, shortcut: check.shortcut, text: check.text)
            guard intent == check.expected else {
                return "send shortcut \(check.shortcut) shift=\(check.shift) cmd=\(check.command) running=\(check.running) gave \(String(describing: intent))"
            }
        }
        guard StreamingText.visible("one\n\ntwo", streaming: true, mode: .paragraph) == "one",
              StreamingText.visible("one", streaming: true, mode: .turn) == nil else { return "response streaming modes render the wrong text" }
        print("ok   send shortcuts and response streaming modes match main")
        conversation.draftProject = project
        conversation.attachContext(text: "$ make\nok\n", source: "Terminal")
        guard draft.contexts.count == 1, draft.promptText.contains("Terminal:\n```\n$ make\nok\n```") else { return "attachContext did not add a terminal chip" }
        draft.clear()
        print("ok   attachContext(text:source:) added a terminal context chip")
        return vimChecks()
    }

    private func vimChecks() -> String? {
        let undo = VimSmokeUndo()
        defer { withExtendedLifetime(undo) {} }
        let textView = ComposerNSTextView(frame: NSRect(x: 0, y: 0, width: 480, height: 200))
        textView.allowsUndo = true
        textView.delegate = undo
        let original = "alpha beta gamma\nsecond line\nthird"
        textView.string = original
        textView.setSelectedRange(NSRange(location: 0, length: 0))
        let vim = textView.vim
        let steps: [(String, String)] = [
            ("\u{1b}dw", "beta gamma\nsecond line\nthird"),
            ("u", original),
            ("jdd", "alpha beta gamma\nthird"),
            ("u", original),
            ("gg2x", "pha beta gamma\nsecond line\nthird"),
            ("cwnew\u{1b}", "new beta gamma\nsecond line\nthird"),
            ("yyp", "new beta gamma\nnew beta gamma\nsecond line\nthird"),
            ("Gdd", "new beta gamma\nnew beta gamma\nsecond line"),
            ("u", "new beta gamma\nnew beta gamma\nsecond line\nthird"),
            ("gg2dd", "second line\nthird"),
        ]
        for (keys, expected) in steps {
            vim.feed(keys, in: textView)
            guard textView.string == expected else {
                return "vim keys \(keys.debugDescription) left \(textView.string.debugDescription), expected \(expected.debugDescription)"
            }
        }
        guard vim.mode == .normal else { return "vim did not return to normal mode after Esc" }
        vim.feed("$", in: textView)
        guard textView.selectedRange().location == 10 else { return "vim $ put the caret at \(textView.selectedRange().location), expected 10" }
        vim.feed("0", in: textView)
        guard textView.selectedRange().location == 0 else { return "vim 0 put the caret at \(textView.selectedRange().location), expected 0" }
        print("ok   vim composer motions (dw, dd, u, cw, yy p)")
        return nil
    }

    private func move(to next: Phase, _ detail: String) {
        print("ok   \(detail)")
        phase = next
    }

    private func finish(passed: Bool, _ detail: String) {
        phase = .finished
        subscription = nil
        print(passed ? "PASS conversation smoke: \(detail)" : "FAIL conversation smoke: \(detail)")
        if passed {
            NSApp.terminate(nil)
        } else {
            store.stop()
            exit(1)
        }
    }
}

@MainActor
private final class VimSmokeUndo: NSObject, NSTextViewDelegate {
    let manager: UndoManager = {
        let manager = UndoManager()
        manager.groupsByEvent = false
        return manager
    }()

    func undoManager(for view: NSTextView) -> UndoManager? {
        manager
    }
}
