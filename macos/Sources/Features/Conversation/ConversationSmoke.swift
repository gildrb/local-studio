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
        case editing
        case finished
    }

    private let store: StudioStore
    private var phase = Phase.connecting
    private var subscription: AnyCancellable?
    private var thread: String?

    private static let prompt = "run the smoke command"
    private static let followUp = "queued follow-up"
    private static let cancelled = "cancel me"

    init(store: StudioStore) {
        self.store = store
    }

    func start() {
        subscription = store.didTick.sink { [weak self] in self?.advance() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
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
        case .project:
            guard let project = store.inbox.currentProject, !store.inbox.projects.isEmpty, conversation.modelsLoaded else { return }
            guard !conversation.providerUnavailable, let model = conversation.currentModel(settings: store.pages.settings) else {
                finish(passed: false, "the draft composer found no default model in \(conversation.models.count) models")
                return
            }
            conversation.newThread.access = .supervised
            conversation.composer(project: project).text = Self.prompt
            conversation.submit(project: project, steer: false, settings: store.pages.settings)
            move(to: .opening, "composer started a supervised thread in \(project) with default model \(model.provider)/\(model.id)")
        case .opening:
            guard let thread = conversation.thread else { return }
            self.thread = thread
            move(to: .approval, "thread \(thread) focused")
        case .approval:
            guard let approval = conversation.approvals.first, conversation.busy else { return }
            print("     approval \(approval.command) \(approval.effects)")
            for text in [Self.followUp, Self.cancelled] {
                conversation.composer(project: nil).text = text
                conversation.submit(project: nil, steer: false, settings: nil)
            }
            move(to: .queued, "approval card pending while the turn runs; queued two follow-ups")
        case .queued:
            guard conversation.queued.count == 2, let cancel = conversation.queued.first(where: { $0.text == Self.cancelled }) else { return }
            conversation.cancelQueued(cancel)
            move(to: .cancelled, "queue shows both messages; cancelled one")
        case .cancelled:
            guard conversation.queued.count == 1, conversation.composer(project: nil).text == Self.cancelled,
                  let queued = conversation.queued.first, queued.text == Self.followUp else { return }
            conversation.composer(project: nil).text = ""
            conversation.sendNow(queued)
            move(to: .steering, "cancelled message returned to the composer; sent the other now")
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
                  items.contains(where: { if case .user(Self.followUp, _, _) = $0.kind { true } else { false } }),
                  items.contains(where: { if case .tool(_, _, _, _, _, .succeeded, _, _, _, _) = $0.kind { true } else { false } }) else { return }
            guard let anchor = items.lazy.compactMap({ item -> String? in
                if case .user(Self.prompt, _, let entry) = item.kind { entry } else { nil }
            }).first else { return }
            for item in items {
                print("     item \(item.id) turn \(item.turn) \(item.kind)")
            }
            print("     \(conversation.rows.count) timeline rows for \(items.count) items")
            conversation.composer(project: nil).text = ""
            conversation.editFromHere(entry: anchor)
            move(to: .editing, "follow-up from the queue landed in the transcript; editing from the first prompt")
        case .editing:
            let rewound = !conversation.items.contains { if case .user(Self.followUp, _, _) = $0.kind { true } else { false } }
            guard let thread, rewound, conversation.composer(project: nil).text == Self.prompt, conversation.thread == thread else { return }
            finish(passed: true, "edit from here filled the composer with “\(Self.prompt)”")
        case .finished:
            return
        }
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
