import SwiftUI

struct ToastsOverlay: View {
	@ObservedObject var session: CoreSession

	var body: some View {
		if let toasts = session.toasts, !toasts.toasts.isEmpty {
			VStack(spacing: 8) {
				ForEach(toasts.toasts, id: \.id) { toast in
					ToastsOverlayRow(toast: toast, session: session)
				}
			}
		}
	}
}

struct ToastsOverlayRow: View {
	let toast: CoreToast
	@ObservedObject var session: CoreSession

	var body: some View {
		HStack(spacing: 10) {
			Image(systemName: icon)
				.font(.body)
				.foregroundStyle(color)
			VStack(alignment: .leading, spacing: 2) {
				Text(toast.title)
					.font(.callout.bold())
				if let description = toast.description {
					Text(description)
						.font(.caption)
						.foregroundStyle(.secondary)
				}
			}
			Spacer()
			ForEach(toast.actions, id: \.key) { action in
				Button(action.label) {
					session.toastAction(toast.id, key: action.key.rawValue)
				}
				.buttonStyle(.bordered)
				.controlSize(.small)
			}
			Button {
				session.dismissToast(toast.id)
			} label: {
				Image(systemName: "xmark")
					.font(.caption)
			}
			.buttonStyle(.borderless)
			.foregroundStyle(.secondary)
		}
		.padding(12)
		.frame(maxWidth: 380)
		.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
		.overlay(
			RoundedRectangle(cornerRadius: 12)
				.stroke(Color.secondary.opacity(0.2), lineWidth: 1)
		)
		.shadow(radius: 8, y: 2)
	}

	private var icon: String {
		switch toast.type {
		case .error: return "xmark.octagon"
		case .warning: return "exclamationmark.triangle"
		case .success: return "checkmark.circle"
		case .info: return "info.circle"
		case .loading: return "arrow.triangle.2.circlepath"
		}
	}

	private var color: Color {
		switch toast.type {
		case .error: return .red
		case .warning: return .orange
		case .success: return .green
		case .info: return .blue
		case .loading: return .secondary
		}
	}
}
