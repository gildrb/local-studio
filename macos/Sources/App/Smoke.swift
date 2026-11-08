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
        switch phase {
        case .connecting:
            guard store.connection == .ready else { return }
            phase = .project
            store.inbox.addProject(path: ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory())
            store.conversation.loadModels()
        case .project:
            guard store.inbox.currentProject != nil, !store.inbox.projects.isEmpty, SmokeModel.select(store.conversation) else { return }
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
