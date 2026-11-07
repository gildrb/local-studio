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

@MainActor
final class RenderProbe {
    var header: HeaderProbe?
    var timeline: TimelineProbe?
    var scroll: ScrollProbe?
}
