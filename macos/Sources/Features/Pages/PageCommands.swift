import AppKit

@MainActor
enum PageCommands {
    private static let owner = CommandOwner()

    static func install(_ store: StudioStore) {
        SnapShotService.shared.studio = store
        let pages = store.pages
        store.commands.register(
            "theme.select", owner: owner,
            enabled: { pages.settings != nil },
            perform: { ThemePickerWindow.shared.toggle(pages: pages) }
        )
        store.commands.register(
            "themeEditor.toggle", owner: owner,
            enabled: { pages.settings != nil },
            perform: { ThemeEditorWindow.shared.toggle(pages: pages) }
        )
        store.commands.register(
            "snapshot.capture", owner: owner,
            enabled: { pages.settings?.snapshotEnabled == true },
            perform: { SnapShotService.shared.capture(.window) }
        )
    }
}
