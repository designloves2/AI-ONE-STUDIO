import SwiftUI
import WebKit
import os

enum Screen: Equatable { case connect, checking, web, failed }

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()
    static let log = Logger(subsystem: "cloud.tjtj.aionestudio", category: "app")

    @Published var screen: Screen = .checking
    @Published var address: URL? = ConnectionStore.load()
    let web = WebViewHolder()

    func start() async {
        guard let origin = address else { screen = .connect; return }
        await open(origin)
    }

    func open(_ origin: URL) async {
        screen = .checking
        if await ConnectionProbe.isReachable(origin) {
            web.load(origin); screen = .web
        } else { screen = .failed }
    }

    func connected(_ origin: URL) { ConnectionStore.save(origin); address = origin; web.load(origin); screen = .web }
    func showConnect() { screen = .connect }
    func retry() { Task { await start() } }
}
