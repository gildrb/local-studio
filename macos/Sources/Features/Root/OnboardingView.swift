import AppKit
import LocalStudioKit
import SwiftUI

enum OnboardingStep: Int, CaseIterable {
    case welcome
    case daemon
    case providers
    case project
    case done
}

extension StudioStore {
    var needsOnboarding: Bool {
        if shell.onboardingActive { return true }
        guard let settings = pages.settings, inbox.receivedProjects else { return false }
        return !settings.onboardingCompleted && inbox.projects.isEmpty && !shell.onboardingDismissed
    }

    func completeOnboarding() {
        shell.onboardingActive = false
        shell.onboardingDismissed = true
        guard var settings = pages.settings, !settings.onboardingCompleted else { return }
        settings.onboardingCompleted = true
        core.run { $0.updateSettings(settings: settings) }
    }
}

struct OnboardingView: View {
    let store: StudioStore
    @State var step: OnboardingStep = .welcome
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 44)
                .padding(.top, 36)
            footer
        }
        .frame(width: 560, height: 440)
        .background(Theme.canvas)
        .task { store.core.run { $0.loadProviders() } }
        .onAppear { if !store.shell.onboardingDismissed { store.shell.onboardingActive = true } }
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .welcome:
            OnboardingPage(symbol: nil, title: "Welcome to Local Studio", detail: "Agent threads across your projects, running on your own machines through the Eukhe daemon. This takes a minute.") {
                EmptyView()
            }
        case .daemon:
            OnboardingPage(symbol: "server.rack", title: "Connect to Eukhe", detail: "Local Studio starts the Eukhe daemon bundled with the app and talks to it over a local socket.") {
                StatusLine(tint: daemonTint, text: daemonText)
            }
        case .providers:
            OnboardingPage(symbol: "cpu", title: "Model providers", detail: providerDetail) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(store.pages.providers.prefix(5), id: \.id) { provider in
                        StatusLine(tint: provider.configured ? Theme.success : Theme.tertiaryText, text: "\(provider.name) · \(provider.modelCount) model\(provider.modelCount == 1 ? "" : "s")")
                    }
                    if configuredProviders == 0 {
                        Text("Run `eukhe` in Terminal and use `/login` to sign in to a provider, then check again.")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack {
                            Button("Open Terminal") { openTerminal() }
                            Button("Check Again") { store.core.run { $0.loadProviders() } }
                        }
                        .padding(.top, 4)
                    }
                }
            }
        case .project:
            OnboardingPage(symbol: "folder", title: "Add your first project", detail: "Pick a folder you want agents to work in. You can add more later from the sidebar.") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(store.inbox.projects, id: \.id) { project in
                        HStack(spacing: 8) {
                            ProjectTile(project: project)
                            Text(project.name)
                                .font(.system(size: 13, weight: .medium))
                            Text((project.path as NSString).abbreviatingWithTildeInPath)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.secondaryText)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    Button(store.inbox.projects.isEmpty ? "Choose Folder…" : "Add Another Folder…") { chooseFolder() }
                }
            }
        case .done:
            OnboardingPage(symbol: "checkmark.circle", title: "You're ready", detail: "Start a thread with ⌘N, find anything with ⌘K, and hold ⌘ to jump between threads.") {
                EmptyView()
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                ForEach(OnboardingStep.allCases, id: \.self) { item in
                    Circle()
                        .fill(item == step ? Theme.primary : Theme.input)
                        .frame(width: 6, height: 6)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Step \(step.rawValue + 1) of \(OnboardingStep.allCases.count)")
            Spacer()
            if step != .done {
                Button("Skip Setup") { finish() }
                    .buttonStyle(.borderless)
            }
            if step != .welcome {
                Button("Back") { move(-1) }
            }
            Button(step == .done ? "Start" : "Continue") {
                if step == .done { finish() } else { move(1) }
            }
            .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .background(Theme.sidebar)
        .overlay(alignment: .top) { Rectangle().fill(Theme.hairline).frame(height: 1) }
    }

    private var configuredProviders: Int {
        store.pages.providers.filter(\.configured).count
    }

    private var providerDetail: String {
        let models = store.pages.providers.filter(\.configured).reduce(0) { $0 + Int($1.modelCount) }
        if store.pages.providers.isEmpty {
            return "Checking which providers Eukhe can use…"
        }
        if configuredProviders == 0 {
            return "No provider is signed in yet, so threads can't run."
        }
        return "\(configuredProviders) provider\(configuredProviders == 1 ? "" : "s") configured with \(models) model\(models == 1 ? "" : "s")."
    }

    private var daemonTint: Color {
        switch store.connection {
        case .ready: Theme.success
        case .connecting: Theme.warning
        case .lost: Theme.danger
        }
    }

    private var daemonText: String {
        switch store.connection {
        case .ready: "Connected to the Eukhe daemon"
        case .connecting: "Connecting…"
        case .lost(let reason): "Not connected: \(reason)"
        }
    }

    private func move(_ offset: Int) {
        step = OnboardingStep(rawValue: step.rawValue + offset) ?? step
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Add Project"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        store.inbox.addProject(path: url.path)
    }

    private func openTerminal() {
        guard let terminal = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") else { return }
        NSWorkspace.shared.openApplication(at: terminal, configuration: NSWorkspace.OpenConfiguration())
    }

    private func finish() {
        store.completeOnboarding()
        if let project = store.inbox.projects.first?.id {
            store.newThread(in: project)
        }
        dismiss()
    }
}

private struct OnboardingPage<Extra: View>: View {
    let symbol: String?
    let title: String
    let detail: String
    @ViewBuilder let extra: () -> Extra

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Group {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 30, weight: .light))
                        .foregroundStyle(Theme.chromeIcon)
                } else {
                    Image(nsImage: NSApp.applicationIconImage)
                        .resizable()
                        .frame(width: 56, height: 56)
                }
            }
            .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 22, weight: .semibold))
            Text(detail)
                .font(.system(size: 13.5))
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            extra()
                .padding(.top, 6)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct StatusLine: View {
    let tint: Color
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(tint)
                .frame(width: 7, height: 7)
                .accessibilityHidden(true)
            Text(text)
                .font(.system(size: 13))
        }
    }
}
