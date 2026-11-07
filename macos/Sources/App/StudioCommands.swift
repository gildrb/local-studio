import SwiftUI

struct StudioCommands: Commands {
    let store: StudioStore

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Thread") { store.select(nil) }
                .keyboardShortcut("n")
        }
        SidebarCommands()
    }
}
