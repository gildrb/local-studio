import Foundation
import LocalStudioKit
import Observation

final class UpdatePump: Waker, @unchecked Sendable {
    private let queue = DispatchQueue(label: "LocalStudio.updates", qos: .userInteractive)
    private let deliver: @MainActor @Sendable (Studio, [Update]) -> Void
    private var studio: Studio?
    private var woken = false
    private var delivering = false

    init(_ deliver: @escaping @MainActor @Sendable (Studio, [Update]) -> Void) {
        self.deliver = deliver
    }

    func attach(_ studio: Studio?) {
        queue.async {
            self.studio = studio
            self.woken = true
            self.drain()
        }
    }

    func wake() {
        queue.async {
            self.woken = true
            self.drain()
        }
    }

    private func drain() {
        guard woken, !delivering, let studio else { return }
        woken = false
        let updates = studio.tick()
        guard !updates.isEmpty else { return }
        delivering = true
        let deliver = self.deliver
        DispatchQueue.main.async {
            deliver(studio, updates)
            self.queue.async {
                self.delivering = false
                self.drain()
            }
        }
    }
}

@MainActor
final class CoreHandle {
    var studio: Studio?

    func run(_ body: (Studio) -> Void) {
        guard let studio else { return }
        body(studio)
    }
}

enum RequestOutcome: Equatable {
    case done(String)
    case failed(String)
}

@MainActor
final class RequestCenter {
    private var pending: [String: (RequestOutcome) -> Void] = [:]

    func issue(onOutcome: @escaping (RequestOutcome) -> Void = { _ in }) -> String {
        let id = UUID().uuidString
        pending[id] = onOutcome
        return id
    }

    func settle(_ request: String) {
        pending[request] = nil
    }

    func complete(_ request: String, _ outcome: RequestOutcome) {
        guard let handler = pending.removeValue(forKey: request) else { return }
        handler(outcome)
    }

    func reset() {
        pending.removeAll()
    }
}

struct StudioNotice: Identifiable, Equatable {
    let id = UUID()
    let level: NoticeLevel
    let text: String
}

extension Item: Identifiable {}
