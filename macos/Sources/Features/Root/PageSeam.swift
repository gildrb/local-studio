import SwiftUI

enum MainRoute: Hashable {
    case thread
    case usage
    case local
    case pullRequests
    case archive

    var title: String {
        switch self {
        case .thread: "Thread"
        case .usage: "Usage"
        case .local: "Local"
        case .pullRequests: "Pull Requests"
        case .archive: "Archive"
        }
    }

    var symbol: String {
        switch self {
        case .thread: "bubble.left"
        case .usage: "chart.bar"
        case .local: "server.rack"
        case .pullRequests: "arrow.trianglehead.pull"
        case .archive: "archivebox"
        }
    }
}

struct PageSeam: View {
    let store: StudioStore
    let route: MainRoute
    let leadingInset: CGFloat

    var body: some View {
        switch route {
        case .thread: EmptyView()
        case .usage: UsagePage(store: store, leadingInset: leadingInset)
        case .local: LocalPage(store: store, leadingInset: leadingInset)
        case .pullRequests: PullRequestsPage(store: store, leadingInset: leadingInset)
        case .archive: ArchivePage(store: store, leadingInset: leadingInset)
        }
    }
}

struct RightPanelSeam: View {
    let store: StudioStore
    var leadingInset: CGFloat = 0

    var body: some View {
        RightPanelView(store: store)
    }
}

struct TerminalDrawerSeam: View {
    let store: StudioStore

    var body: some View {
        TerminalDrawerView(store: store)
    }
}

struct SettingsSeam: View {
    let store: StudioStore

    var body: some View {
        SettingsView(store: store)
    }
}
