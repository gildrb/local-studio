import AppKit
import LocalStudioKit
import SwiftUI

struct ComposerView: View {
    let store: StudioStore
    @State private var text = ""
    @State private var height: CGFloat = 22

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ComposerTextView(text: $text, height: $height) { steer in
                submit(steer: steer)
            }
            .frame(height: min(max(height, 40), 200))
            .overlay(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder)
                        .foregroundStyle(.tertiary)
                        .allowsHitTesting(false)
                }
            }
            HStack(spacing: 6) {
                ModelMenu(store: store)
                ThinkingMenu(store: store)
                Spacer(minLength: 8)
                if let context = store.conversation.info?.context {
                    Text("\(TokenCount(context.tokens).text) / \(TokenCount(context.window).text)")
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                Button("Attach Files", systemImage: "paperclip") {}
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                if store.conversation.info?.busy == true {
                    Button("Stop", systemImage: "stop.fill") { store.conversation.abort() }
                        .labelStyle(.iconOnly)
                        .buttonBorderShape(.circle)
                        .buttonStyle(.glassProminent)
                        .tint(.red)
                        .keyboardShortcut(".", modifiers: .command)
                }
                Button("Send", systemImage: "arrow.up") { submit(steer: false) }
                    .labelStyle(.iconOnly)
                    .buttonBorderShape(.circle)
                    .buttonStyle(.glassProminent)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.connection != .ready)
            }
            .controlSize(.regular)
        }
        .padding(14)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.input))
    }

    private var placeholder: String {
        guard let session = store.conversation.info else { return "Ask for changes, send follow-ups, or attach images" }
        return session.busy ? "Queue a follow-up (Option-Return steers)" : "Ask for changes, send follow-ups, or attach images"
    }

    private func submit(steer: Bool) {
        store.conversation.send(text, project: store.inbox.currentProject, steer: steer && store.conversation.info?.busy == true)
        text = ""
    }
}

private struct ModelMenu: View {
    let store: StudioStore

    var body: some View {
        Menu {
            ForEach(providers, id: \.self) { provider in
                Section(provider) {
                    ForEach(store.conversation.models.filter { $0.configured && $0.provider == provider }, id: \.id) { model in
                        Button(model.name) { store.conversation.setModel(model) }
                    }
                }
            }
            if providers.isEmpty {
                Text("No configured providers")
            }
        } label: {
            Label(current, systemImage: "cpu")
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .fixedSize()
    }

    private var current: String {
        guard let model = store.conversation.info?.model else { return "Model" }
        return model.name ?? model.id
    }

    private var providers: [String] {
        Array(Set(store.conversation.models.filter(\.configured).map(\.provider))).sorted()
    }
}

private struct ThinkingMenu: View {
    let store: StudioStore

    var body: some View {
        if let session = store.conversation.info, !session.thinkingLevels.isEmpty {
            Menu {
                ForEach(session.thinkingLevels, id: \.self) { level in
                    Button(level.capitalized) { store.conversation.setThinkingLevel(level) }
                }
            } label: {
                Text(session.thinkingLevel.capitalized)
            }
            .menuStyle(.button)
            .buttonStyle(.borderless)
            .fixedSize()
        }
    }
}

private struct ComposerTextView: NSViewRepresentable {
    @Binding var text: String
    @Binding var height: CGFloat
    let onSubmit: (Bool) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSTextView.scrollableTextView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        guard let textView = scrollView.documentView as? NSTextView else { return scrollView }
        textView.delegate = context.coordinator
        textView.drawsBackground = false
        textView.isRichText = false
        textView.allowsUndo = true
        textView.font = .preferredFont(forTextStyle: .body)
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.setAccessibilityLabel("Message")
        context.coordinator.textView = textView
        DispatchQueue.main.async {
            textView.window?.makeFirstResponder(textView)
        }
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = scrollView.documentView as? NSTextView, textView.string != text else { return }
        textView.string = text
        context.coordinator.measure()
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ComposerTextView
        weak var textView: NSTextView?

        init(_ parent: ComposerTextView) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard let textView else { return }
            parent.text = textView.string
            measure()
        }

        func measure() {
            guard let textView, let container = textView.textContainer, let layout = textView.layoutManager else {
                return
            }
            layout.ensureLayout(for: container)
            let measured = ceil(layout.usedRect(for: container).height)
            if measured != parent.height {
                parent.height = measured
            }
        }

        func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.insertNewline(_:)):
                if NSApp.currentEvent?.modifierFlags.contains(.shift) == true {
                    textView.insertNewlineIgnoringFieldEditor(nil)
                } else {
                    parent.onSubmit(false)
                }
                return true
            case #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
                parent.onSubmit(true)
                return true
            default:
                return false
            }
        }
    }
}
