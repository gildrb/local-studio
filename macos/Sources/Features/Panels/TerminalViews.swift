import AppKit
import LocalStudioKit
import SwiftTerm
import SwiftUI

struct TerminalActions {
    let new: () -> Void
    let splitSideBySide: () -> Void
    let splitStacked: () -> Void
    let close: () -> Void
    let attach: (TerminalSession) -> Void
    let commands: CommandRouter?
}

struct TerminalDrawerView: View {
    let store: StudioStore
    @State private var dragOrigin: CGFloat?
    @State private var columnBottom: CGFloat = 0

    private var panels: PanelState { store.workspace.panels }

    var body: some View {
        let limit = max(PanelState.minimumTerminalHeight, columnBottom * PanelState.maximumTerminalRatio)
        let height = min(max(panels.terminalHeight, PanelState.minimumTerminalHeight), limit)
        VStack(spacing: 0) {
            ResizeHandle(axis: .vertical, cursor: .rowResize, gesture: resize(limit: limit))
            if let project = panels.project {
                TerminalDeckView(deck: panels.decks[project], panels: panels, project: project)
            } else {
                PanelMessage(symbol: "terminal", title: "Terminals need a project.", detail: "Choose a project for this thread to open a shell in it.")
            }
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .background(Theme.canvas)
        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { columnBottom = $0 }
        .transaction { $0.disablesAnimations = true }
    }

    private func resize(limit: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
                let origin = dragOrigin ?? panels.terminalHeight
                dragOrigin = origin
                panels.terminalHeight = min(max(origin - value.translation.height, PanelState.minimumTerminalHeight), limit)
            }
            .onEnded { _ in dragOrigin = nil }
    }
}

private struct TerminalDeckView: View {
    let deck: TerminalDeck?
    let panels: PanelState
    let project: String

    var body: some View {
        let settings = panels.settings
        let actions = TerminalActions(
            new: { panels.deck(for: project).newTerminal() },
            splitSideBySide: { panels.deck(for: project).split(.sideBySide) },
            splitStacked: { panels.deck(for: project).split(.stacked) },
            close: { panels.deck(for: project).closeFocused() },
            attach: { panels.addToChat($0.chatContext, source: $0.label) },
            commands: panels.commands
        )
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                ScrollView(.horizontal) {
                    HStack(spacing: 2) {
                        ForEach(deck?.groups ?? []) { group in
                            TerminalGroupTab(group: group, active: group.id == deck?.activeGroup?.id) {
                                deck?.active = group.id
                            } close: {
                                deck?.remove(group)
                            }
                        }
                    }
                    .padding(.horizontal, 6)
                }
                .scrollIndicators(.never)
                TerminalToolbarButtons(actions: actions, focused: deck?.activeGroup?.focusedSession)
            }
            .padding(.trailing, 8)
            .frame(height: 34)
            PanelHairline()
            if let group = deck?.activeGroup {
                TerminalGroupView(group: group, settings: settings, actions: actions)
                    .id(group.id)
            } else {
                PanelMessage(symbol: "terminal", title: "No terminal sessions for this thread yet.", actionTitle: "New Terminal", action: actions.new)
            }
        }
    }
}

private struct TerminalGroupTab: View {
    let group: TerminalGroup
    let active: Bool
    let select: () -> Void
    let close: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: group.sessions.count > 1 ? (group.axis == .sideBySide ? "rectangle.split.2x1" : "rectangle.split.1x2") : "terminal")
                .font(.system(size: 11, weight: .light))
                .accessibilityHidden(true)
            Text(group.title)
                .font(.system(size: 12))
                .lineLimit(1)
                .frame(maxWidth: 150, alignment: .leading)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 8.5, weight: .medium))
                    .frame(width: 14, height: 14)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .opacity(active || hovering ? 1 : 0)
            .help("Close \(group.title)")
            .accessibilityLabel("Close \(group.title)")
        }
        .foregroundStyle(active ? Color.primary : Theme.secondaryText)
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .frame(height: 24)
        .rowSurface(selected: active, hovering: hovering)
        .contentShape(Rectangle())
        .onTapGesture(perform: select)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(group.title)
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { select() }
    }
}

private struct TerminalToolbarButtons: View {
    let actions: TerminalActions
    let focused: TerminalSession?

    var body: some View {
        PanelIconButton("Add to Chat", symbol: "text.bubble", enabled: focused != nil) {
            if let focused {
                actions.attach(focused)
            }
        }
        PanelIconButton("New Terminal (⌘N)", symbol: "plus", action: actions.new)
        PanelIconButton("Split Horizontally (⌘D)", symbol: "rectangle.split.2x1", action: actions.splitSideBySide)
        PanelIconButton("Split Vertically (⇧⌘D)", symbol: "rectangle.split.1x2", action: actions.splitStacked)
        PanelMenuButton(title: "Terminal Actions", symbol: "ellipsis") {
            Button("New Terminal", action: actions.new)
            Button("Split Horizontally", action: actions.splitSideBySide)
            Button("Split Vertically", action: actions.splitStacked)
            Divider()
            Button("Add Selection or Recent Output to Chat") {
                if let focused {
                    actions.attach(focused)
                }
            }
            .disabled(focused == nil)
            Divider()
            Button("Close Terminal", action: actions.close)
                .disabled(focused == nil)
        }
    }
}

struct TerminalGroupSurfaceView: View {
    let group: TerminalGroup
    let panels: PanelState
    let surface: String

    var body: some View {
        let actions = TerminalActions(
            new: { panels.openSurface(.terminal) },
            splitSideBySide: { group.add(axis: .sideBySide) },
            splitStacked: { group.add(axis: .stacked) },
            close: {
                if let session = group.focusedSession {
                    group.close(session)
                }
                if group.sessions.isEmpty {
                    panels.close(surface)
                }
            },
            attach: { panels.addToChat($0.chatContext, source: $0.label) },
            commands: panels.commands
        )
        VStack(spacing: 0) {
            PanelToolbar {
                Image(systemName: "terminal")
                    .font(.system(size: 12, weight: .light))
                    .foregroundStyle(Theme.chromeIcon)
                    .accessibilityHidden(true)
                Text(group.title)
                    .font(.system(size: 12.5, weight: .medium))
                    .lineLimit(1)
                Spacer()
                TerminalToolbarButtons(actions: actions, focused: group.focusedSession)
            }
            if group.sessions.isEmpty {
                PanelMessage(symbol: "terminal", title: "No terminal sessions for this thread yet.", actionTitle: "New Terminal") { group.add(axis: nil) }
            } else {
                TerminalGroupView(group: group, settings: panels.settings, actions: actions)
            }
        }
    }
}

struct TerminalGroupView: View {
    let group: TerminalGroup
    let settings: LocalStudioKit.Settings?
    let actions: TerminalActions

    var body: some View {
        let layout = group.axis == .sideBySide ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
        layout {
            ForEach(group.sessions) { session in
                if session.id != group.sessions.first?.id {
                    Rectangle()
                        .fill(Theme.hairline)
                        .frame(width: group.axis == .sideBySide ? 1 : nil, height: group.axis == .stacked ? 1 : nil)
                }
                TerminalPaneView(
                    session: session,
                    settings: settings,
                    focused: group.sessions.count > 1 && group.focused == session.id,
                    actions: actions
                ) {
                    group.focused = session.id
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

private struct TerminalPaneView: View {
    let session: TerminalSession
    let settings: LocalStudioKit.Settings?
    let focused: Bool
    let actions: TerminalActions
    let onFocus: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            TerminalPane(
                session: session,
                fontName: settings?.terminalFont ?? "",
                fontSize: CGFloat(settings?.terminalFontSize ?? 12),
                actions: actions,
                onFocus: onFocus
            )
            .padding(.leading, 8)
            .padding(.top, 4)
            if let message = session.status.message {
                HStack(spacing: 6) {
                    Image(systemName: session.status == .closed ? "xmark.circle" : "stop.circle")
                        .font(.system(size: 11, weight: .light))
                        .accessibilityHidden(true)
                    Text(statusText(message))
                        .font(.system(size: 11.5))
                    Spacer()
                }
                .foregroundStyle(Theme.secondaryText)
                .padding(.horizontal, 10)
                .frame(height: 24)
                .background(Theme.card)
            }
        }
        .background(Color(nsColor: PanelPalette.terminalBackground))
        .overlay(alignment: .top) {
            if focused {
                Rectangle().fill(Theme.primary.opacity(0.7)).frame(height: 1)
            }
        }
    }

    private func statusText(_ message: String) -> String {
        if case .exited(let code?) = session.status, code != 0 {
            return "\(message) with code \(code)"
        }
        return message
    }
}

final class PaneTerminalView: TerminalView {
    var onFocus: (() -> Void)?

    override func mouseDown(with event: NSEvent) {
        onFocus?()
        super.mouseDown(with: event)
    }
}

private struct TerminalPane: NSViewRepresentable {
    let session: TerminalSession
    let fontName: String
    let fontSize: CGFloat
    let actions: TerminalActions
    let onFocus: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    func makeCoordinator() -> TerminalPaneCoordinator {
        TerminalPaneCoordinator(session: session)
    }

    func makeNSView(context: Context) -> PaneTerminalView {
        let view = PaneTerminalView(frame: CGRect(x: 0, y: 0, width: 480, height: 240), font: font)
        view.terminalDelegate = context.coordinator
        view.optionAsMetaKey = true
        view.onFocus = onFocus
        paint(view)
        context.coordinator.scheme = colorScheme
        context.coordinator.actions = actions
        context.coordinator.attach(view)
        view.menu = context.coordinator.contextMenu(for: view)
        return view
    }

    func updateNSView(_ view: PaneTerminalView, context: Context) {
        context.coordinator.actions = actions
        view.onFocus = onFocus
        let font = font
        if view.font != font {
            view.font = font
        }
        if context.coordinator.scheme != colorScheme {
            paint(view)
        }
        context.coordinator.scheme = colorScheme
    }

    static func dismantleNSView(_ view: PaneTerminalView, coordinator: TerminalPaneCoordinator) {
        coordinator.detach()
    }

    private var font: NSFont {
        if !fontName.isEmpty, let font = NSFont(name: fontName, size: fontSize) {
            return font
        }
        return NSFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
    }

    private func paint(_ view: PaneTerminalView) {
        let dark = colorScheme == .dark
        let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        var background = NSColor.black
        var foreground = NSColor.white
        appearance?.performAsCurrentDrawingAppearance {
            background = PanelPalette.terminalBackground.usingColorSpace(.sRGB) ?? background
            foreground = PanelPalette.terminalForeground.usingColorSpace(.sRGB) ?? foreground
        }
        view.translucentCellBackgrounds = true
        view.nativeBackgroundColor = background.withAlphaComponent(0.995)
        view.nativeForegroundColor = foreground
        view.caretColor = dark ? NSColor(srgbRed: 0.2044, green: 0.4198, blue: 0.9449, alpha: 1) : NSColor(srgbRed: 0.1043, green: 0.3071, blue: 0.8463, alpha: 1)
        view.selectedTextBackgroundColor = dark ? NSColor(white: 1, alpha: 0.18) : NSColor(white: 0, alpha: 0.12)
    }
}

@MainActor
final class TerminalPaneCoordinator: NSObject, TerminalViewDelegate {
    let session: TerminalSession
    var actions: TerminalActions?
    var scheme: SwiftUI.ColorScheme?
    private weak var view: PaneTerminalView?

    init(session: TerminalSession) {
        self.session = session
    }

    func contextMenu(for view: PaneTerminalView) -> NSMenu {
        let menu = NSMenu()
        let copy = NSMenuItem(title: "Copy", action: #selector(TerminalView.copy(_:)), keyEquivalent: "")
        copy.target = view
        menu.addItem(copy)
        let paste = NSMenuItem(title: "Paste", action: #selector(TerminalView.paste(_:)), keyEquivalent: "")
        paste.target = view
        menu.addItem(paste)
        menu.addItem(.separator())
        let recent = NSMenuItem(title: "Copy Recent Output", action: #selector(copyRecentOutput), keyEquivalent: "")
        recent.target = self
        menu.addItem(recent)
        menu.addItem(.separator())
        let chat = NSMenuItem(title: "Add to Chat", action: #selector(addToChat), keyEquivalent: "")
        chat.target = self
        menu.addItem(chat)
        return menu
    }

    @objc private func addToChat() {
        actions?.attach(session)
    }

    @objc private func copyRecentOutput() {
        let text = session.recentOutput()
        guard !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func attach(_ view: PaneTerminalView) {
        self.view = view
        if !session.buffer.isEmpty {
            view.feed(byteArray: ArraySlice(session.buffer))
        }
        session.attach(self) { [weak view] data in
            view?.feed(byteArray: ArraySlice(data))
        }
        session.selection = { [weak view] in view?.getSelection() }
        registerCommands()
        if session.status == .starting {
            Task { @MainActor [weak view] in
                guard let view else { return }
                view.window?.makeFirstResponder(view)
            }
        }
    }

    func detach() {
        session.detach(self)
        session.selection = nil
        actions?.commands?.unregister(owner: self)
    }

    func registerCommands() {
        guard let commands = actions?.commands else { return }
        let focused: @MainActor () -> Bool = { [weak self] in
            guard let view = self?.view else { return false }
            return view.window?.firstResponder === view
        }
        commands.register("terminal.new", owner: self, enabled: focused) { [weak self] in self?.actions?.new() }
        commands.register("terminal.split", owner: self, enabled: focused) { [weak self] in self?.actions?.splitSideBySide() }
        commands.register("terminal.splitVertical", owner: self, enabled: focused) { [weak self] in self?.actions?.splitStacked() }
        commands.register("terminal.close", owner: self, enabled: focused) { [weak self] in self?.actions?.close() }
    }

    func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        session.resize(columns: newCols, rows: newRows)
    }

    func setTerminalTitle(source: TerminalView, title: String) {
        session.title = title
    }

    func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}

    func send(source: TerminalView, data: ArraySlice<UInt8>) {
        session.write(Data(data))
    }

    func scrolled(source: TerminalView, position: Double) {}

    func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}

    func clipboardCopy(source: TerminalView, content: Data) {
        guard let text = String(data: content, encoding: .utf8) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
