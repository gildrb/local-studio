import AppKit
import SwiftUI

struct RootView: View {
    let store: StudioStore
    @State private var sidebarVisible = true
    @State private var sidebarWidth: CGFloat = 272
    @State private var dragOrigin: CGFloat?

    private static let widthRange: ClosedRange<CGFloat> = 220...420

    var body: some View {
        HStack(spacing: 0) {
            SidebarView(store: store)
                .frame(width: sidebarWidth)
                .frame(width: sidebarVisible ? sidebarWidth : 0, alignment: .trailing)
                .clipped()
                .allowsHitTesting(sidebarVisible)
                .accessibilityHidden(!sidebarVisible)
                .background(Theme.sidebar)
            if sidebarVisible {
                Rectangle()
                    .fill(Theme.hairline)
                    .frame(width: 1)
                    .overlay {
                        Color.clear
                            .frame(width: 9)
                            .contentShape(Rectangle())
                            .onHover { inside in
                                if inside { NSCursor.columnResize.push() } else { NSCursor.pop() }
                            }
                            .gesture(resize)
                    }
            }
            ThreadView(store: store, leadingInset: sidebarVisible ? 0 : WindowChrome.collapsedInset)
        }
        .background(Theme.canvas)
        .ignoresSafeArea(.container, edges: .top)
        .toolbar {
            ToolbarItem(placement: .navigation) {
                WindowChrome(store: store, sidebarVisible: $sidebarVisible)
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .transaction { $0.disablesAnimations = true }
    }

    private var resize: some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
                let origin = dragOrigin ?? sidebarWidth
                dragOrigin = origin
                sidebarWidth = min(max(origin + value.translation.width, Self.widthRange.lowerBound), Self.widthRange.upperBound)
            }
            .onEnded { _ in dragOrigin = nil }
    }
}

struct WindowChrome: View {
    static let collapsedInset: CGFloat = Theme.Metrics.trafficLightsWidth + 3 * Theme.Metrics.chromeButton + 12

    let store: StudioStore
    @Binding var sidebarVisible: Bool

    var body: some View {
        HStack(spacing: 0) {
            ChromeIconButton(sidebarVisible ? "Hide Sidebar" : "Show Sidebar", symbol: "sidebar.leading") {
                sidebarVisible.toggle()
            }
            .keyboardShortcut("b")
            ChromeIconButton("New Thread", symbol: "plus") { store.select(nil) }
                .keyboardShortcut("n")
            ChromeIconButton("Command Palette", symbol: "command") {}
                .keyboardShortcut("k")
        }
    }
}
