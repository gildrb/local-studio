import AppKit
import LocalStudioKit
import SwiftUI

struct ThreadView: View {
    let store: StudioStore
    let leadingInset: CGFloat

    var body: some View {
        Group {
            if let thread = store.conversation.thread {
                ConversationColumn(store: store)
                    .id(thread)
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

private struct ProjectMenu: View {
    let store: StudioStore
    @State private var hovering = false

    var body: some View {
        let inbox = store.inbox
        let current = inbox.project(inbox.currentProject)
        Menu {
            Picker("Project", selection: Binding(get: { inbox.currentProject }, set: { inbox.selectProject($0) })) {
                ForEach(inbox.projects, id: \.id) { project in
                    Label(project.name, systemImage: "folder").tag(Optional(project.id))
                }
                Label("No project", systemImage: "circle.slash").tag(String?.none)
            }
            .pickerStyle(.inline)
            Divider()
            Button("Add Project…", action: addProject)
        } label: {
            ComposerChip(title: current?.name ?? "No project", symbol: "folder", hovering: hovering)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .onHover { hovering = $0 }
        .help("Project")
        .accessibilityLabel("Project: \(current?.name ?? "No project")")
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

    var body: some View {
        let width = store.pages.settings?.chatWidth.maxWidth ?? ChatWidth.normal.maxWidth
        TimelineScroll(store: store, width: width)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 8) {
                    ApprovalCard(store: store)
                    ComposerView(store: store)
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
            Text("Loading thread…")
                .font(.system(size: 12.5))
                .foregroundStyle(Theme.secondaryText)
                .frame(maxWidth: .infinity)
                .padding(.top, 40)
        }
    }
}

private final class ScrollTracker {
    var distance: CGFloat = 0
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
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var tracker = ScrollTracker()
    @State private var awayFromEnd = false

    private static let followSlack: CGFloat = 40

    var body: some View {
        let conversation = store.conversation
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 22) {
                LoadingPlaceholder(conversation: conversation)
                ForEach(conversation.rows) { row in
                    TimelineRowView(row: row, store: store)
                }
                TimelineFooter(store: store)
            }
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 20)
            .frame(maxWidth: width)
            .frame(maxWidth: .infinity)
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .scrollEdgeEffectStyle(.soft, for: .all)
        .onScrollPhaseChange { _, phase in
            let wasUserDriven = tracker.userDriven
            tracker.phase = phase
            if wasUserDriven, !tracker.userDriven {
                follow(tracker.distance < Self.followSlack)
            }
        }
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            max(geometry.contentSize.height + geometry.contentInsets.bottom - geometry.contentOffset.y - geometry.containerSize.height, 0)
        } action: { _, distance in
            tracker.distance = distance
            if tracker.userDriven {
                follow(distance < Self.followSlack)
            }
            let away = distance > 240
            if away != awayFromEnd {
                awayFromEnd = away
            }
        }
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            geometry.contentSize.height
        } action: { _, _ in
            if conversation.followsEnd, !tracker.userDriven {
                position.scrollTo(edge: .bottom)
            }
        }
        .onChange(of: conversation.endRequest) {
            position.scrollTo(edge: .bottom)
        }
        .overlay(alignment: .bottom) {
            if awayFromEnd, !conversation.followsEnd {
                ScrollToEndPill { conversation.scrollToEnd() }
                    .padding(.bottom, 12)
            }
        }
    }

    private func follow(_ value: Bool) {
        if store.conversation.followsEnd != value {
            store.conversation.followsEnd = value
        }
    }
}

private struct TimelineFooter: View {
    let store: StudioStore

    var body: some View {
        let conversation = store.conversation
        VStack(alignment: .leading, spacing: 14) {
            if let info = conversation.info, info.busy {
                WorkingRow(info: info, waitingForApproval: !conversation.approvals.isEmpty)
            }
            ForEach(conversation.queued, id: \.id) { message in
                QueuedBubble(message: message, store: store)
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
