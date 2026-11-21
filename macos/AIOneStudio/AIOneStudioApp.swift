import SwiftUI
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var allowClose = false
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if allowClose { return true }
        Task { @MainActor in
            if await AppModel.shared.web.confirmClose() { self.allowClose = true; sender.close() }
        }
        return false
    }
    func applicationShouldTerminate(_ app: NSApplication) -> NSApplication.TerminateReply {
        // ⌘Q goes through the same guard
        if allowClose { return .terminateNow }
        Task { @MainActor in
            let ok = await AppModel.shared.web.confirmClose()
            if ok { self.allowClose = true }
            app.reply(toApplicationShouldTerminate: ok)
        }
        return .terminateLater
    }
}

private struct WindowHook: NSViewRepresentable {
    let delegate: NSWindowDelegate
    func makeNSView(context: Context) -> NSView {
        let v = NSView(); DispatchQueue.main.async { v.window?.delegate = delegate }; return v
    }
    func updateNSView(_ v: NSView, context: Context) { DispatchQueue.main.async { v.window?.delegate = delegate } }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    var body: some View {
        ZStack {
            WebContainer(holder: model.web).opacity(model.screen == .web ? 1 : 0)
            switch model.screen {
            case .connect: ConnectView().background(.background)
            case .failed: FailedView().background(.background)
            case .checking: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(.background)
            case .web: EmptyView()
            }
        }
        .background(WindowHook(delegate: delegate))
        .frame(minWidth: 800, minHeight: 560)
        .task { await model.start() }
    }
}

@main
struct AIOneStudioApp: App {
    @StateObject private var model = AppModel.shared
    var body: some Scene {
        Window("AI ONE STUDIO", id: "main") { RootView().environmentObject(model) }
            .defaultSize(width: 1400, height: 900)
            .commands {
                CommandGroup(replacing: .newItem) {}
                CommandMenu(ConnectionProbe.t("연결", "Connection")) {
                    Button(ConnectionProbe.t("연결 설정…", "Connection settings…")) { model.showConnect() }.keyboardShortcut("k", modifiers: [.command, .shift])
                }
                CommandGroup(replacing: .toolbar) {
                    Button(ConnectionProbe.t("다시 불러오기", "Reload")) { model.web.view.reload() }.keyboardShortcut("r", modifiers: .command)
                    Button(ConnectionProbe.t("강제 새로 고침", "Hard reload")) { model.web.view.reloadFromOrigin() }.keyboardShortcut("r", modifiers: [.command, .shift])
                    Divider()
                    Button(ConnectionProbe.t("확대", "Zoom in")) { model.web.view.pageZoom *= 1.1 }.keyboardShortcut("+", modifiers: .command)
                    Button(ConnectionProbe.t("축소", "Zoom out")) { model.web.view.pageZoom /= 1.1 }.keyboardShortcut("-", modifiers: .command)
                    Button(ConnectionProbe.t("실제 크기", "Actual size")) { model.web.view.pageZoom = 1 }.keyboardShortcut("0", modifiers: .command)
                }
            }
    }
}
