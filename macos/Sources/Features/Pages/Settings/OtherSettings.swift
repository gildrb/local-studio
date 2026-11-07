import AppKit
import LocalStudioKit
import SwiftUI

struct SourceControlSettings: View {
    let store: StudioStore

    var body: some View {
        if let settings = store.pages.settings {
            SourceControlForm(settings: settings, store: store)
        } else {
            SettingsLoading()
        }
    }
}

private struct SourceControlForm: View {
    let settings: LocalStudioKit.Settings
    let store: StudioStore

    private var bind: SettingsBinder { SettingsBinder(settings: settings, pages: store.pages) }

    private static let intervals: [(UInt32, String)] = [
        (0, "Off"), (30, "Every 30 seconds"), (60, "Every minute"), (300, "Every 5 minutes"),
        (900, "Every 15 minutes"), (1800, "Every 30 minutes"),
    ]

    var body: some View {
        SettingsForm {
            SettingsSection(.git, footer: "Background fetches keep ahead/behind counts and pull request status fresh for every project with a remote.") {
                SettingRow(.autoPull) {
                    Toggle(isOn: bind(\.autoPull)) {
                        Text(SettingKey.autoPull.title)
                        Text("Fast-forward clean branches that are only behind their upstream.")
                    }
                }
                SettingRow(.fetchInterval) {
                    Picker(SettingKey.fetchInterval.title, selection: bind(\.gitFetchIntervalSeconds)) {
                        ForEach(Self.intervals, id: \.0) { seconds, label in
                            Text(label).tag(seconds)
                        }
                        if !Self.intervals.contains(where: { $0.0 == settings.gitFetchIntervalSeconds }) {
                            Text("Every \(settings.gitFetchIntervalSeconds) seconds").tag(settings.gitFetchIntervalSeconds)
                        }
                    }
                }
                SettingRow(.mergeMethod) {
                    Picker(SettingKey.mergeMethod.title, selection: bind(\.mergeMethod)) {
                        Text("Repository default").tag(MergeMethod.repositoryDefault)
                        Text("Merge commit").tag(MergeMethod.merge)
                        Text("Squash").tag(MergeMethod.squash)
                        Text("Rebase").tag(MergeMethod.rebase)
                    }
                }
            }
            SettingsSection(.writing) {
                SettingRow(.writingStyle) {
                    Picker(SettingKey.writingStyle.title, selection: bind(\.writingStyle)) {
                        Text("Follow repository conventions").tag(WritingStyle.repoConventions)
                        Text("Conventional Commits").tag(WritingStyle.conventionalCommits)
                        Text("Custom").tag(WritingStyle.custom)
                    }
                }
                if settings.writingStyle == .custom {
                    SettingRow(.customInstructions) {
                        CommitTextField(
                            title: SettingKey.customInstructions.title, value: settings.writingInstructions,
                            prompt: "How commit messages and pull requests should read", axis: .vertical
                        ) { value in
                            store.pages.update { $0.writingInstructions = value }
                        }
                    }
                }
                SettingRow(.followTemplates) {
                    Toggle(SettingKey.followTemplates.title, isOn: bind(\.followPrTemplates))
                }
                SettingRow(.writerModel) {
                    ModelChoicePicker(
                        title: SettingKey.writerModel.title, models: store.conversation.models,
                        provider: settings.sourceControlProvider, model: settings.sourceControlModel,
                        automatic: "Text generation model"
                    ) { key in
                        store.pages.update {
                            $0.sourceControlProvider = key?.provider
                            $0.sourceControlModel = key?.model
                        }
                    }
                }
            }
        }
    }
}

struct StorageSettings: View {
    let pages: PagesStore

    private static let retention: [UInt32] = [1, 3, 7, 14, 30, 90]

    var body: some View {
        if let settings = pages.settings {
            let bind = SettingsBinder(settings: settings, pages: pages)
            SettingsForm {
                SettingsSection(.worktrees, footer: "Applies to worktrees Local Studio created for threads. Worktrees with uncommitted changes are kept unless noted.") {
                    SettingRow(.cleanupAfter) {
                        Picker(SettingKey.cleanupAfter.title, selection: bind(\.worktreeCleanupAfterDays)) {
                            Text("Never").tag(UInt32?.none)
                            ForEach(Self.retention, id: \.self) { days in
                                Text(days == 1 ? "1 day" : "\(days) days").tag(Optional(days))
                            }
                            if let days = settings.worktreeCleanupAfterDays, !Self.retention.contains(days) {
                                Text("\(days) days").tag(Optional(days))
                            }
                        }
                    }
                    SettingRow(.cleanupOnMerge) {
                        Toggle(SettingKey.cleanupOnMerge.title, isOn: bind(\.worktreeCleanupOnMerge))
                    }
                    SettingRow(.cleanupOnDelete) {
                        Toggle(SettingKey.cleanupOnDelete.title, isOn: bind(\.worktreeCleanupOnDelete))
                    }
                    SettingRow(.cleanupUnchanged) {
                        Toggle(SettingKey.cleanupUnchanged.title, isOn: bind(\.worktreeCleanupUnchanged))
                    }
                }
                SettingsSection(.data, footer: "Projects, pins, drafts, favorites, settings and keybindings are stored here as JSON.") {
                    SettingRow(.dataLocation) {
                        LabeledContent(SettingKey.dataLocation.title) {
                            HStack {
                                Text(StudioPaths.dataDirectory.path(percentEncoded: false))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .foregroundStyle(Theme.secondaryText)
                                Button("Show in Finder") { StudioPaths.reveal(StudioPaths.dataDirectory) }
                            }
                        }
                    }
                }
            }
        } else {
            SettingsLoading()
        }
    }
}

struct LocalSettings: View {
    let store: StudioStore

    var body: some View {
        if let settings = store.pages.settings {
            SettingsForm {
                LocalControllerSection(settings: settings, pages: store.pages)
                LocalFleetSections(store: store)
            }
            .localPolling(store.pages)
        } else {
            SettingsLoading()
        }
    }
}

private struct LocalControllerSection: View {
    let settings: LocalStudioKit.Settings
    let pages: PagesStore

    var body: some View {
        SettingsSection(.controller, footer: "Leave the URL empty to use \(LocalControllerAddress.fallback). The fleet key is sent as a bearer token; when empty, the key of a controller Local Studio started is used.") {
            SettingRow(.controllerURL) {
                CommitTextField(title: SettingKey.controllerURL.title, value: settings.localControllerUrl, prompt: LocalControllerAddress.fallback) { value in
                    pages.update { $0.localControllerUrl = value.trimmingCharacters(in: .whitespaces) }
                }
            }
            SettingRow(.fleetKey) {
                CommitTextField(title: SettingKey.fleetKey.title, value: settings.fleetKey, prompt: "From the controller config", secure: true) { value in
                    pages.update { $0.fleetKey = value.trimmingCharacters(in: .whitespaces) }
                }
            }
            SettingRow(.startController) {
                Toggle(isOn: SettingsBinder(settings: settings, pages: pages)(\.startController)) {
                    Text(SettingKey.startController.title)
                    Text("When nothing answers on this Mac, run the bundled controller with its own data folder.")
                }
            }
        }
    }
}

enum LocalControllerAddress {
    static let fallback = "http://127.0.0.1:18091"

    static func effective(_ settings: LocalStudioKit.Settings?) -> String {
        if let env = ProcessInfo.processInfo.environment["LOCAL_STUDIO_CONTROLLER_URL"], !env.isEmpty { return env }
        if let url = settings?.localControllerUrl, !url.isEmpty { return url }
        return fallback
    }
}

struct ConnectionsSettings: View {
    let store: StudioStore
    let open: (SettingsPane) -> Void

    var body: some View {
        SettingsForm {
            SettingsSection(.daemon, footer: "Local Studio drives every thread through the Eukhe agent daemon on this Mac, over a local Unix socket.") {
                SettingRow(.daemonStatus) {
                    LabeledContent(SettingKey.daemonStatus.title) {
                        HStack(spacing: 6) {
                            Circle().fill(statusColor).frame(width: 7, height: 7)
                            Text(statusText)
                                .foregroundStyle(Theme.secondaryText)
                        }
                    }
                    if let daemon = store.pages.daemon {
                        LabeledContent("Socket") {
                            HStack {
                                Text(daemon.socket)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .foregroundStyle(Theme.secondaryText)
                                    .textSelection(.enabled)
                                Button("Show in Finder") { StudioPaths.reveal(URL(filePath: daemon.socket)) }
                            }
                        }
                        LabeledContent("Version", value: daemon.version ?? "Not reported")
                        if let pid = daemon.pid {
                            LabeledContent("Process", value: "PID \(pid)")
                        }
                    }
                    LabeledContent("Local controller") {
                        HStack {
                            Text(LocalControllerAddress.effective(store.pages.settings))
                                .foregroundStyle(Theme.secondaryText)
                                .textSelection(.enabled)
                            Button("Show Local") { open(.local) }
                        }
                    }
                }
            }
            SettingsSection(.unsupported) {
                SettingRow(.remoteEnvironments) {
                    SettingsNote(
                        symbol: "network",
                        text: "Remote environments, pairing links, authorized clients and SSH hosts have no backend in the Eukhe daemon, which only listens on a local socket, so Local Studio cannot offer them. Other machines join through the Local fleet instead: connect them from Settings › Local."
                    )
                }
            }
        }
    }

    private var statusText: String {
        switch store.connection {
        case .connecting: "Connecting…"
        case .ready: "Connected"
        case .lost(let reason): "Disconnected: \(reason)"
        }
    }

    private var statusColor: Color {
        switch store.connection {
        case .connecting: Theme.warning
        case .ready: Theme.success
        case .lost: Theme.danger
        }
    }
}
