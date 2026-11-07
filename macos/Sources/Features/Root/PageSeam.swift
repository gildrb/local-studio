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

    var body: some View {
        switch route {
        case .thread: Color.clear
        case .usage: Color.clear
        case .local: Color.clear
        case .pullRequests: Color.clear
        case .archive: Color.clear
        }
    }
}

struct RightPanelSeam: View {
    let store: StudioStore

    var body: some View {
        EmptyView()
    }
}

struct TerminalDrawerSeam: View {
    let store: StudioStore

    var body: some View {
        EmptyView()
    }
}

struct SettingsSeam: View {
    let store: StudioStore

    var body: some View {
        Color.clear
            .frame(width: 680, height: 520)
    }
}
