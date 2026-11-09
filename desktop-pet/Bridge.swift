// Bridge to coding agents. Claude Code hooks and Codex's `notify` setting run this
// binary as `DollPet notify <claude|codex>`; it turns the agent's event into a short
// message and hands it to the running pet as a distributed notification.
// connect/disconnect add or remove those entries in the agents' config files.

import Foundation

struct BridgeError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum Bridge {
    enum Agent: String { case claude, codex }

    static let notification = Notification.Name("studio.doll.pet.notify")

    static var home: URL { URL(fileURLWithPath: ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()) }
    static var claudeSettings: URL { home.appendingPathComponent(".claude/settings.json") }
    static var codexConfig: URL { home.appendingPathComponent(".codex/config.toml") }
    static var executable: String { Bundle.main.executablePath ?? CommandLine.arguments[0] }

    // MARK: notify client

    // Codex runs a single notify program. When another one was set, DollPet's line keeps it
    // after this marker and passes every event on to it.
    static let chainMarker = "--then"

    // arguments: <source> [--then <program> [args…]] [json]. Codex appends the event JSON
    // as the last argument, so the chained program gets exactly what Codex would have sent it.
    static func notify(arguments: [String]) {
        let source = arguments.first ?? "test"
        var payload = arguments.count > 1 ? arguments.last : nil
        if let i = arguments.firstIndex(of: chainMarker) {
            run(Array(arguments[(i + 1)...])) // already ends with the payload
            if arguments.count - 1 <= i + 1 { payload = nil } // last argument is the marker or the program
        }
        notify(source: source, payload: payload)
    }

    // Starts argv without waiting for it; a bare program name is looked up on PATH.
    static func run(_ argv: [String]) {
        guard let program = argv.first, !program.isEmpty else { return }
        let p = Process()
        if program.contains("/") {
            p.executableURL = URL(fileURLWithPath: (program as NSString).expandingTildeInPath)
            p.arguments = Array(argv.dropFirst())
        } else {
            p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            p.arguments = argv
        }
        try? p.run()
    }

    // Claude Code passes the event as JSON on stdin; Codex passes it as the last argument.
    static func notify(source: String, payload: String?) {
        var event: [String: Any] = [:]
        let raw = payload.map { Data($0.utf8) } ?? (source == "claude" ? FileHandle.standardInput.readDataToEndOfFile() : nil)
        if let raw, let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] { event = obj }
        guard let info = message(source: source, event: event) else { return }
        DistributedNotificationCenter.default().postNotificationName(notification, object: nil, userInfo: info, deliverImmediately: true)
    }

    static func message(source: String, event: [String: Any]) -> [String: String]? {
        let project = (event["cwd"] as? String).map { URL(fileURLWithPath: $0).lastPathComponent } ?? ""
        switch source {
        case "claude":
            if event["stop_hook_active"] as? Bool == true { return nil }
            if event["hook_event_name"] as? String == "Notification" {
                return ["kind": "attention", "title": L("Claude Code needs your OK", "Claude Code 需要你确认"), "project": project,
                        "body": summary(event["message"] as? String ?? "")]
            }
            let last = (event["transcript_path"] as? String).flatMap(lastAssistantText) ?? ""
            return ["kind": "done", "title": L("Claude Code finished", "Claude Code 完成了"), "project": project, "body": summary(last)]
        case "codex":
            guard event["type"] as? String == "agent-turn-complete" else { return nil }
            return ["kind": "done", "title": L("Codex finished", "Codex 完成了"), "project": project,
                    "body": summary(event["last-assistant-message"] as? String ?? "")]
        default:
            return ["kind": "done", "title": L("Test alert", "测试提醒"), "project": "DollPet", "body": L("Alerts are working. I'll let you know when a task finishes.", "提醒正常。任务完成时我会告诉你。")]
        }
    }

    // The last assistant text in a Claude Code transcript (JSONL); only the tail is read.
    static func lastAssistantText(_ path: String) -> String? {
        guard let h = FileHandle(forReadingAtPath: path) else { return nil }
        defer { try? h.close() }
        let size = (try? h.seekToEnd()) ?? 0
        try? h.seek(toOffset: size > 262_144 ? size - 262_144 : 0)
        guard let data = try? h.readToEnd() else { return nil }
        for line in String(decoding: data, as: UTF8.self).split(separator: "\n").reversed() {
            guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  obj["type"] as? String == "assistant",
                  let content = (obj["message"] as? [String: Any])?["content"] as? [[String: Any]] else { continue }
            let texts = content.compactMap { $0["type"] as? String == "text" ? $0["text"] as? String : nil }
            if !texts.isEmpty { return texts.joined(separator: " ") }
        }
        return nil
    }

    static func summary(_ s: String, limit: Int = 110) -> String {
        let t = s.replacingOccurrences(of: #"[*_`#>|]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return t.count > limit ? String(t.prefix(limit)) + "…" : t
    }

    // MARK: connect / disconnect

    static func isConnected(_ agent: Agent) -> Bool {
        switch agent {
        case .claude:
            guard let data = try? Data(contentsOf: claudeSettings),
                  let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let groups = (root["hooks"] as? [String: Any])?["Stop"] as? [[String: Any]] else { return false }
            return groups.contains(where: isOurClaudeGroup)
        case .codex:
            guard let text = try? String(contentsOf: codexConfig, encoding: .utf8) else { return false }
            return text.components(separatedBy: "\n").contains(where: isOurCodexLine)
        }
    }

    static func edit(_ agent: Agent, connect: Bool) throws {
        switch agent {
        case .claude: try editClaude(connect)
        case .codex: try editCodex(connect)
        }
    }

    static func isOurClaudeGroup(_ group: [String: Any]) -> Bool {
        (group["hooks"] as? [[String: Any]] ?? []).contains {
            let cmd = $0["command"] as? String ?? ""
            return cmd.contains("DollPet") && cmd.hasSuffix(" notify claude")
        }
    }

    static func isOurCodexLine(_ line: String) -> Bool {
        line.range(of: #"^\s*notify\s*="#, options: .regularExpression) != nil
            && line.contains("DollPet") && line.contains("\"codex\"")
    }

    static var backups: URL { home.appendingPathComponent("Library/Application Support/DollPet/Backups", isDirectory: true) }

    // Writes <file>.dollpet-backup (the file as it was before the latest change) with the same permissions as the
    // original, since agent configs can hold tokens. That one is overwritten by the next change, so a dated copy
    // also goes to Application Support/DollPet/Backups, where the last ten of each file are kept.
    static func backup(_ data: Data, of url: URL) throws {
        let fm = FileManager.default
        let dest = url.appendingPathExtension("dollpet-backup")
        try data.write(to: dest)
        if let mode = try? fm.attributesOfItem(atPath: url.resolvingSymlinksInPath().path)[.posixPermissions] {
            try fm.setAttributes([.posixPermissions: mode], ofItemAtPath: dest.path)
        }
        // the history is a bonus: failing to keep it doesn't stop the change
        let suffix = "-" + url.lastPathComponent
        let kept = ((try? fm.contentsOfDirectory(atPath: backups.path)) ?? []).filter { $0.hasSuffix(suffix) }.sorted()
        if let newest = kept.last, (try? Data(contentsOf: backups.appendingPathComponent(newest))) == data { return }
        let stamp = DateFormatter()
        stamp.locale = Locale(identifier: "en_US_POSIX")
        stamp.dateFormat = "yyyyMMdd-HHmmss"
        let copy = backups.appendingPathComponent(stamp.string(from: Date()) + suffix)
        try? fm.createDirectory(at: backups, withIntermediateDirectories: true)
        guard fm.createFile(atPath: copy.path, contents: data, attributes: [.posixPermissions: 0o600]) else { return }
        for old in kept.dropLast(9) { try? fm.removeItem(at: backups.appendingPathComponent(old)) }
    }

    // Replaces a config file in one step, so a crash or a full disk part-way can't leave half a file. It is written
    // through a symlink (a settings file that is a link stays one) and keeps its permissions.
    static func write(_ data: Data, to url: URL) throws {
        let fm = FileManager.default, target = url.resolvingSymlinksInPath()
        let mode = try? fm.attributesOfItem(atPath: target.path)[.posixPermissions]
        try data.write(to: target, options: .atomic)
        if let mode { try? fm.setAttributes([.posixPermissions: mode], ofItemAtPath: target.path) }
    }

    // Adds (or removes) a Stop and a Notification hook in ~/.claude/settings.json.
    // Earlier DollPet entries are replaced, so reconnecting after moving the app works.
    static func editClaude(_ add: Bool) throws {
        let url = claudeSettings
        var root: [String: Any] = [:]
        if let data = try? Data(contentsOf: url), !data.isEmpty {
            guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw BridgeError(message: L("~/.claude/settings.json is not valid JSON, so it was left unchanged.", "~/.claude/settings.json 不是有效的 JSON，没有改动它。"))
            }
            root = obj
            try backup(data, of: url)
        } else if !add {
            return
        }
        var hooks = root["hooks"] as? [String: Any] ?? [:]
        for event in ["Stop", "Notification"] {
            var groups = (hooks[event] as? [[String: Any]] ?? []).filter { !isOurClaudeGroup($0) }
            if add {
                groups.append(["hooks": [["type": "command", "command": "\"\(executable)\" notify claude", "timeout": 10]]])
            }
            hooks[event] = groups.isEmpty ? nil : groups
        }
        root["hooks"] = hooks.isEmpty ? nil : hooks
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try write(JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .withoutEscapingSlashes]), to: url)
    }

    // Adds (or removes) a top-level `notify = [...]` line in ~/.codex/config.toml.
    // Codex takes one notify program, so another program's setting is kept inside
    // DollPet's line (after --then) and put back on disconnect.
    static func editCodex(_ add: Bool) throws {
        let url = codexConfig
        let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        var lines = text.isEmpty ? [] : text.components(separatedBy: "\n")
        let firstTable = lines.firstIndex { $0.trimmingCharacters(in: .whitespaces).hasPrefix("[") } ?? lines.count
        var at = 0
        var chained: [String] = []
        if let i = lines[..<firstTable].firstIndex(where: { $0.range(of: #"^\s*notify\s*="#, options: .regularExpression) != nil }) {
            at = i
            if isOurCodexLine(lines[i]) {
                if let argv = tomlStringArray(lines[i]), let m = argv.firstIndex(of: chainMarker) {
                    chained = Array(argv[(m + 1)...])
                }
            } else {
                if !add { return }
                guard let argv = tomlStringArray(lines[i]), !argv.isEmpty else {
                    throw BridgeError(message: L("Codex already has a notify setting DollPet can't read (~/.codex/config.toml line \(i + 1)). DollPet left it in place.", "Codex 已经有一个 DollPet 读不懂的 notify 设置（~/.codex/config.toml 第 \(i + 1) 行），DollPet 没有改动它。"))
                }
                chained = argv
            }
            lines.remove(at: i)
        } else if !add {
            return
        }
        if add {
            let argv = [executable, "notify", "codex"] + (chained.isEmpty ? [] : [chainMarker] + chained)
            lines.insert(notifyLine(argv), at: at)
        } else if !chained.isEmpty {
            lines.insert(notifyLine(chained), at: at)
        }
        if !text.isEmpty { try backup(Data(text.utf8), of: url) }
        var out = lines.joined(separator: "\n")
        if !out.isEmpty && !out.hasSuffix("\n") { out += "\n" }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try write(Data(out.utf8), to: url)
    }

    static func notifyLine(_ argv: [String]) -> String {
        "notify = [" + argv.map(tomlString).joined(separator: ", ") + "]"
    }

    static func tomlString(_ s: String) -> String {
        var out = "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\t": out += "\\t"
            case "\r": out += "\\r"
            default:
                if u.value < 0x20 || u.value == 0x7f { out += String(format: "\\u%04X", u.value) }
                else { out.unicodeScalars.append(u) }
            }
        }
        return out + "\""
    }

    // Reads `key = ["a", 'b', …]` written on one line; nil for anything else
    // (a multi-line array, a non-string item, trailing junk).
    static func tomlStringArray(_ line: String) -> [String]? {
        guard let eq = line.firstIndex(of: "=") else { return nil }
        var it = Array(line[line.index(after: eq)...].unicodeScalars)[...]
        func skipSpace() { while let c = it.first, c == " " || c == "\t" { it.removeFirst() } }
        skipSpace()
        guard it.popFirst() == "[" else { return nil }
        var items: [String] = []
        while true {
            skipSpace()
            guard let c = it.popFirst() else { return nil }
            if c == "]" { break }
            if c == "," && !items.isEmpty { continue }
            var s = String.UnicodeScalarView()
            if c == "'" {
                while true {
                    guard let d = it.popFirst() else { return nil }
                    if d == "'" { break }
                    s.append(d)
                }
            } else if c == "\"" {
                while true {
                    guard let d = it.popFirst() else { return nil }
                    if d == "\"" { break }
                    guard d == "\\" else { s.append(d); continue }
                    guard let e = it.popFirst() else { return nil }
                    switch e {
                    case "\"": s.append("\"")
                    case "\\": s.append("\\")
                    case "n": s.append("\n")
                    case "t": s.append("\t")
                    case "r": s.append("\r")
                    case "b": s.append("\u{8}")
                    case "f": s.append("\u{C}")
                    case "e": s.append("\u{1B}")
                    case "u", "U":
                        let n = e == "u" ? 4 : 8
                        guard it.count >= n, let v = UInt32(String(String.UnicodeScalarView(it.prefix(n))), radix: 16),
                              let scalar = Unicode.Scalar(v) else { return nil }
                        it.removeFirst(n)
                        s.append(scalar)
                    default: return nil
                    }
                }
            } else {
                return nil
            }
            items.append(String(s))
        }
        skipSpace()
        if let c = it.first, c != "#" { return nil }
        return items
    }
}
