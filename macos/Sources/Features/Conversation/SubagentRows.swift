import LocalStudioKit
import SwiftUI

extension TimelineEntry {
    var isAgentCall: Bool {
        if case .tool(_, _, .agent, _, _, _, _, _, _, _) = item.kind { true } else { false }
    }
}

struct AgentSpawnRow: View {
    let entry: TimelineEntry
    let store: StudioStore
    @State private var hovering = false

    private static let slack: Int64 = 2_000

    var body: some View {
        if case .tool(_, let name, _, let summary, _, let state, _, _, let started, let ended) = entry.item.kind {
            let members = members(started: started, ended: ended)
            VStack(alignment: .leading, spacing: 2) {
                Button {
                    store.panels.openSurface(.agents)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "person.2.fill")
                            .icon(.inline, .secondary)
                            .frame(width: 20)
                            .accessibilityHidden(true)
                        Text(summary.isEmpty ? name : summary)
                            .foregroundStyle(hovering ? Color.primary : Theme.secondaryText)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        if !members.isEmpty {
                            Text(members.count == 1 ? "1 agent" : "\(members.count) agents")
                                .foregroundStyle(Theme.secondaryText.opacity(0.8))
                        }
                        if state == .failed {
                            Text("Failed").foregroundStyle(.red)
                        }
                        Spacer(minLength: 8)
                        Text("Agents")
                            .font(.system(size: 11.5))
                            .foregroundStyle(Theme.secondaryText)
                            .opacity(hovering ? 1 : 0)
                        Image(systemName: "chevron.right")
                            .icon(.inline, .secondary)
                            .frame(width: 14)
                            .accessibilityHidden(true)
                    }
                    .font(.system(size: 12.5))
                    .frame(height: 26)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { hovering = $0 }
                .help("Open the Agents panel")
                ForEach(members, id: \.id) { member in
                    SubagentMemberRow(agent: member)
                }
            }
        }
    }

    private func members(started: Int64?, ended: Int64?) -> [Subagent] {
        guard let thread = store.conversation.thread else { return [] }
        let agents = store.workspace.subagents[thread] ?? []
        guard let started else { return agents }
        return agents.filter { agent in
            guard let begin = agent.startedAt else { return true }
            return begin >= started - Self.slack && ended.map { begin <= $0 + Self.slack } ?? true
        }
    }
}

private struct SubagentMemberRow: View {
    let agent: Subagent

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(agent.running ? Theme.primary : Theme.secondaryText.opacity(0.5))
                .frame(width: 5, height: 5)
                .frame(width: 16)
                .accessibilityHidden(true)
            Text(agent.title)
                .lineLimit(1)
            if let detail {
                Text(detail)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 8)
            if agent.tokens > 0 {
                Text(TokenCount(agent.tokens).text)
                    .monospacedDigit()
                    .foregroundStyle(Theme.secondaryText.opacity(0.8))
            }
            if let duration = agent.durationMs {
                Text(WorkDuration(milliseconds: duration).text)
                    .monospacedDigit()
                    .foregroundStyle(Theme.secondaryText.opacity(0.8))
            }
            Text(agent.running ? "Working" : agent.status.capitalized)
                .foregroundStyle(agent.running ? Theme.primary : Theme.secondaryText)
        }
        .font(.system(size: 12))
        .padding(.leading, 12)
        .frame(height: 22)
        .accessibilityElement(children: .combine)
        .help(agent.answer ?? agent.note ?? agent.title)
    }

    private var detail: String? {
        if agent.running, let tool = agent.currentTool, !tool.isEmpty {
            return tool
        }
        return agent.note ?? agent.model
    }
}
