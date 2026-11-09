import AppKit
import LocalStudioKit

struct NavInput: Equatable {
    enum Key: Equatable {
        case up, down, left, right, enter, space, delete, escape, home, end
        case text(String)
    }

    let key: Key
    var command = false
    var control = false
    var option = false

    init(_ key: Key, command: Bool = false, control: Bool = false, option: Bool = false) {
        self.key = key
        self.command = command
        self.control = control
        self.option = option
    }

    init?(_ event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        command = flags.contains(.command)
        control = flags.contains(.control)
        option = flags.contains(.option)
        switch event.keyCode {
        case 126: key = .up
        case 125: key = .down
        case 123: key = .left
        case 124: key = .right
        case 36, 76: key = .enter
        case 49: key = .space
        case 51, 117: key = .delete
        case 53: key = .escape
        case 115: key = .home
        case 119: key = .end
        default:
            guard let characters = event.charactersIgnoringModifiers, !characters.isEmpty,
                  characters.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) && $0.value < 0xF700 }) else { return nil }
            key = .text(characters)
        }
    }

    var plain: Bool {
        !command && !control && !option
    }
}

extension StudioStore {
    var vimKeys: Bool {
        pages.settings?.vimMode == true
    }

    func routeKey(_ input: NavInput, responder: NSResponder?) -> Bool {
        if responder?.capturesKeys == true || responder is TerminalSurfaceView { return false }
        guard shell.route == .thread else { return false }
        switch shell.region {
        case .sidebar: return sidebarKey(input)
        case .timeline: return timelineKey(input)
        case .rightPanel:
            guard input.plain, input.key == .escape, responder == nil || responder is NSWindow else { return false }
            focus(conversation.thread == nil ? .composer : .timeline)
            return true
        case .composer, .terminal: return false
        }
    }

    private func vimListKey(_ text: String, region: FocusRegion) -> Bool? {
        guard vimKeys else { return nil }
        let keys = shell.keys
        let pending = keys.pendingG
        keys.pendingG = false
        switch text {
        case "j": moveCursor(region, 1)
        case "k": moveCursor(region, -1)
        case "G": cursorEdge(region, top: false)
        case "g":
            if pending { cursorEdge(region, top: true) } else { keys.pendingG = true }
        case "h": cycleFocus(-1)
        case "l": cycleFocus(1)
        case "/": focusSidebarSearch()
        case "i", "a": focus(.composer)
        default: return nil
        }
        return true
    }

    private func sidebarKey(_ input: NavInput) -> Bool {
        guard input.plain else { return false }
        switch input.key {
        case .down: moveCursor(.sidebar, 1)
        case .up: moveCursor(.sidebar, -1)
        case .home: cursorEdge(.sidebar, top: true)
        case .end: cursorEdge(.sidebar, top: false)
        case .right: cycleFocus(1)
        case .left: return false
        case .enter: openSidebarCursor(peek: false)
        case .space: openSidebarCursor(peek: true)
        case .delete: archiveSidebarCursor()
        case .escape: focus(conversation.thread == nil ? .composer : .timeline)
        case .text(let text):
            if let handled = vimListKey(text, region: .sidebar) { return handled }
            if vimKeys { return true }
            if text == "/" {
                focus(.composer)
            } else {
                inbox.query += text
                focusSidebarSearch()
            }
        }
        return true
    }

    private func timelineKey(_ input: NavInput) -> Bool {
        if input.command, !input.control, !input.option, input.key == .text("c") {
            return copyTimelineMessage()
        }
        guard input.plain else { return false }
        switch input.key {
        case .down: moveCursor(.timeline, 1)
        case .up: moveCursor(.timeline, -1)
        case .home: cursorEdge(.timeline, top: true)
        case .end: cursorEdge(.timeline, top: false)
        case .left: cycleFocus(-1)
        case .right: return false
        case .enter, .space: activateTimelineCursor()
        case .escape: focus(.composer)
        case .delete: return false
        case .text(let text):
            if let handled = vimListKey(text, region: .timeline) { return handled }
            if vimKeys { return true }
            focus(.composer)
            if text != "/", let composer = mainWindow?.firstResponder as? ComposerNSTextView {
                composer.insertText(text, replacementRange: composer.selectedRange())
            }
        }
        return true
    }

    func focusSidebarSearch() {
        if !shell.sidebarVisible { shell.sidebarVisible = true }
        shell.region = .sidebar
        shell.searchFocusRequest += 1
    }

    func moveCursor(_ region: FocusRegion, _ offset: Int) {
        switch region {
        case .sidebar:
            let order = inbox.visibleOrder
            guard !order.isEmpty else { return }
            guard let cursor = shell.sidebarCursor, let index = order.firstIndex(of: cursor) else {
                shell.sidebarCursor = offset > 0 ? order.first : order.last
                return
            }
            shell.sidebarCursor = order[min(max(index + offset, 0), order.count - 1)]
        case .timeline:
            let rows = conversation.rows
            guard !rows.isEmpty else { return }
            guard let cursor = shell.timelineCursor, let index = rows.firstIndex(where: { $0.id == cursor }) else {
                shell.timelineCursor = rows.last?.id
                return
            }
            shell.timelineCursor = rows[min(max(index + offset, 0), rows.count - 1)].id
        case .composer, .rightPanel, .terminal:
            return
        }
    }

    func cursorEdge(_ region: FocusRegion, top: Bool) {
        switch region {
        case .sidebar:
            shell.sidebarCursor = top ? inbox.visibleOrder.first : inbox.visibleOrder.last
        case .timeline:
            shell.timelineCursor = top ? conversation.rows.first?.id : conversation.rows.last?.id
        case .composer, .rightPanel, .terminal:
            return
        }
    }

    func openSidebarCursor(peek: Bool) {
        guard let cursor = shell.sidebarCursor, inbox.thread(cursor) != nil else { return }
        open(cursor)
        if peek {
            shell.region = .sidebar
        } else {
            focus(.composer)
        }
    }

    func archiveSidebarCursor() {
        guard let cursor = shell.sidebarCursor, let row = inbox.thread(cursor), row.status != .working else { return }
        shell.confirmation = .archive([row.id])
    }

    func activateTimelineCursor() {
        guard let cursor = shell.timelineCursor, let row = conversation.rows.first(where: { $0.id == cursor }) else { return }
        if case .fold(let entry, _) = row {
            conversation.toggleFold(entry.id)
        }
    }

    func copyTimelineMessage() -> Bool {
        guard let cursor = shell.timelineCursor, let row = conversation.rows.first(where: { $0.id == cursor }) else { return false }
        let text = row.copyText
        guard !text.isEmpty else { return false }
        copy(text)
        return true
    }
}

extension TimelineRow {
    @MainActor var copyText: String {
        switch self {
        case .entry(let entry, _): entry.item.kind.copyText
        case .tools(let entries): entries.map { $0.item.kind.copyText }.filter { !$0.isEmpty }.joined(separator: "\n")
        case .fold: ""
        }
    }
}

extension ItemKind {
    var copyText: String {
        switch self {
        case .user(let text, _, _, _): text
        case .assistant(let blocks, _, let error, _):
            blocks.compactMap { block in
                if case .text(let text) = block { return text }
                return nil
            }
            .joined(separator: "\n\n") + (error.map { "\n\n" + $0 } ?? "")
        case .tool(_, _, _, let summary, _, _, _, _, _, _): summary
        case .notice(_, let text): text
        case .compaction(let summary, _): summary
        case .turnSummary: ""
        }
    }
}
