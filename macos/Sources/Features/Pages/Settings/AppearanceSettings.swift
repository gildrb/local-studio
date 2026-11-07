import AppKit
import LocalStudioKit
import SwiftUI

struct AppearanceSettings: View {
    let pages: PagesStore

    var body: some View {
        if let settings = pages.settings {
            AppearanceForm(settings: settings, pages: pages)
        } else {
            SettingsLoading()
        }
    }
}

private struct AppearanceForm: View {
    let settings: LocalStudioKit.Settings
    let pages: PagesStore
    @State private var contrastDraft: Double?
    @State private var glassDraft: Double?
    @State private var importError: String?

    private var bind: SettingsBinder { SettingsBinder(settings: settings, pages: pages) }

    var body: some View {
        SettingsForm {
            SettingsSection(.theme) {
                SettingRow(.colorScheme) {
                    HStack(spacing: 18) {
                        Spacer(minLength: 0)
                        ForEach(SchemeChoice.allCases, id: \.self) { choice in
                            SchemeTile(choice: choice, selected: settings.colorScheme == choice.scheme) {
                                pages.update { $0.colorScheme = choice.scheme }
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 6)
                }
                SettingRow(.themes) {
                    ThemeGrid(pages: pages, selected: ThemeStore.shared.activeId)
                    HStack {
                        Button("Import Theme…") { importError = pages.importTheme() }
                        Spacer()
                        Button("New Theme…") { ThemeEditorWindow.shared.open(pages: pages, source: ThemeStore.shared.active) }
                        Button(ThemeStore.shared.editorOpen ? "Close Theme Editor" : "Open Theme Editor") {
                            ThemeEditorWindow.shared.toggle(pages: pages)
                        }
                    }
                    if let importError {
                        Text(importError)
                            .font(.callout)
                            .foregroundStyle(Theme.danger)
                    }
                }
            }
            SettingsSection(.interface) {
                SettingRow(.contrast) {
                    LabeledContent(SettingKey.contrast.title) {
                        HStack(spacing: 10) {
                            Slider(
                                value: Binding(
                                    get: { contrastDraft ?? Double(settings.contrast) },
                                    set: { contrastDraft = $0 }
                                ),
                                in: 50...200,
                                step: 10
                            ) { editing in
                                guard !editing, let value = contrastDraft else { return }
                                contrastDraft = nil
                                pages.update { $0.contrast = UInt32(value) }
                            }
                            .frame(width: 180)
                            Text("\(Int(contrastDraft ?? Double(settings.contrast)))%")
                                .monospacedDigit()
                                .foregroundStyle(Theme.secondaryText)
                                .frame(width: 44, alignment: .trailing)
                        }
                    }
                }
                SettingRow(.glassOpacity) {
                    LabeledContent {
                        HStack(spacing: 10) {
                            Slider(
                                value: Binding(get: { glassDraft ?? Double(settings.glassOpacity) }, set: { glassDraft = $0 }),
                                in: 0...100,
                                step: 5
                            ) { editing in
                                guard !editing, let value = glassDraft else { return }
                                glassDraft = nil
                                pages.update { $0.glassOpacity = UInt32(value) }
                            }
                            .frame(width: 180)
                            Text("\(Int(glassDraft ?? Double(settings.glassOpacity)))%")
                                .monospacedDigit()
                                .foregroundStyle(Theme.secondaryText)
                                .frame(width: 44, alignment: .trailing)
                        }
                    } label: {
                        Text(SettingKey.glassOpacity.title)
                        Text("Opacity of floating surfaces such as the command palette and notices.")
                            .font(.callout)
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                SettingRow(.diffColors) {
                    Picker(SettingKey.diffColors.title, selection: bind(\.diffColors)) {
                        Text("Red and green").tag(DiffColors.redGreen)
                        Text("Blue and orange").tag(DiffColors.blueOrange)
                    }
                }
                SettingRow(.chatWidth) {
                    Picker(SettingKey.chatWidth.title, selection: bind(\.chatWidth)) {
                        Text("Normal").tag(ChatWidth.normal)
                        Text("Wide").tag(ChatWidth.wide)
                        Text("Full").tag(ChatWidth.full)
                    }
                }
                SettingRow(.openLinks) {
                    Picker(SettingKey.openLinks.title, selection: bind(\.openLinksIn)) {
                        Text("Default browser").tag(LinkTarget.system)
                        Text("Local Studio").tag(LinkTarget.app)
                    }
                }
            }
            SettingsSection(.typography, footer: "Sizes are in points. System uses the macOS interface font; monospaced lists show fixed-pitch families only.") {
                SettingRow(.interfaceFont) {
                    FontRow(title: SettingKey.interfaceFont.title, family: bind(\.interfaceFont), size: bind(\.interfaceFontSize), families: FontCatalog.all)
                }
                SettingRow(.promptFont) {
                    FontRow(title: SettingKey.promptFont.title, family: bind(\.promptFont), size: bind(\.promptFontSize), families: FontCatalog.all)
                }
                SettingRow(.codeFont) {
                    FontRow(title: SettingKey.codeFont.title, family: bind(\.codeFont), size: bind(\.codeFontSize), families: FontCatalog.monospaced)
                }
                SettingRow(.terminalFont) {
                    FontRow(title: SettingKey.terminalFont.title, family: bind(\.terminalFont), size: bind(\.terminalFontSize), families: FontCatalog.monospaced)
                }
                SettingRow(.terminalScrollback) {
                    Picker(SettingKey.terminalScrollback.title, selection: bind(\.terminalScrollback)) {
                        ForEach([UInt32(1_000), 10_000, 50_000, 100_000], id: \.self) { lines in
                            Text("\(lines.formatted()) lines").tag(lines)
                        }
                    }
                }
                SettingRow(.terminalCursorBlink) {
                    Toggle(SettingKey.terminalCursorBlink.title, isOn: bind(\.terminalCursorBlink))
                }
                SettingRow(.fontSmoothing) {
                    Toggle(isOn: bind(\.fontSmoothing)) {
                        Text(SettingKey.fontSmoothing.title)
                        Text("Turning it off draws thinner text. Takes effect the next time Local Studio opens.")
                    }
                }
                SettingRow(.wordWrap) {
                    Toggle(SettingKey.wordWrap.title, isOn: bind(\.wordWrap))
                }
            }
        }
    }
}

private enum SchemeChoice: CaseIterable {
    case system, light, dark

    var scheme: LocalStudioKit.ColorScheme {
        switch self {
        case .system: .system
        case .light: .light
        case .dark: .dark
        }
    }

    var title: String {
        switch self {
        case .system: "Automatic"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
}

private struct SchemeTile: View {
    let choice: SchemeChoice
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 7) {
                thumbnail
                    .frame(width: 84, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .strokeBorder(selected ? Theme.primary : Theme.selectionStroke, lineWidth: selected ? 2.5 : 1)
                            .padding(selected ? -3 : 0)
                    }
                Text(choice.title)
                    .font(.system(size: 11.5, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? .primary : Theme.secondaryText)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(choice.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    @ViewBuilder private var thumbnail: some View {
        switch choice {
        case .light: AppearanceMiniature(appearance: .aqua)
        case .dark: AppearanceMiniature(appearance: .darkAqua)
        case .system:
            ZStack {
                AppearanceMiniature(appearance: .aqua)
                AppearanceMiniature(appearance: .darkAqua)
                    .mask {
                        GeometryReader { proxy in
                            Path { path in
                                path.move(to: CGPoint(x: proxy.size.width, y: 0))
                                path.addLine(to: CGPoint(x: proxy.size.width, y: proxy.size.height))
                                path.addLine(to: CGPoint(x: 0, y: proxy.size.height))
                                path.closeSubpath()
                            }
                        }
                    }
            }
        }
    }
}

private struct AppearanceMiniature: NSViewRepresentable {
    let appearance: NSAppearance.Name

    func makeNSView(context: Context) -> NSHostingView<MiniatureWindow> {
        let view = NSHostingView(rootView: MiniatureWindow())
        view.appearance = NSAppearance(named: appearance)
        return view
    }

    func updateNSView(_ view: NSHostingView<MiniatureWindow>, context: Context) {
        view.appearance = NSAppearance(named: appearance)
    }
}

private struct MiniatureWindow: View {
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(0..<4, id: \.self) { index in
                    Capsule()
                        .fill(index == 1 ? Theme.selectionStroke : Theme.input)
                        .frame(width: index == 1 ? 18 : 14, height: 3)
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
            .padding(.leading, 6)
            .frame(width: 28, alignment: .leading)
            .frame(maxHeight: .infinity)
            .background(Theme.sidebar)
            Rectangle().fill(Theme.hairline).frame(width: 1)
            VStack(alignment: .trailing, spacing: 5) {
                Capsule().fill(Theme.message).frame(width: 26, height: 7)
                VStack(alignment: .leading, spacing: 3) {
                    Capsule().fill(Theme.input).frame(width: 36, height: 3)
                    Capsule().fill(Theme.input).frame(width: 28, height: 3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: 0)
                Capsule().fill(Theme.primary).frame(width: 9, height: 5)
            }
            .padding(6)
            .padding(.top, 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
        }
    }
}

private struct FontRow: View {
    let title: String
    @Binding var family: String
    @Binding var size: UInt32
    let families: [String]

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 8) {
                Picker(title, selection: $family) {
                    Text("System").tag("")
                    Divider()
                    if !family.isEmpty, !families.contains(family) {
                        Text(family).tag(family)
                    }
                    ForEach(families, id: \.self) { name in
                        Text(name).tag(name)
                    }
                }
                .labelsHidden()
                .frame(width: 170)
                Stepper(value: $size, in: 9...32) {
                    Text("\(size) pt")
                        .monospacedDigit()
                        .foregroundStyle(Theme.secondaryText)
                        .frame(width: 40, alignment: .trailing)
                }
            }
        }
    }
}

@MainActor
enum FontCatalog {
    static let all: [String] = NSFontManager.shared.availableFontFamilies.filter { !$0.hasPrefix(".") }

    static let monospaced: [String] = {
        let names = NSFontManager.shared.availableFontNames(with: .fixedPitchFontMask) ?? []
        let families = Set(names.compactMap { NSFont(name: $0, size: 12)?.familyName })
        return families.filter { !$0.hasPrefix(".") }.sorted()
    }()
}
