import SwiftUI

struct TimelineListView: View {
	@ObservedObject var session: CoreSession
	let timeline: TimelineView

	var body: some View {
		ScrollViewReader { proxy in
			ScrollView {
				LazyVStack(alignment: .leading, spacing: 16) {
					ForEach(Array(timeline.rows.enumerated()), id: \.offset) { index, row in
						TimelineRowViewRow(row: row, session: session)
							.id(index)
					}
				}
				.padding(.horizontal, 24)
				.padding(.vertical, 16)
				.frame(maxWidth: 760, alignment: .leading)
				.frame(maxWidth: .infinity)
			}
			.onChange(of: timeline.scrollRevision) { _ in
				if let last = timeline.rows.indices.last {
					withAnimation {
						proxy.scrollTo(last, anchor: .bottom)
					}
				}
			}
		}
	}
}

struct TimelineRowViewRow: View {
	let row: TimelineRow
	@ObservedObject var session: CoreSession

	var body: some View {
		switch row.view {
		case .user(let id, _, let text, let document, let images, let videos, let files, _, _, let expanded, _, _, _, let timeLabel, _):
			UserMessageRow(
				text: text,
				document: document,
				images: images,
				videos: videos,
				files: files,
				expanded: expanded,
				timeLabel: timeLabel
			)
		case .assistant(let id, let document, let copyText, let streaming, let showMeta, let showCopyButton, let timeLabel, _, let changedFiles):
			AssistantMessageRow(
				document: document,
				copyText: copyText,
				streaming: streaming,
				showMeta: showMeta,
				showCopyButton: showCopyButton,
				timeLabel: timeLabel,
				changedFiles: changedFiles
			)
		case .assistantMeta(let id, let showCopyButton, let copyText, let timeLabel, _):
			AssistantMetaRow(showCopyButton: showCopyButton, copyText: copyText, timeLabel: timeLabel)
		case .reasoning(let id, _, let expanded, let document, let timeLabel):
			ReasoningRow(expanded: expanded, document: document, timeLabel: timeLabel)
		case .turnFold(let id, let turnId, let label, let expanded, let timeLabel, _):
			TurnFoldRow(label: label, expanded: expanded, timeLabel: timeLabel) {
				session.toggleTurnFold(turnId)
			}
		case .workToggle(let row):
			WorkToggleRowViewRow(row: row) {
				session.toggleWorkGroup(row.groupId)
			}
		case .work(let row):
			WorkRowViewRow(row: row)
		case .workLive(let row):
			WorkLiveRowViewRow(row: row)
		case .activityGroup(let row):
			ActivityGroupRowViewRow(row: row)
		case .working(let row):
			WorkingRowViewRow(row: row)
		case .thinking(_, let visible):
			if visible {
				HStack(spacing: 6) {
					ProgressView().controlSize(.small)
					Text("Thinking…")
						.font(.callout)
						.foregroundStyle(.secondary)
				}
				.padding(.vertical, 4)
			}
		case .contextCompaction(_, let label):
			HStack(spacing: 6) {
				Image(systemName: "arrow.down.circle")
					.font(.caption)
					.foregroundStyle(.secondary)
				Text(label)
					.font(.caption)
					.foregroundStyle(.secondary)
			}
		case .proposedPlan(let plan):
			ProposedPlanRowViewRow(plan: plan)
		}
	}
}

struct UserMessageRow: View {
	let text: String
	let document: MarkdownDocView?
	let images: [TimelineUserGridImageView]
	let videos: [TimelineUserVideoView]
	let files: [TimelineUserFileView]
	let expanded: Bool
	let timeLabel: String

	var body: some View {
		VStack(alignment: .trailing, spacing: 6) {
			if !text.isEmpty {
				Text(text)
					.font(.body)
					.textSelection(.enabled)
					.padding(.horizontal, 12)
					.padding(.vertical, 8)
					.background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
					.foregroundStyle(.primary)
			}
			if let document, !document.blocks.isEmpty {
				MarkdownView(document: document)
					.padding(.horizontal, 12)
					.padding(.vertical, 8)
					.background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
			}
			if !files.isEmpty {
				HStack(spacing: 6) {
					ForEach(files, id: \.id) { file in
						FileChip(file: file)
					}
				}
			}
			Text(timeLabel)
				.font(.caption2)
				.foregroundStyle(.tertiary)
		}
		.frame(maxWidth: .infinity, alignment: .trailing)
	}
}

struct AssistantMessageRow: View {
	let document: MarkdownDocView
	let copyText: String?
	let streaming: Bool
	let showMeta: Bool
	let showCopyButton: Bool
	let timeLabel: String
	let changedFiles: ChangedFilesCardView?

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			MarkdownView(document: document)
			if let changedFiles {
				ChangedFilesCard(card: changedFiles)
			}
			if showMeta {
				HStack(spacing: 8) {
					if streaming {
						ProgressView().controlSize(.mini)
					}
					if showCopyButton, let copyText {
						Button {
							NSPasteboard.general.clearContents()
							NSPasteboard.general.setString(copyText, forType: .string)
						} label: {
							Image(systemName: "doc.on.doc")
								.font(.caption)
						}
						.buttonStyle(.borderless)
						.foregroundStyle(.secondary)
					}
					Text(timeLabel)
						.font(.caption2)
						.foregroundStyle(.tertiary)
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}
}

struct AssistantMetaRow: View {
	let showCopyButton: Bool
	let copyText: String?
	let timeLabel: String

	var body: some View {
		HStack(spacing: 8) {
			if showCopyButton, let copyText {
				Button {
					NSPasteboard.general.clearContents()
					NSPasteboard.general.setString(copyText, forType: .string)
				} label: {
					Image(systemName: "doc.on.doc")
						.font(.caption)
				}
				.buttonStyle(.borderless)
				.foregroundStyle(.secondary)
			}
			Text(timeLabel)
				.font(.caption2)
				.foregroundStyle(.tertiary)
		}
	}
}

struct ReasoningRow: View {
	let expanded: Bool
	let document: MarkdownDocView?
	let timeLabel: String

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(spacing: 6) {
				Image(systemName: "brain")
					.font(.caption)
					.foregroundStyle(.secondary)
				Text("Reasoning")
					.font(.caption.bold())
					.foregroundStyle(.secondary)
				Text(timeLabel)
					.font(.caption2)
					.foregroundStyle(.tertiary)
			}
			if expanded, let document {
				MarkdownView(document: document)
					.font(.callout)
					.foregroundStyle(.secondary)
			}
		}
		.padding(10)
		.background(Color(nsColor: .windowBackgroundColor).opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
	}
}

struct TurnFoldRow: View {
	let label: String
	let expanded: Bool
	let timeLabel: String
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			HStack(spacing: 6) {
				Image(systemName: expanded ? "chevron.down" : "chevron.right")
					.font(.caption2)
				Text(label)
					.font(.caption)
					.foregroundStyle(.secondary)
				Text(timeLabel)
					.font(.caption2)
					.foregroundStyle(.tertiary)
			}
		}
		.buttonStyle(.borderless)
	}
}

struct WorkToggleRowViewRow: View {
	let row: WorkToggleRowView
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			HStack(spacing: 8) {
				Image(systemName: row.icon.name.sfSymbol)
					.font(.caption)
					.foregroundStyle(.secondary)
				Text(row.summary)
					.font(.callout)
					.foregroundStyle(.secondary)
				Spacer()
				Image(systemName: row.expanded ? "chevron.down" : "chevron.right")
					.font(.caption2)
					.foregroundStyle(.tertiary)
			}
		}
		.buttonStyle(.borderless)
	}
}

struct WorkRowViewRow: View {
	let row: WorkRowView

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			ForEach(row.entries, id: \.id) { entry in
				WorkEntryRow(entry: entry)
			}
		}
		.padding(.leading, 8)
	}
}

struct WorkEntryRow: View {
	let entry: WorkEntryView

	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			Image(systemName: entry.icon.name.sfSymbol)
				.font(.caption)
				.foregroundStyle(toneColor(entry.iconTone))
				.frame(width: 16)
			VStack(alignment: .leading, spacing: 2) {
				Text(entry.label)
					.font(.callout)
				if let preview = entry.answerPreview {
					Text(preview)
						.font(.caption)
						.foregroundStyle(.secondary)
						.lineLimit(2)
				}
			}
			Spacer()
			Text(entry.timeLabel)
				.font(.caption2)
				.foregroundStyle(.tertiary)
		}
	}

	private func toneColor(_ tone: WorkIconTone) -> Color {
		switch tone {
		case .warning: return .orange
		case .destructive: return .red
		case .failed: return .red
		case .iconMuted: return .secondary
		case .foreground: return .primary
		}
	}
}

struct WorkLiveRowViewRow: View {
	let row: WorkLiveRowView

	var body: some View {
		HStack(spacing: 8) {
			ProgressView().controlSize(.small)
			Image(systemName: row.activity.icon.name.sfSymbol)
				.font(.caption)
				.foregroundStyle(.secondary)
			Text(row.activity.label)
				.font(.callout)
				.foregroundStyle(.secondary)
		}
	}
}

struct ActivityGroupRowViewRow: View {
	let row: ActivityGroupRowView

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(spacing: 8) {
				Image(systemName: row.activity.icon.name.sfSymbol)
					.font(.caption)
					.foregroundStyle(.secondary)
				Text(row.activity.label)
					.font(.callout)
					.foregroundStyle(.secondary)
			}
		}
		.padding(.leading, 8)
	}
}

struct WorkingRowViewRow: View {
	let row: WorkingRowView

	var body: some View {
		HStack(spacing: 8) {
			ProgressView().controlSize(.small)
			Text(row.working.label)
				.font(.callout)
				.foregroundStyle(.secondary)
			if let timer = row.working.timerText {
				Text(timer)
					.font(.caption2)
					.foregroundStyle(.tertiary)
			}
		}
	}
}

struct ProposedPlanRowViewRow: View {
	let plan: ProposedPlanRowView

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack(spacing: 6) {
				Image(systemName: "list.bullet.rectangle")
					.font(.caption)
					.foregroundStyle(.secondary)
				Text(plan.title)
					.font(.callout.bold())
			}
			if plan.expanded {
				Text(plan.markdown)
					.font(.callout)
					.textSelection(.enabled)
			}
		}
		.padding(10)
		.background(Color(nsColor: .windowBackgroundColor).opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
	}
}

struct FileChip: View {
	let file: TimelineUserFileView

	var body: some View {
		HStack(spacing: 4) {
			Image(systemName: "doc")
				.font(.caption2)
				.foregroundStyle(.secondary)
			Text(file.name)
				.font(.caption)
				.lineLimit(1)
		}
		.padding(.horizontal, 8)
		.padding(.vertical, 4)
		.background(Color(nsColor: .windowBackgroundColor), in: Capsule())
	}
}

struct ChangedFilesCard: View {
	let card: ChangedFilesCardView

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(spacing: 6) {
				Image(systemName: "doc.badge.gearshape")
					.font(.caption)
					.foregroundStyle(.secondary)
				Text(card.countLabel)
					.font(.caption.bold())
				if let stat = card.stat {
					Text("\(stat.additionsText) \(stat.deletionsText)")
						.font(.caption2)
						.foregroundStyle(.secondary)
				}
			}
			ForEach(Array(card.nodes.enumerated()), id: \.offset) { _, node in
				ChangedFilesNode(node: node)
			}
		}
		.padding(10)
		.background(Color(nsColor: .windowBackgroundColor).opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
	}
}

struct ChangedFilesNode: View {
	let node: ChangedFilesNodeView

	var body: some View {
		switch node {
		case .directory(let key, _, let name, let indent, let expanded, let icon, let stat, let children):
			VStack(alignment: .leading, spacing: 2) {
				HStack(spacing: 4) {
					Image(systemName: icon == .folderOpen ? "folder" : "folder")
						.font(.caption2)
						.foregroundStyle(.secondary)
					Text(name)
						.font(.caption)
					if let stat {
						Text("\(stat.additionsText) \(stat.deletionsText)")
							.font(.caption2)
							.foregroundStyle(.secondary)
					}
				}
				.padding(.leading, indent)
				if expanded {
					ForEach(Array(children.enumerated()), id: \.offset) { _, child in
						ChangedFilesNode(node: child)
					}
				}
			}
		case .file(_, _, let name, let indent, _, let icon, let stat):
			HStack(spacing: 4) {
				Image(systemName: "doc")
					.font(.caption2)
					.foregroundStyle(.secondary)
				Text(name)
					.font(.caption)
				if let stat {
					Text("\(stat.additionsText) \(stat.deletionsText)")
						.font(.caption2)
						.foregroundStyle(.secondary)
				}
			}
			.padding(.leading, indent)
		}
	}
}

extension WorkIconName {
	var sfSymbol: String {
		switch self {
		case .bot: return "cpu"
		case .brain: return "brain"
		case .browser: return "safari"
		case .check: return "checkmark"
		case .circleAlert: return "exclamationmark.circle"
		case .computer: return "desktopcomputer"
		case .device: return "iphone"
		case .eye: return "eye"
		case .globe: return "globe"
		case .hammer: return "hammer"
		case .messageCircle: return "bubble.left"
		case .search: return "magnifyingglass"
		case .squarePen: return "square.and.pencil"
		case .terminal: return "terminal"
		case .pullRequest: return "arrow.triangle.pull"
		case .t3Code: return "chevron.left.forwardslash.chevron.right"
		case .wrench: return "wrench"
		case .x: return "xmark"
		case .zap: return "bolt"
		}
	}
}
