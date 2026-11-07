import ApplicationServices
import LocalStudioKit
import SwiftUI

struct SnapShotSettings: View {
    let pages: PagesStore
    let open: (SettingsPane) -> Void
    @State private var permitted = SnapShotService.shared.permitted
    @State private var trusted = AXIsProcessTrusted()

    var body: some View {
        if let settings = pages.settings {
            form(settings)
        } else {
            SettingsLoading()
        }
    }

    private func form(_ settings: LocalStudioKit.Settings) -> some View {
        let bind = SettingsBinder(settings: settings, pages: pages)
        let shortcut = pages.keybindings.first { $0.command == "snapshot.capture" }?.shortcut
        return SettingsForm {
            SettingsSection(.snapshotCapture, footer: "A SnapShot captures the frontmost window of another app and attaches it to the composer as an image, so you can ask about what you are looking at.") {
                SettingRow(.snapshotEnabled) {
                    Toggle(isOn: bind(\.snapshotEnabled)) {
                        Text(SettingKey.snapshotEnabled.title)
                        Text("Listens for the capture shortcut everywhere, even while Local Studio is in the background.")
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                SettingRow(.snapshotShortcut) {
                    LabeledContent(SettingKey.snapshotShortcut.title) {
                        HStack(spacing: 8) {
                            Text(shortcut.map { ShortcutFormat.display($0) } ?? "None")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .padding(.horizontal, 8)
                                .frame(minHeight: 22)
                                .background(Theme.input, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            Button("Change…") { open(.keybindings) }
                        }
                    }
                    .disabled(!settings.snapshotEnabled)
                }
                SettingRow(.snapshotIncludeText) {
                    Toggle(isOn: bind(\.snapshotIncludeText)) {
                        Text(SettingKey.snapshotIncludeText.title)
                        Text(trusted
                            ? "Adds the window's visible text from Accessibility to the prompt."
                            : "Adds the app and window name. Allow Accessibility access to include the window's visible text too.")
                            .foregroundStyle(Theme.secondaryText)
                    }
                    .disabled(!settings.snapshotEnabled)
                }
                SettingRow(.snapshotPermission) {
                    LabeledContent(SettingKey.snapshotPermission.title) {
                        HStack(spacing: 8) {
                            Circle().fill(permitted ? Theme.success : Theme.warning).frame(width: 7, height: 7)
                            Text(permitted ? "Allowed" : "Not allowed yet")
                                .foregroundStyle(Theme.secondaryText)
                            if !permitted {
                                Button("Allow…") {
                                    SnapShotService.shared.requestPermission()
                                    permitted = SnapShotService.shared.permitted
                                }
                            }
                        }
                    }
                    HStack {
                        Spacer()
                        Button("Capture Region…") { SnapShotService.shared.capture(.region) }
                        Button("Capture Window") { SnapShotService.shared.capture(.window) }
                    }
                    .disabled(!settings.snapshotEnabled)
                }
            }
            SettingsSection(.snapshotFeedback) {
                SettingRow(.snapshotSound) {
                    Toggle(SettingKey.snapshotSound.title, isOn: bind(\.snapshotPlaySound))
                    Picker("Sound", selection: bind(\.snapshotSound)) {
                        Text("Soft pop").tag(SnapshotSound.softPop)
                        Text("Camera shutter").tag(SnapshotSound.cameraShutter)
                    }
                    .disabled(!settings.snapshotPlaySound)
                }
                SettingRow(.snapshotFlash) {
                    Toggle(SettingKey.snapshotFlash.title, isOn: bind(\.snapshotFlash))
                }
                SettingRow(.snapshotAnimations) {
                    Toggle(isOn: bind(\.snapshotAnimations)) {
                        Text(SettingKey.snapshotAnimations.title)
                        Text("Fades the flash out instead of removing it at once.")
                            .foregroundStyle(Theme.secondaryText)
                    }
                    .disabled(!settings.snapshotFlash)
                }
            }
            .disabled(!settings.snapshotEnabled)
        }
        .onAppear {
            permitted = SnapShotService.shared.permitted
            trusted = AXIsProcessTrusted()
        }
    }
}
