// The menu bar popover: the current pet, quick toggles, size, task alerts, recent models and the app commands.
// It shares SettingsModel with the settings window, so a change in one shows in the other.

import AppKit
import SwiftUI

struct PopoverView: View {
    @ObservedObject var model: SettingsModel
    let close: () -> Void

    // runs an app command after the popover has gone, so panels and windows it opens come up on top
    func then(_ action: @escaping () -> Void) -> () -> Void {
        { close(); DispatchQueue.main.async(execute: action) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            SoftSegments(options: [(L("Desktop pet", "桌宠"), false), (L("Wallpaper", "壁纸"), true)], selection: $model.wallpaper)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                Tile(title: L("Always on top", "置顶"), symbol: "pin.fill", color: Theme.violet, on: $model.onTop)
                    .disabled(model.wallpaper).opacity(model.wallpaper ? 0.45 : 1)
                Tile(title: L("Follow cursor", "跟随鼠标"), symbol: "cursorarrow.motionlines", color: Theme.blue, on: $model.follow)
                Tile(title: L("Lip sync", "麦克风口型"), symbol: "mic.fill", color: Theme.accent, on: $model.mic)
                Tile(title: L("Face tracking", "面部捕捉"), symbol: "camera.fill", color: Theme.teal, on: $model.camera)
                Tile(title: L("Click-through", "鼠标穿透"), symbol: "lock.fill", color: Theme.orange, on: $model.locked)
                    .disabled(model.wallpaper).opacity(model.wallpaper ? 0.45 : 1)
                Tile(title: L("Alert sound", "提示音"), symbol: "speaker.wave.2.fill", color: Theme.rose, on: $model.sound)
            }
            if model.camera {
                HStack(spacing: 10) {
                    Text(L("Hold still facing the camera for a second to auto-calibrate.", "正对摄像头静止一秒会自动校准。"))
                        .font(.system(size: 11.5)).foregroundStyle(Theme.muted)
                    Spacer(minLength: 0)
                    Button(L("Calibrate", "校准")) { model.app.calibrateCamera() }.buttonStyle(SoftButton())
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.tile))
            }
            if model.wallpaper { wallpaperControls } else { sizes }
            alerts
            recents
            Divider().padding(.horizontal, 6)
            VStack(spacing: 0) {
                MenuRow(title: L("Open Model…", "打开模型…"), symbol: "folder", shortcut: "⌘O", action: then { model.app.openModel() })
                    .keyboardShortcut("o")
                MenuRow(title: L("Open Editor", "打开编辑器"), symbol: "square.stack.3d.up", shortcut: "⌘E", action: then { model.app.openEditor() })
                    .keyboardShortcut("e")
                MenuRow(title: L("Settings…", "设置…"), symbol: "slider.horizontal.3", shortcut: "⌘,", action: then { model.app.openSettings() })
                    .keyboardShortcut(",")
                MenuRow(title: L("Quit DollPet", "退出 DollPet"), symbol: "power", shortcut: "⌘Q", action: { NSApp.terminate(nil) })
                    .keyboardShortcut("q")
            }
        }
        .padding(12)
        .frame(width: 344)
        .foregroundStyle(Theme.text)
    }

    var header: some View {
        HStack(spacing: 12) {
            ModelThumb()
            VStack(alignment: .leading, spacing: 1) {
                Text(model.modelTitle).font(.system(size: 14, weight: .semibold)).lineLimit(1).truncationMode(.middle)
                HStack(spacing: 6) {
                    Circle().fill(Theme.green).frame(width: 6, height: 6)
                    Text(model.wallpaper ? L("As your wallpaper · \(model.wallpaperSizeName)", "作为壁纸 · \(model.wallpaperSizeName)") : L("On your desktop · \(model.sizeName)", "在桌面上 · \(model.sizeName)")).font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
            }
            Spacer(minLength: 0)
            Button(action: then { model.editCurrent() }) {
                Image(systemName: "pencil").font(.system(size: 13, weight: .medium)).frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.muted)
            .help(L("Edit in the editor", "在编辑器里编辑"))
            .accessibilityLabel(L("Edit this model in the editor", "在编辑器里编辑这个模型"))
        }
        .padding([.horizontal, .top], 4)
    }

    var sizes: some View {
        VStack(alignment: .leading, spacing: 6) {
            Caption(L("Pet size", "桌宠大小")).padding(.horizontal, 2)
            HStack(spacing: 2) {
                ForEach(AppDelegate.sizes, id: \.1) { name, h in
                    let on = model.size == h
                    Button { model.size = h } label: {
                        Text(name)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(on ? Theme.text : Theme.muted)
                            .frame(maxWidth: .infinity, minHeight: 28)
                            .background(RoundedRectangle(cornerRadius: 7).fill(on ? Color.white : .clear)
                                .shadow(color: .black.opacity(on ? 0.12 : 0), radius: 1, y: 1))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(3)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: 0xECEEF3)))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line))
        }
    }

    var wallpaperControls: some View {
        VStack(alignment: .leading, spacing: 6) {
            Caption(L("Wallpaper", "壁纸")).padding(.horizontal, 2)
            SoftSegments(options: AppDelegate.wallpaperSizes, selection: $model.wallpaperSize)
            SoftSegments(options: AppDelegate.wallpaperAligns, selection: $model.wallpaperAlign)
            Button(action: then { model.adjustWallpaper() }) {
                Label(L("Adjust on screen…", "在屏幕上调整…"), systemImage: "arrow.up.and.down.and.arrow.left.and.right")
                    .font(.system(size: 12, weight: .medium))
                    .frame(maxWidth: .infinity, minHeight: 28)
                    .background(RoundedRectangle(cornerRadius: 9).fill(Theme.tile))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.text)
            .help(L("Drag the character anywhere on the wallpaper and resize it freely", "把角色拖到壁纸上任意位置，自由缩放"))
            HStack {
                Text(model.wallpaperBackgroundName).font(.system(size: 12)).foregroundStyle(Theme.muted).lineLimit(1)
                Spacer()
                if model.canRestoreDesktop {
                    Button(L("Restore my picture", "恢复我的壁纸")) { model.restoreDesktop() }
                        .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.muted)
                        .help(L("Put back the desktop picture you had before DollPet changed it", "换回 DollPet 修改之前你的桌面图片"))
                }
            }
            .padding(.horizontal, 4).padding(.top, 2)
            BackgroundSwatches(model: model, size: 24, spacing: 4, perRow: 8)
        }
    }

    var alerts: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Caption(L("Task alerts", "任务提醒"))
                Spacer()
                Button(L("Send test", "发送测试")) { model.app.testAlert() }
                    .buttonStyle(.plain).font(.system(size: 12)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 4).padding(.top, 2).padding(.bottom, 6)
            AgentLine(name: "Claude Code", badge: "CC", on: model.connected(.claude))
            AgentLine(name: "Codex", badge: "CX", on: model.connected(.codex))
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.tile))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
    }

    @ViewBuilder var recents: some View {
        let list = Array(model.recents.prefix(3))
        VStack(alignment: .leading, spacing: 0) {
            Caption(L("Recent models", "最近的模型")).padding(.horizontal, 6).padding(.bottom, 4)
            if list.isEmpty {
                Text(L("Models you open show up here.", "打开过的模型会显示在这里。"))
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.horizontal, 10).padding(.vertical, 6)
            }
            ForEach(list) { r in
                MenuRow(title: r.name, symbol: model.isCurrent(r) ? "checkmark" : nil, shortcut: r.agoText,
                        symbolColor: Theme.accent, action: { model.usePet(r) })
                    .help(r.path)
            }
        }
    }
}

// A quick toggle: an icon in a circle that fills with the toggle's own colour when on.
struct Tile: View {
    let title: String
    let symbol: String
    let color: Color
    @Binding var on: Bool

    var body: some View {
        Button { on.toggle() } label: {
            HStack(spacing: 10) {
                Circle()
                    .fill(on ? color : Color(hex: 0xE9EBF1))
                    .frame(width: 32, height: 32)
                    .overlay(Image(systemName: symbol).font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(on ? Color.white : Theme.text2))
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.system(size: 12.5, weight: .semibold)).lineLimit(1)
                    Text(on ? L("On", "开") : L("Off", "关")).font(.system(size: 11.5)).foregroundStyle(Theme.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(minHeight: 56)
            .background(RoundedRectangle(cornerRadius: 12).fill(on ? color.opacity(0.1) : Theme.tile))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? color.opacity(0.45) : Theme.line))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(on ? L("On", "开") : L("Off", "关"))
    }
}

struct AgentLine: View {
    let name: String
    let badge: String
    @Binding var on: Bool

    var body: some View {
        HStack(spacing: 10) {
            Text(badge)
                .font(.system(size: 10.5, weight: .bold))
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(hex: 0xE9EBF1)))
            VStack(alignment: .leading, spacing: 0) {
                Text(name).font(.system(size: 13, weight: .medium))
                Text(on ? L("Connected", "已连接") : L("Not connected", "未连接")).font(.system(size: 11.5))
                    .foregroundStyle(on ? Theme.green : Theme.muted)
            }
            Spacer()
            Button(on ? L("Disconnect", "断开") : L("Connect", "连接")) { on.toggle() }.buttonStyle(SoftButton(prominent: !on))
        }
        .padding(.horizontal, 4).padding(.vertical, 5)
    }
}

// A menu-like row that highlights in the accent colour under the pointer.
struct MenuRow: View {
    let title: String
    var symbol: String?
    var shortcut: String = ""
    var symbolColor = Theme.muted
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Group {
                    if let symbol { Image(systemName: symbol).font(.system(size: 13, weight: .medium)) } else { Color.clear }
                }
                .frame(width: 16)
                .foregroundStyle(hover ? Color.white : symbolColor)
                Text(title).font(.system(size: 13)).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                Text(shortcut).font(.system(size: 12)).foregroundStyle(hover ? Color.white.opacity(0.85) : Theme.dim)
            }
            .foregroundStyle(hover ? Color.white : Theme.text)
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(RoundedRectangle(cornerRadius: 7).fill(hover ? Theme.accent : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
