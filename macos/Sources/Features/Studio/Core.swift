import Foundation
import LocalStudioKit
import Observation

final class MainWaker: Waker {
    private let action: @MainActor @Sendable () -> Void

    init(_ action: @escaping @MainActor @Sendable () -> Void) {
        self.action = action
    }

    func wake() {
        let action = self.action
        DispatchQueue.main.async {
            action()
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
