import AppKit
import Combine
import Foundation
import LocalStudioKit

@MainActor
final class KernelSmoke {
    private enum Phase: String {
        case kernel
        case project
        case opening
        case replying
        case finished
    }

    private static let prompt = "List the files here and count them with Python: use the ipython tool once, then reply with only the count."
    private static let files = ["alpha.txt", "beta.txt", "gamma.txt"]

    private let store: StudioStore
    private let expectInstall: Bool
    private var phase = Phase.kernel
    private var sawInstalling = false
    private var subscription: AnyCancellable?

    init(store: StudioStore, expectInstall: Bool) {
        self.store = store
        self.expectInstall = expectInstall
    }

    func start() {
        subscription = store.didTick.sink { [weak self] in self?.advance() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 900) { [weak self] in
            guard let self, phase != .finished else { return }
            finish(passed: false, "timed out while \(phase.rawValue) (kernel \(String(describing: store.kernel)))")
        }
    }

    private func advance() {
        if store.kernel?.installing == true, !sawInstalling {
            sawInstalling = true
            print("ok   kernel install started on launch")
        }
        switch phase {
        case .kernel:
            checkKernel()
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
            checkReply()
        case .finished:
            return
        }
    }

    private func checkKernel() {
        guard store.connection == .ready, let kernel = store.kernel else { return }
        switch kernel {
        case .checking, .missing, .installing:
            return
        case .failed(let message):
            finish(passed: false, "the kernel install failed: \(message)")
        case .unavailable(let reason):
            finish(passed: false, "the kernel is unavailable: \(reason)")
        case .installed(let python):
            guard sawInstalling == expectInstall else {
                finish(passed: false, expectInstall ? "the kernel was never installed on a launch without one" : "a launch with an installed kernel installed it again")
                return
            }
            print("ok   kernel installed at \(python) (\(sawInstalling ? "installed by this launch" : "no install on this launch"))")
            guard let project = makeProject() else { return }
            phase = .project
            store.inbox.addProject(path: project.path)
            store.conversation.loadModels()
        }
    }

    private func checkReply() {
        let items = store.conversation.items
        guard let info = store.conversation.info, !info.busy, let last = items.last,
              case .assistant(_, false, _, _) = last.kind, let reply = SmokeModel.reply(items, after: Self.prompt) else { return }
        for item in items {
            print("item \(item.kind)".prefix(400))
        }
        if items.contains(where: { String(describing: $0.kind).contains("kernel is not installed") }) {
            finish(passed: false, "the transcript reports the Python kernel as not installed")
            return
        }
        let python = items.contains { item in
            if case .tool(_, "ipython", _, _, _, .succeeded, _, _, _, _) = item.kind { true } else { false }
        }
        guard python else {
            finish(passed: false, "the turn finished without a succeeded ipython call")
            return
        }
        finish(passed: true, "a real ipython call succeeded and the model replied “\(reply)” (\(items.count) transcript items)")
    }

    private func makeProject() -> URL? {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let project = URL(fileURLWithPath: home, isDirectory: true).appending(path: "kernel-smoke", directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: project, withIntermediateDirectories: true)
            for name in Self.files {
                try Data(name.utf8).write(to: project.appending(path: name))
            }
            return project
        } catch {
            finish(passed: false, "could not create the smoke project: \(error.localizedDescription)")
            return nil
        }
    }

    private func finish(passed: Bool, _ detail: String) {
        phase = .finished
        subscription = nil
        print(passed ? "PASS macOS kernel smoke: \(detail)" : "FAIL macOS kernel smoke: \(detail)")
        if passed {
            NSApp.terminate(nil)
        } else {
            store.stop()
            exit(1)
        }
    }
}
