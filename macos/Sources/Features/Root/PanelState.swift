import Foundation

extension StudioStore {
    var panels: PanelState { workspace.panels }
    var shell: ShellState { inbox.shell }
}
