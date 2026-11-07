import Foundation
import LocalStudioKit
import Observation

@MainActor
@Observable
final class WorkspaceStore {
    private(set) var gitStatus: [String: GitStatus] = [:]
    private(set) var branches: [String: [Branch]] = [:]
    private(set) var diffs: [String: [FileDiff]] = [:]
    private(set) var directories: [String: [FileEntry]] = [:]
    private(set) var fileContents: [String: FileContent] = [:]
    private(set) var searchResults: [String: [SearchHit]] = [:]
    private(set) var pullRequests: [String: [PullRequest]] = [:]
    private(set) var terminals: [String: String] = [:]
    private(set) var exitedTerminals: [String: Int32?] = [:]

    @ObservationIgnored private(set) var terminalSinks: [String: (Data) -> Void] = [:]
    @ObservationIgnored private let core: CoreHandle
    @ObservationIgnored private let requests: RequestCenter

    init(core: CoreHandle, requests: RequestCenter) {
        self.core = core
        self.requests = requests
    }

    func setGitStatus(project: String, status: GitStatus) {
        gitStatus[project] = status
    }

    func setBranches(request: String, branches: [Branch], total: UInt32) {
        self.branches[request] = branches
    }

    func setDiff(request: String, files: [FileDiff]) {
        diffs[request] = files
    }

    func setFiles(request: String, entries: [FileEntry]) {
        directories[request] = entries
    }

    func setFileContent(request: String, path: String, content: FileContent) {
        fileContents[request] = content
    }

    func setSearchResults(request: String, results: [SearchHit]) {
        searchResults[request] = results
    }

    func setPullRequests(request: String, pulls: [PullRequest]) {
        pullRequests[request] = pulls
    }

    func terminalOpened(request: String, terminal: String) {
        terminals[request] = terminal
    }

    func terminalOutput(terminal: String, data: Data) {
        terminalSinks[terminal]?(data)
    }

    func terminalExited(terminal: String, code: Int32?) {
        exitedTerminals[terminal] = code
        terminalSinks[terminal] = nil
    }

    func attach(terminal: String, sink: @escaping (Data) -> Void) {
        terminalSinks[terminal] = sink
    }
}
