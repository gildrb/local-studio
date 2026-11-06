import SwiftUI

struct SidebarPanel: View {
	@ObservedObject var session: CoreSession

	var body: some View {
		VStack(spacing: 0) {
			if let sidebar = session.sidebar {
				SidebarHeader(header: sidebar.header, session: session)
				Divider()
				if let empty = sidebar.emptyState {
					SidebarEmptyState(state: empty)
						.frame(maxWidth: .infinity, maxHeight: .infinity)
				} else {
					List {
						ForEach(Array(sidebar.items.enumerated()), id: \.offset) { _, item in
							SidebarItem(item: item, session: session)
						}
					}
					.listStyle(.sidebar)
					.scrollContentBackground(.hidden)
				}
				Divider()
				SidebarFooter(footer: sidebar.footer, session: session)
			} else {
				ProgressView()
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			}
		}
		.background(Color(nsColor: .windowBackgroundColor))
	}
}

struct SidebarHeader: View {
	let header: SidebarHeaderView
	@ObservedObject var session: CoreSession

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack {
				Text(header.brandLabel)
					.font(.headline)
				Spacer()
				if let pill = header.stagePill {
					Text(pill)
						.font(.caption2.bold())
						.padding(.horizontal, 6)
						.padding(.vertical, 2)
						.background(Color.accentColor.opacity(0.15), in: Capsule())
				}
			}
			HStack(spacing: 6) {
				Image(systemName: "plus")
					.font(.caption)
				Text(header.newThread.label)
					.font(.callout)
			}
			.buttonStyle(.bordered)
			.controlSize(.small)
			.disabled(header.newThread.disabled)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(12)
	}
}

struct SidebarItem: View {
	let item: SidebarItemView
	@ObservedObject var session: CoreSession

	var body: some View {
		switch item {
		case .thread(let row):
			ThreadRow(row: row, session: session)
		case .draft(let row):
			DraftRow(row: row, session: session)
		case .draftDivider:
			Divider().padding(.vertical, 4)
		case .shelfHeader(let header):
			HStack {
				Text(header.label)
					.font(.caption.bold())
					.foregroundStyle(.secondary)
				Text("\(header.count)")
					.font(.caption2)
					.foregroundStyle(.tertiary)
				Spacer()
			}
			.padding(.vertical, 4)
		case .showMore(let label, let count):
			HStack {
				Text("\(label) (\(count))")
					.font(.caption)
					.foregroundStyle(.secondary)
				Spacer()
			}
			.padding(.vertical, 4)
		}
	}
}

struct ThreadRow: View {
	let row: SidebarThreadRowView
	@ObservedObject var session: CoreSession

	var body: some View {
		HStack(spacing: 8) {
			ProjectIcon(icon: row.project.icon, size: 16)
			VStack(alignment: .leading, spacing: 2) {
				HStack(spacing: 4) {
					if let status = row.status {
						StatusDot(kind: status.kind)
					}
					Text(row.title)
						.font(.callout.weight(row.titleWeight == .medium ? .medium : .regular))
						.lineLimit(1)
						.truncationMode(.tail)
					Spacer()
					Text(row.timeLabel)
						.font(.caption2)
						.foregroundStyle(.tertiary)
				}
				if let project = row.project.displayName {
					Text(project)
						.font(.caption2)
						.foregroundStyle(.secondary)
						.lineLimit(1)
				}
			}
		}
		.padding(.horizontal, 8)
		.padding(.vertical, 6)
		.background(
			row.isActive
				? Color.accentColor.opacity(0.12)
				: Color.clear,
			in: RoundedRectangle(cornerRadius: 6)
		)
		.contentShape(Rectangle())
		.onTapGesture {
			session.selectThread(environmentId: row.environmentId, threadId: row.threadId)
		}
	}
}

struct DraftRow: View {
	let row: SidebarDraftRowView
	@ObservedObject var session: CoreSession

	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: "square.and.pencil")
				.font(.caption)
				.foregroundStyle(.secondary)
			VStack(alignment: .leading, spacing: 2) {
				Text(row.preview.isEmpty ? "Draft" : row.preview)
					.font(.callout)
					.lineLimit(1)
				if let name = row.project.displayName {
					Text(name)
						.font(.caption2)
						.foregroundStyle(.secondary)
				}
			}
			Spacer()
		}
		.padding(.horizontal, 8)
		.padding(.vertical, 6)
		.background(
			row.isActive ? Color.accentColor.opacity(0.12) : Color.clear,
			in: RoundedRectangle(cornerRadius: 6)
		)
	}
}

struct SidebarEmptyState: View {
	let state: SidebarEmptyStateView

	var body: some View {
		VStack(spacing: 8) {
			switch state {
			case .noProjects(let label, let action):
				Text(label)
					.font(.callout)
					.foregroundStyle(.secondary)
				Button(action) {}
					.buttonStyle(.bordered)
					.controlSize(.small)
			case .noThreads(let label):
				Text(label)
					.font(.callout)
					.foregroundStyle(.secondary)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}
}

struct SidebarFooter: View {
	let footer: SidebarFooterView
	@ObservedObject var session: CoreSession

	var body: some View {
		HStack(spacing: 4) {
			if let back = footer.back {
				Button(back.label) {
					session.navigate("home")
				}
				.buttonStyle(.borderless)
				.font(.caption)
			}
			Spacer()
			ForEach(footer.items, id: \.id) { item in
				FooterButton(item: item, session: session)
			}
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 8)
	}
}

struct FooterButton: View {
	let item: FooterItemView
	@ObservedObject var session: CoreSession

	var body: some View {
		Button {
			switch item.id {
			case .settings: session.navigate("settings")
			case .pullRequests: session.navigate("pull-requests")
			case .usage: session.navigate("usage")
			}
		} label: {
			Label(item.label, systemImage: icon)
				.labelStyle(.iconOnly)
				.font(.body)
		}
		.buttonStyle(.borderless)
		.help(item.label)
	}

	private var icon: String {
		switch item.id {
		case .settings: return "gearshape"
		case .pullRequests: return "arrow.triangle.pull"
		case .usage: return "chart.bar"
		}
	}
}

struct StatusDot: View {
	let kind: SidebarThreadStatusKind

	var body: some View {
		Circle()
			.fill(color)
			.frame(width: 7, height: 7)
	}

	private var color: Color {
		switch kind {
		case .working: return .blue
		case .monitoring: return .teal
		case .approval: return .orange
		case .input: return .orange
		case .failed: return .red
		case .woke: return .purple
		case .done: return .green
		}
	}
}

struct ProjectIcon: View {
	let icon: ProjectIconView?
	var size: CGFloat = 16

	var body: some View {
		switch icon {
		case .monogram(let text, let color):
			RoundedRectangle(cornerRadius: 4)
				.fill(Color.projectIcon(color))
				.frame(width: size, height: size)
				.overlay(
					Text(text.prefix(1).uppercased())
						.font(.system(size: size * 0.6, weight: .bold))
						.foregroundStyle(.white)
				)
		case .emoji(let emoji):
			Text(emoji)
				.font(.system(size: size))
		case .lucide(let name, _):
			Image(systemName: lucideToSF(name))
				.font(.system(size: size * 0.8))
				.foregroundStyle(.secondary)
		case .image:
			Image(systemName: "photo")
				.font(.system(size: size * 0.8))
				.foregroundStyle(.secondary)
		case .folder:
			Image(systemName: "folder")
				.font(.system(size: size * 0.8))
				.foregroundStyle(.secondary)
		case nil:
			Image(systemName: "circle")
				.font(.system(size: size * 0.6))
				.foregroundStyle(.tertiary)
		}
	}
}

extension Color {
	static func projectIcon(_ color: ProjectIconColor) -> Color {
		switch color {
		case .gray: return .gray
		case .red: return .red
		case .orange: return .orange
		case .amber: return .orange
		case .yellow: return .yellow
		case .lime: return .green
		case .green: return .green
		case .emerald: return .green
		case .teal: return .teal
		case .cyan: return .cyan
		case .sky: return .cyan
		case .blue: return .blue
		case .indigo: return .indigo
		case .violet: return .purple
		case .purple: return .purple
		case .fuchsia: return .pink
		case .pink: return .pink
		case .rose: return .pink
		}
	}
}

func lucideToSF(_ name: String) -> String {
	switch name {
	case "terminal": return "terminal"
	case "folder": return "folder"
	case "git-branch": return "arrow.triangle.branch"
	case "code": return "chevron.left.forwardslash.chevron.right"
	default: return "circle"
	}
}
