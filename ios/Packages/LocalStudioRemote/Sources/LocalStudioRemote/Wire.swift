import Foundation

public enum AccessMode: String, WireEnum {
    case supervised
    case autoAcceptEdits
    case auto
    case fullAccess
}

public enum Shelf: String, WireEnum {
    case pinned
    case active
    case working
    case snoozed
    case settled
}

public enum ThreadStatus: String, WireEnum {
    case idle
    case working
    case approval
    case failed
    case done
    case woke
    case monitoring
}

public enum NotificationKind: String, WireEnum {
    case turnDone = "turn_done"
    case needsApproval = "needs_approval"
    case needsAnswer = "needs_answer"
    case failed
}

public enum Delivery: String, WireEnum {
    case queue
    case steer
    case `default`
}

public enum ApprovalAnswer: String, WireEnum {
    case approve
    case deny
    case alwaysAllowSession = "always_allow_session"
}

public enum ToolState: String, WireEnum {
    case pending
    case running
    case succeeded
    case failed
    case aborted
}

public enum ToolKind: String, WireEnum {
    case read
    case edit
    case command
    case search
    case web
    case agent
    case other
}

public enum NoticeLevel: String, WireEnum {
    case info
    case warning
    case error
}

public struct ModelRef: Codable, Sendable, Hashable {
    public var provider: String
    public var id: String
    public var name: String?
    public var reasoning: Bool
}

public struct ContextUsage: Codable, Sendable, Hashable {
    public var tokens: UInt64
    public var window: UInt64
}

public struct Project: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var path: String
    public var icon: String?
    public var isGit: Bool
}

public struct PullRequest: Codable, Sendable, Hashable {
    public var number: UInt64
    public var title: String
    public var url: String
    public var state: String
    public var checks: String
    public var head: String
    public var base: String
}

public struct ThreadRow: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var project: String?
    public var title: String
    public var shelf: Shelf
    public var status: ThreadStatus
    public var statusSince: Int64?
    public var updatedAt: Int64
    public var snoozedUntil: Int64?
    public var pinned: Bool
    public var unread: Bool
    public var branch: String?
    public var worktree: String?
    public var provider: String?
    public var model: String?
    public var additions: UInt32
    public var deletions: UInt32
    public var note: String?
    public var archived: Bool
    public var autoSettle: Bool
    public var liveAgents: UInt32
    public var fanOut: String?
    public var pullRequest: PullRequest?
}

public struct Goal: Codable, Sendable, Hashable {
    public var objective: String
    public var status: String
    public var active: Bool
    public var tokensUsed: UInt64
    public var tokenBudget: UInt64?
    public var timeUsedSeconds: UInt64
}

public struct ThreadInfo: Codable, Sendable, Hashable {
    public var thread: String
    public var project: String?
    public var title: String
    public var cwd: String
    public var model: ModelRef?
    public var thinkingLevel: String
    public var thinkingLevels: [String]
    public var access: AccessMode
    public var busy: Bool
    public var runStartedAt: Int64?
    public var compacting: Bool
    public var retryAttempt: UInt32
    public var queued: UInt32
    public var context: ContextUsage?
    public var branch: String?
    public var worktree: String?
    public var serviceTier: String?
    public var serviceTiers: [String]
    public var goal: Goal?
}

public struct QueuedMessage: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var text: String
    public var steering: Bool
    public var sending: Bool
}

public struct ModelKey: Codable, Sendable, Hashable {
    public var provider: String
    public var model: String
}

public struct ModelOption: Codable, Sendable, Hashable {
    public var provider: String
    public var id: String
    public var name: String
    public var reasoning: Bool
    public var thinkingLevels: [String]
    public var contextWindow: UInt64
    public var configured: Bool
    public var serviceTiers: [String]
}

public struct ImageAttachment: Codable, Sendable, Hashable {
    public var mimeType: String
    public var data: Data

    public init(mimeType: String, data: Data) {
        self.mimeType = mimeType
        self.data = data
    }
}

public struct PromptDraft: Codable, Sendable, Hashable {
    public var text: String
    public var images: [ImageAttachment]
    public var files: [String]

    public init(text: String, images: [ImageAttachment] = [], files: [String] = []) {
        self.text = text
        self.images = images
        self.files = files
    }
}

public enum WorktreeChoice: Codable, Sendable, Hashable {
    case local
    case newWorktree(branch: String, base: String?)
    case existing(path: String)
    case `default`

    public init(from decoder: any Decoder) throws {
        let keyed = try decoder.container(keyedBy: TypeKey.self)
        switch WireName.fold(try keyed.tag()) {
        case "local": self = .local
        case "newworktree": self = .newWorktree(branch: try keyed.value("branch"), base: try keyed.optional("base"))
        case "existing": self = .existing(path: try keyed.value("path"))
        default: self = .default
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var keyed = encoder.container(keyedBy: TypeKey.self)
        switch self {
        case .local:
            try keyed.tag("local")
        case let .newWorktree(branch, base):
            try keyed.tag("new_worktree")
            try keyed.put(branch, "branch")
            try keyed.put(base, "base")
        case let .existing(path):
            try keyed.tag("existing")
            try keyed.put(path, "path")
        case .default:
            try keyed.tag("default")
        }
    }
}

public struct ThreadSettings: Codable, Sendable, Hashable {
    public var provider: String?
    public var model: String?
    public var thinkingLevel: String?
    public var access: AccessMode
    public var worktree: WorktreeChoice

    public init(provider: String? = nil, model: String? = nil, thinkingLevel: String? = nil, access: AccessMode = .supervised, worktree: WorktreeChoice = .default) {
        self.provider = provider
        self.model = model
        self.thinkingLevel = thinkingLevel
        self.access = access
        self.worktree = worktree
    }
}

public enum Block: Codable, Sendable, Hashable {
    case text(String)
    case thinking(String)

    public var text: String {
        switch self {
        case let .text(text), let .thinking(text): text
        }
    }

    public init(from decoder: any Decoder) throws {
        let keyed = try decoder.container(keyedBy: TypeKey.self)
        let text: String = try keyed.value("text")
        self = WireName.fold(try keyed.tag()) == "thinking" ? .thinking(text) : .text(text)
    }

    public func encode(to encoder: any Encoder) throws {
        var keyed = encoder.container(keyedBy: TypeKey.self)
        switch self {
        case let .text(text):
            try keyed.tag("text")
            try keyed.put(text, "text")
        case let .thinking(text):
            try keyed.tag("thinking")
            try keyed.put(text, "text")
        }
    }
}

public struct ImageThumbnail: Codable, Sendable, Hashable {
    public var mimeType: String
    public var data: Data
    public var width: UInt32
    public var height: UInt32
}

public struct FileChange: Codable, Sendable, Hashable {
    public var path: String
    public var additions: UInt32
    public var deletions: UInt32
    public var diff: String
}

public struct UserItem: Codable, Sendable, Hashable {
    public var text: String
    public var images: UInt32
    public var entry: String?
    public var thumbnails: [ImageThumbnail]
}

public struct AssistantItem: Codable, Sendable, Hashable {
    public var blocks: [Block]
    public var streaming: Bool
    public var error: String?
    public var changedFiles: [FileChange]
}

public struct ToolItem: Codable, Sendable, Hashable {
    public var callId: String
    public var name: String
    public var kind: ToolKind
    public var summary: String
    public var arguments: String
    public var state: ToolState
    public var output: String
    public var fileChange: FileChange?
    public var startedAt: Int64?
    public var endedAt: Int64?
}

public struct TurnSummaryItem: Codable, Sendable, Hashable {
    public var turn: UInt64
    public var durationMs: UInt64
    public var toolCount: UInt32
}

public struct NoticeItem: Codable, Sendable, Hashable {
    public var level: NoticeLevel
    public var text: String
}

public struct CompactionItem: Codable, Sendable, Hashable {
    public var summary: String
    public var tokensBefore: UInt64
}

public enum ItemKind: Codable, Sendable, Hashable {
    case user(UserItem)
    case assistant(AssistantItem)
    case tool(ToolItem)
    case turnSummary(TurnSummaryItem)
    case notice(NoticeItem)
    case compaction(CompactionItem)

    public init(from decoder: any Decoder) throws {
        let keyed = try decoder.container(keyedBy: TypeKey.self)
        let tag = try keyed.tag()
        switch WireName.fold(tag) {
        case "user": self = .user(try UserItem(from: decoder))
        case "assistant": self = .assistant(try AssistantItem(from: decoder))
        case "tool": self = .tool(try ToolItem(from: decoder))
        case "turnsummary": self = .turnSummary(try TurnSummaryItem(from: decoder))
        case "notice": self = .notice(try NoticeItem(from: decoder))
        case "compaction": self = .compaction(try CompactionItem(from: decoder))
        default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "unknown item kind \(tag)"))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var keyed = encoder.container(keyedBy: TypeKey.self)
        switch self {
        case let .user(value):
            try keyed.tag("user")
            try value.encode(to: encoder)
        case let .assistant(value):
            try keyed.tag("assistant")
            try value.encode(to: encoder)
        case let .tool(value):
            try keyed.tag("tool")
            try value.encode(to: encoder)
        case let .turnSummary(value):
            try keyed.tag("turn_summary")
            try value.encode(to: encoder)
        case let .notice(value):
            try keyed.tag("notice")
            try value.encode(to: encoder)
        case let .compaction(value):
            try keyed.tag("compaction")
            try value.encode(to: encoder)
        }
    }
}

public struct Item: Codable, Sendable, Hashable, Identifiable {
    public var id: UInt64
    public var turn: UInt64
    public var createdAt: Int64?
    public var kind: ItemKind
}

public enum TranscriptOp: Codable, Sendable, Hashable {
    case reset(items: [Item], earlier: Int)
    case insert(index: Int, item: Item)
    case update(index: Int, item: Item)

    public init(from decoder: any Decoder) throws {
        let keyed = try decoder.container(keyedBy: TypeKey.self)
        let tag = try keyed.tag()
        switch WireName.fold(tag) {
        case "reset": self = .reset(items: try keyed.list("items"), earlier: try keyed.optional("earlier") ?? 0)
        case "insert": self = .insert(index: try keyed.value("index"), item: try keyed.value("item"))
        case "update": self = .update(index: try keyed.value("index"), item: try keyed.value("item"))
        default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "unknown transcript op \(tag)"))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var keyed = encoder.container(keyedBy: TypeKey.self)
        switch self {
        case let .reset(items, earlier):
            try keyed.tag("reset")
            try keyed.put(items, "items")
            try keyed.put(earlier, "earlier")
        case let .insert(index, item):
            try keyed.tag("insert")
            try keyed.put(index, "index")
            try keyed.put(item, "item")
        case let .update(index, item):
            try keyed.tag("update")
            try keyed.put(index, "index")
            try keyed.put(item, "item")
        }
    }
}

public struct Approval: Codable, Sendable, Hashable, Identifiable {
    public var requestId: String
    public var step: UInt64
    public var command: String
    public var effects: [String]
    public var agent: String?

    public var id: String { requestId }
}

public enum Connection: Codable, Sendable, Hashable {
    case connecting
    case ready
    case lost(reason: String)

    public init(from decoder: any Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let text = try? single.decode(String.self) {
            self = WireName.fold(text) == "ready" ? .ready : .connecting
            return
        }
        let keyed = try decoder.container(keyedBy: TypeKey.self)
        switch WireName.fold(try keyed.tag()) {
        case "ready": self = .ready
        case "lost": self = .lost(reason: try keyed.optional("reason") ?? "")
        default: self = .connecting
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var keyed = encoder.container(keyedBy: TypeKey.self)
        switch self {
        case .connecting:
            try keyed.tag("connecting")
        case .ready:
            try keyed.tag("ready")
        case let .lost(reason):
            try keyed.tag("lost")
            try keyed.put(reason, "reason")
        }
    }
}

public struct StudioNotification: Codable, Sendable, Hashable {
    public var thread: String
    public var kind: NotificationKind
    public var title: String
    public var body: String
}

public struct ModelCatalog: Codable, Sendable, Hashable {
    public var models: [ModelOption]
    public var favorites: [ModelKey]
    public var hidden: [ModelKey]

    public init(models: [ModelOption] = [], favorites: [ModelKey] = [], hidden: [ModelKey] = []) {
        self.models = models
        self.favorites = favorites
        self.hidden = hidden
    }
}

public enum Update: Decodable, Sendable {
    case connection(Connection)
    case projects([Project])
    case threads([ThreadRow])
    case threadStarted(draft: String, thread: String)
    case thread(thread: String, info: ThreadInfo)
    case transcript(thread: String, op: TranscriptOp)
    case approvals(thread: String, approvals: [Approval])
    case queue(thread: String, queued: [QueuedMessage])
    case composerText(thread: String, text: String)
    case models(ModelCatalog)
    case daemonDefault(model: ModelKey?, thinkingLevel: String?)
    case notification(StudioNotification)
    case requestDone(request: String, message: String)
    case requestFailed(request: String, message: String)
    case notice(level: NoticeLevel, text: String)
    case other(String)

    public init(from decoder: any Decoder) throws {
        let keyed = try decoder.container(keyedBy: TypeKey.self)
        let tag = try keyed.tag()
        switch WireName.fold(tag) {
        case "connection": self = .connection(try keyed.value("state"))
        case "projects": self = .projects(try keyed.list("projects"))
        case "threads": self = .threads(try keyed.list("threads"))
        case "threadstarted": self = .threadStarted(draft: try keyed.value("draft"), thread: try keyed.value("thread"))
        case "thread": self = .thread(thread: try keyed.value("thread"), info: try keyed.value("info"))
        case "transcript": self = .transcript(thread: try keyed.value("thread"), op: try keyed.value("op"))
        case "approvals": self = .approvals(thread: try keyed.value("thread"), approvals: try keyed.list("approvals"))
        case "queue": self = .queue(thread: try keyed.value("thread"), queued: try keyed.list("queued"))
        case "composertext": self = .composerText(thread: try keyed.value("thread"), text: try keyed.value("text"))
        case "models": self = .models(try ModelCatalog(from: decoder))
        case "daemondefault": self = .daemonDefault(model: try keyed.optional("model"), thinkingLevel: try keyed.optional("thinkingLevel"))
        case "notification": self = .notification(try StudioNotification(from: decoder))
        case "requestdone": self = .requestDone(request: try keyed.value("request"), message: try keyed.optional("message") ?? "")
        case "requestfailed": self = .requestFailed(request: try keyed.value("request"), message: try keyed.optional("message") ?? "")
        case "notice": self = .notice(level: try keyed.value("level"), text: try keyed.value("text"))
        default: self = .other(tag)
        }
    }
}
