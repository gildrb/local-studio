import AppKit
import Darwin
import Foundation
import LocalStudioKit

@MainActor
final class LogoLoad {
    private let store: StudioStore

    static let threads = 5
    static let window: TimeInterval = 10
    static let limit = 1.0

    init(store: StudioStore) {
        self.store = store
    }

    func start() {
        Task { await run() }
    }

    private func run() async {
        do {
            try await until("the core connection", 60) { store.connection == .ready }
            let window = try await launchedMainWindow(store)
            try await skipOnboarding(store, window)
            let project = try await addProject()
            try await startWorking(in: project)
            try await until("\(Self.threads) working rows", 90) { working().count >= Self.threads }
            try await Task.sleep(for: .seconds(8))
            let rows = working()
            guard rows.count >= Self.threads else { throw StressFailure("only \(rows.count) threads still working before the measurement") }
            let visible = store.shell.sidebarVisible && store.inbox.visibleOrder.prefix(Self.threads + 4).filter(rows.contains).count >= Self.threads
            let before = Self.cpuTime()
            let threadsBefore = Self.threadTimes()
            let started = ProcessInfo.processInfo.systemUptime
            try await Task.sleep(for: .seconds(Self.window))
            let percent = (Self.cpuTime() - before) / (ProcessInfo.processInfo.systemUptime - started) * 100
            let still = working().count
            let threadsAfter = Self.threadTimes()
            let busiest = threadsAfter.map { name, time in (name, time - (threadsBefore[name] ?? 0)) }.sorted { $0.1 > $1.1 }.prefix(6)
            print(String(format: "logo cpu: %.2f %% of one core over %.0f s with %d working rows in the sidebar (visible %@, %d still working at the end)", percent, Self.window, rows.count, visible ? "yes" : "no", still))
            print("busiest threads: " + busiest.map { String(format: "%@ %.0f ms", $0.0, $0.1 * 1_000) }.joined(separator: ", "))
            store.stop()
            guard visible, still >= Self.threads else {
                print("FAIL macOS logo load: the working rows were not all visible and working for the whole window")
                exit(1)
            }
            guard percent <= Self.limit else {
                print(String(format: "FAIL macOS logo load: %.2f %% CPU is above %.1f %%", percent, Self.limit))
                exit(1)
            }
            print("PASS macOS logo load")
            exit(0)
        } catch {
            print("FAIL macOS logo load: \(error)")
            store.stop()
            exit(1)
        }
    }

    private func working() -> [String] {
        store.inbox.threads.filter { $0.status == .working }.map(\.id)
    }

    private func addProject() async throws -> String {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        let path = (home as NSString).appendingPathComponent("stress/alpha")
        try? FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
        store.inbox.addProject(path: path)
        let canonical = URL(fileURLWithPath: path).resolvingSymlinksInPath().path
        let match = { [store] in store.inbox.projects.first { URL(fileURLWithPath: $0.path).resolvingSymlinksInPath().path == canonical } }
        try await until("project alpha", 20) { match() != nil }
        guard let project = match()?.id else { throw StressFailure("project alpha missing") }
        return project
    }

    private func startWorking(in project: String) async throws {
        let conversation = store.conversation
        conversation.loadModels()
        try await until("models", 20) { conversation.modelsLoaded }
        guard conversation.models.contains(where: { $0.provider == "anthropic" && $0.id == "claude-haiku-5-5" && $0.configured }) else {
            throw StressFailure("anthropic/claude-haiku-5-5 is not configured")
        }
        for index in 1...Self.threads {
            store.newThread(in: project)
            conversation.newThread.model = ModelKey(provider: "anthropic", model: "claude-haiku-5-5")
            conversation.newThread.thinkingLevel = "low"
            conversation.newThread.access = .fullAccess
            let text = "Run exactly this one shell command and nothing else, then reply with the single word done: sleep 75 (\(index))"
            let known = Set(store.inbox.threads.map(\.id))
            conversation.composer(project: project).text = text
            conversation.submit(project: project, alternate: false, settings: store.pages.settings)
            try await until("a thread for “\(text)”", 30) {
                guard let thread = conversation.thread else { return false }
                return !known.contains(thread)
            }
        }
    }

    private static func cpuTime() -> TimeInterval {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        let user = TimeInterval(usage.ru_utime.tv_sec) + TimeInterval(usage.ru_utime.tv_usec) / 1_000_000
        let system = TimeInterval(usage.ru_stime.tv_sec) + TimeInterval(usage.ru_stime.tv_usec) / 1_000_000
        return user + system
    }

    private static func threadTimes() -> [String: TimeInterval] {
        var list: thread_act_array_t?
        var count: mach_msg_type_number_t = 0
        guard task_threads(mach_task_self_, &list, &count) == KERN_SUCCESS, let list else { return [:] }
        defer {
            vm_deallocate(mach_task_self_, vm_address_t(UInt(bitPattern: list)), vm_size_t(Int(count) * MemoryLayout<thread_t>.stride))
        }
        var times: [String: TimeInterval] = [:]
        for index in 0..<Int(count) {
            let thread = list[index]
            var info = thread_extended_info()
            var size = mach_msg_type_number_t(MemoryLayout<thread_extended_info>.size / MemoryLayout<integer_t>.size)
            let status = withUnsafeMutablePointer(to: &info) { pointer in
                pointer.withMemoryRebound(to: integer_t.self, capacity: Int(size)) { thread_info(thread, thread_flavor_t(THREAD_EXTENDED_INFO), $0, &size) }
            }
            mach_port_deallocate(mach_task_self_, thread)
            guard status == KERN_SUCCESS else { continue }
            let name = withUnsafeBytes(of: info.pth_name) { String(bytes: $0.prefix { $0 != 0 }, encoding: .utf8) } ?? ""
            times["\(name.isEmpty ? "thread" : name)#\(thread)"] = TimeInterval(info.pth_user_time + info.pth_system_time) / 1_000_000_000
        }
        return times
    }
}
