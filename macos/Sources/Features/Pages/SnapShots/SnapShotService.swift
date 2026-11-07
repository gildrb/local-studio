import AppKit
import ApplicationServices
import Carbon.HIToolbox
import LocalStudioKit
import ScreenCaptureKit

enum SnapShotMode {
    case window
    case region
}

@MainActor
final class SnapShotService {
    static let shared = SnapShotService()

    weak var studio: StudioStore?
    private(set) var lastError: String?
    private var settings: LocalStudioKit.Settings?
    private var registered: String?
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private var flash: NSWindow?
    private var capturing = false

    var permitted: Bool { CGPreflightScreenCaptureAccess() }

    func update(settings: LocalStudioKit.Settings?, keybindings: [Keybinding]) {
        self.settings = settings
        let shortcut = settings?.snapshotEnabled == true ? keybindings.first { $0.command == "snapshot.capture" }?.shortcut : nil
        guard shortcut != registered else { return }
        unregister()
        if let shortcut, register(shortcut) {
            registered = shortcut
        }
    }

    func requestPermission() {
        if !CGRequestScreenCaptureAccess(), let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
    }

    func capture(_ mode: SnapShotMode) {
        guard !capturing else { return }
        guard permitted else {
            CGRequestScreenCaptureAccess()
            studio?.post(.warning, "SnapShots need Screen Recording access. Allow Local Studio in System Settings › Privacy & Security › Screen Recording, then try again.")
            return
        }
        capturing = true
        Task {
            defer { capturing = false }
            do {
                let shot: Shot? = switch mode {
                case .window: try await windowShot()
                case .region: try await regionShot()
                }
                guard let shot else { return }
                deliver(shot)
            } catch {
                lastError = error.localizedDescription
                studio?.post(.error, "SnapShot failed: \(error.localizedDescription)")
            }
        }
    }

    private struct Shot {
        let png: Data
        let frame: CGRect?
        let app: String?
        let title: String?
        let pid: pid_t?
    }

    private func windowShot() async throws -> Shot? {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        let own = ProcessInfo.processInfo.processIdentifier
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let candidates = content.windows.filter { window in
            window.windowLayer == 0 && window.isOnScreen && window.frame.width > 80 && window.frame.height > 60
                && window.owningApplication?.processID != own
        }
        guard let window = candidates.first(where: { $0.owningApplication?.processID == front }) ?? candidates.first else {
            studio?.post(.info, "There is no other app window on screen to capture.")
            return nil
        }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let configuration = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        configuration.width = Int(window.frame.width * scale)
        configuration.height = Int(window.frame.height * scale)
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        guard let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { return nil }
        return Shot(png: png, frame: window.frame, app: window.owningApplication?.applicationName, title: window.title, pid: window.owningApplication?.processID)
    }

    private func regionShot() async throws -> Shot? {
        let url = FileManager.default.temporaryDirectory.appending(path: "local-studio-snapshot-\(UUID().uuidString).png")
        let process = Process()
        process.executableURL = URL(filePath: "/usr/sbin/screencapture")
        process.arguments = ["-i", "-x", url.path(percentEncoded: false)]
        try process.run()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            process.terminationHandler = { _ in continuation.resume() }
        }
        defer { try? FileManager.default.removeItem(at: url) }
        guard let png = try? Data(contentsOf: url), !png.isEmpty else { return nil }
        return Shot(png: png, frame: nil, app: nil, title: nil, pid: nil)
    }

    private func deliver(_ shot: Shot) {
        guard let studio else { return }
        let settings = settings
        if settings?.snapshotPlaySound ?? true {
            sound(settings?.snapshotSound ?? .softPop)?.play()
        }
        if settings?.snapshotFlash ?? true, let frame = shot.frame {
            flashOver(frame, animated: settings?.snapshotAnimations ?? true)
        }
        let conversation = studio.conversation
        let project = conversation.thread == nil ? studio.inbox.currentProject : conversation.info?.project
        let draft = conversation.composer(project: project)
        draft.attach(image: shot.png, mimeType: "image/png")
        if settings?.snapshotIncludeText ?? true, let context = context(for: shot) {
            draft.text = draft.text.isEmpty ? context : draft.text + "\n\n" + context
        }
        studio.shell.route = .thread
        NSApp.activate()
        NSApp.windows.first { $0.identifier?.rawValue == "main" || $0.title == "Local Studio" }?.makeKeyAndOrderFront(nil)
    }

    private func context(for shot: Shot) -> String? {
        guard let app = shot.app else { return nil }
        var lines = ["SnapShot of \(app)" + (shot.title.map { $0.isEmpty ? "" : " — \($0)" } ?? "")]
        if let pid = shot.pid, AXIsProcessTrusted() {
            let text = Self.accessibilityText(pid: pid)
            if !text.isEmpty {
                lines.append("Visible text:\n```\n\(text)\n```")
            }
        }
        return lines.joined(separator: "\n")
    }

    private static func accessibilityText(pid: pid_t) -> String {
        let app = AXUIElementCreateApplication(pid)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused) == .success,
              let window = focused, CFGetTypeID(window) == AXUIElementGetTypeID() else { return "" }
        var pieces: [String] = []
        var budget = 4000
        func walk(_ element: AXUIElement, depth: Int) {
            guard depth < 12, budget > 0 else { return }
            for attribute in [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] {
                var value: CFTypeRef?
                if AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success, let text = value as? String {
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty, pieces.last != trimmed {
                        pieces.append(String(trimmed.prefix(budget)))
                        budget -= trimmed.count
                    }
                }
            }
            var children: CFTypeRef?
            guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
                  let list = children as? [AXUIElement] else { return }
            for child in list.prefix(200) {
                walk(child, depth: depth + 1)
            }
        }
        walk(unsafeDowncast(window, to: AXUIElement.self), depth: 0)
        return pieces.joined(separator: "\n")
    }

    private func sound(_ choice: SnapshotSound) -> NSSound? {
        switch choice {
        case .softPop:
            return NSSound(named: "Pop")
        case .cameraShutter:
            let shutter = "/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Grab.aif"
            return NSSound(contentsOfFile: shutter, byReference: true) ?? NSSound(named: "Tink")
        }
    }

    private func flashOver(_ frame: CGRect, animated: Bool) {
        guard let screen = NSScreen.screens.first else { return }
        let rect = NSRect(x: frame.minX, y: screen.frame.maxY - frame.maxY, width: frame.width, height: frame.height)
        flash?.orderOut(nil)
        let window = NSWindow(contentRect: rect, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = NSColor.white.withAlphaComponent(0.85)
        window.level = .screenSaver
        window.ignoresMouseEvents = true
        window.isReleasedWhenClosed = false
        window.orderFrontRegardless()
        flash = window
        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.28
                window.animator().alphaValue = 0
            } completionHandler: { [weak self] in
                Task { @MainActor in self?.removeFlash(window) }
            }
        } else {
            Task {
                try? await Task.sleep(for: .milliseconds(120))
                removeFlash(window)
            }
        }
    }

    private func removeFlash(_ window: NSWindow) {
        window.orderOut(nil)
        if flash === window { flash = nil }
    }

    private func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = nil
        registered = nil
    }

    private func register(_ shortcut: String) -> Bool {
        let (modifiers, key) = ShortcutFormat.parse(shortcut)
        guard let code = Self.keyCodes[key] else { return false }
        var flags: UInt32 = 0
        if modifiers.contains("cmd") { flags |= UInt32(cmdKey) }
        if modifiers.contains("option") { flags |= UInt32(optionKey) }
        if modifiers.contains("shift") { flags |= UInt32(shiftKey) }
        if modifiers.contains("ctrl") { flags |= UInt32(controlKey) }
        if handler == nil {
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
                DispatchQueue.main.async {
                    SnapShotService.shared.capture(.window)
                }
                return noErr
            }, 1, &spec, nil, &handler)
        }
        let identifier = EventHotKeyID(signature: OSType(0x4C53_5348), id: 1)
        return RegisterEventHotKey(UInt32(code), flags, identifier, GetApplicationEventTarget(), 0, &hotKey) == noErr
    }

    private static let keyCodes: [String: Int] = [
        "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E, "f": kVK_ANSI_F, "g": kVK_ANSI_G,
        "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L, "m": kVK_ANSI_M, "n": kVK_ANSI_N,
        "o": kVK_ANSI_O, "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R, "s": kVK_ANSI_S, "t": kVK_ANSI_T, "u": kVK_ANSI_U,
        "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X, "y": kVK_ANSI_Y, "z": kVK_ANSI_Z,
        "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4, "5": kVK_ANSI_5, "6": kVK_ANSI_6,
        "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9, "-": kVK_ANSI_Minus, "=": kVK_ANSI_Equal, "[": kVK_ANSI_LeftBracket,
        "]": kVK_ANSI_RightBracket, ";": kVK_ANSI_Semicolon, "'": kVK_ANSI_Quote, ",": kVK_ANSI_Comma, ".": kVK_ANSI_Period,
        "/": kVK_ANSI_Slash, "space": kVK_Space, "return": kVK_Return, "tab": kVK_Tab, "escape": kVK_Escape,
    ]
}
