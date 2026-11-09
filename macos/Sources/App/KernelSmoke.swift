import AppKit
import Combine
import Foundation
import LocalStudioKit

@MainActor
final class KernelSmoke {
    private enum Phase: String {
        case kernel
        case installing
        case connecting
        case project
        case opening
        case replying
        case finished
    }

    private static let prompt = "Use the ipython tool once to run exactly `import os, sys; print(sys.version)`, then reply with only the Python version it printed."
    private static let readyWithin: TimeInterval = 10

    private let store: StudioStore
    private let install: Bool
    private let started = KernelSmoke.launched()
    private var phase = Phase.kernel
    private var version = ""
    private var detail: String?
    private var subscription: AnyCancellable?

    init(store: StudioStore, install: Bool) {
        self.store = store
        self.install = install
    }

    private nonisolated static func launched() -> Date {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var name = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&name, u_int(name.count), &info, &size, nil, 0) == 0 else { return Date() }
        let start = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: TimeInterval(start.tv_sec) + TimeInterval(start.tv_usec) / 1_000_000)
    }

    func start() {
        subscription = store.didTick.sink { [weak self] in self?.advance() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 900) { [weak self] in
            guard let self, phase != .finished else { return }
            finish(passed: false, "timed out while \(phase.rawValue) (kernel \(String(describing: store.kernel)))")
        }
    }

    private func advance() {
        switch phase {
        case .kernel:
            checkKernel()
        case .installing:
            checkInstall()
        case .connecting:
            guard store.connection == .ready, let project = makeProject() else { return }
            phase = .project
            store.inbox.addProject(path: project.path)
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
            checkReply()
        case .finished:
            return
        }
    }

    private func checkKernel() {
        guard let kernel = store.kernel else { return }
        let elapsed = String(format: "%.2f s", Date().timeIntervalSince(started))
        switch kernel {
        case .checking:
            return
        case .installing:
            finish(passed: false, "the launch started an install on its own")
        case .failed(let message):
            finish(passed: false, "the kernel failed on launch: \(message)")
        case .unavailable(let reason):
            finish(passed: false, "the kernel is unavailable: \(reason)")
        case .missing:
            guard install else {
                finish(passed: false, "no Python found after \(elapsed) although one is on PATH")
                return
            }
            print("ok   no Python found after \(elapsed); pressing Install")
            phase = .installing
            store.installKernel()
        case .ready(let python, let version, let source):
            guard !install else {
                finish(passed: false, "found \(python) (Python \(version), \(source)) although every Python was hidden")
                return
            }
            guard Date().timeIntervalSince(started) <= Self.readyWithin else {
                finish(passed: false, "the kernel took \(elapsed) to become ready")
                return
            }
            print("ok   kernel ready in \(elapsed) with no install: \(python) (Python \(version), \(source))")
            openProject(version: version)
        }
    }

    private func checkInstall() {
        switch store.kernel {
        case .installing(let detail):
            if let detail, detail != self.detail {
                self.detail = detail
                print("     install: \(detail)".prefix(200))
            }
        case .failed(let message):
            finish(passed: false, "the install failed: \(message)")
        case .unavailable(let reason):
            finish(passed: false, "the kernel is unavailable after the install: \(reason)")
        case .ready(let python, let version, let source):
            print("ok   installed in \(String(format: "%.1f s", Date().timeIntervalSince(started))): \(python) (Python \(version), \(source))")
            openProject(version: version)
        case .checking, .missing, nil:
            return
        }
    }

    private func openProject(version: String) {
        self.version = version
        phase = .connecting
        advance()
    }

    private func checkReply() {
        let items = store.conversation.items
        guard let info = store.conversation.info, !info.busy, let last = items.last,
              case .assistant(_, false, _, _) = last.kind, let reply = SmokeModel.reply(items, after: Self.prompt) else { return }
        for item in items {
            print("item \(item.kind)".prefix(400))
        }
        if items.contains(where: { item in
            if case .notice(.warning, let text) = item.kind { text.lowercased().contains("kernel") } else { false }
        }) {
            finish(passed: false, "the transcript shows a kernel warning notice")
            return
        }
        let output = items.compactMap { item -> String? in
            if case .tool(_, "ipython", _, _, _, .succeeded, let output, _, _, _) = item.kind { output } else { nil }
        }
        guard let printed = output.first(where: { $0.contains(version) }) else {
            finish(passed: false, "no succeeded ipython call printed Python \(version) (\(output.count) succeeded ipython calls)")
            return
        }
        let line = printed.split(separator: "\n").first(where: { $0.contains(version) }).map(String.init) ?? printed
        finish(passed: true, "kernel: a real ipython call printed “\(line)” and the model replied “\(reply)” (\(items.count) transcript items, \(String(format: "%.1f s", Date().timeIntervalSince(started))) total)")
    }

    private func makeProject() -> URL? {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let project = URL(fileURLWithPath: home, isDirectory: true).appending(path: "kernel-smoke", directoryHint: .isDirectory)
        do {
            try FileManager.default.createDirectory(at: project, withIntermediateDirectories: true)
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
