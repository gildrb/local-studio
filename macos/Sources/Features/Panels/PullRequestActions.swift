import AppKit
import LocalStudioKit
import SwiftUI

@MainActor
@Observable
final class PullRequestActionState {
    enum Busy: Equatable {
        case checkout
        case merge(MergeMethod)
    }

    private(set) var busy: Busy?
    private(set) var worktree: String?
    private(set) var message: String?
    private(set) var failed = false
    @ObservationIgnored private(set) var request: String?

    func checkOut(_ store: StudioStore, project: String, number: UInt64) {
        guard busy == nil else { return }
        busy = .checkout
        message = nil
        let request = store.requests.issue { [weak self] outcome in
            guard let self else { return }
            busy = nil
            switch outcome {
            case .done(let path):
                worktree = path
                failed = false
                message = "Checked out #\(number) in \((path as NSString).abbreviatingWithTildeInPath)"
            case .failed(let error):
                failed = true
                message = error
            }
        }
        self.request = request
        store.core.run { $0.checkoutPullRequest(request: request, project: project, number: number) }
    }

    func merge(_ store: StudioStore, project: String, number: UInt64, method: MergeMethod, finished: @escaping () -> Void) {
        guard busy == nil else { return }
        busy = .merge(method)
        message = nil
        let request = store.requests.issue { [weak self] outcome in
            guard let self else { return }
            busy = nil
            switch outcome {
            case .done(let text):
                failed = false
                message = text.isEmpty ? "Merged #\(number)." : text
                finished()
            case .failed(let error):
                failed = true
                message = error
            }
        }
        self.request = request
        store.core.run { $0.mergePullRequest(request: request, project: project, number: number, method: method) }
    }

    func dismiss() {
        message = nil
        worktree = nil
    }
}

struct PullRequestActionBar: View {
    let store: StudioStore
    let project: String
    let pull: PullRequest
    let state: PullRequestActionState
    let finished: () -> Void
    @State private var confirming: MergeMethod?

    var body: some View {
        let open = pull.state.uppercased() == "OPEN"
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button(state.busy == .checkout ? "Checking Out…" : "Check Out") {
                    state.checkOut(store, project: project, number: pull.number)
                }
                .disabled(state.busy != nil)
                .help("Check out #\(pull.number) into its own worktree")
                if open {
                    Menu {
                        ForEach(Self.methods, id: \.self) { method in
                            Button(Self.title(method)) { confirming = method }
                        }
                    } label: {
                        Text(mergeLabel)
                    } primaryAction: {
                        confirming = defaultMethod
                    }
                    .menuStyle(.button)
                    .fixedSize()
                    .disabled(state.busy != nil)
                    .help("Merge with \(Self.title(defaultMethod).lowercased()); choose another method from the menu")
                }
            }
            .controlSize(.small)
            if let message = state.message {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: state.failed ? "exclamationmark.triangle.fill" : "checkmark")
                        .icon(.inline)
                        .foregroundStyle(state.failed ? Theme.diffRemoved : Theme.diffAdded)
                        .accessibilityHidden(true)
                    Text(message)
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(3)
                        .textSelection(.enabled)
                    Spacer(minLength: 4)
                    if let worktree = state.worktree, !state.failed {
                        Button("New Thread Here") { startThread(in: worktree) }
                        Button("Show in Finder") {
                            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: worktree)])
                        }
                    }
                    PanelIconButton("Dismiss", symbol: "xmark") { state.dismiss() }
                }
                .controlSize(.small)
                .accessibilityElement(children: .contain)
            }
        }
        .confirmationDialog(
            "Merge #\(pull.number) into \(pull.base)?",
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            presenting: confirming
        ) { method in
            Button(Self.title(method)) {
                state.merge(store, project: project, number: pull.number, method: method, finished: finished)
            }
            Button("Cancel", role: .cancel) {}
        } message: { method in
            Text("\(pull.title)\n\(Self.title(method)) \(pull.head) into \(pull.base) on the forge.")
        }
    }

    private var defaultMethod: MergeMethod {
        store.pages.settings?.mergeMethod ?? .repositoryDefault
    }

    private var mergeLabel: String {
        if case .merge = state.busy { return "Merging…" }
        return defaultMethod == .repositoryDefault ? "Merge" : Self.title(defaultMethod)
    }

    private func startThread(in worktree: String) {
        store.newThread(in: project)
        let options = store.conversation.newThread
        options.existingWorktree = worktree
        options.existingBranch = pull.head
    }

    static let methods: [MergeMethod] = [.repositoryDefault, .merge, .squash, .rebase]

    static func title(_ method: MergeMethod) -> String {
        switch method {
        case .repositoryDefault: "Merge (Repository Default)"
        case .merge: "Create Merge Commit"
        case .squash: "Squash and Merge"
        case .rebase: "Rebase and Merge"
        }
    }
}
