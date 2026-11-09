// Player: runs a .doll model full-window with idle animation, pointer follow and
// microphone lip sync. Used by player.html and by pages exported from the editor.

import { prepare, evaluate, Physics, defaultParams } from './rig.js';
import { Renderer } from './renderer.js';
import { Driver } from './driver.js';
import { loadDoll } from './format.js';
import { tr, onLang, setLang, getLang } from './i18n.js';

// Fits the model (or just `bounds` of it, in canvas pixels) into a cssW x cssH area.
export function fitView(model, cssW, cssH, zoom = 1, panX = 0, panY = 0, bounds = null) {
  const x0 = bounds?.x0 ?? 0, y0 = bounds?.y0 ?? 0;
  const bw = (bounds?.x1 ?? model.width) - x0, bh = (bounds?.y1 ?? model.height) - y0;
  const scale = Math.min(cssW / bw, cssH / bh) * 0.94 * zoom;
  return { scale, ox: (cssW - bw * scale) / 2 - x0 * scale + panX, oy: (cssH - bh * scale) / 2 - y0 * scale + panY };
}

// Like fitView with no margin, the bounds' bottom on the canvas's bottom edge, centred across.
export function fitFlush(model, cssW, cssH, bounds) {
  const { x0, y0, x1, y1 } = bounds;
  const scale = Math.min(cssW / (x1 - x0), cssH / (y1 - y0));
  return { scale, ox: (cssW - (x1 - x0) * scale) / 2 - x0 * scale, oy: cssH - y1 * scale };
}

// Pixel bounds of everything visible, padded so motion stays inside the frame.
export function contentBounds(model) {
  const b = drawnBounds(model);
  const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.04;
  return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
}

function drawnBounds(model) {
  let b = null;
  for (const p of model.parts) {
    if (!p.visible) continue;
    b = b ? { x0: Math.min(b.x0, p.box.x0), y0: Math.min(b.y0, p.box.y0), x1: Math.max(b.x1, p.box.x1), y1: Math.max(b.y1, p.box.y1) } : { ...p.box };
  }
  return b;
}

// Which sides of the artwork are cut off by the edge of the PSD canvas (a bust ends at the bottom edge), and bounds
// that keep contentBounds' padding everywhere but there, so a cut side can sit right on the edge of the screen. The
// top keeps its padding even when cut (it never meets a screen edge, and the head moves there).
export function edgeBounds(model) {
  const raw = drawnBounds(model), padded = contentBounds(model);
  const tol = Math.max(4, Math.max(model.width, model.height) * 0.01);
  const cut = { left: raw.x0 <= tol, right: raw.x1 >= model.width - tol, top: raw.y0 <= tol, bottom: raw.y1 >= model.height - tol };
  return {
    cut,
    bounds: { x0: cut.left ? raw.x0 : padded.x0, y0: padded.y0,
              x1: cut.right ? raw.x1 : padded.x1, y1: cut.bottom ? raw.y1 : padded.y1 },
  };
}

// A still of the model at rest, cropped to what is drawn, as a PNG data URL no larger than size x size.
export function snapshot(model, size = 320) {
  prepare(model);
  const bounds = contentBounds(model);
  const aspect = (bounds.x1 - bounds.x0) / (bounds.y1 - bounds.y0);
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  // the renderer sizes itself from the canvas's CSS size, so it has to be laid out (out of sight)
  canvas.style.cssText = `position:fixed;left:-10000px;top:0;width:${Math.round((aspect > 1 ? size : size * aspect) / dpr)}px;height:${Math.round((aspect > 1 ? size / aspect : size) / dpr)}px`;
  document.body.append(canvas);
  try {
    const renderer = new Renderer(canvas);
    renderer.load(model);
    evaluate(model, defaultParams(), new Physics());
    renderer.resize();
    renderer.render(model, fitView(model, canvas.clientWidth, canvas.clientHeight, 1, 0, 0, bounds));
    const png = canvas.toDataURL('image/png');
    renderer.dispose();
    renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
    return png;
  } finally {
    canvas.remove();
  }
}

// opts.bounds crops the view to part of the canvas; opts.listen = false leaves pointer
// input to the caller (via pointerAt), e.g. when a native host tracks the cursor;
// opts.driver reuses a driver (its microphone and camera stay on across a model change).
export function startPlayer(canvas, model, opts = {}) {
  prepare(model);
  const renderer = new Renderer(canvas);
  renderer.load(model);
  const P = defaultParams(), physics = new Physics(), driver = opts.driver ?? new Driver();
  // opts.flush (read every frame): the bounds fill the canvas edge to edge, standing on its bottom edge, with no
  // margin; for a canvas sized to the bounds' aspect (the wallpaper)
  const view = () => opts.flush?.on
    ? fitFlush(model, canvas.clientWidth, canvas.clientHeight, opts.bounds)
    : fitView(model, canvas.clientWidth, canvas.clientHeight, 1, 0, 0, opts.bounds);
  // clientX/Y relative to the page; radius in CSS px is the distance that counts as a full look.
  const pointerAt = (clientX, clientY, radius) => {
    const r = canvas.getBoundingClientRect(), v = view();
    const hx = r.left + v.ox + model.rig.head.cx * v.scale, hy = r.top + v.oy + model.rig.head.cy * v.scale;
    const d = Math.hypot(clientX - hx, clientY - hy) / Math.max(1, model.rig.head.r * v.scale);
    driver.pointer((clientX - hx) / (radius ?? r.width / 2), -(clientY - hy) / (radius ?? r.height / 2), d);
  };
  const onMove = e => pointerAt(e.clientX, e.clientY);
  const onLeave = () => driver.pointer(0, 0, 99, false);
  if (opts.listen !== false) {
    addEventListener('pointermove', onMove);
    document.addEventListener('mouseleave', onLeave);
  }
  // opts.limit (read every frame, so the caller can change it): { fps } caps the frame rate (0 = every frame),
  // { paused } stops animating, e.g. while the window is hidden
  let last = performance.now(), raf = 0;
  const frame = now => {
    raf = requestAnimationFrame(frame);
    const lim = opts.limit;
    if (lim?.paused) { last = now; return; }
    if (lim?.fps && now - last < 1000 / lim.fps - 4) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    driver.update(P, dt, true);
    physics.step(model, P, dt);
    evaluate(model, P, physics);
    renderer.resize();
    renderer.render(model, view());
  };
  raf = requestAnimationFrame(frame);
  return {
    driver,
    renderer,
    params: P,
    pointerAt,
    stop() {
      cancelAnimationFrame(raf);
      renderer.dispose();
      removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      if (!opts.driver) { driver.disableMic(); driver.disableCamera(); }
    },
  };
}

const PLAYER_CSS = `
html, body { margin: 0; height: 100%; overflow: hidden; font: 14px/1.4 system-ui, -apple-system, "PingFang SC", sans-serif; }
body[data-bg="checker"] { background: repeating-conic-gradient(#e6e6e6 0 25%, #fff 0 50%) 0 0 / 24px 24px; }
body[data-bg="transparent"] { background: transparent; }
body[data-bg="green"] { background: #00ff00; }
body[data-bg="dark"] { background: #1d1f24; }
#doll-canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
#doll-bar { position: fixed; left: 16px; bottom: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
#doll-bar button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(0,0,0,.15); background: rgba(255,255,255,.9); cursor: pointer; }
#doll-bar button[aria-pressed="true"] { background: #2b6cff; color: #fff; border-color: #2b6cff; }
#doll-bar .hint { color: #666; background: rgba(255,255,255,.8); padding: 2px 8px; border-radius: 6px; font-size: 12px; }
body.hide-ui #doll-bar { display: none; }
#doll-drop { position: fixed; inset: 0; display: grid; place-items: center; color: #555; font-size: 18px; pointer-events: none; }
body.has-model #doll-drop { display: none; }
`;

export async function runPlayerPage(embedded) {
  const style = document.createElement('style');
  style.textContent = PLAYER_CSS;
  document.head.append(style);
  document.body.innerHTML = `
    <canvas id="doll-canvas"></canvas>
    <div id="doll-drop"></div>
    <div id="doll-bar">
      <button data-act="open"></button>
      <button data-act="mic" aria-pressed="false"></button>
      <button data-act="camera" aria-pressed="false"></button>
      <button data-act="calibrate" hidden></button>
      <button data-act="bg"></button>
      <button data-act="lang"></button>
      <span class="hint"></span>
    </div>
    <input type="file" accept=".doll,.json" hidden>`;
  const canvas = document.getElementById('doll-canvas');
  const input = document.querySelector('input[type=file]');
  const q = new URLSearchParams(location.search);
  const bgs = ['checker', 'transparent', 'green', 'dark'];
  document.body.dataset.bg = q.get('bg') ?? 'checker';
  let app = null, loadingCamera = false;
  const driver = new Driver(); // shared by every model opened here, so the mic and camera stay on

  // the page's text in the current language (i18n.js); the lang button switches it
  const labels = () => {
    document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
    const set = (sel, text) => { const el = document.querySelector(sel); if (el) el.textContent = text; };
    set('#doll-drop', tr('Drop a .doll model here', '把 .doll 模型拖到这里'));
    set('[data-act=open]', tr('Open .doll', '打开 .doll'));
    set('[data-act=mic]', tr('Lip sync', '麦克风口型'));
    set('[data-act=camera]', loadingCamera ? tr('Loading face tracking…', '正在加载面部捕捉…') : tr('Face tracking', '面部捕捉'));
    set('[data-act=calibrate]', tr('Calibrate', '校准'));
    set('[data-act=bg]', tr('Background', '背景'));
    set('[data-act=lang]', tr('中文', 'EN'));
    set('#doll-bar .hint', tr('Press H to hide controls · add ?bg=transparent to the URL for streaming apps',
      '按 H 隐藏按钮 · 直播软件里在地址后加 ?bg=transparent 得到透明背景'));
  };
  labels();
  onLang(labels);

  const open = async obj => {
    try {
      const model = await loadDoll(obj);
      app?.stop();
      app = startPlayer(canvas, model, { driver });
      document.body.classList.add('has-model');
    } catch (e) {
      alert(e.message);
    }
  };
  const openFile = async file => open(JSON.parse(await file.text()));

  // an exported single-file page carries no face model, so it has no camera button
  if (embedded) {
    document.querySelector('[data-act=open]').remove();
    document.querySelector('[data-act=camera]').remove();
  }
  document.getElementById('doll-bar').addEventListener('click', async e => {
    const btn = e.target, act = btn.dataset?.act;
    if (act === 'open') input.click();
    if (act === 'lang') setLang(getLang() === 'zh' ? 'en' : 'zh');
    if (act === 'bg') document.body.dataset.bg = bgs[(bgs.indexOf(document.body.dataset.bg) + 1) % bgs.length];
    if (act === 'mic') {
      if (driver.mic) driver.disableMic();
      else await driver.enableMic().catch(err => alert(tr('Could not open the microphone: ', '无法打开麦克风：') + err.message));
      btn.setAttribute('aria-pressed', String(!!driver.mic));
    }
    if (act === 'camera') {
      const calib = document.querySelector('[data-act=calibrate]');
      if (driver.tracker) {
        driver.disableCamera();
      } else {
        loadingCamera = true;
        labels();
        await driver.enableCamera().catch(err => alert(tr('Could not start face tracking: ', '无法启动面部捕捉：') + err.message));
        loadingCamera = false;
        labels();
      }
      btn.setAttribute('aria-pressed', String(!!driver.tracker));
      calib.hidden = !driver.tracker;
    }
    if (act === 'calibrate' && !driver.tracker?.calibrate()) alert(tr('No face found yet. Face the camera and try again.', '还没找到脸。请正对摄像头再试一次。'));
  });
  input.addEventListener('change', () => input.files[0] && openFile(input.files[0]));
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
  addEventListener('keydown', e => { if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('hide-ui'); });

  if (embedded) await open(embedded);
  else if (q.get('model')) await open(await (await fetch(q.get('model'))).json());
}
