#!/bin/bash
# Builds DollPet.app (desktop pet + editor): copies the web app into Resources/web,
# compiles the Swift host for Apple silicon and Intel, and signs the app ad hoc.
# Pass a .doll or .psd to bundle it as the default model.
set -euo pipefail
cd "$(dirname "$0")"

APP=build/DollPet.app
DEFAULT_MODEL="${1:-../samples/seethrough.psd}"

rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

cp ../index.html ../player.html ../pet.html "$APP/Contents/Resources/web/"
cp -R ../src "$APP/Contents/Resources/web/src"
# room wallpapers (src/rooms.js) and the thumbnails their swatches show
mkdir -p "$APP/Contents/Resources/web/backgrounds" "$APP/Contents/Resources/thumbs"
for f in ../backgrounds/*.png; do
  [ -e "$f" ] || continue
  cp "$f" "$APP/Contents/Resources/web/backgrounds/"
  sips -Z 160 "$f" --out "$APP/Contents/Resources/thumbs/$(basename "$f")" >/dev/null
done
mkdir -p "$APP/Contents/Resources/web/brand"
cp ../brand/logo-mark.svg "$APP/Contents/Resources/web/brand/"
cp AppIcon.icns MenuBarIcon.png MenuBarIcon@2x.png "$APP/Contents/Resources/"
[ -f ../vendor/mediapipe/face_landmarker.task ] || ../vendor/fetch-mediapipe.sh
mkdir -p "$APP/Contents/Resources/web/vendor"
cp -R ../vendor/mediapipe "$APP/Contents/Resources/web/vendor/mediapipe"
cp -R ../THIRD_PARTY_NOTICES.md ../licenses "$APP/Contents/Resources/"
cp Info.plist "$APP/Contents/Info.plist"
# the permission prompts in English and Chinese (the rest of the interface switches in code, see Lang.swift)
cp -R en.lproj zh-Hans.lproj "$APP/Contents/Resources/"
if [ -f "$DEFAULT_MODEL" ]; then
  cp "$DEFAULT_MODEL" "$APP/Contents/Resources/default.${DEFAULT_MODEL##*.}"
fi

swiftc -O -swift-version 5 -target arm64-apple-macos13 -o build/DollPet-arm64 *.swift
swiftc -O -swift-version 5 -target x86_64-apple-macos13 -o build/DollPet-x86_64 *.swift
lipo -create -output "$APP/Contents/MacOS/DollPet" build/DollPet-arm64 build/DollPet-x86_64
rm build/DollPet-arm64 build/DollPet-x86_64

codesign --force --sign - "$APP"
echo "Built $(pwd)/$APP"
