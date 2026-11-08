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

@MainActor
final class RenderProbe {
    var header: HeaderProbe?
    var timeline: TimelineProbe?
    var scroll: ScrollProbe?
    var working: WorkingProbe?
    var badges: [String: BadgeProbe] = [:]
    private(set) var dispatched: [String?] = []

    func ran(_ command: String?) {
        dispatched.append(command)
        if dispatched.count > 64 {
            dispatched.removeFirst(dispatched.count - 64)
        }
    }
}
