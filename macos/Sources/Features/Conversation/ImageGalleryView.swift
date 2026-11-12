import AppKit
import LocalStudioKit
import SwiftUI

@MainActor
enum ThumbnailCache {
    private static let storage: NSCache<NSString, NSImage> = {
        let cache = NSCache<NSString, NSImage>()
        cache.countLimit = 300
        return cache
    }()

    static func image(_ key: String, data: Data) -> NSImage? {
        if let image = storage.object(forKey: key as NSString) {
            return image
        }
        guard let image = NSImage(data: data) else { return nil }
        storage.setObject(image, forKey: key as NSString)
        return image
    }
}

struct ThumbnailGrid: View {
    let id: UInt64
    let thumbnails: [ImageThumbnail]
    let open: (Int) -> Void

    var body: some View {
        let columns = thumbnails.count == 1 ? 1 : 2
        Grid(horizontalSpacing: 6, verticalSpacing: 6) {
            ForEach(Array(stride(from: 0, to: thumbnails.count, by: columns)), id: \.self) { start in
                GridRow {
                    ForEach(start..<min(start + columns, thumbnails.count), id: \.self) { index in
                        ThumbnailTile(key: "\(id)-\(index)", thumbnail: thumbnails[index], single: columns == 1) { open(index) }
                    }
                }
            }
        }
    }
}

private struct ThumbnailTile: View {
    let key: String
    let thumbnail: ImageThumbnail
    let single: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Group {
                if let image = ThumbnailCache.image(key, data: thumbnail.data) {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: "photo")
                        .icon(.control, .secondary)
                        .accessibilityHidden(true)
                }
            }
            .frame(width: single ? 240 : 150, height: single ? 180 : 112)
            .background(Theme.message)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(hovering ? Theme.input : Theme.hairline))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help("Open image (\(thumbnail.width)×\(thumbnail.height))")
        .accessibilityLabel("Image, \(thumbnail.width) by \(thumbnail.height)")
    }
}

struct ImageGalleryView: View {
    let store: StudioStore
    @State private var gallery: ImageGallery
    @State private var requests: [Int: String] = [:]
    @Environment(\.dismiss) private var dismiss

    init(store: StudioStore, gallery: ImageGallery) {
        self.store = store
        _gallery = State(initialValue: gallery)
    }

    var body: some View {
        let index = gallery.index
        VStack(spacing: 0) {
            ZStack {
                Theme.canvas
                if let image = fullImage(index) ?? ThumbnailCache.image("gallery-\(gallery.entry)-\(index)", data: gallery.thumbnails[index].data) {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFit()
                        .padding(20)
                }
                if let error = requests[index].flatMap({ store.conversation.messageImageErrors[$0] }) {
                    Text(error)
                        .font(.system(size: 12))
                        .foregroundStyle(.red)
                        .padding(8)
                        .background(Theme.card, in: Capsule())
                        .frame(maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, 12)
                }
            }
            Rectangle().fill(Theme.hairline).frame(height: 1)
            HStack(spacing: 8) {
                Button("Previous", systemImage: "chevron.left") { step(-1) }
                    .labelStyle(.iconOnly)
                    .help("Previous image")
                    .disabled(index == 0)
                    .keyboardShortcut(.leftArrow, modifiers: [])
                Text("\(index + 1) of \(gallery.thumbnails.count)")
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .foregroundStyle(Theme.secondaryText)
                Button("Next", systemImage: "chevron.right") { step(1) }
                    .labelStyle(.iconOnly)
                    .help("Next image")
                    .disabled(index >= gallery.thumbnails.count - 1)
                    .keyboardShortcut(.rightArrow, modifiers: [])
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .buttonStyle(.borderless)
            .padding(.horizontal, 14)
            .frame(height: 44)
        }
        .frame(minWidth: 520, idealWidth: 860, minHeight: 400, idealHeight: 640)
        .task(id: index) { load(index) }
    }

    private func fullImage(_ index: Int) -> NSImage? {
        guard let request = requests[index], let image = store.conversation.messageImages[request] else { return nil }
        return ThumbnailCache.image("full-\(request)", data: image.data)
    }

    private func load(_ index: Int) {
        guard requests[index] == nil, let request = store.conversation.loadMessageImage(entry: gallery.entry, index: index) else { return }
        requests[index] = request
    }

    private func step(_ delta: Int) {
        gallery.index = min(max(gallery.index + delta, 0), gallery.thumbnails.count - 1)
    }
}
