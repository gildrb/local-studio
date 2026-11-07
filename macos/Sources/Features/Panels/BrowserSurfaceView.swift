import AppKit
import SwiftUI
import WebKit

@MainActor
@Observable
final class BrowserModel: NSObject, WKNavigationDelegate {
    var address = ""
    private(set) var title = ""
    private(set) var current: URL?
    private(set) var canGoBack = false
    private(set) var canGoForward = false
    private(set) var loading = false
    private(set) var failure: String?
    private(set) var zoom: CGFloat = 1
    private(set) var focusRequest = 0

    @ObservationIgnored let webView: WKWebView

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true
    }

    var tabTitle: String {
        if !title.isEmpty { return title }
        return current?.host() ?? "Browser"
    }

    func go() {
        let text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = Self.url(from: text) else { return }
        failure = nil
        webView.load(URLRequest(url: url))
    }

    func back() { webView.goBack() }
    func forward() { webView.goForward() }

    func reload() {
        if loading {
            webView.stopLoading()
        } else if current != nil {
            failure = nil
            webView.reload()
        } else {
            go()
        }
    }

    func setZoom(_ value: CGFloat) {
        zoom = min(max(value, 0.5), 3)
        webView.pageZoom = zoom
    }

    func stop() {
        webView.stopLoading()
    }

    func focusAddress() {
        focusRequest += 1
    }

    func openExternally() {
        if let current {
            NSWorkspace.shared.open(current)
        }
    }

    static func url(from text: String) -> URL? {
        guard !text.isEmpty else { return nil }
        if text.contains("://"), let url = URL(string: text) { return url }
        let local = text.hasPrefix("localhost") || text.hasPrefix("127.") || text.hasPrefix("0.0.0.0") || text.range(of: #"^[\w.-]+:\d+"#, options: .regularExpression) != nil
        if local { return URL(string: "http://\(text)") }
        if text.contains("."), !text.contains(" ") { return URL(string: "https://\(text)") }
        var components = URLComponents(string: "https://duckduckgo.com/")
        components?.queryItems = [URLQueryItem(name: "q", value: text)]
        return components?.url
    }

    private func sync() {
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        title = webView.title ?? ""
        current = webView.url
        if let url = webView.url {
            address = url.absoluteString
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        loading = true
        failure = nil
        sync()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation?) {
        sync()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        loading = false
        sync()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: any Error) {
        finish(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: any Error) {
        finish(error)
    }

    private func finish(_ error: any Error) {
        loading = false
        sync()
        if (error as NSError).code != NSURLErrorCancelled {
            failure = error.localizedDescription
        }
    }
}

struct BrowserSurfaceView: View {
    @Bindable var model: BrowserModel
    let panels: PanelState
    @FocusState private var addressFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            PanelToolbar {
                PanelIconButton("Back", symbol: "chevron.left", enabled: model.canGoBack) { model.back() }
                PanelIconButton("Forward", symbol: "chevron.right", enabled: model.canGoForward) { model.forward() }
                PanelIconButton(model.loading ? "Stop" : "Reload (⌘R)", symbol: model.loading ? "xmark" : "arrow.clockwise") { model.reload() }
                TextField("Search or enter address", text: $model.address)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12.5))
                    .focused($addressFocused)
                    .onSubmit { model.go() }
                    .accessibilityLabel("Address")
                    .padding(.horizontal, 9)
                    .frame(height: 26)
                    .background(Theme.input.opacity(0.7), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                PanelIconButton("Float Preview", symbol: "pip.enter", enabled: model.current != nil) {
                    panels.float(model)
                }
                PanelMenuButton(title: "Browser Options", symbol: "ellipsis") {
                    Button("Zoom In") { model.setZoom(model.zoom + 0.1) }
                    Button("Zoom Out") { model.setZoom(model.zoom - 0.1) }
                    Button("Actual Size") { model.setZoom(1) }
                        .disabled(model.zoom == 1)
                    Divider()
                    Button("Focus Address Bar") { addressFocused = true }
                    Button("Float Preview") { panels.float(model) }
                        .disabled(model.current == nil)
                    Button("Open in Default Browser") { model.openExternally() }
                        .disabled(model.current == nil)
                }
            }
            BrowserContent(model: model)
        }
        .onAppear {
            if model.current == nil {
                addressFocused = true
            }
        }
        .onChange(of: model.focusRequest) { addressFocused = true }
    }
}

struct BrowserContent: View {
    let model: BrowserModel

    var body: some View {
        ZStack {
            BrowserWebView(webView: model.webView)
                .opacity(model.current == nil ? 0 : 1)
            if let failure = model.failure {
                Theme.canvas
                PanelMessage(symbol: "exclamationmark.triangle", title: "Couldn’t open this page.", detail: failure, actionTitle: "Try Again") { model.reload() }
            } else if model.current == nil, model.loading {
                PanelMessage(symbol: "clock", title: "Loading \(model.address)…")
            } else if model.current == nil {
                PanelMessage(symbol: "globe", title: "Preview a page", detail: "Enter a URL, such as localhost:3000, to open it here.")
            }
        }
    }
}

struct PreviewMiniPlayerView: View {
    let store: StudioStore
    @State private var dragOrigin: CGSize?
    @State private var resizeOrigin: CGFloat?
    @State private var hovering = false

    private var panels: PanelState { store.workspace.panels }

    var body: some View {
        GeometryReader { proxy in
            if let model = panels.visibleMiniPlayer {
                let width = min(max(panels.miniPlayerWidth, PanelState.miniPlayerMinimumWidth), max(proxy.size.width - 24, PanelState.miniPlayerMinimumWidth))
                let height = width * 0.625 + 30
                let maxX = max(proxy.size.width - width - 12, 12)
                let maxY = max(proxy.size.height - height - 12, 12)
                let origin = CGPoint(
                    x: min(max(maxX + panels.miniPlayerOffset.width, 12), maxX),
                    y: min(max(maxY + panels.miniPlayerOffset.height, 12), maxY)
                )
                VStack(spacing: 0) {
                    HStack(spacing: 4) {
                        Image(systemName: "globe")
                            .font(.system(size: 11, weight: .light))
                            .foregroundStyle(Theme.chromeIcon)
                            .accessibilityHidden(true)
                        Text(model.tabTitle)
                            .font(.system(size: 11.5))
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 4)
                        PanelIconButton("Open in Right Panel", symbol: "arrow.up.left.and.arrow.down.right") {
                            panels.dock(model)
                        }
                        PanelIconButton("Close Floating Preview", symbol: "xmark") {
                            panels.closeMiniPlayer()
                        }
                    }
                    .padding(.leading, 9)
                    .padding(.trailing, 2)
                    .frame(height: 30)
                    .background(Theme.card)
                    .contentShape(Rectangle())
                    .gesture(move(maxX: maxX, maxY: maxY))
                    BrowserContent(model: model)
                }
                .frame(width: width, height: height)
                .background(Theme.canvas)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.selectionStroke, lineWidth: 0.8))
                .shadow(color: .black.opacity(0.28), radius: 18, y: 6)
                .overlay(alignment: .topLeading) {
                    Color.clear
                        .frame(width: 14, height: 14)
                        .contentShape(Rectangle())
                        .onHover { inside in
                            if inside { NSCursor.crosshair.push() } else { NSCursor.pop() }
                        }
                        .gesture(resize)
                        .accessibilityHidden(true)
                }
                .offset(x: origin.x, y: origin.y)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Floating browser preview")
            }
        }
        .transaction { $0.disablesAnimations = true }
    }

    private func move(maxX: CGFloat, maxY: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 2, coordinateSpace: .global)
            .onChanged { value in
                let origin = dragOrigin ?? panels.miniPlayerOffset
                dragOrigin = origin
                panels.miniPlayerOffset = CGSize(
                    width: min(max(origin.width + value.translation.width, 12 - maxX), 0),
                    height: min(max(origin.height + value.translation.height, 12 - maxY), 0)
                )
            }
            .onEnded { _ in dragOrigin = nil }
    }

    private var resize: some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .global)
            .onChanged { value in
                let origin = resizeOrigin ?? panels.miniPlayerWidth
                resizeOrigin = origin
                panels.miniPlayerWidth = min(max(origin - value.translation.width, PanelState.miniPlayerMinimumWidth), 900)
            }
            .onEnded { _ in resizeOrigin = nil }
    }
}

private struct BrowserWebView: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> NSView {
        let host = NSView()
        adopt(into: host)
        return host
    }

    func updateNSView(_ host: NSView, context: Context) {
        if webView.superview !== host {
            adopt(into: host)
        }
    }

    static func dismantleNSView(_ host: NSView, coordinator: ()) {
        for view in host.subviews {
            view.removeFromSuperview()
        }
    }

    private func adopt(into host: NSView) {
        webView.removeFromSuperview()
        webView.frame = host.bounds
        webView.autoresizingMask = [.width, .height]
        host.addSubview(webView)
    }
}
