// Doll Studio editor: open a layered PSD, auto-rig it, tune the rig, preview it
// live, and export a .doll model or a standalone web page.

import { readPSD } from './psd.js';
import { autoRig } from './autorig.js';
import { ROLES, PHYSICS_DEFAULT, guessRole } from './roles.js';
import { PARAMS, defaultParams, prepare, evaluate, Physics, clamp } from './rig.js';
import { Renderer } from './renderer.js';
import { Driver } from './driver.js';
import { serializeDoll, loadDoll, tuningOf, restoreTuning, applyTuning } from './format.js';
import { autoClean, applyEdit, fillColor, layerKey } from './cleanup.js';
import { fitView } from './player.js';
import { tr, labelOf, onLang, setLang, getLang, applyI18n } from './i18n.js';

const $ = s => document.querySelector(s);
// Present when the editor runs inside DollPet.app; the app handles saving and the pet.
const host = window.webkit?.messageHandlers?.studio;
const stage = $('#stage'), viewCanvas = $('#view'), overlay = $('#overlay');
const renderer = new Renderer(viewCanvas);
const physics = new Physics();
const driver = new Driver();

const state = {
  // raw: the PSD as read; psd: its layers as rigged (auto-cleaned, then the user's touch-up strokes applied)
  raw: null, cleanup: true, edits: [], owned: new Set(), cleanReport: {},
  psd: null, name: 'model', overrides: {}, model: null, P: defaultParams(),
  auto: true, showMesh: false, showHandles: true, selected: null,
  zoom: 1, panX: 0, panY: 0, drag: null,
  mouthFrames: false, // draw the missing open-mouth shapes (autoRig option)
};

// Overlay and part-list colours; keep in step with the CSS variables in index.html.
const C = { accent: '#E0245E', blue: '#2F6BFF', violet: '#7C5CFF', orange: '#F07C00', green: '#0A8F62', gray: '#A6AAB5' };

const status = msg => { $('#status').textContent = msg; };
const view = () => fitView(state.model, stage.clientWidth, stage.clientHeight, state.zoom, state.panX, state.panY);
const icon = (id, cls = 'i') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const press = (btn, on) => btn.setAttribute('aria-pressed', String(on));

// ---------- loading ----------

async function openPSD(buffer, name) {
  status(tr('Reading PSD…', '正在读取 PSD…'));
  const t0 = performance.now();
  try {
    state.raw = await readPSD(buffer);
    state.name = name.replace(/\.(psd|psb)$/i, '');
    state.overrides = {};
    state.cleanup = true;
    state.edits = [];
    cleanCache.clear();
    rebuildLayers();
    setModel(autoRig(state.psd, state.overrides, { mouthFrames: state.mouthFrames }), false, name);
    host?.postMessage({ type: 'opened', name });
    const n = state.model.parts.length;
    status(`${name} · ${state.psd.width}×${state.psd.height} · ${state.psd.layers.length} ${tr('layers', '个图层')} → ${n} ${tr('parts', '个部件')} · ${Math.round(performance.now() - t0)} ms`);
    if (!host) restore(localSaved(name));
  } catch (e) {
    console.error(e);
    status(tr('Could not open the file: ', '无法打开文件：') + e.message);
  }
}

async function openDollFile(file) {
  try {
    const model = await loadDoll(JSON.parse(await file.text()));
    state.psd = state.raw = null;
    state.edits = [];
    state.name = file.name.replace(/\.(doll|json)$/i, '');
    setModel(model, false, file.name);
    host?.postMessage({ type: 'opened', name: file.name });
    status(`${file.name} · ${model.parts.length} ${tr('parts', '个部件')}`);
    if (!host) restore({ own: localTunings()[file.name] ?? null });
  } catch (e) {
    status(tr('Could not open the file: ', '无法打开文件：') + e.message);
  }
}

function setModel(model, keepView = false, fileName) {
  state.model = model;
  state.selected = null;
  prepare(model);
  renderer.load(model);
  physics.reset();
  if (!keepView) { state.zoom = 1; state.panX = state.panY = 0; }
  document.body.classList.remove('empty');
  showHome(false);
  if (fileName) { state.fileName = fileName; $('#docName').textContent = fileName; }
  $('#docBadge').hidden = !state.psd;
  $('#exportBtn').disabled = $('#setPet').disabled = false;
  $('#rerig').disabled = !state.psd;
  buildParts();
  buildPhysics();
  $('#turn').value = model.rig.turn ?? 0.5;
  $('#turnOut').value = (+$('#turn').value).toFixed(2);
}

// Re-run the auto rig after a role change, keeping the user's tuning.
function rerig() {
  const old = state.model;
  rebuildLayers();
  const m = autoRig(state.psd, state.overrides, { mouthFrames: state.mouthFrames });
  m.rig.turn = old.rig.turn;
  m.physics = old.physics;
  setModel(m, true);
  remember();
}

// The tuning of each model file opened here (the eyelid lines, roles, physics) is kept and handed back through
// restore when the file is opened again, so it doesn't have to be set again; a PSD that is new to the app (a
// re-export or a re-download) gets the tuning of the same character in another file. In DollPet the app keeps them
// by path; in a browser they are kept in this browser by file name.
let rememberTimer = 0;
function remember() {
  if (!state.model) return;
  clearTimeout(rememberTimer);
  rememberTimer = setTimeout(() => {
    const tuning = currentTuning();
    if (host) host.postMessage({ type: 'tuning', tuning: JSON.stringify(tuning) });
    else if (state.fileName) saveLocal(state.fileName, tuning);
  }, 400);
}

// What the user set for this model, as the app keeps it: the tuning (format.js), plus for a PSD whether it is
// auto-cleaned and the touch-up strokes.
function currentTuning() {
  const t = tuningOf(state.model, state.overrides, state.mouthFrames, state.fileName ?? null);
  return state.raw ? { ...t, cleanup: state.cleanup, edits: state.edits } : t;
}

// ---------- layer clean-up and touch-ups (cleanup.js) ----------

// autoClean is the slow part, so its result is kept per set of overrides (they decide which layers it cleans).
const cleanCache = new Map();
function cleanBase(overrides, cleanup) {
  if (!cleanup) return { psd: state.raw, report: {} };
  const key = JSON.stringify(overrides);
  if (!cleanCache.has(key)) cleanCache.set(key, autoClean(state.raw, overrides));
  return cleanCache.get(key);
}
// The layers rigged with a tuning t (or the current settings): cleaned if asked, then t's strokes.
function layersFor({ overrides = {}, cleanup = true, edits = [] } = {}) {
  const base = cleanBase(overrides, cleanup);
  const psd = { ...base.psd, layers: base.psd.layers.slice() }, owned = new Set();
  for (const e of edits) applyEdit(psd, state.raw, e, owned);
  return { psd, owned, report: base.report };
}
function rebuildLayers() {
  if (!state.raw) return;
  const r = layersFor({ overrides: state.overrides, cleanup: state.cleanup, edits: state.edits });
  state.psd = r.psd;
  state.owned = r.owned;
  state.cleanReport = r.report;
  showCleanReport();
}

const LOCAL_KEY = 'dollStudio.tunings';
function localTunings() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) ?? {}; } catch { return {}; }
}
function saveLocal(name, tuning) {
  const all = localTunings();
  delete all[name];
  // newest first, and only the last 30 files
  const kept = Object.fromEntries([[name, { ...tuning, at: Date.now() }], ...Object.entries(all)].slice(0, 30));
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(kept)); } catch {}
}
function localSaved(name) {
  const all = localTunings();
  return { own: all[name] ?? null, others: Object.entries(all).filter(([n]) => n !== name).map(([, t]) => t) };
}

// saved: { own, others } from the app (see restoreTuning), or a single tuning.
function restore(saved) {
  if (!state.model) return;
  let picked;
  if (state.psd) {
    // the opened model was rigged without overrides, so it serves as the base; other overrides are rigged anew
    const cache = new Map([[JSON.stringify([{}, state.mouthFrames, true, []]), state.model]]);
    picked = restoreTuning(t => {
      const overrides = t?.overrides ?? {}, mouthFrames = t ? !!t.mouthFrames : state.mouthFrames;
      const cleanup = t?.cleanup ?? true, edits = t?.edits ?? [];
      const key = JSON.stringify([overrides, mouthFrames, cleanup, edits]);
      if (!cache.has(key)) cache.set(key, autoRig(layersFor({ overrides, cleanup, edits }).psd, overrides, { mouthFrames }));
      return cache.get(key);
    }, saved);
    if (!picked.tuning) return;
    state.overrides = { ...picked.tuning.overrides };
    state.mouthFrames = $('#tMouthFrames').checked = !!picked.tuning.mouthFrames;
    state.cleanup = picked.tuning.cleanup ?? true;
    // strokes made on another file of the character are kept only where that file has the same layers
    state.edits = (picked.tuning.edits ?? []).filter(e => state.raw.layers.some((l, i) => layerKey(l, i) === e.layer));
    rebuildLayers();
  } else {
    picked = restoreTuning(() => state.model, saved);
    if (!picked.tuning) return;
  }
  setModel(picked.model, true);
  if (picked.own) {
    status(tr('Restored your control points, roles and physics for this model', '已恢复这个模型的控制点、部件类型和物理参数'));
  } else {
    // keep it for this file too, so later changes here are this file's own
    remember();
    const from = picked.tuning.file;
    status(tr(`Same character as ${from ? `“${from}”` : 'a model you tuned before'}: used its eyelid lines, control points, roles and physics`,
      `和${from ? `「${from}」` : '之前调过的模型'}是同一个角色：已沿用它的闭眼线、控制点、部件类型和物理参数`));
  }
}

// ---------- parts ----------

const REGION = {
  hair_front: C.violet, hair_back: C.violet,
  neck: C.blue, body: C.blue, arm: C.blue, legs: C.blue,
  ear_acc: C.orange, head_acc: C.orange, eyewear: C.orange,
  tail: C.green, wings: C.green, other: C.gray,
};
const regionColor = role => REGION[role] ?? (ROLES[role]?.head ? C.accent : C.gray);
const roleLocked = p => p.role === 'mouth_inner' || (p.role === 'mouth_frame' && !p.src);

const fillRoles = () => {
  $('#roleSelect').innerHTML = Object.entries(ROLES).map(([id, r]) => `<option value="${id}">${esc(labelOf(r))}</option>`).join('');
};

function buildParts() {
  const box = $('#parts');
  box.innerHTML = '';
  const parts = [...state.model.parts].reverse();
  $('#partCount').textContent = tr(`${parts.length} parts · top to bottom`, `${parts.length} 个部件 · 从上到下`);
  for (const p of parts) {
    const row = document.createElement('div');
    row.className = 'part' + (p.visible ? '' : ' off');
    row._part = p;
    const tags = ROLES[p.role]?.physics ? `<span class="tag phys">${tr('Physics', '物理')}</span>` : '';
    row.innerHTML = `<button class="ibtn eye" aria-label="${tr('Show or hide', '显示或隐藏')} ${esc(p.name)}">${icon(p.visible ? 'eye' : 'eyeoff')}</button>
      <button class="pick"><span class="swatch"><i style="background:${regionColor(p.role)}"></i></span>
        <span class="txt"><span class="nm" title="${esc(p.name)}">${esc(p.name)}</span><span class="rl">${esc(ROLES[p.role] ? labelOf(ROLES[p.role]) : p.role)}</span></span>${tags}</button>`;
    const [eye, pick] = row.children;
    eye.addEventListener('click', () => {
      p.visible = !p.visible;
      row.classList.toggle('off', !p.visible);
      eye.innerHTML = icon(p.visible ? 'eye' : 'eyeoff');
      remember();
    });
    pick.addEventListener('click', () => select(state.selected === p ? null : p));
    box.append(row);
  }
  filterParts();
  select(null);
}

function select(p) {
  state.selected = p;
  document.querySelectorAll('#parts .part').forEach(r => r.classList.toggle('sel', r._part === p));
  $('#selPanel').hidden = !p;
  touchSelected();
  if (!p) return;
  $('#selName').textContent = p.name;
  $('#roleSelect').value = p.role;
  $('#roleSelect').disabled = roleLocked(p);
}

function filterParts() {
  const q = $('#partFilter').value.trim().toLowerCase();
  for (const row of document.querySelectorAll('#parts .part')) {
    const p = row._part;
    const r = ROLES[p.role];
    row.hidden = !!q && ![p.name, r?.label ?? '', r?.zh ?? ''].some(t => t.toLowerCase().includes(q));
  }
}
$('#partFilter').addEventListener('input', filterParts);

$('#roleSelect').addEventListener('change', e => {
  const p = state.selected;
  if (!p) return;
  if (state.psd && p.src) {
    state.overrides[p.src] = e.target.value;
    rerig();
  } else {
    p.role = e.target.value;
    p.depth = (ROLES[p.role]?.depth ?? [0, 0]).slice();
    prepare(state.model);
    buildParts();
    remember();
  }
});

// ---------- parameters and physics ----------

const PARAM_GROUPS = [
  [['Head', '头部'], ['angleX', 'angleY', 'angleZ']],
  [['Body', '身体'], ['bodyX', 'breath']],
  [['Eyes', '眼睛'], ['eyeLOpen', 'eyeROpen', 'eyeX', 'eyeY']],
  [['Brows & mouth', '眉毛和嘴'], ['browY', 'mouthOpen', 'mouthForm', 'vowel']],
];

function slider(label, min, max, step, value, digits, onInput) {
  const row = document.createElement('label');
  row.className = 'slider';
  row.innerHTML = `<span class="lbl"><span title="${esc(label)}">${esc(label)}</span><output></output></span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
  const out = row.querySelector('output'), input = row.querySelector('input');
  const show = v => {
    const t = (+v).toFixed(digits), zero = +t === 0; // no "-0.0"
    out.value = zero ? (0).toFixed(digits) : (v > 0 && min < 0 ? '+' : '') + t;
  };
  show(value);
  input.addEventListener('input', () => { show(input.value); onInput(+input.value); });
  return { row, input, show };
}

const paramInputs = {};
function buildParams() {
  const box = $('#params');
  const byId = Object.fromEntries(PARAMS.map(d => [d.id, d]));
  const grouped = new Set(PARAM_GROUPS.flatMap(([, ids]) => ids));
  const groups = [...PARAM_GROUPS, [['Other', '其他'], PARAMS.map(d => d.id).filter(id => !grouped.has(id))]];
  for (const [title, ids] of groups) {
    if (!ids.length) continue;
    const g = document.createElement('div');
    g.className = 'group';
    g.innerHTML = `<h3 class="cap">${esc(tr(...title))}</h3>`;
    for (const id of ids) {
      const def = byId[id];
      const step = def.max - def.min > 2 ? 0.1 : 0.01;
      const s = slider(labelOf(def), def.min, def.max, step, def.def, step < 0.1 ? 2 : 1, v => {
        if (state.auto) setAuto(false);
        state.P[def.id] = v;
      });
      paramInputs[def.id] = s;
      g.append(s.row);
    }
    box.append(g);
  }
  syncParams();
}

function syncParams() {
  for (const def of PARAMS) {
    const { input, show } = paramInputs[def.id];
    if (document.activeElement === input) continue;
    input.value = state.P[def.id];
    show(state.P[def.id]);
  }
}

$('#resetParams').addEventListener('click', () => {
  Object.assign(state.P, defaultParams());
  syncParams();
});

function buildPhysics() {
  const box = $('#physics');
  box.innerHTML = '';
  const used = new Set(state.model.parts.map(p => ROLES[p.role]?.physics).filter(Boolean));
  const fields = [['amp', tr('Sway', '摆幅'), 0, 0.6, 0.01, 2], ['k', tr('Stiffness', '硬度'), 5, 120, 1, 0], ['c', tr('Damping', '阻尼'), 0.5, 20, 0.1, 1], ['gain', tr('Follow strength', '跟随强度'), 0, 3, 0.05, 2]];
  for (const g of state.model.physics) {
    if (!used.has(g.id)) continue;
    const card = document.createElement('div');
    card.className = 'box';
    // labels come from the defaults so models saved with older labels still read right
    const def = PHYSICS_DEFAULT.find(d => d.id === g.id);
    card.innerHTML = `<h3>${esc(def ? labelOf(def) : g.label)}</h3>`;
    for (const [key, label, min, max, step, digits] of fields) {
      card.append(slider(label, min, max, step, g[key], digits, v => { g[key] = v; remember(); }).row);
    }
    box.append(card);
  }
  if (!box.children.length) box.innerHTML = `<p class="note" style="margin-top:14px">${tr('This model has no parts with physics.', '这个模型没有带物理的部件。')}</p>`;
}

// ---------- overlay: mesh, handles, pan / zoom ----------

function handles() {
  const { head, neck, eyes } = state.model.rig;
  const list = [
    { id: 'head', x: head.cx, y: head.cy, label: tr('Head center', '头部中心'), color: C.accent },
    { id: 'radius', x: head.cx + head.r, y: head.cy, label: tr('Head radius', '头部半径'), color: C.accent, hollow: true },
    { id: 'neck', x: neck.x, y: neck.y, label: tr('Neck pivot', '脖子支点'), color: C.blue },
  ];
  for (const side of ['L', 'R']) {
    const e = eyes[side];
    if (!e) continue;
    // centre moves the whole line, either end sets its width and tilt
    const [ex, ey] = lidEnd(e);
    list.push({ id: 'eye' + side, x: e.cx, y: e.lidY, label: side === 'L' ? tr('Eyelid line', '闭眼线') : null, color: C.orange });
    list.push({ id: 'eye' + side + '<', x: e.cx - ex, y: e.lidY - ey, small: true, color: C.orange });
    list.push({ id: 'eye' + side + '>', x: e.cx + ex, y: e.lidY + ey, small: true, color: C.orange });
  }
  return list;
}

// Offset from the lid line's centre to its right end.
const lidEnd = e => [Math.cos(e.angle ?? 0) * e.w / 2, Math.sin(e.angle ?? 0) * e.w / 2];

function moveHandle(id, x, y) {
  const rig = state.model.rig;
  if (id === 'head') { rig.head.cx = x; rig.head.cy = y; }
  if (id === 'radius') rig.head.r = Math.max(8, Math.hypot(x - rig.head.cx, y - rig.head.cy));
  if (id === 'neck') { rig.neck.x = x; rig.neck.y = y; }
  if (id.startsWith('eye') && id.length === 5) {
    const e = rig.eyes[id[3]];
    const k = id[4] === '>' ? 1 : -1, dx = (x - e.cx) * k, dy = (y - e.lidY) * k;
    const a = Math.atan2(dy, dx);
    e.w = Math.max(4, Math.hypot(dx, dy) * 2);
    e.angle = Math.abs(a) < 3 * Math.PI / 180 ? 0 : a; // snap back to level near 0°
  } else if (id.startsWith('eye')) {
    const e = rig.eyes[id.slice(3)];
    e.cx = x;
    e.lidY = clamp(y, e.top + 2, e.top + e.h);
  }
  prepare(state.model);
}

function drawOverlay(v) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(stage.clientWidth * dpr), h = Math.round(stage.clientHeight * dpr);
  if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
  const ctx = overlay.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const sx = x => x * v.scale + v.ox, sy = y => y * v.scale + v.oy;

  const mesh = (p, color) => {
    const o = p._out, idx = p.mesh.idx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 2, b = idx[i + 1] * 2, c = idx[i + 2] * 2;
      ctx.moveTo(sx(o[a]), sy(o[a + 1]));
      ctx.lineTo(sx(o[b]), sy(o[b + 1]));
      ctx.lineTo(sx(o[c]), sy(o[c + 1]));
      ctx.closePath();
    }
    ctx.stroke();
  };
  if (state.showMesh) for (const p of state.model.parts) if (p.visible) mesh(p, 'rgba(47,107,255,.35)');
  if (state.selected && !touch.on) mesh(state.selected, 'rgba(224,36,94,.85)');
  if (touch.on) return drawBrush(ctx, sx, sy, v);

  if (!state.showHandles) return;
  const { head, eyes } = state.model.rig;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 6]);
  ctx.strokeStyle = 'rgba(224,36,94,.6)';
  ctx.beginPath();
  ctx.arc(sx(head.cx), sy(head.cy), head.r * v.scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(sx(head.cx), sy(head.cy));
  ctx.lineTo(sx(head.cx + head.r), sy(head.cy));
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.orange;
  for (const side of ['L', 'R']) {
    const e = eyes[side];
    if (!e) continue;
    const [ex, ey] = lidEnd(e);
    ctx.beginPath();
    ctx.moveTo(sx(e.cx - ex), sy(e.lidY - ey));
    ctx.lineTo(sx(e.cx + ex), sy(e.lidY + ey));
    ctx.stroke();
  }
  ctx.font = '600 11px system-ui, -apple-system, sans-serif';
  for (const hd of handles()) {
    const x = sx(hd.x), y = sy(hd.y);
    const active = state.drag?.handle === hd.id;
    const r = (hd.small ? 3.5 : 5.5) + (active ? 1.5 : 0);
    ctx.lineWidth = hd.small ? 1.5 : 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (hd.small || hd.hollow) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = hd.color;
    } else {
      ctx.fillStyle = hd.color;
      ctx.strokeStyle = '#fff';
    }
    ctx.fill();
    ctx.stroke();
    if (!hd.label) continue;
    // label pill
    // the radius label sits below its point and the eyelid label to the left, clear of the head centre's
    const tw = ctx.measureText(hd.label).width;
    const bx = hd.id === 'eyeL' ? x - tw - 26 : x + 10, by = hd.hollow ? y + 8 : y - 22;
    ctx.fillStyle = 'rgba(255,255,255,.96)';
    ctx.strokeStyle = '#DADDE5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, tw + 16, 20, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1A1B22';
    ctx.fillText(hd.label, bx + 8, by + 14);
  }
}

overlay.addEventListener('pointerdown', e => {
  if (!state.model) return;
  if (touch.on && touchDown(e)) return;
  const v = view(), r = overlay.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const hit = !touch.on && state.showHandles && handles().find(h => Math.hypot(h.x * v.scale + v.ox - mx, h.y * v.scale + v.oy - my) < 9);
  state.drag = hit ? { handle: hit.id } : { pan: true, x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
  overlay.setPointerCapture(e.pointerId);
  overlay.style.cursor = hit ? 'move' : 'grabbing';
});
overlay.addEventListener('pointermove', e => {
  if (!state.model) return;
  const v = view(), r = overlay.getBoundingClientRect();
  touch.mouse = [(e.clientX - r.left - v.ox) / v.scale, (e.clientY - r.top - v.oy) / v.scale];
  if (touch.stroke) return touchMove();
  const d = state.drag;
  if (d?.handle) moveHandle(d.handle, (e.clientX - r.left - v.ox) / v.scale, (e.clientY - r.top - v.oy) / v.scale);
  else if (d?.pan) { state.panX = d.px + e.clientX - d.x; state.panY = d.py + e.clientY - d.y; }
  const { head } = state.model.rig;
  const dx = e.clientX - r.left - (v.ox + head.cx * v.scale), dy = e.clientY - r.top - (v.oy + head.cy * v.scale);
  driver.pointer(dx / (r.width / 2), -dy / (r.height / 2), Math.hypot(dx, dy) / (head.r * v.scale));
});
overlay.addEventListener('pointerleave', () => { touch.mouse = null; driver.pointer(0, 0, 99, false); });
overlay.addEventListener('pointerup', () => {
  if (touch.stroke) return touchUp();
  if (state.drag?.handle) remember();
  state.drag = null;
  overlay.style.cursor = touch.on ? 'crosshair' : 'grab';
});

// Zooms around a point on the stage (the centre when none is given).
function zoomBy(factor, mx = stage.clientWidth / 2, my = stage.clientHeight / 2) {
  if (!state.model) return;
  const before = view();
  const ux = (mx - before.ox) / before.scale, uy = (my - before.oy) / before.scale;
  state.zoom = clamp(state.zoom * factor, 0.2, 12);
  const after = view();
  state.panX += mx - (ux * after.scale + after.ox);
  state.panY += my - (uy * after.scale + after.oy);
}
const resetView = () => { state.zoom = 1; state.panX = state.panY = 0; };
overlay.addEventListener('wheel', e => {
  e.preventDefault();
  const r = overlay.getBoundingClientRect();
  zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
overlay.addEventListener('dblclick', resetView);
$('#zoomIn').addEventListener('click', () => zoomBy(1.25));
$('#zoomOut').addEventListener('click', () => zoomBy(0.8));
$('#zoomFit').addEventListener('click', resetView);

// ---------- export ----------

async function download(blob, filename) {
  if (host) {
    host.postMessage({ type: 'save', name: filename, data: await blob.text() });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Bundles the runtime modules into one self-contained HTML page with the model inlined.
async function buildHTML() {
  // tracking.js is left out: an exported page carries no face model
  const files = ['i18n.js', 'roles.js', 'rig.js', 'renderer.js', 'idle.js', 'voice.js', 'driver.js', 'format.js', 'player.js'];
  let code = '';
  for (const f of files) {
    const src = await (await fetch(new URL(f, import.meta.url))).text();
    code += `// ---- ${f}\n` + src.replace(/^import[^\n]*\n/gm, '').replace(/^export\s+(?=(async\s+)?(function|class|const|let)\b)/gm, '') + '\n';
  }
  const json = JSON.stringify(serializeDoll(state.model)).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${state.name.replace(/</g, '')}</title></head><body>
<script id="doll-model" type="application/json">${json}</script>
<script type="module">
${code.replace(/<\/script/gi, '<\\/script')}
runPlayerPage(JSON.parse(document.getElementById('doll-model').textContent));
</script></body></html>`;
  return html;
}

async function exportHTML() {
  download(new Blob([await buildHTML()], { type: 'text/html' }), `${state.name}.html`);
}

// ---------- header menus ----------

// The start screen (recent models, Open PSD / .doll), shown again over a loaded model by the header's Open, so
// switching models starts from the recent list rather than a file dialog.
function showHome(on) {
  on &&= !!state.model; // with no model it is simply the start screen
  document.body.classList.toggle('home', on);
  $('#empty').hidden = !on && !!state.model;
  press($('#openBtn'), on);
  if (!on) return;
  $('#homeBackName').textContent = state.fileName ?? tr('the model', '模型');
  host?.postMessage({ type: 'recents' }); // a fresh list, with what was opened since
}
$('#openBtn').addEventListener('click', () => {
  if (!state.model) return $('#filePsd').click();
  showHome(!document.body.classList.contains('home'));
});
$('#homeBack').addEventListener('click', () => showHome(false));
addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('home')) showHome(false); });

function menu(btn, list) {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = list.hidden;
    closeMenus();
    list.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  list.addEventListener('click', () => closeMenus());
}
function closeMenus() {
  for (const [b, l] of [['#exportBtn', '#exportMenu']]) {
    $(l).hidden = true;
    $(b).setAttribute('aria-expanded', 'false');
  }
}
menu($('#exportBtn'), $('#exportMenu'));
addEventListener('click', closeMenus);
addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

const pickPsd = () => $('#filePsd').click(), pickDoll = () => $('#fileDoll').click();
$('#emptyPsd').addEventListener('click', pickPsd);
$('#emptyDoll').addEventListener('click', pickDoll);
$('#filePsd').addEventListener('change', async e => { const f = e.target.files[0]; if (f) openPSD(await f.arrayBuffer(), f.name); e.target.value = ''; });
$('#fileDoll').addEventListener('change', e => { const f = e.target.files[0]; if (f) openDollFile(f); e.target.value = ''; });
$('#saveDoll').addEventListener('click', () => {
  download(new Blob([JSON.stringify(serializeDoll(state.model))], { type: 'application/json' }), `${state.name}.doll`);
});
$('#saveHtml').addEventListener('click', () => exportHTML().catch(e => status(tr('Export failed: ', '导出失败：') + e.message)));
if (host) {
  $('#setPet').hidden = false;
  $('#playerLink').hidden = true;
  $('#setPet').addEventListener('click', () => {
    host.postMessage({ type: 'setPet', doll: JSON.stringify(serializeDoll(state.model)) });
    status(tr('Now on your desktop', '已放到桌面上'));
  });
}

// Recent models on the welcome screen, sent by the app: [{ name, folder, path, ago, current, thumb? }].
// A card without a thumbnail shows a pastel dot until the app has one rendered and sends it (setThumb).
const THUMBS = ['#C9B6F7', '#BCD2FF', '#FFD0BD', '#B8EBD3'];
function setRecents(list) {
  const grid = $('#recentGrid');
  grid.innerHTML = '';
  $('#recentWrap').hidden = !list.length;
  list.slice(0, 8).forEach((r, i) => {
    const card = document.createElement('button');
    card.className = 'card';
    card.title = r.path;
    card.dataset.path = r.path;
    card.innerHTML = `<span class="thumb"><i style="background:${THUMBS[i % THUMBS.length]}"></i>${r.current ? `<b>${tr('Current pet', '当前桌宠')}</b>` : ''}</span>
      <span class="meta"><span>${esc(r.name)}</span><span>${esc(r.folder)} · ${esc(r.ago)}</span></span>`;
    if (r.thumb) setThumb(r.path, r.thumb, card);
    card.addEventListener('click', () => host?.postMessage({ type: 'openRecent', path: r.path }));
    grid.append(card);
  });
}

function setThumb(path, png, card = [...$('#recentGrid').children].find(c => c.dataset.path === path)) {
  if (!card) return;
  const img = new Image();
  img.src = png;
  img.alt = '';
  card.querySelector('.thumb > :first-child').replaceWith(img);
}


addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragover'); });
addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragover'); });
addEventListener('drop', async e => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (/\.(psd|psb)$/i.test(f.name)) openPSD(await f.arrayBuffer(), f.name);
  else openDollFile(f);
});

// ---------- preview toggles and inspector ----------

function setAuto(on) {
  state.auto = on;
  press($('#tAuto'), on);
  $('#autoNote').hidden = !on;
}
$('#tAuto').addEventListener('click', () => setAuto(!state.auto));
$('#tFollow').addEventListener('click', e => { driver.follow = !driver.follow; press(e.currentTarget, driver.follow); });
$('#tMesh').addEventListener('click', e => { state.showMesh = !state.showMesh; press(e.currentTarget, state.showMesh); });
$('#tHandles').addEventListener('click', e => { state.showHandles = !state.showHandles; press(e.currentTarget, state.showHandles); });
$('#tMic').addEventListener('click', async e => {
  const btn = e.currentTarget;
  if (driver.mic) { driver.disableMic(); press(btn, false); return; }
  try { await driver.enableMic(); press(btn, true); } catch (err) { status(tr('Could not open the microphone: ', '无法打开麦克风：') + err.message); }
});
$('#tCamera').addEventListener('click', async e => {
  const btn = e.currentTarget;
  $('#calibrate').hidden = true;
  if (driver.tracker) { driver.disableCamera(); press(btn, false); status(tr('Face tracking off', '面部捕捉已关闭')); return; }
  status(tr('Loading face tracking and opening the camera…', '正在加载面部捕捉并打开摄像头…'));
  press(btn, true);
  try {
    await driver.enableCamera();
    $('#calibrate').hidden = false;
    status(tr('Face tracking on. Hold still facing the camera for a second to calibrate, or click Calibrate front.', '面部捕捉已开启。正对摄像头静止一秒会自动校准，也可以点「校准正面」。'));
  } catch (err) {
    press(btn, false);
    status(tr('Could not start face tracking: ', '无法启动面部捕捉：') + err.message);
  }
});
$('#calibrate').addEventListener('click', () => {
  status(driver.tracker?.calibrate() ? tr('Your current pose is now the front', '已把现在的姿势设为正面') : tr('No face found yet. Face the camera and try again.', '还没找到脸。请正对摄像头再试一次。'));
});
$('#turn').addEventListener('input', e => {
  if (!state.model) return;
  state.model.rig.turn = +e.target.value;
  $('#turnOut').value = (+e.target.value).toFixed(2);
  remember();
});
$('#tMouthFrames').addEventListener('change', e => {
  state.mouthFrames = e.target.checked;
  if (state.psd) rerig();
});
$('#rerig').addEventListener('click', () => { if (state.psd) { rerig(); status(tr('Control points reset to the auto-rig', '控制点已重置为自动绑定的结果')); } });

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.tab')) {
      t.setAttribute('aria-selected', String(t === tab));
      $('#tab-' + t.dataset.tab).hidden = t !== tab;
    }
    setTouch(tab.dataset.tab === 'touch');
  });
}

// ---------- touch-up ----------
// The Touch up tab: the auto clean-up switch, and brushes that paint on the PSD layer of the part picked in the
// list (all its pieces, e.g. both eyes of one layer). Strokes are kept in the tuning and replayed on the layers
// before rigging, so they last, and an exported .doll or the pet carries them baked into its textures.

const REST = defaultParams();
const touch = {
  on: false, tool: 'erase', r: 8, color: [255, 240, 230], to: null, solo: false,
  stroke: null, mouse: null, space: false, shake: null,
};
const TOOL_COLOR = { erase: '#E0245E', cover: '#F07C00', move: '#7C5CFF', restore: '#0A8F62' };
const TOOL_HINT = () => ({
  erase: tr('Paint over stray bits to delete them.', '涂过零散的碎线就能删掉。'),
  cover: tr('Paint over strokes inside the part to cover them with the colour. Alt-click the canvas to pick a colour from the part.',
    '涂过部件里的线条，用颜色盖住。按住 Alt 点击画布可以从部件上取色。'),
  move: tr('Paint loosely over a stray line. Only what is not the part’s own colour moves; the gap it leaves is filled with that colour.',
    '大致涂过一根拆错图层的线。只有不是这个部件本身颜色的像素会移走，留下的空缺用部件本身的颜色补上。'),
  restore: tr('Paint to bring back the original pixels (undoes the clean-up and your strokes there).', '涂过的地方恢复原图（撤销那里的自动清理和你的笔画）。'),
});

function setTouch(on) {
  if (touch.on === on) return;
  touch.on = on;
  touch.stroke = null;
  overlay.style.cursor = on ? 'crosshair' : 'grab';
  document.body.classList.toggle('touching', on);
  if (on) touchSelected();
}

const layerIndex = key => state.raw?.layers.findIndex((l, i) => layerKey(l, i) === key) ?? -1;
const layerNamed = key => { const i = layerIndex(key); return i >= 0 ? state.psd.layers[i] : null; };

// The panel follows the part picked in the list.
function touchSelected() {
  const p = state.selected, key = p?.src, ok = !!(state.raw && key && layerIndex(key) >= 0);
  $('#touchTarget').textContent = !state.raw ? tr('Touch-ups work on a PSD. Open one to use them.', '修图只对 PSD 有效，先打开一个 PSD。')
    : ok ? tr(`Painting on layer “${state.raw.layers[layerIndex(key)].name}”`, `正在图层「${state.raw.layers[layerIndex(key)].name}」上绘制`)
    : tr('Pick a part in the list on the left to paint on it.', '在左侧列表里选一个部件，就能在它上面画。');
  $('#touchTarget').classList.toggle('on', ok);
  updateTouchCount();
  if (!ok) return;
  touch.color = fillColor(layerNamed(key));
  $('#touchColor').value = hex(touch.color);
  // move to: the other layers, top first; from the face, the front hair is the usual place
  const sel = $('#touchTo');
  const opts = state.raw.layers.map((l, i) => [layerKey(l, i), l.name]).filter(([k]) => k !== key).reverse();
  // a layer split into left and right parts (eyes, brows) is one layer here: the side follows where it is painted
  sel.innerHTML = opts.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}${twoSided(k) ? tr(' (L + R)', '（左 + 右）') : ''}</option>`).join('');
  const hair = opts.find(([k]) => /front\s*hair|前发|刘海/i.test(k));
  if (touch.to && opts.some(([k]) => k === touch.to)) sel.value = touch.to;
  else if (p.role === 'face' && hair) sel.value = hair[0];
  touch.to = sel.value;
  showHint();
}

const twoSided = key => !!ROLES[state.overrides[key] ?? guessRole(key.slice(key.indexOf(':') + 1))]?.split;

const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const fromHex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

function touchDown(e) {
  const key = state.selected?.src;
  if (touch.space || e.button !== 0 || !key || layerIndex(key) < 0) return false; // pan instead
  const [x, y] = touch.mouse = toCanvas(e); // where it was pressed (a pen lands without moving there first)
  if (e.altKey) { // pick the cover colour from the part
    const l = layerNamed(key), lx = Math.floor(x) - l.x, ly = Math.floor(y) - l.y;
    if (lx >= 0 && ly >= 0 && lx < l.width && ly < l.height && l.rgba[(ly * l.width + lx) * 4 + 3] > 128) {
      const i = (ly * l.width + lx) * 4;
      touch.color = [l.rgba[i], l.rgba[i + 1], l.rgba[i + 2]];
      $('#touchColor').value = hex(touch.color);
      setTool('cover');
      status(tr('Picked the cover colour', '已取色'));
    }
    return true;
  }
  touch.stroke = { layer: key, tool: touch.tool, r: touch.r, pts: [round(x), round(y)] };
  if (touch.tool === 'cover') touch.stroke.color = touch.color.slice();
  if (touch.tool === 'move') touch.stroke.to = touch.to;
  overlay.setPointerCapture(e.pointerId);
  return true;
}
const round = v => Math.round(v * 2) / 2;
function toCanvas(e) {
  const v = view(), r = overlay.getBoundingClientRect();
  return [(e.clientX - r.left - v.ox) / v.scale, (e.clientY - r.top - v.oy) / v.scale];
}
function touchMove() {
  const p = touch.stroke.pts, [x, y] = touch.mouse;
  // a point every quarter brush is plenty, and keeps the saved strokes small
  if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) >= Math.max(0.5, touch.stroke.r / 4)) p.push(round(x), round(y));
}
function touchUp() {
  const e = touch.stroke;
  touch.stroke = null;
  if (e.tool === 'move' && !e.to) return;
  state.edits.push(e);
  const res = applyEdit(state.psd, state.raw, e, state.owned);
  if (e.tool !== 'move') return rigAgain();
  const from = state.raw.layers[layerIndex(e.layer)].name, to = state.raw.layers[layerIndex(e.to)].name;
  if (!res.moved) { // drop the stroke; the model on screen was rigged without it
    state.edits.pop();
    rebuildLayers();
    status(tr(`Nothing moved: everything under the brush is ${from}'s own colour. Paint over the stray line itself.`,
      `没有移动任何像素：笔刷下都是 ${from} 本身的颜色。请直接涂在那根线上。`));
    return;
  }
  rigAgain();
  // at rest the picture looks the same, so shake the part that took the pixels: they now move with it
  touch.shake = { key: e.to, t0: performance.now() };
  status(tr(`Moved ${res.moved.toLocaleString()} px from ${from} to ${to}`
    + (res.patched ? `, and filled the gap in ${from} with its own colour` : '') + `. ${to} shakes so you can see them go with it.`,
    `已把 ${res.moved.toLocaleString()} 像素从 ${from} 移到 ${to}`
    + (res.patched ? `，并用 ${from} 本身的颜色补上了空缺` : '') + `。${to} 晃一下，表示这些线以后跟着它动。`));
}

// Rigs the touched-up layers again, keeping everything the user set and the part picked.
function rigAgain() {
  const keep = state.selected && { src: state.selected.src, side: state.selected.side };
  const t = currentTuning();
  const m = autoRig(state.psd, state.overrides, { mouthFrames: state.mouthFrames });
  applyTuning(m, t);
  setModel(m, true);
  if (keep) select(m.parts.find(p => p.src === keep.src && p.side === keep.side) ?? m.parts.find(p => p.src === keep.src) ?? null);
  updateTouchCount();
  remember();
}

// For a moment after a move, the part that took the pixels sways side to side.
function shakeTarget(now) {
  const s = touch.shake;
  if (!s) return;
  const t = (now - s.t0) / 1000;
  if (t > 1.2) { touch.shake = null; return; }
  const dx = Math.sin(t * Math.PI * 2 * 2.5) * (1 - t / 1.2) * 0.12 * state.model.rig.head.r;
  for (const p of state.model.parts) {
    if (p.src !== s.key) continue;
    for (let i = 0; i < p._out.length; i += 2) p._out[i] += dx;
  }
}

function updateTouchCount() {
  const key = state.selected?.src, n = state.edits.length, mine = state.edits.filter(e => e.layer === key || e.to === key).length;
  $('#touchCount').textContent = n
    ? tr(`${n} stroke${n > 1 ? 's' : ''}${mine && mine < n ? ` · ${mine} on this part` : ''}`, `${n} 笔${mine && mine < n ? ` · 这个部件 ${mine} 笔` : ''}`)
    : tr('No strokes yet', '还没有笔画');
  $('#touchUndo').disabled = !n;
  $('#touchClear').disabled = !mine;
}

function touchUndo() {
  if (!state.edits.length) return;
  state.edits.pop();
  rebuildLayers();
  rigAgain();
  status(tr('Undid the last stroke', '已撤销上一笔'));
}

function setTool(t) {
  touch.tool = t;
  for (const b of document.querySelectorAll('#touchTools button')) press(b, b.dataset.tool === t);
  $('#touchColorRow').hidden = t !== 'cover';
  $('#touchToRow').hidden = t !== 'move';
  showHint();
}
function showHint() {
  const key = state.selected?.src, i = layerIndex(key), j = layerIndex(touch.to);
  const a = i >= 0 && state.raw.layers[i].name, b = j >= 0 && state.raw.layers[j].name;
  $('#touchHint').textContent = touch.tool === 'move' && i >= 0 && j >= 0
    ? tr(`Paint loosely over a line in ${a} that belongs to ${b}. Only what is not ${a}’s own colour moves into ${b}; the gap is filled with that colour.`
      + (twoSided(touch.to) ? ` ${b} holds both sides: what you move joins the left or right one, whichever it is painted next to.` : ''),
      `大致涂过 ${a} 里本该属于 ${b} 的线。只有不是 ${a} 本身颜色的像素会移进 ${b}，空缺用 ${a} 本身的颜色补上。`
      + (twoSided(touch.to) ? `${b} 包含左右两边：移过去的像素会归到离涂抹位置近的那一边。` : ''))
    : TOOL_HINT()[touch.tool];
}

function showCleanReport() {
  const box = $('#cleanReport');
  if (!state.raw) { box.textContent = ''; return; }
  $('#tCleanup').checked = state.cleanup; // a file reopened with it off
  const rows = Object.entries(state.cleanReport).map(([key, r]) => {
    const name = state.raw.layers[layerIndex(key)]?.name ?? key, bits = [];
    if (r.fragments) bits.push(tr(`${r.fragments} loose fragment${r.fragments > 1 ? 's' : ''} removed`, `去掉了 ${r.fragments} 处零散碎片`));
    if (r.covered) bits.push(tr(`${r.covered.toLocaleString()} px of hair under the bangs covered with skin`, `把刘海下面 ${r.covered.toLocaleString()} 像素的头发盖成了肤色`));
    return `<li><b>${esc(name)}</b> ${bits.join(tr(', ', '，'))}</li>`;
  });
  box.innerHTML = !state.cleanup ? `<p class="note">${tr('Off: the layers are used as they are in the PSD.', '已关闭：图层按 PSD 原样使用。')}</p>`
    : rows.length ? `<ul>${rows.join('')}</ul>` : `<p class="note">${tr('Nothing needed cleaning in this PSD.', '这个 PSD 没有需要清理的地方。')}</p>`;
}

function drawBrush(ctx, sx, sy, v) {
  const color = TOOL_COLOR[touch.tool], s = touch.stroke;
  if (s && s.pts.length) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = s.r * 2 * v.scale;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(sx(s.pts[0]), sy(s.pts[1]));
    for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(sx(s.pts[i]), sy(s.pts[i + 1]));
    if (s.pts.length === 2) ctx.lineTo(sx(s.pts[0]) + 0.01, sy(s.pts[1]));
    ctx.stroke();
    ctx.restore();
  }
  if (!touch.mouse || touch.space || !state.selected?.src) return;
  const [x, y] = touch.mouse;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.arc(sx(x), sy(y), Math.max(2, touch.r * v.scale), 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();
}

for (const b of document.querySelectorAll('#touchTools button')) b.addEventListener('click', () => setTool(b.dataset.tool));
function buildBrushSize() {
  const s = slider(tr('Brush size', '笔刷大小'), 1, 60, 1, touch.r, 0, v => { touch.r = v; });
  $('#touchSize').replaceChildren(s.row);
}
$('#touchColor').addEventListener('input', e => { touch.color = fromHex(e.target.value); });
$('#touchTo').addEventListener('change', e => { touch.to = e.target.value; showHint(); });
$('#touchSolo').addEventListener('change', e => { touch.solo = e.target.checked; });
$('#touchUndo').addEventListener('click', touchUndo);
$('#touchClear').addEventListener('click', () => {
  const key = state.selected?.src;
  state.edits = state.edits.filter(e => e.layer !== key && e.to !== key);
  rebuildLayers();
  rigAgain();
  status(tr('Removed the touch-ups on this part', '已清除这个部件的修图'));
});
$('#tCleanup').addEventListener('change', e => {
  if (!state.raw) return;
  state.cleanup = e.target.checked;
  rebuildLayers();
  rigAgain();
});
addEventListener('keydown', e => {
  if (!touch.on || e.target.closest?.('input, select, textarea')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); touchUndo(); }
  else if (e.key === ' ') { touch.space = true; overlay.style.cursor = 'grab'; e.preventDefault(); }
  else if (e.key === '[') { touch.r = Math.max(1, touch.r - 1); syncSize(); }
  else if (e.key === ']') { touch.r = Math.min(60, touch.r + 1); syncSize(); }
  else if ({ e: 1, c: 1, m: 1, r: 1 }[e.key]) setTool({ e: 'erase', c: 'cover', m: 'move', r: 'restore' }[e.key]);
});
addEventListener('keyup', e => { if (e.key === ' ') { touch.space = false; overlay.style.cursor = touch.on ? 'crosshair' : 'grab'; } });
function syncSize() {
  const input = $('#touchSize input');
  input.value = touch.r;
  input.dispatchEvent(new Event('input'));
}
setTool('erase');

// ---------- main loop ----------

// ---------- language ----------

// Everything drawn from script, in the current language; run at start and whenever the language changes.
function refreshLang() {
  $('#langBtn').textContent = tr('中文', 'EN');
  fillRoles();
  $('#step4').textContent = host ? tr('Set as desktop pet', '设为桌宠') : tr('Export', '导出');
  $('#step4Note').textContent = host ? tr('Or export a .doll or a web page.', '也可以导出 .doll 或网页。')
    : tr('Save a .doll model or a web page.', '保存为 .doll 模型或网页。');
  if (!state.fileName) $('#docName').textContent = tr('No file open', '未打开文件');
  if (!state.model) status(tr('Open a PSD to get started', '打开一个 PSD 开始'));
  $('#params').replaceChildren();
  buildParams();
  buildBrushSize();
  if (state.model) {
    const sel = state.selected;
    buildParts();
    buildPhysics();
    if (sel) select(sel);
  }
  touchSelected();
  showHint();
  showCleanReport();
}
onLang(refreshLang);
$('#langBtn').addEventListener('click', () => {
  const next = getLang() === 'zh' ? 'en' : 'zh';
  host?.postMessage({ type: 'lang', lang: next }); // the app keeps it, and switches its menus and the pet too
  setLang(next);
});

applyI18n();
refreshLang();
setAuto(true);
let last = performance.now(), shownZoom = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.model) {
    if (touch.on) {
      // the rest pose, where the parts sit where they were painted, so a stroke lands where it is drawn
      physics.reset();
      evaluate(state.model, REST, physics);
      shakeTarget(now);
    } else {
      driver.update(state.P, dt, state.auto);
      physics.step(state.model, state.P, dt);
      evaluate(state.model, state.P, physics);
    }
    renderer.resize();
    const v = view();
    const solo = touch.on && touch.solo && state.selected?.src;
    const shown = solo && state.model.parts.map(p => p.visible);
    if (solo) for (const p of state.model.parts) p.visible = p.src === state.selected.src;
    renderer.render(state.model, v);
    if (solo) state.model.parts.forEach((p, i) => { p.visible = shown[i]; });
    drawOverlay(v);
    if (state.auto || driver.mic || driver.tracker) syncParams();
    if (shownZoom !== state.zoom) { shownZoom = state.zoom; $('#zoomVal').textContent = Math.round(state.zoom * 100) + '%'; }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// A file handed over by the app (from its recent list): kind 'psd' or 'doll', and where to fetch its bytes.
async function openFromHost(kind, url, name) {
  const buffer = await (await fetch(url)).arrayBuffer();
  if (kind === 'psd') await openPSD(buffer, name);
  else await openDollFile(new File([buffer], name));
}

// Console access for debugging rigs: studio.state.P.angleX = 30, etc. The app calls openFromHost, restore,
// setRecents and setThumb.
window.studio = { state, driver, physics, setModel, openPSD, openFromHost, restore, setRecents, setThumb, buildHTML, serializeDoll, loadDoll };
host?.postMessage({ type: 'editorReady' });

const sample = new URLSearchParams(location.search).get('psd');
if (sample) {
  fetch(sample).then(r => r.arrayBuffer()).then(b => openPSD(b, sample.split('/').pop()));
}
