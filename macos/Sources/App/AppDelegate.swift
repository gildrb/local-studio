import AppKit
import LocalStudioKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let store: StudioStore
    private var smoke: Smoke?
    private var conversationSmoke: ConversationSmoke?

    override init() {
        store = StudioStore(launch: Self.bundledDaemon())
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = CommandLine.arguments
        if let flag = arguments.firstIndex(of: "+snapshot") {
            let directory = arguments.indices.contains(flag + 1) ? arguments[flag + 1] : NSTemporaryDirectory() + "local-studio-snapshots"
            let filter = arguments.indices.contains(flag + 2) ? arguments[flag + 2] : nil
            exit(Snapshots.run(into: URL(fileURLWithPath: directory, isDirectory: true), matching: filter))
        }
        do {
            try store.start()
        } catch {
            NSAlert(error: error).runModal()
            NSApp.terminate(nil)
            return
        }
        if CommandLine.arguments.contains("+smoke") {
            let smoke = Smoke(store: store)
            smoke.start()
            self.smoke = smoke
        }
        if CommandLine.arguments.contains("+smoke-conversation") {
            let smoke = ConversationSmoke(store: store)
            smoke.start()
            conversationSmoke = smoke
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        store.stop()
    }

    func addProject() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Add Project"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        store.inbox.addProject(path: url.path)
    }

    private static func bundledDaemon() -> DaemonLaunch? {
        guard let url = Bundle.main.url(forAuxiliaryExecutable: "eukhe-daemon") else { return nil }
        return DaemonLaunch(program: url.path, arguments: ["supervisor"])
    }
}
