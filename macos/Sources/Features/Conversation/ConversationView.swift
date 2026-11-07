import LocalStudioKit
import SwiftUI

struct ThreadView: View {
    let store: StudioStore
    let leadingInset: CGFloat

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ThreadHeader(project: projectName, thread: threadTitle)
                Spacer(minLength: 12)
                ChromeIconButton("Open in Editor", symbol: "arrow.up.right.circle") {}
                ChromeIconButton("Toggle Terminal", symbol: "terminal") {}
                ChromeIconButton("Toggle Panel", symbol: "sidebar.trailing") {}
            }
            .padding(.leading, leadingInset + 16)
            .padding(.trailing, 10)
            .frame(height: Theme.Metrics.titlebarHeight)
            .background(WindowDragArea())
            Group {
                if store.conversation.thread == nil {
                    DraftHero(store: store)
                } else {
                    TranscriptView(items: store.conversation.items)
                        .safeAreaInset(edge: .bottom, spacing: 0) {
                            VStack(spacing: 8) {
                                ForEach(store.conversation.approvals, id: \.requestId) { approval in
                                    ApprovalView(approval: approval, store: store)
                                }
                                ComposerView(store: store)
                            }
                            .frame(maxWidth: 820)
                            .padding(.horizontal, 20)
                            .padding(.bottom, 16)
                        }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .overlay(alignment: .top) {
            if let notice = store.notice {
                NoticeBar(notice: notice) { store.dismissNotice() }
                    .padding(.top, Theme.Metrics.titlebarHeight + 8)
            }
        }
        .task(id: store.conversation.thread) {
            if store.conversation.thread != nil {
                store.conversation.loadModels()
            }
        }
    }

    private var projectName: String {
        let project = store.conversation.info?.project ?? store.inbox.currentProject
        return store.inbox.project(project)?.name ?? "Local Studio"
    }

    private var threadTitle: String {
        store.conversation.info?.title ?? "New thread"
    }
}

private struct ThreadHeader: View {
    let project: String
    let thread: String

    var body: some View {
        HStack(spacing: 7) {
            ProjectTile(name: project)
            Text(project)
                .foregroundStyle(Theme.secondaryText)
            Text("/")
                .foregroundStyle(Theme.secondaryText.opacity(0.6))
            Text(thread)
                .fontWeight(.medium)
                .lineLimit(1)
        }
        .font(.system(size: 13))
    }
}

private struct WindowDragArea: View {
    var body: some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(WindowDragGesture())
            .allowsWindowActivationEvents(true)
    }
}

private struct DraftHero: View {
    let store: StudioStore

    var body: some View {
        VStack(spacing: 20) {
            VStack(spacing: 6) {
                Text("What should we build in \(store.inbox.project(store.inbox.currentProject)?.name ?? "Local Studio")?")
                    .font(.title.weight(.semibold))
                Text(subtitle)
                    .foregroundStyle(.secondary)
            }
            ComposerView(store: store)
                .frame(maxWidth: 680)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var subtitle: String {
        switch store.connection {
        case .connecting: "Connecting to Eukhe…"
        case .ready: "or start without a project"
        case .lost(let reason): reason
        }
    }
}

private struct TranscriptView: View {
    let items: [Item]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(items) { item in
                        TranscriptItemView(item: item)
                            .id(item.id)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
            }
            .scrollEdgeEffectStyle(.soft, for: .all)
            .onChange(of: items.last) { _, last in
                if let last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
            .onAppear {
                if let last = items.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }
}

private struct NoticeBar: View {
    let notice: StudioNotice
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Label(notice.text, systemImage: notice.level.symbol)
                .foregroundStyle(notice.level.tint)
                .textSelection(.enabled)
            Spacer()
            Button("Dismiss", systemImage: "xmark", action: dismiss)
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline))
        .frame(maxWidth: 720)
    }
}

private struct ApprovalView: View {
    let approval: Approval
    let store: StudioStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Command approval", systemImage: "shield.lefthalf.filled")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.orange)
                if let agent = approval.agent {
                    Text(agent).foregroundStyle(.secondary)
                }
                Spacer()
            }
            Text(approval.command)
                .font(.system(.callout, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack {
                Spacer()
                Button("Decline") { store.conversation.answer(approval, .deny) }
                Button("Approve") { store.conversation.answer(approval, .approve) }
                    .buttonStyle(.glassProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(14)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.hairline))
    }
}
