import SwiftUI

struct LocalStudioRootView: View {
	@StateObject private var session = CoreSession()

	var body: some View {
		Group {
			switch session.phase {
			case .starting:
				StartingView()
			case .failed(let message):
				FailedView(message: message)
			case .connected:
				ConnectedView(session: session)
			}
		}
		.frame(minWidth: 900, minHeight: 600)
		.onAppear {
			session.start()
		}
		.onDisappear {
			session.shutdown()
		}
	}
}

struct StartingView: View {
	var body: some View {
		VStack(spacing: 12) {
			ProgressView()
				.controlSize(.large)
			Text("Starting Local Studio…")
				.font(.callout)
				.foregroundStyle(.secondary)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(Color(nsColor: .windowBackgroundColor))
	}
}

struct FailedView: View {
	let message: String
	var body: some View {
		VStack(spacing: 12) {
			Image(systemName: "exclamationmark.triangle")
				.font(.system(size: 40))
				.foregroundStyle(.orange)
			Text("Could not start")
				.font(.title3.bold())
			Text(message)
				.font(.callout)
				.foregroundStyle(.secondary)
				.multilineTextAlignment(.center)
				.frame(maxWidth: 480)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(Color(nsColor: .windowBackgroundColor))
	}
}
