import SwiftUI

struct HeaderToolbarBar: View {
	@ObservedObject var session: CoreSession
	let toolbar: HeaderToolbarView

	var body: some View {
		HStack(spacing: 8) {
			if let shell = session.shell {
				if let header = shell.threadHeader {
					HStack(spacing: 6) {
						if let project = header.project {
							ProjectIcon(icon: project.icon, size: 14)
							Text(project.name)
								.font(.callout)
								.foregroundStyle(.secondary)
						}
						Text(header.title)
							.font(.callout.bold())
							.lineLimit(1)
					}
				} else {
					Text("Local Studio")
						.font(.callout.bold())
				}
			}
			Spacer()
			gitToolbar
			panels
		}
	}

	@ViewBuilder
	private var gitToolbar: some View {
		switch toolbar.git {
		case .hidden:
			EmptyView()
		case .gitInit(let label, let disabled):
			Button(label) {
				session.unavailable("git init")
			}
			.buttonStyle(.bordered)
			.controlSize(.small)
			.disabled(disabled)
		case .repo(let icon, let quickAction, _, let buttonDisabled, _, _, _, let submenuLabel):
			HStack(spacing: 4) {
				Image(systemName: icon == "git-branch" ? "arrow.triangle.branch" : "circle")
					.font(.caption)
				Menu {
					Button(submenuLabel) {
						session.unavailable("source control")
					}
				} label: {
					Text(quickAction.label)
						.font(.caption)
				}
				.menuStyle(.borderlessButton)
				.disabled(buttonDisabled)
			}
		}
	}

	@ViewBuilder
	private var panels: some View {
		HStack(spacing: 4) {
			if toolbar.panels.terminal.visible {
				PanelToggle(
					toggle: toolbar.panels.terminal,
					icon: "terminal"
				) {
					session.unavailable("terminal")
				}
			}
			if toolbar.panels.rightPanel.visible {
				PanelToggle(
					toggle: toolbar.panels.rightPanel,
					icon: "sidebar.right"
				) {
					session.unavailable("right panel")
				}
			}
		}
	}
}

struct PanelToggle: View {
	let toggle: PanelToggleView
	let icon: String
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			Image(systemName: icon)
				.font(.body)
		}
		.buttonStyle(.borderless)
		.foregroundStyle(toggle.pressed ? Color.accentColor : Color.secondary)
		.disabled(toggle.disabled)
	}
}
