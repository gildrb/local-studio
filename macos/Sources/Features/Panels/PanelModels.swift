import AppKit
import Foundation
import LocalStudioKit
import Observation

enum PanelSurfaceKind: String, CaseIterable, Identifiable {
    case browser
    case terminal
    case files
    case diff
    case pullRequest
    case pullRequests
    case agents
    case device
    case file

    static let launcher: [PanelSurfaceKind] = [.browser, .terminal, .files, .diff, .pullRequest, .pullRequests, .agents, .device]

    var id: String { rawValue }

    var label: String {
        switch self {
        case .browser: "Browser"
        case .terminal: "Terminal"
        case .files: "Files"
        case .diff: "Diff"
        case .pullRequest: "Pull request"
        case .pullRequests: "Linked pull requests"
        case .agents: "Agents"
        case .device: "Device"
        case .file: "File"
        }
    }

    var shortcut: Character {
        switch self {
        case .browser: "b"
        case .terminal: "t"
        case .files: "f"
        case .diff: "d"
        case .pullRequest: "p"
        case .pullRequests: "l"
        case .agents: "a"
        case .device: "m"
        case .file: "o"
        }
    }

    var symbol: String {
        switch self {
        case .browser: "globe"
        case .terminal: "terminal"
        case .files: "folder"
        case .diff: "plus.forwardslash.minus"
        case .pullRequest: "arrow.triangle.pull"
        case .pullRequests: "arrow.triangle.branch"
        case .agents: "person.2"
        case .device: "iphone"
        case .file: "doc.text"
        }
    }

    var description: String? {
        self == .device ? "Simulators and emulators on this Mac." : nil
    }

    var unavailableHint: String {
        switch self {
        case .browser: "Only available in the desktop app."
        case .terminal, .files: "Available when a project is open."
        case .diff, .pullRequests: "Available for Git repositories."
        case .pullRequest: "No pull request on this branch yet."
        case .agents: "Available from a thread."
        case .device: "Available on this Mac."
        case .file: "Open a file from Files."
        }
    }
}

struct PanelLauncherAction: Identifiable {
    let kind: PanelSurfaceKind
    let available: Bool
    let badge: Int

    var id: String { kind.rawValue }
}

@MainActor
enum PanelSurfaceContent {
    case browser(BrowserModel)
    case terminal(TerminalGroup)
    case files(FilesModel)
    case diff(DiffModel)
    case file(FilePreviewModel)
    case pullRequest(PullRequestDetailModel)
    case pullRequests(PullRequestsModel)
    case agents
    case device(DeviceModel)
}

@MainActor
struct PanelSurface: Identifiable {
    let id = UUID().uuidString
    let content: PanelSurfaceContent

    var kind: PanelSurfaceKind {
        switch content {
        case .browser: .browser
        case .terminal: .terminal
        case .files: .files
        case .diff: .diff
        case .file: .file
        case .pullRequest: .pullRequest
        case .pullRequests: .pullRequests
        case .agents: .agents
        case .device: .device
        }
    }

    var title: String {
        switch content {
        case .browser(let model): model.tabTitle
        case .terminal(let group): group.title
        case .files: "Files"
        case .diff: "Diff"
        case .file(let model): (model.relative as NSString).lastPathComponent
        case .pullRequest(let model): "#\(model.pull.number)"
        case .pullRequests: "Pull requests"
        case .agents: "Agents"
        case .device: "Devices"
        }
    }

    var symbol: String {
        kind.symbol
    }

    var copyablePath: String? {
        if case .file(let model) = content {
            return (model.project as NSString).appendingPathComponent(model.relative)
        }
        return nil
    }

    func dispose() {
        switch content {
        case .terminal(let group):
            group.closeAll()
        case .browser(let model):
            model.stop()
        case .files, .diff, .file, .pullRequest, .pullRequests, .agents, .device:
            break
        }
    }
}

enum LoadPhase: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

enum DiffScopeChoice: Hashable {
    case workingTree
    case branch
    case latestTurn
    case turn(UInt64)

    var label: String {
        switch self {
        case .workingTree: "Working tree"
        case .branch: "Branch changes"
        case .latestTurn: "Latest turn"
        case .turn(let turn): "Turn \(turn)"
        }
    }
}

struct DiffFileHeader: Equatable {
    let path: String
    let oldPath: String?
    let status: String
    let additions: UInt32
    let deletions: UInt32
    let collapsed: Bool
}

struct DiffCell: Equatable {
    let kind: DiffLineKind
    let number: UInt32?
    let text: String
}

struct DiffRow: Identifiable, Equatable {
    enum Kind: Equatable {
        case hunk(String)
        case line(kind: DiffLineKind, old: UInt32?, new: UInt32?, text: String)
        case split(left: DiffCell?, right: DiffCell?)
        case note(String)
    }

    let id: String
    let kind: Kind
}

struct DiffSection: Identifiable, Equatable {
    let header: DiffFileHeader
    let rows: [DiffRow]

    var id: String { header.path }
}

@MainActor
@Observable
final class DiffModel {
    let project: String
    let thread: String?
    var scope: DiffScopeChoice = .workingTree {
        didSet { if scope != oldValue { load() } }
    }
    var base: String? {
        didSet { if base != oldValue, scope == .branch { load() } }
    }
    var layout: DiffLayout {
        didSet { if layout != oldValue { rebuild() } }
    }
    var wrap: Bool
    private(set) var phase: LoadPhase = .idle
    private(set) var files: [FileDiff] = []
    private(set) var sections: [DiffSection] = []
    private(set) var gutterDigits = 2
    private(set) var collapsed: Set<String> = []
    private(set) var branches: [Branch] = []

    @ObservationIgnored private(set) var request: String?
    @ObservationIgnored private(set) var branchesRequest: String?
    @ObservationIgnored private var collapseByDefault: Bool
    @ObservationIgnored private var loadedScope: String?
    @ObservationIgnored private var pendingScope: String?
    @ObservationIgnored private var pendingFocus: String?
    @ObservationIgnored private weak var workspace: WorkspaceStore?

    init(project: String, thread: String?, workspace: WorkspaceStore, settings: Settings?) {
        self.project = project
        self.thread = thread
        self.workspace = workspace
        layout = settings?.diffLayout ?? .stacked
        wrap = settings?.wordWrap ?? true
        collapseByDefault = settings?.diffFilesCollapsed ?? false
    }

    var additions: UInt32 {
        files.reduce(0) { $0 + $1.additions }
    }

    var deletions: UInt32 {
        files.reduce(0) { $0 + $1.deletions }
    }

    var allCollapsed: Bool {
        !files.isEmpty && files.allSatisfy { collapsed.contains($0.path) }
    }

    var emptyMessage: String {
        switch scope {
        case .latestTurn, .turn: "No completed turns yet."
        case .workingTree, .branch: "No net changes in this selection."
        }
    }

    func load() {
        guard let workspace else { return }
        let coreScope: DiffScope
        switch scope {
        case .workingTree:
            coreScope = .workingTree
        case .branch:
            coreScope = .branch(base: base)
        case .latestTurn:
            guard let thread else { return settleEmpty() }
            coreScope = .latestTurn(thread: thread)
        case .turn(let turn):
            guard let thread else { return settleEmpty() }
            coreScope = .turn(thread: thread, turn: turn)
        }
        phase = .loading
        let project = project
        pendingScope = scopeKey
        request = workspace.issue(.diff(self)) { studio, id in
            studio.loadDiff(request: id, project: project, scope: coreScope)
        }
    }

    func loadBranches() {
        guard let workspace, branchesRequest == nil || branches.isEmpty else { return }
        let project = project
        branchesRequest = workspace.issue(.branches(self)) { studio, id in
            studio.listBranches(request: id, project: project, query: "", limit: 60)
        }
    }

    func loaded(_ files: [FileDiff], request: String?) {
        guard request == self.request else { return }
        if pendingScope != loadedScope {
            loadedScope = pendingScope
            self.files = []
            collapsed = []
        }
        let known = Set(self.files.map(\.path))
        if collapseByDefault {
            collapsed.formUnion(files.map(\.path).filter { !known.contains($0) })
        }
        collapsed.formIntersection(files.map(\.path))
        self.files = files
        phase = .loaded
        if let path = pendingFocus {
            pendingFocus = nil
            collapsed = Set(files.map(\.path)).subtracting([path])
        }
        rebuild()
    }

    private func settleEmpty() {
        request = nil
        pendingScope = scopeKey
        loaded([], request: nil)
    }

    func show(_ files: [FileDiff]) {
        request = nil
        pendingScope = "static"
        loaded(files, request: nil)
    }

    func setCollapseDefault(_ collapsed: Bool) {
        guard collapsed != collapseByDefault else { return }
        collapseByDefault = collapsed
        setAllCollapsed(collapsed)
    }

    private var scopeKey: String {
        "\(scope.label)|\(base ?? "")"
    }

    func failed(_ message: String, request: String) {
        guard request == self.request else { return }
        phase = .failed(message)
    }

    func branchesLoaded(_ branches: [Branch]) {
        self.branches = branches
    }

    func toggle(_ path: String) {
        if collapsed.contains(path) {
            collapsed.remove(path)
        } else {
            collapsed.insert(path)
        }
        rebuild()
    }

    func setAllCollapsed(_ value: Bool) {
        collapsed = value ? Set(files.map(\.path)) : []
        rebuild()
    }

    func focus(path: String) {
        guard phase == .loaded, files.contains(where: { $0.path == path }) else {
            pendingFocus = path
            return
        }
        collapsed = Set(files.map(\.path)).subtracting([path])
        rebuild()
    }

    private func rebuild() {
        var sections: [DiffSection] = []
        var widest: UInt32 = 0
        for file in files {
            let folded = collapsed.contains(file.path)
            let header = DiffFileHeader(
                path: file.path,
                oldPath: file.oldPath,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
                collapsed: folded
            )
            var rows: [DiffRow] = []
            defer { sections.append(DiffSection(header: header, rows: rows)) }
            guard !folded else { continue }
            if file.binary {
                rows.append(DiffRow(id: "\(file.path)#binary", kind: .note("Binary file not shown.")))
                continue
            }
            if file.hunks.isEmpty {
                rows.append(DiffRow(id: "\(file.path)#empty", kind: .note(file.status == "renamed" ? "File renamed without changes." : "No content changes.")))
                continue
            }
            for (hunkIndex, hunk) in file.hunks.enumerated() {
                let prefix = "\(file.path)#\(hunkIndex)"
                rows.append(DiffRow(id: prefix, kind: .hunk(hunk.header)))
                for line in hunk.lines {
                    widest = max(widest, line.oldLine ?? 0, line.newLine ?? 0)
                }
                switch layout {
                case .stacked:
                    for (lineIndex, line) in hunk.lines.enumerated() {
                        rows.append(DiffRow(id: "\(prefix):\(lineIndex)", kind: .line(
                            kind: line.kind,
                            old: line.oldLine,
                            new: line.newLine,
                            text: Self.display(line.text)
                        )))
                    }
                case .split:
                    rows.append(contentsOf: Self.pair(hunk.lines, prefix: prefix))
                }
            }
        }
        gutterDigits = max(2, String(widest).count)
        self.sections = sections
    }

    private static func pair(_ lines: [DiffLine], prefix: String) -> [DiffRow] {
        var rows: [DiffRow] = []
        var removed: [DiffLine] = []
        var added: [DiffLine] = []
        func flush() {
            for index in 0..<max(removed.count, added.count) {
                let left = removed.indices.contains(index) ? removed[index] : nil
                let right = added.indices.contains(index) ? added[index] : nil
                rows.append(DiffRow(id: "\(prefix):s\(rows.count)", kind: .split(
                    left: left.map { DiffCell(kind: .removed, number: $0.oldLine, text: display($0.text)) },
                    right: right.map { DiffCell(kind: .added, number: $0.newLine, text: display($0.text)) }
                )))
            }
            removed.removeAll()
            added.removeAll()
        }
        for line in lines {
            switch line.kind {
            case .removed:
                if !added.isEmpty { flush() }
                removed.append(line)
            case .added:
                added.append(line)
            case .context:
                flush()
                let text = display(line.text)
                rows.append(DiffRow(id: "\(prefix):s\(rows.count)", kind: .split(
                    left: DiffCell(kind: .context, number: line.oldLine, text: text),
                    right: DiffCell(kind: .context, number: line.newLine, text: text)
                )))
            }
        }
        flush()
        return rows
    }

    private static func display(_ text: String) -> String {
        text.replacingOccurrences(of: "\t", with: "    ").replacingOccurrences(of: "\r", with: "")
    }
}

struct FileRow: Identifiable, Equatable {
    let entry: FileEntry
    let depth: Int
    let expanded: Bool
    let loading: Bool

    var id: String { entry.relative }
}

@MainActor
@Observable
final class FilesModel {
    let project: String
    private(set) var children: [String: [FileEntry]] = [:]
    private(set) var expanded: Set<String> = []
    private(set) var loading: Set<String> = []
    private(set) var failure: String?
    private(set) var rows: [FileRow] = []
    var selection: String?

    @ObservationIgnored private(set) var requests: [String: String] = [:]
    @ObservationIgnored private weak var workspace: WorkspaceStore?
    @ObservationIgnored private weak var panels: PanelState?

    init(project: String, workspace: WorkspaceStore, panels: PanelState) {
        self.project = project
        self.workspace = workspace
        self.panels = panels
    }

    var rootLoading: Bool {
        children[""] == nil && failure == nil
    }

    func load(_ relative: String) {
        guard let workspace, !loading.contains(relative) else { return }
        loading.insert(relative)
        let project = project
        requests[relative] = workspace.issue(.directory(self, relative)) { studio, id in
            studio.listDirectory(request: id, project: project, relative: relative)
        }
        rebuild()
    }

    func refresh() {
        failure = nil
        let open = [""] + expanded.sorted()
        children.removeAll()
        for relative in open {
            load(relative)
        }
    }

    func loaded(_ entries: [FileEntry], relative: String) {
        loading.remove(relative)
        children[relative] = entries
        if relative.isEmpty {
            failure = nil
        }
        rebuild()
    }

    func failed(_ message: String, relative: String) {
        loading.remove(relative)
        if relative.isEmpty {
            failure = message
        } else {
            expanded.remove(relative)
        }
        rebuild()
    }

    func activate(_ entry: FileEntry) {
        selection = entry.relative
        if entry.directory {
            if expanded.contains(entry.relative) {
                expanded.remove(entry.relative)
            } else {
                expanded.insert(entry.relative)
                if children[entry.relative] == nil {
                    load(entry.relative)
                }
            }
            rebuild()
        } else {
            panels?.openFile(project: project, relative: entry.relative, line: nil)
        }
    }

    private func rebuild() {
        var rows: [FileRow] = []
        func walk(_ relative: String, depth: Int) {
            for entry in children[relative] ?? [] {
                let open = entry.directory && expanded.contains(entry.relative)
                rows.append(FileRow(entry: entry, depth: depth, expanded: open, loading: loading.contains(entry.relative)))
                if open {
                    walk(entry.relative, depth: depth + 1)
                }
            }
        }
        walk("", depth: 0)
        self.rows = rows
    }
}

@MainActor
@Observable
final class FilePreviewModel {
    let project: String
    let relative: String
    private(set) var line: UInt32?
    private(set) var revealCount = 0
    private(set) var phase: LoadPhase = .idle
    private(set) var content: FileContent?
    private(set) var lines: [String] = []
    private(set) var image: NSImage?

    @ObservationIgnored private(set) var request: String?
    @ObservationIgnored private weak var workspace: WorkspaceStore?

    init(project: String, relative: String, line: UInt32?, workspace: WorkspaceStore) {
        self.project = project
        self.relative = relative
        self.line = line
        self.workspace = workspace
    }

    func load() {
        guard let workspace else { return }
        phase = .loading
        let project = project
        let relative = relative
        request = workspace.issue(.file(self)) { studio, id in
            studio.readFile(request: id, project: project, relative: relative)
        }
    }

    func reveal(_ line: UInt32?) {
        self.line = line
        revealCount += 1
    }

    func loaded(_ content: FileContent, request: String) {
        guard request == self.request else { return }
        self.content = content
        switch content {
        case .text(let text, _):
            lines = text.replacingOccurrences(of: "\t", with: "    ").components(separatedBy: "\n")
            if lines.last?.isEmpty == true, lines.count > 1 {
                lines.removeLast()
            }
            image = nil
        case .image(_, let data):
            lines = []
            image = NSImage(data: data)
        case .binary, .tooLarge:
            lines = []
            image = nil
        }
        phase = .loaded
    }

    func failed(_ message: String, request: String) {
        guard request == self.request else { return }
        phase = .failed(message)
    }
}

@MainActor
@Observable
final class PullRequestsModel {
    let project: String
    private(set) var phase: LoadPhase = .idle
    private(set) var pulls: [PullRequest] = []
    private(set) var selectedDetail: PullRequestDetailModel?
    var selection: UInt64? {
        didSet { if selection != oldValue { updateDetail() } }
    }

    @ObservationIgnored private(set) var request: String?
    @ObservationIgnored private var details: [UInt64: PullRequestDetailModel] = [:]
    @ObservationIgnored private let settings: Settings?
    @ObservationIgnored private weak var workspace: WorkspaceStore?

    init(project: String, workspace: WorkspaceStore, settings: Settings?) {
        self.project = project
        self.workspace = workspace
        self.settings = settings
    }

    var selected: PullRequest? {
        pulls.first { $0.number == selection }
    }

    private func updateDetail() {
        guard let pull = selected else {
            selectedDetail = nil
            return
        }
        if let model = details[pull.number] {
            selectedDetail = model
            return
        }
        guard let workspace else { return }
        let model = PullRequestDetailModel(project: project, pull: pull, workspace: workspace, settings: settings)
        details[pull.number] = model
        model.load()
        selectedDetail = model
    }

    func load() {
        guard let workspace else { return }
        phase = .loading
        let project = project
        request = workspace.issue(.pulls(self)) { studio, id in
            studio.listPullRequests(request: id, project: project)
        }
    }

    func loaded(_ pulls: [PullRequest], request: String) {
        guard request == self.request else { return }
        self.pulls = pulls
        details = details.filter { number, _ in pulls.contains { $0.number == number } }
        if selection == nil || !pulls.contains(where: { $0.number == selection }) {
            selection = pulls.first?.number
        }
        if selectedDetail == nil {
            updateDetail()
        }
        phase = .loaded
    }

    func failed(_ message: String, request: String) {
        guard request == self.request else { return }
        phase = .failed(message)
    }
}

enum PullRequestTab: String, CaseIterable, Identifiable {
    case summary = "Summary"
    case code = "Code"
    case timeline = "Timeline"
    case checks = "Checks"

    var id: String { rawValue }
}

@MainActor
@Observable
final class PullRequestDetailModel {
    let project: String
    let pull: PullRequest
    var tab = PullRequestTab.summary
    private(set) var phase: LoadPhase = .idle
    private(set) var detail: PullRequestDetail?
    let code: DiffModel

    @ObservationIgnored private(set) var request: String?
    @ObservationIgnored private weak var workspace: WorkspaceStore?

    init(project: String, pull: PullRequest, workspace: WorkspaceStore, settings: Settings?) {
        self.project = project
        self.pull = pull
        self.workspace = workspace
        code = DiffModel(project: project, thread: nil, workspace: workspace, settings: settings)
    }

    var current: PullRequest {
        detail?.pull ?? pull
    }

    func load() {
        guard let workspace else { return }
        phase = .loading
        let project = project
        let number = pull.number
        request = workspace.issue(.pullDetail(self)) { studio, id in
            studio.loadPullRequest(request: id, project: project, number: number)
        }
    }

    func loaded(_ detail: PullRequestDetail, request: String) {
        guard request == self.request else { return }
        self.detail = detail
        code.show(detail.files)
        phase = .loaded
    }

    func failed(_ message: String, request: String) {
        guard request == self.request else { return }
        phase = .failed(message)
    }
}

@MainActor
@Observable
final class DeviceModel {
    private(set) var phase: LoadPhase = .idle
    private(set) var devices: [Device] = []
    private(set) var busy: Set<String> = []
    private(set) var status: String?
    private(set) var actionFailed = false
    var reason: String?

    @ObservationIgnored private(set) var request: String?
    @ObservationIgnored private weak var workspace: WorkspaceStore?

    init(workspace: WorkspaceStore) {
        self.workspace = workspace
    }

    var simulators: [Device] {
        Self.ordered(devices.filter { $0.platform == .iosSimulator })
    }

    var android: [Device] {
        Self.ordered(devices.filter { $0.platform != .iosSimulator })
    }

    func load() {
        guard let workspace else { return }
        phase = .loading
        request = workspace.issue(.devices(self)) { studio, id in
            studio.listDevices(request: id)
        }
    }

    func loaded(_ devices: [Device], request: String) {
        guard request == self.request else { return }
        self.devices = devices
        if !devices.isEmpty {
            reason = nil
        }
        phase = .loaded
    }

    func failed(_ message: String, request: String) {
        guard request == self.request else { return }
        phase = .failed(message)
    }

    func boot(_ device: Device) {
        perform(device) { studio, id in studio.bootDevice(request: id, device: device.id) }
    }

    func shutDown(_ device: Device) {
        perform(device) { studio, id in studio.shutdownDevice(request: id, device: device.id) }
    }

    func actionFinished(device: String, message: String, failed: Bool) {
        busy.remove(device)
        status = message
        actionFailed = failed
        load()
    }

    private func perform(_ device: Device, _ call: (Studio, String) -> Void) {
        guard let workspace, !busy.contains(device.id) else { return }
        busy.insert(device.id)
        status = nil
        _ = workspace.issue(.deviceAction(self, device.id), call)
    }

    private static func ordered(_ devices: [Device]) -> [Device] {
        devices.enumerated().sorted { left, right in
            let leftBooted = left.element.state == "Booted"
            let rightBooted = right.element.state == "Booted"
            return leftBooted != rightBooted ? leftBooted : left.offset < right.offset
        }
        .map(\.element)
    }
}
