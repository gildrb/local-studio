import AppKit
import LocalStudioKit
import SwiftUI

struct RightPanelView: View {
    let store: StudioStore
    var leadingInset: CGFloat = 0
    @State private var dragOrigin: CGFloat?

    private var panels: PanelState { store.workspace.panels }

    var body: some View {
        HStack(spacing: 0) {
            if !panels.rightPanelMaximized {
                ResizeHandle(axis: .horizontal, cursor: .columnResize, gesture: resize)
            }
            VStack(spacing: 0) {
                PanelTabStrip(panels: panels, leadingInset: panels.rightPanelMaximized ? leadingInset : 0)
                PanelHairline()
                Group {
                    if let surface = panels.activeContent {
                        PanelSurfaceView(store: store, surface: surface)
                            .id(surface.id)
                    } else {
                        PanelLauncherView(panels: panels)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(Theme.canvas)
        }
        .frame(width: panels.rightPanelMaximized ? nil : panels.rightPanelWidth)
        .frame(maxWidth: panels.rightPanelMaximized ? .infinity : nil, maxHeight: .infinity)
        .transaction { $0.disablesAnimations = true }
    }

    private var resize: some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
                let origin = dragOrigin ?? panels.rightPanelWidth
                dragOrigin = origin
                let range = PanelState.widthRange
                panels.rightPanelWidth = min(max(origin - value.translation.width, range.lowerBound), range.upperBound)
            }
            .onEnded { _ in dragOrigin = nil }
    }
}

struct PanelHairline: View {
    var body: some View {
        Rectangle()
            .fill(Theme.hairline)
            .frame(height: 1)
    }
}

struct ResizeHandle<G: Gesture>: View {
    let axis: Axis
    let cursor: NSCursor
    let gesture: G

    var body: some View {
        Rectangle()
            .fill(Theme.hairline)
            .frame(width: axis == .horizontal ? 1 : nil, height: axis == .vertical ? 1 : nil)
            .overlay {
                Color.clear
                    .frame(width: axis == .horizontal ? 9 : nil, height: axis == .vertical ? 9 : nil)
                    .contentShape(Rectangle())
                    .onHover { inside in
                        if inside { cursor.push() } else { NSCursor.pop() }
                    }
                    .gesture(gesture)
            }
            .zIndex(1)
    }
}

private struct PanelTabStrip: View {
    let panels: PanelState
    let leadingInset: CGFloat

    var body: some View {
        HStack(spacing: 4) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    HStack(spacing: 2) {
                        ForEach(panels.surfaces) { surface in
                            PanelTab(panels: panels, surface: surface, active: surface.id == panels.activeSurface)
                                .id(surface.id)
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .scrollIndicators(.never)
                .onAppear { reveal(proxy) }
                .onChange(of: panels.activeSurface) { reveal(proxy) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !panels.surfaces.isEmpty {
                Menu {
                    ForEach(panels.launcherActions()) { action in
                        Button {
                            panels.openSurface(action.kind)
                        } label: {
                            Label(action.kind.label, systemImage: action.kind.symbol)
                        }
                        .disabled(!action.available)
                    }
                } label: {
                    Image(systemName: "plus")
                        .toolbarIcon()
                        .frame(width: Theme.Metrics.chromeButton, height: Theme.Metrics.chromeButton)
                        .contentShape(Rectangle())
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .frame(width: Theme.Metrics.chromeButton, height: Theme.Metrics.chromeButton)
                .help("Open a surface")
                .accessibilityLabel("Open a surface")
            }
            ChromeIconButton(
                panels.rightPanelMaximized ? "Restore Panel" : "Maximize Panel",
                symbol: panels.rightPanelMaximized ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"
            ) {
                panels.rightPanelMaximized.toggle()
            }
        }
        .padding(.leading, leadingInset)
        .padding(.trailing, PanelState.trailingChromeInset)
        .frame(height: Theme.Metrics.titlebarHeight)
        .background(PanelDragArea())
    }

    private func reveal(_ proxy: ScrollViewProxy) {
        if let active = panels.activeSurface {
            proxy.scrollTo(active)
        }
    }
}

private struct PanelTab: View {
    let panels: PanelState
    let surface: PanelSurface
    let active: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            Button {
                panels.show(surface.id)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: surface.symbol)
                        .icon(.inline)
                        .accessibilityHidden(true)
                    Text(Self.clip(surface.title))
                        .font(.system(size: 12.5))
                        .lineLimit(1)
                        .fixedSize()
                }
                .foregroundStyle(active ? Color.primary : Theme.text)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(surface.title)
            .accessibilityLabel(surface.title)
            .accessibilityAddTraits(active ? .isSelected : [])
            Button {
                panels.close(surface.id)
            } label: {
                Image(systemName: "xmark")
                    .icon(.inline, .primary)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .opacity(active || hovering ? 1 : 0)
            .help("Close \(surface.title)")
            .accessibilityLabel("Close \(surface.title)")
        }
        .padding(.leading, 9)
        .padding(.trailing, 2)
        .frame(height: 28)
        .rowSurface(selected: active, hovering: hovering)
        .contentShape(Rectangle())
        .onTapGesture { panels.show(surface.id) }
        .onHover { hovering = $0 }
        .help(surface.title)
        .accessibilityElement(children: .contain)
        .contextMenu {
            if let path = surface.copyablePath {
                Button("Copy Path") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(path, forType: .string)
                }
                Divider()
            }
            Button("Close") { panels.close(surface.id) }
            Button("Close Others") { panels.closeOthers(surface.id) }
                .disabled(panels.surfaces.count < 2)
            Button("Close to the Right") { panels.closeToRight(surface.id) }
                .disabled(panels.surfaces.last?.id == surface.id)
            Button("Close All") { panels.closeAll() }
        }
    }

    private static func clip(_ title: String) -> String {
        guard title.count > 26 else { return title }
        return "\(title.prefix(12))…\(title.suffix(12))"
    }
}

struct PanelDragArea: View {
    var body: some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(WindowDragGesture())
            .allowsWindowActivationEvents(true)
    }
}

private struct PanelLauncherView: View {
    let panels: PanelState
    @FocusState private var focused: Bool

    var body: some View {
        let actions = panels.launcherActions()
        VStack(alignment: .leading, spacing: 2) {
            Text("Open a surface")
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 10)
                .padding(.bottom, 8)
                .accessibilityAddTraits(.isHeader)
            ForEach(actions) { action in
                LauncherRow(action: action) { panels.openSurface(action.kind) }
            }
        }
        .frame(maxWidth: 340)
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: .down) { press in
            guard press.modifiers.isEmpty || press.modifiers == .shift,
                  let key = press.characters.lowercased().first,
                  let action = actions.first(where: { $0.kind.shortcut == key }), action.available else { return .ignored }
            panels.openSurface(action.kind)
            return .handled
        }
        .onChange(of: panels.rightPanelOpen, initial: true) { _, open in
            if open {
                focused = true
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Open a surface")
    }
}

private struct LauncherRow: View {
    let action: PanelLauncherAction
    let open: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                Image(systemName: action.kind.symbol)
                    .icon(.control, .primary)
                    .frame(width: 22)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(action.kind.label)
                            .font(.system(size: 13))
                        if action.badge > 0 {
                            Text("\(action.badge)")
                                .font(.system(size: 10, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5)
                                .frame(minWidth: 16, minHeight: 16)
                                .background(Theme.primary, in: Capsule())
                        }
                    }
                    if let detail = action.available ? action.kind.description : action.kind.unavailableHint {
                        Text(detail)
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Text(String(action.kind.shortcut).uppercased())
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(Theme.secondaryText)
                    .frame(width: 20, height: 20)
                    .background(Theme.input.opacity(0.6), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            }
            .padding(.horizontal, 10)
            .frame(height: action.available && action.kind.description == nil ? 34 : 44)
            .rowSurface(selected: false, hovering: hovering && action.available)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!action.available)
        .opacity(action.available ? 1 : 0.45)
        .onHover { hovering = $0 }
        .help(action.available ? action.kind.label : action.kind.unavailableHint)
        .accessibilityLabel(action.kind.label)
        .accessibilityValue(accessibilityValue)
        .accessibilityHint(action.available ? "Opens the \(action.kind.label) surface. Shortcut \(String(action.kind.shortcut).uppercased())." : action.kind.unavailableHint)
    }

    private var accessibilityValue: String {
        if !action.available { return action.kind.unavailableHint }
        if action.badge > 0 { return "\(action.badge) running" }
        return action.kind.description ?? ""
    }
}

private struct PanelSurfaceView: View {
    let store: StudioStore
    let surface: PanelSurface

    var body: some View {
        let panels = store.workspace.panels
        switch surface.content {
        case .browser(let model):
            BrowserSurfaceView(model: model, panels: panels)
        case .terminal(let group):
            TerminalGroupSurfaceView(group: group, panels: panels, surface: surface.id)
        case .files(let model):
            FilesSurfaceView(model: model, panels: panels)
        case .diff(let model):
            DiffSurfaceView(model: model, panels: panels)
        case .file(let model):
            FilePreviewView(model: model, settings: panels.settings)
        case .pullRequest(let model):
            PullRequestDetailView(model: model, store: store, settings: panels.settings)
        case .pullRequests(let model):
            PullRequestsSurfaceView(model: model, store: store, settings: panels.settings)
        case .agents:
            AgentsSurfaceView(panels: panels)
        case .device(let model):
            DeviceSurfaceView(model: model, notice: store.notice)
        }
    }
}

struct PanelToolbar<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                content
            }
            .padding(.horizontal, 10)
            .frame(height: 38)
            PanelHairline()
        }
    }
}

struct PanelMessage: View {
    let symbol: String?
    let title: String
    var detail: String?
    var actionTitle: String?
    var action: (() -> Void)?

    static func loading(_ title: String) -> PanelMessage {
        PanelMessage(symbol: nil, title: title)
    }

    var body: some View {
        VStack(spacing: 8) {
            Group {
                if let symbol {
                    Image(systemName: symbol)
                        .icon(.display, .secondary)
                } else {
                    LogoMark(style: .coin)
                        .frame(width: 26, height: 26)
                }
            }
            .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .multilineTextAlignment(.center)
            if let detail {
                Text(detail)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .controlSize(.small)
                    .padding(.top, 4)
            }
        }
        .padding(24)
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct PanelIconButton: View {
    let title: String
    let symbol: String
    var enabled = true
    let action: () -> Void
    @State private var hovering = false

    init(_ title: String, symbol: String, enabled: Bool = true, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.enabled = enabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .icon(.control, .primary)
                .frame(width: 26, height: 26)
                .background(hovering && enabled ? Theme.hover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .help(title)
        .accessibilityLabel(title)
        .onHover { hovering = $0 }
    }
}

struct PanelMenuButton<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder let content: Content

    var body: some View {
        Menu {
            content
        } label: {
            Image(systemName: symbol)
                .icon(.control, .primary)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .frame(width: 26, height: 26)
        .help(title)
        .accessibilityLabel(title)
    }
}

struct AgentsSurfaceView: View {
    @Bindable var panels: PanelState

    var body: some View {
        let agents = panels.agents
        VStack(spacing: 0) {
            PanelToolbar {
                Text("Subagents")
                    .font(.system(size: 12.5, weight: .medium))
                Spacer()
                let live = agents.filter(\.running).count
                Text(live > 0 ? "\(live) running" : "\(agents.count) total")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
                    .monospacedDigit()
            }
            if agents.isEmpty {
                PanelMessage(symbol: "person.2.fill", title: "No subagents in this thread yet.", detail: "Agents the assistant starts during a turn appear here while they run.")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(agents, id: \.id) { agent in
                            AgentRow(
                                agent: agent,
                                expanded: panels.expandedAgents.contains(agent.id),
                                cancelling: panels.cancelling.contains(agent.id)
                            ) {
                                if panels.expandedAgents.contains(agent.id) {
                                    panels.expandedAgents.remove(agent.id)
                                } else {
                                    panels.expandedAgents.insert(agent.id)
                                }
                            } cancel: {
                                panels.cancelSubagent(agent.id)
                            }
                        }
                    }
                    .padding(8)
                }
            }
        }
    }
}

private struct AgentRow: View {
    let agent: Subagent
    let expanded: Bool
    let cancelling: Bool
    let toggle: () -> Void
    let cancel: () -> Void
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                Group {
                    if agent.running {
                        LogoMark()
                            .frame(width: 14, height: 14)
                    } else {
                        Image(systemName: style.symbol)
                            .icon(.inline)
                            .foregroundStyle(style.tint)
                    }
                }
                .frame(width: 18, height: 18)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(agent.title)
                        .font(.system(size: 13))
                        .lineLimit(expanded ? 3 : 1)
                    meta
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                    if let tool = agent.currentTool, agent.running, !tool.isEmpty {
                        Text(tool)
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                }
                Spacer(minLength: 4)
                if agent.running {
                    if cancelling {
                        Text("Stopping…")
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.secondaryText)
                    } else {
                        Button("Stop", action: cancel)
                            .controlSize(.small)
                            .accessibilityLabel("Stop \(agent.title)")
                    }
                }
                if hasDetail {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .icon(.inline, .secondary)
                        .frame(height: 18)
                        .accessibilityHidden(true)
                }
            }
            if expanded, hasDetail {
                VStack(alignment: .leading, spacing: 6) {
                    if let note = agent.note, !note.isEmpty {
                        Text(note)
                            .font(.system(size: 12))
                            .textSelection(.enabled)
                    }
                    if let answer = agent.answer, !answer.isEmpty {
                        MarkdownView(text: String(answer.suffix(6000)), size: 12.5)
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .rowSurface(selected: expanded, hovering: hovering)
        .contentShape(Rectangle())
        .onTapGesture(perform: toggle)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(agent.title)
        .accessibilityValue(agent.status)
        .accessibilityAction(named: expanded ? "Hide Details" : "Show Details") { toggle() }
    }

    private var hasDetail: Bool {
        !(agent.note ?? "").isEmpty || !(agent.answer ?? "").isEmpty
    }

    @ViewBuilder private var meta: some View {
        let parts = [agent.model, agent.tokens > 0 ? "\(Self.tokens(agent.tokens)) tokens" : nil].compactMap { $0 }
        let suffix = parts.isEmpty ? "" : " · " + parts.joined(separator: " · ")
        if agent.running, let start = agent.startedAt {
            Text("\(agent.status) · \(Date(timeIntervalSince1970: TimeInterval(start) / 1000), style: .relative)\(suffix)")
        } else if let duration = agent.durationMs {
            Text("\(agent.status) · \(Self.duration(duration))\(suffix)")
        } else {
            Text("\(agent.status)\(suffix)")
        }
    }

    private static func duration(_ millis: UInt64) -> String {
        let seconds = Int(millis / 1000)
        return seconds >= 60 ? "\(seconds / 60)m \(seconds % 60)s" : "\(seconds)s"
    }

    private static func tokens(_ count: UInt64) -> String {
        count >= 1000 ? String(format: "%.1fk", Double(count) / 1000) : "\(count)"
    }

    private var style: (symbol: String, tint: Color) {
        if agent.running { return ("hourglass", Theme.primary) }
        let status = agent.status.lowercased()
        if status.contains("fail") || status.contains("error") { return ("xmark", Theme.diffRemoved) }
        if status.contains("cancel") || status.contains("abort") || status.contains("stop") { return ("minus", Theme.secondaryText) }
        return ("checkmark", Theme.diffAdded)
    }
}
