#!/bin/bash
# Renders the SVGs in this folder into the icon files the Mac app ships:
#   desktop-pet/AppIcon.icns                          app icon (Finder, Dock, Cmd-Tab)
#   desktop-pet/MenuBarIcon.png, MenuBarIcon@2x.png   menu bar template image (18 pt)
# Uses headless Google Chrome to rasterise (macOS has no SVG renderer on the command line),
# then sips to scale and iconutil to pack. Rerun after editing app-icon.svg or menubar-template.svg.
set -euo pipefail
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Google Chrome is needed to render the SVGs" >&2; exit 1; }
OUT=../desktop-pet
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# render <svg> <png>: draws the SVG at 1024x1024 on a transparent background
render() {
  printf '<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:1024px;height:1024px}</style><img src="%s">' \
    "file://$PWD/$1" > "$TMP/page.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size=1024,1024 \
    --screenshot="$2" "file://$TMP/page.html" >/dev/null 2>&1
}

render app-icon.svg "$TMP/icon.png"
ICONSET="$TMP/AppIcon.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$TMP/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$TMP/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT/AppIcon.icns"

render menubar-template.svg "$TMP/menubar.png"
sips -z 18 18 "$TMP/menubar.png" --out "$OUT/MenuBarIcon.png" >/dev/null
sips -z 36 36 "$TMP/menubar.png" --out "$OUT/MenuBarIcon@2x.png" >/dev/null

echo "Wrote $OUT/AppIcon.icns and $OUT/MenuBarIcon{,@2x}.png"
