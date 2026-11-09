import LocalStudioKit
import SwiftUI

extension KernelState {
    var installing: Bool {
        if case .installing = self { true } else { false }
    }
}

private struct KernelNoticeContent {
    let symbol: String
    let tint: Color
    let title: String
    let detail: String?
    let action: String?
}

struct KernelNotice: View {
    let store: StudioStore

    var body: some View {
        if !store.kernelNoticeHidden, let content {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: content.symbol)
                    .foregroundStyle(content.tint)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(content.title)
                        .font(.system(size: 13, weight: .medium))
                    if let detail = content.detail {
                        Text(detail)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(content.action == nil ? 1 : 4)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                    }
                }
                Spacer(minLength: 8)
                if let action = content.action {
                    Button(action) { store.installKernel() }
                }
                Button("Hide", systemImage: "xmark") { store.kernelNoticeHidden = true }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.secondaryText)
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

    private var content: KernelNoticeContent? {
        switch store.kernel {
        case .missing:
            KernelNoticeContent(
                symbol: "exclamationmark.triangle", tint: Theme.warning, title: "No Python 3.11+ found",
                detail: "Install a managed Python for the ipython tool.", action: "Install"
            )
        case .installing(let detail):
            KernelNoticeContent(
                symbol: "arrow.down.circle", tint: Theme.primary, title: "Installing Python…",
                detail: detail ?? "Downloading Python for the ipython tool. Threads keep working meanwhile.", action: nil
            )
        case .failed(let message):
            KernelNoticeContent(symbol: "exclamationmark.circle", tint: Theme.danger, title: "Python could not be installed", detail: message, action: "Retry")
        case .unavailable(let reason):
            KernelNoticeContent(symbol: "exclamationmark.circle", tint: Theme.danger, title: "The ipython tool is unavailable", detail: reason, action: "Retry")
        case .checking, .ready, nil:
            nil
        }
    }
}

struct KernelStatus: View {
    let store: StudioStore

    var body: some View {
        switch store.kernel {
        case .ready(let python, let version, let source):
            Text("Python \(version) · \(python) (\(source))")
                .lineLimit(1)
                .truncationMode(.middle)
                .foregroundStyle(Theme.secondaryText)
                .textSelection(.enabled)
        case .installing:
            Text("Installing…")
                .foregroundStyle(Theme.secondaryText)
        case .missing:
            HStack {
                Text("No Python 3.11+ found")
                    .foregroundStyle(Theme.secondaryText)
                Button("Install") { store.installKernel() }
            }
        case .failed(let message):
            problem("Install failed", message)
        case .unavailable(let reason):
            problem("Unavailable", reason)
        case .checking, nil:
            Text("Checking…")
                .foregroundStyle(Theme.secondaryText)
        }
    }

    private func problem(_ title: String, _ message: String) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            HStack {
                Text(title)
                    .foregroundStyle(Theme.danger)
                Button("Retry") { store.installKernel() }
            }
            Text(message)
                .font(.callout)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(4)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
    }
}
