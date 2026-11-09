#!/bin/bash
# Downloads the MediaPipe Face Landmarker files the face tracking needs into vendor/mediapipe:
# the tasks-vision ES module and its WebAssembly runtime (npm, Apache-2.0) and Google's face model.
# Everything then runs locally; nothing is fetched at run time.
set -euo pipefail
cd "$(dirname "$0")"

VERSION=1.1.1   # the version LivLiv Player tested its tracking with
MODEL_URL=https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-$VERSION.tgz" -o "$tmp/pkg.tgz"
tar -xzf "$tmp/pkg.tgz" -C "$tmp"

rm -rf mediapipe
mkdir -p mediapipe/wasm
cp "$tmp/package/vision_bundle.mjs" mediapipe/
cp "$tmp/package/wasm/vision_wasm_internal.js" "$tmp/package/wasm/vision_wasm_internal.wasm" mediapipe/wasm/
cp "$tmp/package/LICENSE" mediapipe/LICENSE 2>/dev/null || true
curl -fsSL "$MODEL_URL" -o mediapipe/face_landmarker.task
echo "$VERSION" > mediapipe/VERSION
du -sh mediapipe/* mediapipe/wasm/*
