# `.doll` 模型格式 v1

[English](FORMAT.md) | **简体中文**

一个 `.doll` 就是一个 UTF-8 JSON 文件，贴图以 PNG data URL 的形式内嵌，所以一个文件就是一个完整模型。坐标单位是原 PSD 画布的像素，原点在左上角，y 轴向下。

```jsonc
{
  "format": "doll",
  "version": 1,
  "generator": "Doll Studio",
  "width": 768, "height": 768,          // 画布尺寸
  "rig": { ... },                        // 见下文
  "physics": [ ... ],                    // 见下文
  "parts": [ ... ]                       // 绘制顺序：数组靠前的先画（在下面）
}
```

## parts

```jsonc
{
  "id": "p4",
  "name": "eyewhite·左",
  "role": "eye_white",        // 部件类型，决定它怎么动，见 src/roles.js
  "side": "L",                // "L" / "R"（画面左右）或 null
  "viseme": null,             // role 为 mouth_frame 时：这张嘴是 half / open / round(o/u) / wide(i/e) 哪种
  "src": "9:eyewhite",        // 来源图层（重新绑定用），可为 null
  "x": 323, "y": 182, "w": 40, "h": 30,   // 贴图在画布上的位置
  "box": { "x0": 325, "y0": 184, "x1": 361, "y1": 210 },  // 不透明像素的包围盒
  "depth": [0.02, 1],         // [基础深度, 球面凸起]，单位是头部半径
  "clip": null,               // 裁剪蒙版部件的 id（瞳孔只在眼白里显示）
  "opacity": 1,
  "visible": true,
  "texture": "data:image/png;base64,...",
  "mesh": {
    "pos": [x0, y0, x1, y1, ...],   // 静止时的顶点坐标（画布像素）
    "uv":  [u0, v0, ...],           // 0..1，对应 texture
    "idx": [a, b, c, ...]           // 三角形索引
  }
}
```

### 嘴型

`role: "mouth"` 是闭着的嘴（原图那条线）。`role: "mouth_frame"` 是张嘴时换上的整张嘴，每张一个 `viseme`。播放器按张嘴程度选 `half` / `open`，声音是 o/u 或 i/e 时换成 `round` / `wide`；一次只显示一张，显示时隐藏闭嘴那层。缺哪种就用最接近的一种代替。旧模型里的 `mouth_inner`（自动画的口腔）仍然可以播放，用的是拉伸闭嘴线的老办法。

PSD 里可以自己画嘴型：图层名带 `mouth` / `嘴` 加上 `half`、`open`、`round`、`wide`（或 `半`、`张`、`圆`、`扁`，或 `_a` `_i` `_u` `_e` `_o`），自动绑定会直接用。编辑器里打开「自动补画嘴型」时，缺的嘴型才会自动画；默认关闭，只用角色原画的嘴。

## rig

```jsonc
{
  "head":  { "cx": 364.5, "cy": 171, "r": 77.7 },   // 头部球心和半径
  "neck":  { "x": 364.5, "y": 245 },                // 歪头支点
  "turn":  0.5,                                     // 转头幅度：参数每 1° 对应的实际旋转角度
  "eyes":  { "L": { "cx": 333, "w": 44, "h": 31, "top": 184, "lidY": 204, "angle": 0 }, "R": { ... } },  // angle：闭眼线倾斜（弧度，可省略，默认 0）
  "mouth": { "cx": 383, "cy": 221.5, "w": 16, "h": 9, "y0": 217, "innerH": 10 },
  "body":  { "x0": 281, "y0": 224, "x1": 562, "y1": 698 }
}
```

## physics

```jsonc
{ "id": "hair_back", "label": "后发", "amp": 0.22, "k": 30, "c": 5, "gain": 1 }
```

每组是一个阻尼摆：`k` 是弹性，`c` 是阻尼，`gain` 是头部运动带动它的力度，`amp` 是最大摆幅（单位为头部半径）。部件通过自己的 `role` 归属到某一组。

## 参数

运行时参数（不存进文件）：`angleX` `angleY` `angleZ`（±30），`bodyX`（±10），`breath`、`eyeLOpen`、`eyeROpen`、`mouthOpen`（0..1），`eyeX`、`eyeY`、`browY`、`mouthForm`（±1）。

## 兼容规则

- 读取时如果 `version` 大于播放器支持的版本，应该拒绝并提示更新。
- 新增字段要保证旧播放器忽略后仍能正常显示。
