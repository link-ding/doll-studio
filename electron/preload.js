// Gives the web pages their host interface (the one the earlier native macOS app gave them through WKWebView, so
// src/ needs nothing Electron-specific): window.webkit.messageHandlers.<pet|studio>.postMessage(msg) reaches the main process, and
// window.DOLL_LANG holds the interface language before the page's scripts run (src/i18n.js).
// The pet page also gets its mouse handling here: dragging the window, a click to poke, and the right-click menu.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const role = process.argv.find(a => a.startsWith('--doll-role='))?.slice(12) ?? 'pet';
const post = msg => ipcRenderer.send('page-message', role, msg);

// the app's own panels (popover.html, the tray popover; hud.html, shown while adjusting the wallpaper) have an
// interface of their own: the main process sends their state and runs what they ask for
if (role === 'popover' || role === 'hud') {
  contextBridge.exposeInMainWorld('dollpet', {
    platform: process.platform,
    send: (act, value) => ipcRenderer.send('ui', role, act, value),
    resize: (height, width) => ipcRenderer.send('ui-size', role, height, width),
    onState: cb => ipcRenderer.on('state', (_e, state) => cb(state)),
  });
  // pictures dropped on the popover's wallpaper swatches
  if (role === 'popover') {
    addEventListener('drop', e => {
      const paths = [...(e.dataTransfer?.files ?? [])].map(f => webUtils.getPathForFile(f)).filter(Boolean);
      if (paths.length) ipcRenderer.send('ui', role, 'wallDrop', paths);
    }, true);
  }
} else {
  contextBridge.exposeInMainWorld('webkit', {
    messageHandlers: {
      pet: { postMessage: msg => post(msg) },
      studio: { postMessage: msg => post(msg) },
    },
  });
  contextBridge.exposeInMainWorld('DOLL_LANG', ipcRenderer.sendSync('lang'));
}

if (role === 'pet') {
  // The main process moves the window while the button is held (it reads the cursor itself, so a fast drag that
  // leaves the window keeps going); a press without movement is a poke.
  addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.target.setPointerCapture?.(e.pointerId);
    ipcRenderer.send('drag', 'start');
  });
  const end = () => ipcRenderer.send('drag', 'end');
  addEventListener('pointerup', e => { if (e.button === 0) end(); });
  addEventListener('lostpointercapture', end);
  addEventListener('contextmenu', e => { e.preventDefault(); ipcRenderer.send('pet-menu'); });
  // while the wallpaper is adjusted on screen, scrolling and pinching resize the character and keys move it
  addEventListener('wheel', e => ipcRenderer.send('wall-wheel', e.deltaY, e.ctrlKey), { passive: true });
  addEventListener('keydown', e => ipcRenderer.send('wall-key', e.key, e.shiftKey));
}

if (role === 'studio') {
  // The editor only tells the host a file's name; the path, for the recent list and for keeping its tuning, is
  // taken here from the file picker and from files dropped on the page.
  const picked = file => {
    const path = file && webUtils.getPathForFile(file);
    if (path) ipcRenderer.send('picked', path);
  };
  addEventListener('change', e => { if (e.target?.type === 'file') picked(e.target.files?.[0]); }, true);
  addEventListener('drop', e => picked(e.dataTransfer?.files?.[0]), true);
}
