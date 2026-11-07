import Foundation
import LocalStudioKit

struct SnoozePreset: Identifiable {
    let id: String
    let label: String
    let when: String
    let until: Date

    static func resolve(now: Date = .now, calendar: Calendar = .current, timeFormat: TimeFormat? = nil) -> [SnoozePreset] {
        let time: (Date) -> String = { TimeFormatting.time($0, timeFormat) }
        let inAnHour = now.addingTimeInterval(3_600)
        let inThreeHours = now.addingTimeInterval(3 * 3_600)
        var presets = [
            SnoozePreset(id: "hour", label: "In 1 hour", when: time(inAnHour), until: inAnHour),
            SnoozePreset(id: "three-hours", label: "In 3 hours", when: time(inThreeHours), until: inThreeHours),
        ]
        if let evening = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: now), evening.timeIntervalSince(now) > 3_600 {
            presets.append(SnoozePreset(id: "evening", label: "This evening", when: time(evening), until: evening))
        }
        guard let tomorrowDay = calendar.date(byAdding: .day, value: 1, to: now),
              let tomorrow = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrowDay) else { return presets }
        presets.append(SnoozePreset(id: "tomorrow", label: "Tomorrow", when: time(tomorrow), until: tomorrow))
        let weekday = calendar.component(.weekday, from: now)
        let daysUntilMonday = (2 - weekday + 7) % 7 == 0 ? 7 : (2 - weekday + 7) % 7
        if let mondayDay = calendar.date(byAdding: .day, value: daysUntilMonday, to: now),
           let monday = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: mondayDay), monday != tomorrow {
            let day = monday.formatted(.dateTime.weekday(.abbreviated))
            presets.append(SnoozePreset(id: "next-week", label: "Next week", when: "\(day) \(time(monday))", until: monday))
        }
        return presets
    }

    var millis: Int64 {
        Int64(until.timeIntervalSince1970 * 1_000)
    }
}

@MainActor
enum ThreadActions {
    static func snoozeMenu(_ store: StudioStore, _ ids: [String]) -> [MenuNode] {
        SnoozePreset.resolve(timeFormat: store.pages.settings?.timeFormat).map { preset in
            .action(preset.label, detail: preset.when) { store.inbox.snooze(ids, until: preset.millis) }
        } + [
            .divider("custom"),
            .action("Custom…") { store.shell.snoozeTargets = ids },
        ]
    }

    static func menu(_ store: StudioStore, for id: String, includeRename: Bool = true) -> [MenuNode] {
        let ids = store.inbox.targets(for: id)
        if ids.count > 1 {
            return bulkMenu(store, ids)
        }
        guard let row = store.inbox.thread(id) else { return [] }
        let settled = row.shelf == .settled
        let snoozed = row.shelf == .snoozed
        var nodes: [MenuNode] = []
        if let branch = row.branch {
            nodes.append(.action("New Thread on \(branch)", symbol: "arrow.triangle.branch") { store.newThread(onBranchOf: row) })
            nodes.append(.divider("branch"))
        }
        nodes.append(.action(row.pinned ? "Unpin Thread" : "Pin Thread", symbol: "pin") { store.togglePin([id]) })
        nodes.append(.action(settled ? "Un-settle Thread" : "Settle Thread", symbol: settled ? "arrow.uturn.backward" : "checkmark") { store.toggleSettle([id]) })
        if snoozed {
            nodes.append(.action("Wake Thread", symbol: "alarm") { store.inbox.snooze([id], until: nil) })
        } else {
            nodes.append(.submenu("Snooze", symbol: "clock", snoozeMenu(store, [id])))
        }
        nodes.append(.divider("edit"))
        if includeRename {
            nodes.append(.action("Rename Thread", symbol: "pencil") { store.inbox.renaming = id })
        }
        nodes.append(.action("Regenerate Title", symbol: "sparkles") { store.inbox.regenerateTitles([id]) })
        nodes.append(.action("Restart Agent Session", symbol: "arrow.clockwise") { store.inbox.restart(id) })
        nodes.append(.action(row.unread ? "Mark as Read" : "Mark as Unread", symbol: "circle.fill") { store.inbox.markUnread([id], !row.unread) })
        if let project = row.project {
            if store.inbox.projectFilter == project {
                nodes.append(.action("Show All Projects", symbol: "line.3.horizontal.decrease.circle") { store.inbox.projectFilter = nil })
            } else {
                nodes.append(.action("Filter by \(store.inbox.projectName(project))", symbol: "line.3.horizontal.decrease.circle") {
                    store.inbox.projectFilter = project
                })
            }
        }
        nodes.append(.submenu("Auto-settle", symbol: "checkmark.circle", [
            .action("Enabled", checked: row.autoSettle) { store.inbox.setAutoSettle(id, true) },
            .action("Disabled", checked: !row.autoSettle) { store.inbox.setAutoSettle(id, false) },
        ]))
        nodes.append(.divider("copy"))
        var copies: [MenuNode] = []
        if let path = store.workspacePath(for: row) {
            copies.append(.action("Path") { store.copy(path) })
        }
        if let branch = row.branch {
            copies.append(.action("Branch") { store.copy(branch) })
        }
        copies.append(.action("Thread ID") { store.copy(id) })
        nodes.append(.submenu("Copy", symbol: "doc.on.doc", copies))
        if let project = row.project {
            nodes.append(.action("Project Settings…", symbol: "folder") { store.openProjectSettings(project) })
        }
        nodes.append(.divider("danger"))
        nodes.append(.action("Archive Thread", symbol: "archivebox", enabled: row.status != .working) { store.archive([id]) })
        nodes.append(.action("Delete Thread…", symbol: "trash", destructive: true) { store.requestDelete([id]) })
        return nodes
    }

    static func bulkMenu(_ store: StudioStore, _ ids: [String]) -> [MenuNode] {
        let rows = ids.compactMap { store.inbox.thread($0) }
        let count = "\(ids.count) Threads"
        var nodes: [MenuNode] = []
        if rows.contains(where: { !$0.pinned }) {
            nodes.append(.action("Pin \(count)", symbol: "pin") { store.inbox.setPinned(ids, true) })
        }
        if rows.contains(where: \.pinned) {
            nodes.append(.action("Unpin \(count)", symbol: "pin.slash") { store.togglePin(ids.filter { store.inbox.thread($0)?.pinned == true }) })
        }
        if rows.contains(where: { $0.shelf != .settled }) {
            nodes.append(.action("Settle \(count)", symbol: "checkmark") { store.inbox.setSettled(ids, true) })
        } else {
            nodes.append(.action("Un-settle \(count)", symbol: "arrow.uturn.backward") { store.inbox.setSettled(ids, false) })
        }
        nodes.append(.submenu("Snooze", symbol: "clock", snoozeMenu(store, ids)))
        nodes.append(.divider("read"))
        nodes.append(.action("Mark as Unread", symbol: "circle.fill") { store.inbox.markUnread(ids, true) })
        nodes.append(.action("Mark as Read", symbol: "circle") { store.inbox.markUnread(ids, false) })
        nodes.append(.action("Regenerate Titles", symbol: "sparkles") { store.inbox.regenerateTitles(ids) })
        nodes.append(.divider("danger"))
        nodes.append(.action("Archive \(count)", symbol: "archivebox") { store.archive(ids) })
        nodes.append(.action("Delete \(count)…", symbol: "trash", destructive: true) { store.requestDelete(ids) })
        return nodes
    }
}
