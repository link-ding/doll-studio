// DollPet: Doll Studio as one macOS app — the desktop pet plus the editor.
// The web runtime (index.html, pet.html, src/) is bundled under Resources/web and
// served through the doll:// scheme. The pet lives in a transparent, borderless,
// always-on-top window: the host tracks the cursor globally, makes transparent pixels
// click-through, drags the window and feeds microphone loudness for lip sync. The
// editor opens in a normal window and can hand its model straight to the pet.

import Cocoa
import SwiftUI
import UniformTypeIdentifiers
import WebKit

// Serves bundled web files at doll://app/<path>.
@MainActor
final class WebFiles: NSObject, WKURLSchemeHandler {
    static let base = URL(string: "doll://app/")!
    let root: URL
    // the wallpaper picture, served at doll://app/background (Wallpaper.swift)
    var background: URL?

    // Model files on their way to a page. Each is served once at the address offer(_:) returns, as bytes, so a big
    // PSD is not turned into base64 and pasted into a script (which held several copies of it in memory).
    private var offered: [String: URL] = [:]

    init(root: URL) { self.root = root.standardizedFileURL }

    func offer(_ file: URL) -> String {
        let token = UUID().uuidString
        offered[token] = file
        return "doll://app/model/" + token
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        if url.path.hasPrefix("/model/") {
            guard let file = offered.removeValue(forKey: url.lastPathComponent),
                  let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
                task.didFailWithError(URLError(.fileDoesNotExist)); return
            }
            let headers = ["Content-Type": "application/octet-stream", "Content-Length": String(data.count)]
            task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
            task.didReceive(data)
            task.didFinish()
            return
        }
        if url.path == "/background" {
            guard let (data, type) = backgroundData() else { task.didFailWithError(URLError(.fileDoesNotExist)); return }
            let headers = ["Content-Type": type, "Content-Length": String(data.count)]
            task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
            task.didReceive(data)
            task.didFinish()
            return
        }
        let file = root.appendingPathComponent(url.path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let types = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8",
                     "mjs": "text/javascript; charset=utf-8", "wasm": "application/wasm",
                     "css": "text/css; charset=utf-8", "json": "application/json", "png": "image/png",
                     "svg": "image/svg+xml"]
        let headers = ["Content-Type": types[file.pathExtension.lowercased()] ?? "application/octet-stream",
                       "Content-Length": String(data.count)]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}

final class PetWindow: NSWindow {
    override var canBecomeKey: Bool { true }
}

final class PetWebView: WKWebView {
    weak var host: AppDelegate?
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { host?.trackDrag() }
    // while the wallpaper is being adjusted (WallpaperEdit.swift), scrolling and pinching resize the character
    override func scrollWheel(with event: NSEvent) {
        if let host, host.wallEdit != nil { host.wallpaperScroll(event) } else { super.scrollWheel(with: event) }
    }
    override func magnify(with event: NSEvent) {
        if let host, host.wallEdit != nil { host.scaleWallpaper(1 + event.magnification) } else { super.magnify(with: event) }
    }
    override func keyDown(with event: NSEvent) {
        if let host, host.wallEdit != nil, host.wallpaperKey(event) { return }
        super.keyDown(with: event)
    }
    override func rightMouseDown(with event: NSEvent) {
        if let host { NSMenu.popUpContextMenu(host.menu, with: event, for: self) }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, NSWindowDelegate,
                         WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    var files: WebFiles!
    var window: PetWindow!
    var web: PetWebView!
    var editorWindow: NSWindow?
    var editorWeb: WKWebView?
    var statusItem: NSStatusItem!
    let popover = NSPopover()
    let menu = NSMenu() // the pet's right-click menu
    let defaults = UserDefaults.standard
    var aspect: CGFloat = 0.6
    // On the wallpaper: the character's aspect with no margin on sides where the artwork is cut off, and which
    // sides those are (a cut side sits right on the screen edge). See edgeBounds in player.js.
    var wallAspect: CGFloat = 0.6
    var cutLeft = false, cutRight = false
    // the desktop picture DollPet set last, put back on a Space that doesn't have it yet (Wallpaper.swift)
    var systemWallpaperFile: URL?
    // while the wallpaper is being adjusted on screen (WallpaperEdit.swift)
    var wallEdit: WallpaperEdit?
    var pageReady = false
    var dragging = false
    var lastMouse = NSPoint(x: -1, y: -1)
    // where the cursor was when the page was last asked whether it is on the character, and the ticks since (tick)
    var hitPoint: NSPoint?
    var hitWait = 0
    var micOn = false { didSet { settingsModel?.refresh() } }
    var cameraOn = false { didSet { settingsModel?.refresh() } }
    let bubble = Bubble()
    let recents = Recents()
    let sounds = Sounds()
    let recentMenu = NSMenu()
    // the editor page has loaded and can take a file; until then one waits here
    var editorReady = false
    var editorPending: URL?
    // The file last sent to or picked in the editor, until the editor says it opened it; then editorPath is where the
    // tuning done in the editor is kept ("drop:" and the file name for a file dropped onto the page, whose path the
    // app never sees).
    var editorFile: URL?
    var editorPath: String?
    // Thumbnails for the editor's recent cards are rendered one at a time in a hidden copy of the pet page (its own
    // web process, so the editor stays responsive); files that fail are not retried.
    var thumbWeb: WKWebView?
    var thumbing = false
    var thumbFailed: Set<String> = []

    static var sizes: [(String, CGFloat)] { [(L("Small", "小"), 280), (L("Medium", "中"), 420), (L("Large", "大"), 600), (L("Extra large", "特大"), 820)] }

    var size: CGFloat {
        get { CGFloat(defaults.object(forKey: "size") as? Double ?? 420) }
        set { defaults.set(Double(newValue), forKey: "size") }
    }
    var onTop: Bool {
        get { defaults.object(forKey: "onTop") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "onTop") }
    }
    var follow: Bool {
        get { defaults.object(forKey: "follow") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "follow") }
    }
    var locked: Bool {
        get { defaults.bool(forKey: "locked") }
        set { defaults.set(newValue, forKey: "locked") }
    }
    var alertSound: Bool {
        get { defaults.object(forKey: "alertSound") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "alertSound") }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        files = WebFiles(root: Bundle.main.resourceURL!.appendingPathComponent("web"))
        buildMainMenu()

        web = PetWebView(frame: .zero, configuration: webConfig(handler: "pet"))
        web.host = self
        web.uiDelegate = self
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")

        window = PetWindow(contentRect: NSRect(x: 0, y: 0, width: size * aspect, height: size),
                           styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        window.contentView = web
        applyLevel()
        restorePosition()
        migrateWallpaperPicture()
        if wallpaper { applyMode() }
        // a pet with DollPet's desktop picture still up (it quit before switching back): the user's own returns
        else if canRestoreDesktop { restoreSystemWallpaper(keepChoice: true) }
        web.load(URLRequest(url: URL(string: "pet.html", relativeTo: WebFiles.base)!))

        settingsModel = SettingsModel(app: self)
        buildMenu()
        buildPopover()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            // MenuBarIcon(@2x).png is a template image rendered by brand/make-icons.sh
            if let icon = NSImage(named: "MenuBarIcon") {
                icon.isTemplate = true
                icon.accessibilityDescription = "DollPet"
                button.image = icon
            } else {
                button.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "DollPet")
            }
            button.target = self
            button.action = #selector(statusClicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        window.orderFrontRegardless()

        let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.visibilityChanged() }
        }
        // a display added, removed or rearranged, or the Dock or menu bar resized
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.layoutWallpaper(); self?.syncSystemWallpaper() }
        }
        // the desktop picture is per Space: give a Space switched to the wallpaper's picture too
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.reapplySystemWallpaper() }
        }
        // posted on any thread
        NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.powerChanged() }
        }
        DistributedNotificationCenter.default().addObserver(forName: Bridge.notification, object: nil, queue: .main) { [weak self] n in
            let info = (n.userInfo as? [String: String]) ?? [:]
            MainActor.assumeIsolated { self?.agentEvent(info) }
        }
        if CommandLine.arguments.contains("--editor") { openEditor() }
        if CommandLine.arguments.contains("--settings") { openSettings() }
    }

    // MARK: coding agents

    func agentEvent(_ info: [String: String]) {
        let attention = info["kind"] == "attention"
        bubble.show(title: info["title"] ?? "", project: info["project"] ?? "", body: info["body"] ?? "",
                    attention: attention, above: petRect)
        js("pet.alert('\(attention ? "attention" : "done")')")
        if alertSound { sounds.play(attention ? .attention : .done) }
    }

    func setAgent(_ agent: Bridge.Agent, on: Bool) {
        let name = agent == .claude ? "Claude Code" : "Codex"
        do {
            try Bridge.edit(agent, connect: on)
            if on { agentEvent(["kind": "done", "title": L("Connected to \(name)", "已连接 \(name)"), "project": "", "body": L("Alerts start with your next \(name) session.", "从下一个 \(name) 会话开始提醒。")]) }
        } catch {
            alert(L("Could not connect \(name)", "无法连接 \(name)"), error.localizedDescription)
        }
    }

    func testAlert() { agentEvent(Bridge.message(source: "test", event: [:]) ?? [:]) }

    // MARK: settings

    var settingsWindow: NSWindow?
    var settingsModel: SettingsModel?

    @objc func openSettings() {
        if settingsWindow == nil, let model = settingsModel {
            let host = NSHostingController(rootView: SettingsView(model: model))
            host.sizingOptions = .preferredContentSize
            let w = NSWindow(contentViewController: host)
            w.title = L("DollPet Settings", "DollPet 设置")
            w.styleMask = [.titled, .closable]
            w.titlebarAppearsTransparent = true
            w.backgroundColor = NSColor(red: 0.969, green: 0.973, blue: 0.984, alpha: 1)
            w.appearance = NSAppearance(named: .aqua)
            w.isReleasedWhenClosed = false
            w.delegate = self
            w.center()
            settingsWindow = w
        }
        settingsModel?.refresh()
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        settingsWindow?.makeKeyAndOrderFront(nil)
    }

    func webConfig(handler: String) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(files, forURLScheme: "doll")
        config.userContentController.add(self, name: handler)
        config.userContentController.addUserScript(langScript())
        return config
    }

    // MARK: language (Lang.swift)

    // Tells each page the interface language before its scripts run (src/i18n.js reads window.DOLL_LANG).
    func langScript() -> WKUserScript {
        WKUserScript(source: "window.DOLL_LANG = '\(Lang.code)';", injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    // After the language setting changed: the menus, the windows' titles and the pages switch now.
    func applyLanguage() {
        buildMainMenu()
        menu.items.forEach { $0.submenu = nil } // the recent-models submenu is reused by the new item
        menu.removeAllItems()
        buildMenu()
        settingsWindow?.title = L("DollPet Settings", "DollPet 设置")
        for v in [web, editorWeb, thumbWeb].compactMap({ $0 }) {
            v.configuration.userContentController.removeAllUserScripts()
            v.configuration.userContentController.addUserScript(langScript())
            v.evaluateJavaScript("window.DOLL_LANG = '\(Lang.code)'; window.setDollLang?.('\(Lang.code)')", completionHandler: nil)
        }
        settingsModel?.refresh()
    }

    // MARK: page messages

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            pageReady = true
            js("pet.follow(\(follow))")
            powerChanged()
            layoutWallpaper()
            visibilityChanged()
            loadInitialModel()
            syncSystemWallpaper()
            // back after a reload (reloadPet): the microphone and camera go on again if they were
            if restoreMic { restoreMic = false; setMic(true) }
            if restoreCamera { restoreCamera = false; setCamera(true) }
        case "stuck":
            reloadPet() // the page lost its WebGL context and didn't get it back
        case "loaded":
            if let a = body["aspect"] as? Double, a > 0 { aspect = CGFloat(a) }
            if let a = body["wallAspect"] as? Double, a > 0 { wallAspect = CGFloat(a) }
            let cut = body["cut"] as? [String: Bool] ?? [:]
            cutLeft = cut["left"] ?? false
            cutRight = cut["right"] ?? false
            applySize()
        case "error":
            alert(L("Could not open the model", "无法打开模型"), body["message"] as? String ?? "")
        case "save":
            if let name = body["name"] as? String, let data = body["data"] as? String { save(data, as: name) }
        case "opened":
            let name = body["name"] as? String
            editorPath = editorFile?.lastPathComponent == name ? editorFile?.standardizedFileURL.path : name.map { "drop:" + $0 }
            editorFile = nil
            // the page finds the tuning that fits (this file's, or the same character's in another file) and does
            // nothing when none does
            if let path = editorPath {
                editorWeb?.evaluateJavaScript("studio.restore(\(RecentModel.saved(path)))", completionHandler: nil)
            }
        case "tuning":
            if let path = editorPath, let tuning = body["tuning"] as? String {
                let url = RecentModel.tuningURL(path)
                try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? tuning.write(to: url, atomically: true, encoding: .utf8)
                // its card's thumbnail is now stale; it is made again when the recent list is next shown
                // (sendRecentsToEditor), not here: a touch-up saves the tuning on every stroke, and remaking the
                // thumbnail reads and rigs the whole PSD again in a page that slows the editor down meanwhile
            }
        case "setPet":
            if let doll = body["doll"] as? String { setPet(doll) }
        case "lang":
            // the editor's language button
            if let l = body["lang"] as? String, l != Lang.code {
                Lang.setting = l
                applyLanguage()
            }
        case "editorReady":
            editorReady = true
            sendRecentsToEditor()
            if let url = editorPending { editorPending = nil; sendToEditor(url) }
        case "recents":
            sendRecentsToEditor()
        case "openRecent":
            if let path = body["path"] as? String { openInEditor(URL(fileURLWithPath: path)) }
        case "mic", "camera":
            let on = body["on"] as? Bool ?? false
            if type == "mic" { micOn = on } else { cameraOn = on }
            if let err = body["error"] as? String {
                alert(type == "mic" ? L("Could not open the microphone", "无法打开麦克风") : L("Could not start face tracking", "无法启动面部捕捉"),
                      err + L("\n\nIf this is a permission problem, allow DollPet in System Settings › Privacy & Security › \(type == "mic" ? "Microphone" : "Camera").",
                              "\n\n如果是权限问题，请在「系统设置 › 隐私与安全性 › \(type == "mic" ? "麦克风" : "摄像头")」里允许 DollPet。"))
            }
        case "calibrated":
            if body["ok"] as? Bool != true { alert(L("No face found yet", "还没找到脸"), L("Face the camera and click Calibrate again.", "请正对摄像头，再点一次「校准」。")) }
        default:
            break
        }
    }

    func js(_ code: String) {
        web.evaluateJavaScript(code, completionHandler: nil)
    }

    // In Low Power Mode the page draws half as many frames.
    func powerChanged() {
        guard pageReady else { return }
        js("pet.lowPower(\(ProcessInfo.processInfo.isLowPowerModeEnabled))")
    }

    // MARK: recovery
    // The app runs for days. macOS can end a page's web process at any time (memory pressure, a WebKit crash), which
    // leaves its view blank, so each page is loaded again and put back as it was.

    var restoreMic = false, restoreCamera = false
    var petReloads: [Date] = []

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === web {
            reloadPet()
        } else if webView === editorWeb {
            editorReady = false
            // the file that was open is opened again; its tuning and touch-ups were saved as they were made. A file
            // dropped onto the page can't be (the app never saw its path).
            if let path = editorPath, !path.hasPrefix("drop:") { editorPending = URL(fileURLWithPath: path) }
            webView.load(URLRequest(url: URL(string: "index.html", relativeTo: WebFiles.base)!))
        } else if webView === thumbWeb {
            thumbWeb = nil // made again for the next thumbnail
        }
    }

    // Loads the pet page again; its "ready" message then brings back the model, the mode and the microphone and
    // camera. A page that keeps failing (a model it can't hold, say) is given up on after three tries in a minute.
    func reloadPet() {
        let now = Date()
        petReloads = petReloads.filter { now.timeIntervalSince($0) < 60 } + [now]
        if petReloads.count > 3 {
            if petReloads.count == 4 {
                alert(L("The pet stopped working", "桌宠停止工作了"), L("DollPet restarted it three times and it stopped again. Open another model, or quit and reopen DollPet.", "DollPet 已经重启了三次，它又停了。换一个模型，或者退出后重新打开 DollPet。"))
            }
            return
        }
        restoreMic = restoreMic || micOn
        restoreCamera = restoreCamera || cameraOn
        micOn = false
        cameraOn = false
        pageReady = false
        web.load(URLRequest(url: URL(string: "pet.html", relativeTo: WebFiles.base)!))
    }

    // MARK: models

    func loadInitialModel() {
        if let path = defaults.string(forKey: "modelPath"), FileManager.default.fileExists(atPath: path) {
            load(URL(fileURLWithPath: path))
        } else if let bundled = Bundle.main.url(forResource: "default", withExtension: "psd")
                    ?? Bundle.main.url(forResource: "default", withExtension: "doll") {
            load(bundled)
        } else {
            openModel()
        }
    }

    func load(_ url: URL) {
        guard FileManager.default.isReadableFile(atPath: url.path) else {
            alert(L("Could not read the file", "无法读取文件"), url.path)
            return
        }
        let ext = url.pathExtension.lowercased()
        let kind = ext == "psd" || ext == "psb" ? "psd" : "doll"
        js("pet.load('\(kind)', '\(files.offer(url))', \(RecentModel.saved(url.standardizedFileURL.path)))")
        if !url.path.hasPrefix(Bundle.main.bundlePath) { defaults.set(url.path, forKey: "modelPath") }
        recents.add(url)
        settingsModel?.refresh()
    }

    // MARK: recent models

    @objc func useRecent(_ sender: NSMenuItem) {
        if let path = sender.representedObject as? String { load(URL(fileURLWithPath: path)) }
    }

    // Menu items for the recent models: the file name, and its folder (files from See-through are often all
    // called seethrough_output.psd).
    func recentItems(_ action: Selector) -> [NSMenuItem] {
        let list = recents.existing.prefix(15)
        if list.isEmpty {
            let it = NSMenuItem(title: L("No models opened yet", "还没有打开过模型"), action: nil, keyEquivalent: "")
            it.isEnabled = false
            return [it]
        }
        return list.map { r in
            let it = item("\(r.name)  ·  \(r.folder)", action)
            it.representedObject = r.path
            it.toolTip = r.path
            if r.path == defaults.string(forKey: "modelPath") { it.state = .on }
            return it
        }
    }

    // Opens a model file in the editor (opening the editor first if needed).
    func openInEditor(_ url: URL) {
        openEditor()
        recents.add(url)
        settingsModel?.refresh()
        if editorReady { sendToEditor(url) } else { editorPending = url }
    }

    func sendToEditor(_ url: URL) {
        guard FileManager.default.isReadableFile(atPath: url.path) else { alert(L("Could not read the file", "无法读取文件"), url.path); return }
        let ext = url.pathExtension.lowercased()
        let kind = ext == "psd" || ext == "psb" ? "psd" : "doll"
        let name = (try? JSONSerialization.data(withJSONObject: url.lastPathComponent, options: .fragmentsAllowed))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "\"model\""
        editorFile = url
        editorWeb?.evaluateJavaScript("studio.openFromHost('\(kind)', '\(files.offer(url))', \(name))", completionHandler: nil)
    }

    @objc func openModel() {
        NSApp.activate(ignoringOtherApps: true)
        let panel = NSOpenPanel()
        panel.title = L("Choose a model (.doll, or a PSD from See-through)", "选择模型（.doll，或 See-through 拆好的 PSD）")
        panel.allowedContentTypes = ["doll", "psd", "psb", "json"].compactMap { UTType(filenameExtension: $0) }
        if panel.runModal() == .OK, let url = panel.url { load(url) }
    }

    // The editor's model becomes the pet; it is kept in Application Support so it survives restarts.
    func setPet(_ doll: String) {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DollPet", isDirectory: true)
        let url = dir.appendingPathComponent("current.doll")
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try doll.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            alert(L("Could not save the pet model", "无法保存桌宠模型"), error.localizedDescription)
            return
        }
        load(url)
        window.orderFrontRegardless()
    }

    // MARK: editor

    @objc func openEditor() {
        if editorWindow == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            w.title = "Doll Studio"
            // the page's header continues the light title bar
            w.titlebarAppearsTransparent = true
            w.backgroundColor = .white
            w.appearance = NSAppearance(named: .aqua)
            w.isReleasedWhenClosed = false
            w.delegate = self
            w.minSize = NSSize(width: 900, height: 560)
            let v = WKWebView(frame: .zero, configuration: webConfig(handler: "studio"))
            v.uiDelegate = self
            v.navigationDelegate = self
            w.contentView = v
            v.load(URLRequest(url: URL(string: "index.html", relativeTo: WebFiles.base)!))
            w.center()
            editorWindow = w
            editorWeb = v
            editorReady = false
        }
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        editorWindow?.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        // Back to a menu-bar-only app once neither the editor nor settings is open.
        let closing = notification.object as? NSWindow
        let open = [editorWindow, settingsWindow].contains { $0 != nil && $0 !== closing && $0!.isVisible }
        if !open { NSApp.setActivationPolicy(.accessory) }
    }

    // <input type="file"> in the editor.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        // models picked here go on the recent list too
        let done: @MainActor ([URL]?) -> Void = { [weak self] urls in
            urls?.forEach { self?.recents.add($0) }
            if webView === self?.editorWeb, let url = urls?.first { self?.editorFile = url }
            self?.settingsModel?.refresh()
            completionHandler(urls)
        }
        // WebKit aborts the app if the picker's answer is dropped, which happens when a sheet can't be shown
        // (one is already up, e.g. after a double click), so that case answers "nothing picked" right away
        if let w = webView.window, w.attachedSheet != nil {
            done(nil)
        } else if let w = webView.window {
            panel.beginSheetModal(for: w) { r in done(r == .OK ? panel.urls : nil) }
        } else {
            done(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    func save(_ text: String, as name: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        let write = { [weak self] (r: NSApplication.ModalResponse) in
            guard r == .OK, let url = panel.url else { return }
            do { try text.write(to: url, atomically: true, encoding: .utf8) }
            catch { self?.alert(L("Could not save", "无法保存"), error.localizedDescription) }
        }
        if let w = editorWindow { panel.beginSheetModal(for: w, completionHandler: write) } else { write(panel.runModal()) }
    }

    // MARK: pet window

    func applySize() {
        if wallpaper { layoutWallpaper(); return }
        let h = size, w = (h * aspect).rounded()
        var f = window.frame
        let cx = f.midX
        f.size = NSSize(width: w, height: h)
        f.origin.x = cx - w / 2
        window.setFrame(f, display: true)
        savePosition()
    }

    func applyLevel() {
        if wallpaper { return } // the wallpaper's level is set by applyMode
        window.level = onTop ? .floating : .normal
    }

    func restorePosition() {
        var f = window.frame
        if let x = defaults.object(forKey: "x") as? Double, let y = defaults.object(forKey: "y") as? Double {
            f.origin = NSPoint(x: x, y: y)
        }
        if !NSScreen.screens.contains(where: { $0.visibleFrame.intersects(f) }), let s = NSScreen.main?.visibleFrame {
            f.origin = NSPoint(x: s.maxX - f.width - 40, y: s.minY + 20)
        }
        window.setFrameOrigin(f.origin)
    }

    func savePosition() {
        if wallpaper { return }
        defaults.set(Double(window.frame.minX), forKey: "x")
        defaults.set(Double(window.frame.minY), forKey: "y")
    }

    // Drag the window by the character; a click without movement pokes it instead.
    func trackDrag() {
        // the wallpaper only takes the mouse while it is being adjusted
        if wallpaper { if wallEdit != nil { trackWallpaperEdit() }; return }
        dragging = true
        defer { dragging = false; savePosition() }
        let start = NSEvent.mouseLocation, origin = window.frame.origin
        var moved = false
        while let e = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
            if e.type == .leftMouseUp { break }
            let p = NSEvent.mouseLocation
            let dx = p.x - start.x, dy = p.y - start.y
            if !moved && hypot(dx, dy) < 3 { continue }
            moved = true
            window.setFrameOrigin(NSPoint(x: origin.x + dx, y: origin.y + dy))
        }
        if !moved { js("pet.poke()") }
    }

    // 30 Hz: global gaze, microphone level, and click-through on transparent pixels.
    func tick() {
        guard pageReady else { return }
        if bubble.isVisible { bubble.place(above: petRect) }
        let p = NSEvent.mouseLocation, f = window.frame
        let x = p.x - f.minX, y = f.maxY - p.y
        if follow && p != lastMouse {
            lastMouse = p
            // on the wallpaper the character is bigger and the cursor further away
            js("pet.pointer(\(x),\(y),\(wallpaper ? max(520, (petRect.height * 0.8).rounded()) : 520))")
        }
        // the wallpaper never takes the mouse, so clicks go to the desktop, except while it is being adjusted
        if wallpaper { window.ignoresMouseEvents = wallEdit == nil; return }
        if dragging { return }
        if locked || !f.contains(p) {
            window.ignoresMouseEvents = true
            hitPoint = nil
            return
        }
        // Asking the page reads a pixel back from the graphics card, so it is done when the cursor has moved, and
        // only three times a second while it rests on the window (the character moves a little under it).
        hitWait += 1
        if p == hitPoint && hitWait < 10 { return }
        hitPoint = p
        hitWait = 0
        web.evaluateJavaScript("pet.hit(\(x),\(y))") { [weak self] result, _ in
            MainActor.assumeIsolated {
                guard let self, !self.dragging else { return }
                self.window.ignoresMouseEvents = !((result as? Bool) ?? false)
            }
        }
    }

    // MARK: microphone and camera
    // Both run in the pet page (voice.js, tracking.js); the page reports back with "mic" / "camera" messages.

    func setMic(_ on: Bool) { js("pet.mic(\(on))") }
    func setCamera(_ on: Bool) { js("pet.camera(\(on))") }
    func calibrateCamera() { js("pet.calibrate()") }

    // Camera and microphone requests from our own pages (the pet's and the editor's) are allowed; macOS still asks
    // the user once for DollPet itself.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        decisionHandler(origin.protocol == "doll" ? .grant : .deny)
    }

    // MARK: menus

    // Shown while the editor window is open (the app is a regular app then).
    func buildMainMenu() {
        let main = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(item(L("Settings…", "设置…"), #selector(openSettings), key: ","))
        appMenu.addItem(item(L("Open Editor", "打开编辑器"), #selector(openEditor), key: "e"))
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L("Quit DollPet", "退出 DollPet"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editMenu = NSMenu(title: L("Edit", "编辑"))
        editMenu.addItem(withTitle: L("Undo", "撤销"), action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: L("Redo", "重做"), action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: L("Cut", "剪切"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: L("Copy", "拷贝"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: L("Paste", "粘贴"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: L("Select All", "全选"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let windowMenu = NSMenu(title: L("Window", "窗口"))
        windowMenu.addItem(withTitle: L("Close", "关闭"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: L("Minimize", "最小化"), action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        for sub in [appMenu, editMenu, windowMenu] {
            let it = NSMenuItem()
            it.submenu = sub
            main.addItem(it)
        }
        NSApp.mainMenu = main
    }

    // The pet's right-click menu (the status item opens the popover instead).
    func buildMenu() {
        menu.delegate = self
        menu.addItem(item(L("Open Editor…", "打开编辑器…"), #selector(openEditor), key: "e"))
        menu.addItem(item(L("Open Model…", "打开模型…"), #selector(openModel), key: "o"))
        let recentItem = NSMenuItem(title: L("Recent Models", "最近的模型"), action: nil, keyEquivalent: "")
        recentItem.submenu = recentMenu // filled each time the menu opens
        menu.addItem(recentItem)
        menu.addItem(.separator())
        menu.addItem(item(L("Wallpaper Mode", "壁纸模式"), #selector(toggleWallpaper)))
        menu.addItem(item(L("Adjust Wallpaper on Screen…", "在屏幕上调整壁纸…"), #selector(adjustWallpaper)))
        let sizeItem = NSMenuItem(title: L("Size", "大小"), action: nil, keyEquivalent: "")
        let sizeMenu = NSMenu()
        for (name, h) in Self.sizes {
            let it = item(name, #selector(pickSize(_:)))
            it.tag = Int(h)
            sizeMenu.addItem(it)
        }
        sizeItem.submenu = sizeMenu
        menu.addItem(sizeItem)
        menu.addItem(item(L("Always on Top", "置顶"), #selector(toggleOnTop)))
        menu.addItem(item(L("Follow Cursor", "跟随鼠标"), #selector(toggleFollow)))
        menu.addItem(item(L("Lip Sync", "麦克风口型"), #selector(toggleMic)))
        menu.addItem(item(L("Face Tracking", "面部捕捉"), #selector(toggleCamera)))
        menu.addItem(item(L("Click-Through (Lock Position)", "鼠标穿透（锁定位置）"), #selector(toggleLocked)))
        menu.addItem(.separator())
        menu.addItem(item(L("Settings…", "设置…"), #selector(openSettings), key: ","))
        menu.addItem(.separator())
        menu.addItem(item(L("Quit DollPet", "退出 DollPet"), #selector(quit), key: "q"))
    }

    // MARK: menu bar popover

    func buildPopover() {
        guard let model = settingsModel else { return }
        let host = NSHostingController(rootView: PopoverView(model: model, close: { [weak self] in self?.popover.performClose(nil) }))
        host.sizingOptions = .preferredContentSize
        popover.contentViewController = host
        popover.behavior = .transient
        popover.animates = true
        popover.appearance = NSAppearance(named: .aqua)
    }

    // Left click toggles the popover; right click shows the classic menu.
    @objc func statusClicked(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            popover.performClose(nil)
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.height + 4), in: sender)
            return
        }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            settingsModel?.refresh()
            NSApp.activate(ignoringOtherApps: true)
            popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    // The editor's welcome screen lists the recent models as cards.
    func sendRecentsToEditor() {
        guard editorReady, let editorWeb else { return }
        let list: [[String: Any]] = recents.existing.prefix(8).map {
            var card: [String: Any] = ["name": $0.name, "folder": $0.folder, "path": $0.path, "ago": $0.agoText,
                                       "current": $0.path == defaults.string(forKey: "modelPath")]
            if let png = $0.thumb { card["thumb"] = "data:image/png;base64," + png.base64EncodedString() }
            return card
        }
        guard let data = try? JSONSerialization.data(withJSONObject: list), let json = String(data: data, encoding: .utf8) else { return }
        editorWeb.evaluateJavaScript("studio.setRecents(\(json))", completionHandler: nil)
        makeThumbs()
    }

    // Renders the next recent card that has no thumbnail yet in the editor page, saves it, and shows it on its card.
    func makeThumbs() {
        guard !thumbing, editorReady,
              let r = recents.existing.prefix(8).first(where: { !thumbFailed.contains($0.path) && $0.thumb == nil }) else { return }
        guard FileManager.default.isReadableFile(atPath: r.path) else { thumbFailed.insert(r.path); return makeThumbs() }
        let ext = r.url.pathExtension.lowercased()
        thumbing = true
        if thumbWeb == nil {
            let config = WKWebViewConfiguration()
            config.setURLSchemeHandler(files, forURLScheme: "doll")
            let v = WKWebView(frame: NSRect(x: 0, y: 0, width: 320, height: 320), configuration: config)
            v.navigationDelegate = self
            v.load(URLRequest(url: URL(string: "pet.html", relativeTo: WebFiles.base)!))
            thumbWeb = v
        }
        // the page may still be loading its modules
        thumbWeb!.callAsyncJavaScript("while (!window.pet) await new Promise(r => setTimeout(r, 50)); return await pet.thumb(kind, url, tuning && JSON.parse(tuning))",
                                      arguments: ["kind": ext == "psd" || ext == "psb" ? "psd" : "doll", "url": files.offer(r.url),
                                                  "tuning": RecentModel.saved(r.path)],
                                      in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            self.thumbing = false
            if case .success(let value) = result, let png = value as? String,
               let comma = png.firstIndex(of: ","), let bytes = Data(base64Encoded: String(png[png.index(after: comma)...])) {
                try? FileManager.default.createDirectory(at: r.thumbURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? bytes.write(to: r.thumbURL)
                if let json = try? JSONSerialization.data(withJSONObject: [r.path, png]), let args = String(data: json, encoding: .utf8) {
                    self.editorWeb?.evaluateJavaScript("studio.setThumb(...\(args))", completionHandler: nil)
                }
            } else {
                self.thumbFailed.insert(r.path)
                // the page may have gone down with it (a file too big to hold): the next one gets a fresh page
                self.thumbWeb = nil
            }
            self.makeThumbs()
        }
    }

    func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
        it.target = self
        return it
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        recentMenu.removeAllItems()
        recentItems(#selector(useRecent(_:))).forEach(recentMenu.addItem)
        for it in menu.items + menu.items.flatMap({ $0.submenu?.items ?? [] }) {
            if it.action == #selector(adjustWallpaper) { it.isHidden = !wallpaper || wallEdit != nil; continue }
            let on: Bool
            switch it.action {
            case #selector(toggleOnTop): on = onTop
            case #selector(toggleFollow): on = follow
            case #selector(toggleMic): on = micOn
            case #selector(toggleCamera): on = cameraOn
            case #selector(toggleLocked): on = locked
            case #selector(toggleWallpaper): on = wallpaper
            case #selector(pickSize(_:)): on = CGFloat(it.tag) == size
            default: continue
            }
            it.state = on ? .on : .off
        }
    }

    // Menu changes are mirrored in the settings window, if it is open.
    @objc func pickSize(_ sender: NSMenuItem) { size = CGFloat(sender.tag); applySize(); settingsModel?.refresh() }
    @objc func toggleOnTop() { onTop.toggle(); applyLevel(); settingsModel?.refresh() }
    @objc func toggleFollow() { follow.toggle(); js("pet.follow(\(follow))"); settingsModel?.refresh() }
    @objc func toggleMic() { setMic(!micOn) }
    @objc func toggleCamera() { setCamera(!cameraOn) }
    @objc func toggleLocked() { locked.toggle(); settingsModel?.refresh() }
    @objc func quit() { NSApp.terminate(nil) }

    func alert(_ title: String, _ text: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.runModal()
    }
}
