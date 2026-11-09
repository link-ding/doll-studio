# Doll Studio

**English** | [简体中文](README.zh-CN.md)

Turn a layered PSD split by See-through straight into an animated 2D character. No Live2D or Inochi2D needed. The idle motion, lip sync and face tracking are ported from the open-source LivLiv Player, and the face model is Google MediaPipe (both Apache 2.0, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Everything runs locally:

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
| Interface language | `src/i18n.js` `desktop-pet/Lang.swift` | English and Chinese, switchable live |
| Editor | `index.html` `src/editor.js` | Open a PSD, adjust the rig, preview live, export |
| Player | `player.html` `src/player.js` | Plays a `.doll`; works as a browser source in streaming apps |

## Interface language

The editor, the player and DollPet's menus and settings all come in English and Chinese:

- The web pages (editor, player) follow the browser's language. The **EN / 中文** button in the header / control bar switches at any time and the choice is remembered in the browser; add `?lang=en` or `?lang=zh` to the URL to pin a language.
- DollPet follows macOS's preferred language. In the Settings window, top right, pick **Auto / EN / 中文**: the menus, settings, the pet's alert bubbles and the editor switch at once. The editor's language button switches the whole app too.
- Exported web pages follow the viewer's browser language.

## Running

ES modules in the browser need a local server:

```bash
cd doll-studio && python3 -m http.server 8765
```

Then open <http://localhost:8765> and drop in a PSD.

The MediaPipe files face tracking needs (about 17 MB) live in `vendor/mediapipe/`. If they are missing, run `vendor/fetch-mediapipe.sh` once (`desktop-pet/build.sh` runs it for you). The first time face tracking starts it compiles WebAssembly: about 6 s in a browser, about 15 s in DollPet; turning it on again in the same session is quick.

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

## Mac app (desktop pet + editor)

`desktop-pet/` packages the editor and the desktop pet as a native macOS app, DollPet.app, using only system frameworks (AppKit, WebKit, AVFoundation). The web files ship inside the app and the app serves them itself, so no local server is needed.

```bash
./desktop-pet/build.sh                  # bundles samples/seethrough.psd as the default model
./desktop-pet/build.sh my-model.doll    # bundle a different default model
open desktop-pet/build/DollPet.app
```

The icon sources are in `brand/`: `app-icon.svg` is the app icon, `logo-mark.svg` is the mark in the editor header and the web favicon, and `menubar-template.svg` is the menu bar icon. After changing an SVG, run `brand/make-icons.sh` (needs Google Chrome to render) to regenerate `desktop-pet/AppIcon.icns` and `desktop-pet/MenuBarIcon*.png`.

- Menu bar ✦ → **Open Editor…** (⌘E) opens the editor window; **Set as Desktop Pet** in the editor puts the current model on the desktop right away (saved as `~/Library/Application Support/DollPet/current.doll`)
- Exporting from the editor brings up the system save dialog
- Transparent, borderless and always on top; the mouse passes straight through the transparent area around the character
- The gaze follows the mouse anywhere on screen; drag the character to move it, click it and it smiles
- The ✦ menu bar icon, or right-clicking the character, opens the menu: open a model (.doll or PSD), size, always on top, follow cursor, lip sync, lock position
- Remembers the last model and position
- The eyelid lines, control points, part types and physics you set in the editor are remembered per file and restored next time; a re-exported or re-downloaded copy of the same character (renamed or in another folder) gets the earlier settings too (it is matched by the auto-measured position of the eyes and mouth)

### Task alerts (Claude Code / Codex)

Menu ✦ → **Settings…** (⌘,). In **Task Alerts**, turn on the Claude Code / Codex switch to connect, and click again to disconnect. Once connected, when a task finishes a bubble pops up above the pet (which tool, which project, its last line), the pet smiles and a sound plays; when Claude Code needs you to approve a permission, the bubble turns orange and the pet widens its eyes and nods.

How it works:

- Claude Code: adds `Stop` and `Notification` hooks to `~/.claude/settings.json`, running `DollPet notify claude`
- Codex: adds `notify = ["…/DollPet", "notify", "codex"]` at the top of `~/.codex/config.toml`
- `DollPet notify` boils the event down to one line and hands it to the running pet as a macOS distributed notification; if the pet isn't running it does nothing and never gets in Claude Code's or Codex's way

Before changing a config file DollPet backs it up as `.dollpet-backup` (only the state before the latest change), and also keeps the last ten copies by time in `~/Library/Application Support/DollPet/Backups/`. Config files are replaced whole, so an error midway never leaves half a file; a symlinked config is written to the file it points to. Your other hooks are kept; if Codex already has another notify program, it isn't overwritten. From the command line:

```bash
DollPet.app/Contents/MacOS/DollPet connect claude      # or codex; disconnect to remove
DollPet.app/Contents/MacOS/DollPet notify test         # send a test alert
```

The config records the app's absolute path, so connect again after moving DollPet.app.

## Artwork requirements

- Layer names should say which body part they are (See-through output works as-is).
- Parts that are covered should ideally be painted in fully (See-through already does this), otherwise turning the head shows holes.
- Higher resolution looks sharper: 768 px works, 2000 px and up looks better.

## Not done yet

- Hand-editing meshes and keyframe deformers
- Expression presets and motion recording
- Bones for separately drawn arms and body parts
