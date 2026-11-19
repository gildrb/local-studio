import LocalStudioRemote
import SwiftUI
import UIKit

@main
struct LocalStudioApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var studio: StudioModel
    @State private var notifier: Notifier
    private let launch: LaunchOptions

    init() {
        _ = Perf.shared
        let launch = LaunchOptions()
        let environment = StudioEnvironment(
            directory: URL.applicationSupportDirectory.appendingPathComponent("LocalStudioRemote", isDirectory: true),
            keychainService: (Bundle.main.bundleIdentifier ?? "org.local.studio.ios") + ".remote",
            device: DeviceProfile(name: UIDevice.current.name, app: Channel.version, channel: Channel.current),
            connectDelay: .milliseconds(Int(launch.connectDelay * 1000)),
            passThrough: launch.passThrough
        )
        if launch.reset {
            environment.wipe()
        }
        let studio = StudioModel(environment: environment)
        let notifier = Notifier(askPermission: !launch.smoke)
        studio.onNotification = { machine, note in
            notifier.post(note, machine: machine.name)
        }
        if let text = launch.pairLink, studio.machines.isEmpty, let link = PairingLink(string: text, scheme: Channel.pairScheme) {
            studio.pair(link)
        }
        studio.start()
        self.launch = launch
        _studio = State(initialValue: studio)
        _notifier = State(initialValue: notifier)
    }

    var body: some Scene {
        WindowGroup {
            // No onOpenURL: a pairing link carries its secret, and iOS doesn't make a custom URL
            // scheme exclusive, so pairing happens only in the Pair sheet (docs/remote.md, Pairing).
            RootView(studio: studio, smoke: launch.smoke)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                studio.appBecameActive()
            }
        }
    }
}

struct LaunchOptions {
    let reset: Bool
    let smoke: Bool
    let pairLink: String?
    let connectDelay: Double
    let passThrough: Bool

    init(defaults: UserDefaults = .standard) {
        reset = defaults.bool(forKey: "LSReset")
        smoke = defaults.bool(forKey: "LSSmoke")
        pairLink = defaults.string(forKey: "LSPairLink")
        connectDelay = defaults.double(forKey: "LSConnectDelay")
        passThrough = defaults.bool(forKey: "LSPassThrough")
    }
}

enum Channel {
    static var current: String {
        Bundle.main.object(forInfoDictionaryKey: "LSChannel") as? String ?? "stable"
    }

    /// The scheme of this channel's pairing codes: `localstudio`, `localstudio-nightly` or `localstudio-dev`.
    static var pairScheme: String {
        Bundle.main.object(forInfoDictionaryKey: "LSPairScheme") as? String ?? "localstudio"
    }

    static var version: String {
        if let full = Bundle.main.object(forInfoDictionaryKey: "LSVersion") as? String, !full.isEmpty {
            return full
        }
        return Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }
}
