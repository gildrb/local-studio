import Foundation
import SwiftUI

struct AlignedSchedule: TimelineSchedule {
    let interval: TimeInterval
    let live: Bool

    func entries(from startDate: Date, mode: TimelineScheduleMode) -> AnyIterator<Date> {
        guard live else { return AnyIterator(CollectionOfOne(startDate).makeIterator()) }
        return AnyIterator(PeriodicTimelineSchedule(from: ClockAnchor.date, by: interval).entries(from: startDate, mode: mode).makeIterator())
    }
}

extension TimelineSchedule where Self == AlignedSchedule {
    static func aligned(every interval: TimeInterval, live: Bool) -> AlignedSchedule {
        AlignedSchedule(interval: interval, live: live)
    }
}

private enum ClockAnchor {
    static let date = Date(timeIntervalSince1970: floor(Date.now.timeIntervalSince1970))
}

struct TickingText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(String(text.map { $0.isNumber ? "0" : $0 }))
            .hidden()
            .overlay(alignment: .leading) {
                Text(text)
            }
    }
}
