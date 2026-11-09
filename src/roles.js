// Semantic roles for parts. The runtime rig is driven by role, so a model only needs
// correctly labelled parts to move. See-through layer names map onto these directly.
//
// head:    follows head rotation
// depth:   [base, bump] relief used for the 2.5D head turn (in head radii)
// split:   split into screen-left / screen-right pieces
// physics: physics group id
// static:  ignores breathing and body sway

export const ROLES = {
  face:        { label: 'Face', zh: '脸',            head: true, depth: [0, 1] },
  eye_white:   { label: 'Eye white', zh: '眼白',       head: true, depth: [0.02, 1], split: true },
  iris:        { label: 'Iris', zh: '瞳孔',            head: true, depth: [0.04, 1], split: true },
  eyelash:     { label: 'Eyelash / liner', zh: '睫毛 / 眼线', head: true, depth: [0.05, 1], split: true },
  eyebrow:     { label: 'Eyebrow', zh: '眉毛',         head: true, depth: [0.07, 1], split: true },
  eyewear:     { label: 'Glasses', zh: '眼镜',         head: true, depth: [0.3, 1] },
  nose:        { label: 'Nose', zh: '鼻子',            head: true, depth: [0.15, 1] },
  mouth:       { label: 'Mouth', zh: '嘴',           head: true, depth: [0.05, 1] },
  mouth_inner: { label: 'Mouth inside (old models)', zh: '口腔（旧模型）', head: true, depth: [0.04, 1] },
  mouth_frame: { label: 'Mouth shape (swapped in when open)', zh: '嘴型（张嘴时替换）', head: true, depth: [0.05, 1] },
  ear:         { label: 'Ear', zh: '耳朵',             head: true, depth: [-0.3, 0] },
  ear_acc:     { label: 'Ear accessory', zh: '耳饰',   head: true, depth: [-0.1, 0.2], physics: 'accessory' },
  head_acc:    { label: 'Head accessory', zh: '头饰',  head: true, depth: [0.1, 0.5], physics: 'accessory' },
  hair_front:  { label: 'Front hair', zh: '前发',      head: true, depth: [0.2, 0.85], physics: 'hair_front' },
  hair_back:   { label: 'Back hair', zh: '后发',       head: true, depth: [-0.7, 0.15], physics: 'hair_back' },
  neck:        { label: 'Neck', zh: '脖子' },
  body:        { label: 'Body / top', zh: '身体 / 上衣' },
  arm:         { label: 'Arm', zh: '手臂' },
  legs:        { label: 'Legs / bottom', zh: '腿 / 下装', static: true },
  tail:        { label: 'Tail', zh: '尾巴',   physics: 'tail' },
  wings:       { label: 'Wings', zh: '翅膀',  physics: 'tail' },
  other:       { label: 'Other (static)', zh: '其他（静止）', static: true },
};

// amp is in head radii; k is stiffness, c damping, gain how strongly motion drives the swing.
export const PHYSICS_DEFAULT = [
  { id: 'hair_front', label: 'Front hair', zh: '前发',    amp: 0.12, k: 60, c: 7, gain: 1 },
  { id: 'hair_back',  label: 'Back hair', zh: '后发',     amp: 0.22, k: 30, c: 5, gain: 1 },
  { id: 'accessory',  label: 'Accessories', zh: '饰品',   amp: 0.15, k: 45, c: 4, gain: 1.2 },
  { id: 'tail',       label: 'Tail / wings', zh: '尾巴 / 翅膀',  amp: 0.2,  k: 20, c: 3, gain: 1 },
];

// Order matters: more specific names first ("earwear" before "ears", "headwear" before "head").
const NAME_RULES = [
  [/back\s*hair|后发|後髮|后头发/, 'hair_back'],
  [/front\s*hair|前发|刘海|瀏海|鬓发/, 'hair_front'],
  [/eye\s*white|眼白/, 'eye_white'],
  [/irides|iris|pupil|瞳|虹膜|眼珠/, 'iris'],
  [/eyelash|lash|睫毛|眼线/, 'eyelash'],
  [/eyebrow|brow|眉/, 'eyebrow'],
  [/eyewear|glasses|眼镜/, 'eyewear'],
  [/(mouth|嘴|口)[\s_\-·]*(half|open|round|wide|[aiueo]$|半|张|開|圆|扁)/, 'mouth_frame'],
  [/mouth|lip|嘴|口/, 'mouth'],
  [/nose|鼻/, 'nose'],
  [/earwear|earring|耳饰|耳环|耳坠/, 'ear_acc'],
  [/^ears?$|耳朵|^耳$/, 'ear'],
  [/headwear|hat|hairpin|ribbon|头饰|发饰|帽|发卡/, 'head_acc'],
  [/face|head|脸|面部|头/, 'face'],
  [/neckwear|neck|脖|颈/, 'neck'],
  [/topwear|body|torso|上衣|身体|衣/, 'body'],
  [/handwear|arm|hand|手/, 'arm'],
  [/legwear|bottomwear|footwear|leg|skirt|pants|shoe|腿|裙|裤|鞋|袜/, 'legs'],
  [/tail|尾/, 'tail'],
  [/wing|翅/, 'wings'],
];

// Which mouth shape a hand-drawn mouth layer is, from its name: half, open, round (o / u) or wide (i / e).
export function guessViseme(name) {
  const n = name.trim().toLowerCase();
  if (/half|半/.test(n)) return 'half';
  if (/round|圆|[\s_\-·][ou]$/.test(n)) return 'round';
  if (/wide|扁|[\s_\-·][ie]$/.test(n)) return 'wide';
  return 'open';
}

export function guessRole(name) {
  const n = name.trim().toLowerCase();
  for (const [re, role] of NAME_RULES) if (re.test(n)) return role;
  return 'other';
}
