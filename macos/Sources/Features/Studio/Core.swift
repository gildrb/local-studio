import Foundation
import LocalStudioKit
import Observation

final class UpdatePump: Waker, @unchecked Sendable {
    private let queue = DispatchQueue(label: "LocalStudio.updates", qos: .userInteractive)
    private let deliver: @MainActor @Sendable (Studio, [Update]) -> Void
    private var studio: Studio?
    private var woken = false
    private var delivering = false
    private var interval: TimeInterval = 0
    private var delivered: TimeInterval = 0
    private var deferred = false

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

    func pace(_ interval: TimeInterval) {
        queue.async {
            self.interval = interval
            self.drain()
        }
    }

    @MainActor
    func flush() {
        let batch: (Studio, [Update])? = queue.sync {
            guard woken, !delivering, let studio else { return nil }
            woken = false
            delivered = ProcessInfo.processInfo.systemUptime
            return (studio, studio.tick())
        }
        guard let (studio, updates) = batch, !updates.isEmpty else { return }
        deliver(studio, updates)
    }

    private func drain() {
        guard woken, !delivering, let studio else { return }
        let wait = delivered + interval - ProcessInfo.processInfo.systemUptime
        guard wait <= 0 else {
            if !deferred {
                deferred = true
                queue.asyncAfter(deadline: .now() + wait) {
                    self.deferred = false
                    self.drain()
                }
            }
            return
        }
        woken = false
        let updates = studio.tick()
        guard !updates.isEmpty else { return }
        delivered = ProcessInfo.processInfo.systemUptime
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
