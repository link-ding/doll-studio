// DollPet for Windows and macOS: the desktop pet and the Doll Studio editor, hosted by Electron.
// The web runtime (index.html, pet.html, src/) is served through doll://app/, and preload.js gives the pages the
// host interface they expect (the one the earlier native macOS app gave them, so src/ needs nothing of its own).
//
// The pet lives in a transparent, frameless, always-on-top window. 30 times a second the main process reads the
// cursor: it feeds the gaze (pet.pointer), and while the cursor is over the window it asks the page whether that
// pixel is drawn (pet.hit), so clicks on transparent parts go through to whatever is underneath.
//
// Clicking the tray icon opens a popover (popover.html), right-clicking it or the pet the classic menu. Wallpaper
// mode is in wallpaper.js, connecting Claude Code and Codex in agents.js.

const { app, BrowserWindow, Tray, Menu, nativeImage, screen, protocol, dialog, ipcMain, session, shell, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { makeAgents } = require('./agents.js');
const { makeWallpaper } = require('./wallpaper.js');
const native = require('./native.js');
const { Readable } = require('node:stream');

const isMac = process.platform === 'darwin';

// ---------- settings (userData/settings.json) ----------

// userData is <appData>/DollPet (Application Support/DollPet, %APPDATA%\DollPet), set before anything reads it, the
// single-instance lock included. On macOS the earlier native app kept the editor's tuning there too, in the same
// layout, so it carries over. The prototype used "DollPet Electron": its settings, pictures and pet move over once.
app.setPath('userData', path.join(app.getPath('appData'), 'DollPet'));
const support = () => app.getPath('userData');
const tuningDir = () => path.join(support(), 'Tuning');
(function moveFromPrototype() {
  const old = path.join(app.getPath('appData'), 'DollPet Electron');
  const settings = path.join(support(), 'settings.json');
  if (fs.existsSync(settings) || !fs.existsSync(path.join(old, 'settings.json'))) return;
  try {
    fs.mkdirSync(support(), { recursive: true });
    for (const name of ['Pictures', 'current.doll']) {
      if (fs.existsSync(path.join(old, name))) fs.cpSync(path.join(old, name), path.join(support(), name), { recursive: true });
    }
    // paths into the old folder point into the new one
    const text = fs.readFileSync(path.join(old, 'settings.json'), 'utf8').split(JSON.stringify(old).slice(1, -1)).join(JSON.stringify(support()).slice(1, -1));
    fs.writeFileSync(settings, text);
  } catch {}
})();
const settingsFile = () => path.join(support(), 'settings.json');
const DEFAULTS = { size: 420, aspect: 0.6, onTop: true, follow: true, locked: false, alertSound: true, lang: 'system', modelPath: null, x: null, y: null, recents: [] };
let S = { ...DEFAULTS };
try { S = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(support(), { recursive: true });
    const tmp = settingsFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(S, null, 2));
    fs.renameSync(tmp, settingsFile());
  } catch {}
}

// On macOS the first start takes the language and alert-sound choice from the earlier native app, if it was used.
if (isMac && !S.importedMac) {
  const pref = k => { try { return execFileSync('defaults', ['read', 'studio.doll.pet', k], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  const lang = pref('language'), sound = pref('alertSound');
  if (['system', 'en', 'zh'].includes(lang)) S.lang = lang;
  if (sound === '0' || sound === '1') S.alertSound = sound === '1';
  S.importedMac = true;
  save();
}

// ---------- language ----------

function systemLang() {
  try { return app.getPreferredSystemLanguages()[0] ?? app.getLocale(); } catch { return Intl.DateTimeFormat().resolvedOptions().locale; }
}
const zh = () => S.lang === 'zh' || (S.lang === 'system' && /^zh/i.test(systemLang() ?? ''));
const L = (en, z) => (zh() ? z : en);
const langCode = () => (zh() ? 'zh' : 'en');

// ---------- coding agents: what a hook event says ----------

function summary(s, limit = 110) {
  const t = String(s ?? '').replace(/[*_`#>|]+/g, '').replace(/\s+/g, ' ').trim();
  const chars = [...t];
  return chars.length > limit ? chars.slice(0, limit).join('') + '…' : t;
}

// the last assistant text in a Claude Code transcript (JSONL); only the tail is read
function lastAssistantText(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - 262144);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    for (const line of buf.toString('utf8').split('\n').reverse()) {
      try {
        const o = JSON.parse(line);
        if (o.type !== 'assistant') continue;
        const texts = (o.message?.content ?? []).filter(c => c.type === 'text').map(c => c.text);
        if (texts.length) return texts.join(' ');
      } catch {}
    }
  } catch {}
  return '';
}

function message(source, event) {
  const project = typeof event.cwd === 'string' ? path.basename(event.cwd) : '';
  if (source === 'claude') {
    if (event.stop_hook_active === true) return null;
    if (event.hook_event_name === 'Notification') {
      return { kind: 'attention', title: L('Claude Code needs your OK', 'Claude Code 需要你确认'), project, body: summary(event.message) };
    }
    const last = typeof event.transcript_path === 'string' ? lastAssistantText(event.transcript_path) : '';
    return { kind: 'done', title: L('Claude Code finished', 'Claude Code 完成了'), project, body: summary(last) };
  }
  if (source === 'codex') {
    if (event.type !== 'agent-turn-complete') return null;
    return { kind: 'done', title: L('Codex finished', 'Codex 完成了'), project, body: summary(event['last-assistant-message']) };
  }
  return { kind: 'done', title: L('Test alert', '测试提醒'), project: 'DollPet', body: L("Alerts are working. I'll let you know when a task finishes.", '提醒正常。任务完成时我会告诉你。') };
}

// `DollPet notify <claude|codex|test> [--then <program> …] [json]`: run by an agent's hook, it hands the event to the
// running pet (as the second-instance event's data) and exits. Claude Code passes the event on stdin, Codex as the
// last argument; a notify program Codex had before is kept after --then and gets every event too.
function runNotify(args) {
  const source = args[0] ?? 'test';
  let payload = args.length > 1 ? args[args.length - 1] : null;
  const then = args.indexOf('--then');
  if (then >= 0) {
    const argv = args.slice(then + 1);
    if (argv.length) {
      try {
        spawn(argv[0].replace(/^~(?=$|[\\/])/, os.homedir()), argv.slice(1), { detached: true, stdio: 'ignore' }).unref();
      } catch {}
    }
    if (args.length - 1 <= then + 1) payload = null;
  }
  let raw = payload;
  if (raw == null && source === 'claude' && !process.stdin.isTTY) {
    try { raw = fs.readFileSync(0, 'utf8'); } catch {}
  }
  let event = {};
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') event = o;
  } catch {}
  app.whenReady().then(() => {
    app.dock?.hide();
    const info = message(source, event);
    // the running pet gets it; with none running there is no one to tell
    if (info) app.requestSingleInstanceLock({ notify: info });
    app.exit(0);
  });
}

// ---------- the app ----------

const notifyAt = process.argv.indexOf('notify');
if (notifyAt > 0) runNotify(process.argv.slice(notifyAt + 1));
else runApp();

function runApp() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }

  // the web files: the repository in development, Resources/web in the packaged app (electron-builder extraResources)
  const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.resolve(__dirname, '..');
  // the model shown before the user picks one
  const DEFAULT_MODELS = app.isPackaged
    ? ['default.psd', 'default.doll'].map(f => path.join(process.resourcesPath, f))
    : [path.resolve(__dirname, '..', 'samples', 'seethrough.psd')];

  protocol.registerSchemesAsPrivileged([
    { scheme: 'doll', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);

  let pet = null, editor = null, thumbWin = null, bubble = null, tray = null, popover = null;
  let currentModel = null; // the file the pet shows
  let pageReady = false, aspect = S.aspect, micOn = false, cameraOn = false;
  let restoreMic = false, restoreCamera = false, petReloads = [];
  let editorReady = false, editorPending = null, editorFile = null, editorPath = null;

  const alive = w => w && !w.isDestroyed();
  const js = (w, code) => (alive(w) ? w.webContents.executeJavaScript(code).catch(() => {}) : Promise.resolve());
  const kindOf = p => (/\.(psd|psb)$/i.test(p) ? 'psd' : 'doll');
  const readable = p => { try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; } };
  const alert = (title, detail) => dialog.showMessageBox({ type: 'warning', message: title, detail: detail ?? '' });

  // ---------- doll://app/ ----------

  // Model files on their way to a page: each is served once at the address offer() returns, as bytes.
  const offered = new Map();
  const offer = file => {
    const token = crypto.randomUUID();
    offered.set(token, file);
    return 'doll://app/model/' + token;
  };
  const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.bmp': 'image/bmp', '.avif': 'image/avif',
  };
  const notFound = () => new Response('not found', { status: 404 });
  function serve(file, type) {
    const size = fs.statSync(file).size;
    return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { 'content-type': type, 'content-length': String(size) } });
  }
  function handleDoll(req) {
    try {
      const p = decodeURIComponent(new URL(req.url).pathname);
      if (p === '/background') {
        const file = wall.backgroundFile();
        return file ? serve(file, TYPES[path.extname(file).toLowerCase()] ?? 'image/jpeg') : notFound();
      }
      if (p.startsWith('/model/')) {
        const token = p.slice(7), file = offered.get(token);
        offered.delete(token);
        return file ? serve(file, 'application/octet-stream') : notFound();
      }
      const file = path.resolve(WEB, '.' + p);
      if (!file.startsWith(WEB + path.sep) || !fs.statSync(file).isFile()) return notFound();
      return serve(file, TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
    } catch {
      return notFound();
    }
  }

  // in development, page errors show in the terminal
  if (!app.isPackaged) {
    app.on('web-contents-created', (_e, wc) => wc.on('console-message', e => {
      if (e.level === 'error' || e.level === 'warning') console.log(`[page ${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    }));
  }

  const webPrefs = role => ({
    preload: path.join(__dirname, 'preload.js'),
    additionalArguments: ['--doll-role=' + role],
    contextIsolation: true,
    nodeIntegration: false,
  });

  // ---------- tuning, recent models and their thumbnails ----------

  const key = p => crypto.createHash('sha256').update(p).digest('hex');
  const tuningFile = p => path.join(tuningDir(), key(p) + '.json');
  const thumbFile = p => path.join(support(), 'Thumbs', key(p) + '.png');
  const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

  // What the pages get for a model file: { own: its tuning or null, others: [...] }. For a PSD, others are the
  // tunings kept for every other file, newest first (a re-export of the same character finds its tuning that way).
  function saved(p) {
    const own = readJSON(tuningFile(p));
    if (kindOf(p) !== 'psd') return JSON.stringify({ own, others: [] });
    const dir = tuningDir(), mine = path.basename(tuningFile(p));
    let files = [];
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== mine)
        .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 40);
    } catch {}
    const others = files.map(({ f }) => readJSON(path.join(dir, f))).filter(o => o && typeof o === 'object' && !Array.isArray(o));
    return JSON.stringify({ own, others });
  }

  const ours = p => DEFAULT_MODELS.includes(p) || p.startsWith(support() + path.sep) || (app.isPackaged && p.startsWith(process.resourcesPath));
  function recentsAdd(p) {
    p = path.resolve(p);
    if (!/\.(psd|psb|doll|json)$/i.test(p) || ours(p)) return;
    S.recents = [{ path: p, lastUsed: Date.now() }, ...S.recents.filter(r => r.path !== p)].slice(0, 20);
    save();
    rebuildMenu();
  }
  const existing = () => S.recents.filter(r => fs.existsSync(r.path));
  function ago(t) {
    const m = Math.floor((Date.now() - t) / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (m < 1) return L('just now', '刚刚');
    if (m < 60) return L(`${m} min ago`, `${m} 分钟前`);
    if (h < 24) return L(`${h} h ago`, `${h} 小时前`);
    return L(`${d} d ago`, `${d} 天前`);
  }
  // the saved still, unless the model file or its tuning changed since
  function thumbOf(p) {
    try {
      const made = fs.statSync(thumbFile(p)).mtimeMs;
      if (made < fs.statSync(p).mtimeMs) return null;
      try { if (made < fs.statSync(tuningFile(p)).mtimeMs) return null; } catch {}
      return 'data:image/png;base64,' + fs.readFileSync(thumbFile(p)).toString('base64');
    } catch { return null; }
  }

  function sendRecentsToEditor() {
    if (!editorReady) return;
    const list = existing().slice(0, 8).map(r => {
      const card = { name: path.basename(r.path), folder: path.basename(path.dirname(r.path)), path: r.path, ago: ago(r.lastUsed), current: r.path === S.modelPath };
      const thumb = thumbOf(r.path);
      if (thumb) card.thumb = thumb;
      return card;
    });
    js(editor, `studio.setRecents(${JSON.stringify(list)})`);
    makeThumbs();
  }

  // Renders the next recent card without a thumbnail in a hidden copy of the pet page, one at a time.
  let thumbing = false;
  const thumbFailed = new Set();
  // The current model's (the popover's header) comes first, then the editor's recent cards. The hidden page is
  // closed when none is left, so it doesn't hold a PSD's worth of memory while the pet runs for days.
  async function makeThumbs() {
    if (thumbing) return;
    const wanted = [currentModel, ...(editorReady ? existing().slice(0, 8).map(r => r.path) : [])];
    const next = wanted.find(p => p && fs.existsSync(p) && !thumbFailed.has(p) && !thumbOf(p));
    if (!next) {
      if (alive(thumbWin)) thumbWin.destroy();
      thumbWin = null;
      return;
    }
    const r = { path: next };
    thumbing = true;
    try {
      if (!alive(thumbWin)) {
        thumbWin = new BrowserWindow({ show: false, width: 320, height: 320, webPreferences: webPrefs('thumb') });
        await thumbWin.loadURL('doll://app/pet.html');
      }
      const png = await thumbWin.webContents.executeJavaScript(`(async () => {
        while (!window.pet) await new Promise(r => setTimeout(r, 50));
        return await pet.thumb(${JSON.stringify(kindOf(r.path))}, ${JSON.stringify(offer(r.path))}, ${saved(r.path)});
      })()`);
      fs.mkdirSync(path.dirname(thumbFile(r.path)), { recursive: true });
      fs.writeFileSync(thumbFile(r.path), Buffer.from(String(png).split(',')[1], 'base64'));
      if (editorReady) js(editor, `studio.setThumb(${JSON.stringify(r.path)}, ${JSON.stringify(png)})`);
      pushState();
    } catch {
      thumbFailed.add(r.path);
      if (alive(thumbWin)) thumbWin.destroy();
      thumbWin = null;
    }
    thumbing = false;
    makeThumbs();
  }

  // ---------- models ----------

  function load(p) {
    if (!readable(p)) { alert(L('Could not read the file', '无法读取文件'), p); return; }
    p = path.resolve(p);
    js(pet, `pet.load(${JSON.stringify(kindOf(p))}, ${JSON.stringify(offer(p))}, ${saved(p)})`);
    currentModel = p;
    makeThumbs();
    if (!DEFAULT_MODELS.includes(p)) { S.modelPath = p; save(); }
    recentsAdd(p);
    rebuildMenu();
  }

  function loadInitialModel() {
    if (S.modelPath && fs.existsSync(S.modelPath)) return load(S.modelPath);
    const bundled = DEFAULT_MODELS.find(f => fs.existsSync(f));
    if (bundled) return load(bundled);
    // no model yet (a first start; the published builds carry no sample): the editor's welcome screen explains
    // what to open, and "Set as Desktop Pet" there puts the result on the desktop
    openEditor();
  }

  async function openModel() {
    const r = await dialog.showOpenDialog({
      title: L('Choose a model (.doll, or a PSD from See-through)', '选择模型（.doll，或 See-through 拆好的 PSD）'),
      filters: [{ name: 'Doll / PSD', extensions: ['doll', 'psd', 'psb', 'json'] }],
      properties: ['openFile'],
    });
    if (!r.canceled && r.filePaths[0]) load(r.filePaths[0]);
  }

  // The editor's model becomes the pet; it is kept in userData so it survives restarts.
  function setPet(doll) {
    const file = path.join(support(), 'current.doll');
    try {
      fs.mkdirSync(support(), { recursive: true });
      fs.writeFileSync(file, doll);
    } catch (e) {
      alert(L('Could not save the pet model', '无法保存桌宠模型'), e.message);
      return;
    }
    load(file);
    if (alive(pet)) pet.showInactive();
  }

  // ---------- pet window ----------

  const SIZES = [['Small', '小', 280], ['Medium', '中', 420], ['Large', '大', 600], ['Extra large', '特大', 820]];

  function initialBounds() {
    const h = S.size, w = Math.round(h * aspect);
    const b = { x: S.x, y: S.y, width: w, height: h };
    const onScreen = S.x != null && screen.getAllDisplays().some(({ workArea: a }) =>
      b.x < a.x + a.width && b.x + w > a.x && b.y < a.y + a.height && b.y + h > a.y);
    if (!onScreen) {
      const a = screen.getPrimaryDisplay().workArea;
      b.x = a.x + a.width - w - 40;
      b.y = a.y + a.height - h - 20;
    }
    return b;
  }

  function createPet() {
    pet = new BrowserWindow({
      ...(wall.on() ? wall.display().bounds : initialBounds()),
      transparent: true, frame: false, hasShadow: false, resizable: false, maximizable: false, minimizable: false,
      fullscreenable: false, skipTaskbar: true, show: false, acceptFirstMouse: true, backgroundColor: '#00000000',
      // on the wallpaper it covers the whole screen, the menu bar's strip included (macOS keeps windows under it otherwise)
      enableLargerThanScreen: true,
      title: 'DollPet',
      webPreferences: { ...webPrefs('pet'), backgroundThrottling: false },
    });
    pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    applyLevel();
    setIgnore(true);
    pet.loadURL('doll://app/pet.html');
    pet.once('ready-to-show', () => {
      pet.showInactive();
      if (wall.on()) wall.apply();
    });
    pet.webContents.on('render-process-gone', () => reloadPet());
  }

  // Loads the pet page again; its "ready" message brings back the model and the microphone and camera. A page that
  // keeps failing is given up on after three tries in a minute.
  function reloadPet() {
    const now = Date.now();
    petReloads = [...petReloads.filter(t => now - t < 60000), now];
    if (petReloads.length > 3) {
      if (petReloads.length === 4) alert(L('The pet stopped working', '桌宠停止工作了'), L('DollPet restarted it three times and it stopped again. Open another model, or quit and reopen DollPet.', 'DollPet 已经重启了三次，它又停了。换一个模型，或者退出后重新打开 DollPet。'));
      return;
    }
    restoreMic ||= micOn;
    restoreCamera ||= cameraOn;
    micOn = cameraOn = false;
    pageReady = false;
    if (alive(pet)) pet.loadURL('doll://app/pet.html');
  }

  function applyLevel() {
    if (!alive(pet) || wall.on()) return; // the wallpaper's level is set by wallpaper.js
    if (S.onTop) pet.setAlwaysOnTop(true, 'floating');
    else pet.setAlwaysOnTop(false);
  }

  // keeps the bottom centre where it is
  function applySize() {
    if (wall.on()) { wall.layout(); placeBubble(); rebuildMenu(); return; }
    if (!alive(pet)) return;
    const b = pet.getBounds(), h = S.size, w = Math.round(h * aspect);
    pet.setBounds({ x: Math.round(b.x + b.width / 2 - w / 2), y: b.y + b.height - h, width: w, height: h });
    savePosition();
    placeBubble();
    rebuildMenu();
  }

  function savePosition() {
    if (!alive(pet) || wall.on()) return;
    [S.x, S.y] = pet.getPosition();
    save();
  }

  let ignoring = null;
  function setIgnore(on) {
    if (on === ignoring || !alive(pet)) return;
    ignoring = on;
    pet.setIgnoreMouseEvents(on, { forward: true });
  }

  // Dragging: the page says when the button goes down and up (preload.js); in between the window follows the cursor.
  // A press that doesn't move pokes the character.
  let drag = null, dragTimer = null;
  ipcMain.on('drag', (e, phase) => {
    if (!alive(pet) || e.sender !== pet.webContents) return;
    if (phase === 'start' && wall.on()) {
      const g = wall.dragStart(screen.getCursorScreenPoint());
      if (!g) return;
      drag = { wall: g };
      clearInterval(dragTimer);
      dragTimer = setInterval(dragMove, 1000 / 60);
    } else if (phase === 'start') {
      const p = screen.getCursorScreenPoint(), [ox, oy] = pet.getPosition();
      drag = { sx: p.x, sy: p.y, ox, oy, moved: false };
      clearInterval(dragTimer);
      dragTimer = setInterval(dragMove, 1000 / 60);
    } else if (drag) {
      const d = drag;
      drag = null;
      clearInterval(dragTimer);
      if (d.wall) return;
      if (d.moved) savePosition();
      else js(pet, 'pet.poke()');
    }
  });
  function dragMove() {
    if (!drag || !alive(pet)) return;
    if (drag.wall) { wall.dragMove(drag.wall, screen.getCursorScreenPoint()); placeBubble(); return; }
    const p = screen.getCursorScreenPoint(), dx = p.x - drag.sx, dy = p.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    pet.setPosition(drag.ox + dx, drag.oy + dy);
    placeBubble();
  }

  ipcMain.on('wall-wheel', (e, dy, pinch) => { if (alive(pet) && e.sender === pet.webContents) wall.wheel(Number(dy), !!pinch); });
  ipcMain.on('wall-key', (e, key, shift) => { if (alive(pet) && e.sender === pet.webContents && typeof key === 'string') wall.key(key, !!shift); });

  // 30 Hz: the gaze, and click-through on transparent pixels.
  let last = { x: -1, y: -1 }, hitPoint = null, hitWait = 0;
  function tick() {
    if (!pageReady || !alive(pet) || drag) return;
    if (wall.on()) {
      // the wallpaper fills the screen; it takes the mouse only while it is being adjusted, and the character is
      // bigger there and the cursor further away
      const p = screen.getCursorScreenPoint(), s = wall.display().bounds;
      if (S.follow && (p.x !== last.x || p.y !== last.y)) {
        last = p;
        js(pet, `pet.pointer(${p.x - s.x},${p.y - s.y},${Math.max(520, Math.round(wall.rect().height * 0.8))})`);
      }
      setIgnore(!wall.editing());
      return;
    }
    const p = screen.getCursorScreenPoint(), b = pet.getBounds();
    const x = p.x - b.x, y = p.y - b.y;
    if (S.follow && (p.x !== last.x || p.y !== last.y)) {
      last = p;
      js(pet, `pet.pointer(${x},${y},520)`);
    }
    if (S.locked || x < 0 || y < 0 || x >= b.width || y >= b.height) {
      setIgnore(true);
      hitPoint = null;
      return;
    }
    // reading a pixel back costs a GPU round trip: only when the cursor moved, or three times a second at rest
    hitWait++;
    if (hitPoint && hitPoint.x === p.x && hitPoint.y === p.y && hitWait < 10) return;
    hitPoint = p;
    hitWait = 0;
    pet.webContents.executeJavaScript(`pet.hit(${x},${y})`).then(hit => { if (!drag) setIgnore(!hit); }).catch(() => {});
  }

  // ---------- microphone and camera (they run in the pet page: voice.js, tracking.js) ----------

  async function mediaAllowed(kind) {
    if (!isMac) return true;
    if (await systemPreferences.askForMediaAccess(kind)) return true;
    alert(kind === 'microphone' ? L('Could not open the microphone', '无法打开麦克风') : L('Could not start face tracking', '无法启动面部捕捉'),
      L(`Allow DollPet in System Settings › Privacy & Security › ${kind === 'microphone' ? 'Microphone' : 'Camera'}.`,
        `请在「系统设置 › 隐私与安全性 › ${kind === 'microphone' ? '麦克风' : '摄像头'}」里允许 DollPet。`));
    return false;
  }
  async function setMic(on) { if (!on || await mediaAllowed('microphone')) js(pet, `pet.mic(${on})`); }
  async function setCamera(on) { if (!on || await mediaAllowed('camera')) js(pet, `pet.camera(${on})`); }

  // ---------- page messages ----------

  ipcMain.on('lang', e => { e.returnValue = langCode(); });

  ipcMain.on('page-message', (e, role, msg) => {
    if (!msg || typeof msg.type !== 'string') return;
    if (role === 'pet' && alive(pet) && e.sender === pet.webContents) petMessage(msg);
    else if (role === 'studio' && alive(editor) && e.sender === editor.webContents) editorMessage(msg);
  });

  function petMessage(msg) {
    switch (msg.type) {
      case 'ready':
        pageReady = true;
        js(pet, `pet.follow(${S.follow})`);
        loadInitialModel();
        if (wall.on()) { wall.layout(); wall.syncSystem(); }
        if (restoreMic) { restoreMic = false; setMic(true); }
        if (restoreCamera) { restoreCamera = false; setCamera(true); }
        break;
      case 'stuck': reloadPet(); break; // the page lost its WebGL context and didn't get it back
      case 'loaded':
        // kept, so the window opens at the right width next time (the position is kept by its top left)
        if (msg.aspect > 0) { aspect = msg.aspect; S.aspect = aspect; }
        wall.setAspect(msg.wallAspect, msg.cut);
        applySize();
        break;
      case 'error': alert(L('Could not open the model', '无法打开模型'), msg.message); break;
      case 'mic':
      case 'camera':
        if (msg.type === 'mic') micOn = !!msg.on; else cameraOn = !!msg.on;
        rebuildMenu();
        if (msg.error) alert(msg.type === 'mic' ? L('Could not open the microphone', '无法打开麦克风') : L('Could not start face tracking', '无法启动面部捕捉'), msg.error);
        break;
      case 'calibrated':
        if (!msg.ok) alert(L('No face found yet', '还没找到脸'), L('Face the camera and click Calibrate again.', '请正对摄像头，再点一次「校准」。'));
        break;
    }
  }

  function editorMessage(msg) {
    switch (msg.type) {
      case 'editorReady':
        editorReady = true;
        sendRecentsToEditor();
        if (editorPending) { const p = editorPending; editorPending = null; sendToEditor(p); }
        break;
      case 'recents': sendRecentsToEditor(); break;
      case 'openRecent': if (typeof msg.path === 'string') openInEditor(msg.path); break;
      case 'opened': {
        const name = msg.name;
        editorPath = editorFile && path.basename(editorFile) === name ? path.resolve(editorFile) : name ? 'drop:' + name : null;
        editorFile = null;
        if (editorPath) js(editor, `studio.restore(${saved(editorPath)})`);
        break;
      }
      case 'tuning':
        if (editorPath && typeof msg.tuning === 'string') {
          try {
            fs.mkdirSync(path.dirname(tuningFile(editorPath)), { recursive: true });
            fs.writeFileSync(tuningFile(editorPath), msg.tuning);
          } catch {}
        }
        break;
      case 'save': if (typeof msg.name === 'string' && typeof msg.data === 'string') saveFile(msg.data, msg.name); break;
      case 'setPet': if (typeof msg.doll === 'string') setPet(msg.doll); break;
      case 'lang': if ((msg.lang === 'en' || msg.lang === 'zh') && msg.lang !== langCode()) setLanguage(msg.lang); break;
    }
  }

  ipcMain.on('picked', (e, p) => {
    if (!alive(editor) || e.sender !== editor.webContents || typeof p !== 'string') return;
    editorFile = p;
    recentsAdd(p);
  });

  async function saveFile(text, name) {
    const r = await dialog.showSaveDialog(editor, { defaultPath: path.join(app.getPath('documents'), name) });
    if (r.canceled || !r.filePath) return;
    try { fs.writeFileSync(r.filePath, text); } catch (e) { alert(L('Could not save', '无法保存'), e.message); }
  }

  // ---------- editor ----------

  function openEditor() {
    if (!alive(editor)) {
      editor = new BrowserWindow({
        width: 1280, height: 820, minWidth: 900, minHeight: 560, title: 'Doll Studio', show: false,
        backgroundColor: '#ffffff', autoHideMenuBar: true, icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: webPrefs('studio'),
      });
      editorReady = false;
      editor.loadURL('doll://app/index.html');
      editor.once('ready-to-show', () => editor.show());
      editor.on('closed', () => { editor = null; editorReady = false; updateDock(); });
      // the file that was open is opened again; its tuning was saved as it was made
      editor.webContents.on('render-process-gone', () => {
        editorReady = false;
        if (editorPath && !editorPath.startsWith('drop:')) editorPending = editorPath;
        if (alive(editor)) editor.loadURL('doll://app/index.html');
      });
    } else {
      editor.show();
    }
    editor.focus();
    updateDock();
  }

  function openInEditor(p) {
    openEditor();
    recentsAdd(p);
    if (editorReady) sendToEditor(p); else editorPending = p;
  }

  function sendToEditor(p) {
    if (!readable(p)) { alert(L('Could not read the file', '无法读取文件'), p); return; }
    editorFile = p;
    js(editor, `studio.openFromHost(${JSON.stringify(kindOf(p))}, ${JSON.stringify(offer(p))}, ${JSON.stringify(path.basename(p))})`);
  }

  // on macOS the app is menu-bar only (no Dock icon) unless the editor is open
  function updateDock() {
    if (!isMac) return;
    if (alive(editor)) app.dock.show(); else app.dock.hide();
  }

  // ---------- alerts from coding agents ----------

  let bubbleH = 80, bubbleTimer = null;
  const BUBBLE_W = 300;
  async function agentEvent(info) {
    const attention = info.kind === 'attention';
    js(pet, `pet.alert('${attention ? 'attention' : 'done'}')`);
    if (!alive(bubble)) {
      bubble = new BrowserWindow({
        width: BUBBLE_W, height: bubbleH, transparent: true, frame: false, hasShadow: false, resizable: false,
        skipTaskbar: true, focusable: false, show: false, backgroundColor: '#00000000',
        webPreferences: { contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
      });
      bubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      await bubble.loadFile(path.join(__dirname, 'bubble.html'));
    }
    const h = await js(bubble, `show(${JSON.stringify({ title: info.title ?? '', project: info.project ?? '', body: info.body ?? '', attention })})`);
    if (h > 0) bubbleH = Math.ceil(h);
    // over every window while the pet floats; on the wallpaper it belongs to the desktop like the character
    if (wall.on() && isMac) native.aboveDesktop(bubble); else bubble.setAlwaysOnTop(true, 'floating');
    placeBubble();
    bubble.showInactive();
    if (S.alertSound) playSound(attention ? 'attention' : 'done');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { if (alive(bubble)) bubble.hide(); }, attention ? 15000 : 9000);
  }
  // macOS: the system sounds the native app uses; elsewhere a chime made in the bubble page
  function playSound(kind) {
    if (isMac) {
      try { spawn('afplay', [`/System/Library/Sounds/${kind === 'attention' ? 'Ping' : 'Glass'}.aiff`], { stdio: 'ignore', detached: true }).unref(); } catch {}
    } else {
      js(bubble, `chime('${kind}')`);
    }
  }

  function testAlert() { agentEvent(message('test', {})); }

  // ---------- Claude Code and Codex (agents.js) ----------

  const agents = makeAgents({
    // in development DOLL_HOME points it at a test folder instead of the real ~/.claude and ~/.codex
    home: (!app.isPackaged && process.env.DOLL_HOME) || os.homedir(),
    command: app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()],
    backups: path.join(support(), 'Backups'),
    L,
  });
  const AGENT_NAMES = { claude: 'Claude Code', codex: 'Codex' };
  const connected = agent => { try { return agents.connected(agent); } catch { return false; } };
  function setAgent(agent, on) {
    const name = AGENT_NAMES[agent];
    if (!name) return;
    try {
      agents.edit(agent, on);
      if (on) agentEvent({ kind: 'done', title: L(`Connected to ${name}`, `已连接 ${name}`), project: '', body: L(`Alerts start with your next ${name} session.`, `从下一个 ${name} 会话开始提醒。`) });
    } catch (e) {
      alert(L(`Could not connect ${name}`, `无法连接 ${name}`), e.message);
    }
    rebuildMenu();
  }

  // above the pet, or below it when there is no room
  function placeBubble() {
    if (!alive(bubble) || !alive(pet)) return;
    const b = wall.on() ? wall.rect() : pet.getBounds(), a = screen.getDisplayMatching(b).workArea;
    const x = Math.min(Math.max(Math.round(b.x + b.width / 2 - BUBBLE_W / 2), a.x), a.x + a.width - BUBBLE_W);
    let y = b.y - bubbleH + 10;
    if (y < a.y) y = Math.min(b.y + b.height - 10, a.y + a.height - bubbleH);
    bubble.setBounds({ x, y, width: BUBBLE_W, height: bubbleH });
  }

  // ---------- settings shared by the popover and the menus ----------

  function toggle(key) {
    switch (key) {
      case 'onTop': if (wall.on()) return; S.onTop = !S.onTop; applyLevel(); break;
      case 'follow': S.follow = !S.follow; js(pet, `pet.follow(${S.follow})`); break;
      case 'locked': if (wall.on()) return; S.locked = !S.locked; break;
      case 'sound': S.alertSound = !S.alertSound; if (S.alertSound) playSound('done'); break;
      case 'mic': setMic(!micOn); return; // the page reports back, which refreshes
      case 'camera': setCamera(!cameraOn); return;
      default: return;
    }
    save();
    rebuildMenu();
  }
  function setSize(h) {
    if (!SIZES.some(s => s[2] === h)) return;
    S.size = h;
    save();
    applySize();
  }
  function editCurrent() {
    if (currentModel && fs.existsSync(currentModel) && !DEFAULT_MODELS.includes(currentModel)) openInEditor(currentModel);
    else openEditor();
  }

  // ---------- tray popover (popover.html) ----------

  const POP_W = isMac ? 344 : 360; // on Windows the panel has a margin for its shadow
  let popH = 600, popoverHiddenAt = 0;

  function popoverState() {
    const sz = SIZES.find(s => s[2] === S.size);
    const fromEditor = currentModel === path.join(support(), 'current.doll');
    const title = !currentModel ? L('No model yet', '还没有模型')
      : fromEditor ? L('Your model', '你的模型')
      : DEFAULT_MODELS.includes(currentModel) ? L('Sample model', '示例模型')
      : path.basename(currentModel, path.extname(currentModel));
    return {
      lang: langCode(), langSetting: S.lang, mod: isMac ? '⌘' : 'Ctrl+',
      title, sizeName: sz ? L(sz[0], sz[1]) : L('Custom', '自定义'),
      thumb: currentModel ? thumbOf(currentModel) : null,
      toggles: { onTop: S.onTop, follow: S.follow, mic: micOn, camera: cameraOn, locked: S.locked, sound: S.alertSound },
      size: S.size, sizes: SIZES.map(([en, z, h]) => [h, L(en, z)]),
      agents: { claude: connected('claude'), codex: connected('codex') },
      wall: wall.state(),
      recents: existing().slice(0, 3).map(r => ({ path: r.path, name: path.basename(r.path), ago: ago(r.lastUsed), current: r.path === currentModel })),
    };
  }
  function pushState() {
    if (alive(popover) && popover.isVisible()) popover.webContents.send('state', popoverState());
  }

  function createPopover() {
    popover = new BrowserWindow({
      width: POP_W, height: popH, show: false, frame: false, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: isMac,
      ...(isMac
        ? { vibrancy: 'popover', visualEffectState: 'active', backgroundColor: '#00000000', roundedCorners: true }
        : { transparent: true, backgroundColor: '#00000000' }),
      webPreferences: webPrefs('popover'),
    });
    popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    popover.loadFile(path.join(__dirname, 'popover.html'));
    popover.webContents.on('did-finish-load', pushState);
    popover.on('blur', hidePopover);
  }
  function hidePopover() {
    if (!alive(popover) || !popover.isVisible()) return;
    popover.hide();
    popoverHiddenAt = Date.now();
  }
  function togglePopover() {
    if (alive(popover) && popover.isVisible()) return hidePopover();
    // the same click that just closed it by taking the focus away
    if (Date.now() - popoverHiddenAt < 300) return;
    if (!alive(popover)) createPopover();
    popover.show();
    pushState();
    placePopover();
    popover.focus();
    if (isMac) app.focus({ steal: true });
  }
  // under the menu-bar icon, or above the tray icon when the taskbar is at the bottom
  function placePopover() {
    if (!alive(popover) || !tray) return;
    let t = tray.getBounds();
    if (!t.width) { const c = screen.getCursorScreenPoint(); t = { x: c.x, y: c.y, width: 1, height: 1 }; }
    const d = screen.getDisplayMatching(t), a = d.workArea;
    const h = Math.min(popH, a.height - 8);
    const x = Math.min(Math.max(Math.round(t.x + t.width / 2 - POP_W / 2), a.x + 4), a.x + a.width - POP_W - 4);
    const below = t.y + t.height / 2 < d.bounds.y + d.bounds.height / 2;
    let y = below ? Math.max(a.y, t.y + t.height) + 4 : Math.min(a.y + a.height, t.y) - h - 4;
    y = Math.min(Math.max(y, a.y), a.y + a.height - h);
    popover.setBounds({ x, y, width: POP_W, height: h });
  }

  // the app's panels: the popover, and the one shown while adjusting the wallpaper (wallpaper.js)
  ipcMain.on('ui-size', (e, role, height, width) => {
    if (role === 'hud' && wall.isHud(e.sender)) return wall.hudResize(Number(width), Number(height));
    if (role !== 'popover' || !alive(popover) || e.sender !== popover.webContents || !(height > 0)) return;
    popH = Math.ceil(height);
    placePopover();
  });

  ipcMain.on('ui', (e, role, act, v) => {
    if (role === 'hud' && wall.isHud(e.sender)) return wall.hudAction(act, v);
    if (role !== 'popover' || !alive(popover) || e.sender !== popover.webContents) return;
    // commands that open a window or a panel run after the popover is gone, so they come up in front
    const after = fn => { hidePopover(); setTimeout(fn, 0); };
    switch (act) {
      case 'toggle': toggle(v); break;
      case 'size': setSize(Number(v)); break;
      case 'calibrate': js(pet, 'pet.calibrate()'); break;
      case 'agent': if (AGENT_NAMES[v]) setAgent(v, !connected(v)); break;
      case 'test': testAlert(); break;
      case 'recent': if (S.recents.some(r => r.path === v)) load(v); break;
      case 'lang': if (['system', 'en', 'zh'].includes(v)) setLanguage(v); break;
      case 'openModel': after(openModel); break;
      case 'openEditor': after(openEditor); break;
      case 'editCurrent': after(editCurrent); break;
      case 'quit': app.quit(); break;
      case 'close': hidePopover(); break;
      // wallpaper mode
      case 'mode': wall.setMode(v === 'wallpaper'); break;
      case 'wallSize': wall.setSize(Number(v)); break;
      case 'wallAlign': wall.setAlign(v); break;
      case 'wallBg': wall.setBackground(String(v)); break;
      case 'wallBgMenu': wall.pictureMenu(String(v)); break;
      case 'wallAdjust': after(wall.beginEdit); break;
      case 'wallRestore': wall.restoreSystem(); break;
      case 'wallDrop': if (Array.isArray(v)) wall.addPictures(v.filter(f => typeof f === 'string')); break;
    }
  });

  // ---------- menus ----------

  function menuTemplate() {
    const recent = existing().slice(0, 15);
    return [
      { label: L('Open Editor…', '打开编辑器…'), click: openEditor },
      { label: L('Open Model…', '打开模型…'), click: openModel },
      {
        label: L('Recent Models', '最近的模型'),
        submenu: recent.length
          ? recent.map(r => ({ label: `${path.basename(r.path)}  ·  ${path.basename(path.dirname(r.path))}`, type: 'checkbox', checked: r.path === currentModel, click: () => load(r.path) }))
          : [{ label: L('No models opened yet', '还没有打开过模型'), enabled: false }],
      },
      { type: 'separator' },
      { label: L('Wallpaper Mode', '壁纸模式'), type: 'checkbox', checked: wall.on(), enabled: wall.available(), click: () => wall.setMode(!wall.on()) },
      { label: L('Adjust Wallpaper on Screen…', '在屏幕上调整壁纸…'), visible: wall.on() && !wall.editing(), click: wall.beginEdit },
      { type: 'separator' },
      { label: L('Size', '大小'), enabled: !wall.on(), submenu: SIZES.map(([en, z, h]) => ({ label: L(en, z), type: 'radio', checked: S.size === h, click: () => setSize(h) })) },
      { label: L('Always on Top', '置顶'), type: 'checkbox', checked: S.onTop, enabled: !wall.on(), click: () => toggle('onTop') },
      { label: L('Follow Cursor', '跟随鼠标'), type: 'checkbox', checked: S.follow, click: () => toggle('follow') },
      { label: L('Lip Sync', '麦克风口型'), type: 'checkbox', checked: micOn, click: () => toggle('mic') },
      { label: L('Face Tracking', '面部捕捉'), type: 'checkbox', checked: cameraOn, click: () => toggle('camera') },
      { label: L('Calibrate Face', '校准面捕'), visible: cameraOn, click: () => js(pet, 'pet.calibrate()') },
      { label: L('Click-Through (Lock Position)', '鼠标穿透（锁定位置）'), type: 'checkbox', checked: S.locked, enabled: !wall.on(), click: () => toggle('locked') },
      { label: L('Alert Sound', '提示音'), type: 'checkbox', checked: S.alertSound, click: () => toggle('sound') },
      { type: 'separator' },
      {
        label: L('Language', '语言'),
        submenu: [['system', 'Automatic', '自动'], ['en', 'English', 'English'], ['zh', '中文', '中文']]
          .map(([v, en, z]) => ({ label: L(en, z), type: 'radio', checked: S.lang === v, click: () => setLanguage(v) })),
      },
      {
        label: L('Task Alerts', '任务提醒'),
        submenu: [
          ...Object.entries(AGENT_NAMES).map(([agent, name]) => ({ label: name, type: 'checkbox', checked: connected(agent), click: () => setAgent(agent, !connected(agent)) })),
          { type: 'separator' },
          { label: L('Send Test', '发送测试'), click: testAlert },
        ],
      },
      { type: 'separator' },
      { label: L('Quit DollPet', '退出 DollPet'), click: () => app.quit() },
    ];
  }

  // The tray's menu is built when it opens; what changed shows in the popover now if it is open.
  function rebuildMenu() {
    pushState();
  }

  ipcMain.on('pet-menu', e => {
    if (alive(pet) && e.sender === pet.webContents) Menu.buildFromTemplate(menuTemplate()).popup({ window: pet });
  });

  // the menu bar while the editor is in front on macOS (copy, paste and undo need it); none on Windows
  function setAppMenu() {
    if (!isMac) { Menu.setApplicationMenu(null); return; }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'DollPet', submenu: [
        { label: L('Open Editor', '打开编辑器'), accelerator: 'Cmd+E', click: openEditor },
        { type: 'separator' },
        { label: L('Quit DollPet', '退出 DollPet'), accelerator: 'Cmd+Q', click: () => app.quit() },
      ] },
      { label: L('Edit', '编辑'), submenu: [
        { role: 'undo', label: L('Undo', '撤销') }, { role: 'redo', label: L('Redo', '重做') }, { type: 'separator' },
        { role: 'cut', label: L('Cut', '剪切') }, { role: 'copy', label: L('Copy', '拷贝') },
        { role: 'paste', label: L('Paste', '粘贴') }, { role: 'selectAll', label: L('Select All', '全选') },
      ] },
      { label: L('Window', '窗口'), submenu: [
        { role: 'close', label: L('Close', '关闭') }, { role: 'minimize', label: L('Minimize', '最小化') },
        { role: 'toggleDevTools' },
      ] },
    ]));
  }

  function setLanguage(v) {
    S.lang = v;
    save();
    for (const w of [pet, editor, thumbWin]) js(w, `window.setDollLang?.('${langCode()}')`);
    rebuildMenu();
    setAppMenu();
  }

  function createTray() {
    let icon;
    if (isMac) {
      icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
      icon.setTemplateImage(true);
    } else {
      // tray.png with tray@2x.png beside it for high-DPI screens
      icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
    }
    tray = new Tray(icon);
    tray.setToolTip('DollPet');
    // a click opens the popover, a right click the classic menu
    tray.on('click', togglePopover);
    tray.on('right-click', () => {
      hidePopover();
      tray.popUpContextMenu(Menu.buildFromTemplate(menuTemplate()));
    });
  }

  // ---------- wallpaper mode (wallpaper.js) ----------

  const wall = makeWallpaper({
    S, save, L, isMac, js, native, alive, screen, nativeImage, dialog, shell, BrowserWindow, Menu, WEB, support,
    langCode, alert, webPrefs, setIgnore, applyLevel, hidePopover,
    pet: () => pet, pageReady: () => pageReady, petBounds: initialBounds, refresh: () => rebuildMenu(),
  });

  // ---------- start ----------

  app.on('second-instance', (_e, _argv, _cwd, data) => {
    if (data?.notify) agentEvent(data.notify);
    else openEditor(); // DollPet opened again while it runs
  });
  // the pet stays when the editor closes; the app ends from the menu
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { if (!drag) savePosition(); saveNow(); });

  app.whenReady().then(() => {
    if (isMac) {
      // the packaged app has its own icon; in development the Dock would show Electron's while the editor is open
      if (!app.isPackaged) app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'));
      app.dock.hide();
    }
    if (process.platform === 'win32') app.setAppUserModelId('studio.doll.pet');
    protocol.handle('doll', handleDoll);
    // camera and microphone for our own pages only
    session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) => {
      const url = details?.requestingUrl ?? wc.getURL();
      done((permission === 'media' || permission === 'clipboard-sanitized-write') && url.startsWith('doll://'));
    });
    setAppMenu();
    createTray();
    createPet();
    setInterval(tick, 1000 / 30);
    // a display added, removed or rearranged, or the Dock or taskbar resized
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(ev, () => { if (wall.on()) wall.layout(); });
    }
    // a pet with DollPet's desktop picture still up (it quit before switching back): the user's own returns
    if (!wall.on() && wall.canRestore()) wall.restoreSystem(true);
    if (process.argv.includes('--editor')) openEditor();
    // development: `--snap=<folder>` saves what each window shows after a few seconds, and the pet's state
    const snap = !app.isPackaged && process.argv.find(a => a.startsWith('--snap='))?.slice(7);
    if (snap) setTimeout(async () => {
      if (process.argv.includes('--popover')) {
        togglePopover();
        await new Promise(r => setTimeout(r, 1200));
        // DOLL_SNAP_CLICKS: popover buttons to press first, as "act:value" separated by commas
        for (const c of (process.env.DOLL_SNAP_CLICKS ?? '').split(',').filter(Boolean)) {
          const [act, v = ''] = c.split(':');
          await js(popover, `document.querySelector('[data-act="${act}"]${v ? `[data-v="${v}"]` : ''}')?.click()`);
          await new Promise(r => setTimeout(r, 700));
        }
        const st = popoverState();
        if (alive(popover)) { popover.showInactive(); popover.webContents.send('state', st); await new Promise(r => setTimeout(r, 1500)); popover.webContents.send('state', popoverState()); await new Promise(r => setTimeout(r, 300)); }
        console.log('[snap state]', JSON.stringify({ size: S.size, follow: S.follow, lang: S.lang, agents: st.agents, wall: { ...st.wall, backgrounds: st.wall.backgrounds.map(b => b.id + (b.thumb ? '+' : '')) }, petBounds: pet.getBounds(), level: isMac && native.available ? native.level(pet) : null, ignoring }));
      }
      for (const [name, w] of [['pet', pet], ['editor', editor], ['bubble', bubble], ['popover', popover], ['hud', wall.hudWindow()]]) {
        if (alive(w)) fs.writeFileSync(path.join(snap, name + '.png'), (await w.webContents.capturePage()).toPNG());
      }
      const b = alive(pet) && pet.getBounds();
      const hit = (x, y) => js(pet, `pet.hit(${x},${y})`);
      const hits = { centre: await hit(b.width / 2, b.height * 0.35), corner: await hit(2, 2) };
      console.log('[snap]', JSON.stringify({ bounds: b, aspect, pageReady, ignoring, hits, recents: S.recents.length }));
    }, Number(process.env.DOLL_SNAP_AFTER ?? 9000));
  });
}
