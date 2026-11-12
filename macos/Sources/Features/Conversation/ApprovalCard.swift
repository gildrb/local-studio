import LocalStudioKit
import SwiftUI

struct ApprovalCard: View {
    let store: StudioStore

    var body: some View {
        let approvals = store.conversation.approvals
        if let approval = approvals.first {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Image(systemName: "hand.raised.fill")
                        .icon(.inline)
                        .accessibilityHidden(true)
                    Text(Self.kind(approval))
                        .font(.system(size: 12.5, weight: .semibold))
                    if let agent = approval.agent, !agent.isEmpty {
                        Text(agent)
                            .font(.system(size: 12.5))
                            .foregroundStyle(Theme.secondaryText)
                    }
                    Spacer(minLength: 8)
                    if approvals.count > 1 {
                        Text("1/\(approvals.count)")
                            .font(.system(size: 12))
                            .monospacedDigit()
                            .foregroundStyle(Theme.secondaryText)
                            .help("\(approvals.count) requests are waiting")
                    }
                }
                .foregroundStyle(.orange)
                ScrollView {
                    Text(approval.command)
                        .font(.system(size: 12, design: .monospaced))
                        .lineSpacing(2)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                }
                .frame(maxHeight: 96)
                .fixedSize(horizontal: false, vertical: true)
                .background(Theme.message.opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.hairline))
                HStack(spacing: 6) {
                    ForEach(approval.effects, id: \.self) { effect in
                        Text(effect)
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.secondaryText)
                            .padding(.horizontal, 7)
                            .frame(height: 20)
                            .background(Theme.hover, in: Capsule())
                            .overlay(Capsule().strokeBorder(Theme.hairline))
                    }
                    Spacer(minLength: 8)
                    Menu {
                        Button("Always Allow This Session") {
                            store.conversation.answer(approval, .alwaysAllowSession)
                        }
                        .help("Approve and stop asking for \(approval.effects.joined(separator: ", ")) in this thread")
                        Button("Decline") {
                            store.conversation.answer(approval, .deny)
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .icon(.control, .primary)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .help("More approval options")
                    .accessibilityLabel("More approval options")
                    Button("Decline") {
                        store.conversation.answer(approval, .deny)
                    }
                    .controlSize(.regular)
                    Button("Approve") {
                        store.conversation.answer(approval, .approve)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.primary)
                    .controlSize(.regular)
                    .keyboardShortcut(.defaultAction)
                    .help("Approve (Return)")
                }
            }
            .padding(12)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.orange.opacity(0.3)))
        }
    }

    static func kind(_ approval: Approval) -> String {
        let files = approval.effects.contains { effect in
            let effect = effect.lowercased()
            return effect.contains("write") || effect.contains("edit") || effect.contains("file")
        }
        return files ? "File change approval" : "Command approval"
    }
}
