// Wallpaper mode.
//
// The pet window becomes the desktop: it fills the main screen under the desktop icons (native.js) and ignores the
// mouse, and the page draws the character standing at the bottom of the screen over a background: the desktop
// picture itself (the page is transparent), an animated scene (src/scenes.js), a room (src/rooms.js), or a picture
// of the user's (kept in <userData>/Pictures). A scene, room or picture also becomes the system desktop picture, so
// it is there on the lock screen and after DollPet quits; the picture the user had is remembered the first time and
// put back by "Restore my picture", by choosing "Desktop picture", or by going back to the pet.
//
// "Adjust on screen" brings the wallpaper window up over the other windows: dragging the character moves it (it
// snaps to the bottom, sides and middle), dragging a dot on its top edge, scrolling or pinching resizes it about its
// feet, arrow keys nudge it, Return keeps the change and Escape puts back what it was. A panel at the top of the
// screen (hud.html) has a size slider and Reset / Cancel / Done. The spot is kept as shares of the screen.

const fs = require('node:fs');
const path = require('node:path');

const PRESETS = [
  { id: 'desktop', kind: 'desktop', en: 'Desktop picture', zh: '桌面图片' },
  { id: 'ribbon', kind: 'scene', en: 'Ribbon Breeze', zh: '丝带微风' },
  { id: 'hearts', kind: 'scene', en: 'Heart Bubbles', zh: '爱心泡泡' },
  { id: 'stars', kind: 'scene', en: 'Star Mobile', zh: '星星风铃' },
  { id: 'strawberry', kind: 'scene', en: 'Strawberry Milk', zh: '草莓牛奶' },
  { id: 'curtain', kind: 'scene', en: 'Lace Curtain', zh: '蕾丝窗帘' },
  { id: 'bunting', kind: 'scene', en: 'Party Bunting', zh: '派对彩旗' },
  { id: 'moonroom', kind: 'room', en: 'Lavender Moon Room', zh: '薰衣草月亮房', image: 'backgrounds/lavender-moon-room.png' },
  { id: 'tearoom', kind: 'room', en: 'Mint Tea Room', zh: '薄荷茶室', image: 'backgrounds/mint-tea-room.png' },
  { id: 'catcafe', kind: 'room', en: 'Peach Cat Cafe', zh: '蜜桃猫咖', image: 'backgrounds/peach-cat-cafe.png' },
  { id: 'berryroom', kind: 'room', en: 'Strawberry Bedroom', zh: '草莓卧室', image: 'backgrounds/strawberry-bedroom.png' },
];
const SIZES = [['Small', '小', 0.55], ['Medium', '中', 0.75], ['Large', '大', 0.95]];
const ALIGNS = [['Left', '左', 'left'], ['Center', '中', 'center'], ['Right', '右', 'right']];
const MIN = 0.15, MAX = 1;
const PICTURE_PREFIX = 'picture:';
// what the page can show as a CSS background
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function makeWallpaper(ctx) {
  const { S, save, L, isMac, js, native, alive, screen, nativeImage, dialog, shell, BrowserWindow, Menu } = ctx;
  const wallpapers = path.join(ctx.support(), 'Wallpapers'); // stills of scenes and copies of rooms the system shows
  const picturesDir = path.join(ctx.support(), 'Pictures');

  let wallAspect = 0.6, cut = { left: false, right: false };
  let edit = null; // while adjusting: { size, spot } to put back on Cancel
  let hud = null, hudSize = { width: 640, height: 64 };
  let backgroundFile = null; // served at doll://app/background
  const swatches = new Map(); // id -> data URL

  const available = () => native.available;
  const on = () => !!S.wallpaper && native.available;
  const display = () => screen.getPrimaryDisplay();
  // where the character may be: the screen under the menu bar on macOS (the Dock floats over the wallpaper), the
  // work area on Windows (the taskbar would hide its feet)
  function usable(d = display()) {
    const s = d.bounds, a = d.workArea;
    return isMac ? { x: s.x, y: a.y, width: s.width, height: s.y + s.height - a.y } : a;
  }
  const size = () => clamp(S.wallSize ?? 0.75, MIN, MAX);

  // ---------- backgrounds ----------

  function pictures() {
    let files = [];
    try { files = fs.readdirSync(picturesDir).filter(f => IMAGE.test(f) && !f.startsWith('.')).sort(); } catch {}
    return files.map(f => {
      const original = f.replace(/^\d+-/, '');
      return { id: PICTURE_PREFIX + f, kind: 'picture', en: original.replace(/\.[^.]+$/, ''), zh: original.replace(/\.[^.]+$/, ''), file: path.join(picturesDir, f) };
    });
  }
  const all = () => [...PRESETS, ...pictures()];
  const nameOf = b => L(b.en, b.zh);
  function current() {
    const list = all();
    return list.find(b => b.id === S.wallBg) ?? list[0];
  }

  function pictureCSS() {
    const b = current();
    if (b.kind !== 'picture' || !fs.existsSync(b.file)) { backgroundFile = null; return null; }
    backgroundFile = b.file;
    // a new query each time, so a changed picture is fetched again
    return `#15161c url("doll://app/background?v=${Date.now()}") center / cover no-repeat`;
  }

  // ---------- where the character goes ----------

  function setAspect(aspect, edges) {
    if (aspect > 0) wallAspect = aspect;
    cut = { left: !!edges?.left, right: !!edges?.right };
  }

  // In screen coordinates (DIPs, top left). Its height a share of the usable height. At a preset spot it stands on
  // the bottom edge, and a side where the artwork is cut off goes right to the screen edge when placed on that side.
  function rect() {
    const U = usable(), spot = S.wallSpot;
    const maxW = spot ? U.width : U.width * 0.9;
    let h = Math.round(U.height * size()), w = Math.round(h * wallAspect);
    if (w > maxW) { w = Math.round(maxW); h = Math.round(w / wallAspect); }
    const bottom = U.y + U.height;
    if (spot) {
      const x = clamp(Math.round(U.x + spot.x * U.width - w / 2), U.x, Math.max(U.x, U.x + U.width - w));
      const y = clamp(Math.round(bottom - spot.y * U.height - h), U.y, Math.max(U.y, bottom - h));
      return { x, y, width: w, height: h };
    }
    const margin = Math.round(U.width * 0.06);
    const align = S.wallAlign ?? 'right';
    const x = align === 'left' ? U.x + (cut.left ? 0 : margin)
      : align === 'center' ? Math.round(U.x + U.width / 2 - w / 2)
      : U.x + U.width - (cut.right ? 0 : margin) - w;
    return { x, y: bottom - h, width: w, height: h };
  }

  // the character's box in the page (relative to the screen), and whether the adjusting frame shows
  function placement() {
    const r = rect(), s = display().bounds;
    return { x: r.x - s.x, y: r.y - s.y, w: r.width, h: r.height, edit: !!edit };
  }

  // Sizes the window to the screen and tells the page where to draw the character and over what.
  function layout() {
    const pet = ctx.pet();
    if (!on() || !alive(pet) || !ctx.pageReady()) return;
    fitWindow();
    const o = placement(), b = current();
    if (b.kind === 'scene' || b.kind === 'room') o.scene = b.id;
    else o.bg = pictureCSS() ?? 'transparent';
    js(pet, `pet.wallpaper(${JSON.stringify(o)})`);
  }

  function fitWindow() {
    const pet = ctx.pet(), d = display();
    if (!alive(pet)) return;
    if (edit || isMac) {
      const b = pet.getBounds(), s = d.bounds;
      if (b.x !== s.x || b.y !== s.y || b.width !== s.width || b.height !== s.height) pet.setBounds(s);
    } else {
      // a child of the desktop window is placed by native.js
      native.toDesktop(pet, true, d.bounds, d.scaleFactor);
    }
  }

  // moves or resizes the character without touching the background
  function place() {
    if (on() && ctx.pageReady()) js(ctx.pet(), `pet.place(${JSON.stringify(placement())})`);
  }

  // ---------- the mode ----------

  // Puts the pet window where the current mode wants it.
  function apply() {
    const pet = ctx.pet();
    if (!alive(pet)) return;
    if (on()) {
      const d = display();
      ctx.setIgnore(true);
      pet.setAlwaysOnTop(false);
      pet.setBounds(d.bounds);
      try {
        native.toDesktop(pet, true, d.bounds, d.scaleFactor);
      } catch (e) {
        S.wallpaper = false;
        save();
        ctx.alert(L('Could not put the pet on the desktop', '无法把桌宠放到桌面上'), e.message);
        return apply();
      }
      layout();
      syncSystem();
    } else {
      if (native.available) try { native.toDesktop(pet, false); } catch {}
      ctx.applyLevel();
      if (ctx.pageReady()) js(pet, 'pet.wallpaper(null)');
      pet.setBounds(ctx.petBounds());
      // back to a pet: the user's own desktop picture returns; the background choice stays for next time
      if (canRestore()) restoreSystem(true);
    }
    ctx.refresh();
  }

  function setMode(v) {
    if (v && !available()) {
      ctx.alert(L('Wallpaper mode is not available', '壁纸模式不可用'), native.error?.message ?? '');
      return;
    }
    if (!v) endEdit(true);
    S.wallpaper = !!v;
    save();
    apply();
  }

  function setSize(v) {
    if (!(v > 0)) return;
    S.wallSize = clamp(v, MIN, MAX);
    save();
    place();
    ctx.refresh();
    pushHud();
  }

  // a preset spot; picking one drops a spot set on screen
  function setAlign(a) {
    if (!ALIGNS.some(x => x[2] === a)) return;
    S.wallAlign = a;
    S.wallSpot = null;
    save();
    place();
    ctx.refresh();
  }

  function setBackground(id) {
    if (id === 'add') return choosePictures();
    const b = all().find(x => x.id === id);
    if (!b) return;
    S.wallBg = id;
    // a room has its floor in the middle: the character stands there, unless the user put it somewhere on screen
    if (b.kind === 'room' && !S.wallSpot) S.wallAlign = 'center';
    save();
    layout();
    syncSystem();
    ctx.refresh();
  }

  // ---------- the user's pictures ----------

  async function choosePictures() {
    ctx.hidePopover();
    const r = await dialog.showOpenDialog({
      title: L('Add pictures for the wallpaper', '添加壁纸图片'), buttonLabel: L('Add', '添加'),
      filters: [{ name: L('Pictures', '图片'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (!r.canceled) addPictures(r.filePaths);
  }

  // Copies pictures in (the same file added again is not copied twice) and makes the last one the background.
  function addPictures(files) {
    let added = null;
    const failed = [];
    for (const src of files.filter(f => IMAGE.test(f))) {
      try {
        const size = fs.statSync(src).size;
        const same = pictures().find(p => path.basename(p.file).replace(/^\d+-/, '') === path.basename(src) && fs.statSync(p.file).size === size);
        if (same) { added = same.id; continue; }
        fs.mkdirSync(picturesDir, { recursive: true });
        const name = `${Date.now()}-${path.basename(src)}`;
        fs.copyFileSync(src, path.join(picturesDir, name));
        added = PICTURE_PREFIX + name;
      } catch {
        failed.push(path.basename(src));
      }
    }
    if (failed.length) ctx.alert(L('Could not add the picture', '无法添加图片'), failed.join(', '));
    if (added) setBackground(added); else ctx.refresh();
  }

  // to the Trash; the background in use gives way to the desktop picture first
  async function removePicture(id) {
    const p = pictures().find(x => x.id === id);
    if (!p) return;
    if (S.wallBg === id) setBackground('desktop');
    swatches.delete(id);
    try { await shell.trashItem(p.file); } catch {}
    ctx.refresh();
  }

  function pictureMenu(id) {
    const p = pictures().find(x => x.id === id);
    if (!p) return;
    Menu.buildFromTemplate([
      { label: isMac ? L('Show in Finder', '在访达中显示') : L('Show in Folder', '在文件夹中显示'), click: () => shell.showItemInFolder(p.file) },
      { label: L('Remove', '移除'), click: () => removePicture(id) },
    ]).popup();
  }

  // ---------- swatches for the popover ----------

  // A small picture per background: a still of the scene (drawn by the pet page), the room's picture or the user's
  // picture made small. Made once, when the popover first shows it.
  let making = false;
  async function makeSwatches() {
    if (making) return;
    making = true;
    for (const b of all()) {
      if (swatches.has(b.id) || b.kind === 'desktop') continue;
      let url = null;
      if (b.kind === 'scene') {
        if (!ctx.pageReady()) continue;
        url = await js(ctx.pet(), `pet.still(${JSON.stringify(b.id)}, 96, 64)`);
      } else {
        const file = b.kind === 'room' ? path.join(ctx.WEB, b.image) : b.file;
        try {
          const img = nativeImage.createFromPath(file);
          if (!img.isEmpty()) url = img.resize({ width: 96, quality: 'good' }).toDataURL();
        } catch {}
      }
      swatches.set(b.id, typeof url === 'string' ? url : null);
      ctx.refresh();
    }
    making = false;
  }

  function state() {
    const sz = SIZES.find(x => Math.abs(x[2] - size()) < 0.01);
    const b = current();
    const list = all().map(x => ({ id: x.id, kind: x.kind, name: nameOf(x), thumb: swatches.get(x.id) ?? null }));
    if (list.some(x => !swatches.has(x.id) && x.kind !== 'desktop')) setTimeout(makeSwatches, 0);
    return {
      available: available(), on: on(), editing: !!edit,
      size: size(), sizeName: sz ? L(sz[0], sz[1]) : L('Custom', '自定义'),
      sizes: SIZES.map(([en, zh, v]) => [v, L(en, zh)]),
      align: S.wallSpot ? null : (S.wallAlign ?? 'right'),
      aligns: ALIGNS.map(([en, zh, v]) => [v, L(en, zh)]),
      background: b.id, backgroundName: nameOf(b), canRestore: canRestore(),
      backgrounds: list,
    };
  }

  // ---------- the system desktop picture ----------

  const displayKey = () => (isMac ? String(display().id) : 'all');
  // the user's picture can be put back only if it still exists
  const canRestore = () => Object.values(S.originalDesktops ?? {}).some(exists);
  // pictures DollPet made or keeps (in its own folder, or the prototype's) are not the user's
  const ours = f => [ctx.support(), path.join(path.dirname(ctx.support()), 'DollPet Electron')].some(d => f.startsWith(d + path.sep));
  const exists = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };

  // Makes the system desktop picture match the chosen background: a still of the scene, the room's picture, the
  // user's picture, or (for "Desktop picture") what the user had before.
  // one at a time: a change while one runs is made again after it
  let syncing = null, again = false;
  function syncSystem() {
    if (syncing) { again = true; return syncing; }
    syncing = doSync().finally(() => {
      syncing = null;
      if (again) { again = false; syncSystem(); }
    });
    return syncing;
  }
  async function doSync() {
    if (!on() || !ctx.pageReady()) return;
    const b = current();
    try {
      if (b.kind === 'desktop') { if (canRestore()) restoreSystem(); return; }
      if (b.kind === 'picture') { if (exists(b.file)) setDesktop(b.file); return; }
      fs.mkdirSync(wallpapers, { recursive: true });
      const shown = native.getPicture();
      if (b.kind === 'room') {
        // the room's picture, copied out of the app (an updated or moved app would leave the system pointing at nothing)
        const prefix = `${b.id}-picture-`;
        if (shown && shown.startsWith(wallpapers) && path.basename(shown).startsWith(prefix) && exists(shown)) return;
        const dest = path.join(wallpapers, prefix + Date.now() + path.extname(b.image));
        fs.copyFileSync(path.join(ctx.WEB, b.image), dest);
        setDesktop(dest);
        removeOld(dest);
        return;
      }
      const d = display(), w = Math.round(d.bounds.width * d.scaleFactor), h = Math.round(d.bounds.height * d.scaleFactor);
      const prefix = `${b.id}-${w}x${h}-`;
      if (shown && shown.startsWith(wallpapers) && path.basename(shown).startsWith(prefix) && exists(shown)) return;
      const png = await js(ctx.pet(), `pet.still(${JSON.stringify(b.id)}, ${w}, ${h})`);
      if (!on() || current().id !== b.id || typeof png !== 'string') return;
      // a new name each time: the system keeps showing a cached picture for a path it has seen
      const dest = path.join(wallpapers, prefix + Date.now() + '.png');
      fs.writeFileSync(dest, Buffer.from(png.split(',')[1], 'base64'));
      setDesktop(dest);
      removeOld(dest);
    } catch (e) {
      console.error('DollPet: could not set the desktop picture:', e);
    }
  }

  // development: DOLL_DRY_DESKTOP=1 logs the desktop picture changes instead of making them
  const dryRun = process.env.DOLL_DRY_DESKTOP === '1';
  function setDesktop(file) {
    rememberOriginal();
    try {
      if (dryRun) console.log('[desktop picture]', file); else native.setPicture(file);
    } catch (e) {
      ctx.alert(L('Could not change the desktop picture', '无法更换桌面图片'), e.message);
    }
    ctx.refresh();
  }

  // once, before the first change: the picture the user had (unless it is one of DollPet's, or gone)
  function rememberOriginal() {
    const key = displayKey();
    S.originalDesktops ??= {};
    if (S.originalDesktops[key] && exists(S.originalDesktops[key])) return;
    const shown = native.getPicture();
    if (dryRun) return;
    if (!shown || ours(shown) || !exists(shown)) { delete S.originalDesktops[key]; save(); return; }
    S.originalDesktops[key] = shown;
    save();
  }

  // Puts back the picture the user had and deletes DollPet's stills. keepChoice: leave the chosen background as it
  // is (going back to the pet); otherwise a scene or room gives way to "Desktop picture", so the wallpaper matches
  // what the system now shows.
  function restoreSystem(keepChoice = false) {
    for (const file of Object.values(S.originalDesktops ?? {})) {
      if (exists(file)) try { if (dryRun) console.log('[desktop picture restored]', file); else native.setPicture(file); } catch {}
    }
    S.originalDesktops = {};
    removeOld(null);
    if (!keepChoice && ['scene', 'room'].includes(current().kind)) {
      S.wallBg = 'desktop';
      layout();
    }
    save();
    ctx.refresh();
  }

  function removeOld(keep) {
    let files = [];
    try { files = fs.readdirSync(wallpapers); } catch {}
    for (const f of files) {
      if (path.join(wallpapers, f) !== keep) try { fs.rmSync(path.join(wallpapers, f), { force: true }); } catch {}
    }
  }

  // ---------- adjusting on screen ----------

  function beginEdit() {
    const pet = ctx.pet();
    if (!on() || edit || !alive(pet)) return;
    ctx.hidePopover();
    edit = { size: S.wallSize, spot: S.wallSpot };
    try { native.toDesktop(pet, false); } catch {}
    pet.setBounds(display().bounds);
    pet.setAlwaysOnTop(true, 'floating');
    ctx.setIgnore(false);
    pet.show();
    pet.focus();
    place();
    openHud();
    ctx.refresh();
  }

  // keep: false puts back the size and spot it had before adjusting
  function endEdit(keep) {
    if (!edit) return;
    const was = edit;
    edit = null;
    if (alive(hud)) hud.close();
    hud = null;
    if (!keep) { S.wallSize = was.size; S.wallSpot = was.spot; save(); }
    const pet = ctx.pet();
    if (on() && alive(pet)) {
      ctx.setIgnore(true);
      pet.setAlwaysOnTop(false);
      const d = display();
      try { native.toDesktop(pet, true, d.bounds, d.scaleFactor); } catch {}
      place();
    }
    ctx.refresh();
  }

  function reset() {
    S.wallSpot = null;
    S.wallSize = 0.75;
    save();
    place();
    pushHud();
    ctx.refresh();
  }

  // Puts the character's feet (bottom middle) at `feet` with the given height, kept inside the usable area, and
  // saves that as the spot. snap: close to the bottom, a side or the middle means on it.
  function setSpot(feet, height, snap) {
    const U = usable(), bottomEdge = U.y + U.height;
    let h = clamp(height, U.height * MIN, U.height * MAX);
    if (h * wallAspect > U.width) h = U.width / wallAspect;
    const w = h * wallAspect;
    let x = feet.x - w / 2, bottom = feet.y;
    if (snap) {
      const d = 12;
      if (Math.abs(bottom - bottomEdge) < d) bottom = bottomEdge;
      if (Math.abs(x - U.x) < d) x = U.x;
      if (Math.abs(x + w - (U.x + U.width)) < d) x = U.x + U.width - w;
      if (Math.abs(x + w / 2 - (U.x + U.width / 2)) < d) x = U.x + U.width / 2 - w / 2;
    }
    x = clamp(x, U.x, Math.max(U.x, U.x + U.width - w));
    bottom = clamp(bottom, U.y + h, bottomEdge);
    S.wallSize = h / U.height;
    S.wallSpot = { x: (x + w / 2 - U.x) / U.width, y: (bottomEdge - bottom) / U.height };
    save();
    place();
    pushHud();
  }

  const feetOf = r => ({ x: r.x + r.width / 2, y: r.y + r.height });
  function scale(f) {
    const r = rect();
    setSpot(feetOf(r), r.height * f, false);
  }

  // A press while adjusting (p: the cursor in screen DIPs): on a dot of the top edge it resizes about the feet, on
  // the character it moves it. null when it is on neither.
  function dragStart(p) {
    if (!edit) return null;
    const r0 = rect(), feet = feetOf(r0);
    const dots = [[r0.x, r0.y], [r0.x + r0.width / 2, r0.y], [r0.x + r0.width, r0.y]];
    const onDot = dots.some(([x, y]) => Math.hypot(x - p.x, y - p.y) <= 14);
    const inside = p.x >= r0.x - 4 && p.x <= r0.x + r0.width + 4 && p.y >= r0.y - 4 && p.y <= r0.y + r0.height + 4;
    if (!onDot && !inside) return null;
    return { r0, feet, onDot, start: p, reach: Math.max(1, Math.hypot(p.x - feet.x, p.y - feet.y)) };
  }
  function dragMove(g, p) {
    if (g.onDot) setSpot(g.feet, g.r0.height * Math.hypot(p.x - g.feet.x, p.y - g.feet.y) / g.reach, false);
    else setSpot({ x: g.feet.x + p.x - g.start.x, y: g.feet.y + p.y - g.start.y }, g.r0.height, true);
  }

  // scrolling resizes; a trackpad pinch arrives as a scroll with ctrl held
  function wheel(dy, pinch) {
    if (edit && dy) scale(Math.exp(-dy * (pinch ? 0.01 : 0.003)));
  }

  function key(k, shift) {
    if (!edit) return;
    const step = shift ? 10 : 1, r = rect(), f = feetOf(r);
    switch (k) {
      case 'Escape': return endEdit(false);
      case 'Enter': return endEdit(true);
      case 'ArrowLeft': return setSpot({ x: f.x - step, y: f.y }, r.height, false);
      case 'ArrowRight': return setSpot({ x: f.x + step, y: f.y }, r.height, false);
      case 'ArrowUp': return setSpot({ x: f.x, y: f.y - step }, r.height, false);
      case 'ArrowDown': return setSpot({ x: f.x, y: f.y + step }, r.height, false);
      case '=': case '+': return scale(1.05);
      case '-': case '_': return scale(1 / 1.05);
    }
  }

  // the panel at the top of the screen while adjusting
  function openHud() {
    hud = new BrowserWindow({
      width: hudSize.width, height: hudSize.height, show: false, frame: false, transparent: true, resizable: false,
      movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      hasShadow: false, backgroundColor: '#00000000', webPreferences: ctx.webPrefs('hud'),
    });
    hud.setAlwaysOnTop(true, 'pop-up-menu');
    hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    hud.loadFile(path.join(__dirname, 'hud.html'));
    hud.webContents.on('did-finish-load', () => { pushHud(); placeHud(); hud.showInactive(); });
  }
  function placeHud() {
    if (!alive(hud)) return;
    const a = display().workArea;
    hud.setBounds({ x: Math.round(a.x + a.width / 2 - hudSize.width / 2), y: a.y + 14, width: hudSize.width, height: hudSize.height });
  }
  function hudResize(width, height) {
    if (width > 0 && height > 0) { hudSize = { width: Math.ceil(width), height: Math.ceil(height) }; placeHud(); }
  }
  function pushHud() {
    if (alive(hud)) hud.webContents.send('state', { lang: ctx.langCode(), size: size(), min: MIN, max: MAX });
  }
  function hudAction(act, v) {
    switch (act) {
      case 'size': return setSize(Number(v));
      case 'reset': return reset();
      case 'cancel': return endEdit(false);
      case 'done': return endEdit(true);
    }
  }

  return {
    available, on, editing: () => !!edit, rect, display, setAspect, layout, place, apply, setMode, setSize, setAlign,
    setBackground, addPictures, pictureMenu, restoreSystem, canRestore, syncSystem, state, beginEdit, endEdit,
    dragStart, dragMove, wheel, key, hudAction, hudResize, isHud: wc => alive(hud) && hud.webContents === wc,
    backgroundFile: () => backgroundFile, hudWindow: () => hud,
  };
}

module.exports = { makeWallpaper };
