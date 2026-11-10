#!/bin/bash
# Renders the SVGs in this folder into the icon files the desktop app (electron/) ships:
#   electron/build/icon.png                       app icon, 1024 px (electron-builder makes the .icns and .ico from it)
#   electron/assets/icon.png                      window icon, 256 px
#   electron/assets/tray.png, tray@2x.png         Windows tray icon (16 and 32 px)
#   electron/assets/trayTemplate.png, @2x.png     macOS menu bar template image (18 pt)
# Uses headless Google Chrome to rasterise (macOS has no SVG renderer on the command line), then sips to scale.
# Rerun after editing app-icon.svg or menubar-template.svg.
set -euo pipefail
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Google Chrome is needed to render the SVGs" >&2; exit 1; }
OUT=../electron
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT/build" "$OUT/assets"

# render <svg> <png>: draws the SVG at 1024x1024 on a transparent background
render() {
  printf '<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:1024px;height:1024px}</style><img src="%s">' \
    "file://$PWD/$1" > "$TMP/page.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size=1024,1024 \
    --screenshot="$2" "file://$TMP/page.html" >/dev/null 2>&1
}

render app-icon.svg "$OUT/build/icon.png"
sips -z 256 256 "$OUT/build/icon.png" --out "$OUT/assets/icon.png" >/dev/null
sips -z 16 16 "$OUT/build/icon.png" --out "$OUT/assets/tray.png" >/dev/null
sips -z 32 32 "$OUT/build/icon.png" --out "$OUT/assets/tray@2x.png" >/dev/null

render menubar-template.svg "$TMP/menubar.png"
sips -z 18 18 "$TMP/menubar.png" --out "$OUT/assets/trayTemplate.png" >/dev/null
sips -z 36 36 "$TMP/menubar.png" --out "$OUT/assets/trayTemplate@2x.png" >/dev/null

echo "Wrote the icons in $OUT/build and $OUT/assets"
