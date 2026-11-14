/* =====================================================================
   Skins: palettes, presets, texture generation, GPU slots, player model
   skin = [tone, hairColor, hairStyle, eyes, shirt, accent, pants, shoes, pattern]
   ===================================================================== */
// player skins live after the block tiles in the texture array; devices with a small array limit get fewer skin slots
let SKIN_SLOTS = 8, TEX_TOTAL = TEX_COUNT + 8 * 12;
const SKIN_LAYERS = 12, SKIN_BASE = TEX_COUNT;
function fitSkinSlots(maxLayers) {
  SKIN_SLOTS = clamp(Math.floor(((maxLayers || 256) - TEX_COUNT) / SKIN_LAYERS), 1, 8);
  TEX_TOTAL = TEX_COUNT + SKIN_SLOTS * SKIN_LAYERS;
}
const Skins = {
  TONES: ['#f3d2b7', '#e3b38f', '#c98f66', '#a46b45', '#7b4b2c', '#4f2f1d'],
  HAIRS: ['#1d1612', '#4b2d18', '#8b5a2b', '#d8b25b', '#b5461f', '#ece6da', '#6e6a78', '#2f6b4f'],
  STYLES: ['Short', 'Long', 'Hood', 'Bald', 'Spiky', 'Ponytail'],
  EYES: ['#3b6fb6', '#4a8b3a', '#5b3a1e', '#2a2a2e', '#8a6ad0', '#c27b1a'],
  CLOTH: ['#d9662a', '#3f7d3a', '#3a6fb5', '#7a7a80', '#d4a62a', '#6a3f8f', '#2a9d8f', '#3a3436', '#b8322e', '#e8e0d0', '#2d4a7a', '#7a4a2a'],
  PANTS: ['#3b2a1e', '#2c3442', '#4a4a50', '#5a4630', '#23262c', '#6b5b3e', '#2f4a3a', '#5a2a2a'],
  SHOES: ['#2a1d14', '#1a1a1e', '#5a3a22', '#6b6b70', '#3a2a40'],
  PATTERNS: ['Plain', 'Stripe', 'Sash', 'Emblem', 'Vest'],
  presets: [
    { name: 'Ember Scout', skin: [2, 1, 0, 0, 0, 4, 0, 0, 1] },
    { name: 'Moss Ranger', skin: [1, 2, 2, 1, 1, 11, 6, 2, 2] },
    { name: 'Frost Warden', skin: [0, 5, 1, 0, 2, 9, 2, 3, 3] },
    { name: 'Stonecutter', skin: [3, 0, 3, 2, 3, 11, 4, 1, 4] },
    { name: 'Sunvein Knight', skin: [1, 3, 0, 5, 4, 8, 1, 0, 3] },
    { name: 'Night Weaver', skin: [4, 6, 2, 4, 5, 7, 4, 1, 2] },
    { name: 'Coral Diver', skin: [2, 4, 5, 1, 6, 8, 2, 3, 1] },
    { name: 'Ash Wanderer', skin: [5, 5, 4, 3, 7, 0, 0, 0, 4] },
  ],
  sizes() { return [this.TONES.length, this.HAIRS.length, this.STYLES.length, this.EYES.length, this.CLOTH.length, this.CLOTH.length, this.PANTS.length, this.SHOES.length, this.PATTERNS.length]; },
  sanitize(s) {
    const n = this.sizes();
    if (typeof s === 'string') s = s.split('.').map(Number);
    if (!Array.isArray(s) || s.length !== n.length) return this.presets[0].skin.slice();
    return s.map((v, i) => clamp((v | 0), 0, n[i] - 1));
  },
  key(s) { return s.join('.'); },

  /* ---- texture generation: 12 faces of 16x16 RGBA ---- */
  faces(s) {
    const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const tone = hex(this.TONES[s[0]]), hair = hex(this.HAIRS[s[1]]), style = s[2], eye = hex(this.EYES[s[3]]);
    const shirt = hex(this.CLOTH[s[4]]), acc = hex(this.CLOTH[s[5]]), pants = hex(this.PANTS[s[6]]), shoes = hex(this.SHOES[s[7]]), pat = s[8];
    const hood = shirt.map(v => v * 0.85);
    const rnd = mulberry32(seedFromString(this.key(s)));
    const mk = () => new Uint8ClampedArray(1024);
    const put = (a, x, y, c, mul) => {
      if (x < 0 || y < 0 || x > 15 || y > 15) return;
      const m = (mul || 1), i = (y * 16 + x) * 4;
      a[i] = c[0] * m; a[i + 1] = c[1] * m; a[i + 2] = c[2] * m; a[i + 3] = 255;
    };
    const fill = (a, c, n) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(a, x, y, c, 1 + (rnd() - 0.5) * (n || 0.08)); };
    const rect = (a, x0, y0, x1, y1, c, n) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(a, x, y, c, 1 + (rnd() - 0.5) * (n || 0.08)); };
    const F = {};
    // head front
    let a = F.hf = mk(); fill(a, tone, 0.05);
    if (style === 0 || style === 5) { rect(a, 0, 0, 15, 2, hair); rect(a, 0, 3, 1, 4, hair); rect(a, 14, 3, 15, 4, hair); rect(a, 2, 3, 6, 3, hair); }
    else if (style === 1) { rect(a, 0, 0, 15, 2, hair); rect(a, 0, 3, 2, 13, hair); rect(a, 13, 3, 15, 13, hair); rect(a, 3, 3, 7, 3, hair); }
    else if (style === 2) { rect(a, 0, 0, 15, 2, hood); rect(a, 0, 3, 1, 15, hood); rect(a, 14, 3, 15, 15, hood); rect(a, 2, 3, 13, 3, hair); }
    else if (style === 3) { rect(a, 0, 0, 15, 0, tone.map(v => v * 0.92)); }
    else if (style === 4) { rect(a, 0, 0, 15, 2, hair); for (let x = 0; x < 16; x++) { if (x % 3 !== 1) put(a, x, 3, hair); if (x % 5 === 2) put(a, x, 4, hair); } }
    const brow = style === 3 ? tone.map(v => v * 0.7) : hair.map(v => v * 0.85);
    rect(a, 3, 6, 5, 6, brow, 0.02); rect(a, 10, 6, 12, 6, brow, 0.02);
    rect(a, 3, 7, 5, 8, [240, 238, 232], 0.02); rect(a, 10, 7, 12, 8, [240, 238, 232], 0.02);
    rect(a, 4, 7, 5, 8, eye, 0.04); rect(a, 10, 7, 11, 8, eye, 0.04);
    put(a, 5, 8, eye, 0.5); put(a, 10, 8, eye, 0.5);
    rect(a, 7, 9, 8, 10, tone.map(v => v * 0.88), 0.02);
    rect(a, 6, 12, 9, 12, [tone[0] * 0.45 + 122 * 0.55, tone[1] * 0.45 + 46 * 0.55, tone[2] * 0.45 + 42 * 0.55], 0.02);
    // head side / back / top / bottom
    a = F.hs = mk(); fill(a, tone, 0.05);
    if (style === 2) fill(a, hood);
    else if (style === 1) rect(a, 0, 0, 15, 12, hair);
    else if (style !== 3) rect(a, 0, 0, 15, style === 4 ? 6 : 5, hair);
    if (style !== 2 && style !== 1) rect(a, 7, 8, 8, 10, tone.map(v => v * 0.84), 0.02);
    a = F.hb = mk(); fill(a, tone, 0.05);
    if (style === 2) fill(a, hood);
    else if (style === 1) fill(a, hair);
    else if (style === 3) { }
    else { rect(a, 0, 0, 15, style === 4 ? 12 : 11, hair); if (style === 5) rect(a, 6, 12, 9, 15, hair.map(v => v * 0.9)); }
    a = F.ht = mk(); fill(a, style === 2 ? hood : style === 3 ? tone : hair);
    a = F.hd = mk(); fill(a, tone.map(v => v * 0.85));
    // body
    a = F.bf = mk(); fill(a, shirt);
    if (pat === 1) rect(a, 7, 3, 8, 11, acc);
    else if (pat === 2) { for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) if (Math.abs(x - (2 + y)) <= 1) put(a, x, y, acc, 1 + (rnd() - 0.5) * 0.08); }
    else if (pat === 3) { for (let y = 3; y <= 9; y++) for (let x = 4; x <= 11; x++) if (Math.abs(x - 7.5) + Math.abs(y - 6) <= 3) put(a, x, y, acc); }
    else if (pat === 4) { rect(a, 0, 0, 4, 11, acc); rect(a, 11, 0, 15, 11, acc); }
    const col = style === 2 ? hood : tone;
    rect(a, 6, 0, 9, 0, col, 0.02); rect(a, 7, 1, 8, 1, col, 0.02);
    rect(a, 0, 12, 15, 13, pants.map(v => v * 0.55)); rect(a, 7, 12, 8, 13, acc.map(v => Math.min(255, v * 1.15)), 0.02);
    rect(a, 0, 14, 15, 15, pants);
    a = F.bb = mk(); fill(a, shirt);
    if (pat === 4) { rect(a, 0, 0, 3, 11, acc); rect(a, 12, 0, 15, 11, acc); }
    if (style === 2) rect(a, 2, 0, 13, 3, hood);
    rect(a, 0, 12, 15, 13, pants.map(v => v * 0.55)); rect(a, 0, 14, 15, 15, pants);
    a = F.bs = mk(); fill(a, pat === 4 ? acc : shirt); rect(a, 0, 12, 15, 13, pants.map(v => v * 0.55)); rect(a, 0, 14, 15, 15, pants);
    // arms
    a = F.as = mk(); fill(a, tone, 0.05); rect(a, 0, 0, 15, 8, shirt); rect(a, 0, 9, 15, 9, acc); rect(a, 0, 14, 15, 15, tone.map(v => v * 0.92));
    a = F.ae = mk(); fill(a, tone.map(v => v * 0.95));
    // legs
    a = F.ls = mk(); fill(a, pants); rect(a, 0, 11, 15, 11, pants.map(v => v * 0.8)); rect(a, 0, 12, 15, 15, shoes);
    a = F.le = mk(); fill(a, shoes.map(v => v * 0.8));
    return [F.hf, F.hs, F.hb, F.ht, F.hd, F.bf, F.bb, F.bs, F.as, F.ae, F.ls, F.le];
  },

  /* ---- GPU slots ---- */
  slotKey: new Array(8).fill(null), slotUsed: new Array(8).fill(0), useT: 0,
  base(s) {
    const k = this.key(s);
    let slot = this.slotKey.indexOf(k);
    if (slot < 0) {
      slot = 0; for (let i = 1; i < SKIN_SLOTS; i++) if (this.slotUsed[i] < this.slotUsed[slot]) slot = i;
      this.slotKey[slot] = k;
      const gl = R.gl, f = this.faces(s);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, R.tex);
      const hd = new Uint8Array(TILE * TILE * 4);
      f.forEach((d, i) => { hdTile(new Uint8Array(d.buffer), 0, hd, 0, i + 7); gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, SKIN_BASE + slot * SKIN_LAYERS + i, TILE, TILE, 1, gl.RGBA, gl.UNSIGNED_BYTE, hd); });
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    }
    this.slotUsed[slot] = ++this.useT;
    return SKIN_BASE + slot * SKIN_LAYERS;
  },

  /* ---- 2D previews ---- */
  faceCanvas(d) { const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d), 16, 16), 0, 0); return c; },
  figure(s, scale) {
    scale = scale || 2;
    const f = this.faces(s).map(d => this.faceCanvas(d));
    const c = document.createElement('canvas'); c.width = 32 * scale; c.height = 64 * scale;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.scale(scale, scale);
    g.drawImage(f[0], 8, 0, 16, 16);         // head
    g.drawImage(f[5], 8, 16, 16, 24);        // body
    g.drawImage(f[8], 0, 16, 8, 24); g.drawImage(f[8], 24, 16, 8, 24); // arms
    g.drawImage(f[10], 8, 40, 8, 24); g.drawImage(f[10], 16, 40, 8, 24); // legs
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(15.5, 40, 1, 24);
    return c;
  },
  face(s, size) {
    const c = document.createElement('canvas'); c.width = c.height = size || 32;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(this.faceCanvas(this.faces(s)[0]), 0, 0, c.width, c.height);
    return c;
  },
};

/* ---- player model (feet at origin, facing -z) ---- */
const PU = 1.8 / 32;
function drawPlayerModel(o) {
  const b = Skins.base(o.skin);
  const HF = b, HS = b + 1, HB = b + 2, HT = b + 3, HD = b + 4, BF = b + 5, BB = b + 6, BS = b + 7, AS = b + 8, AE = b + 9, LS = b + 10, LE = b + 11;
  const base = M4.create();
  M4.translate(base, o.x, o.y - (o.sneak ? 0.12 : 0), o.z);
  M4.rotY(base, -o.yaw);
  const sw = Math.sin(o.walk || 0) * 0.75 * (o.walkAmt || 0);
  const xf = m => p => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  const box = (m, x0, y0, z0, x1, y1, z1, L) => emitBox(R.dyn, x0 * PU, y0 * PU, z0 * PU, x1 * PU, y1 * PU, z1 * PU, L, [0, 0, 1, 1], 1, o.sky, o.blk, 0, xf(m));
  const legL = [LS, LS, LS, LE, LS, LS], arm = [AS, AS, BS, AE, AS, AS];
  const AT = (o.armor || [0, 0, 0, 0]).map(m => m ? TEX['armor_' + ['', 'hide', 'sunvein', 'skyshard'][m]] : -1);
  for (const side of [-1, 1]) {
    const l = M4.create(); l.set(base); M4.translate(l, side * 2 * PU, 12 * PU, 0); M4.rotX(l, sw * side);
    box(l, -2, -12, -2, 2, 0, 2, legL);
    if (AT[2] >= 0) box(l, -2.4, -8.6, -2.4, 2.4, 0.3, 2.4, AT[2]);
    if (AT[3] >= 0) box(l, -2.5, -12.4, -2.5, 2.5, -8.8, 2.5, AT[3]);
  }
  const body = M4.create(); body.set(base); if (o.sneak) { M4.translate(body, 0, 12 * PU, 0); M4.rotX(body, -0.35); M4.translate(body, 0, -12 * PU, 0); }
  box(body, -4, 12, -2, 4, 24, 2, [BS, BS, BS, BS, BB, BF]);
  if (AT[1] >= 0) box(body, -4.5, 13.2, -2.5, 4.5, 24.4, 2.5, AT[1]);
  if (AT[2] >= 0) box(body, -4.4, 11.6, -2.4, 4.4, 13.4, 2.4, AT[2]);
  const head = M4.create(); head.set(body); M4.translate(head, 0, 24 * PU, 0); M4.rotX(head, clamp(o.pitch || 0, -1.3, 1.3));
  box(head, -4, 0, -4, 4, 8, 4, [HS, HS, HT, HD, HB, HF]);
  if (AT[0] >= 0) { box(head, -4.6, 3.5, -4.6, 4.6, 8.6, 4.6, [AT[0], AT[0], AT[0], -1, AT[0], -1]); box(head, -4.6, 6.2, -4.62, 4.6, 8.6, -4.58, [-1, -1, -1, -1, -1, AT[0]]); }
  let handM = null;
  for (const side of [-1, 1]) {
    const a = M4.create(); a.set(body); M4.translate(a, side * 6 * PU, 22 * PU, 0);
    let rx = -sw * side;
    if (side === 1) rx -= (o.swing || 0) * 1.5 + (o.held ? 0.3 : 0);
    M4.rotX(a, rx); M4.rotZ(a, side * 0.05);
    box(a, -2, -10, -2, 2, 2, 2, arm);
    if (AT[1] >= 0) box(a, -2.5, -4, -2.5, 2.5, 2.5, 2.5, AT[1]);
    if (side === 1) handM = a;
  }
  if (o.held && ITEMS[o.held]) {
    const t = itemTemplate(o.held), m = M4.create(); m.set(handM);
    M4.translate(m, 0, -9 * PU, -2.5 * PU);
    if (t.kind === 'cube') { M4.rotY(m, 0.6); M4.scale(m, 0.26, 0.26, 0.26); }
    else { M4.rotX(m, -1.2); M4.rotY(m, Math.PI / 2); M4.translate(m, 0.12, 0.12, 0); M4.scale(m, 0.5, 0.5, 0.5); }
    pushTemplate(t, m, o.sky, o.blk, 0);
  }
}
