import AppKit
import Combine
import Foundation
import LocalStudioKit

@MainActor
final class Smoke {
    private enum Phase: String {
        case connecting
        case project
        case opening
        case replying
        case finished
    }

    private static let prompt = SmokeModel.bash("echo smoke-ok")

    private let store: StudioStore
    private var phase = Phase.connecting
    private var subscription: AnyCancellable?
    private var modelsAt: Date?
    private var composerShown = false

    init(store: StudioStore) {
        self.store = store
    }

    func start() {
        subscription = store.didTick.sink { [weak self] in self?.advance() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in
            guard let self, phase != .finished else { return }
            finish(passed: false, "timed out while \(phase.rawValue)")
        }
    }

    private func advance() {
        checkComposer()
        switch phase {
        case .connecting:
            guard store.connection == .ready else { return }
            phase = .project
            store.inbox.addProject(path: ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory())
        case .project:
            guard composerShown, store.inbox.currentProject != nil, !store.inbox.projects.isEmpty else { return }
            guard SmokeModel.select(store.conversation) else { return }
            phase = .opening
            print("ok   real model \(SmokeModel.label)")
            store.conversation.newThread.access = .fullAccess
            store.conversation.send(Self.prompt, project: store.inbox.currentProject, steer: false)
        case .opening:
            guard store.conversation.thread != nil else { return }
            phase = .replying
        case .replying:
            let items = store.conversation.items
            guard let info = store.conversation.info, !info.busy, let last = items.last,
                  case .assistant(_, false, _, _) = last.kind, let reply = SmokeModel.reply(items, after: Self.prompt) else { return }
            for item in items {
                print("item \(item.kind)".prefix(400))
            }
            guard SmokeModel.toolSucceeded(items, output: "smoke-ok") else {
                finish(passed: false, "the turn finished without a succeeded bash call printing smoke-ok")
                return
            }
            finish(passed: true, "real bash call succeeded and the model replied “\(reply)” (\(items.count) transcript items)")
        case .finished:
            return
        }
    }

    /// A fresh window loads the models on its own; once they arrive the empty thread's composer must name the
    /// default model and thinking level within a second.
    private func checkComposer() {
        guard !composerShown, phase != .finished, store.conversation.modelsLoaded else { return }
        let loaded = modelsAt ?? .now
        if let expected = expectedComposer, store.shell.probe.composer == expected {
            composerShown = true
            print("ok   fresh composer shows \(Self.describe(expected)) \(Int(Date.now.timeIntervalSince(loaded) * 1000)) ms after the models loaded")
            return
        }
        guard modelsAt == nil else { return }
        modelsAt = loaded
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self else { return }
            checkComposer()
            guard !composerShown, phase != .finished else { return }
            let expected = expectedComposer.map(Self.describe) ?? "the settings' default model, which the catalog does not list (set defaultProvider and defaultModel)"
            finish(passed: false, "1 s after the models loaded the composer shows \(Self.describe(store.shell.probe.composer)), expected \(expected)")
        }
    }

    private var expectedComposer: ComposerProbe? {
        let settings = store.pages.settings
        let model = store.conversation.models.first { $0.provider == settings?.defaultProvider && $0.id == settings?.defaultModel }
        return model.map { ComposerProbe(model: $0.name, thinking: settings?.defaultThinkingLevel.map(ThinkingMenu.title)) }
    }

    private static func describe(_ probe: ComposerProbe?) -> String {
        probe.map { "\($0.model) · \($0.thinking ?? "no thinking chip")" } ?? "nothing"
    }

    private func finish(passed: Bool, _ detail: String) {
        phase = .finished
        subscription = nil
        print(passed ? "PASS macOS smoke: \(detail)" : "FAIL macOS smoke: \(detail)")
        if passed {
            NSApp.terminate(nil)
        } else {
            store.stop()
            exit(1)
        }
    }
}
