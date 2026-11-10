# Doll Studio

**English** | [简体中文](README.zh-CN.md)

Turn a layered PSD split by See-through (or by the [image-to-psd](https://github.com/link-ding/image-to-psd) skill) straight into an animated 2D character. No Live2D or Inochi2D needed. The idle motion, lip sync and face tracking are ported from the open-source LivLiv Player, and the face model is Google MediaPipe (both Apache 2.0, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Everything runs locally:

| Module | Files | What it does |
|---|---|---|
| PSD reader | `src/psd.js` | Our own PSD/PSB reader (RLE / ZIP compression, layer masks, layer groups, 8/16-bit) |
| Layer clean-up | `src/cleanup.js` | Tidies PSD layers before rigging: removes loose ink fragments and covers hair colour that bled into the face under the bangs with skin; then replays the editor's touch-up strokes in order (erase, cover, move to another layer, restore) |
| Auto rig | `src/autorig.js` `src/roles.js` | Recognises parts by layer name, splits left and right eyes, builds meshes and the mouth interior, measures the face |
| Runtime | `src/rig.js` | Parameters → vertex deformation: 2.5D head turn, blinking, eyeballs, mouth shapes (including round/flat vowels), breathing, hair physics |
| Renderer | `src/renderer.js` | WebGL mesh rendering, with the stencil buffer clipping the pupils |
| Driver | `src/driver.js` | Combines the three below with click reactions and task alerts |
| Idle motion | `src/idle.js` | Natural sway from random noise plus springs, uneven breathing, double blinks, a small gesture every 10–20 s; when following the gaze the head turns only about 13° and the eyes lead |
| Lip sync | `src/voice.js` | Microphone auto-gain, splitting o/u (round) and i/e (flat) by spectrum |
| Face tracking | `src/tracking.js` + `vendor/mediapipe/` | Camera → head turn, blinks, gaze, brows, mouth, smile; calibrates itself after a second of holding still facing the camera |
| Model format | `src/format.js` | `.doll` files, see [FORMAT.md](FORMAT.md) |
| Interface language | `src/i18n.js` `electron/main.js` | English and Chinese, switchable live |
| Editor | `index.html` `src/editor.js` | Open a PSD, adjust the rig, preview live, export |
| Player | `player.html` `src/player.js` | Plays a `.doll`; works as a browser source in streaming apps |

## Interface language

The editor, the player and DollPet's menus and settings all come in English and Chinese:

- The web pages (editor, player) follow the browser's language. The **EN / 中文** button in the header / control bar switches at any time and the choice is remembered in the browser; add `?lang=en` or `?lang=zh` to the URL to pin a language.
- DollPet follows the system's preferred language. At the bottom of its popover, pick **Auto / 中文 / EN**: the menus, the popover, the pet's alert bubbles and the editor switch at once. The editor's language button switches the whole app too.
- Exported web pages follow the viewer's browser language.

## Running

ES modules in the browser need a local server:

```bash
cd doll-studio && python3 -m http.server 8765
```

Then open <http://localhost:8765> and drop in a PSD.

The MediaPipe files face tracking needs (about 17 MB) live in `vendor/mediapipe/`. If they are missing, run `vendor/fetch-mediapipe.sh` once. The first time face tracking starts it compiles WebAssembly: about 6 s in a browser, about 15 s in DollPet; turning it on again in the same session is quick.

## Making the PSD: image-to-psd

Doll Studio relies heavily on **[image-to-psd](https://github.com/link-ding/image-to-psd)**, an agent skill (Claude Code, Codex…) that turns a single character illustration (PNG / JPG / SVG) into a layered PSD with 19 standard parts (`back hair`, `front hair`, `face`, `eyewhite`, `irides`, `eyelash`, `mouth`…), each with its own pixels and an editable mask. It fills in what is hidden, such as the face under the bangs, the back hair behind the head and the eye whites under the irises, so turning the head shows no holes. Its layer names are the ones the auto rig recognises, so its PSDs open in Doll Studio as-is.

```bash
npx skills add link-ding/image-to-psd --skill image-to-psd -g -y
```

Then give your agent a character image and ask it to "use image-to-psd to split this character artwork into a layered PSD". See the [image-to-psd README](https://github.com/link-ding/image-to-psd#readme) for the full layer list, examples and the standalone export script.

## Workflow

1. **Open a PSD**: See-through's layer names (`front hair`, `eyewhite`, `irides`…) are recognised automatically.
2. **Check the parts**: any part in the left list that was guessed wrong can get another type; the rig rebuilds right away.
3. **Tune the control points**: the head center, head radius, neck pivot and both eyelid lines can be dragged (the middle dot of an eyelid line moves the whole line, the small end dots set its width and tilt, snapping back to level near horizontal).
4. **Touch up**: the **Touch up** tab on the right. **Clean up stray strokes** is on by default and lists what it cleaned in each layer. Pick a part on the left and paint on the canvas: **Erase** removes stray bits, **Cover** paints over with a colour (Alt-click to pick a colour from the part), **Move** moves lines that ended up on the wrong layer to another one: paint loosely over a hair line on the face and only the pixels that aren't the face's own colour move into the front hair, with the gap filled in skin colour; afterwards the front hair gives a little shake to show those lines now move with the hair. **Restore** brings back the original. Turn on **Show only this part** to see what other layers hide. The character holds still while you paint; Space-drag pans, `[` `]` resize the brush, ⌘Z undoes. Strokes are saved per file along with the control points, and carried into exported `.doll` files and the desktop pet.
5. **Tune parameters**: drag each parameter by hand on the right, and adjust the head-turn amount and the physics of each hair group.
6. **Export**:
   - `.doll`: the model file, for the player or for editing later.
   - **Web page**: a single self-contained HTML file you can double-click to view, no server needed.

## Streaming

In OBS, add a **Browser Source** with the URL:

```
http://localhost:8765/player.html?model=your-model.doll&bg=transparent
```

Press H in the player to hide its controls; add `&lang=en` or `&lang=zh` to pin the interface language. With **Lip sync** on, the mouth moves as you talk.

## Desktop app (Windows and macOS)

DollPet puts the editor and the desktop pet in one app for Windows and macOS, built with Electron (`electron/`). The web files ship inside the app and the app serves them itself, so no local server is needed. `src/` has nothing Electron-specific: `electron/preload.js` gives the pages their host interface.

### Download

Get the installer from [Releases](https://github.com/link-ding/doll-studio/releases):

- `DollPet-<version>-mac-arm64.dmg`: Macs with Apple silicon (M1 and later)
- `DollPet-<version>-mac-x64.dmg`: Intel Macs only
- `DollPet-<version>-windows-x64-setup.exe`: most Windows PCs (`…-windows-arm64-setup.exe` for Windows on Arm)

The builds are not signed yet. On Windows, SmartScreen warns the first time: More info → Run anyway. On macOS, open the app once, then allow it in System Settings › Privacy & Security › Open Anyway.

### Using it

- Click the tray icon (in the menu bar on macOS) for the popover: the current model, quick toggles (always on top, follow cursor, lip sync, face tracking, click-through, alert sound), size, Desktop pet / Wallpaper, task alerts, recent models and language. Right-click it, or the character, for the classic menu.
- **Open Editor** opens the editor window; **Set as Desktop Pet** in the editor puts the current model on the desktop right away. Exporting brings up the system save dialog.
- The pet is transparent, borderless and always on top; the mouse passes through the transparent area around the character. The gaze follows the mouse anywhere on screen; drag the character to move it, click it and it smiles.
- The eyelid lines, control points, part types and physics you set in the editor are remembered per file and restored next time; a re-exported or re-downloaded copy of the same character gets the earlier settings too (matched by the auto-measured position of the eyes and mouth).
- Remembers the last model, position and settings, in `~/Library/Application Support/DollPet` (macOS) or `%APPDATA%\DollPet` (Windows).

### Wallpaper mode

Switch the popover to **Wallpaper** and the character lives on the desktop, under the icons, over the desktop picture, an animated scene, a room or a picture of your own (**+**, or drop pictures on the swatches). Pick a size and a side, or **Adjust on screen…**: drag the character, drag a dot on its top edge, scroll or pinch to resize, arrow keys to nudge, Return to keep, Escape to cancel. A scene, room or picture also becomes the system desktop picture; going back to the pet, or **Restore my picture**, puts yours back.

Electron has no way to put a window under the desktop icons, so `electron/native.js` calls the system through [koffi](https://koffi.dev/): on macOS the window goes to the level just under the icons, on Windows into the desktop's WorkerW window. The Windows part is new and has not been tried on many machines yet.

### Task alerts (Claude Code / Codex)

In the popover, **Connect** next to Claude Code or Codex (click **Disconnect** to undo). When a task finishes a bubble pops up above the pet (which tool, which project, its last line), the pet smiles and a sound plays; when Claude Code needs you to approve a permission, the bubble turns orange and the pet widens its eyes and nods.

- Claude Code: adds `Stop` and `Notification` hooks to `~/.claude/settings.json`, running `DollPet notify claude`
- Codex: adds `notify = ["…/DollPet", "notify", "codex"]` at the top of `~/.codex/config.toml`
- `DollPet notify` boils the event down to one line and hands it to the running pet; if the pet isn't running it does nothing and never gets in Claude Code's or Codex's way

Before changing a config file DollPet backs it up as `.dollpet-backup`, and keeps the last ten copies by time in its `Backups` folder. Config files are replaced whole, and a symlinked config is written to the file it points to. Your other hooks are kept; if Codex already has another notify program, DollPet runs it too and puts it back when disconnected. The config records the app's path, so connect again after moving the app.

### Building

```bash
cd electron && npm install
npm start                      # the pet (npm start -- --editor also opens the editor)
npm run dist:mac               # or dist:win: installers in electron/dist
```

`vendor/fetch-mediapipe.sh` must have run once (face tracking). When `samples/seethrough.psd` is there, `npm start` shows it before you pick a model. The **Desktop app** workflow (`.github/workflows/desktop.yml`) builds the Windows and macOS installers on GitHub's machines; pushing a tag such as `v0.1.0` attaches them to a release.

The icon sources are in `brand/`: `app-icon.svg` is the app icon, `logo-mark.svg` is the mark in the editor header and the web favicon, and `menubar-template.svg` is the menu bar icon. After changing an SVG, run `brand/make-icons.sh` (needs Google Chrome to render) to regenerate the icons in `electron/build` and `electron/assets`.

## Artwork requirements

- Layer names should say which body part they are (See-through and [image-to-psd](https://github.com/link-ding/image-to-psd) output work as-is).
- Parts that are covered should ideally be painted in fully (See-through and image-to-psd already do this), otherwise turning the head shows holes.
- Higher resolution looks sharper: 768 px works, 2000 px and up looks better.

## Not done yet

- Hand-editing meshes and keyframe deformers
- Expression presets and motion recording
- Bones for separately drawn arms and body parts
