import LocalStudioKit
import SwiftUI

enum SettingsPane: String, CaseIterable, Identifiable, Hashable {
    case project
    case general
    case appearance
    case keybindings
    case snapshots
    case providers
    case sourceControl
    case storage
    case local
    case connections
    case archive

    var id: String { rawValue }

    var title: String {
        switch self {
        case .project: "Project"
        case .general: "General"
        case .appearance: "Appearance"
        case .keybindings: "Keybindings"
        case .snapshots: "SnapShots"
        case .providers: "Providers"
        case .sourceControl: "Source Control"
        case .storage: "Storage"
        case .local: "Local"
        case .connections: "Connections"
        case .archive: "Archive"
        }
    }

    var symbol: String {
        switch self {
        case .project: "folder"
        case .general: "gearshape"
        case .appearance: "circle.lefthalf.filled"
        case .keybindings: "keyboard"
        case .snapshots: "camera"
        case .providers: "sparkles"
        case .sourceControl: "arrow.triangle.branch"
        case .storage: "internaldrive"
        case .local: "server.rack"
        case .connections: "link"
        case .archive: "archivebox"
        }
    }

    var tint: Color {
        switch self {
        case .project: .blue
        case .general: .gray
        case .appearance: .indigo
        case .keybindings: .gray
        case .snapshots: .pink
        case .providers: .purple
        case .sourceControl: .orange
        case .storage: .gray
        case .local: .green
        case .connections: .blue
        case .archive: .brown
        }
    }
}

enum SettingsGroup: Hashable {
    case projectDefaults
    case organization
    case behavior
    case confirmations
    case textGeneration
    case about
    case diagnostics
    case legacy
    case theme
    case interface
    case typography
    case shortcuts
    case snapshotCapture
    case snapshotFeedback
    case providerList
    case providerSignIn
    case hiddenModels
    case git
    case writing
    case worktrees
    case data
    case controller
    case fleet
    case daemon
    case unsupported
    case archived

    var title: String {
        switch self {
        case .projectDefaults: "Project Defaults"
        case .organization: "Organization"
        case .behavior: "Behavior"
        case .confirmations: "Confirmations"
        case .textGeneration: "Text Generation"
        case .about: "About"
        case .diagnostics: "Diagnostics"
        case .legacy: "Legacy"
        case .theme: "Theme"
        case .interface: "Interface"
        case .typography: "Typography"
        case .shortcuts: "Shortcuts"
        case .snapshotCapture: "Capture"
        case .snapshotFeedback: "Feedback"
        case .providerList: "Providers"
        case .providerSignIn: "Signing In"
        case .hiddenModels: "Hidden Models"
        case .git: "Git"
        case .writing: "Commit and Pull Request Writing"
        case .worktrees: "Worktree Cleanup"
        case .data: "Data"
        case .controller: "Controller"
        case .fleet: "Fleet"
        case .daemon: "Agent Daemon"
        case .unsupported: "Remote Environments"
        case .archived: "Archived Threads"
        }
    }

    var pane: SettingsPane {
        switch self {
        case .projectDefaults, .organization, .behavior, .confirmations, .textGeneration, .about, .diagnostics, .legacy: .general
        case .theme, .interface, .typography: .appearance
        case .shortcuts: .keybindings
        case .snapshotCapture, .snapshotFeedback: .snapshots
        case .providerList, .providerSignIn, .hiddenModels: .providers
        case .git, .writing: .sourceControl
        case .worktrees, .data: .storage
        case .controller, .fleet: .local
        case .daemon, .unsupported: .connections
        case .archived: .archive
        }
    }

    var settings: [SettingKey] {
        SettingKey.allCases.filter { $0.group == self }
    }
}

enum SettingKey: CaseIterable {
    case defaultModel, thinkingLevel, permissions, newThreads, startFromOrigin, addProjectBase
    case workingSection, autoSettleMerged, autoSettleInactive, inactiveDays
    case notifications, inAppNotifications, timeFormat, responseStreaming, hideWhitespace, diffFileState, diffLayout
    case proactivePanels, skillsInSlash, richText, collapseComposer, sendShortcut, followUp, continueThreads
    case confirmUnpin, confirmArchive, confirmDelete, quitShortcut
    case textGenerationModel
    case version
    case dataFolder
    case contextMeter
    case colorScheme, themes
    case contrast, glassOpacity, diffColors, chatWidth, openLinks
    case interfaceFont, promptFont, codeFont, terminalFont, fontSmoothing, wordWrap
    case providers, favorites, signIn, hiddenModels
    case autoPull, fetchInterval, mergeMethod
    case writingStyle, customInstructions, followTemplates, writerModel
    case cleanupAfter, cleanupOnMerge, cleanupOnDelete, cleanupUnchanged
    case dataLocation
    case controllerURL, fleetKey, startController
    case machines, registry, localUsage
    case daemonStatus, remoteEnvironments
    case archivedThreads
    case snapshotEnabled, snapshotShortcut, snapshotIncludeText, snapshotPermission
    case snapshotSound, snapshotFlash, snapshotAnimations

    var group: SettingsGroup {
        switch self {
        case .defaultModel, .thinkingLevel, .permissions, .newThreads, .startFromOrigin, .addProjectBase: .projectDefaults
        case .workingSection, .autoSettleMerged, .autoSettleInactive, .inactiveDays: .organization
        case .notifications, .inAppNotifications, .timeFormat, .responseStreaming, .hideWhitespace, .diffFileState, .diffLayout,
             .proactivePanels, .skillsInSlash, .richText, .collapseComposer, .sendShortcut, .followUp, .continueThreads: .behavior
        case .confirmUnpin, .confirmArchive, .confirmDelete, .quitShortcut: .confirmations
        case .textGenerationModel: .textGeneration
        case .version: .about
        case .dataFolder: .diagnostics
        case .contextMeter: .legacy
        case .colorScheme, .themes: .theme
        case .contrast, .glassOpacity, .diffColors, .chatWidth, .openLinks: .interface
        case .interfaceFont, .promptFont, .codeFont, .terminalFont, .fontSmoothing, .wordWrap: .typography
        case .providers, .favorites: .providerList
        case .signIn: .providerSignIn
        case .hiddenModels: .hiddenModels
        case .autoPull, .fetchInterval, .mergeMethod: .git
        case .writingStyle, .customInstructions, .followTemplates, .writerModel: .writing
        case .cleanupAfter, .cleanupOnMerge, .cleanupOnDelete, .cleanupUnchanged: .worktrees
        case .dataLocation: .data
        case .controllerURL, .fleetKey, .startController: .controller
        case .machines, .registry, .localUsage: .fleet
        case .daemonStatus: .daemon
        case .remoteEnvironments: .unsupported
        case .archivedThreads: .archived
        case .snapshotEnabled, .snapshotShortcut, .snapshotIncludeText, .snapshotPermission: .snapshotCapture
        case .snapshotSound, .snapshotFlash, .snapshotAnimations: .snapshotFeedback
        }
    }

    var title: String {
        switch self {
        case .defaultModel: "Default model"
        case .thinkingLevel: "Thinking level"
        case .permissions: "Permissions"
        case .newThreads: "New threads"
        case .startFromOrigin: "Start new worktrees from origin"
        case .addProjectBase: "Add project starts in"
        case .workingSection: "Working section"
        case .autoSettleMerged: "Auto-settle merged threads"
        case .autoSettleInactive: "Auto-settle inactive threads"
        case .inactiveDays: "Days of inactivity"
        case .notifications: "Thread notifications"
        case .inAppNotifications: "In-app notifications"
        case .timeFormat: "Time format"
        case .responseStreaming: "Response streaming"
        case .hideWhitespace: "Hide whitespace changes"
        case .diffFileState: "Default diff file state"
        case .diffLayout: "Diff layout"
        case .proactivePanels: "Proactive panels"
        case .skillsInSlash: "Show skills in slash menu"
        case .richText: "Rich text composer"
        case .collapseComposer: "Collapse composer on scroll"
        case .sendShortcut: "Send shortcut"
        case .followUp: "Follow-up behavior"
        case .continueThreads: "Continue threads after restarts"
        case .confirmUnpin: "Confirm before unpinning"
        case .confirmArchive: "Confirm before archiving"
        case .confirmDelete: "Confirm before deleting"
        case .quitShortcut: "Quit shortcut"
        case .textGenerationModel: "Text generation model"
        case .version: "Version"
        case .dataFolder: "Data folder"
        case .contextMeter: "Context window indicator"
        case .colorScheme: "Appearance"
        case .themes: "Themes"
        case .contrast: "Contrast"
        case .glassOpacity: "Glass opacity"
        case .diffColors: "Diff colors"
        case .chatWidth: "Chat width"
        case .openLinks: "Open links in"
        case .interfaceFont: "Interface font"
        case .promptFont: "Prompt font"
        case .codeFont: "Code font"
        case .terminalFont: "Terminal font"
        case .fontSmoothing: "Font smoothing"
        case .wordWrap: "Word wrap"
        case .providers: "Providers"
        case .favorites: "Favorite models"
        case .signIn: "Sign in to a provider"
        case .hiddenModels: "Hidden models"
        case .autoPull: "Automatically pull"
        case .fetchInterval: "Git fetch interval"
        case .mergeMethod: "Default merge method"
        case .writingStyle: "Writing style"
        case .customInstructions: "Custom instructions"
        case .followTemplates: "Follow pull request templates"
        case .writerModel: "Source control writer model"
        case .cleanupAfter: "Remove worktrees after"
        case .cleanupOnMerge: "Remove when the pull request merges"
        case .cleanupOnDelete: "Remove when the thread is deleted"
        case .cleanupUnchanged: "Remove worktrees without changes"
        case .dataLocation: "Data folder"
        case .controllerURL: "Controller URL"
        case .fleetKey: "Fleet key"
        case .startController: "Start controller automatically"
        case .machines: "Machines"
        case .registry: "Registry"
        case .localUsage: "Local usage"
        case .daemonStatus: "Eukhe daemon"
        case .remoteEnvironments: "Remote environments"
        case .archivedThreads: "Archived threads"
        case .snapshotEnabled: "Enable SnapShots"
        case .snapshotShortcut: "Capture shortcut"
        case .snapshotIncludeText: "Include app text"
        case .snapshotPermission: "Screen Recording access"
        case .snapshotSound: "Play a sound"
        case .snapshotFlash: "Flash the captured window"
        case .snapshotAnimations: "Animations"
        }
    }

    var keywords: String {
        switch self {
        case .defaultModel: "provider llm"
        case .thinkingLevel: "effort reasoning"
        case .permissions: "access runtime mode supervised auto full"
        case .newThreads: "worktree local checkout"
        case .startFromOrigin: "branch remote"
        case .addProjectBase: "folder directory"
        case .workingSection: "shelf running sidebar"
        case .autoSettleMerged, .autoSettleInactive, .inactiveDays: "settle shelf"
        case .notifications: "sound alert desktop"
        case .inAppNotifications: "toast banner"
        case .timeFormat: "clock 12 24 hour"
        case .responseStreaming: "token paragraph turn"
        case .hideWhitespace, .diffFileState, .diffLayout: "diff split stacked collapsed expanded"
        case .proactivePanels: "right panel"
        case .skillsInSlash: "commands"
        case .richText: "markdown editor"
        case .collapseComposer: "scroll"
        case .sendShortcut: "enter return keyboard"
        case .followUp: "queue steer"
        case .continueThreads: "resume restart"
        case .confirmUnpin, .confirmArchive, .confirmDelete: "dialog prompt"
        case .quitShortcut: "cmd q hold"
        case .textGenerationModel: "titles commit messages"
        case .version: "about update"
        case .dataFolder, .dataLocation: "logs finder reveal storage"
        case .contextMeter: "legacy tokens"
        case .colorScheme: "dark light system mode"
        case .themes: "theme palette colors import vs code editor"
        case .contrast: "accessibility"
        case .glassOpacity: "translucent transparency floating"
        case .diffColors: "colorblind red green blue orange"
        case .chatWidth: "wide full column"
        case .openLinks: "browser"
        case .interfaceFont, .promptFont, .codeFont, .terminalFont: "typeface size monospace"
        case .fontSmoothing: "antialias"
        case .wordWrap: "wrap lines"
        case .providers: "auth api key configured"
        case .favorites: "models star"
        case .signIn: "login auth eukhe"
        case .hiddenModels: "hide unhide picker models"
        case .autoPull: "fast-forward"
        case .fetchInterval: "background refresh"
        case .mergeMethod: "squash rebase"
        case .writingStyle: "conventional commits"
        case .customInstructions: "commit message"
        case .followTemplates: "pr template"
        case .writerModel: "commit model"
        case .cleanupAfter, .cleanupOnMerge, .cleanupOnDelete, .cleanupUnchanged: "worktree retention delete"
        case .controllerURL: "fleet server"
        case .fleetKey: "token bearer secret"
        case .startController: "bun launch"
        case .machines: "gpu fleet tailnet endpoints"
        case .registry: "models recipes download"
        case .localUsage: "tokens requests"
        case .daemonStatus: "socket connection"
        case .remoteEnvironments: "ssh pairing connections"
        case .archivedThreads: "unarchive restore"
        case .snapshotEnabled, .snapshotShortcut, .snapshotPermission: "screenshot capture window screen recording"
        case .snapshotIncludeText: "accessibility text context"
        case .snapshotSound, .snapshotFlash, .snapshotAnimations: "screenshot feedback"
        }
    }

    func matches(_ query: String) -> Bool {
        query.isEmpty || title.localizedCaseInsensitiveContains(query) || keywords.localizedCaseInsensitiveContains(query)
            || group.title.localizedCaseInsensitiveContains(query)
    }
}

struct SettingsQueryKey: EnvironmentKey {
    static let defaultValue = ""
}

extension EnvironmentValues {
    var settingsQuery: String {
        get { self[SettingsQueryKey.self] }
        set { self[SettingsQueryKey.self] = newValue }
    }
}

struct SettingsSection<Content: View>: View {
    let group: SettingsGroup
    var footer: String?
    @ViewBuilder let content: Content
    @Environment(\.settingsQuery) private var query

    init(_ group: SettingsGroup, footer: String? = nil, @ViewBuilder content: () -> Content) {
        self.group = group
        self.footer = footer
        self.content = content()
    }

    var body: some View {
        if query.isEmpty || group.settings.contains(where: { $0.matches(query) }) {
            Section {
                content
            } header: {
                Text(group.title)
            } footer: {
                if let footer {
                    Text(footer)
                        .font(.callout)
                        .foregroundStyle(Theme.secondaryText)
                }
            }
        }
    }
}

struct SettingRow<Content: View>: View {
    let key: SettingKey
    @ViewBuilder let content: Content
    @Environment(\.settingsQuery) private var query

    init(_ key: SettingKey, @ViewBuilder content: () -> Content) {
        self.key = key
        self.content = content()
    }

    var body: some View {
        if key.matches(query) {
            content
        }
    }
}

@MainActor
struct SettingsBinder {
    let settings: LocalStudioKit.Settings
    let pages: PagesStore

    func callAsFunction<Value>(_ keyPath: WritableKeyPath<LocalStudioKit.Settings, Value>) -> Binding<Value> {
        let current = settings[keyPath: keyPath]
        let pages = pages
        return Binding(
            get: { current },
            set: { value in pages.update { $0[keyPath: keyPath] = value } }
        )
    }
}

struct CommitTextField: View {
    let title: String
    let value: String
    var prompt: String = ""
    var secure = false
    var axis: Axis = .horizontal
    let commit: (String) -> Void
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        Group {
            if secure {
                SecureField(title, text: $draft, prompt: Text(prompt))
            } else {
                TextField(title, text: $draft, prompt: Text(prompt), axis: axis)
                    .lineLimit(axis == .vertical ? 3...8 : 1...1)
            }
        }
        .focused($focused)
        .onSubmit { save() }
        .onAppear { draft = value }
        .onChange(of: value) { _, next in
            if !focused { draft = next }
        }
        .onChange(of: focused) { _, isFocused in
            if !isFocused { save() }
        }
    }

    private func save() {
        guard draft != value else { return }
        commit(draft)
    }
}

struct SettingsPaneIcon: View {
    let pane: SettingsPane
    var size: CGFloat = 20

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
            .fill(pane.tint.gradient)
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: pane.symbol)
                    .font(.system(size: size * 0.55, weight: .medium))
                    .foregroundStyle(.white)
            }
    }
}

struct SettingsNote: View {
    let symbol: String
    let text: String

    var body: some View {
        Label {
            Text(LocalizedStringKey(text))
                .font(.callout)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .light))
                .foregroundStyle(Theme.chromeIcon)
        }
    }
}
