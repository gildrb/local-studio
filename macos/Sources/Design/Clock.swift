import Foundation
import SwiftUI

extension TimelineSchedule where Self == PeriodicTimelineSchedule {
    static func aligned(every interval: TimeInterval) -> PeriodicTimelineSchedule {
        .periodic(from: ClockAnchor.date, by: interval)
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
