import AppKit

if CommandLine.arguments.contains("--smoke") {
	runSmoke()
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
