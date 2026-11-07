import AppKit
import LocalStudioKit
import SwiftUI

struct DiffSurfaceView: View {
    @Bindable var model: DiffModel
    let panels: PanelState

    var body: some View {
        let settings = panels.settings
        VStack(spacing: 0) {
            toolbar(settings)
            content(settings)
        }
        .onChange(of: settings?.hideWhitespace) { model.load() }
        .onChange(of: settings?.diffFilesCollapsed) { _, collapsed in
            if let collapsed {
                model.setCollapseDefault(collapsed)
            }
        }
        .onChange(of: panels.gitStatus(model.project)) {
            if model.scope == .workingTree || model.scope == .branch {
                model.load()
            }
        }
        .onChange(of: panels.settledTurns.first) {
            if model.scope == .latestTurn {
                model.load()
            }
        }
    }

    private func toolbar(_ settings: LocalStudioKit.Settings?) -> some View {
        PanelToolbar {
            Picker("Scope", selection: $model.scope) {
                Text("Working tree").tag(DiffScopeChoice.workingTree)
                Text("Branch changes").tag(DiffScopeChoice.branch)
                if model.thread != nil {
                    Divider()
                    Text("Latest turn").tag(DiffScopeChoice.latestTurn)
                    ForEach(panels.settledTurns, id: \.self) { turn in
                        Text("Turn \(turn)").tag(DiffScopeChoice.turn(turn))
                    }
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .fixedSize()
            .controlSize(.small)
            if model.scope == .branch {
                Menu {
                    Button("Automatic") { model.base = nil }
                    if !model.branches.isEmpty {
                        Divider()
                    }
                    ForEach(model.branches, id: \.name) { branch in
                        Button(branch.name) { model.base = branch.name }
                    }
                } label: {
                    Text(model.base.map { "vs \($0)" } ?? "vs default branch")
                }
                .fixedSize()
                .controlSize(.small)
                .onAppear { model.loadBranches() }
            }
            Spacer(minLength: 4)
            if !model.files.isEmpty {
                PanelDiffStat(additions: model.additions, deletions: model.deletions, colors: settings?.diffColors)
                Text("\(model.files.count) \(model.files.count == 1 ? "file" : "files")")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.secondaryText)
            }
            PanelIconButton(model.layout == .split ? "Stacked Layout" : "Split Layout", symbol: model.layout == .split ? "rectangle" : "rectangle.split.2x1") {
                model.layout = model.layout == .split ? .stacked : .split
            }
            PanelIconButton(model.allCollapsed ? "Expand All Files" : "Collapse All Files", symbol: model.allCollapsed ? "chevron.down" : "chevron.up", enabled: !model.files.isEmpty) {
                model.setAllCollapsed(!model.allCollapsed)
            }
            PanelIconButton("Refresh", symbol: "arrow.clockwise") { model.load() }
            PanelMenuButton(title: "Diff Options", symbol: "ellipsis") {
                Toggle("Hide Whitespace Changes", isOn: Binding(
                    get: { settings?.hideWhitespace ?? true },
                    set: { value in panels.updateSettings { $0.hideWhitespace = value } }
                ))
                .disabled(settings == nil)
                Toggle("Word Wrap", isOn: $model.wrap)
                    .disabled(model.layout == .split)
                Divider()
                Picker("Layout", selection: $model.layout) {
                    Text("Stacked").tag(DiffLayout.stacked)
                    Text("Split").tag(DiffLayout.split)
                }
                .pickerStyle(.inline)
            }
        }
    }

    @ViewBuilder
    private func content(_ settings: LocalStudioKit.Settings?) -> some View {
        if !panels.isGit(model.project) {
            PanelMessage(symbol: "plus.forwardslash.minus", title: "This project is not a git repository.")
        } else if case .failed(let message) = model.phase, model.files.isEmpty {
            PanelMessage(symbol: "exclamationmark.triangle", title: "Couldn’t load the diff.", detail: message, actionTitle: "Try Again") { model.load() }
        } else if model.files.isEmpty {
            switch model.phase {
            case .idle, .loading:
                PanelMessage(symbol: "clock", title: "Loading changes…")
            case .loaded, .failed:
                PanelMessage(symbol: "checkmark.circle", title: model.emptyMessage)
            }
        } else {
            DiffList(model: model, palette: PanelPalette.diff(settings?.diffColors), fontSize: CGFloat(settings?.codeFontSize ?? 12), panels: panels)
        }
    }
}

struct DiffList: View {
    let model: DiffModel
    let palette: PanelPalette.Diff
    let fontSize: CGFloat
    let panels: PanelState?
    @State private var viewport: CGFloat = 0

    var body: some View {
        let wrap = model.wrap || model.layout == .split
        let metrics = DiffMetrics(fontSize: fontSize, digits: model.gutterDigits)
        ScrollView(wrap ? [.vertical] : [.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                ForEach(model.sections) { section in
                    Section {
                        ForEach(section.rows) { row in
                            DiffRowView(row: row, palette: palette, metrics: metrics, wrap: wrap)
                                .frame(minWidth: wrap ? nil : viewport, maxWidth: wrap ? .infinity : nil, alignment: .leading)
                        }
                    } header: {
                        DiffFileHeaderView(header: section.header, palette: palette, project: model.project, panels: panels) {
                            model.toggle(section.header.path)
                        }
                        .frame(minWidth: wrap ? nil : viewport, maxWidth: wrap ? .infinity : nil)
                    }
                }
            }
            .padding(.bottom, 12)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { viewport = $0 }
    }
}

struct DiffMetrics {
    let fontSize: CGFloat
    let digits: Int

    var font: Font {
        .system(size: fontSize, design: .monospaced)
    }

    var gutter: CGFloat {
        CGFloat(digits) * fontSize * 0.62 + 14
    }
}

struct PanelDiffStat: View {
    let additions: UInt32
    let deletions: UInt32
    let colors: DiffColors?

    var body: some View {
        let palette = PanelPalette.diff(colors)
        HStack(spacing: 4) {
            Text("+\(additions)").foregroundStyle(palette.addedText)
            Text("−\(deletions)").foregroundStyle(palette.removedText)
        }
        .font(.system(size: 11.5, design: .monospaced))
        .monospacedDigit()
    }
}

private struct DiffFileHeaderView: View {
    let header: DiffFileHeader
    let palette: PanelPalette.Diff
    let project: String
    let panels: PanelState?
    let toggle: () -> Void
    @State private var hovering = false

    var body: some View {
        let directory = (header.path as NSString).deletingLastPathComponent
        let name = (header.path as NSString).lastPathComponent
        VStack(spacing: 0) {
            HStack(spacing: 7) {
                Image(systemName: header.collapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(Theme.secondaryText)
                    .frame(width: 12)
                    .accessibilityHidden(true)
                Text(statusLetter)
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(statusColor)
                    .frame(width: 12)
                    .accessibilityHidden(true)
                HStack(spacing: 0) {
                    if !directory.isEmpty {
                        Text(directory + "/")
                            .foregroundStyle(Theme.secondaryText)
                    }
                    Text(name)
                }
                .font(.system(size: 12))
                .lineLimit(1)
                .truncationMode(.head)
                if let old = header.oldPath, old != header.path {
                    Text("from \((old as NSString).lastPathComponent)")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                HStack(spacing: 4) {
                    Text("+\(header.additions)").foregroundStyle(palette.addedText)
                    Text("−\(header.deletions)").foregroundStyle(palette.removedText)
                }
                .font(.system(size: 11, design: .monospaced))
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(hovering ? Theme.hover : .clear)
            PanelHairline()
        }
        .background(Theme.card)
        .contentShape(Rectangle())
        .onTapGesture(perform: toggle)
        .onHover { hovering = $0 }
        .help(header.path)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(header.path)
        .accessibilityValue("\(header.status), \(header.additions) additions, \(header.deletions) deletions, \(header.collapsed ? "collapsed" : "expanded")")
        .accessibilityAction(named: header.collapsed ? "Expand" : "Collapse", toggle)
        .accessibilityAction { toggle() }
        .contextMenu {
            Button("Copy Path") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(header.path, forType: .string)
            }
            if let panels {
                Button("Open File") {
                    panels.openFile(project: project, relative: header.path, line: nil)
                }
                .disabled(header.status == "deleted")
            }
            Divider()
            Button(header.collapsed ? "Expand" : "Collapse", action: toggle)
        }
    }

    private var statusLetter: String {
        switch header.status {
        case "added": "A"
        case "deleted": "D"
        case "renamed": "R"
        case "copied": "C"
        default: "M"
        }
    }

    private var statusColor: Color {
        switch header.status {
        case "added": palette.addedText
        case "deleted": palette.removedText
        default: Theme.secondaryText
        }
    }
}

private struct DiffRowView: View {
    let row: DiffRow
    let palette: PanelPalette.Diff
    let metrics: DiffMetrics
    let wrap: Bool

    var body: some View {
        switch row.kind {
        case .hunk(let header):
            Text(header)
                .font(.system(size: metrics.fontSize - 0.5, design: .monospaced))
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
                .padding(.leading, metrics.gutter * 2 + 18)
                .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                .background(Theme.diffHunk)
        case .note(let text):
            Text(text)
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.secondaryText)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
        case .line(let kind, let old, let new, let text, let segments):
            HStack(alignment: .top, spacing: 0) {
                number(old, kind: kind)
                number(new, kind: kind)
                Text(sign(kind))
                    .foregroundStyle(textColor(kind))
                    .frame(width: 18)
                code(text, segments)
            }
            .font(metrics.font)
            .background(lineColor(kind))
        case .split(let left, let right):
            HStack(alignment: .top, spacing: 0) {
                cell(left)
                Rectangle().fill(Theme.hairline).frame(width: 1)
                cell(right)
            }
            .font(metrics.font)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func cell(_ cell: DiffCell?) -> some View {
        HStack(alignment: .top, spacing: 0) {
            if let cell {
                number(cell.number, kind: cell.kind)
                Text(sign(cell.kind))
                    .foregroundStyle(textColor(cell.kind))
                    .frame(width: 16)
                code(cell.text, cell.segments)
            } else {
                Color.clear
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(cell.map { lineColor($0.kind) } ?? Theme.diffHunk)
    }

    private func number(_ value: UInt32?, kind: DiffLineKind) -> some View {
        Text(value.map(String.init) ?? "")
            .foregroundStyle(Theme.secondaryText)
            .monospacedDigit()
            .lineLimit(1)
            .padding(.trailing, 7)
            .frame(width: metrics.gutter, alignment: .trailing)
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(.vertical, 1)
            .background(gutterColor(kind))
    }

    @ViewBuilder
    private func code(_ text: String, _ segments: [CodeSegment]) -> some View {
        if wrap {
            Text(SyntaxStyle.line(text, segments))
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 1)
                .padding(.trailing, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(SyntaxStyle.line(text, segments))
                .lineLimit(1)
                .fixedSize()
                .padding(.vertical, 1)
                .padding(.trailing, 10)
        }
    }

    private func sign(_ kind: DiffLineKind) -> String {
        switch kind {
        case .added: "+"
        case .removed: "−"
        case .context: " "
        }
    }

    private func textColor(_ kind: DiffLineKind) -> Color {
        switch kind {
        case .added: palette.addedText
        case .removed: palette.removedText
        case .context: Theme.secondaryText
        }
    }

    private func lineColor(_ kind: DiffLineKind) -> Color {
        switch kind {
        case .added: palette.addedLine
        case .removed: palette.removedLine
        case .context: .clear
        }
    }

    private func gutterColor(_ kind: DiffLineKind) -> Color {
        switch kind {
        case .added: palette.addedGutter
        case .removed: palette.removedGutter
        case .context: .clear
        }
    }
}
