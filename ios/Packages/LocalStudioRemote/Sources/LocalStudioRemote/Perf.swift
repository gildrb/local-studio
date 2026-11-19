import Darwin
import Foundation
import Observation
import os

@Observable
@MainActor
public final class Perf {
    public static let shared = Perf()

    @ObservationIgnored private let signposter = OSSignposter(subsystem: "com.baney.localstudio.remote", category: .pointsOfInterest)
    @ObservationIgnored private let launch = ContinuousClock.now
    @ObservationIgnored private let launchWall = Date()
    @ObservationIgnored private var coldStart: OSSignpostIntervalState?
    @ObservationIgnored private var cacheList: OSSignpostIntervalState?
    @ObservationIgnored private var liveList: OSSignpostIntervalState?
    @ObservationIgnored private var sends: [String: (OSSignpostIntervalState, ContinuousClock.Instant)] = [:]
    public private(set) var timings: [String: Int] = [:]

    private init() {
        coldStart = signposter.beginInterval("cold start")
        cacheList = signposter.beginInterval("first thread list (cache)")
        liveList = signposter.beginInterval("first thread list (live)")
        if let started = Self.processStart() {
            timings["processStartToModelMs"] = Int((launchWall.timeIntervalSince(started) * 1000).rounded())
        }
    }

    private static func processStart() -> Date? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&name, 4, &info, &size, nil, 0) == 0 else {
            return nil
        }
        let time = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: Double(time.tv_sec) + Double(time.tv_usec) / 1_000_000)
    }

    private func sinceLaunch() -> Double {
        let elapsed = ContinuousClock.now - launch
        return Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
    }

    public func threadListShown(fromCache: Bool) {
        let key = fromCache ? "coldStartToCachedListMs" : "coldStartToLiveListMs"
        guard timings[key] == nil else {
            return
        }
        timings[key] = Int(sinceLaunch().rounded())
        if let state = coldStart {
            signposter.endInterval("cold start", state)
            coldStart = nil
        }
        if fromCache, let state = cacheList {
            signposter.endInterval("first thread list (cache)", state)
            cacheList = nil
        }
        if !fromCache, let state = liveList {
            signposter.endInterval("first thread list (live)", state)
            liveList = nil
        }
    }

    public func sendStarted(thread: String) {
        guard sends[thread] == nil else {
            return
        }
        sends[thread] = (signposter.beginInterval("send to first transcript update"), ContinuousClock.now)
    }

    public func transcriptUpdated(thread: String) {
        guard let (state, started) = sends.removeValue(forKey: thread) else {
            return
        }
        signposter.endInterval("send to first transcript update", state)
        let elapsed = ContinuousClock.now - started
        let ms = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
        if timings["sendToFirstTranscriptUpdateMs"] == nil {
            timings["sendToFirstTranscriptUpdateMs"] = Int(ms.rounded())
        }
    }

    public var json: String {
        let data = (try? JSONSerialization.data(withJSONObject: timings, options: [.sortedKeys])) ?? Data()
        return String(bytes: data, encoding: .utf8) ?? "{}"
    }
}
