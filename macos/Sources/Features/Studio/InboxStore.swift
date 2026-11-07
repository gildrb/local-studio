import Foundation
import LocalStudioKit
import Observation

@MainActor
@Observable
final class InboxStore {
    private(set) var projects: [Project] = []
    private(set) var threads: [ThreadRow] = []
    var currentProject: String?

    @ObservationIgnored private let core: CoreHandle
    @ObservationIgnored private let requests: RequestCenter

    init(core: CoreHandle, requests: RequestCenter) {
        self.core = core
        self.requests = requests
    }

    func setProjects(_ projects: [Project]) {
        self.projects = projects
        if let current = currentProject, projects.contains(where: { $0.id == current }) { return }
        currentProject = projects.first?.id
    }

    func setThreads(_ threads: [ThreadRow]) {
        self.threads = threads
    }

    func notify(thread: String, kind: NotificationKind, title: String, body: String) {}

    func addProject(path: String) {
        core.run { $0.addProject(path: path) }
        currentProject = path
    }

    func project(_ id: String?) -> Project? {
        guard let id else { return nil }
        return projects.first { $0.id == id }
    }
}
