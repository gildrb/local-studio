import AppKit
import LocalStudioKit
import SwiftUI

struct ThreadView: View {
    let store: StudioStore
    let leadingInset: CGFloat

    var body: some View {
        Group {
            if store.conversation.showsThread {
                ConversationColumn(store: store)
            } else {
                DraftHero(store: store)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .dropDestination(for: URL.self) { urls, _ in
            let files = urls.filter(\.isFileURL)
            guard !files.isEmpty else { return false }
            store.conversation.composer(project: project).attach(urls: files, project: project)
            return true
        }
        .task {
            if store.conversation.models.isEmpty {
                store.conversation.loadModels()
            }
        }
        .sheet(item: Bindable(store.conversation).gallery) { gallery in
            ImageGalleryView(store: store, gallery: gallery)
        }
    }

    private var project: String? {
        store.conversation.thread == nil ? store.inbox.currentProject : store.conversation.info?.project
    }
}

extension ChatWidth {
    var maxWidth: CGFloat {
        switch self {
        case .normal: 820
        case .wide: 1_150
        case .full: .infinity
        }
    }
}

private struct DraftHero: View {
    let store: StudioStore

    var body: some View {
        let project = store.inbox.project(store.inbox.currentProject)
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            VStack(spacing: 14) {
                Text(project.map { "What should we build in \($0.name)?" } ?? "What should we build?")
                    .font(.system(size: 26, weight: .semibold))
                    .multilineTextAlignment(.center)
                ProjectMenu(store: store)
            }
            .padding(.bottom, 26)
            VStack(spacing: 6) {
                ComposerView(store: store)
                    .focusRegionFrame(.composer, in: store.shell)
                ThreadContextStrip(store: store)
            }
            .frame(maxWidth: 720)
            Spacer(minLength: 24)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ProjectMenu: View {
    let store: StudioStore

    var body: some View {
        let inbox = store.inbox
        let current = inbox.project(inbox.currentProject)
        PickerChipButton(
            title: current?.name ?? "No project",
            symbol: "folder",
            help: "Project",
            label: "Project: \(current?.name ?? "No project")",
            width: 300,
            rows: Self.rows(projects: inbox.projects, current: inbox.currentProject) {
                inbox.selectProject($0)
            } add: {
                Task { addProject() }
            }
        )
    }

    static func rows(
        projects: [Project],
        current: String?,
        select: @escaping @MainActor (String?) -> Void,
        add: @escaping @MainActor () -> Void
    ) -> [PickerRow] {
        projects.map { project in
            PickerRow(
                id: project.id,
                title: project.name,
                symbol: "folder",
                subtitle: (project.path as NSString).abbreviatingWithTildeInPath,
                checked: project.id == current,
                section: "Projects"
            ) { select(project.id) }
        } + [
            PickerRow(id: "no-project", title: "No project", symbol: "circle.slash", checked: current == nil, section: "Projects") { select(nil) },
            PickerRow(id: "add-project", title: "Add Project…", symbol: "plus", action: add),
        ]
    }

    private func addProject() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Add Project"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        store.inbox.addProject(path: url.path)
    }
}

private struct ConversationColumn: View {
    let store: StudioStore
    @State private var built: [String] = []

    var body: some View {
        let settings = store.pages.settings
        let width = settings?.chatWidth.maxWidth ?? ChatWidth.normal.maxWidth
        let selected = store.conversation.selectedID
        ZStack {
            ForEach(store.conversation.timelines.filter { $0 == selected || built.contains($0) }, id: \.self) { thread in
                TimelineScroll(store: store, width: width, thread: thread, current: thread == selected)
            }
        }
        .onChange(of: selected, initial: true) { _, selected in
            let live = store.conversation.timelines
            var next = built.filter(live.contains)
            if let selected, !next.contains(selected) {
                next.append(selected)
            }
            if next != built {
                built = next
            }
        }
        .environment(\.responseStreaming, settings?.responseStreaming ?? .paragraph)
        .environment(\.timeFormat, settings?.timeFormat ?? .locale)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                if let pending = store.conversation.pending {
                    if let setup = store.conversation.worktreeSetup[pending.draft], pending.failure == nil {
                        WorktreeSetupCard(stages: setup.stages, done: setup.done, error: setup.error) {
                            store.conversation.cancelWorktreeSetup()
                        } workLocally: {
                            store.conversation.skipWorktreeSetup()
                        }
                    }
                    if let failure = pending.failure {
                        StartFailureCard(message: failure) {
                            store.conversation.editPending(pending.draft)
                        } retry: {
                            store.conversation.retryPending(pending.draft)
                        }
                    }
                }
                ApprovalCard(store: store)
                ComposerView(store: store)
                    .focusRegionFrame(.composer, in: store.shell)
                ThreadContextStrip(store: store)
                    .padding(.top, -4)
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: width)
            .padding(.horizontal, 4)
            .padding(.bottom, 14)
        }
    }
}

private struct LoadingPlaceholder: View {
    let conversation: ConversationStore

    var body: some View {
        if conversation.rows.isEmpty, conversation.info == nil {
            VStack(spacing: 10) {
                LogoMark(style: .coin)
                    .frame(width: 28, height: 28)
                    .accessibilityHidden(true)
                Text("Loading thread…")
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.secondaryText)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 40)
        }
    }
}

private final class ScrollTracker {
    var distance: CGFloat = 0
    var top: UInt64?
    var phase: ScrollPhase = .idle

    var userDriven: Bool {
        switch phase {
        case .tracking, .interacting, .decelerating: true
        case .idle, .animating: false
        @unknown default: false
        }
    }
}

private struct TimelineScroll: View {
    let store: StudioStore
    let width: CGFloat
    private let thread: String
    private let current: Bool
    @State private var restoredTop: UInt64?
    @State private var position: ScrollPosition
    @State private var tracker = ScrollTracker()
    @State private var awayFromEnd = false
    @State private var currentAnchor: UInt64?
    @State private var roomForMinimap = false

    private static let followSlack: CGFloat = 40

    init(store: StudioStore, width: CGFloat, thread: String, current: Bool) {
        self.store = store
        self.width = width
        self.thread = thread
        self.current = current
        let restored = store.conversation.restoredScroll
        let top = restored.followsEnd ? nil : restored.top
        _restoredTop = State(initialValue: top)
        _position = State(initialValue: top.map { ScrollPosition(id: $0, anchor: .top) } ?? ScrollPosition(edge: .bottom))
    }

    var body: some View {
        let conversation = store.conversation
        ScrollView {
            TimelineStack(store: store, thread: thread, current: current, width: width)
                .equatable()
        }
        .scrollPosition($position)
        .defaultScrollAnchor(restoredTop == nil ? .bottom : nil, for: .initialOffset)
        .defaultScrollAnchor(current && conversation.followsEnd ? .bottom : nil, for: .sizeChanges)
        .scrollEdgeEffectStyle(.soft, for: .all)
        .onScrollPhaseChange { _, phase in
            let wasUserDriven = tracker.userDriven
            tracker.phase = phase
            if wasUserDriven, !tracker.userDriven {
                follow(tracker.distance < Self.followSlack)
            }
        }
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            let distance = max(geometry.contentSize.height + geometry.contentInsets.bottom - geometry.visibleRect.maxY, 0)
            tracker.distance = distance
            return distance
        } action: { _, _ in
            guard current else { return }
            let distance = tracker.distance
            let previous = store.shell.probe.scroll
            store.shell.probe.scroll = ScrollProbe(thread: thread, distance: distance, top: previous?.thread == thread ? previous?.top : nil)
            if tracker.userDriven {
                follow(distance < Self.followSlack)
            }
            let away = distance > 240
            if away != awayFromEnd {
                awayFromEnd = away
            }
        }
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            geometry.contentSize.height + geometry.contentInsets.top + geometry.contentInsets.bottom - geometry.containerSize.height
        } action: { _, _ in
            if current, conversation.followsEnd, !tracker.userDriven {
                position.scrollTo(edge: .bottom)
            }
        }
        .onChange(of: Gated(live: current, value: current ? conversation.endRequest : nil)) { old, new in
            guard old.live, new.live else { return }
            position.scrollTo(edge: .bottom)
        }
        .onChange(of: Gated(live: current, value: current ? store.shell.timelineCursor : nil)) { old, new in
            guard old.live, new.live, let cursor = new.value, store.shell.region == .timeline else { return }
            follow(cursor == conversation.rows.last?.id)
            position.scrollTo(id: cursor)
        }
        .onScrollTargetVisibilityChange(idType: UInt64.self, threshold: 0.3) { ids in
            updateCurrentAnchor(visible: ids)
        }
        .onChange(of: current ? timelineProbe : nil, initial: true) { _, probe in
            guard let probe else { return }
            store.shell.probe.timeline = probe
        }
        .onChange(of: current) { _, current in
            guard current else { return }
            let follows = conversation.followsEnd
            if follows {
                position.scrollTo(edge: .bottom)
            }
            store.shell.probe.scroll = ScrollProbe(thread: thread, distance: follows ? 0 : tracker.distance, top: tracker.top)
        }
        .onDisappear {
            if store.shell.probe.timeline?.thread == thread {
                store.shell.probe.timeline = nil
                store.shell.probe.scroll = nil
            }
        }
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.containerSize.width >= width + 80
        } action: { _, room in
            roomForMinimap = room
        }
        .overlay(alignment: .bottom) {
            if current, awayFromEnd, !conversation.followsEnd {
                ScrollToEndPill { conversation.scrollToEnd() }
                    .padding(.bottom, 12)
            }
        }
        .overlay(alignment: .trailing) {
            if current, roomForMinimap {
                TimelineMinimap(anchors: conversation.anchors, current: currentAnchor) { anchor in
                    follow(false)
                    currentAnchor = anchor
                    position.scrollTo(id: anchor, anchor: .top)
                }
                .equatable()
                .padding(.trailing, 8)
            }
        }
        .opacity(current ? 1 : 0)
        .accessibilityHidden(!current)
        .zIndex(current ? 1 : 0)
    }

    private var timelineProbe: TimelineProbe {
        let conversation = store.conversation
        let firstUser = conversation.rows.lazy.compactMap { row -> String? in
            guard case .entry(let entry, _) = row, case .user(let text, _, _, _) = entry.item.kind else { return nil }
            return text
        }.first
        return TimelineProbe(
            thread: conversation.thread, pending: conversation.focusedPending, rows: conversation.rows.count, firstUser: firstUser,
            placeholder: conversation.rows.isEmpty && conversation.info == nil
        )
    }

    private func updateCurrentAnchor(visible ids: [UInt64]) {
        guard current else { return }
        let order = Dictionary(store.conversation.rows.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        let top = ids.min { (order[$0] ?? .max) < (order[$1] ?? .max) }
        tracker.top = top
        store.conversation.scrollTop = top
        if let scroll = store.shell.probe.scroll, scroll.thread == thread {
            store.shell.probe.scroll?.top = top
        } else {
            store.shell.probe.scroll = ScrollProbe(thread: thread, distance: -1, top: top)
        }
        let anchors = store.conversation.anchors
        guard !anchors.isEmpty else { return }
        guard let top = ids.compactMap({ order[$0] }).min() else { return }
        let next = anchors.last { $0.order <= top }?.id ?? anchors.first?.id
        if next != currentAnchor {
            currentAnchor = next
        }
    }

    private func follow(_ value: Bool) {
        if current, store.conversation.followsEnd != value {
            store.conversation.followsEnd = value
        }
    }
}

private struct Gated<Value: Equatable>: Equatable {
    let live: Bool
    let value: Value?
}

private struct TimelineStack: View, Equatable {
    let store: StudioStore
    let thread: String
    let current: Bool
    let width: CGFloat

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.store === rhs.store && lhs.thread == rhs.thread && lhs.current == rhs.current && lhs.width == rhs.width
    }

    var body: some View {
        let conversation = store.conversation
        LazyVStack(alignment: .leading, spacing: 22) {
            if current {
                LoadingPlaceholder(conversation: conversation)
            }
            ForEach(current ? conversation.rows : conversation.cachedRows(thread)) { row in
                TimelineRowView(row: row, store: store)
                    .equatable()
                    .keyboardFocusRing(current && store.shell.region == .timeline && store.shell.timelineCursor == row.id, radius: 6, outset: 9)
            }
            TimelineFooter(store: store, live: current)
        }
        .scrollTargetLayout()
        .environment(\.timelineLive, current)
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .padding(.bottom, 20)
        .frame(maxWidth: width)
        .frame(maxWidth: .infinity)
    }
}

private struct TimelineMinimap: View, Equatable {
    let anchors: [TimelineAnchor]
    let current: UInt64?
    let jump: (UInt64) -> Void

    private static let maxTicks = 36

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.anchors == rhs.anchors && lhs.current == rhs.current
    }

    var body: some View {
        if anchors.count >= 2 {
            let index = current.flatMap { id in anchors.firstIndex { $0.id == id } }
            VStack(spacing: 4) {
                MinimapStep(title: "Previous message", symbol: "chevron.up", enabled: (index ?? anchors.count) > 0) {
                    jump(anchors[max((index ?? anchors.count) - 1, 0)].id)
                }
                VStack(spacing: 0) {
                    ForEach(ticks, id: \.id) { anchor in
                        MinimapTick(anchor: anchor, current: anchor.id == current) { jump(anchor.id) }
                    }
                }
                MinimapStep(title: "Next message", symbol: "chevron.down", enabled: index.map { $0 < anchors.count - 1 } ?? false) {
                    if let index {
                        jump(anchors[min(index + 1, anchors.count - 1)].id)
                    }
                }
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Timeline")
        }
    }

    private var ticks: [TimelineAnchor] {
        guard anchors.count > Self.maxTicks else { return anchors }
        let step = Double(anchors.count - 1) / Double(Self.maxTicks - 1)
        var picked = (0..<Self.maxTicks).map { anchors[Int((Double($0) * step).rounded())] }
        if let current, let anchor = anchors.first(where: { $0.id == current }), !picked.contains(anchor) {
            let nearest = picked.indices.min { abs(picked[$0].order - anchor.order) < abs(picked[$1].order - anchor.order) } ?? 0
            picked[nearest] = anchor
        }
        return picked
    }
}

private struct MinimapTick: View {
    let anchor: TimelineAnchor
    let current: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Capsule()
                .fill(current || hovering ? Color.primary.opacity(0.75) : Theme.chromeIcon.opacity(0.35))
                .frame(width: current ? 14 : 9, height: 2)
                .frame(width: 20, height: 7, alignment: .trailing)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(anchor.preview)
        .accessibilityLabel(anchor.preview)
        .accessibilityAddTraits(current ? .isSelected : [])
    }
}

private struct MinimapStep: View {
    let title: String
    let symbol: String
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        MessageActionButton(title, symbol: symbol, size: 10, action: action)
            .disabled(!enabled)
            .opacity(enabled ? 1 : 0.35)
    }
}

private struct TimelineFooter: View {
    let store: StudioStore
    let live: Bool

    var body: some View {
        let conversation = store.conversation
        VStack(alignment: .leading, spacing: 14) {
            if live {
                if let info = conversation.info, info.busy {
                    WorkingRow(info: info, waitingForApproval: !conversation.approvals.isEmpty)
                }
                ForEach(conversation.queued, id: \.id) { message in
                    QueuedBubble(message: message, store: store)
                }
            }
        }
    }
}

private struct ScrollToEndPill: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "arrow.down")
                    .font(.system(size: 11, weight: .medium))
                    .accessibilityHidden(true)
                Text("Scroll to end")
            }
            .font(.system(size: 12.5))
            .foregroundStyle(hovering ? Color.primary : Theme.secondaryText)
            .padding(.horizontal, 12)
            .frame(height: 30)
            .background(Theme.card, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.input))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
