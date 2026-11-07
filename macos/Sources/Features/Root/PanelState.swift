import Foundation
import Observation

@MainActor
@Observable
final class PanelState {
    var rightPanelOpen = false
    var terminalOpen = false
    var rightPanelMaximized = false
    private(set) var liveAgentCount = 0
    var rightPanelWidth: CGFloat = 420
    var terminalHeight: CGFloat = 260

    func focus(_ thread: String?) {}

    func toggleRightPanel() {
        rightPanelOpen.toggle()
    }

    func toggleTerminal() {
        terminalOpen.toggle()
    }

    func toggleDiff() {
        rightPanelOpen.toggle()
    }

    func openFile(project: String, relative: String, line: UInt32?) {
        rightPanelOpen = true
    }

    func closeActiveSurface() {
        rightPanelOpen = false
    }
}

extension StudioStore {
    var panels: PanelState { inbox.panels }
    var shell: ShellState { inbox.shell }
}
