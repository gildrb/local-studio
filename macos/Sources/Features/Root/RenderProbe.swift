import Foundation

struct HeaderProbe: Equatable {
    var thread: String?
    var pending: String?
    var title: String
    var project: String
}

struct TimelineProbe: Equatable {
    var thread: String?
    var pending: String?
    var rows: Int
    var firstUser: String?
    var lastUser: String?
    var replied: Bool
    var placeholder: Bool
}

struct ScrollProbe: Equatable {
    var thread: String?
    var distance: CGFloat
    var top: UInt64?
}

struct WorkingProbe: Equatable {
    var thread: String?
    var shown: Bool
    var started: Int64?
}

struct BadgeProbe {
    var text: String
    var at: Date
}

struct DrawnElapsed {
    enum Source {
        case workingRow
        case badge
    }

    let thread: String
    let source: Source
    let text: String?
    let at: Date
}

@MainActor
final class RenderProbe {
    var header: HeaderProbe?
    var timeline: TimelineProbe?
    var scroll: ScrollProbe?
    var working: WorkingProbe?
    var badges: [String: BadgeProbe] = [:]
    var drawn: [DrawnElapsed]?
    var bubbles: [String: CGRect] = [:]
    private(set) var dispatched: [String?] = []

    func ran(_ command: String?) {
        dispatched.append(command)
        if dispatched.count > 64 {
            dispatched.removeFirst(dispatched.count - 64)
        }
    }

    func drew(_ thread: String, _ source: DrawnElapsed.Source, _ text: String?) {
        drawn?.append(DrawnElapsed(thread: thread, source: source, text: text, at: .now))
    }
}
