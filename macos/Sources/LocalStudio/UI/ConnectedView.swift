import SwiftUI

struct ConnectedView: View {
	@ObservedObject var session: CoreSession

	var body: some View {
		HStack(spacing: 0) {
			SidebarPanel(session: session)
				.frame(width: 280)
			Divider()
			ChatArea(session: session)
		}
		.overlay(alignment: .bottomTrailing) {
			ToastsOverlay(session: session)
				.padding(16)
		}
	}
}

struct ChatArea: View {
	@ObservedObject var session: CoreSession

	var body: some View {
		VStack(spacing: 0) {
			if let toolbar = session.headerToolbar {
				HeaderToolbarBar(session: session, toolbar: toolbar)
					.padding(.horizontal, 12)
					.padding(.vertical, 8)
			}
			if let timeline = session.timeline {
				TimelineListView(session: session, timeline: timeline)
			} else {
				EmptyThreadView(session: session)
			}
			if let composer = session.composer {
				Divider()
				ComposerBar(session: session, composer: composer)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(Color(nsColor: .textBackgroundColor))
	}
}

struct EmptyThreadView: View {
	@ObservedObject var session: CoreSession

	var body: some View {
		VStack(spacing: 10) {
			Image(systemName: "bubble.left.and.bubble.right")
				.font(.system(size: 44))
				.foregroundStyle(.tertiary)
			Text("New thread")
				.font(.title3.bold())
			Text("Ask an agent to do something.")
				.font(.callout)
				.foregroundStyle(.secondary)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
	}
}
