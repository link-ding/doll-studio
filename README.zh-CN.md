# Doll Studio

[English](README.md) | **简体中文**

把 See-through（或 [image-to-psd](https://github.com/link-ding/image-to-psd) skill）拆好的分层 PSD 直接变成会动的 2D 角色。不依赖 Live2D、Inochi2D；待机动作、口型和面捕移植自开源的 LivLiv Player，面捕模型用 Google MediaPipe（都是 Apache 2.0，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)），全部在本机运行：

| 模块 | 文件 | 作用 |
|---|---|---|
| PSD 解析 | `src/psd.js` | 自己实现的 PSD/PSB 读取（RLE / ZIP 压缩、图层蒙版、图层组、8/16 位） |
| 图层清理 | `src/cleanup.js` | 绑定前修整 PSD 图层：自动去掉零散的墨线碎片、把前发下面混进脸里的头发颜色盖成肤色；再按顺序重放编辑器里的修图笔画（擦除、盖色、移到别的图层、恢复原图） |
| 自动绑定 | `src/autorig.js` `src/roles.js` | 按图层名识别部件，自动拆左右眼，生成网格和口腔，测量脸部 |
| 运行时 | `src/rig.js` | 参数 → 顶点变形：2.5D 转头、眨眼、眼球、嘴型（含元音圆/扁）、呼吸、头发物理 |
| 渲染 | `src/renderer.js` | WebGL 网格渲染，用模板缓冲做瞳孔裁剪 |
| 驱动 | `src/driver.js` | 把下面三样和点击反应、任务提醒组合起来 |
| 待机动作 | `src/idle.js` | 随机噪声加弹簧的自然晃动、不均匀呼吸、连眨、每 10–20 秒一个小动作，视线跟随时头只转约 13°、眼睛带路 |
| 口型 | `src/voice.js` | 麦克风自动增益，并按频谱分出 o/u（圆）和 i/e（扁） |
| 面捕 | `src/tracking.js` + `vendor/mediapipe/` | 摄像头 → 转头、眨眼、视线、眉毛、嘴、笑；正对摄像头静止一秒自动校准 |
| 模型格式 | `src/format.js` | `.doll` 文件，格式说明见 [FORMAT.zh-CN.md](FORMAT.zh-CN.md) |
| 界面语言 | `src/i18n.js` `electron/main.js` | 中文和英文，可以随时切换 |
| 编辑器 | `index.html` `src/editor.js` | 打开 PSD、调整绑定、实时预览、导出 |
| 播放器 | `player.html` `src/player.js` | 播放 `.doll`，可以当直播软件的浏览器源 |

## 界面语言

编辑器、播放器和 DollPet 的菜单、设置都支持中文和英文：

- 网页（编辑器、播放器）默认跟随浏览器语言，右上角 / 按钮栏里的「EN / 中文」按钮可以随时切换，选择会记在浏览器里；地址里加 `?lang=zh` 或 `?lang=en` 可以固定语言。
- DollPet 默认跟随系统的首选语言，在面板最下面可以选「自动 / 中文 / EN」，菜单、面板、桌宠气泡和编辑器会立即切换。编辑器里的语言按钮也会同步到整个应用。
- 导出的网页打开时跟随浏览器语言。

## 运行

浏览器的 ES 模块需要通过本地服务器打开：

```bash
cd doll-studio && python3 -m http.server 8765
```

然后打开 <http://localhost:8765>，把 PSD 拖进去。

面捕需要的 MediaPipe 文件（约 17 MB）放在 `vendor/mediapipe/`。没有的话先运行一次 `vendor/fetch-mediapipe.sh`。第一次打开面捕要编译 WebAssembly，浏览器里约 6 秒，DollPet 里约 15 秒，之后同一次运行里再开就很快。

## 准备 PSD：image-to-psd

Doll Studio 高度依赖 **[image-to-psd](https://github.com/link-ding/image-to-psd)**：这是一个给 Claude Code、Codex 等 agent 用的 skill，能把一张角色立绘（PNG / JPG / SVG）拆成分层 PSD，共 19 个标准部件（`back hair`、`front hair`、`face`、`eyewhite`、`irides`、`eyelash`、`mouth`…），每层都有自己的像素和可编辑的蒙版。被挡住的部分它会补画完整，比如前发下面的脸、头后面的后发、虹膜下面的眼白，所以转头时不会露出空洞。它的图层名就是自动绑定认识的名字，拆出来的 PSD 可以直接拖进 Doll Studio。

```bash
npx skills add link-ding/image-to-psd --skill image-to-psd -g -y
```

装好后把角色图片发给 agent，说「用 image-to-psd 把这张角色图拆成分层 PSD」就行。完整的图层列表、示例和单独使用的导出脚本见 [image-to-psd 的说明](https://github.com/link-ding/image-to-psd/blob/main/README.zh-CN.md)。

## 流程

1. **打开 PSD**：See-through 的图层名（`front hair`、`eyewhite`、`irides`…）会被自动识别。
2. **检查部件**：左侧列表里识别错的部件可以改类型，改完会自动重新绑定。
3. **调控制点**：头部中心、头部半径、脖子支点、两只眼睛的闭眼线都可以拖动（闭眼线中间的点移动整条线，两端的小点调宽度和倾斜角度，接近水平时会吸附回水平）。
4. **修图**：右侧「修图」页。「清理零散笔画」默认打开，会列出每个图层清理了什么。在左侧选一个部件后可以直接在画布上画：「擦除」擦掉碎线，「盖色」用颜色盖住（Alt 点击从部件上取色），「移动」把拆错图层的线条移到另一个图层：在脸上大致涂过那根头发线，只有不是脸本身颜色的像素会移进前发，留下的空缺补成肤色；移完后前发会晃一下，表示这些线以后跟着头发动，「恢复」还原原图。打开「只显示这个部件」可以看到被其他图层挡住的部分。修图时角色保持静止；空格拖动画布，`[` `]` 调笔刷大小，⌘Z 撤销。笔画跟控制点一起按文件保存，导出的 `.doll` 和桌宠都会带上。
5. **调参数**：右侧可以手动拖每个参数，也可以调转头幅度和每组头发的物理参数。
6. **导出**：
   - `.doll`：模型文件，用播放器打开或者以后再编辑。
   - **导出网页**：生成一个独立的 HTML 文件，双击就能看，不需要服务器。

## 直播用

在 OBS 里添加「浏览器源」，地址填：

```
http://localhost:8765/player.html?model=你的模型.doll&bg=transparent
```

播放器里按 H 可以隐藏按钮，地址里加 `&lang=zh` 或 `&lang=en` 可以固定界面语言。打开「麦克风口型」后，说话时嘴会跟着动。

## 桌面应用（Windows 和 macOS）

DollPet 把编辑器和桌宠放进一个应用，用 Electron 做成（`electron/`），Windows 和 macOS 都能用。网页文件放在应用里，由应用自己提供，不需要再开本地服务器。`src/` 里没有 Electron 专用的代码：`electron/preload.js` 给网页提供宿主接口。

### 下载

到 [Releases](https://github.com/link-ding/doll-studio/releases) 下载安装包：

- `DollPet-<版本>-mac-arm64.dmg`：Apple 芯片（M1 及以后）的 Mac
- `DollPet-<版本>-mac-x64.dmg`：只给 Intel 芯片的 Mac
- `DollPet-<版本>-windows-x64-setup.exe`：一般的 Windows 电脑（ARM 版 Windows 用 `…-windows-arm64-setup.exe`）

安装包还没有签名。Windows 第一次运行会弹 SmartScreen 警告：点「更多信息 → 仍要运行」。macOS 先打开一次，然后在「系统设置 › 隐私与安全性」里点「仍要打开」。

### 使用

- 点托盘图标（macOS 上在菜单栏）打开面板：当前模型、快捷开关（置顶、跟随鼠标、麦克风口型、面部捕捉、鼠标穿透、提示音）、大小、桌宠 / 壁纸、任务提醒、最近的模型、语言。右键托盘图标或者角色是经典菜单。
- 「打开编辑器」打开编辑器窗口；编辑器里点「设为桌宠」，当前模型马上换到桌面上。导出会弹出系统的保存对话框。
- 桌宠透明、无边框、置顶，角色以外的透明区域鼠标可以直接穿透。视线跟随整个屏幕上的鼠标；按住角色可以拖动，单击会眯眼笑一下。
- 编辑器里调过的眼睛闭眼线、控制点、部件类型和物理参数按文件记住，下次打开自动恢复；重新导出或重新下载的同一个角色也会用上之前的设置（按自动测得的眼睛和嘴的位置判断是不是同一个角色）。
- 会记住上次的模型、位置和设置，保存在 `~/Library/Application Support/DollPet`（macOS）或 `%APPDATA%\DollPet`（Windows）。

### 壁纸模式

面板切到「壁纸」，角色就住到桌面上，在桌面图标下面，背景可以是桌面图片、动画场景、房间或者你自己的图片（点「+」，或者把图片拖到色块上）。可以选大小和左中右，也可以点「在屏幕上调整…」：拖动角色，拖顶边的圆点、滚动或双指捏合来缩放，方向键微调，回车确认，Esc 取消。选了场景、房间或图片，也会设成系统桌面图片；切回桌宠或点「恢复我的壁纸」会换回你原来的。

Electron 没有把窗口放到桌面图标下面的接口，所以 `electron/native.js` 通过 [koffi](https://koffi.dev/) 直接调用系统：macOS 上设成桌面图标下面一层，Windows 上挂到桌面的 WorkerW 窗口里。Windows 这部分是新写的，还没在很多电脑上试过。

### 任务提醒（Claude Code / Codex）

在面板里点 Claude Code 或 Codex 旁边的「连接」就连上了（「断开」撤销）。任务完成时桌宠头上弹出气泡（哪个工具、哪个项目、最后一句话），笑一下并响提示音；Claude Code 需要你确认权限时，气泡变成橙色，桌宠睁大眼睛点头。

- Claude Code：在 `~/.claude/settings.json` 里加 `Stop` 和 `Notification` 两个 hook，命令是 `DollPet notify claude`
- Codex：在 `~/.codex/config.toml` 顶部加 `notify = ["…/DollPet", "notify", "codex"]`
- `DollPet notify` 把事件整理成一句话交给正在运行的桌宠；桌宠没开时什么也不做，也不会影响 Claude Code / Codex

改配置前会备份成 `.dollpet-backup`，另外在应用数据目录的 `Backups` 里按时间留最近十份。配置文件是整份替换写入的；配置是软链接的话会写到它指向的文件。已有的其他 hook 会保留；Codex 如果已经设置了别的 notify 程序，DollPet 会接着调用它，断开时再放回去。配置里记的是应用的路径，移动应用之后要重新连接一次。

### 自己编译

```bash
cd electron && npm install
npm start                      # 启动桌宠（npm start -- --editor 同时打开编辑器）
npm run dist:mac               # 或 dist:win，安装包在 electron/dist
```

要先运行过一次 `vendor/fetch-mediapipe.sh`（面捕用）。有 `samples/seethrough.psd` 的话，`npm start` 在你选模型之前先显示它。GitHub Actions 里的 **Desktop app** 工作流（`.github/workflows/desktop.yml`）会在 GitHub 的机器上编出 Windows 和 macOS 的安装包；推一个 `v0.1.0` 这样的标签，安装包就会挂到对应的 Release 上。

图标的源文件在 `brand/`：`app-icon.svg` 是应用图标，`logo-mark.svg` 是编辑器页头和网页 favicon 用的标志，`menubar-template.svg` 是菜单栏图标。改了 SVG 之后运行 `brand/make-icons.sh`（需要装 Google Chrome 来渲染），会重新生成 `electron/build` 和 `electron/assets` 里的图标。

## 对素材的要求

- 图层名能看出是哪个部位（See-through 和 [image-to-psd](https://github.com/link-ding/image-to-psd) 的输出可以直接用）。
- 被遮住的部分最好补画完整（See-through 和 image-to-psd 已经补过），否则转头时会露出空洞。
- 分辨率越高越清晰，768px 能用，2000px 以上效果更好。

## 还没做的

- 手动编辑网格和关键帧变形
- 表情预设和动作录制
- 手臂、身体分件的骨骼
