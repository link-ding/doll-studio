// The few things wallpaper mode needs that Electron has no API for, called straight into the system through koffi
// (a C FFI with prebuilt binaries, so nothing is compiled):
//
// - putting the pet window on the desktop, under the desktop icons: on macOS its level becomes the one just under
//   the icons; on Windows it becomes a child of the desktop's WorkerW window,
//   the layer Explorer draws the desktop picture on, behind the icons.
// - reading and setting the system desktop picture of the main screen (NSWorkspace on macOS,
//   SystemParametersInfoW on Windows; the one picture there covers every screen).
//
// If koffi can't load (an unsupported platform, a build missing its binary), `available` is false and wallpaper
// mode is turned off in the menus instead of failing.

let koffi = null;
try { koffi = require('koffi'); } catch {}

const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';

function macBindings() {
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit'); // NSWorkspace, NSScreen
  const getClass = objc.func('void *objc_getClass(const char *name)');
  const sel = objc.func('void *sel_registerName(const char *name)');
  // objc_msgSend with the argument types each call needs
  const send = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
  const sendPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']);
  const sendStr = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'const char *']);
  const sendLong = objc.func('objc_msgSend', 'void', ['void *', 'void *', 'long']);
  const sendULong = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'unsigned long']);
  const sendCStr = objc.func('objc_msgSend', 'const char *', ['void *', 'void *']);
  const sendSetPicture = objc.func('objc_msgSend', 'bool', ['void *', 'void *', 'void *', 'void *', 'void *', koffi.out(koffi.pointer('void *'))]);
  const levelForKey = cg.func('int CGWindowLevelForKey(int key)');
  const S = name => sel(name);
  const C = name => getClass(name);
  const DESKTOP_ICON_LEVEL_KEY = 18; // kCGDesktopIconWindowLevelKey
  // NSWindowCollectionBehavior: CanJoinAllSpaces | Stationary | IgnoresCycle, and the pet's FullScreenAuxiliary
  const ON_DESKTOP = 1 | 16 | 64, PET = 1 | 16 | 256;

  const nsWindow = win => send(koffi.decode(win.getNativeWindowHandle(), 'void *'), S('window'));
  const nsString = s => sendStr(C('NSString'), S('stringWithUTF8String:'), s);
  const mainScreen = () => sendULong(send(C('NSScreen'), S('screens')), S('objectAtIndex:'), 0);
  const workspace = () => send(C('NSWorkspace'), S('sharedWorkspace'));

  return {
    desktopIconLevel: () => levelForKey(DESKTOP_ICON_LEVEL_KEY),
    level: win => Number(objc.func('objc_msgSend', 'long', ['void *', 'void *'])(nsWindow(win), S('level'))),
    // on: just under the desktop icons, on every Space, out of Exposé and the window cycle; off: back to a pet
    // (the caller sets the pet's level again with Electron's setAlwaysOnTop)
    toDesktop(win, on) {
      const w = nsWindow(win);
      if (on) sendLong(w, S('setLevel:'), levelForKey(DESKTOP_ICON_LEVEL_KEY) - 1);
      sendLong(w, S('setCollectionBehavior:'), on ? ON_DESKTOP : PET);
    },
    // a window just above the desktop icons (the bubble while the pet is the wallpaper)
    aboveDesktop(win) { sendLong(nsWindow(win), S('setLevel:'), levelForKey(DESKTOP_ICON_LEVEL_KEY) + 1); },
    getPicture() {
      const url = sendPtr(workspace(), S('desktopImageURLForScreen:'), mainScreen());
      return url ? sendCStr(send(url, S('path')), S('UTF8String')) : null;
    },
    setPicture(file) {
      const url = sendPtr(C('NSURL'), S('fileURLWithPath:'), nsString(file));
      const options = send(C('NSDictionary'), S('dictionary'));
      const err = [null];
      if (!sendSetPicture(workspace(), S('setDesktopImageURL:forScreen:options:error:'), url, mainScreen(), options, err)) {
        const text = err[0] && sendCStr(send(err[0], S('localizedDescription')), S('UTF8String'));
        throw new Error(text || 'NSWorkspace refused the picture');
      }
    },
  };
}

function winBindings() {
  const user32 = koffi.load('user32.dll');
  const HWND = koffi.pointer('HWND', koffi.opaque());
  const FindWindowW = user32.func('HWND __stdcall FindWindowW(const char16_t *cls, const char16_t *name)');
  const FindWindowExW = user32.func('HWND __stdcall FindWindowExW(HWND parent, HWND after, const char16_t *cls, const char16_t *name)');
  const SendMessageTimeoutW = user32.func('intptr_t __stdcall SendMessageTimeoutW(HWND hwnd, uint32_t msg, uintptr_t w, intptr_t l, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)');
  const EnumProc = koffi.proto('bool __stdcall EnumProc(HWND hwnd, intptr_t param)');
  const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumProc *cb, intptr_t param)');
  const SetParent = user32.func('HWND __stdcall SetParent(HWND child, HWND parent)');
  const SetWindowPos = user32.func('bool __stdcall SetWindowPos(HWND hwnd, HWND after, int x, int y, int cx, int cy, uint32_t flags)');
  const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)');
  const SystemParametersInfoW = user32.func('bool __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, void *pv, uint32_t winIni)');
  const SPI_GETDESKWALLPAPER = 0x73, SPI_SETDESKWALLPAPER = 0x14, SPIF_UPDATEINIFILE = 1, SPIF_SENDCHANGE = 2;
  const SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40;

  const hwndOf = win => koffi.decode(win.getNativeWindowHandle(), HWND);

  // The window behind the desktop icons. Progman is asked to make it (message 0x052C); before Windows 11 24H2 it is
  // a top-level WorkerW right after the one that holds the icons (SHELLDLL_DefView), from 24H2 on a WorkerW child
  // of Progman itself.
  function desktopLayer() {
    const progman = FindWindowW('Progman', null);
    if (!progman) return null;
    SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0, 1000, [0]);
    SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 1000, [0]);
    let layer = null;
    const cb = koffi.register((hwnd) => {
      if (FindWindowExW(hwnd, null, 'SHELLDLL_DefView', null)) {
        layer = FindWindowExW(null, hwnd, 'WorkerW', null);
        return false;
      }
      return true;
    }, koffi.pointer(EnumProc));
    try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
    return layer ?? FindWindowExW(progman, null, 'WorkerW', null) ?? progman;
  }

  return {
    // bounds: the screen in DIPs; scale: its scale factor. A child window is placed in physical pixels relative
    // to the virtual screen's top left, where the WorkerW window starts.
    toDesktop(win, on, bounds, scale = 1) {
      const hwnd = hwndOf(win);
      if (!on) { SetParent(hwnd, null); return; }
      const layer = desktopLayer();
      if (!layer) throw new Error('No desktop window found');
      SetParent(hwnd, layer);
      const vx = GetSystemMetrics(76), vy = GetSystemMetrics(77); // SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN
      SetWindowPos(hwnd, null, Math.round(bounds.x * scale) - vx, Math.round(bounds.y * scale) - vy,
        Math.round(bounds.width * scale), Math.round(bounds.height * scale), SWP_NOACTIVATE | SWP_SHOWWINDOW);
    },
    aboveDesktop() {},
    getPicture() {
      const buf = Buffer.alloc(520 * 2);
      if (!SystemParametersInfoW(SPI_GETDESKWALLPAPER, 520, buf, 0)) return null;
      const s = buf.toString('utf16le');
      const end = s.indexOf('\0');
      return (end < 0 ? s : s.slice(0, end)) || null;
    },
    setPicture(file) {
      const buf = Buffer.from(file + '\0', 'utf16le');
      if (!SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, buf, SPIF_UPDATEINIFILE | SPIF_SENDCHANGE)) throw new Error('Windows refused the picture');
    },
  };
}

let bindings = null, error = null;
if (koffi && (isMac || isWin)) {
  try { bindings = isMac ? macBindings() : winBindings(); } catch (e) { error = e; }
} else {
  error = new Error(koffi ? 'Not supported on this system' : 'koffi is not available');
}

module.exports = { available: !!bindings, error, ...(bindings ?? {}) };
