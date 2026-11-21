import SwiftUI
import WebKit
import UniformTypeIdentifiers

/// Owns the single WKWebView (kept alive while the connect screen is shown).
@MainActor
final class WebViewHolder: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let view: WKWebView
    private var saveDestination: [ObjectIdentifier: URL] = [:]

    override init() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.allowsAirPlayForMediaPlayback = true
        cfg.preferences.isElementFullscreenEnabled = true
        cfg.userContentController.addUserScript(SwitchButtonScript.make())
        view = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(macOS 13.3, *) { view.isInspectable = true }
        #endif
    }

    func load(_ url: URL) { view.load(URLRequest(url: url)) }
    var currentOrigin: String? { AppModel.shared.address.map { "\($0.scheme ?? "")://\($0.host ?? "")\($0.port.map { ":\($0)" } ?? "")" } }
    private func sameServer(_ u: URL?) -> Bool {
        guard let u, let a = AppModel.shared.address else { return false }
        return u.host == a.host && u.port == a.port && u.scheme == a.scheme
    }

    // MARK: navigation
    func webView(_ wv: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "aos-native" { AppModel.shared.showConnect(); return decisionHandler(.cancel) }
        if action.shouldPerformDownload { return decisionHandler(.download) }
        if let s = url.scheme, ["about", "blob", "data"].contains(s) { return decisionHandler(.allow) }
        guard let s = url.scheme, s == "http" || s == "https" else { return decisionHandler(.cancel) }
        // main-frame navigation to another site (a link click): open in the default browser. Login redirects (not link clicks) stay in-window.
        if action.targetFrame?.isMainFrame == true, action.navigationType == .linkActivated, !sameServer(url) {
            NSWorkspace.shared.open(url); return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ wv: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if !response.canShowMIMEType { return decisionHandler(.download) }
        if let h = response.response as? HTTPURLResponse,
           (h.value(forHTTPHeaderField: "Content-Disposition") ?? "").lowercased().hasPrefix("attachment") { return decisionHandler(.download) }
        decisionHandler(.allow)
    }

    func webView(_ wv: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ wv: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func webView(_ wv: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        AppModel.shared.screen = .failed
    }

    // MARK: window.open / target=_blank
    func webView(_ wv: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        if sameServer(url) { wv.load(URLRequest(url: url)) }
        else if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
        return nil
    }

    // MARK: alert / confirm / prompt
    func webView(_ wv: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.runModal(); completionHandler()
    }
    func webView(_ wv: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.addButton(withTitle: ConnectionProbe.t("취소", "Cancel"))
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ wv: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt; a.addButton(withTitle: "OK"); a.addButton(withTitle: ConnectionProbe.t("취소", "Cancel"))
        let f = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24)); f.stringValue = defaultText ?? ""; a.accessoryView = f
        a.window.initialFirstResponder = f
        completionHandler(a.runModal() == .alertFirstButtonReturn ? f.stringValue : nil)
    }

    // MARK: <input type=file>
    func webView(_ wv: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel(); p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.canChooseDirectories = parameters.allowsDirectories; p.canChooseFiles = true
        if let w = wv.window { p.beginSheetModal(for: w) { completionHandler($0 == .OK ? p.urls : nil) } }
        else { completionHandler(p.runModal() == .OK ? p.urls : nil) }
    }

    // MARK: downloads
    func download(_ d: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let p = NSSavePanel(); p.nameFieldStringValue = suggestedFilename
        p.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] r in
            guard r == .OK, let url = p.url else { completionHandler(nil); return }
            try? FileManager.default.removeItem(at: url)   // the user confirmed the overwrite in the panel
            self?.saveDestination[ObjectIdentifier(d)] = url; completionHandler(url)
        }
        if let w = view.window { p.beginSheetModal(for: w, completionHandler: finish) } else { finish(p.runModal()) }
    }
    func downloadDidFinish(_ d: WKDownload) {
        if let u = saveDestination.removeValue(forKey: ObjectIdentifier(d)) { NSWorkspace.shared.activateFileViewerSelecting([u]) }
    }
    func download(_ d: WKDownload, didFailWithError error: Error, resumeData: Data?) { saveDestination.removeValue(forKey: ObjectIdentifier(d)) }

    // MARK: window close guard ("Warn on close", localStorage aos_close_guard_enabled, default ON)
    func confirmClose() async -> Bool {
        guard AppModel.shared.screen == .web else { return true }
        let on = (try? await view.evaluateJavaScript("localStorage.getItem('aos_close_guard_enabled') !== '0'")) as? Bool ?? true
        guard on else { return true }
        let a = NSAlert(); a.messageText = ConnectionProbe.t("창을 닫을까요?", "Close the window?")
        a.informativeText = ConnectionProbe.t("진행 중인 작업이 있으면 화면에서 사라집니다. (상단 'Warn on close'로 끌 수 있습니다)", "Work in progress on this screen will be lost. (Turn off with 'Warn on close'.)")
        a.addButton(withTitle: ConnectionProbe.t("닫기", "Close")); a.addButton(withTitle: ConnectionProbe.t("취소", "Cancel"))
        return a.runModal() == .alertFirstButtonReturn
    }
}

struct WebContainer: NSViewRepresentable {
    let holder: WebViewHolder
    func makeNSView(context: Context) -> WKWebView { holder.view }
    func updateNSView(_ v: WKWebView, context: Context) {}
}
