'use strict';
/* =====================================================================
   EMBERWILD — core: math, noise, registries, settings
   ===================================================================== */
const CH = 16, WH = 128, SEA = 30;
const DAY_LEN = 600; // seconds for a full day/night cycle

// ---------- small math ----------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const M4 = {
  create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  identity(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul(out, a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + rr] * b[c * 4 + k];
      r[c * 4 + rr] = s;
    }
    out.set(r); return out;
  },
  persp(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out.fill(0); out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf; return out;
  },
  lookDir(out, eye, f) { // f normalized forward
    let rx = -f[2], ry = 0, rz = f[0]; let rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    const ux = ry * f[2] - rz * f[1], uy = rz * f[0] - rx * f[2], uz = rx * f[1] - ry * f[0];
    out[0] = rx; out[4] = ry; out[8] = rz; out[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
    out[1] = ux; out[5] = uy; out[9] = uz; out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
    out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2]; out[14] = (f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]);
    out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1; return out;
  },
  invert(out, m) {
    const a = m, inv = new Float32Array(16);
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    det = det ? 1 / det : 0; for (let i = 0; i < 16; i++) out[i] = inv[i] * det; return out;
  },
  translate(m, x, y, z) { const t = M4.create(); t[12] = x; t[13] = y; t[14] = z; return M4.mul(m, m, t); },
  scale(m, x, y, z) { const t = M4.create(); t[0] = x; t[5] = y; t[10] = z; return M4.mul(m, m, t); },
  rotX(m, a) { const t = M4.create(), c = Math.cos(a), s = Math.sin(a); t[5] = c; t[6] = s; t[9] = -s; t[10] = c; return M4.mul(m, m, t); },
  rotY(m, a) { const t = M4.create(), c = Math.cos(a), s = Math.sin(a); t[0] = c; t[2] = -s; t[8] = s; t[10] = c; return M4.mul(m, m, t); },
  rotZ(m, a) { const t = M4.create(), c = Math.cos(a), s = Math.sin(a); t[0] = c; t[1] = s; t[4] = -s; t[5] = c; return M4.mul(m, m, t); },
};

// ---------- random / hashing / noise ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function ihash(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function seedFromString(s) {
  s = String(s).trim();
  if (/^-?\d+$/.test(s)) return parseInt(s, 10) | 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}
function makeNoise2D(seed) {
  const r = mulberry32(seed), perm = new Uint8Array(256), p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const gx = [1, -1, 1, -1, 1, -1, 0, 0], gy = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, tt, g;
    tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { g = p[ii + p[jj]] & 7; tt *= tt; n += tt * tt * (gx[g] * x0 + gy[g] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { g = p[ii + i1 + p[jj + j1]] & 7; tt *= tt; n += tt * tt * (gx[g] * x1 + gy[g] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { g = p[ii + 1 + p[jj + 1]] & 7; tt *= tt; n += tt * tt * (gx[g] * x2 + gy[g] * y2); }
    return 70 * n;
  };
}
function fbm(n, x, y, oct) {
  let s = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); norm += a; a *= 0.5; f *= 2.03; }
  return s / norm;
}

// ---------- atlas ----------
const ATLAS = __ATLAS_JSON__;
const TEX = ATLAS.tiles;            // name -> layer
const TEX_WHITE = Object.keys(ATLAS.tiles).length; // extra solid white layer appended at runtime
const TEX_COUNT = TEX_WHITE + 1;

// ---------- blocks ----------
const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, MOSSY: 5, BRICKS: 6, MOSSY_BRICKS: 7, BASALT: 8, BEDROCK: 9,
  SAND: 10, OAK_LOG: 11, BIRCH_LOG: 12, PINE_LOG: 13, OAK_PLANKS: 14, BIRCH_PLANKS: 15, PINE_PLANKS: 16, EMBER_PLANKS: 17,
  OAK_LEAVES: 18, BIRCH_LEAVES: 19, PINE_LEAVES: 20, WATER: 21, GLASS: 22, BENCH: 23, TORCH: 24, TALLGRASS: 25,
  FLOWER_EMBER: 26, FLOWER_SUN: 27, FLOWER_FROST: 28, BERRY_BUSH: 29, ORE_COAL: 30, ORE_SUNVEIN: 31, ORE_EMBER: 32,
  ORE_AZURITE: 33, ORE_SKYSHARD: 34, ORE_VERDITE: 35, TORCH_W0: 36, TORCH_W1: 37, TORCH_W2: 38, TORCH_W3: 39,
  SNOW: 40, GLOWCAP: 41, MUSHROOM_RED: 42, MUSHROOM_BROWN: 43, REED: 44, CAMPFIRE: 45, FURNACE: 46, FURNACE_LIT: 47, BED: 48,
  SANDSTONE: 49, GRAVEL: 50, CLAY: 51, CACTUS: 52, DEAD_BUSH: 53, SNOW_GRASS: 54, CHEST: 55, WOOL: 56, CHEST_E: 57, CHEST_W: 58, CHEST_N: 59,
  DOOR: 60, /* 60-67: side * 2 + open */ LADDER: 68, /* 68-71: which wall it hangs on */
};
const I = {
  STICK: 100, COAL: 101, SUNVEIN: 102, EMBER_DUST: 103, AZURITE: 104, SKYSHARD: 105, VERDITE: 106, APPLE: 107, BERRIES: 108,
  RAW_HAUNCH: 120, ROAST_HAUNCH: 121, CHARCOAL: 122, SUNVEIN_INGOT: 123, HIDE: 124, SILK: 125,
  SUNVEIN_PICK: 130, SUNVEIN_AXE: 131, SUNVEIN_SHOVEL: 132, SUNVEIN_SWORD: 133, SKY_PICK: 134, SKY_AXE: 135, SKY_SHOVEL: 136, SKY_SWORD: 137,
  ARMOR0: 140,
  WOOD_PICK: 110, STONE_PICK: 111, WOOD_AXE: 112, STONE_AXE: 113, WOOD_SHOVEL: 114, STONE_SHOVEL: 115, WOOD_SWORD: 116, STONE_SWORD: 117,
};
// render types
const RT_NONE = 0, RT_CUBE = 1, RT_CROSS = 2, RT_LIQUID = 3, RT_TORCH = 4, RT_CAMPFIRE = 5, RT_BED = 6, RT_DOOR = 7, RT_LADDER = 8;
const BLOCKS = [];
const OPAQUE = new Uint8Array(256), SOLID = new Uint8Array(256), SKYBLOCK = new Uint8Array(256), LIGHTPASS = new Uint8Array(256),
  AOCAST = new Uint8Array(256), RTYPE = new Uint8Array(256), EMIT = new Uint8Array(256), CUTOUT = new Uint8Array(256),
  REPLACEABLE = new Uint8Array(256), TARGETABLE = new Uint8Array(256);
const FACE_TEX = []; // id -> [+x,-x,+y,-y,+z,-z]
const ITEMS = [];

function defBlock(id, name, o) {
  const d = Object.assign({
    id, name, opaque: true, solid: true, cutout: false, rtype: RT_CUBE, light: 0, hard: 1, tool: null, tier: 0,
    sound: 'stone', drop: null, replaceable: false, noItem: false, desc: ''
  }, o);
  BLOCKS[id] = d;
  OPAQUE[id] = d.opaque ? 1 : 0; SOLID[id] = d.solid ? 1 : 0; RTYPE[id] = d.rtype; EMIT[id] = d.light;
  CUTOUT[id] = d.cutout ? 1 : 0; REPLACEABLE[id] = d.replaceable ? 1 : 0;
  SKYBLOCK[id] = (d.opaque || d.leaves) ? 1 : 0; LIGHTPASS[id] = d.opaque ? 0 : 1; AOCAST[id] = (d.opaque || d.leaves) ? 1 : 0;
  TARGETABLE[id] = (id !== 0 && d.rtype !== RT_LIQUID) ? 1 : 0;
  let t = o.tex || {};
  if (typeof t === 'string') t = { all: t };
  const side = t.side || t.all, top = t.top || t.all, bottom = t.bottom || t.all;
  FACE_TEX[id] = (t.faces || [side, side, top, bottom, side, side]).map(n => n ? TEX[n] : 0);
  if (!d.noItem) {
    ITEMS[id] = { id, name, icon: o.icon || top || side, stack: o.stack || 64, block: id, desc: d.desc, iso: d.rtype === RT_CUBE };
  }
  return d;
}
function defItem(id, name, icon, o) {
  ITEMS[id] = Object.assign({ id, name, icon, stack: 64, desc: '' }, o || {});
}

const one = id => () => [[id, 1]];
defBlock(0, 'Air', { opaque: false, solid: false, rtype: RT_NONE, noItem: true });
defBlock(B.GRASS, 'Grass Block', { tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hard: 0.6, tool: 'shovel', sound: 'grass', drop: one(B.DIRT) });
defBlock(B.DIRT, 'Dirt', { tex: 'dirt', hard: 0.5, tool: 'shovel', sound: 'grass' });
defBlock(B.STONE, 'Stone', { tex: 'stone', hard: 1.5, tool: 'pick', tier: 1, drop: one(B.COBBLE) });
defBlock(B.COBBLE, 'Cobblestone', { tex: 'cobble', hard: 2, tool: 'pick', tier: 1 });
defBlock(B.MOSSY, 'Mossy Cobblestone', { tex: 'mossy_cobble', hard: 2, tool: 'pick', tier: 1 });
defBlock(B.BRICKS, 'Stone Bricks', { tex: 'stone_bricks', hard: 1.5, tool: 'pick', tier: 1 });
defBlock(B.MOSSY_BRICKS, 'Mossy Stone Bricks', { tex: 'mossy_bricks', hard: 1.5, tool: 'pick', tier: 1 });
defBlock(B.BASALT, 'Deep Basalt', { tex: 'basalt', hard: 3, tool: 'pick', tier: 1, desc: 'Dense rock from the deep layers.' });
defBlock(B.BEDROCK, 'Corestone', { tex: 'bedrock', hard: -1, desc: 'Unbreakable in Survival.' });
defBlock(B.SAND, 'Sand', { tex: 'sand', hard: 0.5, tool: 'shovel', sound: 'sand' });
defBlock(B.OAK_LOG, 'Oak Log', { tex: { top: 'oak_top', side: 'oak_bark' }, hard: 2, tool: 'axe', sound: 'wood', icon: 'oak_bark' });
defBlock(B.BIRCH_LOG, 'Birch Log', { tex: { top: 'birch_top', side: 'birch_bark' }, hard: 2, tool: 'axe', sound: 'wood' });
defBlock(B.PINE_LOG, 'Pine Log', { tex: { top: 'pine_top', side: 'pine_bark' }, hard: 2, tool: 'axe', sound: 'wood' });
defBlock(B.OAK_PLANKS, 'Oak Planks', { tex: 'oak_planks', hard: 2, tool: 'axe', sound: 'wood' });
defBlock(B.BIRCH_PLANKS, 'Birch Planks', { tex: 'birch_planks', hard: 2, tool: 'axe', sound: 'wood' });
defBlock(B.PINE_PLANKS, 'Pine Planks', { tex: 'pine_planks', hard: 2, tool: 'axe', sound: 'wood' });
defBlock(B.EMBER_PLANKS, 'Ember Planks', { tex: 'ember_planks', hard: 2, tool: 'axe', sound: 'wood', desc: 'Planks stained with ember dust.' });
const leafDrop = (apple) => (r) => { const out = []; if (r() < 0.25) out.push([-1, 1]); if (apple && r() < 0.07) out.push([I.APPLE, 1]); if (r() < 0.04) out.push([I.STICK, 1]); return out; };
defBlock(B.OAK_LEAVES, 'Oak Leaves', { tex: 'leaves_oak', opaque: false, cutout: true, leaves: true, hard: 0.2, tool: 'axe', sound: 'leaves', drop: leafDrop(true) });
defBlock(B.BIRCH_LEAVES, 'Birch Leaves', { tex: 'leaves_birch', opaque: false, cutout: true, leaves: true, hard: 0.2, tool: 'axe', sound: 'leaves', drop: leafDrop(true) });
defBlock(B.PINE_LEAVES, 'Pine Needles', { tex: 'leaves_pine', opaque: false, cutout: true, leaves: true, hard: 0.2, tool: 'axe', sound: 'leaves', drop: leafDrop(false) });
defBlock(B.WATER, 'Water', { tex: 'water', opaque: false, solid: false, rtype: RT_LIQUID, replaceable: true, noItem: true, hard: -1 });
defBlock(B.GLASS, 'Glass', { tex: 'glass', opaque: false, cutout: true, hard: 0.3, sound: 'glass' });
defBlock(B.BENCH, 'Workbench', { tex: { top: 'bench_top', side: 'bench_side', bottom: 'oak_planks' }, hard: 2.5, tool: 'axe', sound: 'wood', desc: 'Stand near it to craft tools and advanced blocks.' });
defBlock(B.TORCH, 'Torch', { tex: 'torch', opaque: false, solid: false, cutout: true, rtype: RT_TORCH, light: 14, hard: 0, sound: 'wood', desc: 'Lights the dark and keeps Gloomlings away.' });
const plant = (name, tex, extra) => Object.assign({ tex, opaque: false, solid: false, cutout: true, rtype: RT_CROSS, hard: 0, replaceable: false, sound: 'leaves' }, extra || {});
defBlock(B.TALLGRASS, 'Tall Grass', plant('Tall Grass', 'tallgrass', { replaceable: true, drop: (r) => r() < 0.06 ? [[I.BERRIES, 1]] : [] }));
defBlock(B.FLOWER_EMBER, 'Emberbloom', plant('', 'flower_ember'));
defBlock(B.FLOWER_SUN, 'Sunpetal', plant('', 'flower_sun'));
defBlock(B.FLOWER_FROST, 'Frostbell', plant('', 'flower_frost'));
defBlock(B.BERRY_BUSH, 'Berry Bush', plant('', 'berry_bush', { hard: 0.15, drop: (r) => [[I.BERRIES, 2 + (r() * 2 | 0)]] }));
defBlock(B.ORE_COAL, 'Coal Ore', { tex: 'ore_coal', hard: 3, tool: 'pick', tier: 1, drop: one(I.COAL) });
defBlock(B.ORE_SUNVEIN, 'Sunvein Ore', { tex: 'ore_sunvein', hard: 3, tool: 'pick', tier: 2, drop: one(I.SUNVEIN) });
defBlock(B.ORE_EMBER, 'Emberite Ore', { tex: 'ore_ember', hard: 3, tool: 'pick', tier: 2, drop: (r) => [[I.EMBER_DUST, 2 + (r() * 3 | 0)]] });
defBlock(B.ORE_AZURITE, 'Azurite Ore', { tex: 'ore_azurite', hard: 3, tool: 'pick', tier: 2, drop: (r) => [[I.AZURITE, 1 + (r() * 3 | 0)]] });
defBlock(B.ORE_SKYSHARD, 'Skyshard Ore', { tex: 'ore_skyshard', hard: 3.5, tool: 'pick', tier: 3, drop: one(I.SKYSHARD) });
defBlock(B.ORE_VERDITE, 'Verdite Ore', { tex: 'ore_verdite', hard: 3.5, tool: 'pick', tier: 3, drop: one(I.VERDITE) });
for (let k = 0; k < 4; k++) defBlock(B.TORCH_W0 + k, 'Torch', { tex: 'torch', opaque: false, solid: false, cutout: true, rtype: RT_TORCH, light: 14, hard: 0, sound: 'wood', noItem: true, drop: one(B.TORCH) });
defBlock(B.SNOW, 'Snow', { tex: 'snow', hard: 0.4, tool: 'shovel', sound: 'sand' });
defBlock(B.GLOWCAP, 'Glowcap', plant('', 'glowcap', { light: 10, anyGround: true, desc: 'A softly glowing cave mushroom.' }));
defBlock(B.MUSHROOM_RED, 'Red Mushroom', plant('', 'mushroom_red', { anyGround: true }));
defBlock(B.MUSHROOM_BROWN, 'Brown Mushroom', plant('', 'mushroom_brown', { anyGround: true }));
defBlock(B.REED, 'Reeds', plant('', 'reed', { anyGround: true }));
defBlock(B.CAMPFIRE, 'Campfire', { tex: 'camp_log', icon: 'fire', opaque: false, solid: false, cutout: true, rtype: RT_CAMPFIRE, light: 14, hard: 1, tool: 'axe', sound: 'wood',
  desc: 'Light and warmth. Right-click it with raw haunch to cook. Hot to stand in!' });
defBlock(B.FURNACE, 'Furnace', { tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_front' }, icon: 'furnace_front', hard: 3, tool: 'pick', tier: 1, desc: 'Smelts ore, sand and cobblestone, and cooks food. Needs fuel.' });
defBlock(B.FURNACE_LIT, 'Furnace', { tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_front_lit' }, hard: 3, tool: 'pick', tier: 1, light: 12, noItem: true, drop: one(B.FURNACE) });
defBlock(B.BED, 'Bed', { tex: { top: 'bed_top', side: 'bed_side', bottom: 'oak_planks' }, opaque: false, cutout: true, rtype: RT_BED, hard: 0.6, tool: 'axe', sound: 'wood',
  desc: 'Sleep through the night and wake up here when you fall.' });
defBlock(B.SANDSTONE, 'Sandstone', { tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' }, hard: 0.8, tool: 'pick', tier: 1 });
defBlock(B.GRAVEL, 'Gravel', { tex: 'gravel', hard: 0.6, tool: 'shovel', sound: 'sand' });
defBlock(B.CLAY, 'Clay', { tex: 'clay', hard: 0.6, tool: 'shovel', sound: 'sand' });
defBlock(B.CACTUS, 'Cactus', { tex: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, hard: 0.4, sound: 'leaves', anyGround: true, desc: 'Prickly! Grows on sand in deserts.' });
defBlock(B.DEAD_BUSH, 'Dead Bush', plant('', 'dead_bush', { replaceable: true, anyGround: true, drop: (r) => r() < 0.5 ? [[I.STICK, 1]] : [] }));
defBlock(B.SNOW_GRASS, 'Snowy Grass Block', { tex: { top: 'snow', side: 'snow_grass_side', bottom: 'dirt' }, hard: 0.6, tool: 'shovel', sound: 'sand', drop: one(B.DIRT) });
defBlock(B.CHEST, 'Chest', { tex: { faces: ['chest_side', 'chest_side', 'chest_top', 'chest_top', 'chest_front', 'chest_side'] }, icon: 'chest_front', hard: 2.5, tool: 'axe', sound: 'wood', desc: 'Stores 27 stacks of items. Right-click to open.' });
// doors: a thin panel on one side of the block (0 north, 1 east, 2 south, 3 west); open doors swing to the next side and let you through
for (let f = 0; f < 4; f++) for (let o = 0; o < 2; o++) defBlock(B.DOOR + f * 2 + o, 'Wooden Door', { tex: { top: 'door_top', side: 'door_bottom' }, icon: 'door_item', opaque: false, solid: !o, cutout: true, rtype: RT_DOOR,
  hard: 1.5, tool: 'axe', sound: 'wood', noItem: !!(f || o), drop: one(B.DOOR), desc: 'Right-click to open and close it. Needs two blocks of space.' });
// ladders hang on a wall: 0 wall to the west, 1 east, 2 north, 3 south (same as wall torches)
for (let k = 0; k < 4; k++) defBlock(B.LADDER + k, 'Ladder', { tex: 'ladder', opaque: false, solid: false, cutout: true, rtype: RT_LADDER, hard: 0.4, tool: 'axe', sound: 'wood',
  noItem: k > 0, drop: one(B.LADDER), desc: 'Place it against a wall, then walk into it to climb. Sneak to hold on.' });
// the same chest turned to face east, west and north (the latch faces whoever placed it)
[[B.CHEST_E, 0], [B.CHEST_W, 1], [B.CHEST_N, 5]].forEach(([cid, f]) => {
  const faces = ['chest_side', 'chest_side', 'chest_top', 'chest_top', 'chest_side', 'chest_side']; faces[f] = 'chest_front';
  defBlock(cid, 'Chest', { tex: { faces }, hard: 2.5, tool: 'axe', sound: 'wood', noItem: true, drop: one(B.CHEST) });
});
defBlock(B.WOOL, 'Wool', { tex: 'wool', hard: 0.8, sound: 'leaves', desc: 'Soft and warm. Good for beds and building.' });
// leaves drop themselves
for (const id of [B.OAK_LEAVES, B.BIRCH_LEAVES, B.PINE_LEAVES]) {
  const f = BLOCKS[id].drop; BLOCKS[id].drop = (r) => f(r).map(([i, n]) => [i === -1 ? id : i, n]);
}
ITEMS[B.WATER] = { id: B.WATER, name: 'Water', icon: 'water', stack: 64, block: B.WATER, desc: 'Creative only. Still water you can place anywhere.', creative: true };
const isTorch = id => id === B.TORCH || (id >= B.TORCH_W0 && id <= B.TORCH_W3);
const isChest = id => id === B.CHEST || (id >= B.CHEST_E && id <= B.CHEST_N);
const isDoor = id => id >= B.DOOR && id < B.DOOR + 8;
const isLadder = id => id >= B.LADDER && id < B.LADDER + 4;
// chest contents travel as a flat list: slot, item, count, durability (-1 = none)
function encodeSlots(s) { const o = []; s.forEach((st, i) => { if (st) o.push(i, st.id, st.n, st.d === undefined ? -1 : st.d); }); return o; }
function decodeSlots(a, size) {
  const s = new Array(size).fill(null); if (!Array.isArray(a)) return s;
  for (let i = 0; i + 3 < a.length; i += 4) {
    const k = a[i] | 0, id = a[i + 1] | 0, n = a[i + 2] | 0, d = +a[i + 3];
    if (k < 0 || k >= size || !ITEMS[id] || n < 1) continue;
    const st = { id, n: Math.min(n, ITEMS[id].stack) };
    const dur = ITEMS[id].tool ? ITEMS[id].tool.dur : ITEMS[id].armor ? ITEMS[id].armor.dur : 0;
    if (dur && isFinite(d) && d >= 0) st.d = Math.min(d, dur); else if (ITEMS[id].tool) st.d = dur;
    s[k] = st;
  }
  return s;
}
const isPlant = id => RTYPE[id] === RT_CROSS;
const isLeaves = id => id === B.OAK_LEAVES || id === B.BIRCH_LEAVES || id === B.PINE_LEAVES;

defItem(I.STICK, 'Stick', 'stick');
defItem(I.COAL, 'Coal', 'coal', { desc: 'Fuel for torches and glassmaking.' });
defItem(I.SUNVEIN, 'Sunvein Nugget', 'nugget_sunvein', { desc: 'A warm golden metal. Its use is still a mystery…' });
defItem(I.EMBER_DUST, 'Ember Dust', 'dust_ember', { desc: 'Glowing red powder. Stains wood a deep red.' });
defItem(I.AZURITE, 'Azurite', 'gem_azurite', { desc: 'A deep blue crystal.' });
defItem(I.SKYSHARD, 'Skyshard', 'gem_skyshard', { desc: 'A rare crystal that hums faintly.' });
defItem(I.VERDITE, 'Verdite', 'gem_verdite', { desc: 'A rare green gem.' });
defItem(I.APPLE, 'Apple', 'apple', { food: 4, sat: 2.4, desc: 'Restores 2 hunger icons.' });
defItem(I.BERRIES, 'Wild Berries', 'berries', { food: 2, sat: 0.6, desc: 'Restores 1 hunger icon.' });
defItem(I.RAW_HAUNCH, 'Raw Haunch', 'haunch_raw', { food: 2, sat: 1, desc: 'Better cooked: right-click a campfire with it.' });
defItem(I.CHARCOAL, 'Charcoal', 'charcoal', { desc: 'Burned wood. Works like coal for torches and fuel.' });
defItem(I.SUNVEIN_INGOT, 'Sunvein Ingot', 'ingot_sunvein', { desc: 'Smelted from Sunvein nuggets. Makes strong tools and armour.' });
defItem(I.HIDE, 'Mossback Hide', 'hide', { desc: 'Tough hide from a Mossback. Makes light armour and beds.' });
defItem(I.SILK, 'Crawler Silk', 'silk', { desc: 'Spun by Duskcrawlers deep underground.' });
defItem(I.ROAST_HAUNCH, 'Roasted Haunch', 'haunch_cooked', { food: 8, sat: 9, desc: 'A hearty meal. Restores 4 hunger icons.' });
const TOOLS = [
  [I.WOOD_PICK, 'Wooden Pickaxe', 'wood_pick', 'pick', 1], [I.STONE_PICK, 'Stone Pickaxe', 'stone_pick', 'pick', 2],
  [I.WOOD_AXE, 'Wooden Axe', 'wood_axe', 'axe', 1], [I.STONE_AXE, 'Stone Axe', 'stone_axe', 'axe', 2],
  [I.WOOD_SHOVEL, 'Wooden Shovel', 'wood_shovel', 'shovel', 1], [I.STONE_SHOVEL, 'Stone Shovel', 'stone_shovel', 'shovel', 2],
  [I.WOOD_SWORD, 'Wooden Sword', 'wood_sword', 'sword', 1], [I.STONE_SWORD, 'Stone Sword', 'stone_sword', 'sword', 2],
  [I.SUNVEIN_PICK, 'Sunvein Pickaxe', 'sunvein_pick', 'pick', 3], [I.SUNVEIN_AXE, 'Sunvein Axe', 'sunvein_axe', 'axe', 3],
  [I.SUNVEIN_SHOVEL, 'Sunvein Shovel', 'sunvein_shovel', 'shovel', 3], [I.SUNVEIN_SWORD, 'Sunvein Sword', 'sunvein_sword', 'sword', 3],
  [I.SKY_PICK, 'Skyshard Pickaxe', 'skyshard_pick', 'pick', 4], [I.SKY_AXE, 'Skyshard Axe', 'skyshard_axe', 'axe', 4],
  [I.SKY_SHOVEL, 'Skyshard Shovel', 'skyshard_shovel', 'shovel', 4], [I.SKY_SWORD, 'Skyshard Sword', 'skyshard_sword', 'sword', 4],
];
const TIER_STATS = { 1: [2.2, 60], 2: [4.2, 132], 3: [6.2, 250], 4: [8.6, 780] };
for (const [id, name, icon, type, tier] of TOOLS) {
  const dmg = type === 'sword' ? 3 + tier : type === 'axe' ? 2 + tier : 1 + (tier >> 1);
  defItem(id, name, icon, { stack: 1, tool: { type, tier, speed: TIER_STATS[tier][0], dur: TIER_STATS[tier][1], dmg } });
}
// armour: slot 0 helmet, 1 chest, 2 legs, 3 boots
const ARMOR_MATS = [['hide', 'Hide', [1, 3, 2, 1], 80], ['sunvein', 'Sunvein', [2, 6, 5, 2], 220], ['skyshard', 'Skyshard', [3, 8, 6, 3], 520]];
const ARMOR_PIECES = [['helm', 'Helmet'], ['chest', 'Chestplate'], ['legs', 'Leggings'], ['boots', 'Boots']];
ARMOR_MATS.forEach(([key, label, pts, dur], m) => ARMOR_PIECES.forEach(([pk, pl], s) => {
  defItem(I.ARMOR0 + m * 4 + s, `${label} ${pl}`, `${key}_${pk}`, { stack: 1, armor: { slot: s, mat: m + 1, points: pts[s], dur } });
}));
const armorId = (mat, slot) => I.ARMOR0 + mat * 4 + slot;
{
}

// ---------- recipes ----------
const GROUPS = {
  planks: [B.OAK_PLANKS, B.BIRCH_PLANKS, B.PINE_PLANKS, B.EMBER_PLANKS],
  leaves: [B.OAK_LEAVES, B.BIRCH_LEAVES, B.PINE_LEAVES],
  logs: [B.OAK_LOG, B.BIRCH_LOG, B.PINE_LOG],
  coal: [I.COAL, I.CHARCOAL],
};
// furnace: what smelts into what, and how many seconds of burning each fuel gives
const SMELT = { [B.COBBLE]: B.STONE, [B.SAND]: B.GLASS, [I.RAW_HAUNCH]: I.ROAST_HAUNCH, [I.SUNVEIN]: I.SUNVEIN_INGOT,
  [B.OAK_LOG]: I.CHARCOAL, [B.BIRCH_LOG]: I.CHARCOAL, [B.PINE_LOG]: I.CHARCOAL, [B.MOSSY]: B.COBBLE, [B.BRICKS]: B.STONE };
const FUEL = { [I.COAL]: 80, [I.CHARCOAL]: 80, [B.OAK_PLANKS]: 15, [B.BIRCH_PLANKS]: 15, [B.PINE_PLANKS]: 15, [B.EMBER_PLANKS]: 15,
  [B.OAK_LOG]: 15, [B.BIRCH_LOG]: 15, [B.PINE_LOG]: 15, [I.STICK]: 5, [B.BENCH]: 15, [I.WOOD_PICK]: 10, [I.WOOD_AXE]: 10, [I.WOOD_SHOVEL]: 10, [I.WOOD_SWORD]: 10 };
const SMELT_TIME = 8;
const GROUP_NAMES = { planks: 'Any Planks', leaves: 'Any Leaves', logs: 'Any Log', coal: 'Coal or Charcoal' };
const RECIPES = [
  { out: [B.OAK_PLANKS, 4], inp: [[B.OAK_LOG, 1]], cat: 'Basics' },
  { out: [B.BIRCH_PLANKS, 4], inp: [[B.BIRCH_LOG, 1]], cat: 'Basics' },
  { out: [B.PINE_PLANKS, 4], inp: [[B.PINE_LOG, 1]], cat: 'Basics' },
  { out: [I.STICK, 4], inp: [['planks', 2]], cat: 'Basics' },
  { out: [B.BENCH, 1], inp: [['planks', 4]], cat: 'Basics' },
  { out: [B.TORCH, 4], inp: [['coal', 1], [I.STICK, 1]], cat: 'Basics' },
  { out: [B.CAMPFIRE, 1], inp: [['logs', 1], [I.STICK, 3], ['coal', 1]], cat: 'Basics' },
  { out: [B.FURNACE, 1], inp: [[B.COBBLE, 8]], bench: true, cat: 'Basics' },
  { out: [B.BED, 1], inp: [['planks', 3], [I.HIDE, 3]], bench: true, cat: 'Basics' },
  { out: [B.BED, 1], inp: [['planks', 3], [I.SILK, 3]], bench: true, cat: 'Basics' },
  { out: [B.BED, 1], inp: [['planks', 3], [B.WOOL, 3]], bench: true, cat: 'Basics' },
  { out: [B.CHEST, 1], inp: [['planks', 8]], bench: true, cat: 'Basics' },
  { out: [B.DOOR, 3], inp: [['planks', 6]], bench: true, cat: 'Basics' },
  { out: [B.LADDER, 3], inp: [[I.STICK, 7]], bench: true, cat: 'Basics' },
  { out: [I.WOOD_PICK, 1], inp: [['planks', 3], [I.STICK, 2]], bench: true, cat: 'Tools' },
  { out: [I.WOOD_AXE, 1], inp: [['planks', 3], [I.STICK, 2]], bench: true, cat: 'Tools' },
  { out: [I.WOOD_SHOVEL, 1], inp: [['planks', 1], [I.STICK, 2]], bench: true, cat: 'Tools' },
  { out: [I.WOOD_SWORD, 1], inp: [['planks', 2], [I.STICK, 1]], bench: true, cat: 'Tools' },
  { out: [I.STONE_PICK, 1], inp: [[B.COBBLE, 3], [I.STICK, 2]], bench: true, cat: 'Tools' },
  { out: [I.STONE_AXE, 1], inp: [[B.COBBLE, 3], [I.STICK, 2]], bench: true, cat: 'Tools' },
  { out: [I.STONE_SHOVEL, 1], inp: [[B.COBBLE, 1], [I.STICK, 2]], bench: true, cat: 'Tools' },
  { out: [I.STONE_SWORD, 1], inp: [[B.COBBLE, 2], [I.STICK, 1]], bench: true, cat: 'Tools' },
  ...[[I.SUNVEIN_INGOT, I.SUNVEIN_PICK], [I.SKYSHARD, I.SKY_PICK]].flatMap(([m, b]) => [
    { out: [b, 1], inp: [[m, 3], [I.STICK, 2]], bench: true, cat: 'Tools' }, { out: [b + 1, 1], inp: [[m, 3], [I.STICK, 2]], bench: true, cat: 'Tools' },
    { out: [b + 2, 1], inp: [[m, 1], [I.STICK, 2]], bench: true, cat: 'Tools' }, { out: [b + 3, 1], inp: [[m, 2], [I.STICK, 1]], bench: true, cat: 'Tools' }]),
  ...[I.HIDE, I.SUNVEIN_INGOT, I.SKYSHARD].flatMap((m, mi) => [3, 5, 4, 2].map((n, s) => ({ out: [armorId(mi, s), 1], inp: [[m, n]], bench: true, cat: 'Armour' }))),
  { out: [B.BRICKS, 4], inp: [[B.COBBLE, 4]], bench: true, cat: 'Building' },
  { out: [B.MOSSY, 1], inp: [[B.COBBLE, 1], ['leaves', 1]], cat: 'Building' },
  { out: [B.MOSSY_BRICKS, 1], inp: [[B.BRICKS, 1], ['leaves', 1]], cat: 'Building' },
  { out: [B.EMBER_PLANKS, 4], inp: [['planks', 4], [I.EMBER_DUST, 1]], bench: true, cat: 'Building' },
  { out: [B.SANDSTONE, 1], inp: [[B.SAND, 4]], cat: 'Building' },
  { out: [B.WOOL, 1], inp: [[I.SILK, 4]], cat: 'Building' },
];

// ---------- creative catalog ----------
const CREATIVE_TABS = {
  Building: [B.STONE, B.COBBLE, B.MOSSY, B.BRICKS, B.MOSSY_BRICKS, B.BASALT, B.BEDROCK, B.OAK_PLANKS, B.BIRCH_PLANKS, B.PINE_PLANKS, B.EMBER_PLANKS,
    B.OAK_LOG, B.BIRCH_LOG, B.PINE_LOG, B.GLASS, B.SAND, B.SANDSTONE, B.GRAVEL, B.CLAY, B.WOOL, B.DIRT, B.GRASS, B.SNOW, B.BENCH, B.CHEST, B.DOOR, B.LADDER, B.FURNACE, B.BED, B.TORCH, B.CAMPFIRE, B.WATER],
  Nature: [B.GRASS, B.DIRT, B.SAND, B.OAK_LOG, B.BIRCH_LOG, B.PINE_LOG, B.OAK_LEAVES, B.BIRCH_LEAVES, B.PINE_LEAVES, B.TALLGRASS,
    B.FLOWER_EMBER, B.FLOWER_SUN, B.FLOWER_FROST, B.BERRY_BUSH, B.MUSHROOM_RED, B.MUSHROOM_BROWN, B.GLOWCAP, B.REED, B.SNOW, B.SNOW_GRASS, B.CACTUS, B.DEAD_BUSH, B.GRAVEL, B.CLAY, B.WATER],
  Ores: [B.ORE_COAL, B.ORE_SUNVEIN, B.ORE_EMBER, B.ORE_AZURITE, B.ORE_SKYSHARD, B.ORE_VERDITE, I.COAL, I.SUNVEIN, I.EMBER_DUST, I.AZURITE, I.SKYSHARD, I.VERDITE],
  Items: [I.WOOD_PICK, I.STONE_PICK, I.SUNVEIN_PICK, I.SKY_PICK, I.WOOD_AXE, I.STONE_AXE, I.SUNVEIN_AXE, I.SKY_AXE, I.WOOD_SHOVEL, I.STONE_SHOVEL, I.SUNVEIN_SHOVEL, I.SKY_SHOVEL,
    I.WOOD_SWORD, I.STONE_SWORD, I.SUNVEIN_SWORD, I.SKY_SWORD, ...Array.from({ length: 12 }, (_, i) => I.ARMOR0 + i), I.STICK, I.CHARCOAL, I.SUNVEIN_INGOT, I.HIDE, I.SILK, I.APPLE, I.BERRIES, I.RAW_HAUNCH, I.ROAST_HAUNCH, B.TORCH, B.CAMPFIRE],
};
CREATIVE_TABS.All = [...new Set([].concat(CREATIVE_TABS.Building, CREATIVE_TABS.Nature, CREATIVE_TABS.Ores, CREATIVE_TABS.Items))];
const CREATIVE_START = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.OAK_PLANKS, B.OAK_LOG, B.GLASS, B.CHEST, B.TORCH];

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  renderDist: 8, fov: 75, sens: 100, invertY: false, master: 70, music: 45, sfx: 80, bobbing: true,
  showFps: false, difficulty: 2, quality: 3, clouds: true, guiScale: 2, weather: true, particles: 1, ambient: 70, autoRes: true, graphics: 3, v: 2, voice: 0, voiceVol: 80,
};
const DIFFICULTY = ['Peaceful', 'Easy', 'Normal', 'Hard'];
const QUALITY = ['50%', '70%', '85%', '100%', 'Sharp (HiDPI)', 'Ultra (supersampled)'];
const GFX_NAMES = ['Potato', 'Bad', 'Medium', 'Normal', 'Good', 'Heavenly'];
const GFX_PRESETS = [
  { renderDist: 3, quality: 0, clouds: false, particles: 0.15, autoRes: true },
  { renderDist: 4, quality: 1, clouds: false, particles: 0.4, autoRes: true },
  { renderDist: 6, quality: 2, clouds: true, particles: 0.65, autoRes: true },
  { renderDist: 8, quality: 3, clouds: true, particles: 1, autoRes: true },
  { renderDist: 11, quality: 4, clouds: true, particles: 1.25, autoRes: false },
  { renderDist: 15, quality: 5, clouds: true, particles: 1.6, autoRes: false },
];
// derived feature switches for the current graphics level
const GFX = {
  get level() { return Settings.graphics | 0; },
  get fastLeaves() { return this.level <= 1; },
  get wave() { return this.level >= 2; },
  get fancyWater() { return this.level >= 3; },
  get bloom() { return this.level >= 4; },
  get rays() { return this.level >= 5; },
  get aniso() { return this.level >= 4 ? (this.level >= 5 ? 16 : 8) : 1; },
};
function applyGraphicsPreset(level) {
  Settings.graphics = clamp(level | 0, 0, 5);
  Object.assign(Settings, GFX_PRESETS[Settings.graphics]);
}
const Settings = Object.assign({}, DEFAULT_SETTINGS);
function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem('emberwild.settings') || '{}'); Object.assign(Settings, s); } catch (e) { }
}
function saveSettings() {
  try { localStorage.setItem('emberwild.settings', JSON.stringify(Settings)); } catch (e) { }
}
loadSettings();
if (Settings.v !== 2) { applyGraphicsPreset(3); Settings.v = 2; saveSettings(); }
