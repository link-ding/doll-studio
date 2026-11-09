# `.doll` model format v1

**English** | [简体中文](FORMAT.zh-CN.md)

A `.doll` is a single UTF-8 JSON file with its textures embedded as PNG data URLs, so one file is a complete model. Coordinates are in pixels of the original PSD canvas, with the origin at the top left and y pointing down.

```jsonc
{
  "format": "doll",
  "version": 1,
  "generator": "Doll Studio",
  "width": 768, "height": 768,          // canvas size
  "rig": { ... },                        // see below
  "physics": [ ... ],                    // see below
  "parts": [ ... ]                       // draw order: earlier in the array is drawn first (underneath)
}
```

## parts

```jsonc
{
  "id": "p4",
  "name": "eyewhite·左",
  "role": "eye_white",        // part type, decides how it moves, see src/roles.js
  "side": "L",                // "L" / "R" (screen left / right) or null
  "viseme": null,             // for role mouth_frame: which mouth this is, half / open / round (o/u) / wide (i/e)
  "src": "9:eyewhite",        // source layer (for re-rigging), may be null
  "x": 323, "y": 182, "w": 40, "h": 30,   // where the texture sits on the canvas
  "box": { "x0": 325, "y0": 184, "x1": 361, "y1": 210 },  // bounding box of the opaque pixels
  "depth": [0.02, 1],         // [base depth, spherical bulge], in head radii
  "clip": null,               // id of the part that clips this one (pupils show only inside the eye white)
  "opacity": 1,
  "visible": true,
  "texture": "data:image/png;base64,...",
  "mesh": {
    "pos": [x0, y0, x1, y1, ...],   // vertex positions at rest (canvas pixels)
    "uv":  [u0, v0, ...],           // 0..1, into texture
    "idx": [a, b, c, ...]           // triangle indices
  }
}
```

### Mouth shapes

`role: "mouth"` is the closed mouth (the line in the original art). `role: "mouth_frame"` is a whole mouth swapped in while open, one per `viseme`. The player picks `half` / `open` by how far the mouth is open, and switches to `round` / `wide` when the sound is o/u or i/e; only one shows at a time, and the closed mouth is hidden while it does. A missing shape is stood in for by the closest one. The `mouth_inner` of older models (an auto-drawn mouth interior) still plays, using the old way of stretching the closed mouth line.

You can draw mouth shapes in the PSD yourself: a layer name with `mouth` / `嘴` plus `half`, `open`, `round`, `wide` (or `半`, `张`, `圆`, `扁`, or `_a` `_i` `_u` `_e` `_o`) is used directly by the auto rig. Missing shapes are drawn automatically only when **Generate mouth shapes** is on in the editor; it is off by default, which uses just the character's original mouth.

## rig

```jsonc
{
  "head":  { "cx": 364.5, "cy": 171, "r": 77.7 },   // head sphere centre and radius
  "neck":  { "x": 364.5, "y": 245 },                // pivot for head tilt
  "turn":  0.5,                                     // head-turn amount: actual rotation per 1° of the parameter
  "eyes":  { "L": { "cx": 333, "w": 44, "h": 31, "top": 184, "lidY": 204, "angle": 0 }, "R": { ... } },  // angle: eyelid line tilt (radians, optional, default 0)
  "mouth": { "cx": 383, "cy": 221.5, "w": 16, "h": 9, "y0": 217, "innerH": 10 },
  "body":  { "x0": 281, "y0": 224, "x1": 562, "y1": 698 }
}
```

## physics

```jsonc
{ "id": "hair_back", "label": "Back hair", "amp": 0.22, "k": 30, "c": 5, "gain": 1 }
```

Each group is a damped pendulum: `k` is stiffness, `c` damping, `gain` how strongly head motion drives it, and `amp` the largest swing (in head radii). A part belongs to a group through its `role`. The editor shows each group's name from its `id` in the current interface language; `label` is kept for other readers.

## Parameters

Runtime parameters (not stored in the file): `angleX` `angleY` `angleZ` (±30), `bodyX` (±10), `breath`, `eyeLOpen`, `eyeROpen`, `mouthOpen` (0..1), `eyeX`, `eyeY`, `browY`, `mouthForm` (±1).

## Compatibility

- When reading, a `version` higher than the player supports should be refused with a prompt to update.
- New fields must be such that an older player that ignores them still shows the model correctly.
