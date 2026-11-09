import AppKit
import LocalStudioKit
import SwiftUI

struct RootView: View {
    let store: StudioStore
    @State private var dragOrigin: CGFloat?

    private static let widthRange: ClosedRange<CGFloat> = 220...420

    var body: some View {
        let shell = store.shell
        HStack(spacing: 0) {
            SidebarView(store: store)
                .frame(width: shell.sidebarWidth)
                .frame(width: shell.sidebarVisible ? shell.sidebarWidth : 0, alignment: .trailing)
                .clipped()
                .accessibilityHidden(!shell.sidebarVisible)
                .background(Theme.sidebar)
                .focusRegionFrame(.sidebar, in: shell)
            if shell.sidebarVisible {
                Rectangle()
                    .fill(Theme.hairline)
                    .frame(width: 1)
                    .overlay {
                        Color.clear
                            .frame(width: 9)
                            .contentShape(Rectangle())
                            .onHover { inside in
                                if inside { NSCursor.columnResize.push() } else { NSCursor.pop() }
                            }
                            .gesture(resize)
                    }
            }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .overlay(alignment: .topTrailing) {
            PanelToggles(store: store)
        }
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                if let notice = store.notice {
                    ToastView(notice: notice) { store.dismissNotice() }
                }
                KernelNotice(store: store)
            }
            .padding(.top, Theme.Metrics.titlebarHeight + 6)
        }
        .overlay(alignment: .top) {
            if let page = shell.palette {
                ZStack(alignment: .top) {
                    Color.black.opacity(0.001)
                        .onTapGesture { shell.palette = nil }
                    CommandPalette(store: store, page: page)
                        .padding(.top, 72)
                }
            }
        }
        .background(Theme.canvas)
        .ignoresSafeArea(.container, edges: .top)
        .toolbar {
            ToolbarItem(placement: .navigation) {
                WindowChrome(store: store)
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .alert(confirmationTitle, isPresented: confirmationShown, presenting: shell.confirmation) { confirmation in
            Button(confirmationAction(confirmation), role: confirmationRole(confirmation)) { store.confirm(confirmation) }
            Button("Cancel", role: .cancel) { shell.confirmation = nil }
        } message: { confirmation in
            Text(confirmationMessage(confirmation))
        }
        .sheet(isPresented: snoozeShown) {
            CustomSnoozeSheet(store: store, threads: shell.snoozeTargets)
        }
        .sheet(isPresented: onboardingShown) {
            OnboardingView(store: store)
                .interactiveDismissDisabled()
        }
        .sheet(isPresented: Bindable(shell).cloneShown) {
            CloneRepositorySheet(store: store)
        }
        .themeRoot()
        .onAppear { PageCommands.install(store) }
        .transaction { $0.disablesAnimations = true }
    }

    @ViewBuilder private var content: some View {
        let shell = store.shell
        let leading = shell.sidebarVisible ? 16 : WindowChrome.collapsedInset
        if shell.route == .thread {
            let panels = store.panels
            HStack(spacing: 0) {
                if !(panels.rightPanelOpen && panels.rightPanelMaximized) {
                    VStack(spacing: 0) {
                        ThreadHeaderBar(store: store, leadingInset: leading, trailingInset: panels.rightPanelOpen ? 10 : Theme.Metrics.trailingChromeInset)
                            .zIndex(1)
                        ThreadView(store: store, leadingInset: 0)
                            .focusRegionFrame(.timeline, in: shell)
                        if panels.terminalOpen {
                            TerminalDrawerSeam(store: store)
                                .focusRegionFrame(.terminal, in: shell)
                        }
                    }
                    .overlay { PreviewMiniPlayerView(store: store) }
                    .frame(maxWidth: .infinity)
                }
                if panels.rightPanelOpen {
                    RightPanelSeam(store: store, leadingInset: panels.rightPanelMaximized && !shell.sidebarVisible ? WindowChrome.collapsedInset : 0)
                        .focusRegionFrame(.rightPanel, in: shell)
                }
            }
        } else {
            PageSeam(store: store, route: shell.route, leadingInset: leading - 16)
        }
    }

    private var resize: some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
                let origin = dragOrigin ?? store.shell.sidebarWidth
                dragOrigin = origin
                store.shell.sidebarWidth = min(max(origin + value.translation.width, Self.widthRange.lowerBound), Self.widthRange.upperBound)
            }
            .onEnded { _ in dragOrigin = nil }
    }

    private var confirmationShown: Binding<Bool> {
        Binding { store.shell.confirmation != nil } set: { if !$0 { store.shell.confirmation = nil } }
    }

    private var snoozeShown: Binding<Bool> {
        Binding { !store.shell.snoozeTargets.isEmpty } set: { if !$0 { store.shell.snoozeTargets = [] } }
    }

    private var onboardingShown: Binding<Bool> {
        Binding { store.needsOnboarding } set: { if !$0 { store.shell.onboardingDismissed = true } }
    }

    private var confirmationTitle: String {
        guard let confirmation = store.shell.confirmation else { return "" }
        let count = confirmation.threads.count
        let noun = count == 1 ? "this thread" : "\(count) threads"
        switch confirmation {
        case .delete: return "Delete \(noun)?"
        case .archive: return "Archive \(noun)?"
        case .unpin: return "Unpin \(noun)?"
        }
    }

    private func confirmationMessage(_ confirmation: ShellConfirmation) -> String {
        switch confirmation {
        case .delete: "The conversation history is removed permanently. This can't be undone."
        case .archive: "Archived threads leave the inbox. You can restore them from Archive."
        case .unpin: "The thread moves back to the Active list."
        }
    }

    private func confirmationAction(_ confirmation: ShellConfirmation) -> String {
        switch confirmation {
        case .delete: "Delete"
        case .archive: "Archive"
        case .unpin: "Unpin"
        }
    }

    private func confirmationRole(_ confirmation: ShellConfirmation) -> ButtonRole? {
        switch confirmation {
        case .delete: .destructive
        case .archive, .unpin: nil
        }
    }
}

struct WindowChrome: View {
    static let collapsedInset: CGFloat = Theme.Metrics.trafficLightsWidth + 3 * Theme.Metrics.chromeButton + 12

    let store: StudioStore

    var body: some View {
        HStack(spacing: 0) {
            ChromeIconButton(hint(store.shell.sidebarVisible ? "Hide Sidebar" : "Show Sidebar", "sidebar.toggle"), symbol: "sidebar.leading") {
                store.toggleSidebar()
            }
            ChromeIconButton(hint("New Thread", "chat.new"), symbol: "plus") {
                store.newThreadCommand(currentProject: NSEvent.modifierFlags.contains(.shift))
            }
            .disabled(store.inbox.projects.isEmpty && store.connection != .ready)
            ChromeIconButton(hint("Command Palette", "commandPalette.toggle"), symbol: "command") {
                store.shell.palette = store.shell.palette == nil ? .root : nil
            }
        }
    }

    private func hint(_ title: String, _ command: String) -> String {
        store.shortcutText(command).map { "\(title) (\($0))" } ?? title
    }
}

struct ToastView: View {
    let notice: StudioNotice
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(notice.text)
                .font(.system(size: 13))
                .textSelection(.enabled)
                .lineLimit(4)
            Spacer(minLength: 8)
            Button("Dismiss", systemImage: "xmark", action: dismiss)
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Theme.secondaryText)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: 520)
        .fixedSize(horizontal: false, vertical: true)
        .background(Theme.overlay, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline))
        .shadow(color: Theme.shadow, radius: 14, y: 6)
        .task(id: notice.id) {
            guard notice.level != .error else { return }
            try? await Task.sleep(for: .seconds(5))
            if !Task.isCancelled { dismiss() }
        }
    }

    private var symbol: String {
        switch notice.level {
        case .info: "info.circle"
        case .warning: "exclamationmark.triangle"
        case .error: "exclamationmark.circle"
        }
    }

    private var tint: Color {
        switch notice.level {
        case .info: Theme.primary
        case .warning: Theme.warning
        case .error: Theme.danger
        }
    }
}

struct CustomSnoozeSheet: View {
    let store: StudioStore
    let threads: [String]
    @Environment(\.dismiss) private var dismiss
    @State private var until = Date.now.addingTimeInterval(2 * 3_600)

    var body: some View {
        Form {
            Section {
                DatePicker("Wake at", selection: $until, in: Date.now..., displayedComponents: [.date, .hourAndMinute])
            } header: {
                Text(threads.count == 1 ? "Snooze thread" : "Snooze \(threads.count) threads")
            } footer: {
                Text("Wakes \(TimeFormatting.dateTime(until, store.pages.settings?.timeFormat)). The thread returns to the inbox then, or earlier if it needs you.")
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .formStyle(.grouped)
        .safeAreaInset(edge: .bottom) {
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { close() }
                    .keyboardShortcut(.cancelAction)
                Button("Snooze") {
                    store.inbox.snooze(threads, until: Int64(until.timeIntervalSince1970 * 1_000))
                    close()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(until <= .now)
            }
            .padding(16)
        }
        .frame(width: 400, height: 240)
    }

    private func close() {
        store.shell.snoozeTargets = []
        dismiss()
    }
}
