import AppKit
import LocalStudioKit
import SwiftUI

struct FilesSurfaceView: View {
    let model: FilesModel
    let panels: PanelState

    var body: some View {
        VStack(spacing: 0) {
            PanelToolbar {
                Image(systemName: "folder")
                    .font(.system(size: 12, weight: .light))
                    .foregroundStyle(Theme.chromeIcon)
                Text((model.project as NSString).lastPathComponent)
                    .font(.system(size: 12.5, weight: .medium))
                    .lineLimit(1)
                Spacer()
                PanelIconButton("Reveal in Finder", symbol: "arrow.up.right.circle") {
                    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: model.project)])
                }
                PanelIconButton("Refresh", symbol: "arrow.clockwise") { model.refresh() }
            }
            if let failure = model.failure {
                PanelMessage(symbol: "exclamationmark.triangle", title: "Couldn’t list files.", detail: failure, actionTitle: "Try Again") { model.refresh() }
            } else if model.rootLoading {
                PanelMessage(symbol: "clock", title: "Loading files…")
            } else if model.rows.isEmpty {
                PanelMessage(symbol: "folder", title: "This folder is empty.")
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(model.rows) { row in
                            FileRowView(row: row, selected: model.selection == row.id) { model.activate(row.entry) }
                        }
                    }
                    .padding(6)
                }
            }
        }
    }
}

private struct FileRowView: View {
    let row: FileRow
    let selected: Bool
    let activate: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 5) {
            Group {
                if row.entry.directory {
                    Image(systemName: row.expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Theme.secondaryText)
                } else {
                    Color.clear
                }
            }
            .frame(width: 12)
            Image(systemName: row.entry.directory ? "folder" : "doc")
                .font(.system(size: 12, weight: .light))
                .foregroundStyle(Theme.chromeIcon)
                .frame(width: 16)
            Text(row.entry.name)
                .font(.system(size: 13))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 6)
            if row.loading {
                Text("Loading…")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.secondaryText)
            } else if !row.entry.directory, hovering || selected {
                Text(ByteCountFormatter.string(fromByteCount: Int64(clamping: row.entry.size), countStyle: .file))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.secondaryText)
                    .monospacedDigit()
            }
        }
        .padding(.leading, 6 + CGFloat(row.depth) * 14)
        .padding(.trailing, 8)
        .frame(height: 26)
        .rowSurface(selected: selected, hovering: hovering)
        .contentShape(Rectangle())
        .onTapGesture(perform: activate)
        .onHover { hovering = $0 }
        .help(row.entry.relative)
        .contextMenu {
            Button(row.entry.directory ? (row.expanded ? "Collapse" : "Expand") : "Open Preview", action: activate)
            Button("Copy Relative Path") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(row.entry.relative, forType: .string)
            }
        }
    }
}

struct FilePreviewView: View {
    let model: FilePreviewModel
    let settings: LocalStudioKit.Settings?

    var body: some View {
        VStack(spacing: 0) {
            PanelToolbar {
                Image(systemName: "doc.text")
                    .font(.system(size: 12, weight: .light))
                    .foregroundStyle(Theme.chromeIcon)
                PathLabel(relative: model.relative)
                Spacer(minLength: 4)
                if case .text(_, let language) = model.content, let language {
                    Text(language)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.secondaryText)
                }
                PanelIconButton("Copy Path", symbol: "square.on.square") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(absolute.path, forType: .string)
                }
                PanelIconButton("Open in Default App", symbol: "arrow.up.right.circle") {
                    NSWorkspace.shared.open(absolute)
                }
                PanelIconButton("Reload", symbol: "arrow.clockwise") { model.load() }
            }
            content
        }
    }

    private var absolute: URL {
        URL(fileURLWithPath: model.project).appendingPathComponent(model.relative)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .idle, .loading:
            PanelMessage(symbol: "clock", title: "Loading \((model.relative as NSString).lastPathComponent)…")
        case .failed(let message):
            PanelMessage(symbol: "exclamationmark.triangle", title: "Couldn’t open this file.", detail: message, actionTitle: "Try Again") { model.load() }
        case .loaded:
            switch model.content {
            case .text:
                TextPreview(model: model, fontSize: CGFloat(settings?.codeFontSize ?? 12), wrap: settings?.wordWrap ?? false)
            case .image(let mimeType, let data):
                if let image = model.image {
                    ScrollView([.vertical, .horizontal]) {
                        Image(nsImage: image)
                            .resizable()
                            .interpolation(.high)
                            .scaledToFit()
                            .frame(maxWidth: image.size.width, maxHeight: image.size.height)
                            .padding(20)
                    }
                    .defaultScrollAnchor(.center)
                    .overlay(alignment: .bottomTrailing) {
                        Text("\(Int(image.size.width)) × \(Int(image.size.height)) · \(ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file))")
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.secondaryText)
                            .padding(10)
                    }
                } else {
                    PanelMessage(symbol: "photo", title: "This image can’t be displayed.", detail: mimeType)
                }
            case .binary(let size):
                PanelMessage(symbol: "doc", title: "Binary file", detail: "\(ByteCountFormatter.string(fromByteCount: Int64(clamping: size), countStyle: .file)) · not shown as text.", actionTitle: "Open in Default App") {
                    NSWorkspace.shared.open(absolute)
                }
            case .tooLarge(let size):
                PanelMessage(symbol: "doc", title: "File too large to preview", detail: "\(ByteCountFormatter.string(fromByteCount: Int64(clamping: size), countStyle: .file)) exceeds the 2 MB preview limit.", actionTitle: "Open in Default App") {
                    NSWorkspace.shared.open(absolute)
                }
            case nil:
                PanelMessage(symbol: "doc", title: "Empty file")
            }
        }
    }
}

private struct PathLabel: View {
    let relative: String

    var body: some View {
        let directory = (relative as NSString).deletingLastPathComponent
        HStack(spacing: 0) {
            if !directory.isEmpty {
                Text(directory + "/")
                    .foregroundStyle(Theme.secondaryText)
            }
            Text((relative as NSString).lastPathComponent)
                .fontWeight(.medium)
        }
        .font(.system(size: 12.5))
        .lineLimit(1)
        .truncationMode(.head)
        .help(relative)
    }
}

private struct TextPreview: View {
    let model: FilePreviewModel
    let fontSize: CGFloat
    let wrap: Bool
    @State private var viewport: CGFloat = 0

    var body: some View {
        let digits = max(3, String(model.lines.count).count)
        let gutter = CGFloat(digits) * fontSize * 0.62 + 18
        ScrollViewReader { proxy in
            ScrollView(wrap ? [.vertical] : [.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(model.lines.indices, id: \.self) { index in
                        let line = model.lines[index]
                        HStack(alignment: .top, spacing: 0) {
                            Text("\(index + 1)")
                                .foregroundStyle(Theme.secondaryText)
                                .monospacedDigit()
                                .padding(.trailing, 10)
                                .frame(width: gutter, alignment: .trailing)
                            Text(verbatim: line.isEmpty ? " " : line)
                                .lineLimit(wrap ? nil : 1)
                                .fixedSize(horizontal: !wrap, vertical: true)
                                .textSelection(.enabled)
                                .padding(.trailing, 12)
                        }
                        .font(.system(size: fontSize, design: .monospaced))
                        .padding(.vertical, 1)
                        .frame(minWidth: wrap ? nil : viewport, maxWidth: wrap ? .infinity : nil, alignment: .leading)
                        .background(model.line.map { Int($0) == index + 1 } == true ? Theme.selection : .clear)
                    }
                }
                .padding(.vertical, 8)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { viewport = $0 }
            .onAppear { scroll(proxy) }
            .onChange(of: model.revealCount) { scroll(proxy) }
        }
    }

    private func scroll(_ proxy: ScrollViewProxy) {
        guard let line = model.line else { return }
        proxy.scrollTo(max(Int(line) - 1, 0), anchor: .center)
    }
}
