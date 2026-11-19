import Foundation

public struct OutboxEntry: Codable, Sendable, Hashable, Identifiable {
    public var args: SendArgs
    public var created: Date
    /// The server epoch this send last went out in, once it has.
    public var sentEpoch: String?
    /// Sent in an earlier epoch and never acknowledged; waits for the user's Resend.
    public var unconfirmed: Bool?

    public var id: String { args.request }
}

public actor Outbox {
    private let file: URL
    private var entries: [OutboxEntry]

    public init(file: URL) {
        self.file = file
        if let data = try? Data(contentsOf: file), let saved = try? JSONDecoder().decode([OutboxEntry].self, from: data) {
            entries = saved
        } else {
            entries = []
        }
    }

    public func enqueue(thread: String, prompt: PromptDraft, delivery: Delivery) -> OutboxEntry {
        let entry = OutboxEntry(
            args: SendArgs(request: "ios-" + UUID().uuidString.lowercased(), thread: thread, prompt: prompt, delivery: delivery),
            created: Date()
        )
        entries.append(entry)
        persist()
        return entry
    }

    public func pending() -> [OutboxEntry] {
        entries
    }

    public func markSent(_ request: String, epoch: String) {
        update(request) { $0.sentEpoch = epoch }
    }

    public func markUnconfirmed(_ request: String) {
        update(request) { $0.unconfirmed = true }
    }

    /// Clears the unconfirmed mark so the send goes out again, and returns it.
    public func release(_ request: String) -> OutboxEntry? {
        update(request) {
            $0.unconfirmed = nil
            $0.sentEpoch = nil
        }
        return entries.first { $0.args.request == request }
    }

    private func update(_ request: String, _ change: (inout OutboxEntry) -> Void) {
        guard let index = entries.firstIndex(where: { $0.args.request == request }) else {
            return
        }
        change(&entries[index])
        persist()
    }

    public func remove(_ request: String) {
        entries.removeAll { $0.args.request == request }
        persist()
    }

    public func clear() {
        entries = []
        persist()
    }

    private func persist() {
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            if entries.isEmpty {
                try? FileManager.default.removeItem(at: file)
            } else {
                try JSONEncoder().encode(entries).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        } catch {
            return
        }
    }
}
