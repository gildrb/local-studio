import AppKit
import LocalStudioKit
import SwiftUI

struct GeneralSettings: View {
    let store: StudioStore

    var body: some View {
        if let settings = store.pages.settings {
            GeneralSettingsForm(settings: settings, store: store)
        } else {
            SettingsLoading()
        }
    }
}

private struct GeneralSettingsForm: View {
    let settings: LocalStudioKit.Settings
    let store: StudioStore

    private var bind: SettingsBinder { SettingsBinder(settings: settings, pages: store.pages) }
    private var pages: PagesStore { store.pages }

    var body: some View {
        SettingsForm {
            projectDefaults
            organization
            behavior
            keyboard
            confirmations
            SettingsSection(.textGeneration, footer: "Writes thread titles, commit messages and pull request descriptions.") {
                SettingRow(.textGenerationModel) {
                    ModelChoicePicker(
                        title: SettingKey.textGenerationModel.title, models: store.conversation.models,
                        provider: settings.textGenerationProvider, model: settings.textGenerationModel
                    ) { key in
                        pages.update {
                            $0.textGenerationProvider = key?.provider
                            $0.textGenerationModel = key?.model
                        }
                    }
                }
            }
            SettingsSection(.about) {
                SettingRow(.version) {
                    LabeledContent(SettingKey.version.title, value: StudioPaths.version)
                }
            }
            SettingsSection(.diagnostics) {
                SettingRow(.dataFolder) {
                    LabeledContent(SettingKey.dataFolder.title) {
                        HStack {
                            Text(StudioPaths.dataDirectory.path(percentEncoded: false))
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .foregroundStyle(Theme.secondaryText)
                            Button("Show in Finder") { StudioPaths.reveal(StudioPaths.dataDirectory) }
                        }
                    }
                }
                SettingRow(.pythonKernel) {
                    LabeledContent(SettingKey.pythonKernel.title) {
                        KernelStatus(store: store)
                    }
                }
            }
            SettingsSection(.legacy) {
                SettingRow(.contextMeter) {
                    Toggle(SettingKey.contextMeter.title, isOn: bind(\.contextWindowMeter))
                }
            }
        }
    }

    @ViewBuilder private var projectDefaults: some View {
        SettingsSection(.projectDefaults, footer: "Used for new threads. Each thread can still change its model, thinking level and permissions.") {
            SettingRow(.defaultModel) {
                ModelChoicePicker(
                    title: SettingKey.defaultModel.title, models: store.conversation.models,
                    provider: settings.defaultProvider, model: settings.defaultModel
                ) { key in
                    pages.update {
                        $0.defaultProvider = key?.provider
                        $0.defaultModel = key?.model
                        $0.defaultThinkingLevel = nil
                    }
                }
            }
            SettingRow(.thinkingLevel) {
                Picker(SettingKey.thinkingLevel.title, selection: bind(\.defaultThinkingLevel)) {
                    Text("Model default").tag(String?.none)
                    ForEach(thinkingLevels, id: \.self) { level in
                        Text(level.capitalized).tag(Optional(level))
                    }
                }
                .disabled(thinkingLevels.isEmpty)
            }
            SettingRow(.permissions) {
                Picker(SettingKey.permissions.title, selection: bind(\.defaultAccess)) {
                    Text("Supervised").tag(AccessMode.supervised)
                    Text("Auto-accept edits").tag(AccessMode.autoAcceptEdits)
                    Text("Auto").tag(AccessMode.auto)
                    Text("Full access").tag(AccessMode.fullAccess)
                }
            }
            SettingRow(.newThreads) {
                Picker(SettingKey.newThreads.title, selection: bind(\.newThreadWorkspace)) {
                    Text("Local checkout").tag(NewThreadWorkspace.local)
                    Text("New worktree").tag(NewThreadWorkspace.worktree)
                }
            }
            SettingRow(.startFromOrigin) {
                Toggle(SettingKey.startFromOrigin.title, isOn: bind(\.newWorktreesStartFromOrigin))
            }
            SettingRow(.addProjectBase) {
                LabeledContent(SettingKey.addProjectBase.title) {
                    HStack {
                        Text(settings.addProjectBaseDirectory.isEmpty ? "Home folder" : settings.addProjectBaseDirectory)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .foregroundStyle(Theme.secondaryText)
                        Button("Choose…", action: chooseBaseDirectory)
                    }
                }
            }
        }
    }

    @ViewBuilder private var organization: some View {
        SettingsSection(.organization) {
            SettingRow(.workingSection) {
                Toggle(isOn: bind(\.workingSection)) {
                    Text(SettingKey.workingSection.title)
                    Text("Running threads fold into a Working shelf and return to Active when they need you.")
                }
            }
            SettingRow(.autoSettleMerged) {
                Toggle(SettingKey.autoSettleMerged.title, isOn: bind(\.autoSettleMerged))
            }
            SettingRow(.autoSettleInactive) {
                Toggle(SettingKey.autoSettleInactive.title, isOn: bind(\.autoSettleInactive))
            }
            SettingRow(.inactiveDays) {
                LabeledContent(SettingKey.inactiveDays.title) {
                    HStack(spacing: 6) {
                        Text(settings.autoSettleInactiveDays == 1 ? "1 day" : "\(settings.autoSettleInactiveDays) days")
                            .monospacedDigit()
                        Stepper(SettingKey.inactiveDays.title, value: bind(\.autoSettleInactiveDays), in: 1...90)
                            .labelsHidden()
                    }
                }
                .disabled(!settings.autoSettleInactive)
            }
        }
    }

    @ViewBuilder private var behavior: some View {
        SettingsSection(.behavior) {
            SettingRow(.notifications) {
                Picker(SettingKey.notifications.title, selection: bind(\.notifications)) {
                    Text("Off").tag(NotificationMode.off)
                    Text("Notifications").tag(NotificationMode.notifications)
                    Text("Sound").tag(NotificationMode.sound)
                    Text("Notifications and sound").tag(NotificationMode.notificationsAndSound)
                }
            }
            SettingRow(.inAppNotifications) {
                Toggle(SettingKey.inAppNotifications.title, isOn: bind(\.inAppNotifications))
            }
            SettingRow(.timeFormat) {
                Picker(SettingKey.timeFormat.title, selection: bind(\.timeFormat)) {
                    Text("System").tag(TimeFormat.locale)
                    Text("12-hour").tag(TimeFormat.twelveHour)
                    Text("24-hour").tag(TimeFormat.twentyFourHour)
                }
            }
            SettingRow(.responseStreaming) {
                Picker(SettingKey.responseStreaming.title, selection: bind(\.responseStreaming)) {
                    Text("Whole turn").tag(ResponseStreaming.turn)
                    Text("Paragraph").tag(ResponseStreaming.paragraph)
                    Text("Token").tag(ResponseStreaming.token)
                }
            }
            SettingRow(.hideWhitespace) {
                Toggle(SettingKey.hideWhitespace.title, isOn: bind(\.hideWhitespace))
            }
            SettingRow(.diffFileState) {
                Picker(SettingKey.diffFileState.title, selection: bind(\.diffFilesCollapsed)) {
                    Text("Collapsed").tag(true)
                    Text("Expanded").tag(false)
                }
            }
            SettingRow(.diffLayout) {
                Picker(SettingKey.diffLayout.title, selection: bind(\.diffLayout)) {
                    Text("Stacked").tag(DiffLayout.stacked)
                    Text("Side by side").tag(DiffLayout.split)
                }
            }
            SettingRow(.proactivePanels) {
                Toggle(isOn: bind(\.proactivePanels)) {
                    Text(SettingKey.proactivePanels.title)
                    Text("Open the right panel when a thread produces diffs or previews.")
                }
            }
            SettingRow(.skillsInSlash) {
                Toggle(SettingKey.skillsInSlash.title, isOn: bind(\.showSkillsInSlashMenu))
            }
            SettingRow(.richText) {
                Toggle(SettingKey.richText.title, isOn: bind(\.richTextComposer))
            }
            SettingRow(.collapseComposer) {
                Toggle(SettingKey.collapseComposer.title, isOn: bind(\.collapseComposerOnScroll))
            }
            SettingRow(.sendShortcut) {
                Picker(SettingKey.sendShortcut.title, selection: bind(\.sendShortcut)) {
                    Text("Return").tag(SendShortcut.enter)
                    Text("⌘Return, multiline Return").tag(SendShortcut.modEnterMultiline)
                    Text("⌘Return").tag(SendShortcut.modEnter)
                }
            }
            SettingRow(.followUp) {
                Picker(SettingKey.followUp.title, selection: bind(\.followUpBehavior)) {
                    Text("Queue").tag(FollowUpBehavior.queue)
                    Text("Steer").tag(FollowUpBehavior.steer)
                }
            }
            SettingRow(.continueThreads) {
                Toggle(SettingKey.continueThreads.title, isOn: bind(\.continueThreadsAfterRestart))
            }
        }
    }

    @ViewBuilder private var keyboard: some View {
        SettingsSection(.keyboard) {
            SettingRow(.vimKeys) {
                Toggle(isOn: bind(\.vimMode)) {
                    Text(SettingKey.vimKeys.title)
                    Text("Modal editing in the composer, plus j/k, gg/G, h/l, / and i in lists.")
                }
            }
        }
    }

    @ViewBuilder private var confirmations: some View {
        SettingsSection(.confirmations) {
            SettingRow(.confirmUnpin) {
                Toggle(SettingKey.confirmUnpin.title, isOn: bind(\.confirmUnpin))
            }
            SettingRow(.confirmArchive) {
                Toggle(SettingKey.confirmArchive.title, isOn: bind(\.confirmArchive))
            }
            SettingRow(.confirmDelete) {
                Toggle(SettingKey.confirmDelete.title, isOn: bind(\.confirmDelete))
            }
            SettingRow(.quitShortcut) {
                Picker(SettingKey.quitShortcut.title, selection: bind(\.quitConfirmation)) {
                    Text("Quit immediately").tag(QuitConfirmation.direct)
                    Text("Hold ⌘Q").tag(QuitConfirmation.hold)
                    Text("Press ⌘Q twice").tag(QuitConfirmation.doubleClick)
                }
            }
        }
    }

    private var thinkingLevels: [String] {
        store.conversation.models.first { $0.provider == settings.defaultProvider && $0.id == settings.defaultModel }?.thinkingLevels ?? []
    }

    private func chooseBaseDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        if !settings.addProjectBaseDirectory.isEmpty {
            panel.directoryURL = URL(filePath: settings.addProjectBaseDirectory)
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        pages.update { $0.addProjectBaseDirectory = url.path(percentEncoded: false) }
    }
}

struct SettingsLoading: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "gearshape")
                .icon(.display, .secondary)
                .accessibilityHidden(true)
            Text("Waiting for the core…")
                .foregroundStyle(Theme.secondaryText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.canvas)
    }
}

enum StudioPaths {
    static var dataDirectory: URL {
        if let override = ProcessInfo.processInfo.environment["LOCAL_STUDIO_DATA_DIR"], !override.isEmpty {
            return URL(filePath: override, directoryHint: .isDirectory)
        }
        return URL.applicationSupportDirectory.appending(path: "Local Studio", directoryHint: .isDirectory)
    }

    static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "Development"
        guard let build = info?["CFBundleVersion"] as? String, build != short else { return short }
        return "\(short) (\(build))"
    }

    @MainActor static func reveal(_ url: URL) {
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
}
