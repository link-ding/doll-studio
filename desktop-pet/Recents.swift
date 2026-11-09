// The models opened before (PSDs and .doll files), newest first, so they can be reopened without looking for them.
// Kept in UserDefaults as paths; files that have since been moved or deleted are left out of the list.

import CryptoKit
import Foundation

struct RecentModel: Codable, Hashable, Identifiable {
    let path: String
    var lastUsed: Date

    var id: String { path }
    var url: URL { URL(fileURLWithPath: path) }
    var name: String { url.lastPathComponent }
    var folder: String { url.deletingLastPathComponent().lastPathComponent }
    var exists: Bool { FileManager.default.fileExists(atPath: path) }

    static let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("DollPet", isDirectory: true)
    static func key(_ path: String) -> String { SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined() }

    // What the user set for a model file in the editor (part roles, control points like the eyelid lines, physics,
    // which parts show), as JSON from the editor page; applied whenever the file is opened again.
    static func tuningURL(_ path: String) -> URL { support.appendingPathComponent("Tuning/" + key(path) + ".json") }
    static func tuning(_ path: String) -> String? { try? String(contentsOf: tuningURL(path), encoding: .utf8) }

    // What the pages get for a model file, as JSON: {"own": its tuning or null, "others": [...]}. For a PSD, others
    // are the tunings kept for every other file, newest first: a re-export or re-download of a character is a new
    // file, and the page uses the one made for the same character (it compares the auto-measured eyes and mouth).
    // A .doll carries its own rig, so it only ever gets its own.
    static func saved(_ path: String) -> String {
        let own = tuning(path) ?? "null"
        guard ["psd", "psb"].contains(URL(fileURLWithPath: path).pathExtension.lowercased()) else {
            return "{\"own\":\(own),\"others\":[]}"
        }
        let fm = FileManager.default, mine = tuningURL(path).lastPathComponent
        let date = { (u: URL) in (try? u.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast }
        let files = ((try? fm.contentsOfDirectory(at: support.appendingPathComponent("Tuning"), includingPropertiesForKeys: [.contentModificationDateKey])) ?? [])
            .filter { $0.pathExtension == "json" && $0.lastPathComponent != mine }
            .sorted { date($0) > date($1) }
            .prefix(40)
        // only well-formed files, so one damaged file can't break the page's call
        let others = files.compactMap { u -> String? in
            guard let data = try? Data(contentsOf: u), (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { return nil }
            return String(data: data, encoding: .utf8)
        }
        return "{\"own\":\(own),\"others\":[\(others.joined(separator: ","))]}"
    }

    // A still of the model, rendered by a hidden pet page (most PSDs from See-through carry no preview of their own).
    var thumbURL: URL { Self.support.appendingPathComponent("Thumbs/" + Self.key(path) + ".png") }
    // the saved still, unless the model file or its tuning has changed since
    var thumb: Data? {
        let fm = FileManager.default
        let date = { (p: String) in (try? fm.attributesOfItem(atPath: p)[.modificationDate]) as? Date }
        guard let made = date(thumbURL.path), let changed = date(path), made >= changed,
              made >= date(Self.tuningURL(path).path) ?? .distantPast else { return nil }
        return try? Data(contentsOf: thumbURL)
    }
}

@MainActor
final class Recents {
    static let key = "recentModels"
    static let limit = 20
    static let kinds: Set<String> = ["psd", "psb", "doll", "json"]

    private let defaults: UserDefaults
    private(set) var items: [RecentModel]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let data = defaults.data(forKey: Self.key)
        items = data.flatMap { try? JSONDecoder().decode([RecentModel].self, from: $0) } ?? []
    }

    // what can still be opened
    var existing: [RecentModel] { items.filter(\.exists) }

    // Moves (or adds) a model file to the top. Files inside the app and the model the editor handed to the pet
    // (kept in Application Support) are not the user's own files, so they are not listed.
    func add(_ url: URL) {
        let path = url.standardizedFileURL.path
        guard Self.kinds.contains(url.pathExtension.lowercased()),
              !path.hasPrefix(Bundle.main.bundlePath),
              !path.contains("/Application Support/DollPet/") else { return }
        items.removeAll { $0.path == path }
        items.insert(RecentModel(path: path, lastUsed: Date()), at: 0)
        if items.count > Self.limit { items.removeLast(items.count - Self.limit) }
        save()
    }

    func remove(_ path: String) {
        items.removeAll { $0.path == path }
        save()
    }

    private func save() {
        if let data = try? JSONEncoder().encode(items) { defaults.set(data, forKey: Self.key) }
    }
}
