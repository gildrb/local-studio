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
        attach(window: window)
        watchdog.start { [weak self] posted, latency in
            guard let self, recording, latency > Self.stallThreshold else { return }
            stalls.append(Stall(at: posted - origin, duration: latency, context: context))
        }
    }

    func attach(window: NSWindow) {
        link?.invalidate()
        last = nil
        guard let screen = window.screen ?? NSScreen.main else { return }
        let link = screen.displayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
        watchdog.stop()
    }

    func elapsed() -> TimeInterval {
        ProcessInfo.processInfo.systemUptime - origin
    }

    func progress(ticks: Int) {
        watchdog.progress(ticks: ticks, context: context)
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
        var answered: TimeInterval = 0
        var progressed: TimeInterval = 0
        var ticks = 0
        var context = ""
    }

    static let progressLimit: TimeInterval = 15

    private let state = OSAllocatedUnfairLock(initialState: State())

    func progress(ticks: Int, context: String) {
        let now = ProcessInfo.processInfo.systemUptime
        state.withLock {
            $0.progressed = now
            $0.ticks = ticks
            $0.context = context
        }
    }

    func start(_ report: @escaping @MainActor @Sendable (TimeInterval, TimeInterval) -> Void) {
        let now = ProcessInfo.processInfo.systemUptime
        state.withLock {
            $0.running = true
            $0.answered = now
            $0.progressed = now
        }
        let thread = Thread { [state] in
            while state.withLock({ $0.running }) {
                let now = ProcessInfo.processInfo.systemUptime
                let current = state.withLock { current -> State in
                    let snapshot = current
                    current.outstanding = true
                    return snapshot
                }
                if now - current.progressed > Self.progressLimit {
                    let answered = String(format: "%.1f", now - current.answered)
                    print("FAIL macOS stress: the harness made no progress for \(Int(Self.progressLimit)) s after \(current.context); the main queue last answered \(answered) s ago, core ticks \(current.ticks)")
                    exit(1)
                }
                if !current.outstanding {
                    let posted = now
                    DispatchQueue.main.async {
                        let latency = ProcessInfo.processInfo.systemUptime - posted
                        state.withLock {
                            $0.outstanding = false
                            $0.answered = posted + latency
                        }
                        report(posted, latency)
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
