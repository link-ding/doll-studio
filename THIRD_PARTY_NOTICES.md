# Third-party notices

Doll Studio includes code adapted from, and files distributed with, the projects below. Both are under the Apache
License 2.0; its full text is in [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt).

## LivLiv Player

<https://github.com/livliv-dev/player>, Apache License 2.0. Its NOTICE file reads:

> LivLiv Player
> Copyright 2026 LivLiv
>
> This product includes software developed by LivLiv (https://livliv.ai).

Adapted into Doll Studio (each file's header says what was changed):

| Doll Studio | adapted from |
|---|---|
| `src/idle.js` | `src/runtime/idle.ts` |
| `src/voice.js` | `src/runtime/voice.ts`, `src/runtime/vowel.ts` |
| `src/tracking.js` | `src/runtime/tracking.ts`, `src/runtime/filters.ts`, the blendshape and landmark lists of `src/runtime/trace.ts` |

LivLiv's featured characters and the LivLiv name and logos are not part of this and are not included.

## MediaPipe Tasks Vision

`vendor/mediapipe/` (fetched by `vendor/fetch-mediapipe.sh`): the `@mediapipe/tasks-vision` package, version in
`vendor/mediapipe/VERSION`, Copyright Google LLC, Apache License 2.0; and Google's Face Landmarker model
(`face_landmarker.task`, from `storage.googleapis.com/mediapipe-models`). Both run locally; nothing is sent anywhere.
