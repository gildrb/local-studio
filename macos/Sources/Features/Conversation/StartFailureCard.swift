import SwiftUI

struct StartFailureCard: View {
    let message: String
    let edit: () -> Void
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 12, weight: .light))
                    .foregroundStyle(Theme.diffRemoved)
                    .accessibilityHidden(true)
                Text("Couldn’t start this thread")
                    .font(.system(size: 12.5, weight: .medium))
                Spacer(minLength: 0)
            }
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(Theme.secondaryText)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button("Edit Message", action: edit)
                    .help("Put the message back in the composer")
                Button("Retry", action: retry)
                    .help("Try starting the thread again")
            }
            .controlSize(.small)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.diffRemoved.opacity(0.3)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Couldn’t start this thread")
    }
}
