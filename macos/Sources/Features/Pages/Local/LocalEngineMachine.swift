import LocalStudioKit
import SwiftUI

struct LocalEngineMachine: View {
    let controller: LocalController
    let select: (String) -> Void
    let addController: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Text(controller.headline)
                    .font(.system(size: 17, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                Text(controller.detail)
                    .font(.system(size: 13))
                    .foregroundStyle(tone)
                    .lineLimit(2)
                    .textSelection(.enabled)
                LocalElsewhereLink(elsewhere: controller.elsewhere, select: select)
            }
            .padding(.top, 34)
            VStack(alignment: .leading, spacing: 18) {
                ForEach(controller.endpoints, id: \.id) { endpoint in
                    LocalEngineRow(endpoint: endpoint)
                }
            }
            .padding(.top, 36)
            if let note = controller.note {
                Rectangle()
                    .fill(Theme.hairline)
                    .frame(height: 1)
                    .padding(.vertical, 32)
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "cpu")
                        .icon(.toolbar, .secondary)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 10) {
                        Text(note)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                        Button("Add a controller…", action: addController)
                            .buttonStyle(DashboardButtonStyle(bordered: true))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var tone: Color {
        if controller.status == .engineUnreachable || controller.endpoints.contains(where: \.stale) { return Theme.warning }
        return Theme.secondaryText
    }
}

private struct LocalEngineRow: View {
    let endpoint: LocalEndpoint

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                MachineDot(status: status)
                Text(endpoint.models.isEmpty ? "No models listed" : endpoint.models.joined(separator: ", "))
                    .font(.system(size: 14, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                Text(state)
                    .font(.system(size: 12))
                    .foregroundStyle(endpoint.state == .loaded && !endpoint.stale ? Theme.secondaryText : Theme.warning)
            }
            Text(facts)
                .font(.system(size: 12))
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(2)
                .textSelection(.enabled)
        }
    }

    private var status: LocalMachineStatus {
        switch endpoint.state {
        case .loaded: .serving
        case .empty: .noModel
        case .unreachable: .engineUnreachable
        }
    }

    private var state: String {
        switch endpoint.state {
        case .loaded: endpoint.stale ? "loaded, not confirmed recently" : "loaded"
        case .empty: "no model loaded"
        case .unreachable: "not answering"
        }
    }

    private var facts: String {
        var parts = [endpoint.provider, endpoint.address].compactMap { $0 }
        if let latency = endpoint.latencyMs, endpoint.state != .unreachable, !endpoint.stale {
            parts.append("answered in \(latency) ms")
        }
        if let confirmed = endpoint.confirmedAtMs {
            parts.append("confirmed \(LocalFormat.ago(confirmed))")
        }
        if let error = endpoint.error {
            parts.append(error)
        }
        return parts.joined(separator: " · ")
    }
}
