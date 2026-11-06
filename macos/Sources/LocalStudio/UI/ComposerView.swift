import SwiftUI

final class ComposerPromptState: ObservableObject {
	@Published var prompt: String = ""
}

struct ComposerBar: View {
	@ObservedObject var session: CoreSession
	let composer: ComposerView
	@StateObject private var promptState = ComposerPromptState()

	var body: some View {
		VStack(spacing: 8) {
			if let error = composer.threadError ?? composer.providerInputError {
				HStack(spacing: 6) {
					Image(systemName: "exclamationmark.triangle")
						.font(.caption)
						.foregroundStyle(.red)
					Text(error)
						.font(.caption)
						.foregroundStyle(.red)
				}
				.padding(.horizontal, 12)
			}
			HStack(alignment: .bottom, spacing: 8) {
				VStack(alignment: .leading, spacing: 4) {
					if let model = composer.model {
						ModelBadge(model: model)
							.onTapGesture {
								session.openModelPicker()
							}
					}
					TextEditor(text: $promptState.prompt)
						.font(.body)
						.frame(minHeight: 24, maxHeight: 120)
						.scrollContentBackground(.hidden)
						.onChange(of: promptState.prompt) { newValue in
							session.setPrompt(newValue)
						}
						.onAppear {
							promptState.prompt = composer.prompt
						}
						.onChange(of: composer.promptRevision) { _ in
							if promptState.prompt != composer.prompt {
								promptState.prompt = composer.prompt
							}
						}
				}
				Spacer()
				if composer.running && composer.canInterrupt {
					Button {
						session.interrupt()
					} label: {
						Image(systemName: "stop.circle.fill")
							.font(.title3)
							.foregroundStyle(.red)
					}
					.buttonStyle(.borderless)
					.help("Interrupt")
				} else {
					Button {
						session.send()
					} label: {
						Image(systemName: "arrow.up.circle.fill")
							.font(.title3)
							.foregroundStyle(composer.hasSendableContent ? Color.accentColor : Color.secondary)
					}
					.buttonStyle(.borderless)
					.disabled(!composer.hasSendableContent || composer.running)
					.help("Send")
				}
			}
		}
		.padding(12)
		.background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
		.overlay(
			RoundedRectangle(cornerRadius: 12)
				.stroke(Color.secondary.opacity(0.2), lineWidth: 1)
		)
		.padding(.horizontal, 24)
		.padding(.bottom, 16)
		.onSubmit {
			session.send()
		}
	}
}

struct ModelBadge: View {
	let model: ComposerModelView

	var body: some View {
		HStack(spacing: 6) {
			RoundedRectangle(cornerRadius: 4)
				.fill(Color.accentColor.opacity(0.2))
				.frame(width: 18, height: 18)
				.overlay(
					Text(model.initials.prefix(2))
						.font(.system(size: 9, weight: .bold))
						.foregroundStyle(Color.accentColor)
				)
			Text(model.label)
				.font(.caption)
				.foregroundStyle(.secondary)
			Image(systemName: "chevron.up.chevron.down")
				.font(.caption2)
				.foregroundStyle(.tertiary)
		}
	}
}
