import AppKit
import LocalStudioKit
import SwiftUI

struct AttachmentStrip: View {
    let draft: ComposerDraft

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(draft.images) { image in
                    ZStack(alignment: .topTrailing) {
                        Group {
                            if let thumbnail = image.thumbnail {
                                Image(nsImage: thumbnail)
                                    .resizable()
                                    .scaledToFill()
                            } else {
                                Image(systemName: "photo")
                                    .foregroundStyle(Theme.secondaryText)
                                    .accessibilityHidden(true)
                            }
                        }
                        .frame(width: 52, height: 52)
                        .background(Theme.message)
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Theme.hairline))
                        .accessibilityElement()
                        .accessibilityLabel("Attached image")
                        RemoveBadge(title: "Remove image") {
                            draft.images.removeAll { $0.id == image.id }
                        }
                        .offset(x: 5, y: -5)
                    }
                    .padding(.top, 5)
                    .padding(.trailing, 5)
                }
                ForEach(draft.files, id: \.self) { file in
                    AttachmentChip(symbol: "doc", title: URL(fileURLWithPath: file).lastPathComponent, help: file) {
                        draft.files.removeAll { $0 == file }
                    }
                }
                ForEach(draft.contexts) { context in
                    AttachmentChip(symbol: context.symbol, title: context.title, help: context.text) {
                        draft.contexts.removeAll { $0.id == context.id }
                    }
                }
            }
        }
    }
}

private struct AttachmentChip: View {
    let symbol: String
    let title: String
    let help: String
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 11.5, weight: .light))
                .foregroundStyle(Theme.secondaryText)
                .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 12))
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 240, alignment: .leading)
                .fixedSize(horizontal: true, vertical: false)
            Button(action: remove) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(Theme.secondaryText)
            }
            .buttonStyle(.plain)
            .help("Remove")
            .accessibilityLabel("Remove \(title)")
        }
        .padding(.horizontal, 9)
        .frame(height: 26)
        .background(Theme.message, in: Capsule())
        .help(help)
    }
}

private struct RemoveBadge: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(Color.primary)
                .frame(width: 18, height: 18)
                .background(Theme.card, in: Circle())
                .overlay(Circle().strokeBorder(Theme.input))
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
    }
}

struct StashMenu: View {
    let store: StudioStore
    let project: String?
    @State private var hovering = false

    var body: some View {
        let conversation = store.conversation
        let key = conversation.stashKey(project: project)
        let prompts = conversation.stash.list(key)
        if !prompts.isEmpty {
            Menu {
                Button("Stash Current Prompt") { conversation.stashPrompt(project: project) }
                    .disabled(conversation.composer(project: project).isEmpty)
                Divider()
                Section("Stashed Prompts") {
                    ForEach(prompts) { prompt in
                        Button {
                            conversation.restoreStash(prompt, project: project)
                        } label: {
                            Text(prompt.title)
                            Text(prompt.created, format: .relative(presentation: .named))
                        }
                    }
                }
                Divider()
                Button("Clear Stash", role: .destructive) { conversation.stash.clear(project: key) }
            } label: {
                ComposerChip(title: "\(prompts.count)", symbol: "archivebox", hovering: hovering)
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .onHover { hovering = $0 }
            .help(prompts.count == 1 ? "1 stashed prompt" : "\(prompts.count) stashed prompts")
            .accessibilityLabel(prompts.count == 1 ? "1 stashed prompt" : "\(prompts.count) stashed prompts")
        }
    }
}
