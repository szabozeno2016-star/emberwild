/* =====================================================================
   World generation v2 — biomes, rivers, mountains, classic tree shapes.
   Worlds saved before v2 keep the original generator (World.gen === 1).
   ===================================================================== */
const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH: 4, DARK: 5, TAIGA: 6, SNOWY: 7, SNOWY_TAIGA: 8,
  DESERT: 9, SAVANNA: 10, SWAMP: 11, MOUNTAIN: 12, RIVER: 13, PEAKS: 14 };
const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Birch Forest', 'Dark Forest', 'Taiga', 'Snowy Plains', 'Snowy Taiga',
  'Desert', 'Savanna', 'Swamp', 'Windswept Hills', 'River', 'Snowy Peaks'];

// grass & leaf colours per biome (multipliers on the green parts of the textures)
const TINT_SWAMP = 1 + BIOME.SWAMP;
const TINTS = (() => {
  const out = new Float32Array(32 * 3).fill(1);
  const set = (b, c) => { out[(1 + b) * 3] = c[0]; out[(1 + b) * 3 + 1] = c[1]; out[(1 + b) * 3 + 2] = c[2]; };
  const plains = [1.04, 1.12, 0.72];
  set(BIOME.PLAINS, plains); set(BIOME.BEACH, plains); set(BIOME.RIVER, plains); set(BIOME.OCEAN, plains);
  set(BIOME.FOREST, [0.92, 1.06, 0.72]); set(BIOME.BIRCH, [1.0, 1.10, 0.74]); set(BIOME.DARK, [0.78, 0.96, 0.62]);
  set(BIOME.TAIGA, [0.80, 0.98, 0.84]); set(BIOME.SNOWY, [0.78, 0.94, 0.94]); set(BIOME.SNOWY_TAIGA, [0.78, 0.94, 0.94]);
  set(BIOME.DESERT, [1.24, 1.06, 0.56]); set(BIOME.SAVANNA, [1.34, 1.06, 0.48]); set(BIOME.SWAMP, [0.74, 0.84, 0.50]);
  set(BIOME.MOUNTAIN, [0.84, 1.0, 0.84]); set(BIOME.PEAKS, [0.84, 1.0, 0.84]);
  return out;
})();
const TINTED = new Uint8Array(256);
for (const id of [B.GRASS, B.OAK_LEAVES, B.BIRCH_LEAVES, B.PINE_LEAVES, B.TALLGRASS, B.BERRY_BUSH, B.REED, B.FLOWER_EMBER, B.FLOWER_SUN, B.FLOWER_FROST]) TINTED[id] = 1;

Object.assign(World.prototype, {
  initGen2() {
    const s = this.seed;
    // every noise is exactly zero at its origin (rivers and ridge crests all cross there), so move that far from spawn
    const r = mulberry32(s ^ 0x5eed1);
    this.ox = Math.floor((r() - 0.5) * 80000) + 0.37; this.oz = Math.floor((r() - 0.5) * 80000) + 0.61;
    this.g2 = {
      T: makeNoise2D(s ^ 0x1a2b), H: makeNoise2D(s ^ 0x2b3c), C: makeNoise2D(s ^ 0x3c4d), E: makeNoise2D(s ^ 0x4d5e),
      R: makeNoise2D(s ^ 0x5e6f), RV: makeNoise2D(s ^ 0x6f70), D: makeNoise2D(s ^ 0x7081), P: makeNoise2D(s ^ 0x8192), J: makeNoise2D(s ^ 0x92a3),
      W: makeNoise2D(s ^ 0xa3b4),
    };
  },
  climate(x, z) {
    const g = this.g2;
    const T = fbm(g.T, x / 900, z / 900, 2) * 1.6 + g.D(x / 70, z / 70) * 0.04;
    const Hm = fbm(g.H, x / 760 + 40, z / 760 - 20, 2) * 1.6 + g.D(z / 64, x / 64) * 0.04;
    return [T, Hm];
  },
  column2(wx, wz) {
    const g = this.g2, x = wx + this.ox, z = wz + this.oz;
    const [T, Hm] = this.climate(x, z);
    const C = fbm(g.C, x / 1100, z / 1100, 3) * 1.7 + 0.3;          // continents (higher = further inland)
    const E = fbm(g.E, x / 520, z / 520, 2) * 1.6;                     // erosion: high = flat land
    const ridge = 1 - Math.abs(fbm(g.R, x / 520, z / 520, 3) * 1.6);   // 1 along mountain crests
    const rv = Math.abs(fbm(g.RV, x / 620, z / 620, 2) * 1.6);        // ~0 along river lines
    const land = smoothstep(-0.16, 0.04, C);
    const oceanFloor = SEA - 5 - (1 - smoothstep(-0.7, -0.16, C)) * 16 + g.D(x / 40, z / 40) * 2;
    const plainsness = smoothstep(-0.05, -0.55, Hm) * smoothstep(-0.6, 0.0, T + 0.3);
    let amp = (3 + 11 * smoothstep(0.2, -0.6, E)) * (1 - 0.55 * plainsness);
    const hills = fbm(g.P, x / 170, z / 170, 4) * 1.4 * amp + g.D(x / 26, z / 26) * 1.1;
    const landH = SEA + 3 + Math.max(0, C) * 9 + hills;
    const mtn = smoothstep(0.42, 0.9, C * 0.45 + (ridge - 0.5) * 1.0 - E * 0.45);
    const peak = mtn * (18 + 38 * Math.pow(Math.max(0, ridge), 1.6) + fbm(g.J, x / 70, z / 70, 3) * 9);
    let h = lerp(oceanFloor, landH + peak, land);
    // rivers wind through the lowlands (they fade out on mountain flanks and in the sea)
    const rw = 0.022 + 0.012 * smoothstep(-0.4, 0.6, Hm);
    const rs = smoothstep(rw * 2.6, rw * 0.35, rv) * land * (1 - smoothstep(0.25, 0.7, mtn));
    if (rs > 0) h = lerp(h, Math.min(h, SEA - 3 + (1 - rs) * 3), rs);
    // swamps: very wet, temperate lowlands sit right at sea level with puddles
    const swampy = smoothstep(0.45, 0.7, Hm) * smoothstep(-0.25, 0.0, T) * smoothstep(0.45, 0.2, T) * land * (1 - mtn);
    if (swampy > 0) h = lerp(h, SEA + 0.6 + g.D(x / 9, z / 9) * 1.4, swampy * smoothstep(SEA + 12, SEA + 2, h));
    h = Math.max(4, Math.min(WH - 10, Math.floor(h)));
    // biome
    let biome;
    if (h < SEA - 1 && rs < 0.5) biome = BIOME.OCEAN;
    else if (rs > 0.55 && h < SEA + 1) biome = BIOME.RIVER;
    else if (h <= SEA + 1 && C < 0.08 && swampy < 0.3) biome = BIOME.BEACH;
    else if (mtn > 0.45 && h > SEA + 24) biome = h > SEA + 62 ? BIOME.PEAKS : BIOME.MOUNTAIN;
    else if (swampy > 0.4) biome = BIOME.SWAMP;
    else if (T < -0.58) biome = Hm > -0.05 ? BIOME.SNOWY_TAIGA : BIOME.SNOWY;
    else if (T < -0.28) biome = BIOME.TAIGA;
    else if (T < 0.44) biome = Hm < -0.18 ? BIOME.PLAINS : Hm < 0.16 ? BIOME.FOREST : Hm < 0.42 ? BIOME.BIRCH : BIOME.DARK;
    else biome = Hm < -0.02 ? BIOME.DESERT : BIOME.SAVANNA;
    if (this.gen >= 3) { const b3 = this.biome3(biome, x, z, T, Hm, h); biome = b3[0]; h = b3[1]; }
    return { h, biome, tint: 1 + biome, T, Hm, mtn, rs, forest: biome === BIOME.FOREST || biome === BIOME.DARK || biome === BIOME.BIRCH ? 0.5 : 0 };
  },

  treeAt2(gx, gz) {
    const s = this.seed;
    const tx = gx * 4 + Math.floor(ihash(gx, gz, s + 900) * 4), tz = gz * 4 + Math.floor(ihash(gz, gx, s + 901) * 4);
    const col = this.column2(tx, tz);
    if (col.h <= SEA || col.rs > 0.3) return null;
    const r = ihash(tx, tz, s + 902), r2 = ihash(tz, tx, s + 903);
    const B_ = BIOME; let p = 0, type = 'oak';
    switch (col.biome) {
      case B_.PLAINS: p = 0.025; type = r2 < 0.1 ? 'birch' : 'oak'; break;
      case B_.FOREST: p = 0.5; type = r2 < 0.08 ? 'bigoak' : r2 < 0.3 ? 'birch' : 'oak'; break;
      case B_.BIRCH: p = 0.5; type = r2 < 0.85 ? 'birch' : 'oak'; break;
      case B_.DARK: p = 0.8; type = r2 < 0.35 ? 'bigoak' : 'oak'; break;
      case B_.TAIGA: p = 0.55; type = 'spruce'; break;
      case B_.SNOWY_TAIGA: p = 0.45; type = 'spruce'; break;
      case B_.SNOWY: p = 0.012; type = 'spruce'; break;
      case B_.SAVANNA: p = 0.07; type = 'acacia'; break;
      case B_.SWAMP: p = 0.16; type = 'swamp'; break;
      case B_.MOUNTAIN: p = col.h < SEA + 50 ? 0.09 : 0; type = 'spruce'; break;
      case B_.DESERT: p = 0.06; type = 'cactus'; break;
      case B_.JUNGLE: p = 0.72; type = r2 < 0.3 ? 'jungle' : r2 < 0.55 ? 'bigoak' : 'oak'; break;
      case B_.BLOSSOM: p = 0.3; type = 'blossom'; break;
      case B_.AUTUMN: p = 0.5; type = r2 < 0.55 ? 'autumn' : r2 < 0.8 ? 'birch' : 'oak'; break;
      case B_.MEADOW: p = 0.008; type = r2 < 0.5 ? 'blossom' : 'oak'; break;
      case B_.MUSHROOM: p = 0.1; type = 'gmush'; break;
      case B_.ICE_SPIKES: p = 0.09; type = 'spike'; break;
      case B_.PALM_BEACH: p = 0.14; type = 'palm'; break;
      case B_.MESA: p = 0.02; type = 'cactus'; break;
      case B_.ASHLANDS: p = 0.035; type = 'char'; break;
      default: p = 0;
    }
    if (r > p) return null;
    const hr = ihash(tx, tz, s + 904);
    const hgt = { oak: 4 + (hr * 3 | 0), birch: 5 + (hr * 3 | 0), spruce: 7 + (hr * 4 | 0), bigoak: 9 + (hr * 4 | 0), acacia: 5 + (hr * 2 | 0), swamp: 4 + (hr * 3 | 0), cactus: 1 + (hr * 3 | 0),
      jungle: 11 + (hr * 7 | 0), blossom: 5 + (hr * 2 | 0), autumn: 5 + (hr * 3 | 0), gmush: 4 + (hr * 3 | 0), spike: 6 + (hr * hr * 18 | 0), palm: 5 + (hr * 3 | 0), char: 3 + (hr * 4 | 0) }[type];
    return { x: tx, z: tz, y: col.h + 1, type, hgt, biome: col.biome };
  },

  generate2(c) {
    const ox = c.cx * 16, oz = c.cz * 16, d = c.data, s = this.seed;
    // heights for this chunk plus a one-block ring (for slopes)
    const cols = new Array(256), ring = new Int16Array(18 * 18);
    for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) {
      const col = this.column2(ox + x, oz + z);
      ring[(x + 1) + (z + 1) * 18] = col.h;
      if (x >= 0 && x < 16 && z >= 0 && z < 16) cols[x + z * 16] = col;
    }
    const tint = c.tint = new Uint8Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const col = cols[x + z * 16], h = col.h, wx = ox + x, wz = oz + z, base = x | (z << 4);
      const jx = ((ihash(wx, wz, s + 701) * 9) | 0) - 4, jz = ((ihash(wz, wx, s + 702) * 9) | 0) - 4;
      tint[base] = (jx || jz) ? this.column2(wx + jx, wz + jz).tint : col.tint;
      const hN = ring[(x + 1) + z * 18], hS = ring[(x + 1) + (z + 2) * 18], hW = ring[x + (z + 1) * 18], hE = ring[(x + 2) + (z + 1) * 18];
      const slope = Math.max(Math.abs(h - hN), Math.abs(h - hS), Math.abs(h - hW), Math.abs(h - hE));
      const n1 = ihash(wx, wz, s + 9);
      let top = B.GRASS, fill = B.DIRT, depth = 3 + (n1 * 2 | 0), under = 0, mesa = false;
      switch (col.biome) {
        case BIOME.OCEAN: top = fill = h < SEA - 9 ? (this.g2.D(wx / 18, wz / 18) > 0.25 ? B.CLAY : B.GRAVEL) : B.SAND; break;
        case BIOME.RIVER: top = fill = this.g2.D(wx / 12, wz / 12) > 0.3 ? B.GRAVEL : this.g2.D(wz / 15, wx / 15) > 0.45 ? B.CLAY : B.SAND; break;
        case BIOME.BEACH: top = fill = B.SAND; depth = 4; under = B.SANDSTONE; break;
        case BIOME.DESERT: top = fill = B.SAND; depth = 4; under = B.SANDSTONE; break;
        case BIOME.SNOWY: case BIOME.SNOWY_TAIGA: top = B.SNOW_GRASS; break;
        case BIOME.PEAKS: top = B.SNOW; fill = B.STONE; depth = 2; break;
        case BIOME.MOUNTAIN:
          if (slope >= 3 || h > SEA + 52 + n1 * 6) { top = fill = B.STONE; }
          if (h > SEA + 58 + (this.g2.D(wx / 14, wz / 14) * 5)) top = B.SNOW;
          else if (this.g2.D(wx / 11, wz / 11) > 0.55) top = fill = B.GRAVEL;
          break;
        case BIOME.SAVANNA: if (slope >= 4) { top = fill = B.STONE; } break;
        case BIOME.FROZEN_OCEAN: top = fill = B.GRAVEL; break;
        case BIOME.PALM_BEACH: top = fill = B.SAND; depth = 4; under = B.SANDSTONE; break;
        case BIOME.ICE_SPIKES: top = fill = B.SNOW; depth = 2; break;
        case BIOME.MESA: mesa = true; break;
        case BIOME.AUTUMN: if (this.g2.D(wx / 16 + 9, wz / 16) > 0.25) top = B.LOAM; if (slope >= 5) top = fill = B.STONE; break;
        case BIOME.MUSHROOM: top = B.SPORE_SOIL; break;
        case BIOME.ASHLANDS:
          fill = B.BASALT; depth = 3;
          top = slope === 0 && this.g2.D(wx / 13 - 9, wz / 13 + 4) < -0.56 ? B.LAVA : this.g2.D(wx / 9, wz / 9) > 0.42 ? B.MAGMA : this.g2.D(wx / 17 + 5, wz / 17) > 0.25 ? B.BASALT : B.ASH;
          break;
        default: if (slope >= 5 && h > SEA + 6) { top = fill = B.STONE; }
      }
      if (h < SEA && (top === B.GRASS || top === B.SNOW_GRASS)) { top = B.DIRT; }
      const basaltTop = 8 + Math.floor(this.g2.D(wx / 20, wz / 20) * 3);
      for (let y = 0; y <= h; y++) {
        let b;
        if (y === 0) b = B.BEDROCK;
        else if (y <= 2 && ihash(wx * 3 + y, wz, s) < 0.5) b = B.BEDROCK;
        else if (mesa && y > h - 24 && y > SEA - 3) b = y === h && slope <= 1 ? B.RED_SAND : MESA_BANDS[(y + (ihash(wx >> 3, wz >> 3, s + 61) * 2 | 0)) % MESA_BANDS.length];
        else if (y === h) b = top;
        else if (y > h - depth) b = fill;
        else if (under && y > h - depth - 4) b = under;
        else if (y < basaltTop) b = B.BASALT;
        else b = B.STONE;
        d[base | (y << 8)] = b;
      }
      for (let y = h + 1; y <= SEA; y++) d[base | (y << 8)] = B.WATER;
      if (col.biome === BIOME.FROZEN_OCEAN && h < SEA && this.g2.D(wx / 23, wz / 23) > -0.3) d[base | (SEA << 8)] = B.ICE;
    }
    // ores
    const rnd = mulberry32(ihash(c.cx, c.cz, s + 77) * 4294967296 | 0);
    const vein = (ore, count, size, ymin, ymax) => {
      for (let n = 0; n < count; n++) {
        let x = rnd() * 16 | 0, z = rnd() * 16 | 0, y = ymin + (rnd() * (ymax - ymin) | 0);
        const len = size[0] + (rnd() * (size[1] - size[0] + 1) | 0);
        for (let k = 0; k < len; k++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WH) {
            const i = x | (z << 4) | (y << 8);
            if (d[i] === B.STONE || d[i] === B.BASALT) d[i] = ore;
          }
          const r = rnd() * 6 | 0;
          if (r === 0) x++; else if (r === 1) x--; else if (r === 2) z++; else if (r === 3) z--; else if (r === 4) y++; else y--;
        }
      }
    };
    vein(B.ORE_COAL, 16, [4, 10], 6, 100);
    vein(B.ORE_SUNVEIN, 4, [3, 6], 4, 40);
    vein(B.ORE_EMBER, 4, [3, 7], 3, 22);
    vein(B.ORE_AZURITE, 2, [3, 6], 4, 28);
    vein(B.ORE_SKYSHARD, 1, [2, 4], 2, 15);
    if (rnd() < 0.5) vein(B.ORE_VERDITE, 1, [1, 3], 5, 40);
    vein(B.GRAVEL, 2, [8, 16], 6, 70);
    // trees
    const put = (x, y, z, id, force) => {
      const lx = x - ox, lz = z - oz;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WH) return;
      const i = lx | (lz << 4) | (y << 8), cur = d[i];
      if (force ? (cur === 0 || cur === B.TALLGRASS || isLeaves(cur) || cur === B.WATER || REPLACEABLE[cur] || cur === B.DIRT || cur === B.GRASS || cur === B.SNOW_GRASS)
        : (cur === 0 || cur === B.TALLGRASS || cur === B.DEAD_BUSH)) d[i] = id;
    };
    const blob = (cx, cy, cz, r, leaf, salt) => {
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const dd = dx * dx + dy * dy * 1.6 + dz * dz;
        if (dd > r * r + 0.3) continue;
        if (dd > (r - 1) * (r - 1) && ihash(cx + dx, cy + dy, cz + dz + salt) < 0.25) continue;
        put(cx + dx, cy + dy, cz + dz, leaf);
      }
    };
    const M = 8, G = 4;
    const g0x = Math.floor((ox - M) / G), g1x = Math.floor((ox + 15 + M) / G), g0z = Math.floor((oz - M) / G), g1z = Math.floor((oz + 15 + M) / G);
    const treeCols = new Set();
    for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) {
      const t = this.treeAt2(gx, gz); if (!t) continue;
      const { x, y, z, type, hgt } = t;
      const r = (a, b, c2) => ihash(a, b, c2 + s);
      const inChunk = x >= ox && x < ox + 16 && z >= oz && z < oz + 16;
      if (inChunk) treeCols.add((x - ox) + (z - oz) * 16);
      if (type === 'cactus') {
        if (!inChunk) continue;
        for (let k = 0; k < hgt; k++) put(x, y + k, z, B.CACTUS);
        continue;
      }
      const top = y + hgt - 1;
      if (type === 'spike') {
        // a tapering spire of ice
        for (let k = -1; k < hgt; k++) { const rr = Math.round(2.3 * Math.pow(1 - Math.max(0, k) / hgt, 1.4)); for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) if (dx * dx + dz * dz <= rr * rr + 1) put(x + dx, y + k, z + dz, B.ICE, true); }
        continue;
      }
      if (type === 'gmush') {
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue; put(x + dx, top, z + dz, B.MUSHROOM_CAP); if (Math.abs(dx) < 2 && Math.abs(dz) < 2) put(x + dx, top + 1, z + dz, B.MUSHROOM_CAP); }
        for (let ly = y; ly < top; ly++) put(x, ly, z, B.MUSHROOM_STEM, true);
        continue;
      }
      if (type === 'palm') {
        for (let ly = y; ly <= top; ly++) put(x, ly, z, B.PALM_LOG, true);
        put(x, top + 1, z, B.PALM_LEAVES);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { put(x + dx, top + 1, z + dz, B.PALM_LEAVES); put(x + dx * 2, top + 1, z + dz * 2, B.PALM_LEAVES); put(x + dx * 3, top, z + dz * 3, B.PALM_LEAVES); }
        for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { put(x + dx, top, z + dz, B.PALM_LEAVES); put(x + dx * 2, top - 1, z + dz * 2, B.PALM_LEAVES); }
        continue;
      }
      if (type === 'char') {
        for (let ly = y; ly <= top; ly++) put(x, ly, z, B.CHARWOOD_LOG, true);
        if (hgt > 3) { const dd = [[1, 0], [-1, 0], [0, 1], [0, -1]][r(x, z, 5) * 4 | 0]; put(x + dd[0], top - 1, z + dd[1], B.CHARWOOD_LOG, true); }
        continue;
      }
      const log = type === 'spruce' ? B.PINE_LOG : type === 'birch' || type === 'blossom' ? B.BIRCH_LOG : B.OAK_LOG;
      const leaf = type === 'spruce' ? B.PINE_LEAVES : type === 'birch' ? B.BIRCH_LEAVES : type === 'blossom' ? B.BLOSSOM_LEAVES : type === 'autumn' ? B.AUTUMN_LEAVES : B.OAK_LEAVES;
      if (type === 'oak' || type === 'birch' || type === 'swamp' || type === 'blossom' || type === 'autumn') {
        const wide = type === 'swamp' ? 3 : 2;
        for (let ly = top - 2; ly <= top + 1; ly++) {
          const rr = ly <= top - 1 ? wide : 1;
          for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
            const corner = Math.abs(dx) === rr && Math.abs(dz) === rr;
            if (corner && (ly === top + 1 || r(x + dx, ly, z + dz) < 0.5)) continue;
            if (rr === 3 && Math.abs(dx) + Math.abs(dz) > 4) continue;
            put(x + dx, ly, z + dz, leaf);
          }
        }
        for (let ly = y; ly <= top; ly++) put(x, ly, z, log, true);
      } else if (type === 'spruce') {
        const bare = 1 + (r(x, y, z) * 2 | 0);
        const pattern = [0, 1, 1, 2, 1, 2, 3, 2, 3, 2, 3, 3];
        for (let ly = top + 1, k = 0; ly >= y + bare; ly--, k++) {
          const rr = pattern[Math.min(k, pattern.length - 1)];
          for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
            if (rr && Math.abs(dx) + Math.abs(dz) > rr + (rr > 1 ? 1 : 0)) continue;
            put(x + dx, ly, z + dz, leaf);
          }
        }
        for (let ly = y; ly <= top; ly++) put(x, ly, z, log, true);
      } else if (type === 'bigoak' || type === 'jungle') {
        for (let ly = y; ly <= top; ly++) put(x, ly, z, log, true);
        blob(x, top + 1, z, type === 'jungle' ? 3.4 : 2.8, leaf, 1);
        const nb = 2 + (r(x, z, 7) * 3 | 0);
        for (let b = 0; b < nb; b++) {
          const a = r(x, z, 20 + b) * Math.PI * 2, by = y + Math.floor(hgt * (0.5 + 0.35 * r(z, x, 30 + b)));
          const len = 3 + (r(x, z, 40 + b) * 2 | 0);
          let bx = x, bz = z, yy = by;
          for (let k = 1; k <= len; k++) {
            bx = x + Math.round(Math.cos(a) * k); bz = z + Math.round(Math.sin(a) * k); yy = by + (k >> 1);
            put(bx, yy, bz, log, true);
          }
          blob(bx, yy + 1, bz, 2.2, leaf, b + 2);
        }
      } else if (type === 'acacia') {
        const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][r(x, z, 5) * 4 | 0];
        const straight = 2 + (r(x, z, 6) * 2 | 0);
        let tx = x, tz = z, ty = y;
        for (; ty < y + straight; ty++) put(tx, ty, tz, log, true);
        for (let k = 0; k < hgt - straight; k++) { tx += dir[0]; tz += dir[1]; put(tx, ty, tz, log, true); ty++; }
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          put(tx + dx, ty, tz + dz, leaf);
        }
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) put(tx + dx, ty + 1, tz + dz, leaf);
      }
      if (inChunk) { const i = (x - ox) | ((z - oz) << 4) | ((y - 1) << 8); if (d[i] === B.GRASS || d[i] === B.SNOW_GRASS) d[i] = B.DIRT; }
    }
    // ground cover
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const col = cols[x + z * 16], h = col.h;
      if (h + 2 >= WH) continue;
      const base = x | (z << 4), wx = ox + x, wz = oz + z;
      const topB = d[base | (h << 8)];
      if (d[base | ((h + 1) << 8)] !== 0 || treeCols.has(x + z * 16)) continue;
      const rr = ihash(wx, wz, s + 31), patch = this.g2.D(wx / 30 + 7, wz / 30 - 3);
      if ((topB === B.SAND || topB === B.GRASS) && h >= SEA && h <= SEA + 1) {
        const hAt = (ax, az) => ring[(ax + 1) + (az + 1) * 18];
        if ((hAt(x + 1, z) < SEA || hAt(x - 1, z) < SEA || hAt(x, z + 1) < SEA || hAt(x, z - 1) < SEA) && rr < 0.3 && col.biome !== BIOME.SNOWY) {
          d[base | ((h + 1) << 8)] = B.REED; if (rr < 0.15 && h + 3 < WH) d[base | ((h + 2) << 8)] = B.REED; continue;
        }
      }
      let id = 0;
      switch (col.biome) {
        case BIOME.PLAINS:
          if (rr < 0.003) id = B.BERRY_BUSH;
          else if (patch > 0.35 && rr < 0.14) id = patch > 0.6 ? B.FLOWER_SUN : ihash(wx, wz, s + 32) < 0.5 ? B.FLOWER_EMBER : B.FLOWER_FROST;
          else if (rr < 0.32) id = B.TALLGRASS;
          break;
        case BIOME.FOREST: case BIOME.BIRCH:
          if (rr < 0.006) id = B.BERRY_BUSH; else if (rr < 0.02) id = patch > 0 ? B.FLOWER_FROST : B.FLOWER_SUN; else if (rr < 0.16) id = B.TALLGRASS; break;
        case BIOME.DARK:
          if (rr < 0.035) id = ihash(wx, wz, s + 33) < 0.5 ? B.MUSHROOM_RED : B.MUSHROOM_BROWN; else if (rr < 0.12) id = B.TALLGRASS; break;
        case BIOME.TAIGA:
          if (rr < 0.012) id = B.BERRY_BUSH; else if (rr < 0.02) id = B.MUSHROOM_BROWN; else if (rr < 0.18) id = B.TALLGRASS; break;
        case BIOME.SAVANNA: if (rr < 0.38) id = B.TALLGRASS; else if (rr < 0.39) id = B.FLOWER_SUN; break;
        case BIOME.DESERT: if (rr < 0.012 && topB === B.SAND) id = B.DEAD_BUSH; break;
        case BIOME.SWAMP: if (rr < 0.03) id = B.MUSHROOM_BROWN; else if (rr < 0.14) id = B.TALLGRASS; break;
        case BIOME.MOUNTAIN: if (topB === B.GRASS && rr < 0.08) id = B.TALLGRASS; break;
        case BIOME.BEACH: case BIOME.PALM_BEACH: if (topB === B.SAND && rr < 0.004) id = B.DEAD_BUSH; break;
        case BIOME.JUNGLE: if (rr < 0.26) id = B.FERN; else if (rr < 0.4) id = B.TALLGRASS; else if (rr < 0.41) id = B.BERRY_BUSH; break;
        case BIOME.BLOSSOM: if (rr < 0.1) id = ihash(wx, wz, s + 34) < 0.6 ? B.FLOWER_ROSE : B.FLOWER_VIOLET; else if (rr < 0.26) id = B.TALLGRASS; break;
        case BIOME.AUTUMN: if (rr < 0.02) id = B.MUSHROOM_BROWN; else if (rr < 0.03) id = B.BERRY_BUSH; else if (rr < 0.14) id = B.TALLGRASS; else if (rr < 0.2) id = B.FERN; break;
        case BIOME.MEADOW:
          if (rr < 0.3) id = [B.FLOWER_SUN, B.FLOWER_EMBER, B.FLOWER_FROST, B.FLOWER_VIOLET, B.FLOWER_ROSE][(ihash(wx >> 2, wz >> 2, s + 35) * 5) | 0]; else if (rr < 0.56) id = B.TALLGRASS; break;
        case BIOME.MUSHROOM: if (rr < 0.06) id = ihash(wx, wz, s + 33) < 0.5 ? B.MUSHROOM_RED : B.MUSHROOM_BROWN; else if (rr < 0.085) id = B.GLOWCAP; break;
        case BIOME.MESA: if (rr < 0.01 && topB === B.RED_SAND) id = B.DEAD_BUSH; break;
        case BIOME.ASHLANDS: if (rr < 0.015 && topB === B.ASH) id = B.DEAD_BUSH; break;
      }
      if (id === B.DEAD_BUSH || topB === B.GRASS || topB === B.SPORE_SOIL || topB === B.LOAM) { if (id) d[base | ((h + 1) << 8)] = id; }
      // mossy boulders in forests and hills
      if (!id && topB === B.GRASS && (col.biome === BIOME.TAIGA || col.biome === BIOME.MOUNTAIN || col.biome === BIOME.DARK) && ihash(wx, wz, s + 51) < 0.003 && x > 0 && x < 15 && z > 0 && z < 15) {
        for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx * dx + dz * dz + dy * dy * 2 > 2.2) continue;
          d[(x + dx) | ((z + dz) << 4) | ((h + 1 + dy - (dy === 0 && (dx || dz) ? 1 : 0)) << 8)] = ihash(wx + dx, wz + dz, dy + s) < 0.55 ? B.MOSSY : B.COBBLE;
        }
      }
    }
    this.carveCaves(c, cols);
    const em = this.edits.get(ckey(c.cx, c.cz));
    if (em) for (const [i, id] of em) d[i] = id;
    c.recalcAll();
    c.dirty = true;
  },
  biomeAt(x, z) { return this.dim ? BIOME.EMBERDEEP + this.dim - 1 : this.gen === 1 ? null : this.column2(Math.floor(x), Math.floor(z)).biome; },
});
