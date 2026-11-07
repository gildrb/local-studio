import AppKit
import Foundation
import os
import QuartzCore

@MainActor
final class FrameMonitor: NSObject {
    struct Stall {
        let at: TimeInterval
        let duration: TimeInterval
        let context: String
    }

    struct Hitch {
        let at: TimeInterval
        let duration: TimeInterval
        let context: String
    }

    private(set) var frames: [TimeInterval] = []
    private(set) var hitches: [Hitch] = []
    private(set) var stalls: [Stall] = []
    private(set) var interval: TimeInterval = 1.0 / 60.0
    var recording = false
    var context = ""
    var onFrame: (() -> Void)?

    private var link: CADisplayLink?
    private var last: CFTimeInterval?
    private var origin = ProcessInfo.processInfo.systemUptime
    private let watchdog = Watchdog()

    static let stallThreshold: TimeInterval = 0.05

    func start(window: NSWindow) {
        origin = ProcessInfo.processInfo.systemUptime
        let link = window.displayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
        watchdog.start { [weak self] posted, latency in
            guard let self, recording, latency > Self.stallThreshold else { return }
            stalls.append(Stall(at: posted - origin, duration: latency, context: context))
        }
    }

    func stop() {
        link?.invalidate()
        link = nil
        watchdog.stop()
    }

    func elapsed() -> TimeInterval {
        ProcessInfo.processInfo.systemUptime - origin
    }

    @objc private func tick(_ link: CADisplayLink) {
        let duration = link.targetTimestamp - link.timestamp
        if duration > 0.001 {
            interval = duration
        }
        if let last, recording {
            let delta = link.timestamp - last
            frames.append(delta)
            if delta > interval * 1.5 {
                hitches.append(Hitch(at: elapsed(), duration: delta, context: context))
            }
        }
        last = link.timestamp
        onFrame?()
    }

    func percentile(_ fraction: Double) -> TimeInterval {
        guard !frames.isEmpty else { return 0 }
        let sorted = frames.sorted()
        let index = min(Int((Double(sorted.count - 1) * fraction).rounded()), sorted.count - 1)
        return sorted[index]
    }
}

final class Watchdog: Sendable {
    private struct State {
        var running = false
        var outstanding = false
    }

    private let state = OSAllocatedUnfairLock(initialState: State())

    func start(_ report: @escaping @MainActor @Sendable (TimeInterval, TimeInterval) -> Void) {
        state.withLock { $0.running = true }
        let thread = Thread { [state] in
            while state.withLock({ $0.running }) {
                let send = state.withLock { current -> Bool in
                    guard !current.outstanding else { return false }
                    current.outstanding = true
                    return true
                }
                if send {
                    let posted = ProcessInfo.processInfo.systemUptime
                    DispatchQueue.main.async {
                        let latency = ProcessInfo.processInfo.systemUptime - posted
                        state.withLock { $0.outstanding = false }
                        MainActor.assumeIsolated { report(posted, latency) }
                    }
                }
                Thread.sleep(forTimeInterval: 0.005)
            }
        }
        thread.qualityOfService = .userInteractive
        thread.start()
    }

    func stop() {
        state.withLock { $0.running = false }
    }
}
