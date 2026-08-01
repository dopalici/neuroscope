#!/usr/bin/env bash
# Vendors the MediaPipe runtime and models into public/mediapipe.
#
# They are served from our own origin rather than a CDN for two reasons: the
# mirror works offline, and no third party gets a request every time somebody
# turns their camera on.
#
# Run after `npm install`, or whenever @mediapipe/tasks-vision is upgraded.
set -euo pipefail

cd "$(dirname "$0")/.."

WASM_SRC="node_modules/@mediapipe/tasks-vision/wasm"
WASM_DST="public/mediapipe/wasm"
MODELS="public/mediapipe/models"
BASE="https://storage.googleapis.com/mediapipe-models"

if [ ! -d "$WASM_SRC" ]; then
  echo "@mediapipe/tasks-vision is not installed — run npm install first." >&2
  exit 1
fi

mkdir -p "$WASM_DST" "$MODELS"

# Models only. The WASM loader/binary are pulled into the hand worker via Vite
# `?url` imports from node_modules — putting them under public/ breaks Vite
# dev, because a module worker's dynamic import() refuses public files.
curl -fsSL -o "$MODELS/hand_landmarker.task" \
  "$BASE/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
curl -fsSL -o "$MODELS/blaze_face_short_range.tflite" \
  "$BASE/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"

# Keep the wasm copies in sync for anything still pointing at /mediapipe/wasm,
# but they are not what the worker loads in dev/build.
cp "$WASM_SRC/vision_wasm_module_internal.js" "$WASM_DST/"
cp "$WASM_SRC/vision_wasm_module_internal.wasm" "$WASM_DST/"

echo "vendored:"
du -h "$MODELS"/* "$WASM_DST"/*
