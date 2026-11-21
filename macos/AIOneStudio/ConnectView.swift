import SwiftUI

struct ConnectView: View {
    @EnvironmentObject var model: AppModel
    @State private var text = ""
    @State private var line = ""
    @State private var isError = false
    @State private var busy = false
    private let t = ConnectionProbe.t

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("AI ONE STUDIO").font(.title2.bold())
            Text(t("Windows 서버(백엔드)가 어디에 있나요?", "Where is the Windows server (backend)?")).foregroundStyle(.secondary)
            Text(t("접속 주소 (도메인 · 터널 주소 · IP:포트)", "Address (domain · tunnel address · IP:port)")).font(.footnote).padding(.top, 8)
            TextField("studio.example.com / 192.168.0.20:8778", text: $text)
                .textFieldStyle(.roundedBorder).onSubmit(connect)
            HStack {
                Button(t("연결", "Connect"), action: connect).keyboardShortcut(.defaultAction).disabled(busy)
                if model.address != nil { Button(t("취소", "Cancel")) { Task { await model.start() } } }
            }
            if !line.isEmpty { Text(line).foregroundStyle(isError ? Color.red : Color.secondary).font(.callout).textSelection(.enabled) }
            Text(t("이 Mac에는 서버가 필요 없습니다. 렌더는 Windows PC에서 돌아갑니다.\n주소를 바꾸면 저장된 설정(프리셋 등)이 주소별로 따로 보입니다.",
                   "This Mac needs no server. Rendering runs on the Windows PC.\nSettings (presets etc.) are stored per address."))
                .font(.footnote).foregroundStyle(.secondary).padding(.top, 8)
        }
        .padding(28).frame(maxWidth: 560).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear { text = model.address?.absoluteString ?? "" }
    }

    private func connect() {
        guard !busy else { return }
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { line = t("주소를 넣어 주세요", "Enter an address"); isError = true; return }
        busy = true; isError = false; line = t("알아보는 중…", "Checking…")
        Task {
            switch await ConnectionProbe.probe(text) {
            case .studio(let u): model.connected(u)
            case .loginWall(let u): line = t("로그인이 필요한 주소입니다. 창에서 로그인하세요.", "This address needs a sign-in. Sign in inside the window."); model.connected(u)
            case .comfy(let m): line = m; isError = true
            case .fail(let m): line = m + "\n" + t("연결하지 못했습니다. 주소를 확인해 주세요.", "Could not connect. Check the address."); isError = true
            }
            busy = false
        }
    }
}

struct FailedView: View {
    @EnvironmentObject var model: AppModel
    private let t = ConnectionProbe.t
    var body: some View {
        VStack(spacing: 12) {
            Text(t("서버에 연결하지 못했습니다", "Could not connect to the server")).font(.title3.bold())
            Text(model.address?.absoluteString ?? "").foregroundStyle(.secondary).textSelection(.enabled)
            Text(t("Windows PC에서 서버가 켜져 있는지 확인하세요. LAN 주소라면 시스템 설정 → 개인정보 보호 및 보안 → 로컬 네트워크에서 AI ONE STUDIO를 허용해야 합니다.",
                   "Check that the server is running on the Windows PC. For a LAN address, allow AI ONE STUDIO in System Settings → Privacy & Security → Local Network."))
                .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 440)
            HStack {
                Button(t("다시 시도", "Retry")) { model.retry() }.keyboardShortcut(.defaultAction)
                Button(t("연결 설정…", "Connection settings…")) { model.showConnect() }
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
