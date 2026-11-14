/* =====================================================================
   World generation v3 — more biomes for the Overworld (World.gen === 3)
   and the three realms beyond it: the Emberdeep (dim 1), the Aether (dim 2)
   and the Hollow (dim 3). Older worlds keep the generator they were made with.
   ===================================================================== */
Object.assign(BIOME, { JUNGLE: 15, MESA: 16, BLOSSOM: 17, AUTUMN: 18, ICE_SPIKES: 19, FROZEN_OCEAN: 20, MEADOW: 21, MUSHROOM: 22, ASHLANDS: 23, PALM_BEACH: 24,
  EMBERDEEP: 26, AETHER: 27, HOLLOW: 28 });
BIOME_NAMES.push('Rainforest', 'Painted Canyon', 'Blossom Grove', 'Amber Woods', 'Ice Spikes', 'Frozen Sea', 'Flower Meadow', 'Mushroom Vale', 'Ashlands', 'Palm Shore',
  '', 'The Emberdeep', 'The Aether', 'The Hollow');
{
  const set = (b, c) => { TINTS[(1 + b) * 3] = c[0]; TINTS[(1 + b) * 3 + 1] = c[1]; TINTS[(1 + b) * 3 + 2] = c[2]; };
  set(BIOME.JUNGLE, [0.66, 1.12, 0.46]); set(BIOME.MESA, [1.3, 1.04, 0.5]); set(BIOME.BLOSSOM, [0.94, 1.14, 0.8]); set(BIOME.AUTUMN, [1.3, 1.02, 0.5]);
  set(BIOME.ICE_SPIKES, [0.78, 0.94, 0.94]); set(BIOME.FROZEN_OCEAN, [0.78, 0.94, 0.94]); set(BIOME.MEADOW, [0.9, 1.18, 0.7]); set(BIOME.MUSHROOM, [0.8, 0.9, 0.8]);
  set(BIOME.ASHLANDS, [0.9, 0.8, 0.6]); set(BIOME.PALM_BEACH, [1.0, 1.14, 0.64]); set(BIOME.AETHER, [0.72, 1.06, 1.0]);
  for (const id of [B.FERN, B.PALM_LEAVES, B.FLOWER_VIOLET, B.FLOWER_ROSE]) TINTED[id] = 1;
}
const MESA_BANDS = [B.TERRACOTTA, B.TERRACOTTA, B.TERRACOTTA_ORANGE, B.TERRACOTTA, B.TERRACOTTA_WHITE, B.RED_SANDSTONE, B.TERRACOTTA, B.TERRACOTTA_ORANGE,
  B.TERRACOTTA_ORANGE, B.TERRACOTTA, B.RED_SANDSTONE, B.TERRACOTTA_WHITE];
const REALMS = [
  { name: 'The Overworld', sub: '' },
  { name: 'The Emberdeep', sub: 'Mind the lava. Scorchlings carry Cinder Hearts.' },
  { name: 'The Aether', sub: 'Nothing here will hurt you.' },
  { name: 'The Hollow', sub: 'The Hollow King is waiting.' },
];
const EMBER_LAVA = 20;   // lava level in the Emberdeep

Object.assign(World.prototype, {
  // v3 turns some of the v2 biomes into rarer cousins, steered by one more slow noise
  biome3(biome, x, z, T, Hm, h) {
    const g = this.g2, B_ = BIOME, W = fbm(g.W, x / 380, z / 380, 2) * 1.6;
    if (biome === B_.OCEAN) { if (T < -0.5) biome = B_.FROZEN_OCEAN; }
    else if (biome === B_.BEACH) { if (T > 0.25) biome = B_.PALM_BEACH; }
    else if (biome === B_.SNOWY) { if (W > 0.2) biome = B_.ICE_SPIKES; }
    else if (biome === B_.DESERT) {
      if (Hm < -0.36) {
        // painted canyons: flat-topped terraces of banded clay
        biome = B_.MESA; const k = smoothstep(-0.36, -0.5, Hm), p = fbm(g.J, x / 80, z / 80, 3) * 1.6;
        h += Math.floor(smoothstep(-0.2, 0.5, p) * 3.99 * k) * 5;
      } else if (W < -0.42) biome = B_.ASHLANDS;
    }
    else if (biome === B_.SAVANNA) { if (Hm > 0.26) biome = B_.JUNGLE; else if (W < -0.48) biome = B_.ASHLANDS; }
    else if (biome === B_.FOREST || biome === B_.BIRCH) { if (W > 0.36) biome = B_.BLOSSOM; else if (T < 0.0 && W < 0.08) biome = B_.AUTUMN; }
    else if (biome === B_.PLAINS) { if (W > 0.28) biome = B_.MEADOW; }
    else if (biome === B_.DARK) { if (W < -0.26) biome = B_.MUSHROOM; }
    else if (biome === B_.TAIGA) { if (W < -0.36) biome = B_.AUTUMN; }
    return [biome, Math.min(WH - 10, h)];
  },

  /* ---------------- the realms ---------------- */
  // one column of a realm: { h: walkable top (0 = nothing there), ... }
  realmColumn(wx, wz) {
    const g = this.g2, x = wx + this.ox, z = wz + this.oz;
    if (this.dim === 1) {
      let floor = 25 + fbm(g.P, x / 90, z / 90, 4) * 1.5 * 12 + g.D(x / 19, z / 19) * 2;
      let ceil = 98 - fbm(g.J, x / 70, z / 70, 3) * 1.5 * 12 - Math.abs(fbm(g.R, x / 120, z / 120, 2) * 1.6) * 9;
      const p = fbm(g.E, x / 60, z / 60, 2) * 1.6, t = smoothstep(0.36, 0.62, p), mid = (floor + ceil) / 2;
      floor = lerp(floor, mid + 1, t); ceil = lerp(ceil, mid, t);
      floor = Math.max(6, Math.floor(floor)); ceil = Math.min(WH - 6, Math.floor(ceil));
      const ashy = fbm(g.H, x / 150, z / 150, 2) * 1.6;
      return { h: floor, ceil, solid: ceil <= floor + 1, ashy, biome: BIOME.EMBERDEEP, tint: 0 };
    }
    if (this.dim === 2) {
      const m = fbm(g.C, x / 150, z / 150, 4) * 1.6 + 0.08, edge = smoothstep(0.1, 0.42, m);
      if (edge <= 0) return { h: 0, bottom: 0, edge: 0, biome: BIOME.AETHER, tint: 1 + BIOME.AETHER, grove: 0 };
      const top = Math.floor(66 + g.E(x / 320, z / 320) * 9 + fbm(g.P, x / 60, z / 60, 3) * 1.5 * 6 * edge);
      const thick = 2 + Math.pow(edge, 0.7) * (9 + 18 * (0.5 + 0.5 * g.D(x / 50, z / 50))) + g.D(x / 7, z / 7) * 1.5;
      return { h: top, bottom: Math.max(2, Math.floor(top - thick)), edge, biome: BIOME.AETHER, tint: 1 + BIOME.AETHER, grove: fbm(g.H, x / 110, z / 110, 2) * 1.6 };
    }
    // the Hollow: one great island around the world's origin, and scattered islets far out
    const r = Math.hypot(wx, wz), R0 = 62 + (r > 1 ? g.D(wx / r * 2.2 + 31.7, wz / r * 2.2 - 12.3) * 7 : 0);
    if (r < R0) {
      const q = r / R0, top = Math.floor(60 + fbm(g.P, x / 40, z / 40, 2) * 1.5 * 2.2 * smoothstep(0.2, 0.7, q) - Math.pow(q, 5) * 3);
      return { h: top, bottom: Math.max(2, Math.floor(top - 3 - (1 - q * q) * 34 - g.D(x / 6, z / 6) * 2)), main: true, r, biome: BIOME.HOLLOW, tint: 0 };
    }
    const m = fbm(g.C, x / 60, z / 60, 3) * 1.6;
    if (r > R0 + 26 && m > 0.42) { const top = Math.floor(56 + g.E(x / 200, z / 200) * 14); return { h: top, bottom: Math.max(2, Math.floor(top - 2 - (m - 0.42) * 46)), r, biome: BIOME.HOLLOW, tint: 0 }; }
    return { h: 0, bottom: 0, r, biome: BIOME.HOLLOW, tint: 0 };
  },
  generateRealm(c) {
    const ox = c.cx * 16, oz = c.cz * 16, d = c.data, s = this.seed + this.dim * 7919, dim = this.dim, g = this.g2;
    const cols = new Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) cols[x + z * 16] = this.realmColumn(ox + x, oz + z);
    const rnd = mulberry32(ihash(c.cx, c.cz, s + 77) * 4294967296 | 0);
    const setB = (x, y, z, id, onlyAir) => {
      if (x < 0 || x > 15 || z < 0 || z > 15 || y < 1 || y >= WH - 1) return;
      const i = x | (z << 4) | (y << 8); if (!onlyAir || d[i] === 0) d[i] = id;
    };
    const vein = (ore, host, count, size, ymin, ymax) => {
      for (let n = 0; n < count; n++) {
        let x = rnd() * 16 | 0, z = rnd() * 16 | 0, y = ymin + (rnd() * (ymax - ymin) | 0);
        const len = size[0] + (rnd() * (size[1] - size[0] + 1) | 0);
        for (let k = 0; k < len; k++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WH) { const i = x | (z << 4) | (y << 8); if (d[i] === host) d[i] = ore; }
          const r = rnd() * 6 | 0;
          if (r === 0) x++; else if (r === 1) x--; else if (r === 2) z++; else if (r === 3) z--; else if (r === 4) y++; else y--;
        }
      }
    };
    if (dim === 1) {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const col = cols[x + z * 16], base = x | (z << 4), wx = ox + x, wz = oz + z, h = col.h, n1 = ihash(wx, wz, s + 9);
        const top = col.solid ? WH - 1 : h;
        for (let y = 0; y <= top; y++) {
          let b = B.CINDERSTONE;
          if (y === 0 || y >= WH - 2 || (y <= 2 && ihash(wx * 3 + y, wz, s) < 0.5)) b = B.BEDROCK;
          else if (!col.solid && y > h - 3) {
            if (h <= EMBER_LAVA + 1) b = y === h && n1 < 0.3 ? B.VOIDGLASS : n1 < 0.6 ? B.BASALT : B.CINDERSTONE;     // lava shores
            else if (col.ashy > 0.05) b = B.ASH;
            else if (y === h && g.D(wx / 8, wz / 8) > 0.5) b = B.MAGMA;
          }
          d[base | (y << 8)] = b;
        }
        if (col.solid) continue;
        for (let y = h + 1; y <= EMBER_LAVA; y++) d[base | (y << 8)] = B.LAVA;
        for (let y = col.ceil; y < WH; y++) d[base | (y << 8)] = y >= WH - 2 ? B.BEDROCK : B.CINDERSTONE;
        // glowing clusters hanging from the roof
        if (ihash(wx >> 1, wz >> 1, s + 21) < 0.035) { const len = 1 + (ihash(wx, wz, s + 22) * 3 | 0); for (let k = 1; k <= len; k++) if (col.ceil - k > h + 4) d[base | ((col.ceil - k) << 8)] = B.GLIMMERSTONE; }
        if (h > EMBER_LAVA) {
          const ground = d[base | (h << 8)], rr = ihash(wx, wz, s + 31);
          if (ground === B.ASH && rr < 0.012 && x > 1 && x < 14 && z > 1 && z < 14 && col.ceil - h > 12) {
            // charwood: a scorched trunk under a crown of glowing leaves
            const hg = 4 + (ihash(wx, wz, s + 32) * 3 | 0);
            for (let dy = -2; dy <= 1; dy++) { const rr2 = dy < 0 ? 2 : 1; for (let dz = -rr2; dz <= rr2; dz++) for (let dx = -rr2; dx <= rr2; dx++) if (!(Math.abs(dx) === rr2 && Math.abs(dz) === rr2 && ihash(wx + dx, wz + dz, dy + s) < 0.6)) setB(x + dx, h + hg + dy, z + dz, B.CINDER_LEAVES, true); }
            for (let k = 1; k <= hg; k++) setB(x, h + k, z, B.CHARWOOD_LOG);
          } else if (ground === B.ASH && rr < 0.03) d[base | ((h + 1) << 8)] = rr < 0.02 ? B.DEAD_BUSH : B.GLOWCAP;
        }
      }
      vein(B.ORE_CINDER, B.CINDERSTONE, 14, [3, 7], 6, 100);
      vein(B.ORE_EMBER, B.CINDERSTONE, 6, [3, 7], 6, 60);
      vein(B.ORE_SUNVEIN, B.CINDERSTONE, 3, [3, 6], 6, 50);
      vein(B.VOIDGLASS, B.CINDERSTONE, 4, [3, 6], EMBER_LAVA - 8, EMBER_LAVA + 3);
      vein(B.MAGMA, B.CINDERSTONE, 6, [4, 9], 6, 100);
    } else if (dim === 2) {
      const tint = c.tint = new Uint8Array(256).fill(1 + BIOME.AETHER);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const col = cols[x + z * 16], base = x | (z << 4), wx = ox + x, wz = oz + z, h = col.h;
        // drifting cloud banks between the islands
        const cl = fbm(g.R, (wx + this.ox) / 46, (wz + this.oz) / 46, 2) * 1.6, cy = 50 + Math.floor(g.T((wx + this.ox) / 260, (wz + this.oz) / 260) * 10);
        if (cl > 0.5 && (!h || cy < col.bottom - 3)) { d[base | (cy << 8)] = B.CLOUD; if (cl > 0.62) d[base | ((cy + 1) << 8)] = B.CLOUD; }
        if (!h) continue;
        const pond = col.edge > 0.92 && g.D((wx + this.ox) / 13 + 3, (wz + this.oz) / 13) < -0.52;
        for (let y = col.bottom; y <= h; y++) d[base | (y << 8)] = y === h ? (pond ? B.WATER : B.AETHER_GRASS) : y > h - 3 ? B.AETHER_SOIL : B.HALOSTONE;
        if (pond || h + 8 >= WH) continue;
        const rr = ihash(wx, wz, s + 31), treeP = col.grove > 0.25 ? 0.05 : 0.006;
        if (rr < treeP && x > 1 && x < 14 && z > 1 && z < 14 && col.edge > 0.5) {
          const hg = 4 + (ihash(wx, wz, s + 32) * 3 | 0), ty = h + hg;
          for (let ly = ty - 2; ly <= ty + 1; ly++) { const r2 = ly <= ty - 1 ? 2 : 1; for (let dz = -r2; dz <= r2; dz++) for (let dx = -r2; dx <= r2; dx++) if (!(Math.abs(dx) === r2 && Math.abs(dz) === r2 && (ly === ty + 1 || ihash(wx + dx, ly, wz + dz + s) < 0.5))) setB(x + dx, ly, z + dz, B.GILDED_LEAVES, true); }
          for (let k = 1; k <= hg; k++) setB(x, h + k, z, B.SILVER_LOG);
          d[base | (h << 8)] = B.AETHER_SOIL;
        } else if (rr > 0.5 && rr < 0.53) d[base | ((h + 1) << 8)] = B.STARBLOOM;
        else if (rr > 0.6 && rr < 0.74) d[base | ((h + 1) << 8)] = rr < 0.62 ? B.FLOWER_FROST : rr < 0.635 ? B.FLOWER_ROSE : B.TALLGRASS;
      }
      vein(B.ORE_AURORITE, B.HALOSTONE, 4, [2, 4], 40, 76);
      vein(B.ORE_SKYSHARD, B.HALOSTONE, 2, [2, 4], 40, 76);
      vein(B.ORE_SUNVEIN, B.HALOSTONE, 3, [3, 6], 40, 76);
      vein(B.ORE_AZURITE, B.HALOSTONE, 2, [3, 5], 40, 76);
    } else {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const col = cols[x + z * 16], base = x | (z << 4), wx = ox + x, wz = oz + z, h = col.h;
        if (!h) continue;
        for (let y = col.bottom; y <= h; y++) d[base | (y << 8)] = B.NULLSTONE;
        if (!col.main) { if (ihash(wx, wz, s + 31) < 0.02) d[base | ((h + 1) << 8)] = B.VOID_LAMP; continue; }
        // the King's court: a brick dais in the middle, ringed by lantern pillars
        if (col.r < 6.5) { d[base | (h << 8)] = B.NULL_BRICKS; if (col.r > 4.5) d[base | ((h + 1) << 8)] = B.NULL_BRICKS; }
        for (let k = 0; k < 10; k++) {
          const a = k / 10 * Math.PI * 2, px = Math.round(Math.cos(a) * 36), pz = Math.round(Math.sin(a) * 36);
          if (Math.abs(wx - px) <= 1 && Math.abs(wz - pz) <= 1) {
            const ph = 7 + (ihash(px, pz, s + 40) * 9 | 0), mid = wx === px && wz === pz;
            for (let y = h + 1; y <= h + ph; y++) d[base | (y << 8)] = B.NULL_BRICKS;
            if (mid) d[base | ((h + ph + 1) << 8)] = B.VOID_LAMP;
          }
        }
      }
    }
    const em = this.edits.get(ckey(c.cx, c.cz));
    if (em) for (const [i, id] of em) d[i] = id;
    c.recalcAll();
    c.dirty = true;
  },
  // a safe place to stand in a realm near (x, z): [x, y, z] of the block to stand in
  realmLanding(x, z) {
    if (this.dim === 3) { const c = this.realmColumn(0, 46); return [0, c.h + 1, 46]; }
    for (let r = 0; r < 400; r += 3) for (let a = 0; a < (r ? 12 : 1); a++) {
      const px = Math.round(x + Math.cos(a / 12 * Math.PI * 2) * r), pz = Math.round(z + Math.sin(a / 12 * Math.PI * 2) * r), c = this.realmColumn(px, pz);
      if (this.dim === 1 ? (!c.solid && c.h > EMBER_LAVA + 2 && c.ceil - c.h > 16) : (c.h > 0 && c.edge > 0.6)) {
        const flat = [[1, 0], [-1, 0], [0, 1], [0, -1], [4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3]].every(([dx, dz]) => { const n = this.realmColumn(px + dx, pz + dz); return n.h > 0 && Math.abs(n.h - c.h) <= (Math.abs(dx) + Math.abs(dz) > 1 ? 3 : 1) && !n.solid; });
        if (flat) return [px, c.h + 1, pz];
      }
    }
    return [x, 70, z];
  },
});
