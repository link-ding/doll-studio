// Adjusting the wallpaper on screen: the wallpaper window comes up over the other windows and takes the mouse, the
// page frames the character, and a panel at the top of the screen says what to do. Dragging the character moves it
// (it snaps to the screen's bottom, sides and middle); dragging a handle on its top edge, scrolling or pinching
// resizes it about its feet. Arrow keys nudge it (Shift: further), + and - resize it, Return keeps the change and
// Escape puts back what it was. The spot is kept as shares of the screen (wallpaperSpot, Wallpaper.swift).

import Cocoa
import SwiftUI

extension Comparable {
    func clamped(to r: ClosedRange<Self>) -> Self { min(max(self, r.lowerBound), r.upperBound) }
}

@MainActor
final class WallpaperEdit {
    // what to put back on Cancel
    let size: Double
    let spot: (x: Double, y: Double)?
    var panel: NSPanel?

    init(size: Double, spot: (x: Double, y: Double)?) {
        self.size = size
        self.spot = spot
    }
}

// The panel can take clicks and keys (a borderless window can't by default).
final class WallpaperEditPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

extension AppDelegate {
    var wallpaperEditLevel: NSWindow.Level { .floating }

    @objc func adjustWallpaper() { beginWallpaperEdit() }

    func beginWallpaperEdit() {
        guard wallpaper, wallEdit == nil, let screen = wallpaperScreen, let model = settingsModel else { return }
        popover.performClose(nil)
        wallEdit = WallpaperEdit(size: wallpaperSize, spot: wallpaperSpot)
        window.level = wallpaperEditLevel
        window.ignoresMouseEvents = false
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)
        placeWallpaperCharacter()

        let hud = NSHostingController(rootView: WallpaperEditHUD(
            model: model,
            reset: { [weak self] in self?.resetWallpaperSpot() },
            cancel: { [weak self] in self?.endWallpaperEdit(keep: false) },
            done: { [weak self] in self?.endWallpaperEdit(keep: true) }))
        hud.sizingOptions = .preferredContentSize
        let panel = WallpaperEditPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.contentViewController = hud
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = NSWindow.Level(rawValue: wallpaperEditLevel.rawValue + 1)
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.appearance = NSAppearance(named: .aqua)
        let size = hud.view.fittingSize
        let v = screen.visibleFrame
        panel.setFrame(NSRect(x: (v.midX - size.width / 2).rounded(), y: v.maxY - size.height - 14,
                              width: size.width, height: size.height), display: true)
        panel.orderFrontRegardless()
        wallEdit?.panel = panel
        settingsModel?.refresh()
    }

    // keep: false puts back the size and spot the character had before adjusting.
    func endWallpaperEdit(keep: Bool) {
        guard let edit = wallEdit else { return }
        edit.panel?.orderOut(nil)
        wallEdit = nil
        if !keep {
            wallpaperSize = edit.size
            wallpaperSpot = edit.spot
        }
        if wallpaper {
            window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) - 1)
            window.ignoresMouseEvents = true
            placeWallpaperCharacter()
        }
        settingsModel?.refresh()
    }

    // Back to the preset spot at the default size.
    func resetWallpaperSpot() {
        wallpaperSpot = nil
        wallpaperSize = 0.75
        placeWallpaperCharacter()
        settingsModel?.refresh()
    }

    // Puts the character with its feet at `bottom` (horizontal middle, bottom edge) and the given height, kept inside
    // the screen under the menu bar, and saves that as the spot. snap: close to the screen's bottom, sides or middle
    // means on them.
    func setWallpaperSpot(feet: NSPoint, height: CGFloat, snap: Bool) {
        guard let screen = wallpaperScreen else { return }
        let s = screen.frame, avail = wallpaperAvail(screen)
        let range = AppDelegate.wallpaperSizeRange
        var h = height.clamped(to: avail * range.lowerBound...avail * range.upperBound)
        if h * wallAspect > s.width { h = s.width / wallAspect }
        let w = h * wallAspect
        var x = feet.x - w / 2, y = feet.y
        if snap {
            let d: CGFloat = 12
            if abs(y - s.minY) < d { y = s.minY }
            if abs(x - s.minX) < d { x = s.minX }
            if abs(x + w - s.maxX) < d { x = s.maxX - w }
            if abs(x + w / 2 - s.midX) < d { x = s.midX - w / 2 }
        }
        x = x.clamped(to: s.minX...max(s.minX, s.maxX - w))
        y = y.clamped(to: s.minY...max(s.minY, s.minY + avail - h))
        wallpaperSize = Double(h / avail)
        wallpaperSpot = (Double((x + w / 2 - s.minX) / s.width), Double((y - s.minY) / avail))
        placeWallpaperCharacter()
        settingsModel?.refresh()
    }

    // The handles on the character's top edge (left corner, middle, right corner), in screen points.
    func wallpaperHandles(_ r: NSRect) -> [NSPoint] {
        [NSPoint(x: r.minX, y: r.maxY), NSPoint(x: r.midX, y: r.maxY), NSPoint(x: r.maxX, y: r.maxY)]
    }

    // A mouse press while adjusting: on a handle it resizes about the feet, on the character it moves it.
    func trackWallpaperEdit() {
        let start = NSEvent.mouseLocation, r0 = wallpaperRect()
        let feet = NSPoint(x: r0.midX, y: r0.minY)
        let onHandle = wallpaperHandles(r0).contains { hypot($0.x - start.x, $0.y - start.y) <= 14 }
        guard onHandle || r0.insetBy(dx: -4, dy: -4).contains(start) else { return }
        dragging = true
        defer { dragging = false }
        let reach = max(1, hypot(start.x - feet.x, start.y - feet.y))
        while let e = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
            if e.type == .leftMouseUp { break }
            let p = NSEvent.mouseLocation
            if onHandle {
                setWallpaperSpot(feet: feet, height: r0.height * hypot(p.x - feet.x, p.y - feet.y) / reach, snap: false)
            } else {
                setWallpaperSpot(feet: NSPoint(x: feet.x + p.x - start.x, y: feet.y + p.y - start.y), height: r0.height, snap: true)
            }
        }
    }

    // Resizes by a factor about the feet.
    func scaleWallpaper(_ factor: CGFloat) {
        let r = wallpaperRect()
        setWallpaperSpot(feet: NSPoint(x: r.midX, y: r.minY), height: r.height * factor, snap: false)
    }

    func wallpaperScroll(_ e: NSEvent) {
        let dy = e.hasPreciseScrollingDeltas ? e.scrollingDeltaY : e.scrollingDeltaY * 8
        if dy != 0 { scaleWallpaper(exp(dy * 0.004)) }
    }

    // Keys while adjusting; false when the key isn't one of them.
    func wallpaperKey(_ e: NSEvent) -> Bool {
        let step: CGFloat = e.modifierFlags.contains(.shift) ? 10 : 1
        let r = wallpaperRect()
        let feet = NSPoint(x: r.midX, y: r.minY)
        switch e.keyCode {
        case 53: endWallpaperEdit(keep: false) // Escape
        case 36, 76: endWallpaperEdit(keep: true) // Return, Enter
        case 123: setWallpaperSpot(feet: NSPoint(x: feet.x - step, y: feet.y), height: r.height, snap: false)
        case 124: setWallpaperSpot(feet: NSPoint(x: feet.x + step, y: feet.y), height: r.height, snap: false)
        case 125: setWallpaperSpot(feet: NSPoint(x: feet.x, y: feet.y - step), height: r.height, snap: false)
        case 126: setWallpaperSpot(feet: NSPoint(x: feet.x, y: feet.y + step), height: r.height, snap: false)
        default:
            switch e.charactersIgnoringModifiers {
            case "=", "+": scaleWallpaper(1.05)
            case "-", "_": scaleWallpaper(1 / 1.05)
            default: return false
            }
        }
        return true
    }
}

// The panel at the top of the screen while adjusting.
struct WallpaperEditHUD: View {
    @ObservedObject var model: SettingsModel
    let reset: () -> Void
    let cancel: () -> Void
    let done: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(L("Adjust the wallpaper", "调整壁纸")).font(.system(size: 13, weight: .semibold))
                Text(L("Drag to move. Drag a dot, scroll or pinch to resize.", "拖动来移动。拖圆点、滚动或双指捏合来缩放。"))
                    .font(.system(size: 12)).foregroundStyle(Theme.dim)
            }
            HStack(spacing: 8) {
                Image(systemName: "person.fill").font(.system(size: 10)).foregroundStyle(Theme.dim)
                Slider(value: $model.wallpaperSize, in: AppDelegate.wallpaperSizeRange).frame(width: 130)
                Image(systemName: "person.fill").font(.system(size: 15)).foregroundStyle(Theme.dim)
                Text("\(Int((model.wallpaperSize * 100).rounded()))%")
                    .font(.system(size: 12, weight: .medium)).monospacedDigit().foregroundStyle(Theme.muted)
                    .frame(width: 36, alignment: .trailing)
            }
            HStack(spacing: 6) {
                Button(L("Reset", "重置"), action: reset).buttonStyle(SoftButton())
                    .help(L("Back to the preset spot at medium size", "回到预设位置和中等大小"))
                Button(L("Cancel", "取消"), action: cancel).buttonStyle(SoftButton()).keyboardShortcut(.cancelAction)
                Button(L("Done", "完成"), action: done).buttonStyle(SoftButton(prominent: true)).keyboardShortcut(.defaultAction)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line))
        .foregroundStyle(Theme.text)
        .fixedSize()
    }
}
