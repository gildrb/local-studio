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
        case .project:
            guard store.inbox.currentProject != nil, !store.inbox.projects.isEmpty else { return }
            phase = .opening
            store.conversation.send("run the smoke command", project: store.inbox.currentProject, steer: false)
        case .opening:
            guard store.conversation.thread != nil else { return }
            phase = .replying
        case .replying:
            let items = store.conversation.items
            guard let info = store.conversation.info, !info.busy, let last = items.last,
                  case .assistant(let blocks, let streaming, _, _) = last.kind, !streaming,
                  blocks.contains(where: { if case .text = $0 { true } else { false } }) else { return }
            for item in items {
                print("item \(item.kind)")
            }
            finish(passed: true, "\(items.count) transcript items")
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
