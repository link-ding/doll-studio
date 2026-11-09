// Room wallpapers: a painted 4K room brought to life without cutting it into layers. Two things move:
//   - WebGL warps small marked regions of the picture in place (things hanging sway, curtains ripple, sleeping
//     animals breathe, flowers and leaves stir in the wind). Each region fades out at its edges and the motion is only a few pixels, so nothing tears and
//     nothing behind has to be painted in.
//   - Light drawn over it: lamps glow, fairy lights twinkle, stars shoot past the window, clouds drift behind the
//     glass, petals fall outside, cups steam, sunlight on the floor shimmers, butterflies flutter, motes float. These are plain elements animating only opacity and transform, which the compositor runs.
// Coordinates are pixels of the 3840x2160 picture; the stage is scaled to cover the screen.

const W = 3840, H = 2160;

export const ROOMS = {
  moonroom: {
    name: 'Lavender Moon Room',
    image: 'backgrounds/lavender-moon-room.png',
    // [kind, x0, y0, x1, y1, amplitude px, speed rad/s, phase]: sway hangs from the top edge, ripple is a sway with
    // a wave running down (cloth), breathe stretches an ellipse up and down about its middle, wind stirs an ellipse
    // (leaves, flowers). Behind a window, wind gets one region per pane so the bars stay straight.
    warps: [
      ['sway', 1420, 130, 1580, 520, 9, 1.3, 0],        // crystal pendant under the crescent
      ['sway', 0, 0, 170, 420, 8, 1.1, 0.8],            // big star, top left
      ['sway', 560, 0, 790, 420, 10, 1.2, 2.1],         // star on a string, left
      ['sway', 490, 0, 610, 210, 6, 1.5, 1.2],          // small star, left
      ['sway', 1100, 0, 1240, 260, 8, 1.4, 3.0],        // star in the window
      ['sway', 2670, 0, 2830, 320, 10, 1.15, 0.4],      // stars hanging from the garland, right
      ['sway', 3380, 0, 3540, 320, 10, 1.25, 1.7],
      ['sway', 3470, 280, 3600, 500, 8, 1.6, 2.6],
      ['sway', 3720, 560, 3840, 1020, 10, 1.05, 0.9],
      ['ripple', 560, 790, 900, 1460, 7, 0.9, 0],       // curtains, below their tie-backs
      ['ripple', 2350, 790, 2700, 1460, 7, 0.85, 1.5],
      ['ripple', 3660, 560, 3840, 1180, 6, 0.8, 2.8],
      ['breathe', 60, 1470, 480, 1840, 6, 0.9, 0],      // white cat, bottom left
      ['breathe', 3380, 1200, 3800, 1540, 6, 0.85, 1.9], // grey cat, right
    ],
    // [x, y, radius, colour, seconds per pulse, flicker]
    glows: [
      [70, 260, 230, '255,226,160', 4.2], [670, 260, 200, '255,226,160', 3.6], [550, 110, 90, '255,232,180', 2.8],
      [1166, 150, 110, '255,232,180', 3.2], [190, 1060, 270, '255,200,120', 2.2, true], [410, 990, 250, '255,222,150', 3.8],
      [3260, 1400, 320, '255,218,150', 4.6], [2750, 200, 150, '255,226,160', 3.4], [3460, 200, 140, '255,226,160', 3.9],
      [3534, 410, 120, '255,226,160', 3.1], [3786, 930, 140, '255,226,160', 4.4], [430, 730, 110, '255,244,214', 2.6],
      [2100, 310, 240, '236,228,255', 6],
    ],
    // fairy-light bulbs, found in the picture
    bulbs: [[1734,18],[2809,38],[2463,34],[2147,51],[1706,36],[3001,42],[1233,55],[1677,50],[3515,53],[2836,59],
      [2578,68],[2421,72],[1399,64],[2951,73],[2190,84],[1283,75],[1321,81],[1354,77],[2924,95],[3325,96],[3444,100],
      [2528,98],[2384,95],[2224,110],[2867,108],[2260,113],[2319,121],[2966,126],[2298,121],[3276,125],[3573,135],
      [3425,130],[3008,138],[3236,143],[2831,146],[3593,168],[3049,153],[2965,155],[3187,158],[3090,163],[3158,163],
      [2493,171],[2542,194],[3626,197],[2999,204],[2627,208],[2590,206],[3370,211],[3665,225],[3705,244],[3032,243],
      [3743,258],[3833,262],[3333,248],[3785,266],[3087,285],[3282,285],[3134,306],[3239,306],[3190,311]],
    // window panes (x0, y0, x1, y1): shooting stars cross the upper ones, clouds drift behind the lower ones
    sky: [[1400, 60, 1900, 590], [1924, 40, 2270, 590]],
    clouds: [[1420, 620, 1900, 860], [1924, 620, 2270, 840]],
    // where motes float
    air: [500, 600, 3400, 1900],
  },

  tearoom: {
    name: 'Mint Tea Room',
    image: 'backgrounds/mint-tea-room.png',
    warps: [
      ['sway', 860, 40, 1120, 600, 6, 0.9, 0],          // vines round the window
      ['sway', 2200, 0, 2600, 660, 6, 0.8, 1.3],
      ['sway', 2620, 100, 2820, 720, 6, 0.95, 2.2],     // vine under the shelf
      ['sway', 3660, 0, 3840, 620, 6, 1.0, 0.7],
      ['sway', 0, 0, 260, 1500, 5, 0.7, 1.8],           // ivy down the dresser
      ['ripple', 920, 700, 1160, 1200, 6, 0.8, 0],      // curtains below their bows
      ['ripple', 2380, 700, 2600, 1200, 6, 0.75, 1.4],
      ['wind', 1225, 130, 1455, 370, 2.5, 0.9, 2],      // the garden, pane by pane: leaves at the top left,
      ['wind', 1225, 400, 1455, 720, 3, 1.1, 0],        // the rose arch,
      ['wind', 1490, 400, 1770, 720, 3, 1.0, 0.6],
      ['wind', 1225, 760, 1455, 920, 3, 1.2, 1],        // flowers along the fence
      ['wind', 1490, 760, 1770, 920, 3, 1.3, 1.8],
      ['wind', 1810, 760, 2110, 920, 3, 1.1, 2.4],
      ['wind', 2150, 760, 2360, 920, 3, 1.2, 0.3],
      ['wind', 500, 760, 820, 960, 3, 1.3, 0.5],        // daisies in the room
      ['wind', 760, 1260, 1040, 1420, 3, 1.4, 1.1],
      ['wind', 0, 1500, 400, 1900, 4, 1.0, 2.4],
      ['wind', 3600, 920, 3840, 1220, 3, 1.2, 0.3],
    ],
    glows: [[3210, 130, 230, '255,206,130', 2.4, true]],
    clouds: [[1500, 200, 2130, 440]], cloudColor: '255,255,255', cloudAlpha: 0.55,
    sun: [[2800, 700, 180, 260], [3150, 600, 160, 240], [3500, 800, 170, 260], [2950, 1050, 150, 200],
      [900, 1640, 260, 60], [1500, 1620, 300, 60], [2100, 1640, 280, 60], [2700, 1650, 240, 60], [3100, 1600, 200, 50]],
    steam: [[3560, 1275]],
    butterflies: [[1350, 760, '#FFF3B0'], [2050, 820, '#FFC9D6']],
    air: [1000, 700, 3400, 1700], moteColor: '255,250,230',
  },

  catcafe: {
    name: 'Peach Cat Cafe',
    image: 'backgrounds/peach-cat-cafe.png',
    warps: [
      ['sway', 980, 0, 1320, 320, 6, 1.0, 0],           // hanging lamps
      ['sway', 2340, 0, 2680, 320, 6, 0.95, 1.6],
      ['sway', 0, 0, 520, 780, 5, 0.8, 0.4],            // plants and vines hanging from the top
      ['sway', 1300, 0, 1420, 340, 6, 1.1, 2.0],
      ['sway', 2680, 0, 3020, 320, 5, 0.9, 1.0],
      ['sway', 3680, 0, 3840, 460, 6, 0.85, 2.7],
      ['sway', 2820, 720, 2950, 1110, 5, 1.0, 0.6],     // vine on the cat tree
      ['ripple', 1010, 780, 1250, 1090, 6, 0.8, 0.2],   // curtains below their bows
      ['ripple', 2370, 780, 2590, 1060, 6, 0.75, 1.7],
      ['wind', 1270, 450, 1385, 675, 3, 1.0, 0],        // cherry trees outside, pane by pane
      ['wind', 1420, 450, 1625, 675, 3, 1.1, 0.7],
      ['wind', 1970, 450, 2195, 675, 3, 1.0, 1.3],
      ['wind', 2225, 450, 2345, 675, 3, 1.1, 2.0],
      ['wind', 1270, 830, 1385, 985, 2, 1.3, 0.8],      // window boxes
      ['wind', 1420, 830, 1625, 985, 2, 1.2, 1.5],
      ['wind', 1970, 830, 2195, 985, 2, 1.3, 2.2],
      ['wind', 2225, 830, 2345, 985, 2, 1.2, 2.9],
      ['wind', 780, 770, 1010, 970, 3, 1.2, 2.1],       // flowers in the room
      ['wind', 0, 1180, 260, 1430, 3, 1.3, 1.5],
      ['wind', 3570, 1300, 3840, 1620, 3, 1.2, 2.6],
      ['breathe', 2540, 450, 2850, 610, 5, 0.9, 0],     // cats asleep
      ['breathe', 2720, 1230, 2970, 1440, 5, 0.85, 1.2],
      ['breathe', 3350, 1120, 3590, 1310, 5, 0.95, 2.3],
      ['breathe', 400, 1360, 720, 1680, 5, 0.9, 0.7],
    ],
    glows: [[1150, 250, 300, '255,214,140', 4.5], [2510, 250, 300, '255,214,140', 5.2], [536, 520, 170, '255,214,140', 3.8],
      [110, 450, 140, '255,214,140', 4.2]],
    petals: [[1270, 440, 2360, 840, 14, ['#FFD3E0', '#F7A8C4']]],
    steam: [[320, 760], [420, 760]],
    sun: [[1200, 1450, 220, 50], [1600, 1440, 240, 50], [2000, 1450, 240, 50], [2400, 1460, 220, 50],
      [3100, 500, 180, 300], [3500, 700, 160, 280]],
    air: [1000, 800, 3200, 1700],
  },

  berryroom: {
    name: 'Strawberry Bedroom',
    image: 'backgrounds/strawberry-bedroom.png',
    warps: [
      ['sway', 2260, 0, 2580, 380, 6, 0.9, 0],          // ceiling lamp
      ['sway', 0, 0, 420, 640, 5, 0.8, 1.2],            // vines
      ['sway', 830, 320, 990, 720, 5, 1.0, 2.0],
      ['sway', 2800, 150, 3130, 880, 5, 0.85, 0.6],
      ['ripple', 930, 720, 1210, 1230, 6, 0.8, 0],      // curtains below their bows
      ['ripple', 2030, 700, 2330, 1240, 6, 0.75, 1.5],
      ['ripple', 0, 200, 820, 1140, 5, 0.6, 2.4],       // the bed's canopy
      ['wind', 1250, 300, 1390, 960, 3, 1.0, 0],        // leaves outside, pane by pane
      ['wind', 1420, 300, 1590, 960, 3, 1.1, 0.8],
      ['wind', 1630, 300, 1790, 960, 3, 1.0, 1.6],
      ['wind', 1830, 300, 2000, 960, 3, 1.1, 2.4],
      ['wind', 1140, 790, 1520, 1020, 3, 1.3, 0.9],     // flowers
      ['wind', 2420, 770, 2620, 970, 3, 1.2, 1.7],
      ['wind', 0, 1740, 420, 2160, 5, 1.0, 0.4],
      ['wind', 3340, 1540, 3840, 2160, 5, 0.9, 2.2],
      ['breathe', 20, 1480, 430, 1890, 5, 0.85, 0.3],   // the bunnies
      ['breathe', 3510, 1270, 3810, 1650, 5, 0.9, 1.4],
    ],
    glows: [[2420, 250, 280, '255,226,170', 4.8], [2370, 560, 180, '255,206,130', 2.3, true], [1620, 560, 520, '255,250,232', 7]],
    sun: [[1000, 1500, 200, 50], [1400, 1480, 260, 60], [1900, 1500, 260, 60], [2300, 1520, 200, 50], [1200, 1600, 220, 50],
      [1700, 1620, 260, 50], [1600, 1150, 180, 250], [1900, 1200, 160, 260]],
    butterflies: [[1500, 420, '#FFFFFF']],
    air: [900, 700, 3000, 1700], moteColor: '255,240,235',
  },
};

const VS = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Each pixel samples the picture a little to one side when it lies in a moving region.
const FS = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform int uCount;
uniform vec4 uRect[24];
uniform vec4 uParam[24]; // kind (0 sway, 1 ripple, 2 breathe, 3 wind), amplitude, speed, phase
varying vec2 vUV;
void main() {
  vec2 p = vUV * uSize;
  vec2 d = vec2(0.0);
  for (int i = 0; i < 24; i++) {
    if (i >= uCount) break;
    vec4 r = uRect[i];
    vec4 q = uParam[i];
    vec2 u = (p - r.xy) / (r.zw - r.xy);
    if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0) continue;
    if (q.x < 1.5) {
      // fixed at the top, swinging more further down; fades out at the sides and the bottom
      float w = smoothstep(0.0, 0.25, u.x) * (1.0 - smoothstep(0.75, 1.0, u.x)) * (1.0 - smoothstep(0.85, 1.0, u.y));
      float wave = q.x < 0.5 ? 0.0 : u.y * 3.0;
      d.x += q.y * sin(uTime * q.z + q.w - wave) * u.y * w;
    } else if (q.x < 2.5) {
      vec2 c = u * 2.0 - 1.0;
      float w = 1.0 - smoothstep(0.5, 1.0, length(c));
      d.y += q.y * sin(uTime * q.z + q.w) * c.y * w;
    } else {
      // leaves and flowers stirring: a sideways wobble that varies across the region, fading out at its edge
      vec2 c = u * 2.0 - 1.0;
      float w = 1.0 - smoothstep(0.55, 1.0, length(c));
      d.x += q.y * sin(uTime * q.z + q.w + p.y * 0.012 + p.x * 0.004) * w;
      d.y += q.y * 0.4 * sin(uTime * q.z * 1.3 + q.w + p.x * 0.01) * w;
    }
  }
  gl_FragColor = texture2D(uTex, (p - d) / uSize);
}`;

function program(gl) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const CSS = `
.room{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;overflow:hidden}
.room canvas{position:absolute;inset:0;width:${W}px;height:${H}px}
.room .fx{position:absolute;border-radius:50%;pointer-events:none;will-change:opacity,transform}
.room .clip{position:absolute;overflow:hidden}
.room.paused *{animation-play-state:paused !important}
@keyframes room-pulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes room-flicker{0%,100%{opacity:.8}12%{opacity:.6}20%{opacity:.95}35%{opacity:.7}52%{opacity:1}70%{opacity:.75}85%{opacity:.9}}
@keyframes room-twinkle{0%,100%{opacity:.15;transform:scale(.7)}50%{opacity:1;transform:scale(1.15)}}
@keyframes room-shoot{0%,86%{opacity:0;transform:translate(0,0) rotate(-28deg)}88%{opacity:1}100%{opacity:0;transform:translate(-520px,280px) rotate(-28deg)}}
@keyframes room-drift{from{transform:translateX(0)}to{transform:translateX(-900px)}}
@keyframes room-mote{0%{opacity:0;transform:translate(0,0)}15%{opacity:.9}85%{opacity:.7}100%{opacity:0;transform:translate(60px,-320px)}}
@keyframes room-fall{from{transform:translate(0,0)}to{transform:translate(var(--dx),var(--dy))}}
@keyframes room-flutter{0%,100%{transform:rotate(0deg) scaleX(1)}25%{transform:rotate(70deg) scaleX(.5)}50%{transform:rotate(160deg) scaleX(1)}75%{transform:rotate(250deg) scaleX(.4)}}
@keyframes room-steam{0%{opacity:0;transform:translate(0,0) scale(.5)}25%{opacity:.75}100%{opacity:0;transform:translate(var(--sx),-190px) scale(1.5)}}
@keyframes room-dapple{0%,100%{opacity:.08}50%{opacity:.6}}
@keyframes room-fly-a{0%{transform:translate(0,0)}20%{transform:translate(180px,-90px)}40%{transform:translate(360px,30px)}60%{transform:translate(250px,170px)}80%{transform:translate(80px,110px)}100%{transform:translate(0,0)}}
@keyframes room-fly-b{0%{transform:translate(0,0)}25%{transform:translate(-160px,80px)}50%{transform:translate(-320px,-40px)}75%{transform:translate(-120px,-130px)}100%{transform:translate(0,0)}}
@keyframes room-flap{from{transform:scaleX(1)}to{transform:scaleX(.25)}}
@media (prefers-reduced-motion: reduce){.room *{animation:none !important}}`;

// a pseudo-random sequence, so a room looks the same every time
function rng(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function lights(def) {
  const rand = rng(7);
  const glow = ([x, y, r, c, s, flicker]) => `<div class="fx" style="left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px;`
    + `background:radial-gradient(circle,rgba(${c},.55) 0%,rgba(${c},.22) 35%,rgba(${c},0) 70%);`
    + `animation:${flicker ? 'room-flicker' : 'room-pulse'} ${s}s ease-in-out ${(-rand() * s).toFixed(2)}s infinite"></div>`;
  const bulb = ([x, y]) => {
    const r = 26, s = 1.6 + rand() * 2.2;
    return `<div class="fx" style="left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px;`
      + `background:radial-gradient(circle,rgba(255,250,225,.95) 0%,rgba(255,226,150,.5) 30%,rgba(255,226,150,0) 70%);`
      + `animation:room-twinkle ${s.toFixed(2)}s ease-in-out ${(-rand() * s).toFixed(2)}s infinite"></div>`;
  };
  // a streak with a bright head, starting top right of the pane; each pane gets one every so often
  const shooting = ([x0, y0, x1, y1], i) => `<div class="clip" style="left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px">`
    + `<div class="fx" style="border-radius:3px;left:${x1 - x0 - 120}px;top:${40 + i * 90}px;width:240px;height:5px;`
    + `background:linear-gradient(90deg,rgba(255,255,255,1),rgba(220,210,255,.6) 30%,rgba(220,210,255,0));`
    + `animation:room-shoot ${9 + i * 4}s linear ${-(i * 5)}s infinite"></div></div>`;
  const clouds = ([x0, y0, x1, y1], i) => {
    const w = x1 - x0, h = y1 - y0;
    let blobs = '';
    for (let k = 0; k < 4; k++) {
      const bw = 260 + rand() * 220, bh = 70 + rand() * 60, bx = k * 330 + rand() * 120, by = rand() * (h - bh);
      blobs += `<div class="fx" style="left:${bx.toFixed(0)}px;top:${by.toFixed(0)}px;width:${bw.toFixed(0)}px;height:${bh.toFixed(0)}px;`
        + `background:radial-gradient(ellipse,rgba(${def.cloudColor ?? '236,230,255'},${def.cloudAlpha ?? 0.42}) 0%,rgba(${def.cloudColor ?? '236,230,255'},0) 70%)"></div>`;
    }
    // two copies side by side, so the drift loops without a jump
    return `<div class="clip" style="left:${x0}px;top:${y0}px;width:${w}px;height:${h}px">`
      + `<div style="position:absolute;left:0;top:0;width:1800px;height:${h}px;animation:room-drift ${70 + i * 25}s linear infinite">`
      + `<div style="position:absolute;left:0;top:0;width:900px;height:${h}px">${blobs}</div>`
      + `<div style="position:absolute;left:900px;top:0;width:900px;height:${h}px">${blobs}</div></div></div>`;
  };
  // petals falling through a clip box (a window), drifting left
  const petals = ([x0, y0, x1, y1, n, c]) => {
    const w = x1 - x0, h = y1 - y0;
    let out = '';
    for (let i = 0; i < n; i++) {
      const x = rand() * (w + 260), s = 8 + rand() * 7, size = 14 + rand() * 10;
      out += `<div style="position:absolute;left:${x.toFixed(0)}px;top:-40px;--dx:-${(160 + rand() * 160).toFixed(0)}px;--dy:${h + 80}px;`
        + `animation:room-fall ${s.toFixed(1)}s linear ${(-rand() * s).toFixed(1)}s infinite;will-change:transform">`
        + `<div class="fx" style="position:relative;width:${size.toFixed(0)}px;height:${(size * 0.7).toFixed(0)}px;border-radius:70% 0 70% 0;`
        + `background:linear-gradient(135deg,${c[0]},${c[1]});animation:room-flutter ${(2.4 + rand() * 2).toFixed(1)}s linear infinite"></div></div>`;
    }
    return `<div class="clip" style="left:${x0}px;top:${y0}px;width:${w}px;height:${h}px">${out}</div>`;
  };
  // wisps rising from a cup
  const steam = ([x, y]) => [0, 1, 2].map(k => `<div class="fx" style="left:${x - 34 + k * 14}px;top:${y - 70}px;width:68px;height:110px;--sx:${k % 2 ? 18 : -14}px;`
    + `background:radial-gradient(ellipse,rgba(255,255,255,.7),rgba(255,255,255,0) 68%);animation:room-steam 4.5s ease-out ${(-k * 1.5).toFixed(1)}s infinite"></div>`).join('');
  // sunlight on the floor and walls brightening and dimming, as if through moving leaves
  const sun = ([x, y, rx, ry]) => {
    const s = 5 + rand() * 4;
    return `<div class="fx" style="left:${x - rx}px;top:${y - ry}px;width:${rx * 2}px;height:${ry * 2}px;`
      + `background:radial-gradient(ellipse,rgba(255,248,222,.85),rgba(255,244,210,0) 70%);`
      + `animation:room-dapple ${s.toFixed(1)}s ease-in-out ${(-rand() * s).toFixed(1)}s infinite"></div>`;
  };
  // a butterfly looping round a box
  const butterfly = ([x, y, c], i) => {
    const wing = side => `<div style="position:absolute;top:0;${side}:0;width:20px;height:26px;border-radius:${side === 'left' ? '80% 20% 60% 40%' : '20% 80% 40% 60%'};background:${c};opacity:.92"></div>`;
    return `<div style="position:absolute;left:${x}px;top:${y}px;animation:room-fly-${i % 2 ? 'b' : 'a'} ${16 + i * 5}s ease-in-out infinite;will-change:transform">`
      + `<div style="position:relative;width:40px;height:26px;animation:room-flap .22s ease-in-out infinite alternate;will-change:transform">${wing('left')}${wing('right')}`
      + '<div style="position:absolute;left:18px;top:4px;width:4px;height:20px;border-radius:2px;background:#6B5A4A"></div></div></div>';
  };
  const motes = () => {
    if (!def.air) return '';
    const [x0, y0, x1, y1] = def.air;
    let out = '';
    for (let i = 0; i < 18; i++) {
      const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0), r = 5 + rand() * 7, s = 9 + rand() * 9;
      out += `<div class="fx" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;width:${(r * 2).toFixed(0)}px;height:${(r * 2).toFixed(0)}px;`
        + `background:radial-gradient(circle,rgba(${def.moteColor ?? '255,248,225'},.95),rgba(${def.moteColor ?? '255,240,200'},0) 70%);`
        + `animation:room-mote ${s.toFixed(1)}s ease-in-out ${(-rand() * s).toFixed(1)}s infinite"></div>`;
    }
    return out;
  };
  const all = (list, f) => (list ?? []).map(f).join('');
  return all(def.clouds, clouds) + all(def.sky, shooting) + all(def.petals, petals) + all(def.sun, sun)
    + all(def.glows, glow) + all(def.bulbs, bulb) + all(def.steam, steam) + all(def.butterflies, butterfly) + motes();
}

// Shows a room in `container` (which fills the window). limit: { fps, paused } as in startPlayer, read every frame.
export function startRoom(container, id, limit) {
  const def = ROOMS[id];
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'room';
  const canvas = document.createElement('canvas');
  root.append(canvas);
  root.insertAdjacentHTML('beforeend', lights(def));
  container.append(style, root);

  // cover the window, centred
  let scale = 1;
  const fit = () => {
    const vw = container.clientWidth || innerWidth, vh = container.clientHeight || innerHeight;
    scale = Math.max(vw / W, vh / H);
    root.style.transform = `translate(${((vw - W * scale) / 2).toFixed(1)}px,${((vh - H * scale) / 2).toFixed(1)}px) scale(${scale})`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
  };
  fit();
  addEventListener('resize', fit);

  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false }) || canvas.getContext('webgl', { alpha: false, antialias: false });
  let raf = 0, ready = false, stopped = false, last = 0;
  const prog = program(gl);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const loc = n => gl.getUniformLocation(prog, n);
  const rects = new Float32Array(96), params = new Float32Array(96);
  const kinds = { sway: 0, ripple: 1, breathe: 2, wind: 3 };
  def.warps.slice(0, 24).forEach(([k, x0, y0, x1, y1, amp, speed, phase], i) => {
    rects.set([x0, y0, x1, y1], i * 4);
    params.set([kinds[k], amp, speed, phase], i * 4);
  });
  gl.uniform2f(loc('uSize'), W, H);
  gl.uniform1i(loc('uCount'), Math.min(24, def.warps.length));
  gl.uniform4fv(loc('uRect[0]'), rects);
  gl.uniform4fv(loc('uParam[0]'), params);
  gl.uniform1i(loc('uTex'), 0);
  const uTime = loc('uTime');

  // The picture is uploaded at the size it is shown (scaled down once, smoothly), not at 4K: a 1920x1080 screen then
  // holds an 8 MB texture instead of a 4K one with mipmaps, and the decoded 4K image is let go. A bigger screen
  // later loads it again at that size.
  const tex = gl.createTexture();
  let texSize = 0;
  const upload = async () => {
    const want = canvas.width;
    if (want <= texSize) return;
    texSize = want;
    const img = new Image();
    img.src = def.image;
    await img.decode();
    if (stopped) return;
    let source = img;
    if (canvas.width < W) {
      source = document.createElement('canvas');
      source.width = canvas.width;
      source.height = canvas.height;
      const g = source.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, source.width, source.height);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (source !== img) source.width = source.height = 0;
    img.src = '';
    ready = true;
  };
  upload();
  addEventListener('resize', upload);

  const frame = now => {
    raf = requestAnimationFrame(frame);
    if (!ready || limit?.paused) return;
    if (limit?.fps && now - last < 1000 / limit.fps - 4) return;
    last = now;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now / 1000) % 3600);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  raf = requestAnimationFrame(frame);

  return {
    root,
    pause(on) { root.classList.toggle('paused', !!on); },
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      removeEventListener('resize', fit);
      removeEventListener('resize', upload);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      root.remove();
      style.remove();
    },
  };
}
