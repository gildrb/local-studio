import Foundation
import LocalStudioKit
import Observation

enum TerminalStatus: Equatable {
    case starting
    case running
    case exited(Int32?)
    case closed
    case failed(String)

    var message: String? {
        switch self {
        case .starting, .running: nil
        case .exited: "Process exited"
        case .closed: "Terminal closed"
        case .failed(let message): message
        }
    }
}

enum TerminalAxis {
    case sideBySide
    case stacked
}

@MainActor
@Observable
final class TerminalSession: Identifiable {
    static let scrollbackLimit = 2 * 1024 * 1024

    let id = UUID().uuidString
    let project: String
    let ordinal: Int
    var title: String?
    private(set) var terminal: String?
    private(set) var status = TerminalStatus.starting

    @ObservationIgnored var request: String?
    @ObservationIgnored var selection: (() -> String?)?
    @ObservationIgnored private(set) var buffer = Data()
    @ObservationIgnored private(set) var columns: UInt16 = 100
    @ObservationIgnored private(set) var rows: UInt16 = 24
    @ObservationIgnored private var sink: ((Data) -> Void)?
    @ObservationIgnored private var sinkOwner: ObjectIdentifier?
    @ObservationIgnored private var pendingInput = Data()
    @ObservationIgnored private var sizeDirty = false
    @ObservationIgnored private weak var workspace: WorkspaceStore?

    init(project: String, ordinal: Int, workspace: WorkspaceStore) {
        self.project = project
        self.ordinal = ordinal
        self.workspace = workspace
    }

    var label: String {
        if let title, !title.isEmpty { return title }
        return "Terminal \(ordinal)"
    }

    func recentOutput(lines limit: Int = 80) -> String {
        let tail = buffer.suffix(64 * 1024)
        let raw = String(bytes: tail, encoding: .utf8) ?? String(bytes: tail, encoding: .isoLatin1) ?? ""
        let plain = raw
            .replacingOccurrences(of: #"\x{1B}\[[0-?]*[ -/]*[@-~]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\x{1B}\][^\x{07}\x{1B}]*(\x{07}|\x{1B}\\)"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\x{1B}[@-_]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "\r\n", with: "\n")
        let rows = plain.split(separator: "\n", omittingEmptySubsequences: false).map { row in
            String(row.split(separator: "\r", omittingEmptySubsequences: false).last ?? "")
        }
        var kept = Array(rows.suffix(limit))
        while kept.last?.trimmingCharacters(in: .whitespaces).isEmpty == true {
            kept.removeLast()
        }
        while kept.first?.trimmingCharacters(in: .whitespaces).isEmpty == true {
            kept.removeFirst()
        }
        return kept.joined(separator: "\n")
    }

    var chatContext: String {
        if let selected = selection?(), !selected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return selected
        }
        return recentOutput()
    }

    var text: String {
        String(bytes: buffer, encoding: .utf8) ?? String(bytes: buffer, encoding: .isoLatin1) ?? ""
    }

    func bind(_ terminal: String) {
        self.terminal = terminal
        guard status == .starting else {
            workspace?.command { $0.closeTerminal(terminal: terminal) }
            return
        }
        status = .running
        if sizeDirty {
            sizeDirty = false
            workspace?.command { $0.resizeTerminal(terminal: terminal, cols: columns, rows: rows) }
        }
        if !pendingInput.isEmpty {
            let input = pendingInput
            pendingInput.removeAll()
            workspace?.command { $0.writeTerminal(terminal: terminal, data: input) }
        }
    }

    func receive(_ data: Data) {
        buffer.append(data)
        if buffer.count > Self.scrollbackLimit {
            buffer.removeSubrange(0..<(buffer.count - Self.scrollbackLimit / 2))
        }
        sink?(data)
    }

    func write(_ data: Data) {
        switch status {
        case .starting:
            pendingInput.append(data)
        case .running:
            guard let terminal else { return }
            workspace?.command { $0.writeTerminal(terminal: terminal, data: data) }
        case .exited, .closed, .failed:
            break
        }
    }

    func resize(columns: Int, rows: Int) {
        let columns = UInt16(clamping: max(columns, 2))
        let rows = UInt16(clamping: max(rows, 1))
        guard columns != self.columns || rows != self.rows else { return }
        self.columns = columns
        self.rows = rows
        guard status == .running, let terminal else {
            sizeDirty = true
            return
        }
        workspace?.command { $0.resizeTerminal(terminal: terminal, cols: columns, rows: rows) }
    }

    func attach(_ owner: AnyObject, sink: @escaping (Data) -> Void) {
        sinkOwner = ObjectIdentifier(owner)
        self.sink = sink
    }

    func detach(_ owner: AnyObject) {
        guard sinkOwner == ObjectIdentifier(owner) else { return }
        sinkOwner = nil
        sink = nil
    }

    func exited(code: Int32?) {
        if status != .closed {
            status = .exited(code)
        }
    }

    func failed(_ message: String) {
        status = .failed(message)
    }

    func close() {
        switch status {
        case .running:
            status = .closed
            if let terminal {
                workspace?.command { $0.closeTerminal(terminal: terminal) }
            }
        case .starting:
            status = .closed
        case .exited, .closed, .failed:
            break
        }
        workspace?.forget(self)
        sink = nil
    }
}

@MainActor
@Observable
final class TerminalGroup: Identifiable {
    let id = UUID().uuidString
    private(set) var sessions: [TerminalSession] = []
    private(set) var axis = TerminalAxis.sideBySide
    var focused: String?

    @ObservationIgnored private weak var deck: TerminalDeck?

    init(deck: TerminalDeck) {
        self.deck = deck
    }

    var title: String {
        guard let first = sessions.first else { return "Terminal" }
        return sessions.count > 1 ? "\(first.label) +\(sessions.count - 1)" : first.label
    }

    var focusedSession: TerminalSession? {
        sessions.first { $0.id == focused } ?? sessions.last
    }

    @discardableResult
    func add(axis: TerminalAxis?) -> TerminalSession? {
        guard let session = deck?.makeSession() else { return nil }
        if let axis {
            self.axis = axis
        }
        sessions.append(session)
        focused = session.id
        return session
    }

    func close(_ session: TerminalSession) {
        session.close()
        sessions.removeAll { $0.id == session.id }
        if focused == session.id {
            focused = sessions.last?.id
        }
    }

    func closeAll() {
        for session in sessions {
            session.close()
        }
        sessions.removeAll()
    }
}

@MainActor
@Observable
final class TerminalDeck {
    let project: String
    private(set) var groups: [TerminalGroup] = []
    var active: String?

    @ObservationIgnored private var ordinal = 0
    @ObservationIgnored private weak var workspace: WorkspaceStore?

    init(project: String, workspace: WorkspaceStore?) {
        self.project = project
        self.workspace = workspace
    }

    var activeGroup: TerminalGroup? {
        groups.first { $0.id == active } ?? groups.last
    }

    func makeSession() -> TerminalSession? {
        guard let workspace else { return nil }
        ordinal += 1
        return workspace.openTerminal(project: project, ordinal: ordinal)
    }

    @discardableResult
    func newTerminal() -> TerminalSession? {
        let group = TerminalGroup(deck: self)
        guard let session = group.add(axis: nil) else { return nil }
        groups.append(group)
        active = group.id
        return session
    }

    func split(_ axis: TerminalAxis) {
        guard let group = activeGroup else {
            newTerminal()
            return
        }
        group.add(axis: axis)
    }

    func closeFocused() {
        guard let group = activeGroup, let session = group.focusedSession else { return }
        close(session, in: group)
    }

    func close(_ session: TerminalSession, in group: TerminalGroup) {
        group.close(session)
        if group.sessions.isEmpty {
            remove(group)
        }
    }

    func remove(_ group: TerminalGroup) {
        group.closeAll()
        guard let index = groups.firstIndex(where: { $0.id == group.id }) else { return }
        groups.remove(at: index)
        if active == group.id {
            active = groups.indices.contains(index) ? groups[index].id : groups.last?.id
        }
    }
}
