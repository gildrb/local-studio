import AppKit
import LocalStudioKit
import SwiftUI

@MainActor
final class KeyState {
    var pendingG = false
    var recentCycle: (threads: [String], index: Int)?
    var frames: [FocusRegion: CGRect] = [:]
}

struct KeyboardFocusRing: ViewModifier {
    let active: Bool
    let radius: CGFloat
    let outset: CGFloat

    func body(content: Content) -> some View {
        content.overlay {
            if active {
                RoundedRectangle(cornerRadius: radius + outset, style: .continuous)
                    .strokeBorder(Color(nsColor: .keyboardFocusIndicatorColor), lineWidth: 3)
                    .padding(-outset)
                    .allowsHitTesting(false)
            }
        }
    }
}

extension View {
    func keyboardFocusRing(_ active: Bool, radius: CGFloat = Theme.Metrics.rowRadius, outset: CGFloat = 3) -> some View {
        modifier(KeyboardFocusRing(active: active, radius: radius, outset: outset))
    }

    func focusRegionFrame(_ region: FocusRegion, in shell: ShellState) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { shell.keys.frames[region] = $0 }
    }
}

extension StudioStore {
    var mainWindow: NSWindow? {
        NSApp.windows.first { $0.identifier?.rawValue.hasPrefix("main") == true } ?? NSApp.mainWindow
    }

    var availableRegions: [FocusRegion] {
        var regions: [FocusRegion] = []
        if shell.sidebarVisible { regions.append(.sidebar) }
        guard shell.route == .thread else { return regions }
        if conversation.thread != nil { regions.append(.timeline) }
        regions.append(.composer)
        if panels.rightPanelOpen { regions.append(.rightPanel) }
        if panels.terminalOpen { regions.append(.terminal) }
        return regions
    }

    func cycleFocus(_ offset: Int) {
        let regions = availableRegions
        guard !regions.isEmpty else { return }
        let current = regions.firstIndex(of: currentRegion) ?? (offset > 0 ? -1 : regions.count)
        let next = ((current + offset) % regions.count + regions.count) % regions.count
        focus(regions[next])
    }

    var currentRegion: FocusRegion {
        let responder = mainWindow?.firstResponder
        if responder is ComposerNSTextView { return .composer }
        if responder is TerminalSurfaceView { return .terminal }
        return shell.region
    }

    func focus(_ region: FocusRegion) {
        shell.keys.pendingG = false
        switch region {
        case .sidebar:
            if !shell.sidebarVisible { shell.sidebarVisible = true }
            resignText()
            if shell.sidebarCursor.map({ inbox.visibleOrder.contains($0) }) != true {
                shell.sidebarCursor = conversation.thread.flatMap { inbox.visibleOrder.contains($0) ? $0 : nil } ?? inbox.visibleOrder.first
            }
        case .timeline:
            guard shell.route == .thread, conversation.thread != nil else { return focus(.composer) }
            resignText()
            if shell.timelineCursor.map({ id in conversation.rows.contains { $0.id == id } }) != true {
                shell.timelineCursor = conversation.rows.last?.id
            }
        case .composer:
            if shell.route != .thread { shell.route = .thread }
            if let view = mainWindow?.contentView?.firstDescendant(ComposerNSTextView.self) {
                mainWindow?.makeFirstResponder(view)
            } else {
                conversation.requestFocus()
            }
        case .rightPanel:
            if !panels.rightPanelOpen { panels.toggleRightPanel() }
            resignText()
        case .terminal:
            if !panels.terminalOpen { panels.toggleTerminal() }
            if let view = mainWindow?.contentView?.firstDescendant(TerminalSurfaceView.self) {
                mainWindow?.makeFirstResponder(view)
            }
        }
        if shell.region != region { shell.region = region }
    }

    func noteClick(at point: NSPoint, in window: NSWindow) {
        guard window === mainWindow, let height = window.contentView?.bounds.height else { return }
        let location = CGPoint(x: point.x, y: height - point.y)
        let order: [FocusRegion] = [.composer, .terminal, .rightPanel, .sidebar, .timeline]
        guard let region = order.first(where: { shell.keys.frames[$0]?.contains(location) == true }) else { return }
        if region == .timeline, conversation.thread == nil { return }
        if shell.region != region { shell.region = region }
    }

    private func resignText() {
        guard let window = mainWindow else { return }
        if window.firstResponder is NSText || window.firstResponder is TerminalSurfaceView {
            window.makeFirstResponder(nil)
        }
    }

    func closeThread() {
        guard shell.route == .thread, conversation.thread != nil else { return }
        newThread(in: focusedProject ?? inbox.currentProject)
        focus(.composer)
    }

    func newThreadTab() {
        newThreadCommand(currentProject: true)
        focus(.composer)
    }

    func cycleRecent(_ step: Int) {
        let keys = shell.keys
        if keys.recentCycle == nil {
            let threads = shell.recent.filter { inbox.thread($0) != nil }
            guard threads.count > 1 else { return }
            keys.recentCycle = (threads, 0)
        }
        guard var cycle = keys.recentCycle else { return }
        let count = cycle.threads.count
        cycle.index = ((cycle.index + step) % count + count) % count
        keys.recentCycle = cycle
        open(cycle.threads[cycle.index])
    }

    func endRecentCycle() {
        guard shell.keys.recentCycle != nil else { return }
        shell.keys.recentCycle = nil
        shell.touchRecent(conversation.thread)
    }

    func stepPanelTab(_ offset: Int) {
        let surfaces = panels.surfaces
        guard !surfaces.isEmpty else { return }
        let current = surfaces.firstIndex { $0.id == panels.activeSurface } ?? 0
        let next = ((current + offset) % surfaces.count + surfaces.count) % surfaces.count
        panels.show(surfaces[next].id)
    }
}

extension NSView {
    func firstDescendant<T: NSView>(_ type: T.Type) -> T? {
        for child in subviews {
            if let match = child as? T, !match.isHiddenOrHasHiddenAncestor { return match }
            if let match = child.firstDescendant(type) { return match }
        }
        return nil
    }
}
