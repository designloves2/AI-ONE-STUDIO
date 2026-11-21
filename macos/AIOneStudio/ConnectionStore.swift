import Foundation

/// Saved connection: ~/Library/Application Support/cloud.tjtj.aionestudio/connection.json  {"mode":"remote","address":"https://..."}
enum ConnectionStore {
    private static var fileURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("cloud.tjtj.aionestudio", isDirectory: true).appendingPathComponent("connection.json")
    }

    static func load() -> URL? {
        guard let data = try? Data(contentsOf: fileURL),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              obj["mode"] as? String == "remote",
              let addr = obj["address"] as? String, let url = URL(string: addr) else { return nil }
        return url
    }

    static func save(_ origin: URL) {
        let dir = fileURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let obj: [String: Any] = ["mode": "remote", "address": origin.absoluteString]
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) else { return }
        try? data.write(to: fileURL, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }
}
