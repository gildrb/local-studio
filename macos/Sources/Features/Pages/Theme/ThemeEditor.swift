import AppKit
import LocalStudioKit
import Observation
import SwiftUI

struct ThemeRoleGroup: Identifiable {
    let title: String
    let roles: [(String, String)]

    var id: String { title }

    static let all: [ThemeRoleGroup] = [
        ThemeRoleGroup(title: "Surfaces", roles: [
            ("canvas", "Canvas"), ("sidebar", "Sidebar"), ("surface", "Cards"), ("surfaceOverlay", "Popovers"), ("messageSurface", "Message bubble"),
        ]),
        ThemeRoleGroup(title: "Lines and rows", roles: [
            ("border", "Hairlines"), ("input", "Fields and strokes"), ("sidebarRowHover", "Row hover"), ("sidebarRowActive", "Row selection"),
        ]),
        ThemeRoleGroup(title: "Text", roles: [
            ("text", "Text"), ("textMuted", "Secondary text"), ("iconMuted", "Icons"), ("placeholder", "Tertiary text"),
        ]),
        ThemeRoleGroup(title: "Accent and status", roles: [
            ("accent", "Accent"), ("warningForeground", "Warning"), ("errorForeground", "Error"),
        ]),
        ThemeRoleGroup(title: "Code", roles: [
            ("codeBackground", "Background"), ("syntaxDefault", "Text"), ("syntaxComment", "Comments"), ("syntaxKeyword", "Keywords"),
            ("syntaxOperator", "Operators"), ("syntaxString", "Strings"), ("syntaxFunction", "Functions"), ("syntaxType", "Types"),
            ("syntaxProperty", "Properties"), ("syntaxConstant", "Constants"), ("syntaxNumber", "Numbers"),
            ("syntaxParameter", "Parameters"), ("syntaxBuiltin", "Built-ins"), ("syntaxPunctuation", "Punctuation"),
        ]),
    ]
}

@MainActor
@Observable
final class ThemeEditorModel {
    var draft: ThemeDefinition {
        didSet { ThemeStore.shared.preview = draft }
    }
    var editing: ThemeAppearance
    let sourceId: String

    init(source: ThemeDefinition) {
        sourceId = source.id
        var seeded = source
        if source.id == ThemeLibrary.defaultId {
            seeded.id = ""
            seeded.label = "My Theme"
        }
        draft = seeded
        editing = NSApp?.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua && seeded.modes.contains(.light) ? .light : seeded.appearance
        ThemeStore.shared.preview = seeded
    }

    var editsCustom: Bool {
        ThemeStore.shared.isCustom(sourceId)
    }

    func value(_ role: String) -> RGBA {
        let colors = draft.colors(for: editing) ?? draft.colors
        let standard = ThemeLibrary.bundle?.standard[editing.rawValue] ?? [:]
        return (colors[role] ?? standard[role]).flatMap(ThemeColorParser.parse) ?? RGBA(red: 0, green: 0, blue: 0)
    }

    func set(_ role: String, _ color: RGBA) {
        var next = draft
        if editing == next.appearance {
            next.colors[role] = color.hex
        } else {
            var variants = next.variants ?? [:]
            var variant = variants[editing.rawValue] ?? next.colors
            variant[role] = color.hex
            variants[editing.rawValue] = variant
            next.variants = variants
        }
        draft = next
    }

    func addVariant(_ appearance: ThemeAppearance) {
        guard draft.colors(for: appearance) == nil else { return }
        var next = draft
        var variants = next.variants ?? [:]
        variants[appearance.rawValue] = ThemeLibrary.bundle?.standard[appearance.rawValue] ?? next.colors
        next.variants = variants
        draft = next
        editing = appearance
    }

    func finished() -> ThemeDefinition {
        var theme = draft
        let taken = Set(ThemeStore.shared.themes.map(\.id))
        if theme.id.isEmpty || !editsCustom {
            theme.id = ThemeLibrary.identifier(for: theme.label, taken: taken)
            if !editsCustom, sourceId != ThemeLibrary.defaultId, theme.label == ThemeStore.shared.themes.first(where: { $0.id == sourceId })?.label {
                theme.label += " Copy"
            }
        }
        return theme
    }
}

struct ThemeEditorView: View {
    let pages: PagesStore
    @Bindable var model: ThemeEditorModel
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    TextField("Name", text: $model.draft.label)
                    Picker("Editing", selection: $model.editing) {
                        ForEach(model.draft.modes, id: \.self) { mode in
                            Text(mode == .light ? "Light" : "Dark").tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    ForEach(ThemeAppearance.allCases.filter { !model.draft.modes.contains($0) }, id: \.self) { mode in
                        Button(mode == .light ? "Add a Light Variant" : "Add a Dark Variant") { model.addVariant(mode) }
                    }
                } footer: {
                    Text("Changes preview live across Local Studio. Save to keep them as a theme.")
                        .font(.callout)
                        .foregroundStyle(Theme.secondaryText)
                }
                ForEach(ThemeRoleGroup.all) { group in
                    Section(group.title) {
                        ForEach(group.roles, id: \.0) { role, title in
                            RoleColorRow(title: title, color: model.value(role)) { model.set(role, $0) }
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            Divider()
            HStack {
                Button("Export…") { pages.exportTheme(model.finished()) }
                Spacer()
                Button("Discard", role: .cancel, action: close)
                Button(model.editsCustom ? "Save" : "Save as New Theme") {
                    pages.installTheme(model.finished(), select: true)
                    close()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.draft.label.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(12)
        }
        .frame(minWidth: 340, idealWidth: 360, minHeight: 520)
        .background(Theme.canvas)
        .transaction { $0.disablesAnimations = true }
    }
}

private struct RoleColorRow: View {
    let title: String
    let color: RGBA
    let set: (RGBA) -> Void

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 8) {
                Text(color.hex)
                    .font(.system(size: 11.5, design: .monospaced))
                    .foregroundStyle(Theme.secondaryText)
                ColorPicker(title, selection: Binding(
                    get: { Color(nsColor: color.nsColor) },
                    set: { next in
                        if let value = RGBA(NSColor(next)) { set(RGBA(red: value.red, green: value.green, blue: value.blue)) }
                    }
                ), supportsOpacity: false)
                .labelsHidden()
            }
        }
    }
}

@MainActor
final class ThemeEditorWindow: NSObject, NSWindowDelegate {
    static let shared = ThemeEditorWindow()
    private var panel: NSPanel?

    var isOpen: Bool { panel != nil }

    func toggle(pages: PagesStore, source: ThemeDefinition? = nil) {
        if panel != nil {
            panel?.close()
            return
        }
        open(pages: pages, source: source)
    }

    func open(pages: PagesStore, source: ThemeDefinition? = nil) {
        panel?.close()
        let model = ThemeEditorModel(source: source ?? ThemeStore.shared.active)
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 640),
            styleMask: [.titled, .closable, .resizable, .utilityWindow],
            backing: .buffered, defer: false
        )
        panel.title = "Theme Editor"
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        panel.contentView = NSHostingView(rootView: ThemeEditorView(pages: pages, model: model) { [weak panel] in panel?.close() }.themeRoot())
        if let main = NSApp.mainWindow {
            panel.setFrameTopLeftPoint(NSPoint(x: main.frame.maxX - 380, y: main.frame.maxY - 60))
        } else {
            panel.center()
        }
        self.panel = panel
        ThemeStore.shared.setEditorOpen(true)
        panel.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        panel = nil
        ThemeStore.shared.preview = nil
        ThemeStore.shared.setEditorOpen(false)
    }
}
