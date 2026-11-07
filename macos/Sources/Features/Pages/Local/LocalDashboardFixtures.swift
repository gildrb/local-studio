import Foundation
import LocalStudioKit

extension PagesFixtures {
    private static let mib: UInt64 = 1_048_576

    private static func rtxGpu(_ index: UInt32, used: Double) -> LocalGpu {
        LocalGpu(
            index: index, name: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", card: "rtx-pro-6000",
            memoryUsedMib: UInt64(used * 1024), memoryTotalMib: 96 * 1024, busy: true
        )
    }

    static var rtxPod: LocalController {
        LocalController(
            target: "", url: "http://127.0.0.1:18091", id: "ctl-rtx6000", name: "rtx-6000-pod", host: "127.0.0.1", local: true,
            reachable: true, error: nil, version: "0.1.0",
            hardware: LocalHardware(
                cpus: 64, memoryTotalBytes: 512 * gib, memoryFreeBytes: 300 * gib,
                gpus: [rtxGpu(0, used: 93.7), rtxGpu(1, used: 93.5), rtxGpu(2, used: 94.7), rtxGpu(3, used: 94.7)],
                memoryUsedBytes: 377 * gib, memoryCapacityBytes: 384 * gib, memoryLabel: "VRAM", gpuSummary: "4× RTX PRO 6000"
            ),
            endpoints: [
                LocalEndpoint(id: "ctl-rtx6000:8000", controllerId: "ctl-rtx6000", port: 8000, pid: 812, models: ["DeepSeek-V4.1-Flash"], live: true, jobId: nil),
            ],
            jobs: [],
            recipes: [
                LocalRecipe(id: "deepseek-v4.1-flash-vllm-4xrtx6000", model: "DeepSeek-V4.1-Flash", card: "rtx-pro-6000", engine: "vllm", cards: 4, context: 131_072, tokensPerSecond: 410, fits: true, blocked: nil, detail: "4 of 4 GPUs · full rig · vllm · 131k context · 410 tok/s"),
                LocalRecipe(id: "glm-5.3-flash-sglang-4xrtx6000", model: "GLM-5.3-Flash", card: "rtx-pro-6000", engine: "sglang", cards: 4, context: 200_000, tokensPerSecond: 320, fits: true, blocked: nil, detail: "4 of 4 GPUs · full rig · sglang · 200k context · 320 tok/s"),
            ],
            requests: 48_210, tokens: 3_400_000_000, measuredRequests: 48_100
        )
    }

    static var rtx3090Pod: LocalController {
        LocalController(
            target: "http://100.88.4.31:18091", url: "http://100.88.4.31:18091", id: nil, name: "rtx-3090-pod", host: "100.88.4.31", local: false,
            reachable: false, error: "connect timed out after 3s", version: nil, hardware: nil, endpoints: [], jobs: [], recipes: [],
            requests: 0, tokens: 0, measuredRequests: 0
        )
    }

    static var dgxSpark: LocalController {
        LocalController(
            target: "http://100.88.4.32:18091", url: "http://100.88.4.32:18091", id: nil, name: "DGX Spark", host: "100.88.4.32", local: false,
            reachable: false, error: "connect timed out after 3s", version: nil, hardware: nil, endpoints: [], jobs: [], recipes: [],
            requests: 0, tokens: 0, measuredRequests: 0
        )
    }

    static var dashboardSnapshot: LocalSnapshot {
        LocalSnapshot(
            controllers: [rtxPod, rtx3090Pod, dgxSpark], registry: nil, usage: localUsage, tailnet: nil,
            record: nil, share: nil, autoModel: "DeepSeek-V4.1-Flash", generatedAt: nil, error: nil
        )
    }

    static var idleSnapshot: LocalSnapshot {
        var pod = rtxPod
        pod.endpoints = []
        return LocalSnapshot(
            controllers: [pod, rtx3090Pod], registry: nil, usage: localUsage, tailnet: nil,
            record: nil, share: nil, autoModel: nil, generatedAt: nil, error: nil
        )
    }

    private static let spikes: [Double] = [
        22, 35, 40, 25, 25, 60, 25, 5, 180, 40, 85, 50, 10, 5, 25, 5, 10, 120, 70, 100, 5, 150, 5, 15, 4,
        3, 5, 6, 4, 170, 30, 30, 32, 35, 70, 62, 10, 130, 8, 5, 50, 10, 6, 30, 30, 30, 70, 126,
    ]

    private static func telemetryGpu(_ index: UInt32, used: Double, watts: Double, temperature: Double) -> LocalGpuTelemetry {
        LocalGpuTelemetry(
            index: index, name: "RTX PRO 6000 Blackwell", memoryUsedMib: UInt64(used * 1024), memoryTotalMib: 96 * 1024,
            powerWatts: watts, powerLimitWatts: 275, temperatureC: temperature, utilization: 100
        )
    }

    static var tokenHistory: LocalTokenHistory {
        let since = 6
        let daily: [UInt64] = (0..<378).map { day in
            guard day >= since else { return 0 }
            let hash = Double((day &* 7919 &+ 13) % 101) / 101
            guard hash > 0.14 else { return 0 }
            return UInt64(hash * hash * hash * 24_000_000 * (1 + Double(day) / 378))
        }
        return LocalTokenHistory(
            sinceDay: "2025-11-03", total: 3_404_000_000, read: 3_200_000_000, written: 204_000_000,
            lastWeek: 100_900_000, busiestDay: "2026-10-21", busiestTokens: 34_800_000, activeDays: 314, trackedDays: 364,
            daily: daily, lastDay: "2026-11-01"
        )
    }

    static var dashboard: LocalDashboard {
        let now = Int64(Date.now.timeIntervalSince1970 * 1000)
        let step: Int64 = 300_000
        let series = (0..<288).map { index in
            let position = Double(index) / 6
            let lower = spikes[min(spikes.count - 1, Int(position))]
            let upper = spikes[min(spikes.count - 1, Int(position) + 1)]
            let blend = position - position.rounded(.down)
            return (lower + (upper - lower) * blend) * 3.1
        }
        let gpus = [
            telemetryGpu(0, used: 93.7, watts: 275, temperature: 65),
            telemetryGpu(1, used: 93.5, watts: 276, temperature: 48),
            telemetryGpu(2, used: 94.7, watts: 275, temperature: 57),
            telemetryGpu(3, used: 94.7, watts: 275, temperature: 73),
        ]
        return LocalDashboard(
            controller: "", error: nil,
            engines: [LocalEngineTelemetry(port: 8000, models: ["DeepSeek-V4.1-Flash"], kind: "vllm", loadedAtMs: now - 86_400_000 - 7_200_000)],
            decodeTps: 391.6, perRequestTps: 97.9, running: 4, runningPeak: 8, waiting: 0,
            kvPercent: 4, kvPeakPercent: 17, firstTokenMs: 346, firstTokenBestMs: 32,
            powerWatts: 1101, powerLimitWatts: 1100, gpuName: "RTX PRO 6000 Blackwell", gpus: gpus,
            memoryUsedBytes: gpus.reduce(0) { $0 + $1.memoryUsedMib } * mib,
            memoryTotalBytes: gpus.reduce(0) { $0 + $1.memoryTotalMib } * mib,
            decodeSeries: series, decodeSeriesStartMs: (now / step) * step + step - 288 * step, decodeSeriesStepMs: step,
            tokens: tokenHistory, generatedAtMs: now
        )
    }

    static var idleDashboard: LocalDashboard {
        var idle = dashboard
        idle.engines = []
        idle.decodeTps = nil
        idle.perRequestTps = nil
        idle.running = nil
        idle.runningPeak = nil
        idle.waiting = nil
        idle.kvPercent = nil
        idle.kvPeakPercent = nil
        idle.firstTokenMs = nil
        idle.firstTokenBestMs = nil
        idle.powerWatts = 248
        idle.gpus = idle.gpus.map { gpu in
            var cool = gpu
            cool.powerWatts = 62
            cool.memoryUsedMib = 600
            return cool
        }
        idle.memoryUsedBytes = 4 * 600 * mib
        idle.decodeSeries = idle.decodeSeries.enumerated().map { $0.offset < 200 ? $0.element : 0 }
        return idle
    }
}
