import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
	private var window: NSWindow?

	func applicationDidFinishLaunching(_ notification: Notification) {
		let content = NSHostingController(rootView: LocalStudioRootView())
		let window = NSWindow(
			contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
			styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
			backing: .buffered,
			defer: false
		)
		window.title = "Local Studio"
		window.titlebarAppearsTransparent = true
		window.titleVisibility = .hidden
		window.isMovableByWindowBackground = false
		window.contentView = content.view
		window.center()
		window.makeKeyAndOrderFront(nil)
		self.window = window
		NSApp.activate(ignoringOtherApps: true)
	}

	func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
		true
	}
}
