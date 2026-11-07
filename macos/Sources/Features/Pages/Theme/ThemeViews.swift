import AppKit
import LocalStudioKit
import SwiftUI

struct ThemeGrid: View {
    let pages: PagesStore
    let selected: String
    @Environment(\.colorScheme) private var scheme

    private let columns = [GridItem(.adaptive(minimum: 132, maximum: 180), spacing: 12)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
            ForEach(ThemeStore.shared.themes) { theme in
                ThemeCard(theme: theme, appearance: scheme == .dark ? .dark : .light, selected: theme.id == selected) {
                    pages.selectTheme(theme.id)
                }
                .contextMenu {
                    Button(ThemeStore.shared.isCustom(theme.id) ? "Edit…" : "Duplicate and Edit…") {
                        ThemeEditorWindow.shared.open(pages: pages, source: theme)
                    }
                    Button("Export…") { pages.exportTheme(theme) }
                    if ThemeStore.shared.isCustom(theme.id) {
                        Divider()
                        Button("Delete Theme", role: .destructive) { pages.removeTheme(theme.id) }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

struct ThemeCard: View {
    let theme: ThemeDefinition
    let appearance: ThemeAppearance
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                ThemeSwatch(palette: ThemeStore.preview(theme, appearance))
                    .frame(height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(selected ? Theme.primary : Theme.selectionStroke, lineWidth: selected ? 2 : 1)
                    }
                HStack(spacing: 4) {
                    Text(theme.label)
                        .font(.system(size: 12, weight: selected ? .semibold : .regular))
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    if theme.modes.count == 1, let only = theme.modes.first {
                        Text(only == .light ? "Light only" : "Dark only")
                            .font(.system(size: 10.5))
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(theme.label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct ThemeSwatch: View {
    let palette: ThemePalette

    private func color(_ token: ThemeToken) -> Color {
        Color(nsColor: palette[token].nsColor)
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Capsule()
                        .fill(index == 0 ? color(.selection) : color(.hairline))
                        .frame(width: index == 0 ? 22 : 16, height: 4)
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 9)
            .padding(.leading, 6)
            .frame(width: 34, alignment: .leading)
            .frame(maxHeight: .infinity)
            .background(color(.sidebar))
            VStack(alignment: .trailing, spacing: 5) {
                Capsule().fill(color(.message)).frame(width: 34, height: 9)
                VStack(alignment: .leading, spacing: 3) {
                    Capsule().fill(color(.text)).frame(width: 46, height: 3)
                    Capsule().fill(color(.secondaryText)).frame(width: 32, height: 3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Spacer(minLength: 0)
                Circle().fill(color(.primary)).frame(width: 10, height: 10)
            }
            .padding(7)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(color(.canvas))
        }
    }
}

extension ThemeStore {
    static func preview(_ theme: ThemeDefinition, _ appearance: ThemeAppearance) -> ThemePalette {
        if theme.id == ThemeLibrary.defaultId { return LegacyPalette.palette(appearance) }
        let mode = theme.colors(for: appearance) == nil ? theme.appearance : appearance
        return resolve(theme, mode)
    }
}

struct ThemePickerView: View {
    let pages: PagesStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ThemeGrid(pages: pages, selected: ThemeStore.shared.activeId)
                HStack {
                    Button("Import Theme…") { _ = pages.importTheme() }
                    Spacer()
                    Button("Edit Theme…") { ThemeEditorWindow.shared.open(pages: pages) }
                }
            }
            .padding(14)
        }
        .frame(minWidth: 480, minHeight: 300)
        .background(Theme.canvas)
        .themeRoot()
    }
}

@MainActor
final class ThemePickerWindow {
    static let shared = ThemePickerWindow()
    private var panel: NSPanel?

    func toggle(pages: PagesStore) {
        if let panel, panel.isVisible {
            panel.close()
            return
        }
        let panel = self.panel ?? NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 380),
            styleMask: [.titled, .closable, .resizable, .utilityWindow],
            backing: .buffered, defer: false
        )
        panel.title = "Themes"
        panel.isFloatingPanel = true
        panel.isReleasedWhenClosed = false
        panel.contentView = NSHostingView(rootView: ThemePickerView(pages: pages))
        if self.panel == nil { panel.center() }
        self.panel = panel
        panel.makeKeyAndOrderFront(nil)
    }
}
