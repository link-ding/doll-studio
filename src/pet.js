// Desktop-pet page, hosted by the desktop app (electron/). The host drives it through window.pet and listens for
// messages on webkit.messageHandlers.pet (electron/preload.js provides it).

import { startPlayer, contentBounds, edgeBounds, snapshot } from './player.js';
import { sceneSVG, sceneStill } from './scenes.js';
import { ROOMS, startRoom } from './rooms.js';
import { loadDoll, restoreTuning } from './format.js';
import { readPSD } from './psd.js';
import { autoRig } from './autorig.js';
import { prepareLayers } from './cleanup.js';
import { Driver } from './driver.js';
import { tr } from './i18n.js';

const post = msg => window.webkit?.messageHandlers?.pet?.postMessage(msg);

// kind: 'doll' or 'psd'; url: where the file is fetched from (the host serves it once, as bytes: a big PSD is never
// copied into a string); saved: what the user set in the editor, as { own, others } (this file's tuning, and those
// of other files for a PSD of the same character; see restoreTuning), or null
async function readModel(kind, url, saved) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(tr('Could not read the model file', '无法读取模型文件'));
  if (kind !== 'psd') {
    const model = await loadDoll(await res.json());
    return restoreTuning(() => model, saved).model;
  }
  const psd = await readPSD(await res.arrayBuffer()), cache = new Map();
  return restoreTuning(t => {
    // the layers as the editor rigs them: auto-cleaned unless turned off, with the touch-up strokes
    const overrides = t?.overrides ?? {}, cleanup = t?.cleanup ?? true, edits = t?.edits ?? [];
    const key = JSON.stringify([overrides, !!t?.mouthFrames, cleanup, edits]);
    if (!cache.has(key)) cache.set(key, autoRig(prepareLayers(psd, { overrides, cleanup, edits }).psd, overrides, { mouthFrames: !!t?.mouthFrames }));
    return cache.get(key);
  }, saved).model;
}

export function runPet() {
  const style = document.createElement('style');
  style.textContent = 'html,body{margin:0;height:100%;overflow:hidden;background:transparent}'
    + 'canvas,#scene{position:fixed;inset:0;width:100%;height:100%;display:block}'
    // adjusting the wallpaper on screen: a light veil over the background and a frame with resize dots around the
    // character (the host does the dragging; these only show it and set the cursor)
    + '#veil{position:fixed;inset:0;background:rgba(18,20,30,.22);display:none}'
    + '#frame{position:fixed;display:none;box-sizing:border-box;border:1.5px dashed rgba(255,255,255,.95);'
    + 'box-shadow:0 0 0 1px rgba(0,0,0,.28),inset 0 0 0 1px rgba(0,0,0,.18);border-radius:6px;cursor:grab}'
    + '#frame i{position:absolute;top:-8px;width:14px;height:14px;margin-left:-8px;border-radius:50%;background:#fff;'
    + 'border:1.5px solid #E0245E;box-shadow:0 1px 3px rgba(0,0,0,.3)}'
    + '#frame i:nth-child(1){left:0;cursor:nwse-resize}#frame i:nth-child(2){left:50%;cursor:ns-resize}'
    + '#frame i:nth-child(3){left:100%;cursor:nesw-resize}'
    + 'body.editing{cursor:default}';
  document.head.append(style);
  // the wallpaper's animated background (scenes.js), under the character
  const scene = document.createElement('div');
  scene.id = 'scene';
  const canvas = document.createElement('canvas');
  const veil = document.createElement('div');
  veil.id = 'veil';
  const frame = document.createElement('div');
  frame.id = 'frame';
  frame.innerHTML = '<i></i><i></i><i></i>';
  document.body.append(scene, veil, canvas, frame);
  // Wallpaper mode: where the character is drawn, { x, y, w, h } in CSS pixels from the top left, and `edit` while
  // the user adjusts it on screen. null: the pet window, which the character fills.
  const placeCharacter = o => {
    const box = o ? `inset:auto;left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px` : '';
    canvas.style.cssText = box;
    const edit = !!o?.edit;
    frame.style.cssText = edit ? box + ';display:block' : '';
    veil.style.display = edit ? 'block' : '';
    document.body.classList.toggle('editing', edit);
  };
  let sceneId = null, room = null; // the scene shown; a room (rooms.js) while that is one
  // one driver for every model the pet shows, so the microphone and camera stay on across a model change
  const driver = new Driver();
  // Frame cap and pause, shared by every model shown (see startPlayer). The pet draws 60 frames a second (a 120 Hz
  // display would otherwise have it draw twice as often for motion this slow) and the wallpaper 30; half that while
  // the Mac is in Low Power Mode.
  const limit = { fps: 60, paused: false };
  let onWall = false, lowPower = false;
  const setCap = () => { limit.fps = (onWall ? 30 : 60) / (lowPower ? 2 : 1); };
  // What the character is fitted to, changed in place when the mode changes (startPlayer reads it every frame): the
  // pet window's padded bounds, or on the wallpaper bounds whose cut-off sides (a bust's bottom edge) meet the screen
  // edge with no margin.
  const bounds = {}, flush = { on: false };
  let fit = null; // { pet, wall } bounds of the current model
  let app = null;

  window.pet = {
    async load(kind, url, saved = null) {
      try {
        const model = await readModel(kind, url, saved);
        const edges = edgeBounds(model);
        fit = { pet: contentBounds(model), wall: edges.bounds };
        Object.assign(bounds, flush.on ? fit.wall : fit.pet);
        app?.stop();
        app = startPlayer(canvas, model, { bounds, listen: false, driver, limit, flush });
        const aspect = b => (b.x1 - b.x0) / (b.y1 - b.y0);
        post({ type: 'loaded', aspect: aspect(fit.pet), wallAspect: aspect(fit.wall), cut: edges.cut });
      } catch (e) {
        post({ type: 'error', message: e.message });
      }
    },
    // A still of a model file for the recent-model cards. The app asks a hidden copy of this page, so the
    // pet and the editor keep running while a big PSD is read.
    async thumb(kind, url, saved = null) { return snapshot(await readModel(kind, url, saved)); },
    // Cursor position in this page's CSS pixels; it can be far outside the window. radius: how far from the face
    // counts as a full look.
    pointer(x, y, radius = 520) { app?.pointerAt(x, y, radius); },
    // Wallpaper mode: the page fills the screen, the character is drawn in { x, y, w, h } (CSS pixels from the top
    // left) over an animated `scene` (scenes.js) or over `bg` (a CSS background; "transparent" shows the desktop
    // picture), at no more than 30 frames a second. null goes back to the pet: the character fills the window.
    wallpaper(o) {
      placeCharacter(o);
      document.body.style.background = o?.scene ? '' : o?.bg ?? '';
      const id = o?.scene ?? null;
      if (id !== sceneId) {
        sceneId = id;
        room?.stop();
        room = null;
        if (id && ROOMS[id]) {
          scene.innerHTML = '';
          room = startRoom(scene, id, limit);
          room.pause(limit.paused);
        } else {
          scene.innerHTML = id ? sceneSVG(id) : '';
          scene.firstElementChild?.classList.toggle('paused', limit.paused);
        }
      }
      onWall = !!o;
      setCap();
      flush.on = !!o;
      if (fit) Object.assign(bounds, flush.on ? fit.wall : fit.pet);
    },
    // moves or resizes the character on the wallpaper, leaving the background as it is
    place(o) { placeCharacter(o); },
    // A still of a scene as a PNG data URL of width x height pixels, for the desktop picture.
    still(id, width, height) { return sceneStill(id, width, height); },
    // stop animating while the window can't be seen (covered, another Space's full-screen app, display asleep)
    pause(on) {
      limit.paused = !!on;
      if (room) room.pause(limit.paused);
      else scene.firstElementChild?.classList.toggle('paused', limit.paused);
    },
    // the Mac went into or out of Low Power Mode
    lowPower(on) { lowPower = !!on; setCap(); },
    follow(on) { driver.follow = on; },
    poke() { driver.react(); },
    // kind: 'done' or 'attention' (an agent finished, or needs the user)
    alert(kind) { driver.alert(kind); },
    async mic(on) {
      try {
        if (on && !driver.mic) await driver.enableMic();
        if (!on) driver.disableMic();
        post({ type: 'mic', on: !!driver.mic });
      } catch (e) {
        post({ type: 'mic', on: false, error: e.message });
      }
    },
    async camera(on) {
      try {
        if (on && !driver.tracker) await driver.enableCamera();
        if (!on) driver.disableCamera();
        post({ type: 'camera', on: !!driver.tracker });
      } catch (e) {
        driver.disableCamera();
        post({ type: 'camera', on: false, error: e.message });
      }
    },
    // the user's current head pose becomes "facing front"
    calibrate() { post({ type: 'calibrated', ok: !!driver.tracker?.calibrate() }); },
    // Whether the pixel under (x, y) is drawn, so the host can let clicks through elsewhere.
    hit(x, y) {
      if (!app) return false;
      const gl = app.renderer.gl, dpr = window.devicePixelRatio || 1;
      const px = new Uint8Array(4);
      gl.readPixels(Math.round(x * dpr), Math.round(canvas.height - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px[3] > 24;
    },
  };
  // A lost WebGL context normally comes back by itself (renderer.js). If it stays lost, the host is told once and
  // loads the page again.
  let lostFor = 0;
  const watch = setInterval(() => {
    lostFor = app?.renderer.lost ? lostFor + 1 : 0;
    if (lostFor < 3) return;
    clearInterval(watch);
    post({ type: 'stuck' });
  }, 2000);
  post({ type: 'ready' });
}
