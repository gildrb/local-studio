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
    @FocusState private var addressFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            PanelToolbar {
                PanelIconButton("Back", symbol: "chevron.left", enabled: model.canGoBack) { model.back() }
                PanelIconButton("Forward", symbol: "chevron.right", enabled: model.canGoForward) { model.forward() }
                PanelIconButton(model.loading ? "Stop" : "Reload", symbol: model.loading ? "xmark" : "arrow.clockwise") { model.reload() }
                TextField("Search or enter address", text: $model.address)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12.5))
                    .focused($addressFocused)
                    .onSubmit { model.go() }
                    .accessibilityLabel("Address")
                    .padding(.horizontal, 9)
                    .frame(height: 26)
                    .background(Theme.input.opacity(0.7), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                PanelMenuButton(title: "Browser Options", symbol: "ellipsis") {
                    Button("Zoom In") { model.setZoom(model.zoom + 0.1) }
                    Button("Zoom Out") { model.setZoom(model.zoom - 0.1) }
                    Button("Actual Size") { model.setZoom(1) }
                        .disabled(model.zoom == 1)
                    Divider()
                    Button("Focus Address Bar") { addressFocused = true }
                    Button("Open in Default Browser") { model.openExternally() }
                        .disabled(model.current == nil)
                }
            }
            ZStack {
                BrowserWebView(webView: model.webView)
                    .opacity(model.current == nil ? 0 : 1)
                if let failure = model.failure {
                    Theme.canvas
                    PanelMessage(symbol: "exclamationmark.triangle", title: "Couldn’t open this page.", detail: failure, actionTitle: "Try Again") { model.reload() }
                } else if model.current == nil {
                    PanelMessage(symbol: "globe", title: "Preview a page", detail: "Enter a URL, such as localhost:3000, to open it here.")
                }
            }
        }
        .onAppear {
            if model.current == nil {
                addressFocused = true
            }
        }
    }
}

private struct BrowserWebView: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
