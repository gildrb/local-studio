import Foundation
import LocalStudioKit
import Observation

struct InboxSections: Equatable {
    var pinned: [ThreadRow] = []
    var active: [ThreadRow] = []
    var working: [ThreadRow] = []
    var snoozed: [ThreadRow] = []
    var settled: [ThreadRow] = []

    var isEmpty: Bool {
        pinned.isEmpty && active.isEmpty && working.isEmpty && snoozed.isEmpty && settled.isEmpty
    }
}

enum InboxShelf: String, CaseIterable {
    case working
    case snoozed
    case settled

    var title: String {
        switch self {
        case .working: "Working"
        case .snoozed: "Snoozed"
        case .settled: "Settled"
        }
    }
}

struct InboxUndo: Equatable {
    let label: String
    let threads: [String]
    let revert: Revert

    enum Revert: Equatable {
        case pinned(Bool)
        case settled(Bool)
        case archived(Bool)
        case snoozed([String: Int64?])
        case unread(Bool)
    }
}

struct InboxSearchEntry: Identifiable, Equatable {
    let id: String
    let title: String
    let project: String?
    let branch: String?
    let snippet: String?
    let updatedAt: Int64?
}

struct FanOutPosition: Equatable {
    let index: Int
    let count: Int
}

@MainActor
@Observable
final class InboxStore {
    static let settledPage = 10

    private(set) var projects: [Project] = []
    private(set) var threads: [ThreadRow] = []
    private(set) var sections = InboxSections()
    private(set) var visibleOrder: [String] = []
    private(set) var searchResults: [ThreadRow] = []
    private(set) var threadSearch: (request: String, hits: [ThreadSearchHit])?
    private(set) var currentProject: String?
    private(set) var undo: InboxUndo?
    private(set) var receivedThreads = false
    private(set) var receivedProjects = false

    private(set) var searchEntries: [InboxSearchEntry] = []
    private(set) var searchingMessages = false

    var query = "" {
        didSet {
            guard query != oldValue else { return }
            searchRequest = nil
            searchedQuery = nil
            searchingMessages = !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            rebuild()
        }
    }
    var projectFilter: String? {
        didSet { if projectFilter != oldValue { rebuild() } }
    }
    var collapsed: Set<InboxShelf> = [] {
        didSet { if collapsed != oldValue { rebuildOrder() } }
    }
    var settledLimit = InboxStore.settledPage {
        didSet { if settledLimit != oldValue { rebuildOrder() } }
    }
    var selection: Set<String> = []
    var selectionAnchor: String?
    var renaming: String?

    let shell = ShellState()
    let commands = CommandRouter()
    @ObservationIgnored let notifier = Notifier()

    @ObservationIgnored private let core: CoreHandle
    @ObservationIgnored private let requests: RequestCenter
    @ObservationIgnored private var projectChosen = false
    @ObservationIgnored private var index: [String: ThreadRow] = [:]
    @ObservationIgnored private(set) var searchRequest: String?
    @ObservationIgnored private var searchedQuery: String?
    @ObservationIgnored private(set) var threadsRevision = 0
    @ObservationIgnored private var pendingRows: [ThreadRow] = []
    @ObservationIgnored private var pendingIndex: [String: ThreadRow] = [:]
    @ObservationIgnored private var aliases: [String: String] = [:]

    init(core: CoreHandle, requests: RequestCenter) {
        self.core = core
        self.requests = requests
    }

    func setProjects(_ projects: [Project]) {
        receivedProjects = true
        self.projects = projects
        if let filter = projectFilter, !projects.contains(where: { $0.id == filter }) {
            projectFilter = nil
        }
        if let current = currentProject, projects.contains(where: { $0.id == current }) { return }
        if currentProject == nil, projectChosen { return }
        currentProject = projects.first?.id
    }

    func renameProject(_ project: String, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, self.project(project)?.name != trimmed else { return }
        core.run { $0.renameProject(project: project, name: trimmed) }
    }

    func setProjectIcon(_ project: String, _ icon: String?) {
        let value = icon?.trimmingCharacters(in: .whitespacesAndNewlines)
        core.run { $0.setProjectIcon(project: project, icon: value?.isEmpty == true ? nil : value) }
    }

    private(set) var projectScripts: [String: [ProjectScript]] = [:]
    private(set) var projectSettings: [String: (settings: ProjectSettings, effective: Settings)] = [:]
    private(set) var fanOut: [String: FanOutPosition] = [:]

    func setProjectScripts(project: String, scripts: [ProjectScript]) {
        projectScripts[project] = scripts
    }

    func setProjectSettings(project: String, settings: ProjectSettings, effective: Settings) {
        projectSettings[project] = (settings, effective)
    }

    func setThreadSearch(request: String, hits: [ThreadSearchHit]) {
        threadSearch = (request, hits)
        guard request == searchRequest else { return }
        searchingMessages = false
        rebuildSearch()
        rebuildOrder()
    }

    func searchMessages() {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else {
            searchRequest = nil
            searchingMessages = false
            return
        }
        guard needle != searchedQuery || searchRequest == nil else { return }
        let request = requests.issue { [weak self] outcome in
            if case .failed = outcome { self?.searchingMessages = false }
        }
        searchRequest = request
        searchedQuery = needle
        searchingMessages = true
        core.run { $0.searchThreads(request: request, query: needle, limit: 40) }
    }

    func movePinned(_ id: String, before target: String?) {
        guard id != target else { return }
        var order = threads.filter { $0.shelf == .pinned }.map(\.id)
        let wasPinned = order.contains(id)
        order.removeAll { $0 == id }
        order.insert(id, at: target.flatMap { order.firstIndex(of: $0) } ?? order.endIndex)
        var local = threads.filter { $0.id != id }
        if var moved = index[id] {
            moved.pinned = true
            moved.shelf = .pinned
            local.append(moved)
        }
        let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
        let pinned = local.filter { rank[$0.id] != nil }.sorted { (rank[$0.id] ?? 0) < (rank[$1.id] ?? 0) }
        apply(pinned + local.filter { rank[$0.id] == nil })
        core.run { studio in
            if !wasPinned { studio.setPinned(thread: id, pinned: true) }
            studio.reorderPinned(threads: order)
        }
    }

    func setAutoSettle(_ id: String, _ enabled: Bool) {
        core.run { $0.setAutoSettle(thread: id, enabled: enabled) }
    }

    func regenerateTitles(_ ids: [String]) {
        core.run { studio in ids.forEach { studio.regenerateTitle(thread: $0) } }
    }

    func setThreads(_ threads: [ThreadRow]) {
        receivedThreads = true
        threadsRevision += 1
        apply(threads)
    }

    private func apply(_ threads: [ThreadRow]) {
        self.threads = threads
        index = Dictionary(threads.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        selection.formIntersection(index.keys)
        var groups: [String: [ThreadRow]] = [:]
        for row in threads {
            if let group = row.fanOut { groups[group, default: []].append(row) }
        }
        var positions: [String: FanOutPosition] = [:]
        for members in groups.values where members.count > 1 {
            for (offset, row) in members.sorted(by: { $0.id < $1.id }).enumerated() {
                positions[row.id] = FanOutPosition(index: offset + 1, count: members.count)
            }
        }
        if positions != fanOut { fanOut = positions }
        rebuild()
    }

    func restart(_ id: String) {
        core.run { $0.restartThread(thread: id) }
    }

    func loadProjectSettings(_ project: String) {
        core.run { $0.loadProjectSettings(project: project) }
    }

    func updateProjectSettings(_ project: String, _ settings: ProjectSettings) {
        core.run { $0.updateProjectSettings(project: project, settings: settings) }
    }

    func saveProjectScripts(_ project: String, _ scripts: [ProjectScript]) {
        core.run { $0.setProjectScripts(project: project, scripts: scripts) }
    }

    func importProjectScripts(_ project: String, done: @escaping (RequestOutcome) -> Void) {
        let request = requests.issue(onOutcome: done)
        core.run { $0.importProjectScripts(request: request, project: project) }
    }

    func cloneProject(url: String, parent: String, done: @escaping (RequestOutcome) -> Void) {
        let request = requests.issue(onOutcome: done)
        core.run { $0.cloneProject(request: request, url: url, parentDir: parent) }
    }

    func notify(thread: String, kind: NotificationKind, title: String, body: String) {
        notifier.deliver(thread: thread, kind: kind, title: title, body: body)
    }

    func thread(_ id: String?) -> ThreadRow? {
        guard let id else { return nil }
        return index[id] ?? pendingIndex[id]
    }

    func isPending(_ id: String) -> Bool {
        pendingIndex[id] != nil
    }

    func key(_ id: String) -> String {
        aliases[id] ?? id
    }

    func setPending(_ rows: [ThreadRow], aliases: [String: String], workingSection: Bool) {
        let shelved = rows.map { row in
            var row = row
            row.shelf = row.status == .working && workingSection ? .working : .active
            return row
        }
        self.aliases = aliases
        guard shelved != pendingRows else { return }
        pendingRows = shelved
        pendingIndex = Dictionary(shelved.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        rebuild()
    }

    func project(_ id: String?) -> Project? {
        guard let id else { return nil }
        return projects.first { $0.id == id }
    }

    func projectName(_ id: String?) -> String {
        project(id)?.name ?? "No project"
    }

    func selectProject(_ project: String?) {
        projectChosen = true
        currentProject = project
    }

    func addProject(path: String) {
        core.run { $0.addProject(path: path) }
        selectProject(path)
    }

    func removeProject(_ project: String) {
        core.run { $0.removeProject(project: project) }
    }

    func setPinned(_ ids: [String], _ pinned: Bool) {
        let changed = ids.filter { index[$0]?.pinned != pinned }
        guard !changed.isEmpty else { return }
        core.run { studio in changed.forEach { studio.setPinned(thread: $0, pinned: pinned) } }
        remember(pinned ? "Pinned" : "Unpinned", changed, .pinned(!pinned))
    }

    func setSettled(_ ids: [String], _ settled: Bool) {
        let changed = ids.filter { (index[$0]?.shelf == .settled) != settled }
        guard !changed.isEmpty else { return }
        core.run { studio in changed.forEach { studio.setSettled(thread: $0, settled: settled) } }
        remember(settled ? "Settled" : "Un-settled", changed, .settled(!settled))
    }

    func snooze(_ ids: [String], until: Int64?) {
        guard !ids.isEmpty else { return }
        let previous = Dictionary(ids.map { ($0, index[$0]?.snoozedUntil) }, uniquingKeysWith: { first, _ in first })
        core.run { studio in ids.forEach { studio.snooze(thread: $0, until: until) } }
        remember(until == nil ? "Woke" : "Snoozed", ids, .snoozed(previous))
    }

    func markUnread(_ ids: [String], _ unread: Bool) {
        guard !ids.isEmpty else { return }
        core.run { studio in ids.forEach { studio.markUnread(thread: $0, unread: unread) } }
        remember(unread ? "Marked unread" : "Marked read", ids, .unread(!unread))
    }

    func setArchived(_ ids: [String], _ archived: Bool) {
        guard !ids.isEmpty else { return }
        core.run { studio in ids.forEach { studio.setArchived(thread: $0, archived: archived) } }
        selection.subtract(ids)
        remember(archived ? "Archived" : "Unarchived", ids, .archived(!archived))
    }

    func delete(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        core.run { studio in ids.forEach { studio.deleteThread(thread: $0) } }
        selection.subtract(ids)
        undo = nil
    }

    func rename(_ id: String, to title: String) {
        renaming = nil
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, index[id]?.title != trimmed else { return }
        core.run { $0.renameThread(thread: id, title: trimmed) }
    }

    func performUndo() {
        guard let undo else { return }
        self.undo = nil
        let ids = undo.threads
        core.run { studio in
            for id in ids {
                switch undo.revert {
                case .pinned(let value): studio.setPinned(thread: id, pinned: value)
                case .settled(let value): studio.setSettled(thread: id, settled: value)
                case .archived(let value): studio.setArchived(thread: id, archived: value)
                case .unread(let value): studio.markUnread(thread: id, unread: value)
                case .snoozed(let previous): studio.snooze(thread: id, until: previous[id] ?? nil)
                }
            }
        }
    }

    func dismissUndo() {
        undo = nil
    }

    func toggleShelf(_ shelf: InboxShelf) {
        if collapsed.contains(shelf) {
            collapsed.remove(shelf)
        } else {
            collapsed.insert(shelf)
        }
    }

    func showMoreSettled() {
        settledLimit += Self.settledPage
    }

    func neighbor(of id: String?, offset: Int) -> String? {
        guard !visibleOrder.isEmpty else { return nil }
        guard let id, let position = visibleOrder.firstIndex(of: id) else {
            return offset > 0 ? visibleOrder.first : visibleOrder.last
        }
        let target = position + offset
        return visibleOrder.indices.contains(target) ? visibleOrder[target] : nil
    }

    func jumpTarget(_ number: Int) -> String? {
        let position = number - 1
        return visibleOrder.indices.contains(position) ? visibleOrder[position] : nil
    }

    func extendSelection(to id: String) {
        guard let anchor = selectionAnchor ?? selection.first,
              let from = visibleOrder.firstIndex(of: anchor),
              let to = visibleOrder.firstIndex(of: id) else {
            selection = [id]
            selectionAnchor = id
            return
        }
        selection = Set(visibleOrder[min(from, to)...max(from, to)])
    }

    func toggleSelection(_ id: String, focused: String?) {
        if selection.isEmpty, let focused, focused != id, index[focused] != nil {
            selection.insert(focused)
        }
        if selection.contains(id) {
            selection.remove(id)
        } else {
            selection.insert(id)
        }
        selectionAnchor = id
    }

    func clearSelection() {
        selection = []
        selectionAnchor = nil
    }

    func targets(for id: String) -> [String] {
        selection.count > 1 && selection.contains(id) ? visibleOrder.filter { selection.contains($0) } : [id]
    }

    private func remember(_ label: String, _ ids: [String], _ revert: InboxUndo.Revert) {
        let noun = ids.count == 1 ? "thread" : "\(ids.count) threads"
        undo = InboxUndo(label: "\(label) \(noun)", threads: ids, revert: revert)
    }

    private func rebuild() {
        var next = InboxSections()
        for row in pendingRows + threads where projectFilter.map({ row.project == $0 }) ?? true {
            switch row.shelf {
            case .pinned: next.pinned.append(row)
            case .active: next.active.append(row)
            case .working: next.working.append(row)
            case .snoozed: next.snoozed.append(row)
            case .settled: next.settled.append(row)
            }
        }
        if next != sections {
            sections = next
        }
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        searchResults = needle.isEmpty ? [] : threads.filter { row in
            (projectFilter.map { row.project == $0 } ?? true)
                && (row.title.localizedCaseInsensitiveContains(needle)
                    || projectName(row.project).localizedCaseInsensitiveContains(needle)
                    || (row.branch?.localizedCaseInsensitiveContains(needle) ?? false))
        }
        rebuildSearch()
        rebuildOrder()
    }

    private func rebuildSearch() {
        let hits = threadSearch.flatMap { $0.request == searchRequest ? $0.hits : nil } ?? []
        let snippets = Dictionary(hits.map { ($0.thread, $0.snippet) }, uniquingKeysWith: { first, _ in first })
        var entries = searchResults.map { row in
            InboxSearchEntry(id: row.id, title: row.title, project: row.project, branch: row.branch, snippet: snippets[row.id], updatedAt: row.updatedAt)
        }
        let titled = Set(entries.map(\.id))
        for hit in hits where !titled.contains(hit.thread) && (projectFilter.map { hit.project == $0 } ?? true) {
            let row = index[hit.thread]
            entries.append(InboxSearchEntry(id: hit.thread, title: hit.title, project: hit.project, branch: row?.branch, snippet: hit.snippet, updatedAt: row?.updatedAt))
        }
        if entries != searchEntries {
            searchEntries = entries
        }
    }

    private func rebuildOrder() {
        var order = sections.pinned.map(\.id) + sections.active.map(\.id)
        if !collapsed.contains(.working) { order += sections.working.map(\.id) }
        if !collapsed.contains(.snoozed) { order += sections.snoozed.map(\.id) }
        if !collapsed.contains(.settled) { order += sections.settled.prefix(settledLimit).map(\.id) }
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            order = searchEntries.map(\.id)
        }
        if order != visibleOrder {
            visibleOrder = order
        }
    }
}
