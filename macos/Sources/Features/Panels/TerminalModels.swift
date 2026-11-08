import AppKit
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

enum TerminalTextRequest {
    case selection
    case recent(UInt32)
}

struct TerminalDamage {
    let full: Bool
    let rows: IndexSet
    let previousCursor: TerminalCursor
}

@MainActor
final class TerminalGrid {
    static let hiddenCursor = TerminalCursor(column: 0, row: 0, visible: false, shape: .block, blinking: false, wide: false)

    private(set) var columns = 0
    private(set) var rows: [TerminalRow] = []
    private(set) var cursor = TerminalGrid.hiddenCursor
    private(set) var hasSelection = false
    private(set) var mouseTracking = false
    private(set) var scrollbackLength: UInt64 = 0
    private(set) var viewportOffset: UInt64 = 0

    func apply(_ frame: TerminalFrame) -> TerminalDamage {
        let full = frame.full || Int(frame.cols) != columns || Int(frame.rows) != rows.count
        if full {
            rows = (0..<Int(frame.rows)).map { TerminalRow(index: UInt16($0), runs: [], selection: nil) }
        }
        columns = Int(frame.cols)
        var changed = IndexSet()
        for row in frame.dirty where Int(row.index) < rows.count {
            rows[Int(row.index)] = row
            changed.insert(Int(row.index))
        }
        let previous = cursor
        cursor = frame.cursor
        hasSelection = frame.hasSelection
        mouseTracking = frame.mouseTracking
        scrollbackLength = frame.scrollbackLen
        viewportOffset = frame.viewportOffset
        return TerminalDamage(full: full, rows: changed, previousCursor: previous)
    }

    var lines: [String] {
        rows.map(Self.text)
    }

    static func text(_ row: TerminalRow) -> String {
        var line = ""
        var column = 0
        for run in row.runs {
            if Int(run.column) > column {
                line += String(repeating: " ", count: Int(run.column) - column)
            }
            line += run.text
            column = Int(run.column) + Int(run.cells)
        }
        return line
    }
}

@MainActor
@Observable
final class TerminalSession: Identifiable {
    static let recentLines: UInt32 = 80

    let id = UUID().uuidString
    let project: String
    let ordinal: Int
    var title: String?
    private(set) var terminal: String?
    private(set) var status = TerminalStatus.starting

    @ObservationIgnored var request: String?
    @ObservationIgnored var focusOnAttach = true
    @ObservationIgnored let grid = TerminalGrid()
    @ObservationIgnored private(set) var size = TerminalSize(cols: 100, rows: 24, cellWidth: 16, cellHeight: 32)
    @ObservationIgnored private var sink: ((TerminalDamage) -> Void)?
    @ObservationIgnored private var sinkOwner: ObjectIdentifier?
    @ObservationIgnored private var pendingInput = Data()
    @ObservationIgnored private var sizeDirty = false
    @ObservationIgnored private(set) var appliedFrames = 0
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

    var columns: UInt16 { size.cols }
    var rows: UInt16 { size.rows }

    func bind(_ terminal: String) {
        self.terminal = terminal
        guard status == .starting else {
            workspace?.command { $0.closeTerminal(terminal: terminal) }
            return
        }
        status = .running
        if sizeDirty {
            sizeDirty = false
            let size = size
            workspace?.command { $0.resizeTerminal(terminal: terminal, size: size) }
        }
        if !pendingInput.isEmpty {
            let input = pendingInput
            pendingInput.removeAll()
            workspace?.command { $0.writeTerminal(terminal: terminal, data: input) }
        }
    }

    func apply(_ frame: TerminalFrame) {
        appliedFrames += 1
        let damage = grid.apply(frame)
        if let title = frame.title, !title.isEmpty, title != self.title {
            self.title = title
        }
        if frame.bell {
            NSSound.beep()
        }
        sink?(damage)
    }

    func write(_ data: Data) {
        switch status {
        case .starting:
            pendingInput.append(data)
        case .running:
            send { $0.writeTerminal(terminal: $1, data: data) }
        case .exited, .closed, .failed:
            break
        }
    }

    func key(_ key: TerminalKey) {
        send { $0.terminalKey(terminal: $1, key: key) }
    }

    func paste(_ text: String) {
        send { $0.terminalPaste(terminal: $1, text: text) }
    }

    func mouse(_ mouse: TerminalMouse) {
        send { $0.terminalMouse(terminal: $1, mouse: mouse) }
    }

    func scroll(_ scroll: TerminalScroll) {
        send { $0.terminalScroll(terminal: $1, scroll: scroll) }
    }

    func focus(_ focused: Bool) {
        send { $0.terminalFocus(terminal: $1, focused: focused) }
    }

    func select(_ selection: TerminalSelect) {
        send { $0.terminalSelect(terminal: $1, selection: selection) }
    }

    func resize(columns: Int, rows: Int, cellWidth: UInt32, cellHeight: UInt32) {
        let next = TerminalSize(cols: UInt16(clamping: max(columns, 2)), rows: UInt16(clamping: max(rows, 1)), cellWidth: max(cellWidth, 1), cellHeight: max(cellHeight, 1))
        guard next != size else { return }
        size = next
        guard status == .running, let terminal else {
            sizeDirty = true
            return
        }
        workspace?.command { $0.resizeTerminal(terminal: terminal, size: next) }
    }

    func requestText(_ kind: TerminalTextRequest, completion: @escaping @MainActor (String) -> Void) {
        guard let terminal, let workspace else { return }
        workspace.requestTerminalText(completion) { studio, request in
            switch kind {
            case .selection:
                studio.terminalSelectionText(request: request, terminal: terminal)
            case .recent(let lines):
                studio.terminalRecentOutput(request: request, terminal: terminal, lines: lines)
            }
        }
    }

    func addToChat(_ panels: PanelState) {
        let label = label
        requestText(grid.hasSelection ? .selection : .recent(Self.recentLines)) { text in
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            panels.addToChat(text, source: label)
        }
    }

    func copy(_ kind: TerminalTextRequest) {
        requestText(kind) { text in
            guard !text.isEmpty else { return }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        }
    }

    func attach(_ owner: AnyObject, sink: @escaping (TerminalDamage) -> Void) {
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
        case .running, .exited:
            status = .closed
            if let terminal {
                workspace?.command { $0.closeTerminal(terminal: terminal) }
            }
        case .starting:
            status = .closed
        case .closed, .failed:
            break
        }
        workspace?.forget(self)
        sink = nil
    }

    private func send(_ call: @escaping (Studio, String) -> Void) {
        guard status == .running || isExited, let terminal else { return }
        workspace?.command { call($0, terminal) }
    }

    private var isExited: Bool {
        if case .exited = status { return true }
        return false
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

    func insert(_ session: TerminalSession) {
        sessions.append(session)
        focused = session.id
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

    func adopt(_ make: (Int) -> TerminalSession) {
        ordinal += 1
        let group = TerminalGroup(deck: self)
        group.insert(make(ordinal))
        groups.append(group)
        active = group.id
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
