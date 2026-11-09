// Reminder sounds: one for "an agent finished", one for "an agent needs you". Each is a macOS system sound or an
// audio file of the user's own, copied into Application Support/DollPet/sounds so it keeps working if the original
// is moved. Stored in UserDefaults as "system:<name>" or "file:<path>".

import AppKit
import UniformTypeIdentifiers

@MainActor
final class Sounds {
    enum Kind: String, CaseIterable {
        case done, attention
        var label: String { self == .done ? L("Task finished", "任务完成") : L("Needs your input", "需要你操作") }
        var fallback: String { self == .done ? "Glass" : "Ping" }
    }

    static let system = ["Glass", "Ping", "Hero", "Pop", "Purr", "Tink", "Blow", "Bottle", "Frog", "Funk", "Morse", "Sosumi", "Submarine", "Basso"]

    private let defaults: UserDefaults
    private var playing: NSSound? // held while it plays: a released NSSound stops

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    private func key(_ kind: Kind) -> String { "sound.\(kind.rawValue)" }

    // the custom file, if one is chosen and still there
    private func file(_ kind: Kind) -> URL? {
        guard let v = defaults.string(forKey: key(kind)), v.hasPrefix("file:") else { return nil }
        let url = URL(fileURLWithPath: String(v.dropFirst(5)))
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    // the system sound in use (when no custom file is)
    func systemName(_ kind: Kind) -> String {
        guard let v = defaults.string(forKey: key(kind)), v.hasPrefix("system:") else { return kind.fallback }
        return String(v.dropFirst(7))
    }

    // what to show in the settings: the system sound's name, or the file the user picked
    func title(_ kind: Kind) -> String {
        if file(kind) != nil { return defaults.string(forKey: key(kind) + ".name") ?? L("Custom sound", "自定义声音") }
        return systemName(kind)
    }

    func isCustom(_ kind: Kind) -> Bool { file(kind) != nil }

    func play(_ kind: Kind) {
        playing?.stop()
        if let url = file(kind) {
            playing = NSSound(contentsOf: url, byReference: true)
        } else {
            playing = NSSound(named: systemName(kind)) ?? NSSound(named: kind.fallback)
        }
        playing?.play()
    }

    func useSystem(_ kind: Kind, _ name: String) {
        removeCopies(kind)
        defaults.set("system:" + name, forKey: key(kind))
        play(kind)
    }

    // Asks for an audio file and keeps a copy of it. Returns an error message if it can't be played.
    func chooseFile(_ kind: Kind) -> String? {
        NSApp.activate(ignoringOtherApps: true)
        let panel = NSOpenPanel()
        panel.title = L("Choose a sound for “\(kind.label)”", "为「\(kind.label)」选择声音")
        panel.allowedContentTypes = [.audio]
        guard panel.runModal() == .OK, let src = panel.url else { return nil }
        guard NSSound(contentsOf: src, byReference: true) != nil else { return L("This file can't be played. Try an mp3, wav, m4a or aiff file.", "这个文件无法播放，试试 mp3、wav、m4a 或 aiff 文件。") }
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DollPet/sounds", isDirectory: true)
        let dest = dir.appendingPathComponent("\(kind.rawValue).\(src.pathExtension.lowercased())")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            removeCopies(kind)
            try FileManager.default.copyItem(at: src, to: dest)
        } catch {
            return error.localizedDescription
        }
        defaults.set("file:" + dest.path, forKey: key(kind))
        defaults.set(src.lastPathComponent, forKey: key(kind) + ".name")
        play(kind)
        return nil
    }

    // Every copy kept for this kind (done.mp3, done.wav, ...), not only the one the setting points to: a copy the
    // setting no longer named was left behind, and the next file with that extension then failed to copy.
    private func removeCopies(_ kind: Kind) {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DollPet/sounds", isDirectory: true)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        for name in names where name.hasPrefix(kind.rawValue + ".") {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(name))
        }
        defaults.removeObject(forKey: key(kind) + ".name")
    }
}
