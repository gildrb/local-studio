import Foundation
import Observation

enum PalettePage: Equatable {
    case root
    case newThread
    case goToFile
    case searchProject
    case appearance
}

enum ShellConfirmation: Equatable {
    case delete([String])
    case archive([String])
    case unpin([String])

    var threads: [String] {
        switch self {
        case .delete(let ids), .archive(let ids), .unpin(let ids): ids
        }
    }
}

@MainActor
@Observable
final class ShellState {
    var route = MainRoute.thread
    var sidebarVisible = true
    var sidebarWidth: CGFloat = 272
    var palette: PalettePage?
    var commandHeld = false
    var confirmation: ShellConfirmation?
    var headerRenaming = false
    var snoozeTargets: [String] = []
    var commitProject: String?
    var pullRequestProject: String?
    var publishProject: String?

    private(set) var back: [String?] = []
    private(set) var forward: [String?] = []

    func record(from previous: String?, to next: String?) {
        guard previous != next else { return }
        back.append(previous)
        if back.count > 50 { back.removeFirst() }
        forward = []
    }

    func popBack(current: String?) -> String?? {
        guard let target = back.popLast() else { return nil }
        forward.append(current)
        return .some(target)
    }

    func popForward(current: String?) -> String?? {
        guard let target = forward.popLast() else { return nil }
        back.append(current)
        return .some(target)
    }

    var canGoBack: Bool { !back.isEmpty }
    var canGoForward: Bool { !forward.isEmpty }
}
