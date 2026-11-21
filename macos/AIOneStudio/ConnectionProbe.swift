import Foundation

/// Same rules as server-lib/connection.mjs (normalize + probe), remote-only.
enum ProbeResult {
    case studio(URL)      // AI ONE STUDIO server
    case loginWall(URL)   // answers only after a sign-in (Cloudflare Access etc.)
    case comfy(String)    // a ComfyUI address (not supported in v1)
    case fail(String)
}

enum ConnectionProbe {
    static let ko = (Locale.preferredLanguages.first ?? "").hasPrefix("ko")
    static func t(_ k: String, _ e: String) -> String { ko ? k : e }

    static func normalize(_ address: String) -> URL? {
        var a = address.trimmingCharacters(in: .whitespacesAndNewlines)
        while a.hasSuffix("/") { a.removeLast() }
        if a.isEmpty { return nil }
        if a.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) == nil {
            let lan = "^(localhost|127\\.|10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|\\[::1\\])|\\.local(:|/|$)"
            a = (a.range(of: lan, options: [.regularExpression, .caseInsensitive]) != nil ? "http://" : "https://") + a
        }
        guard let c = URLComponents(string: a), let scheme = c.scheme, let host = c.host else { return nil }
        var o = URLComponents(); o.scheme = scheme.lowercased(); o.host = host; o.port = c.port
        return o.url
    }

    private final class NoRedirect: NSObject, URLSessionTaskDelegate {
        func urlSession(_ s: URLSession, task: URLSessionTask, willPerformHTTPRedirection r: HTTPURLResponse,
                        newRequest: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    }

    private static func get(_ url: URL, timeout: TimeInterval) async -> (status: Int, location: String, body: Data, error: String?) {
        var req = URLRequest(url: url); req.timeoutInterval = timeout; req.cachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: .ephemeral, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        do {
            let (data, resp) = try await session.data(for: req)
            let h = resp as? HTTPURLResponse
            return (h?.statusCode ?? 0, h?.value(forHTTPHeaderField: "Location") ?? "", data, nil)
        } catch { return (0, "", Data(), (error as NSError).localizedDescription) }
    }

    private static func isWall(_ status: Int, _ location: String) -> Bool {
        status == 401 || status == 403 ||
            location.range(of: "cloudflareaccess|/cdn-cgi/access|login|signin", options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// quick check on launch (3 s): is the saved address still an AI ONE STUDIO server (or a login wall)?
    static func isReachable(_ origin: URL) async -> Bool {
        let r = await get(origin.appendingPathComponent("aos/target"), timeout: 3)
        return isStudio(r.status, r.body) || isWall(r.status, r.location)
    }

    private static func isStudio(_ status: Int, _ body: Data) -> Bool {
        guard status == 200, let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else { return false }
        return o["url"] is String
    }

    static func probe(_ address: String) async -> ProbeResult {
        guard let origin = normalize(address) else { return .fail(t("주소를 읽을 수 없습니다", "Cannot read this address")) }
        let a = await get(origin.appendingPathComponent("aos/target"), timeout: 8)
        if isStudio(a.status, a.body) { return .studio(origin) }
        if isWall(a.status, a.location) { return .loginWall(origin) }
        let b = await get(origin.appendingPathComponent("system_stats"), timeout: 8)
        if b.status == 200, let o = try? JSONSerialization.jsonObject(with: b.body) as? [String: Any], o["system"] != nil {
            return .comfy(t("이 주소는 ComfyUI입니다. 맥 앱은 AI ONE STUDIO 서버 주소(Windows PC에서 serve.mjs 실행)가 필요합니다.",
                            "This address is a ComfyUI. The Mac app needs the AI ONE STUDIO server address (serve.mjs running on the Windows PC)."))
        }
        let why = a.status != 0 ? t(" (응답 \(a.status))", " (response \(a.status))") : (a.error.map { " (\($0))" } ?? "")
        return .fail(t("AI ONE STUDIO 서버가 아닙니다", "Not an AI ONE STUDIO server") + why)
    }
}
