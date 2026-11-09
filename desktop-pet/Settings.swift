// Settings window: one place for agent connections, pet behaviour and the model. Its model also backs the
// menu bar popover (Popover.swift).

import AppKit
import SwiftUI

@MainActor
final class SettingsModel: ObservableObject {
    unowned let app: AppDelegate
    @Published private(set) var claude = false
    @Published private(set) var codex = false

    init(app: AppDelegate) {
        self.app = app
        refresh()
    }

    // Re-reads state that lives outside this model (config files, microphone, model path).
    func refresh() {
        objectWillChange.send()
        claude = Bridge.isConnected(.claude)
        codex = Bridge.isConnected(.codex)
        app.sendRecentsToEditor()
    }

    func connected(_ agent: Bridge.Agent) -> Binding<Bool> {
        Binding(
            get: { agent == .claude ? self.claude : self.codex },
            set: { on in
                self.app.setAgent(agent, on: on)
                self.refresh()
            })
    }

    // interface language: "system", "en" or "zh" (Lang.swift)
    var language: String {
        get { Lang.setting }
        set { objectWillChange.send(); Lang.setting = newValue; app.applyLanguage() }
    }

    var sound: Bool {
        get { app.alertSound }
        set { objectWillChange.send(); app.alertSound = newValue }
    }
    var size: CGFloat {
        get { app.size }
        set { objectWillChange.send(); app.size = newValue; app.applySize() }
    }
    var sizeName: String { AppDelegate.sizes.first { $0.1 == size }?.0 ?? L("Custom", "自定义") }
    var onTop: Bool {
        get { app.onTop }
        set { objectWillChange.send(); app.onTop = newValue; app.applyLevel() }
    }
    var follow: Bool {
        get { app.follow }
        set { objectWillChange.send(); app.follow = newValue; app.js("pet.follow(\(newValue))") }
    }
    var locked: Bool {
        get { app.locked }
        set { objectWillChange.send(); app.locked = newValue }
    }
    // the app calls refresh() once the pet page reports the microphone / camera state
    var mic: Bool {
        get { app.micOn }
        set { app.setMic(newValue) }
    }
    var camera: Bool {
        get { app.cameraOn }
        set { app.setCamera(newValue) }
    }

    // wallpaper mode (Wallpaper.swift)
    var wallpaper: Bool {
        get { app.wallpaper }
        set { objectWillChange.send(); app.setWallpaper(newValue) }
    }
    var wallpaperSize: Double {
        get { app.wallpaperSize }
        set { objectWillChange.send(); app.wallpaperSize = newValue; app.placeWallpaperCharacter() }
    }
    var wallpaperSizeName: String {
        AppDelegate.wallpaperSizes.first { abs($0.1 - wallpaperSize) < 0.001 }?.0 ?? "\(Int((wallpaperSize * 100).rounded()))%"
    }
    // "custom" (no preset lit up) once the character was placed on screen
    var wallpaperAlign: String {
        get { app.wallpaperSpot == nil ? app.wallpaperAlign : "custom" }
        set { objectWillChange.send(); app.wallpaperAlign = newValue; app.placeWallpaperCharacter() }
    }
    var wallpaperCustomSpot: Bool { app.wallpaperSpot != nil }
    var adjustingWallpaper: Bool { app.wallEdit != nil }
    func adjustWallpaper() { app.beginWallpaperEdit() }
    var wallpaperBackground: String {
        get { app.wallpaperBackground }
        set { objectWillChange.send(); app.setWallpaperBackground(newValue) }
    }
    var wallpaperBackgroundName: String { app.currentWallpaperBackground?.name ?? "" }
    // DollPet changed the system desktop picture and can put the user's back
    var canRestoreDesktop: Bool { app.canRestoreDesktop }
    func restoreDesktop() { app.restoreSystemWallpaper() }
    func chooseWallpaperPicture() { app.chooseWallpaperPicture() }
    func addWallpaperPictures(_ urls: [URL]) { app.addWallpaperPictures(urls) }
    func removeWallpaperPicture(_ id: String) { app.removeWallpaperPicture(id) }

    var modelPath: String? { app.defaults.string(forKey: "modelPath") }
    // the model the editor handed over lives in Application Support under a fixed name
    var fromEditor: Bool { modelPath?.contains("/Application Support/DollPet/") ?? false }
    var modelName: String {
        guard let path = modelPath else { return L("Built-in sample", "内置示例") }
        return fromEditor ? L("Set from the editor", "从编辑器设置") : URL(fileURLWithPath: path).lastPathComponent
    }
    // the popover's heading: the file name without its extension
    var modelTitle: String {
        guard let path = modelPath, !fromEditor else { return fromEditor ? L("Your model", "你的模型") : L("Sample model", "示例模型") }
        return URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
    }
    func editCurrent() {
        if let path = modelPath, FileManager.default.fileExists(atPath: path) { app.openInEditor(URL(fileURLWithPath: path)) }
        else { app.openEditor() }
    }

    // reminder sounds
    func soundTitle(_ kind: Sounds.Kind) -> String { app.sounds.title(kind) }
    func soundIsCustom(_ kind: Sounds.Kind) -> Bool { app.sounds.isCustom(kind) }
    func useSystemSound(_ kind: Sounds.Kind, _ name: String) { app.sounds.useSystem(kind, name); refresh() }
    func chooseSoundFile(_ kind: Sounds.Kind) {
        if let err = app.sounds.chooseFile(kind) { app.alert(L("Could not change the sound", "无法更换提示音"), err) }
        refresh()
    }
    func preview(_ kind: Sounds.Kind) { app.sounds.play(kind) }

    // recent models (the settings window shows the newest few)
    var recents: [RecentModel] { Array(app.recents.existing.prefix(8)) }
    func isCurrent(_ r: RecentModel) -> Bool { modelPath == r.path }
    func usePet(_ r: RecentModel) { app.load(r.url); refresh() }
    func edit(_ r: RecentModel) { app.openInEditor(r.url); refresh() }
    func reveal(_ r: RecentModel) { NSWorkspace.shared.activateFileViewerSelecting([r.url]) }
    func forget(_ r: RecentModel) { app.recents.remove(r.path); refresh() }
}

struct SettingsView: View {
    enum Tab: String, CaseIterable { case pet = "Pet", alerts = "Task Alerts", models = "Models" }

    @ObservedObject var model: SettingsModel
    @State private var tab: Tab = .alerts

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                TabButton(title: L("Pet", "桌宠"), symbol: "sparkles", on: tab == .pet) { tab = .pet }
                TabButton(title: L("Task Alerts", "任务提醒"), symbol: "bell", on: tab == .alerts) { tab = .alerts }
                TabButton(title: L("Models", "模型"), symbol: "square.stack.3d.up", on: tab == .models) { tab = .models }
            }
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .trailing) {
                Picker(selection: $model.language) {
                    Text(L("Auto", "自动")).tag("system")
                    Text("English").tag("en")
                    Text("中文").tag("zh")
                } label: {
                    Image(systemName: "globe").foregroundStyle(Theme.muted)
                }
                .pickerStyle(.menu)
                .fixedSize()
                .help(L("Interface language (Auto follows macOS)", "界面语言（自动 = 跟随 macOS）"))
                .accessibilityLabel(L("Interface language", "界面语言"))
                .padding(.trailing, 14)
            }
            .background(Color(hex: 0xF7F8FB))
            .overlay(alignment: .bottom) { Theme.line.frame(height: 1) }

            VStack(alignment: .leading, spacing: 24) {
                switch tab {
                case .pet: petTab
                case .alerts: alertsTab
                case .models: modelsTab
                }
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 24)
        }
        .frame(width: 600)
        .fixedSize(horizontal: false, vertical: true)
        .background(Color.white)
        .foregroundStyle(Theme.text)
        .font(.system(size: 13))
    }

    // MARK: tabs

    @ViewBuilder var alertsTab: some View {
        SettingsSection(L("Connections", "连接"), note: L("New sessions alert you when a task finishes or needs your OK. Config files are backed up first, and your other hooks stay as they are.", "之后新开的会话在任务完成或需要你确认时会提醒你。改配置文件前会先备份，你的其他 hook 保持不变。")) {
            AgentRow(name: "Claude Code", badge: "CC", file: "~/.claude/settings.json · Stop + Notification hooks", on: model.connected(.claude))
            AgentRow(name: "Codex", badge: "CX", file: "~/.codex/config.toml · notify", on: model.connected(.codex))
        }
        SettingsSection(L("Sound", "提示音"), note: L("Pick any macOS sound, or choose an audio file of your own from the menu.", "可以选任意 macOS 系统声音，也可以在菜单里选你自己的音频文件。")) {
            Toggle(isOn: $model.sound) { Text(L("Play alert sounds", "播放提示音")).fontWeight(.medium) }
                .toggleStyle(PillSwitch())
                .settingsRow()
            if model.sound {
                ForEach(Sounds.Kind.allCases, id: \.self) { kind in
                    SoundRow(kind: kind, model: model).settingsRow()
                }
            }
        }
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Caption(L("How alerts look", "提醒的样子"))
                Spacer()
                Button { model.app.testAlert() } label: { Label(L("Send test alert", "发送测试提醒"), systemImage: "bell") }
                    .buttonStyle(SoftButton())
            }
            .padding(.horizontal, 4)
            HStack(alignment: .top, spacing: 16) {
                BubblePreview(title: "Claude Code", project: "doll-studio",
                              body: L("Done. The build script now copies the web files into the app.", "完成了。构建脚本现在会把网页文件复制进 App。"),
                              caption: L("Task finished · pet smiles", "任务完成 · 桌宠笑一下"), attention: false)
                BubblePreview(title: L("Claude Code needs your OK", "Claude Code 需要你确认"), project: "",
                              body: L("doll-studio wants permission to run a command.", "doll-studio 想获得运行命令的权限。"),
                              caption: L("Needs you · pet widens eyes and nods", "需要你 · 桌宠睁大眼睛点头"), attention: true)
            }
            .padding(20)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.stage))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
        }
    }

    @ViewBuilder var petTab: some View {
        SettingsSection(L("Mode", "模式"), note: model.wallpaper
                        ? L("The wallpaper sits under your desktop icons on the screen with the menu bar. Clicks go to the desktop, and it stops animating while windows cover it. A scene or picture also becomes that screen's desktop picture, so it stays after DollPet quits.",
                            "壁纸在有菜单栏的那块屏幕上，位于桌面图标下面。点击会落到桌面上，被窗口挡住时停止动画。选的场景或图片也会设成那块屏幕的桌面图片，DollPet 退出后仍然保留。")
                        : nil) {
            HStack {
                Text(L("Show the character as", "角色显示为")).fontWeight(.medium)
                Spacer()
                SoftSegments(options: [(L("Desktop pet", "桌宠"), false), (L("Wallpaper", "壁纸"), true)], selection: $model.wallpaper, height: 24)
                    .frame(width: 240)
            }
            .settingsRow()
        }
        if model.wallpaper { wallpaperSection } else { desktopSection }
        SettingsSection(L("Motion", "动作")) {
            SwitchRow(title: L("Follow cursor", "跟随鼠标"), note: L("Eyes lead, the head turns a little", "眼睛带路，头稍微转一点"), on: $model.follow)
            SwitchRow(title: L("Lip sync", "麦克风口型"), note: L("Mouth follows your microphone, vowels included", "嘴跟着麦克风动，包括元音口型"), on: $model.mic)
            SwitchRow(title: L("Face tracking", "面部捕捉"), note: L("MediaPipe runs on this Mac. Video never leaves it.", "MediaPipe 在这台 Mac 上运行，画面不会离开本机。"), on: $model.camera)
            if model.camera {
                HStack {
                    Text(L("Hold still facing the camera for a second to calibrate automatically.", "正对摄像头静止一秒会自动校准。"))
                        .font(.system(size: 12)).foregroundStyle(Theme.dim)
                    Spacer()
                    Button(L("Calibrate now", "立即校准")) { model.app.calibrateCamera() }.buttonStyle(SoftButton())
                }
                .settingsRow()
            }
        }
    }

    @ViewBuilder var desktopSection: some View {
        SettingsSection(L("On the desktop", "桌面上")) {
            HStack {
                Text(L("Size", "大小")).fontWeight(.medium)
                Spacer()
                Picker(L("Size", "大小"), selection: $model.size) {
                    ForEach(AppDelegate.sizes, id: \.1) { Text($0.0).tag($0.1) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
            }
            .settingsRow()
            SwitchRow(title: L("Always on top", "置顶"), note: L("Stays above other windows", "保持在其他窗口上面"), on: $model.onTop)
            SwitchRow(title: L("Click-through", "鼠标穿透"), note: L("Locks the pet in place so clicks pass through it", "锁定桌宠位置，点击会穿过它"), on: $model.locked)
        }
    }

    @ViewBuilder var wallpaperSection: some View {
        SettingsSection(L("Wallpaper", "壁纸")) {
            HStack {
                Text(L("Size", "大小")).fontWeight(.medium)
                Spacer()
                SoftSegments(options: AppDelegate.wallpaperSizes, selection: $model.wallpaperSize, height: 24).frame(width: 240)
            }
            .settingsRow()
            HStack(spacing: 10) {
                Text(L("Exact size", "精确大小")).fontWeight(.medium)
                Spacer()
                Slider(value: $model.wallpaperSize, in: AppDelegate.wallpaperSizeRange).frame(width: 190)
                Text("\(Int((model.wallpaperSize * 100).rounded()))%")
                    .font(.system(size: 12, weight: .medium)).monospacedDigit().foregroundStyle(Theme.dim)
                    .frame(width: 40, alignment: .trailing)
            }
            .settingsRow()
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(L("Position", "位置")).fontWeight(.medium)
                    if model.wallpaperCustomSpot {
                        Text(L("Placed on screen", "已在屏幕上摆放")).font(.system(size: 12)).foregroundStyle(Theme.dim)
                    }
                }
                Spacer()
                SoftSegments(options: AppDelegate.wallpaperAligns, selection: $model.wallpaperAlign, height: 24).frame(width: 240)
            }
            .settingsRow()
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(L("Adjust on screen", "在屏幕上调整")).fontWeight(.medium)
                    Text(L("Drag the character anywhere and resize it freely", "把角色拖到任意位置，自由缩放"))
                        .font(.system(size: 12)).foregroundStyle(Theme.dim)
                }
                Spacer()
                Button(model.adjustingWallpaper ? L("Adjusting…", "调整中…") : L("Adjust…", "调整…")) { model.adjustWallpaper() }
                    .buttonStyle(SoftButton(prominent: true)).disabled(model.adjustingWallpaper)
            }
            .settingsRow()
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(L("Background", "背景")).fontWeight(.medium)
                    Text(model.wallpaperBackgroundName)
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).lineLimit(1).truncationMode(.middle)
                }
                Spacer()
                BackgroundSwatches(model: model, size: 28, spacing: 6, perRow: 6)
            }
            .settingsRow(minHeight: 60)
            if model.canRestoreDesktop {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(L("Desktop picture", "桌面图片")).fontWeight(.medium)
                        Text(L("DollPet set it. Your own picture is saved.", "这是 DollPet 设置的，你原来的图片已保存。"))
                            .font(.system(size: 12)).foregroundStyle(Theme.dim)
                    }
                    Spacer()
                    Button(L("Restore my picture", "恢复我的壁纸")) { model.restoreDesktop() }.buttonStyle(SoftButton())
                }
                .settingsRow()
            }
        }
    }

    @ViewBuilder var modelsTab: some View {
        SettingsSection(L("Current pet", "当前桌宠")) {
            HStack(spacing: 12) {
                ModelThumb(size: 48)
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.modelName).fontWeight(.semibold).lineLimit(1).truncationMode(.middle)
                    Text(model.fromEditor ? L("Saved by DollPet", "由 DollPet 保存") : (model.modelPath == nil ? L("Bundled with the app", "App 内置") : L("On your desktop", "在桌面上")))
                        .font(.system(size: 12)).foregroundStyle(Theme.dim)
                }
                Spacer()
                Button(L("Open Model…", "打开模型…")) { model.app.openModel(); model.refresh() }.buttonStyle(SoftButton())
                Button(L("Open Editor", "打开编辑器")) { model.app.openEditor() }.buttonStyle(SoftButton(prominent: true))
            }
            .settingsRow(minHeight: 72)
        }
        SettingsSection(L("Recent", "最近")) {
            if model.recents.isEmpty {
                Text(L("PSDs and .doll files you open show up here.", "打开过的 PSD 和 .doll 文件会显示在这里。"))
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).settingsRow()
            }
            ForEach(model.recents) { r in
                RecentRow(recent: r, current: model.isCurrent(r),
                          usePet: { model.usePet(r) }, edit: { model.edit(r) },
                          reveal: { model.reveal(r) }, forget: { model.forget(r) })
                    .settingsRow()
            }
        }
    }
}

// MARK: building blocks

struct TabButton: View {
    let title: String
    let symbol: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: symbol).font(.system(size: 16))
                Text(title).font(.system(size: 11.5, weight: .medium))
            }
            .foregroundStyle(on ? Theme.accent : Theme.muted)
            .frame(width: 92, height: 48)
            .background(RoundedRectangle(cornerRadius: 8).fill(on ? Theme.accent.opacity(0.1) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// A caption, a rounded card of rows separated by lines, and an optional note under it.
struct SettingsSection<Content: View>: View {
    let title: String
    let note: String?
    @ViewBuilder let content: Content

    init(_ title: String, note: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.note = note
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Caption(title).padding(.horizontal, 4)
            _VariadicView.Tree(Rows()) { content }
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
            if let note {
                Text(note).font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.horizontal, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // stacks the section's rows with a hairline between them
    struct Rows: _VariadicView_MultiViewRoot {
        func body(children: _VariadicView.Children) -> some View {
            VStack(spacing: 0) {
                ForEach(children) { child in
                    if child.id != children.first?.id { Theme.line.frame(height: 1) }
                    child
                }
            }
        }
    }
}

extension View {
    func settingsRow(minHeight: CGFloat = 52) -> some View {
        padding(.horizontal, 14).padding(.vertical, 8).frame(minHeight: minHeight)
    }
}

struct SwitchRow: View {
    let title: String
    let note: String
    @Binding var on: Bool

    var body: some View {
        Toggle(isOn: $on) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).fontWeight(.medium)
                Text(note).font(.system(size: 12)).foregroundStyle(Theme.dim)
            }
        }
        .toggleStyle(PillSwitch())
        .settingsRow()
    }
}

struct AgentRow: View {
    let name: String
    let badge: String
    let file: String
    @Binding var on: Bool

    var body: some View {
        Toggle(isOn: $on) {
            HStack(spacing: 12) {
                Text(badge)
                    .font(.system(size: 11, weight: .bold))
                    .frame(width: 32, height: 32)
                    .background(RoundedRectangle(cornerRadius: 9).fill(Color(hex: 0xE9EBF1)))
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).fontWeight(.medium)
                    Text(file).font(.system(size: 11.5, design: .monospaced)).foregroundStyle(Theme.dim)
                }
                Spacer(minLength: 8)
                if on { Text(L("Connected", "已连接")).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.green) }
            }
        }
        .toggleStyle(PillSwitch())
        .settingsRow()
    }
}

// One reminder's sound: pick a system sound or an audio file of your own, and try it.
struct SoundRow: View {
    let kind: Sounds.Kind
    @ObservedObject var model: SettingsModel

    var body: some View {
        HStack {
            Text(kind.label).foregroundStyle(Theme.text2)
            Spacer()
            Menu {
                ForEach(Sounds.system, id: \.self) { name in
                    Button {
                        model.useSystemSound(kind, name)
                    } label: {
                        if !model.soundIsCustom(kind) && model.soundTitle(kind) == name { Label(name, systemImage: "checkmark") } else { Text(name) }
                    }
                }
                Divider()
                Button(L("Choose an Audio File…", "选择音频文件…")) { model.chooseSoundFile(kind) }
            } label: {
                Text(model.soundTitle(kind)).lineLimit(1).truncationMode(.middle)
            }
            .fixedSize()
            Button {
                model.preview(kind)
            } label: {
                Image(systemName: "play.fill").font(.system(size: 11)).frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.muted)
            .help(L("Play", "播放"))
            .accessibilityLabel(L("Play \(kind.label) sound", "播放「\(kind.label)」提示音"))
        }
    }
}

struct RecentRow: View {
    let recent: RecentModel
    let current: Bool
    let usePet: () -> Void, edit: () -> Void, reveal: () -> Void, forget: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .frame(width: 16)
                .opacity(current ? 1 : 0)
                .accessibilityHidden(!current)
            VStack(alignment: .leading, spacing: 1) {
                Text(recent.name).fontWeight(.medium).lineLimit(1).truncationMode(.middle)
                Text(recent.folder + " · " + recent.agoText)
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).lineLimit(1)
            }
            .help(recent.path)
            Spacer()
            Button(L("Use as pet", "设为桌宠"), action: usePet).buttonStyle(SoftButton()).disabled(current).opacity(current ? 0.45 : 1)
            IconButton(symbol: "pencil", help: L("Edit in the editor", "在编辑器里编辑"), action: edit)
            IconButton(symbol: "folder", help: L("Show in Finder", "在访达中显示"), action: reveal)
            IconButton(symbol: "xmark", help: L("Remove from list", "从列表移除"), action: forget)
        }
    }
}

struct IconButton: View {
    let symbol: String
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 12, weight: .medium)).frame(width: 28, height: 28).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.muted)
        .help(help)
        .accessibilityLabel(help)
    }
}

// What the speech bubble over the pet looks like, drawn to match Bubble.swift.
struct BubblePreview: View {
    let title: String
    let project: String
    let body_: String
    let caption: String
    let attention: Bool

    init(title: String, project: String, body: String, caption: String, attention: Bool) {
        self.title = title
        self.project = project
        self.body_ = body
        self.caption = caption
        self.attention = attention
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    if attention { Image(systemName: "exclamationmark.circle.fill").font(.system(size: 11)) }
                    else { Circle().fill(Color(hex: 0x1E9E63)).frame(width: 7, height: 7) }
                    Text(project.isEmpty ? title : "\(title) · \(project)")
                        .font(.system(size: 11.5, weight: attention ? .bold : .semibold))
                }
                .foregroundStyle(attention ? Color(hex: 0x5A3409) : Theme.muted)
                Text(body_).font(.system(size: 13, weight: .medium)).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(attention ? Theme.attentionText : Theme.text)
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14).fill(attention ? Theme.attention : .white))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(attention ? Color.clear : Theme.line))
            .shadow(color: Color(hex: 0x281E5A).opacity(0.12), radius: 10, y: 6)
            Text(caption).font(.system(size: 12)).foregroundStyle(Theme.dim).padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
    }
}
