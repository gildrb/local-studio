import AppKit
import LocalStudioKit
import SwiftUI

enum GitPrimaryAction: Equatable {
    case commit
    case pull
    case sync
    case publish
    case push
    case createPullRequest
    case viewPullRequest(String)
    case upToDate

    var title: String {
        switch self {
        case .commit: "Commit"
        case .pull: "Pull"
        case .sync: "Sync"
        case .publish: "Publish"
        case .push: "Push"
        case .createPullRequest: "Create PR"
        case .viewPullRequest: "View PR"
        case .upToDate: "Up to date"
        }
    }

    var symbol: String {
        switch self {
        case .commit: "checkmark.circle"
        case .pull: "arrow.down.circle"
        case .sync: "arrow.triangle.2.circlepath"
        case .publish: "icloud.and.arrow.up"
        case .push: "arrow.up.circle"
        case .createPullRequest, .viewPullRequest: "arrow.trianglehead.pull"
        case .upToDate: "checkmark"
        }
    }

    static func resolve(_ status: GitStatus) -> GitPrimaryAction {
        if status.dirty || status.changedFiles > 0 { return .commit }
        if canPull(status) { return status.ahead > 0 ? .sync : .pull }
        if !status.hasRemote { return .publish }
        if canPush(status) { return .push }
        if let pull = status.pullRequest { return .viewPullRequest(pull.url) }
        if canCreatePullRequest(status) { return .createPullRequest }
        return .upToDate
    }

    static func canPull(_ status: GitStatus) -> Bool {
        status.upstream != nil && status.behind > 0
    }

    static func canPush(_ status: GitStatus) -> Bool {
        status.hasRemote && status.branch != nil && (status.upstream == nil || status.ahead > 0)
    }

    static func canCreatePullRequest(_ status: GitStatus) -> Bool {
        guard status.hasRemote, let branch = status.branch, status.pullRequest == nil else { return false }
        return branch != (status.defaultBranch ?? "main")
    }

    static func hint(_ status: GitStatus) -> String {
        switch resolve(status) {
        case .commit: "Commit \(status.changedFiles) changed file\(status.changedFiles == 1 ? "" : "s")"
        case .pull: "Pull \(status.behind) commit\(status.behind == 1 ? "" : "s") from \(status.upstream ?? "upstream")"
        case .sync: "Pull \(status.behind) and push \(status.ahead) commit\(status.ahead == 1 ? "" : "s")"
        case .publish: "Publish this repository to GitHub"
        case .push: status.upstream == nil ? "Publish \(status.branch ?? "branch") to origin" : "Push \(status.ahead) commit\(status.ahead == 1 ? "" : "s")"
        case .createPullRequest: "Create a pull request for \(status.branch ?? "this branch")"
        case .viewPullRequest: "Open the pull request in the browser"
        case .upToDate: "Branch is up to date. No action needed."
        }
    }
}

struct GitActionsButton: View {
    let store: StudioStore
    let project: String

    var body: some View {
        if let status = store.workspace.gitStatus[project], status.isRepo {
            let action = GitPrimaryAction.resolve(status)
            Menu {
                Button("Commit…") { store.shell.commitProject = project }
                    .disabled(!(status.dirty || status.changedFiles > 0))
                Button(status.upstream == nil ? "Publish Branch" : "Push") { GitRunner.push(store, project) }
                    .disabled(!GitPrimaryAction.canPush(status))
                Button("Pull") { GitRunner.pull(store, project, thenPush: false) }
                    .disabled(!GitPrimaryAction.canPull(status))
                if GitPrimaryAction.canPull(status), status.ahead > 0 {
                    Button("Sync (Pull, then Push)") { GitRunner.pull(store, project, thenPush: true) }
                }
                Divider()
                if let pull = status.pullRequest {
                    Button("View Pull Request #\(pull.number)") { GitRunner.openURL(pull.url) }
                } else {
                    Button("Create Pull Request…") { store.shell.pullRequestProject = project }
                        .disabled(!GitPrimaryAction.canCreatePullRequest(status))
                }
                if !status.hasRemote {
                    Button("Publish Repository…") { store.shell.publishProject = project }
                }
                Divider()
                Button("Refresh Status") { store.core.run { $0.gitStatus(project: project) } }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: action.symbol)
                        .accessibilityHidden(true)
                    Text(action.title)
                }
            } primaryAction: {
                perform(action)
            }
            .menuStyle(.button)
            .buttonStyle(.borderless)
            .fixedSize()
            .help(GitPrimaryAction.hint(status))
            .accessibilityLabel("Git: \(action.title)")
            .accessibilityHint(GitPrimaryAction.hint(status))
        }
    }

    private func perform(_ action: GitPrimaryAction) {
        switch action {
        case .commit: store.shell.commitProject = project
        case .pull: GitRunner.pull(store, project, thenPush: false)
        case .sync: GitRunner.pull(store, project, thenPush: true)
        case .publish: store.shell.publishProject = project
        case .push: GitRunner.push(store, project)
        case .createPullRequest: store.shell.pullRequestProject = project
        case .viewPullRequest(let url): GitRunner.openURL(url)
        case .upToDate: break
        }
    }
}

@MainActor
enum GitRunner {
    static func push(_ store: StudioStore, _ project: String) {
        let request = store.requests.issue { outcome in
            report(store, outcome)
        }
        store.core.run { $0.push(request: request, project: project) }
    }

    static func pull(_ store: StudioStore, _ project: String, thenPush: Bool) {
        let request = store.requests.issue { outcome in
            report(store, outcome)
            if thenPush, case .done = outcome { push(store, project) }
        }
        store.core.run { $0.pull(request: request, project: project) }
    }

    static func publish(_ store: StudioStore, _ project: String, name: String, isPrivate: Bool, done: @escaping (Bool) -> Void) {
        let request = store.requests.issue { outcome in
            report(store, outcome)
            if case .done = outcome { done(true) } else { done(false) }
        }
        store.core.run { $0.publishRepository(request: request, project: project, name: name, private: isPrivate) }
    }

    static func commit(_ store: StudioStore, _ project: String, message: String?, thenPush: Bool, done: @escaping (Bool) -> Void) {
        let request = store.requests.issue { outcome in
            report(store, outcome)
            if case .done = outcome {
                if thenPush { push(store, project) }
                done(true)
            } else {
                done(false)
            }
        }
        store.core.run { $0.commit(request: request, project: project, message: message) }
    }

    static func openURL(_ url: String) {
        guard let url = URL(string: url) else { return }
        NSWorkspace.shared.open(url)
    }

    static func report(_ store: StudioStore, _ outcome: RequestOutcome) {
        switch outcome {
        case .done(let message): store.post(.info, message)
        case .failed(let message): store.post(.error, message)
        }
    }
}

struct ProjectSheetID: Identifiable {
    let id: String
}

struct CommitSheet: View {
    let store: StudioStore
    let project: String
    @Environment(\.dismiss) private var dismiss
    @State private var message = ""
    @State private var busy = false

    var body: some View {
        let status = store.workspace.gitStatus[project]
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Commit changes")
                    .font(.headline)
                Text(caption(status))
                    .font(.subheadline)
                    .foregroundStyle(Theme.secondaryText)
            }
            TextField("Message (leave blank to generate one)", text: $message, axis: .vertical)
                .lineLimit(3...8)
                .textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Commit & Push") { run(push: true) }
                    .disabled(busy)
                Button("Commit") { run(push: false) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(busy)
            }
        }
        .padding(20)
        .frame(width: 440)
    }

    private func caption(_ status: GitStatus?) -> String {
        guard let status else { return (project as NSString).lastPathComponent }
        let files = "\(status.changedFiles) changed file\(status.changedFiles == 1 ? "" : "s")"
        return status.branch.map { "\(files) on \($0)" } ?? files
    }

    private func run(push: Bool) {
        busy = true
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        GitRunner.commit(store, project, message: trimmed.isEmpty ? nil : trimmed, thenPush: push) { success in
            busy = false
            if success { dismiss() }
        }
    }
}

struct PullRequestSheet: View {
    let store: StudioStore
    let project: String
    let suggestedTitle: String
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var bodyText = ""
    @State private var draft = false
    @State private var request: String?

    var body: some View {
        let status = store.workspace.gitStatus[project]
        Form {
            Section {
                TextField("Title", text: $title)
                TextField("Description", text: $bodyText, axis: .vertical)
                    .lineLimit(4...10)
                Toggle("Create as draft", isOn: $draft)
            } header: {
                Text("Create pull request")
            } footer: {
                if let status, let branch = status.branch {
                    Text("\(branch) → \(status.defaultBranch ?? "main")")
                        .foregroundStyle(Theme.secondaryText)
                }
            }
        }
        .formStyle(.grouped)
        .safeAreaInset(edge: .bottom) {
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(request == nil ? "Create" : "Creating…") { create() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(request != nil || title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(16)
        }
        .frame(width: 480, height: 380)
        .onAppear { title = suggestedTitle }
        .onChange(of: request.flatMap { store.workspace.pullRequests[$0] }) { _, pulls in
            guard let pull = pulls?.first else { return }
            store.post(.info, "Opened pull request #\(pull.number)")
            dismiss()
        }
    }

    private func create() {
        let id = store.requests.issue { outcome in
            GitRunner.report(store, outcome)
            request = nil
        }
        request = id
        let title = title.trimmingCharacters(in: .whitespaces)
        let body = bodyText
        let draft = draft
        store.core.run { $0.createPullRequest(request: id, project: project, title: title, body: body, draft: draft) }
    }
}

struct PublishRepositorySheet: View {
    let store: StudioStore
    let project: String
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var isPrivate = true
    @State private var busy = false

    var body: some View {
        Form {
            Section {
                TextField("Repository name", text: $name)
                Toggle("Private repository", isOn: $isPrivate)
            } header: {
                Text("Publish repository")
            } footer: {
                Text("Creates the repository on GitHub with the GitHub CLI, adds it as `origin` and pushes the current branch.")
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .formStyle(.grouped)
        .safeAreaInset(edge: .bottom) {
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(busy ? "Publishing…" : "Publish") { publish() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(16)
        }
        .frame(width: 440, height: 260)
        .onAppear { name = (project as NSString).lastPathComponent }
    }

    private func publish() {
        busy = true
        GitRunner.publish(store, project, name: name.trimmingCharacters(in: .whitespaces), isPrivate: isPrivate) { success in
            busy = false
            if success { dismiss() }
        }
    }
}
