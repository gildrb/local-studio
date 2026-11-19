import Foundation

public struct TranscriptWindow: Codable, Sendable, Hashable {
    public var earlier: Int
    public var items: [Item]

    public init(earlier: Int = 0, items: [Item] = []) {
        self.earlier = earlier
        self.items = items
    }

    public var total: Int { earlier + items.count }

    public mutating func apply(_ op: TranscriptOp) {
        switch op {
        case let .reset(items, earlier):
            self.items = items
            self.earlier = earlier
        case let .insert(index, item):
            let local = index - earlier
            if local < 0 {
                earlier += 1
            } else if local <= items.count {
                items.insert(item, at: local)
            } else {
                items.append(item)
            }
        case let .update(index, item):
            let local = index - earlier
            if items.indices.contains(local) {
                items[local] = item
            }
        }
    }

    public mutating func prepend(_ page: LoadEarlierResult, before: Int) -> Bool {
        guard before == earlier, page.start <= before, page.items.count == before - page.start else {
            return false
        }
        items = page.items + items
        earlier = page.start
        return true
    }

    func trimmed(to limit: Int) -> TranscriptWindow {
        guard items.count > limit else {
            return self
        }
        return TranscriptWindow(earlier: earlier + items.count - limit, items: Array(items.suffix(limit)))
    }
}

public struct MachineRecord: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var machine: MachineIdentity?
}

struct MachineCache: Codable, Sendable {
    var projects: [Project]
    var threads: [ThreadRow]
    var transcripts: [String: TranscriptWindow]
    var infos: [String: ThreadInfo]
    var savedAt: Date
}

actor CacheStore {
    private let directory: URL

    init(directory: URL) {
        self.directory = directory
    }

    nonisolated static func machinesFile(in directory: URL) -> URL {
        directory.appendingPathComponent("machines.json")
    }

    nonisolated static func cacheFile(in directory: URL, machine: String) -> URL {
        directory.appendingPathComponent("machine-\(machine).json")
    }

    nonisolated static func outboxFile(in directory: URL, machine: String) -> URL {
        directory.appendingPathComponent("outbox-\(machine).json")
    }

    nonisolated static func loadMachines(in directory: URL) -> [MachineRecord] {
        guard let data = try? Data(contentsOf: machinesFile(in: directory)) else {
            return []
        }
        return (try? JSONDecoder().decode([MachineRecord].self, from: data)) ?? []
    }

    nonisolated static func loadCache(in directory: URL, machine: String) -> MachineCache? {
        guard let data = try? Data(contentsOf: cacheFile(in: directory, machine: machine)) else {
            return nil
        }
        return try? JSONDecoder().decode(MachineCache.self, from: data)
    }

    func saveMachines(_ records: [MachineRecord]) {
        write(records, to: Self.machinesFile(in: directory))
    }

    func saveCache(_ cache: MachineCache, machine: String) {
        write(cache, to: Self.cacheFile(in: directory, machine: machine))
    }

    func removeCache(machine: String) {
        try? FileManager.default.removeItem(at: Self.cacheFile(in: directory, machine: machine))
        try? FileManager.default.removeItem(at: Self.outboxFile(in: directory, machine: machine))
    }

    private func write<T: Encodable>(_ value: T, to file: URL) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try JSONEncoder().encode(value).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            return
        }
    }
}
