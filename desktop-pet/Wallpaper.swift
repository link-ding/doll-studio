// Wallpaper mode: the pet window becomes the desktop. It fills the menu-bar screen at the level just under the
// desktop icons, ignores the mouse (clicks reach the Finder desktop), and the page draws the character standing at
// the bottom of the screen over a background: the desktop picture itself (the page is transparent), one of the
// animated scenes (src/scenes.js), one of the rooms, or a picture of the user's (UserPictures.swift). The character keeps breathing, blinking and watching
// the cursor, at 30 frames a second, and everything stops animating while the desktop is covered.
//
// A scene or a picture also becomes the system desktop picture of that screen (a still of the scene), so it is
// there in Mission Control, on the lock screen, on other Spaces and after DollPet quits. The picture the user had
// is remembered the first time and put back by "Restore" or by choosing "Desktop picture" again.

import Cocoa
import UniformTypeIdentifiers

struct WallpaperBackground {
    let id: String
    let name: String
    // the swatch: a check of `accent` over `base`, with a symbol
    let base: UInt32
    let accent: UInt32
    let symbol: String
    let symbolColor: UInt32
    // a room (src/rooms.js): its picture under Resources/web, which is also the desktop picture; its swatch is a
    // thumbnail of it (Resources/thumbs, made by build.sh)
    var image: String? = nil
    // a picture of the user's (UserPictures.swift)
    var file: URL? = nil

    // "picture" is the swatch that adds a picture, not a background itself (it was the one picture of the user's in
    // older versions)
    static let desktop = "desktop", picture = "picture"
    // the scene ids match src/scenes.js
    static var presets: [WallpaperBackground] { [
        .init(id: desktop, name: L("Desktop picture", "桌面图片"), base: 0xF5F6FA, accent: 0xF5F6FA, symbol: "menubar.dock.rectangle", symbolColor: 0x5E626D),
        .init(id: "ribbon", name: L("Ribbon Breeze", "丝带微风"), base: 0xFDF6F9, accent: 0xEC80AF, symbol: "wind", symbolColor: 0xC75A92),
        .init(id: "hearts", name: L("Heart Bubbles", "爱心泡泡"), base: 0xFFF6F9, accent: 0xF58AB0, symbol: "heart.fill", symbolColor: 0xE0607F),
        .init(id: "stars", name: L("Star Mobile", "星星风铃"), base: 0x282C5A, accent: 0xFFFFFF, symbol: "moon.stars.fill", symbolColor: 0xFFE49A),
        .init(id: "strawberry", name: L("Strawberry Milk", "草莓牛奶"), base: 0xFFF4F4, accent: 0xEE627A, symbol: "drop.fill", symbolColor: 0xE04E68),
        .init(id: "curtain", name: L("Lace Curtain", "蕾丝窗帘"), base: 0xE2E1FA, accent: 0xB5A3EE, symbol: "cloud.fill", symbolColor: 0x7E6CC9),
        .init(id: "bunting", name: L("Party Bunting", "派对彩旗"), base: 0xF4FBF8, accent: 0x6CBEA4, symbol: "flag.fill", symbolColor: 0x3F9A7E),
        .init(id: "moonroom", name: L("Lavender Moon Room", "薰衣草月亮房"), base: 0xC9BEF2, accent: 0xC9BEF2, symbol: "moon.fill", symbolColor: 0xFFFFFF,
              image: "backgrounds/lavender-moon-room.png"),
        .init(id: "tearoom", name: L("Mint Tea Room", "薄荷茶室"), base: 0xDDEBD9, accent: 0xDDEBD9, symbol: "cup.and.saucer.fill", symbolColor: 0xFFFFFF,
              image: "backgrounds/mint-tea-room.png"),
        .init(id: "catcafe", name: L("Peach Cat Cafe", "蜜桃猫咖"), base: 0xFBD9C4, accent: 0xFBD9C4, symbol: "cat.fill", symbolColor: 0xFFFFFF,
              image: "backgrounds/peach-cat-cafe.png"),
        .init(id: "berryroom", name: L("Strawberry Bedroom", "草莓卧室"), base: 0xF8D3DC, accent: 0xF8D3DC, symbol: "bed.double.fill", symbolColor: 0xFFFFFF,
              image: "backgrounds/strawberry-bedroom.png"),
    ] }
    static var add: WallpaperBackground { WallpaperBackground(id: picture, name: L("Add a picture…", "添加图片…"), base: 0xF5F6FA, accent: 0xF5F6FA,
                                         symbol: "plus", symbolColor: 0x5E626D) }

    // the presets, the user's pictures, and the swatch that adds one
    static var all: [WallpaperBackground] {
        presets + UserPictures.all.map {
            WallpaperBackground(id: UserPictures.id($0), name: UserPictures.displayName($0), base: 0xF5F6FA, accent: 0xF5F6FA,
                                symbol: "photo", symbolColor: 0x5E626D, file: $0)
        } + [add]
    }

    // an animated scene or a room (drawn by the page, with a still of it as the system desktop picture)
    var isScene: Bool { id != Self.desktop && id != Self.picture && file == nil }

    // the swatch's thumbnail: of the room, or of the user's picture
    var thumbnail: NSImage? {
        if let file { return UserPictures.thumbnail(file) }
        guard let image else { return nil }
        let name = (image as NSString).lastPathComponent
        return Bundle.main.resourceURL.flatMap { NSImage(contentsOf: $0.appendingPathComponent("thumbs/" + name)) }
    }
}

extension AppDelegate {
    static var wallpaperSizes: [(String, Double)] { [(L("Small", "小"), 0.55), (L("Medium", "中"), 0.75), (L("Large", "大"), 0.95)] }
    static var wallpaperAligns: [(String, String)] { [(L("Left", "左"), "left"), (L("Center", "中"), "center"), (L("Right", "右"), "right")] }
    // the sizes the slider and the on-screen adjusting allow
    static let wallpaperSizeRange: ClosedRange<Double> = 0.15...1.0

    var wallpaper: Bool {
        get { defaults.bool(forKey: "wallpaper") }
        set { defaults.set(newValue, forKey: "wallpaper") }
    }
    // the character's height as a share of the screen below the menu bar
    var wallpaperSize: Double {
        get { (defaults.object(forKey: "wallpaperSize") as? Double ?? 0.75).clamped(to: Self.wallpaperSizeRange) }
        set { defaults.set(newValue.clamped(to: Self.wallpaperSizeRange), forKey: "wallpaperSize") }
    }
    // One of the preset spots. Picking one drops a position set on screen.
    var wallpaperAlign: String {
        get { defaults.string(forKey: "wallpaperAlign") ?? "right" }
        set { defaults.set(newValue, forKey: "wallpaperAlign"); wallpaperSpot = nil }
    }
    // A position set on screen (WallpaperEdit.swift), as shares of the screen so it survives a resolution change: the
    // character's horizontal middle across the screen's width, and its feet above the bottom edge across the height
    // under the menu bar. nil: the preset spot.
    var wallpaperSpot: (x: Double, y: Double)? {
        get {
            guard let x = defaults.object(forKey: "wallpaperX") as? Double, let y = defaults.object(forKey: "wallpaperY") as? Double
            else { return nil }
            return (x, y)
        }
        set {
            if let s = newValue { defaults.set(s.x, forKey: "wallpaperX"); defaults.set(s.y, forKey: "wallpaperY") }
            else { defaults.removeObject(forKey: "wallpaperX"); defaults.removeObject(forKey: "wallpaperY") }
        }
    }
    // one of WallpaperBackground.all (an id from an older version, or a picture since removed, falls back to the
    // desktop picture)
    var wallpaperBackground: String {
        get {
            let id = defaults.string(forKey: "wallpaperBackground") ?? WallpaperBackground.desktop
            return id != WallpaperBackground.picture && WallpaperBackground.all.contains { $0.id == id } ? id : WallpaperBackground.desktop
        }
        set { defaults.set(newValue, forKey: "wallpaperBackground") }
    }
    var currentWallpaperBackground: WallpaperBackground? {
        let id = wallpaperBackground
        return WallpaperBackground.all.first { $0.id == id }
    }
    // the user's picture, while one is the background
    var wallpaperPictureFile: URL? { currentWallpaperBackground?.file }

    // Older versions kept one picture by its path ("wallpaperPicture"): it is copied into the pictures folder, and
    // stays the background if it was.
    func migrateWallpaperPicture() {
        guard let path = defaults.string(forKey: "wallpaperPicture") else { return }
        defaults.removeObject(forKey: "wallpaperPicture")
        let wasChosen = defaults.string(forKey: "wallpaperBackground") == WallpaperBackground.picture
        guard FileManager.default.fileExists(atPath: path),
              let url = try? UserPictures.add(URL(fileURLWithPath: path)) else { return }
        if wasChosen { wallpaperBackground = UserPictures.id(url) }
    }

    // the screen with the menu bar
    var wallpaperScreen: NSScreen? { NSScreen.screens.first ?? NSScreen.main }

    // Where the character is on screen: the pet window, or its spot on the wallpaper. The bubble points at it.
    var petRect: NSRect { wallpaper ? wallpaperRect() : window.frame }

    // the height of the screen under the menu bar
    func wallpaperAvail(_ screen: NSScreen) -> CGFloat {
        screen.frame.height - (screen.frame.maxY - screen.visibleFrame.maxY)
    }

    // Its height a share of the screen under the menu bar. At a preset spot it stands on the bottom edge of the
    // screen, and a side where the artwork is cut off goes right to the screen edge when the character is placed on
    // that side. A spot set on screen is kept inside the screen under the menu bar.
    func wallpaperRect() -> NSRect {
        guard let screen = wallpaperScreen else { return window.frame }
        let s = screen.frame, avail = wallpaperAvail(screen)
        let spot = wallpaperSpot
        let maxW = spot == nil ? s.width * 0.9 : s.width
        var h = (avail * wallpaperSize).rounded(), w = (h * wallAspect).rounded()
        if w > maxW { w = maxW.rounded(); h = (w / wallAspect).rounded() }
        if let spot {
            let x = (s.minX + CGFloat(spot.x) * s.width - w / 2).rounded().clamped(to: s.minX...max(s.minX, s.maxX - w))
            let y = (s.minY + CGFloat(spot.y) * avail).rounded().clamped(to: s.minY...max(s.minY, s.minY + avail - h))
            return NSRect(x: x, y: y, width: w, height: h)
        }
        let margin = (s.width * 0.06).rounded()
        let x: CGFloat
        switch wallpaperAlign {
        case "left": x = s.minX + (cutLeft ? 0 : margin)
        case "center": x = (s.midX - w / 2).rounded()
        default: x = s.maxX - (cutRight ? 0 : margin) - w
        }
        return NSRect(x: x, y: s.minY, width: w, height: h)
    }

    // Puts the window where the current mode wants it.
    func applyMode() {
        if wallpaper {
            window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) - 1)
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
            window.ignoresMouseEvents = true
            layoutWallpaper()
            syncSystemWallpaper()
        } else {
            window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            applyLevel()
            js("pet.wallpaper(null)")
            window.setContentSize(NSSize(width: (size * aspect).rounded(), height: size))
            restorePosition()
            // back to a pet: the user's own desktop picture returns. The background choice stays, so wallpaper mode
            // puts it back next time.
            if canRestoreDesktop { restoreSystemWallpaper(keepChoice: true) }
        }
        bubble.setDesktop(wallpaper)
        window.orderFrontRegardless()
        settingsModel?.refresh()
    }

    // Sizes the window to the screen and tells the page where to draw the character and over what.
    func layoutWallpaper() {
        guard wallpaper, let screen = wallpaperScreen else { return }
        let f = screen.frame
        if window.frame != f { window.setFrame(f, display: true) }
        var opts = wallpaperPlacement(screen)
        if currentWallpaperBackground?.isScene == true {
            opts["scene"] = wallpaperBackground
        } else {
            opts["bg"] = pictureCSS() ?? "transparent"
        }
        guard let data = try? JSONSerialization.data(withJSONObject: opts), let json = String(data: data, encoding: .utf8) else { return }
        js("pet.wallpaper(\(json))")
    }

    // Where the page draws the character (CSS pixels from the screen's top left), and whether it shows the frame
    // used while adjusting it on screen.
    func wallpaperPlacement(_ screen: NSScreen) -> [String: Any] {
        let f = screen.frame, r = wallpaperRect()
        return ["x": r.minX - f.minX, "y": f.maxY - r.maxY, "w": r.width, "h": r.height, "edit": wallEdit != nil]
    }

    // Moves or resizes the character on the wallpaper without touching the background (the picture is not fetched
    // again).
    func placeWallpaperCharacter() {
        guard wallpaper, pageReady, let screen = wallpaperScreen,
              let data = try? JSONSerialization.data(withJSONObject: wallpaperPlacement(screen)),
              let json = String(data: data, encoding: .utf8) else { return }
        js("pet.place(\(json))")
    }

    // The user's picture as a CSS background, while one is the chosen background and still exists.
    func pictureCSS() -> String? {
        guard let url = wallpaperPictureFile, FileManager.default.fileExists(atPath: url.path) else {
            files.background = nil; return nil
        }
        files.background = url
        // a new query each time, so a changed picture is fetched again
        return "#15161c url(\"doll://app/background?v=\(Int(Date().timeIntervalSince1970))\") center / cover no-repeat"
    }

    func setWallpaper(_ on: Bool) {
        if !on { endWallpaperEdit(keep: true) }
        wallpaper = on
        applyMode()
    }

    func setWallpaperBackground(_ id: String) {
        if id == WallpaperBackground.picture {
            chooseWallpaperPicture()
            return
        }
        wallpaperBackground = id
        // a room has a floor in the middle: the character stands there, unless the user put it somewhere on screen
        // (setting the preset spot would drop that)
        if WallpaperBackground.all.first(where: { $0.id == id })?.image != nil && wallpaperSpot == nil { wallpaperAlign = "center" }
        layoutWallpaper()
        syncSystemWallpaper()
        settingsModel?.refresh()
    }

    func chooseWallpaperPicture() {
        NSApp.activate(ignoringOtherApps: true)
        let panel = NSOpenPanel()
        panel.title = L("Add pictures for the wallpaper", "添加壁纸图片")
        panel.prompt = L("Add", "添加")
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = true
        guard panel.runModal() == .OK else { return }
        addWallpaperPictures(panel.urls)
    }

    // Adds pictures (from the open panel, or dropped on the swatches) and makes the last one the background.
    func addWallpaperPictures(_ urls: [URL]) {
        var added: URL?, failed: [String] = []
        for url in urls where UserPictures.isImage(url) {
            do { added = try UserPictures.add(url) }
            catch { failed.append(url.lastPathComponent); NSLog("DollPet: could not add the picture: \(error)") }
        }
        if !failed.isEmpty { alert(L("Could not add the picture", "无法添加图片"), failed.joined(separator: ", ")) }
        if let added { setWallpaperBackground(UserPictures.id(added)) } else { settingsModel?.refresh() }
    }

    // Moves one of the user's pictures to the Trash. The background in use gives way to the desktop picture first,
    // so the system isn't left pointing at a file that is gone.
    func removeWallpaperPicture(_ id: String) {
        guard let url = UserPictures.url(for: id) else { return }
        if wallpaperBackground == id { setWallpaperBackground(WallpaperBackground.desktop) }
        UserPictures.remove(url)
        settingsModel?.refresh()
    }

    // The page stops animating while the window can't be seen.
    func visibilityChanged() {
        guard pageReady else { return }
        js("pet.pause(\(!window.occlusionState.contains(.visible)))")
    }

    @objc func toggleWallpaper() { setWallpaper(!wallpaper) }

    // MARK: system desktop picture

    // stills of the scenes DollPet made, in Application Support (the system keeps pointing at the file)
    var wallpaperFolder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DollPet/Wallpapers", isDirectory: true)
    }

    // The desktop picture each screen had before DollPet changed it, by display number: its path, and how it was
    // scaled.
    var originalDesktops: [String: [String: Any]] {
        get { defaults.dictionary(forKey: "originalDesktops") as? [String: [String: Any]] ?? [:] }
        set { defaults.set(newValue, forKey: "originalDesktops") }
    }
    var canRestoreDesktop: Bool { !originalDesktops.isEmpty }

    func displayKey(_ screen: NSScreen) -> String {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue ?? screen.localizedName
    }

    // Makes the system desktop picture of the wallpaper screen match the chosen background: a still of the scene, the
    // user's picture, or (for "Desktop picture") what the user had before.
    func syncSystemWallpaper() {
        guard wallpaper, pageReady, let screen = wallpaperScreen else { return }
        let id = wallpaperBackground
        if id == WallpaperBackground.desktop {
            if canRestoreDesktop { restoreSystemWallpaper() }
            return
        }
        if let url = wallpaperPictureFile {
            if FileManager.default.fileExists(atPath: url.path) { setDesktop(url, on: screen) }
            return
        }
        // a room: its picture itself, copied out of the app (a rebuilt or moved app would leave the system pointing at
        // nothing)
        if let image = WallpaperBackground.all.first(where: { $0.id == id })?.image {
            let prefix = "\(id)-picture-"
            if let current = NSWorkspace.shared.desktopImageURL(for: screen), current.lastPathComponent.hasPrefix(prefix),
               current.path.hasPrefix(wallpaperFolder.path), FileManager.default.fileExists(atPath: current.path) {
                systemWallpaperFile = current
                return
            }
            guard let source = Bundle.main.resourceURL?.appendingPathComponent("web/" + image) else { return }
            do {
                try FileManager.default.createDirectory(at: wallpaperFolder, withIntermediateDirectories: true)
                let url = wallpaperFolder.appendingPathComponent(prefix + "\(Int(Date().timeIntervalSince1970))." + source.pathExtension)
                try FileManager.default.copyItem(at: source, to: url)
                setDesktop(url, on: screen)
                removeOldStills(keeping: url)
            } catch {
                NSLog("DollPet: could not copy the room picture: \(error)")
            }
            return
        }
        let scale = screen.backingScaleFactor
        let w = Int(screen.frame.width * scale), h = Int(screen.frame.height * scale)
        let prefix = "\(id)-\(w)x\(h)-"
        // already showing this scene at this size
        if let current = NSWorkspace.shared.desktopImageURL(for: screen), current.lastPathComponent.hasPrefix(prefix),
           current.path.hasPrefix(wallpaperFolder.path), FileManager.default.fileExists(atPath: current.path) {
            systemWallpaperFile = current
            return
        }
        web.callAsyncJavaScript("return await pet.still(id, w, h)", arguments: ["id": id, "w": w, "h": h],
                                in: nil, in: .page) { [weak self] result in
            guard let self, self.wallpaper, self.wallpaperBackground == id else { return }
            guard case .success(let value) = result, let png = value as? String, let comma = png.firstIndex(of: ","),
                  let bytes = Data(base64Encoded: String(png[png.index(after: comma)...])) else {
                if case .failure(let error) = result { NSLog("DollPet: could not draw the wallpaper: \(error)") }
                return
            }
            do {
                try FileManager.default.createDirectory(at: self.wallpaperFolder, withIntermediateDirectories: true)
                // a new name each time: the system keeps showing a cached picture for a path it has seen
                let url = self.wallpaperFolder.appendingPathComponent(prefix + "\(Int(Date().timeIntervalSince1970)).png")
                try bytes.write(to: url)
                self.setDesktop(url, on: screen)
                self.removeOldStills(keeping: url)
            } catch {
                NSLog("DollPet: could not save the wallpaper: \(error)")
            }
        }
    }

    func setDesktop(_ url: URL, on screen: NSScreen) {
        rememberOriginalDesktop(screen)
        do {
            try NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [
                .imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue, .allowClipping: true])
            systemWallpaperFile = url
            settingsModel?.refresh()
        } catch {
            alert(L("Could not change the desktop picture", "无法更换桌面图片"), error.localizedDescription)
        }
    }

    // Once per screen, before the first change: the picture the user had (unless it is already one of ours).
    func rememberOriginalDesktop(_ screen: NSScreen) {
        let key = displayKey(screen)
        guard originalDesktops[key] == nil, let current = NSWorkspace.shared.desktopImageURL(for: screen),
              !current.path.hasPrefix(wallpaperFolder.path), !current.path.hasPrefix(UserPictures.folder.path) else { return }
        let options = NSWorkspace.shared.desktopImageOptions(for: screen) ?? [:]
        var saved = originalDesktops
        saved[key] = ["path": current.path,
                      "scaling": (options[.imageScaling] as? NSNumber)?.intValue ?? Int(NSImageScaling.scaleProportionallyUpOrDown.rawValue),
                      "clip": (options[.allowClipping] as? NSNumber)?.boolValue ?? true]
        originalDesktops = saved
    }

    // Puts back the pictures the user had and deletes DollPet's stills. keepChoice: leave the chosen background as it
    // is (leaving wallpaper mode); otherwise a scene or room (not a picture of the user's) gives way to the desktop picture, so the wallpaper window
    // matches what the system now shows.
    func restoreSystemWallpaper(keepChoice: Bool = false) {
        for screen in NSScreen.screens {
            guard let saved = originalDesktops[displayKey(screen)], let path = saved["path"] as? String,
                  FileManager.default.fileExists(atPath: path) else { continue }
            try? NSWorkspace.shared.setDesktopImageURL(URL(fileURLWithPath: path), for: screen, options: [
                .imageScaling: saved["scaling"] as? Int ?? Int(NSImageScaling.scaleProportionallyUpOrDown.rawValue),
                .allowClipping: saved["clip"] as? Bool ?? true])
        }
        originalDesktops = [:]
        systemWallpaperFile = nil
        removeOldStills(keeping: nil)
        if !keepChoice && currentWallpaperBackground?.isScene == true {
            wallpaperBackground = WallpaperBackground.desktop
            layoutWallpaper()
        }
        settingsModel?.refresh()
    }

    // A Space that still shows another picture gets the wallpaper's too (the desktop picture is set per Space).
    func reapplySystemWallpaper() {
        guard wallpaper, wallpaperBackground != WallpaperBackground.desktop, let file = systemWallpaperFile,
              let screen = wallpaperScreen, FileManager.default.fileExists(atPath: file.path),
              NSWorkspace.shared.desktopImageURL(for: screen) != file else { return }
        try? NSWorkspace.shared.setDesktopImageURL(file, for: screen, options: [
            .imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue, .allowClipping: true])
    }

    func removeOldStills(keeping keep: URL?) {
        let files = (try? FileManager.default.contentsOfDirectory(at: wallpaperFolder, includingPropertiesForKeys: nil)) ?? []
        for f in files where f.pathExtension == "png" && f.lastPathComponent != keep?.lastPathComponent {
            try? FileManager.default.removeItem(at: f)
        }
    }
}

extension WebFiles {
    // The wallpaper picture, at doll://app/background. Formats WebKit may not show (HEIC on older macOS, TIFF) are
    // sent as JPEG.
    func backgroundData() -> (Data, String)? {
        guard let url = background else { return nil }
        let ext = url.pathExtension.lowercased()
        let direct = ["jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"]
        if let type = direct[ext], let data = try? Data(contentsOf: url) { return (data, type) }
        guard let image = NSImage(contentsOf: url), let tiff = image.tiffRepresentation,
              let jpeg = NSBitmapImageRep(data: tiff)?.representation(using: .jpeg, properties: [.compressionFactor: 0.92])
        else { return nil }
        return (jpeg, "image/jpeg")
    }
}
