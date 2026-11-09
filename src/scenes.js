// Wallpaper scenes: animated backgrounds drawn behind the character in wallpaper mode (pet.js), and drawn still as
// the system desktop picture. Each is one SVG on a 1920x1080 stage that covers the screen (centred, cropped), built
// only from shapes, patterns and CSS animations, so it scales to any screen and can be rasterised (no
// foreignObject, no images). Designed on the "DollPet Wallpaper Backgrounds" canvas as the Gingham Lace family.

const STAGE = 'viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice"';

// a two-way check: stripes of `size` px in `color`, crossing on `base`; `rotate` turns it (45 = diagonal)
const gingham = (id, size, base, color, opacity, rotate = 0) => `
<pattern id="${id}" width="${size * 2}" height="${size * 2}" patternUnits="userSpaceOnUse"${rotate ? ` patternTransform="rotate(${rotate})"` : ''}>
<rect width="${size * 2}" height="${size * 2}" fill="${base}"/>
<rect width="${size}" height="${size * 2}" fill="${color}" fill-opacity="${opacity}"/>
<rect width="${size * 2}" height="${size}" fill="${color}" fill-opacity="${opacity}"/>
</pattern>`;

// a lace trim along the top (scallops hanging down) or bottom (scallops rising) edge, with a row of eyelets
function lace(id, edge, color, eyelet, band = 32, r = 30) {
  const step = r * 2;
  if (edge === 'top') return `
<defs><pattern id="${id}" width="${step}" height="${band + r + 4}" patternUnits="userSpaceOnUse"><circle cx="${r}" cy="${band}" r="${r}" fill="${color}"/>${eyelet ? `<circle cx="${r}" cy="${band + 12}" r="5" fill="${eyelet}"/>` : ''}</pattern></defs>
<rect width="1920" height="${band}" fill="${color}"/><rect width="1920" height="${band + r + 4}" fill="url(#${id})"/>`;
  return `
<defs><pattern id="${id}" width="${step}" height="${r + 20}" patternUnits="userSpaceOnUse" y="${1080 - r - 20}"><circle cx="${r}" cy="${r + 16}" r="${r}" fill="${color}"/>${eyelet ? `<circle cx="${r}" cy="${r + 2}" r="5" fill="${eyelet}"/>` : ''}</pattern></defs>
<rect y="${1080 - r - 20}" width="1920" height="${r + 20}" fill="url(#${id})"/><rect y="1066" width="1920" height="14" fill="${color}"/>`;
}

const bow = (loop = '#F49AC1', tail = '#E57AA8', knot = '#D9628F') => `
<path d="M0 0 C -60 -50, -120 -20, -110 30 C -100 70, -40 40, 0 0 Z" fill="${loop}"/>
<path d="M0 0 C 60 -50, 120 -20, 110 30 C 100 70, 40 40, 0 0 Z" fill="${loop}"/>
<path d="M-6 6 C -30 60, -50 110, -70 150 L -48 152 C -28 112, -12 62, 4 10 Z" fill="${tail}"/>
<path d="M6 6 C 30 60, 50 110, 70 150 L 48 152 C 28 112, 12 62, -4 10 Z" fill="${tail}"/>
<circle cx="0" cy="2" r="16" fill="${knot}"/>`;
const HEART = 'M0 -6 C -10 -22 -34 -12 -26 8 C -20 22 0 34 0 34 C 0 34 20 22 26 8 C 34 -12 10 -22 0 -6 Z';
const STAR5 = 'M0 -22 L5.9 -8.1 L20.9 -6.8 L9.5 3.1 L12.9 17.8 L0 10 L-12.9 17.8 L-9.5 3.1 L-20.9 -6.8 L-5.9 -8.1 Z';
const sparkle = s => `M0 ${-s} L${s / 4} ${-s / 4} L${s} 0 L${s / 4} ${s / 4} L0 ${s} L${-s / 4} ${s / 4} L${-s} 0 L${-s / 4} ${-s / 4} Z`;
// an element animated around its own box: `origin` as CSS (e.g. "50% 0%" swings from the top)
const anim = (a, origin = '50% 50%') => `style="animation: ${a}; transform-box: fill-box; transform-origin: ${origin};"`;

const SCENES = {
  ribbon: {
    name: 'Ribbon Breeze',
    css: `
@keyframes rb-sway{0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(18px) rotate(-1.2deg)}}
@keyframes rb-shimmer{to{stroke-dashoffset:-480}}
@keyframes rb-bow{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
@keyframes rb-twinkle{0%,100%{transform:scale(0.55);opacity:0.35}50%{transform:scale(1);opacity:1}}`,
    body: () => {
      const ribbon = 'M-40 780 C 180 650, 300 430, 560 440 C 820 450, 900 630, 1160 570 C 1420 510, 1520 270, 1960 250';
      const sparkles = [[560, 220, 18, '#F4A8C8', 3.2, 0], [120, 520, 14, '#F4A8C8', 2.6, -1], [980, 160, 16, '#F4A8C8', 3.8, -2],
        [420, 620, 12, '#B3A2EA', 2.9, -0.6], [1340, 120, 14, '#B3A2EA', 3.4, -1.7], [680, 860, 10, '#B3A2EA', 2.4, -0.3]];
      return `<defs>${gingham('rb-g', 34, '#FDF6F9', '#EC80AF', 0.13, 45)}
<linearGradient id="rb-ribbon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F29BC2"/><stop offset="0.5" stop-color="#C3A6F0"/><stop offset="1" stop-color="#8F80DC"/></linearGradient></defs>
<rect width="1920" height="1080" fill="url(#rb-g)"/>
<g ${anim('rb-sway 9s ease-in-out infinite')}>
<path d="${ribbon}" fill="none" stroke="url(#rb-ribbon)" stroke-width="36" stroke-linecap="round"/>
<path d="${ribbon}" transform="translate(0 -8)" fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="5" stroke-linecap="round"/>
<path d="${ribbon}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 46" style="animation: rb-shimmer 6s linear infinite;"/>
</g>
<g transform="translate(250 270) scale(1.35)"><g ${anim('rb-bow 4.5s ease-in-out infinite', '50% 20%')}>${bow()}
<path d="M-60 -12 C -80 0, -86 20, -78 30" fill="none" stroke="#FFFFFF" stroke-opacity="0.6" stroke-width="4" stroke-linecap="round"/></g></g>
${sparkles.map(([x, y, s, c, d, delay]) => `<g transform="translate(${x} ${y})"><path d="${sparkle(s)}" fill="${c}" ${anim(`rb-twinkle ${d}s ease-in-out ${delay}s infinite`)}/></g>`).join('')}
${lace('rb-lace', 'bottom', '#FFFFFF', '#F2C9DC')}`;
    },
  },

  hearts: {
    name: 'Heart Bubbles',
    css: `
@keyframes hb-float{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-22px) rotate(4deg)}}
@keyframes hb-rise{from{transform:translateY(0)}to{transform:translateY(-1300px)}}
@keyframes hb-wobble{0%,100%{transform:translateX(-14px)}50%{transform:translateX(14px)}}`,
    body: () => {
      const bubbles = [[120, 22, 22, -3, 4, 0], [330, 14, 27, -14, 5, -1], [520, 28, 19, -9, 3.6, -2], [700, 12, 25, -20, 4.4, 0],
        [240, 18, 30, -24, 5.2, -3], [960, 16, 24, -6, 4.8, -2]];
      const hearts = [[150, 290, 1.7, '#F6A0C0', 7, 0, true], [370, 170, 1, '#C8B5F5', 8, -2], [560, 380, 1.3, '#F7B9CF', 6.5, -4],
        [190, 640, 1.1, '#B9A6F0', 7.5, -1], [430, 790, 2, '#F38FB4', 9, -3, true], [650, 570, 0.9, 'outline', 6, -5],
        [920, 210, 1.2, '#F6A0C0', 8.5, -6], [1180, 150, 0.9, '#C8B5F5', 7, -2.5], [1450, 220, 1.1, '#F7B9CF', 6.8, -1.5],
        [1720, 160, 0.8, '#B9A6F0', 8, -4.5]];
      return `<defs>${gingham('hb-g', 40, '#FFF6F9', '#F58AB0', 0.15)}</defs>
<rect width="1920" height="1080" fill="url(#hb-g)"/>
<g fill="#FFFFFF" fill-opacity="0.45" stroke="#FFFFFF" stroke-width="2.5">
${bubbles.map(([x, r, d, delay, w, wd]) => `<g transform="translate(${x} 1150)"><g style="animation: hb-rise ${d}s linear ${delay}s infinite;"><g style="animation: hb-wobble ${w}s ease-in-out ${wd}s infinite;"><circle r="${r}"/><circle cx="${-r / 3}" cy="${-r / 3}" r="${r / 4.5}" fill-opacity="0.9" stroke="none"/></g></g></g>`).join('')}
</g>
${hearts.map(([x, y, s, c, d, delay, shine]) => `<g transform="translate(${x} ${y}) scale(${s})"><g ${anim(`hb-float ${d}s ease-in-out ${delay}s infinite`)}><path d="${HEART}" ${c === 'outline' ? 'fill="#FFFFFF" stroke="#F2A0BE" stroke-width="3"' : `fill="${c}"`}/>${shine ? '<path d="M-16 -6 C -20 -2 -20 4 -17 8" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-opacity="0.8"/>' : ''}</g></g>`).join('')}
${lace('hb-lace', 'top', '#FFFFFF', '#F4C3D6')}`;
    },
  },

  stars: {
    name: 'Star Mobile',
    css: `
@keyframes sm-swing{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}
@keyframes sm-twinkle{0%,100%{transform:scale(0.5);opacity:0.3}50%{transform:scale(1);opacity:1}}
@keyframes sm-zzz{0%{transform:translate(0,0);opacity:0}20%{opacity:1}100%{transform:translate(26px,-60px);opacity:0}}`,
    body: () => {
      const twinkles = [[860, 300, 3, 3, 0], [1020, 180, 2.5, 2.4, -1], [1240, 240, 3.5, 3.6, -2], [1500, 150, 2.5, 2.8, -0.5],
        [1780, 260, 3, 3.2, -1.6], [90, 560, 2.5, 2.6, -2.2], [560, 620, 3, 3.4, -0.8], [700, 460, 2, 2.2, -1.3]];
      const hang = (x, len, d, delay, shape) => `<g ${anim(`sm-swing ${d}s ease-in-out ${delay}s infinite`, '50% 0%')}><line x1="${x}" y1="60" x2="${x}" y2="${60 + len}" stroke="#CFC4F3" stroke-width="2"/>${shape}</g>`;
      const star = (x, y, s, c) => `<path transform="translate(${x} ${y}) scale(${s})" d="${STAR5}" fill="${c}" stroke="${c}" stroke-width="5" stroke-linejoin="round"/>`;
      return `<defs>${gingham('sm-g', 44, '#282C5A', '#FFFFFF', 0.055)}
<mask id="sm-crescent"><rect x="-80" y="-80" width="160" height="160" fill="#fff"/><circle cx="24" cy="-16" r="42" fill="#000"/></mask></defs>
<rect width="1920" height="1080" fill="url(#sm-g)"/>
<g fill="#FFFFFF">${twinkles.map(([x, y, r, d, delay]) => `<g transform="translate(${x} ${y})"><circle r="${r}" ${anim(`sm-twinkle ${d}s ease-in-out ${delay}s infinite`)}/></g>`).join('')}</g>
${hang(130, 180, 5, 0, star(130, 266, 1.3, '#FFE49A'))}
${hang(300, 270, 6.5, -2, `<g transform="translate(300 400)"><circle r="58" fill="#FFE7A8" mask="url(#sm-crescent)"/>
<path d="M-38 -4 Q-30 4 -22 -4" fill="none" stroke="#6B5A3A" stroke-width="3.5" stroke-linecap="round"/>
<circle cx="-36" cy="12" r="6" fill="#F7A6B8" fill-opacity="0.8"/>
<path d="M-30 26 Q-24 30 -18 26" fill="none" stroke="#6B5A3A" stroke-width="3" stroke-linecap="round"/></g>`)}
<g fill="#E7E0FF" font-family="ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" font-weight="700">
<text x="336" y="330" font-size="26" style="animation: sm-zzz 4s ease-out infinite;">z</text>
<text x="356" y="310" font-size="20" style="animation: sm-zzz 4s ease-out -2s infinite;">z</text></g>
${hang(470, 140, 4.5, -1, star(470, 222, 1, '#F9B8D3'))}
${hang(620, 240, 5.5, -3, star(620, 330, 1.5, '#FFE49A'))}
${hang(760, 90, 4, -0.5, `<path transform="translate(760 168) scale(0.9)" d="${HEART}" fill="#C8B5F5"/>`)}
<g fill="#30356B"><circle cx="0" cy="1080" r="170"/><circle cx="200" cy="1100" r="140"/><circle cx="390" cy="1090" r="120"/><circle cx="560" cy="1110" r="110"/><circle cx="720" cy="1100" r="95"/></g>
${lace('sm-lace', 'top', '#CFC4F3', '#282C5A')}`;
    },
  },

  strawberry: {
    name: 'Strawberry Milk',
    css: `
@keyframes sk-bob{0%,100%{transform:translateY(0) rotate(-5deg)}50%{transform:translateY(-14px) rotate(5deg)}}
@keyframes sk-drip{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.28)}}
@keyframes sk-drop{0%,62%{transform:translateY(0);opacity:0}68%{opacity:1}100%{transform:translateY(170px);opacity:0}}`,
    body: () => {
      const drips = [[96, 70, 5, 0], [224, 120, 6, -2], [352, 46, 4.5, -1], [544, 96, 5.5, -3], [736, 74, 6.5, -0.5],
        [1056, 128, 5.2, -2.5], [1312, 56, 4.8, -1.5], [1568, 100, 6, -4], [1824, 68, 5.4, -3.5]];
      const berries = [[170, 330, 1.7, -12, 6, 0], [430, 500, 1.25, 10, 7, -2], [210, 720, 1.45, 6, 6.5, -4], [620, 300, 0.95, -6, 5.5, -1],
        [560, 790, 1.1, -14, 7.5, -3], [1300, 210, 1, 8, 6.2, -5], [1660, 230, 0.8, -10, 5.8, -2.4]];
      return `<defs>${gingham('sk-g', 40, '#FFF4F4', '#EE627A', 0.13)}
<g id="sk-berry">
<path d="M0 0 C 22 0 34 14 30 34 C 26 54 10 70 0 74 C -10 70 -26 54 -30 34 C -34 14 -22 0 0 0 Z" fill="#F2647E"/>
<path d="M-18 14 C -24 22 -24 32 -20 40" fill="none" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="4" stroke-linecap="round"/>
<g fill="#FFE3A3"><ellipse cx="-10" cy="22" rx="2.2" ry="3.4"/><ellipse cx="10" cy="20" rx="2.2" ry="3.4"/><ellipse cx="0" cy="36" rx="2.2" ry="3.4"/><ellipse cx="-15" cy="42" rx="2.2" ry="3.4"/><ellipse cx="15" cy="40" rx="2.2" ry="3.4"/><ellipse cx="-4" cy="56" rx="2.2" ry="3.4"/><ellipse cx="8" cy="56" rx="2.2" ry="3.4"/></g>
<path d="M0 6 L 10 -8 L 9 3 L 24 -3 L 13 9 L 0 7 L -13 9 L -24 -3 L -9 3 L -10 -8 Z" fill="#6DBB84"/>
<path d="M0 2 L 2 -14" stroke="#4E9B66" stroke-width="4" stroke-linecap="round"/>
</g>
<pattern id="sk-milk" width="64" height="80" patternUnits="userSpaceOnUse"><circle cx="32" cy="46" r="32" fill="#FFFFFF"/></pattern></defs>
<rect width="1920" height="1080" fill="url(#sk-g)"/>
<g fill="#FFFFFF">
${drips.map(([x, len, d, delay]) => `<g ${anim(`sk-drip ${d}s ease-in-out ${delay}s infinite`, '50% 0%')}><rect x="${x - 13}" y="56" width="26" height="${len}" rx="13"/></g>`).join('')}
<circle cx="224" cy="196" r="9" style="animation: sk-drop 6s ease-in infinite;"/>
<circle cx="1056" cy="204" r="9" style="animation: sk-drop 7s ease-in -3s infinite;"/>
<circle cx="544" cy="172" r="8" style="animation: sk-drop 5.5s ease-in -1.5s infinite;"/>
</g>
${berries.map(([x, y, s, r, d, delay]) => `<g transform="translate(${x} ${y}) scale(${s}) rotate(${r})"><g ${anim(`sk-bob ${d}s ease-in-out ${delay}s infinite`)}><use href="#sk-berry"/></g></g>`).join('')}
<g fill="#FFFFFF" stroke="#F5A3B5" stroke-width="2"><circle cx="330" cy="620" r="7"/><circle cx="700" cy="560" r="5"/><circle cx="90" cy="520" r="6"/><circle cx="880" cy="280" r="6"/></g>
<rect width="1920" height="46" fill="#FFFFFF"/><rect width="1920" height="80" fill="url(#sk-milk)"/>`;
    },
  },

  curtain: {
    name: 'Lace Curtain',
    css: `
@keyframes lc-drift{from{transform:translateX(-520px)}to{transform:translateX(2440px)}}
@keyframes lc-curtain{0%,100%{transform:skewX(0deg)}50%{transform:skewX(-1.6deg)}}
@keyframes lc-nod{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}`,
    body: () => {
      const scallops = (y, dy) => Array.from({ length: 16 }, (_, i) => `Q${i * 120 + 60} ${y + dy} ${i * 120 + 120} ${y}`).join(' ');
      const flower = (x, y, c) => `<g transform="translate(${x} ${y})" fill="${c}"><circle cx="0" cy="-12" r="10"/><circle cx="11" cy="-4" r="10"/><circle cx="7" cy="9" r="10"/><circle cx="-7" cy="9" r="10"/><circle cx="-11" cy="-4" r="10"/><circle r="7" fill="#FFE49A"/></g>`;
      const clouds = [[95, -20, 300, 1], [120, -70, 470, 0.7], [80, -50, 650, 1.2], [140, -110, 200, 0.55]];
      return `<defs>
<linearGradient id="lc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C7DAFA"/><stop offset="0.55" stop-color="#E2E1FA"/><stop offset="1" stop-color="#F8E5F0"/></linearGradient>
${gingham('lc-check', 24, '#FBF7FB', '#B5A3EE', 0.32)}
<radialGradient id="lc-sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFF7DC" stop-opacity="0.9"/><stop offset="1" stop-color="#FFF7DC" stop-opacity="0"/></radialGradient>
<g id="lc-cloud" fill="#FFFFFF" fill-opacity="0.92"><ellipse cx="0" cy="0" rx="90" ry="34"/><ellipse cx="-50" cy="-18" rx="48" ry="40"/><ellipse cx="20" cy="-34" rx="58" ry="50"/><ellipse cx="74" cy="-10" rx="42" ry="32"/></g>
</defs>
<rect width="1920" height="1080" fill="url(#lc-sky)"/>
<circle cx="820" cy="270" r="160" fill="url(#lc-sun)"/><circle cx="820" cy="270" r="56" fill="#FFF8E2"/>
${clouds.map(([d, delay, y, s]) => `<g style="animation: lc-drift ${d}s linear ${delay}s infinite;"><use href="#lc-cloud" transform="translate(0 ${y}) scale(${s})"/></g>`).join('')}
<rect y="990" width="1920" height="90" fill="#F3EAF7"/><rect y="990" width="1920" height="10" fill="#FFFFFF"/>
<g transform="translate(560 990)">
<g ${anim('lc-nod 4.6s ease-in-out infinite', '50% 100%')}><path d="M0 0 C -6 -40 -24 -70 -40 -96" fill="none" stroke="#6DBB84" stroke-width="5" stroke-linecap="round"/>${flower(-40, -100, '#F7A6C4')}</g>
<g ${anim('lc-nod 5.4s ease-in-out -2s infinite', '50% 100%')}><path d="M0 0 C 4 -50 14 -90 28 -126" fill="none" stroke="#6DBB84" stroke-width="5" stroke-linecap="round"/>${flower(28, -130, '#C8B5F5')}</g>
<path d="M-46 -52 L46 -52 L36 6 L-36 6 Z" fill="#F2A7C6"/><rect x="-52" y="-58" width="104" height="16" rx="6" fill="#E88FB4"/>
</g>
<g ${anim('lc-curtain 7s ease-in-out infinite', '0% 0%')}>
<path d="M0 0 H340 C 330 300 300 520 230 640 C 300 760 330 900 340 1080 H0 Z" fill="url(#lc-check)"/>
<path d="M340 0 C 330 300 300 520 230 640 C 300 760 330 900 340 1080" fill="none" stroke="#FFFFFF" stroke-width="6"/>
<path d="M352 0 C 342 300 312 520 242 640 C 312 760 342 900 352 1080" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" stroke-dasharray="0 22"/>
<g transform="translate(236 640) scale(0.7)">${bow()}</g>
</g>
<g transform="translate(1920 0) scale(-1 1)"><g ${anim('lc-curtain 7.6s ease-in-out -3s infinite', '0% 0%')}>
<path d="M0 0 H300 C 290 300 270 520 210 640 C 270 760 290 900 300 1080 H0 Z" fill="url(#lc-check)"/>
<path d="M312 0 C 302 300 282 520 222 640 C 282 760 302 900 312 1080" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" stroke-dasharray="0 22"/>
</g></g>
<path d="M0 0 V110 ${scallops(110, 60)} V0 Z" fill="url(#lc-check)"/>
<path d="M0 118 ${scallops(118, 60)}" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round" stroke-dasharray="0 20"/>
<rect width="1920" height="18" fill="#E9DFF8"/>`;
    },
  },

  bunting: {
    name: 'Party Bunting',
    css: `
@keyframes pb-flag{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}
@keyframes pb-fall{from{transform:translateY(0)}to{transform:translateY(1200px)}}
@keyframes pb-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes pb-bob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-20px) rotate(3deg)}}`,
    body: () => {
      const colors = ['#F7A8C4', '#C3B2F4', '#9FDCC8', '#FFE29A'];
      // points along the two strings (quadratic curves), one flag each
      const along = (p0, p1, p2, n) => Array.from({ length: n }, (_, i) => {
        const t = (i + 1) / (n + 1), u = 1 - t;
        return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
      });
      const flags = [...along([-20, 60], [480, 240], [980, 70], 9), ...along([900, 90], [1400, 230], [1940, 50], 9)];
      const confetti = [[120, 18, -2, 'r', 0], [260, 22, -11, 'c', 1], [400, 16, -6, 'r', 3], [540, 20, -15, 'r', 2], [680, 24, -4, 'c', 0],
        [60, 21, -17, 'c', 3], [330, 19, -9, 'r', 1], [620, 17, -13, 'r', 0], [860, 23, -7, 'c', 2], [1040, 20, -1, 'r', 3],
        [1280, 22, -16, 'c', 1], [1520, 18, -10, 'r', 2], [1760, 25, -19, 'c', 0], [200, 26, -22, 'r', 3]];
      const balloon = (x, y, rx, ry, c, knot, d, delay, sway) => `<g transform="translate(${x} ${y})"><g ${anim(`pb-bob ${d}s ease-in-out ${delay}s infinite`, '50% 0%')}>
<path d="M0 ${ry} C ${14 * sway} ${ry + 46} ${-14 * sway} ${ry + 96} ${6 * sway} ${ry + 156} C ${20 * sway} ${ry + 196} 0 ${ry + 236} ${4 * sway} ${ry + 266}" fill="none" stroke="#B7AED0" stroke-width="2"/>
<ellipse rx="${rx}" ry="${ry}" fill="${c}"/><path d="M-8 ${ry - 2} L8 ${ry - 2} L0 ${ry + 10} Z" fill="${knot}"/>
<ellipse cx="${-rx * 0.37}" cy="${-ry * 0.37}" rx="${rx * 0.18}" ry="${ry * 0.28}" fill="#FFFFFF" fill-opacity="0.6" transform="rotate(-20 ${-rx * 0.37} ${-ry * 0.37})"/></g></g>`;
      return `<defs>${gingham('pb-g', 44, '#F4FBF8', '#6CBEA4', 0.14)}</defs>
<rect width="1920" height="1080" fill="url(#pb-g)"/>
${confetti.map(([x, d, delay, kind, c]) => `<g transform="translate(${x} -40)"><g style="animation: pb-fall ${d}s linear ${delay}s infinite;">${kind === 'c'
        ? `<circle r="6" fill="${colors[c]}"/>`
        : `<rect x="-5" y="-9" width="10" height="18" rx="3" fill="${['#F7A8C4', '#C3B2F4', '#7FD0B6', '#FFD27A'][c]}" ${anim(`pb-spin ${2.6 + c * 0.3}s linear infinite`)}/>`}</g></g>`).join('')}
${balloon(180, 470, 54, 64, '#F7A8C4', '#E98DB0', 6, 0, 1)}
${balloon(330, 400, 50, 60, '#C3B2F4', '#A996E8', 7, -2.5, -1)}
${balloon(470, 520, 44, 52, '#9FDCC8', '#7FCBB2', 6.5, -4, 1)}
<path d="M-20 60 Q 480 240 980 70" fill="none" stroke="#B7AED0" stroke-width="3"/>
<path d="M900 90 Q 1400 230 1940 50" fill="none" stroke="#B7AED0" stroke-width="3"/>
${flags.map(([x, y], i) => `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><g ${anim(`pb-flag ${3.3 + (i % 4) * 0.25}s ease-in-out ${-(i * 0.37) % 3}s infinite`, '50% 0%')}><path d="M-30 0 L30 0 L0 58 Z" fill="${colors[i % 4]}"/><circle cx="0" cy="20" r="5" fill="#FFFFFF" fill-opacity="0.8"/></g></g>`).join('')}
${lace('pb-lace', 'bottom', '#FFFFFF', '#BFE6D8')}`;
    },
  },
};

export const sceneIds = Object.keys(SCENES);

// The scene as SVG markup. still: every animation stopped at its resting pose (for the desktop picture); width and
// height, when given, size the SVG (for drawing it into a canvas).
export function sceneSVG(id, { still = false, width = null, height = null } = {}) {
  const s = SCENES[id];
  if (!s) return '';
  const size = width ? ` width="${width}" height="${height}"` : ' width="100%" height="100%"';
  return `<svg xmlns="http://www.w3.org/2000/svg" ${STAGE}${size} aria-hidden="true"><style>${s.css}
.paused *{animation-play-state:paused !important}
${still ? '*{animation:none !important}' : '@media (prefers-reduced-motion: reduce){*{animation:none !important}}'}</style>${s.body()}</svg>`;
}

// The scene drawn still into a PNG of width x height pixels, as a data URL.
export async function sceneStill(id, width, height) {
  const svg = sceneSVG(id, { still: true, width, height });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
