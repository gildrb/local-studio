import LocalStudioKit
import SwiftUI

struct DaemonNotice: View {
    let store: StudioStore

    var body: some View {
        if let mismatch = store.daemonMismatch {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: "exclamationmark.triangle")
                    .icon(.control)
                    .foregroundStyle(Theme.danger)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(mismatch.message)
                        .font(.system(size: 13, weight: .medium))
                        .textSelection(.enabled)
                    if mismatch.busySessions > 0 {
                        Text("\(mismatch.busySessions) sessions are running on it.")
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                Spacer(minLength: 8)
                Button("Restart Daemon") { store.restartDaemon() }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: 460)
            .fixedSize(horizontal: false, vertical: true)
            .background(Theme.overlay, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline))
            .shadow(color: Theme.shadow, radius: 14, y: 6)
        }
    }
}
