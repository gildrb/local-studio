import SwiftUI

@main
struct LocalStudioApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("Local Studio", id: "main") {
            RootView(store: appDelegate.store)
                .frame(minWidth: 760, minHeight: 480)
        }
        .windowToolbarStyle(.unified(showsTitle: false))
        .defaultSize(width: 1280, height: 820)
        .defaultLaunchBehavior(.presented)
        .restorationBehavior(.disabled)
        .commands {
            StudioCommands(store: appDelegate.store, refresh: appDelegate.commandRefresh)
        }
        Settings {
            SettingsSeam(store: appDelegate.store)
        }
    }
}
