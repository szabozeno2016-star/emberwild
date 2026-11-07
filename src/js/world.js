/* =====================================================================
   World: chunks, terrain generation, lighting, meshing
   ===================================================================== */
function makeValue3D(seed) {
  const h = (x, y, z) => ihash(x + seed * 7, y, z ^ seed) * 2 - 1;
  const s = t => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), tx = s(x - xi), ty = s(y - yi), tz = s(z - zi);
    const a = lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), tx), lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), tx), tz);
    const b = lerp(lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), tx), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), tx), tz);
    return lerp(a, b, ty);
  };
}
// edits: per chunk [int16 cx][int16 cz][uint16 n] then n x [lx|lz<<4][y][id]  -> base64
function encodeEditMap(edits) {
  let size = 0; for (const em of edits.values()) size += 6 + em.size * 3;
  const buf = new Uint8Array(size), dv = new DataView(buf.buffer); let o = 0;
  for (const [k, em] of edits) {
    if (!em.size) continue;
    dv.setInt16(o, (k << 16) >> 16); dv.setInt16(o + 2, k >> 16); dv.setUint16(o + 4, Math.min(em.size, 65535)); o += 6;
    let n = 0;
    for (const [i, id] of em) { if (n++ >= 65535) break; buf[o++] = (i & 15) | (((i >> 4) & 15) << 4); buf[o++] = i >> 8; buf[o++] = id; }
  }
  let s = ''; const CH8 = 0x8000;
  for (let i = 0; i < o; i += CH8) s += String.fromCharCode.apply(null, buf.subarray(i, Math.min(o, i + CH8)));
  return btoa(s);
}
function decodeEditMap(str) {
  const out = new Map(); if (!str) return out;
  let bin; try { bin = atob(str); } catch (e) { return out; }
  const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const dv = new DataView(buf.buffer); let o = 0;
  while (o + 6 <= buf.length) {
    const cx = dv.getInt16(o), cz = dv.getInt16(o + 2), n = dv.getUint16(o + 4); o += 6;
    const em = new Map();
    for (let j = 0; j < n && o + 3 <= buf.length; j++) {
      const a = buf[o++], y = buf[o++], id = buf[o++];
      if (y < WH && (BLOCKS[id] || id === 0)) em.set((a & 15) | (((a >> 4) & 15) << 4) | (y << 8), id);
    }
    out.set(ckey(cx, cz), em);
  }
  return out;
}
const ckey = (cx, cz) => ((cx & 0xffff) | ((cz & 0xffff) << 16)) | 0;

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.data = new Uint8Array(CH * CH * WH);
    this.H = new Int16Array(256).fill(-1);
    this.maxY = 0;
    this.emitters = new Set();
    this.dirty = true; this.mesh = null; this.modified = false; this.meshedOnce = false;
  }
  recalcColumn(x, z) {
    let y = WH - 1; const d = this.data, base = x | (z << 4);
    while (y >= 0 && !SKYBLOCK[d[base | (y << 8)]]) y--;
    this.H[base] = y;
  }
  recalcAll() {
    let my = 0; const d = this.data;
    for (let i = 0; i < 256; i++) {
      let top = -1, sky = -1;
      for (let y = WH - 1; y >= 0; y--) {
        const b = d[i | (y << 8)];
        if (b && top < 0) top = y;
        if (SKYBLOCK[b]) { sky = y; break; }
      }
      this.H[i] = sky; if (top > my) my = top;
    }
    this.maxY = Math.min(WH - 1, my + 1);
    this.emitters.clear();
    for (let i = 0; i < d.length; i++) if (EMIT[d[i]]) this.emitters.add(i);
  }
}

class World {
  constructor(seed, gen) {
    this.seed = seed | 0;
    this.gen = gen === 1 ? 1 : 2;
    this.chunks = new Map();
    this.edits = new Map();   // ckey -> Map(localIndex -> blockId): every change made after generation
    this.editVer = 0; this.onEdit = null; this.chests = new Map();
    this.nV1 = makeValue3D(this.seed ^ 0x5151); this.nV2 = makeValue3D(this.seed ^ 0x6262); this.nV3 = makeValue3D(this.seed ^ 0x7373);
    this.nEnt = makeNoise2D(this.seed ^ 0xabcd);
    const s = this.seed;
    this.nC = makeNoise2D(s ^ 0x1234); this.nH = makeNoise2D(s ^ 0x2345); this.nD = makeNoise2D(s ^ 0x3456);
    this.nM = makeNoise2D(s ^ 0x4567); this.nMM = makeNoise2D(s ^ 0x5678); this.nF = makeNoise2D(s ^ 0x6789);
    this.nT = makeNoise2D(s ^ 0x789a); this.nP = makeNoise2D(s ^ 0x89ab); this.nS = makeNoise2D(s ^ 0x9abc);
    if (this.gen === 2) this.initGen2();
  }
  getChunk(cx, cz) { return this.chunks.get(ckey(cx, cz)); }
  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK; if (y >= WH) return 0;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return c ? c.data[(x & 15) | ((z & 15) << 4) | (y << 8)] : 0;
  }
  isLoaded(x, z) { return this.chunks.has(ckey(x >> 4, z >> 4)); }
  // surface height of light-blocking column (for spawning, sky exposure)
  skyHeight(x, z) {
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return c ? c.H[(x & 15) | ((z & 15) << 4)] : -1;
  }
  setBlock(x, y, z, id, remote) {
    if (y < 0 || y >= WH) return false;
    const cx = x >> 4, cz = z >> 4, c = this.chunks.get(ckey(cx, cz));
    if (!c) return false;
    const lx = x & 15, lz = z & 15, i = lx | (lz << 4) | (y << 8);
    const old = c.data[i]; if (old === id) return false;
    c.data[i] = id; c.modified = true;
    const k = ckey(cx, cz); let em = this.edits.get(k); if (!em) { em = new Map(); this.edits.set(k, em); }
    em.set(i, id); this.editVer++;
    if (!remote && this.onEdit) this.onEdit(x, y, z, id);
    if (EMIT[old]) c.emitters.delete(i);
    if (EMIT[id]) c.emitters.add(i);
    c.recalcColumn(lx, lz);
    if (id && y + 1 > c.maxY) c.maxY = Math.min(WH - 1, y + 1);
    // remesh: own chunk now, neighbours (light reach) soon
    c.dirty = true; c.urgent = true;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const n = this.chunks.get(ckey(cx + dx, cz + dz));
      if (!n) continue;
      n.dirty = true;
      const touching = (dx === -1 && lx === 0) || (dx === 1 && lx === 15) || dx === 0;
      const touchingZ = (dz === -1 && lz === 0) || (dz === 1 && lz === 15) || dz === 0;
      if (touching && touchingZ) n.urgent = true;
    }
    return true;
  }

  // ---------------- terrain ----------------
  column(x, z) { return this.gen === 1 ? this.column1(x, z) : this.column2(x, z); }
  column1(x, z) {
    const cont = fbm(this.nC, x / 520, z / 520, 3) + 0.18;
    const hills = fbm(this.nH, x / 130, z / 130, 4);
    const det = this.nD(x / 28, z / 28);
    const ridge = 1 - Math.abs(this.nM(x / 260, z / 260));
    const mMask = smoothstep(0.12, 0.6, cont + 0.3 * this.nMM(x / 800, z / 800));
    let h = SEA + 3 + cont * 13 + hills * (4 + 9 * mMask) + det * 1.3 + mMask * ridge * ridge * ridge * 42;
    h = Math.max(4, Math.min(WH - 14, Math.floor(h)));
    const forest = this.nF(x / 210, z / 210);
    return { h, forest, mnt: mMask };
  }
  treeAt(gx, gz) {
    // jittered grid of tree candidates (cell 5x5)
    const s = this.seed;
    const tx = gx * 5 + Math.floor(ihash(gx, gz, s) * 5), tz = gz * 5 + Math.floor(ihash(gz, gx, s + 1) * 5);
    const col = this.column(tx, tz);
    if (col.h <= SEA + 1) return null;
    let p;
    if (col.h > SEA + 22) p = 0.32; else if (col.forest > 0.28) p = 0.82; else if (col.forest > 0.05) p = 0.3; else p = 0.045;
    if (ihash(tx, tz, s + 2) > p) return null;
    if (col.h > SEA + 36) return null;
    let type;
    const temp = this.nT(tx / 300, tz / 300);
    if (col.h > SEA + 18) type = 'pine';
    else if (temp > 0.25 || ihash(tx, tz, s + 3) < 0.18) type = 'birch';
    else type = 'oak';
    const hgt = type === 'pine' ? 6 + Math.floor(ihash(tx, tz, s + 4) * 4) : type === 'birch' ? 5 + Math.floor(ihash(tx, tz, s + 4) * 3) : 4 + Math.floor(ihash(tx, tz, s + 4) * 3);
    return { x: tx, z: tz, y: col.h + 1, type, hgt };
  }
  generate(c) { return this.gen === 1 ? this.generate1(c) : this.generate2(c); }
  generate1(c) {
    const ox = c.cx * 16, oz = c.cz * 16, d = c.data, s = this.seed;
    const cols = new Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = ox + x, wz = oz + z;
      const col = this.column(wx, wz); cols[x + z * 16] = col;
      const h = col.h;
      const dirtDepth = 3 + Math.floor(ihash(wx, wz, s + 9) * 2);
      const basaltTop = 8 + Math.floor(this.nS(wx / 20, wz / 20) * 3);
      let top, filler;
      if (h < SEA - 1) { top = this.nS(wx / 30, wz / 30) > 0.2 ? B.DIRT : B.SAND; filler = top; }
      else if (h <= SEA + 1) { top = B.SAND; filler = B.SAND; }
      else if (h > SEA + 50 + Math.floor(this.nS(wx / 14, wz / 14) * 3)) { top = B.SNOW; filler = B.STONE; }
      else if (h > SEA + 34 || (h > SEA + 27 && this.nS(wx / 9, wz / 9) > 0.15)) { top = B.STONE; filler = B.STONE; }
      else { top = B.GRASS; filler = B.DIRT; }
      const base = x | (z << 4);
      for (let y = 0; y <= h; y++) {
        let b;
        if (y === 0) b = B.BEDROCK;
        else if (y <= 2 && ihash(wx * 3 + y, wz, s) < 0.5) b = B.BEDROCK;
        else if (y === h) b = top;
        else if (y > h - dirtDepth) b = filler;
        else if (y < basaltTop) b = B.BASALT;
        else b = B.STONE;
        d[base | (y << 8)] = b;
      }
      for (let y = h + 1; y <= SEA; y++) d[base | (y << 8)] = B.WATER;
    }
    // ores (random-walk veins, confined to this chunk)
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
    vein(B.ORE_COAL, 14, [4, 9], 6, 72);
    vein(B.ORE_SUNVEIN, 3, [3, 6], 4, 34);
    vein(B.ORE_EMBER, 4, [3, 7], 3, 22);
    vein(B.ORE_AZURITE, 2, [3, 6], 4, 28);
    vein(B.ORE_SKYSHARD, 1, [2, 4], 2, 15);
    if (rnd() < 0.5) vein(B.ORE_VERDITE, 1, [1, 3], 5, 40);
    // exposed coal on mountain faces (so early players find some)
    // trees (with margin so canopies cross chunk borders seamlessly)
    const put = (x, y, z, id, force) => {
      const lx = x - ox, lz = z - oz;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 0 || y >= WH) return;
      const i = lx | (lz << 4) | (y << 8), cur = d[i];
      if (force || cur === 0 || cur === B.TALLGRASS || (isLeaves(id) && false)) d[i] = id;
    };
    const g0x = Math.floor((ox - 4) / 5), g1x = Math.floor((ox + 19) / 5), g0z = Math.floor((oz - 4) / 5), g1z = Math.floor((oz + 19) / 5);
    const treeCols = new Set();
    for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) {
      const t = this.treeAt(gx, gz); if (!t) continue;
      const { x, y, z, type, hgt } = t;
      const r = (a, b, c2) => ihash(a, b, c2 + s);
      const log = type === 'pine' ? B.PINE_LOG : type === 'birch' ? B.BIRCH_LOG : B.OAK_LOG;
      const leaf = type === 'pine' ? B.PINE_LEAVES : type === 'birch' ? B.BIRCH_LEAVES : B.OAK_LEAVES;
      const topY = y + hgt - 1;
      if (type === 'pine') {
        for (let ly = topY + 1; ly >= y + 2; ly--) {
          const dist = topY + 1 - ly;
          let rr = dist === 0 ? 0 : dist === 1 ? 1 : (dist % 2 === 0 ? 2 : 1);
          if (dist > 5) rr = dist % 2 === 0 ? 3 : 2;
          for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
            if (dx * dx + dz * dz > rr * rr + 0.5) continue;
            put(x + dx, ly, z + dz, leaf);
          }
        }
      } else {
        for (let ly = topY - 2; ly <= topY + 1; ly++) {
          const rr = ly >= topY ? 1 : 2;
          for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
            const corner = Math.abs(dx) === rr && Math.abs(dz) === rr;
            if (corner && (ly === topY + 1 || r(x + dx, ly, z + dz) < 0.55)) continue;
            put(x + dx, ly, z + dz, leaf);
          }
        }
      }
      for (let ly = y; ly <= topY; ly++) put(x, ly, z, log, true);
      if (x >= ox && x < ox + 16 && z >= oz && z < oz + 16) {
        treeCols.add((x - ox) + (z - oz) * 16);
        put(x, y - 1, z, B.DIRT, true);
      }
    }
    // ground cover
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const col = cols[x + z * 16], h = col.h;
      if (h + 1 >= WH) continue;
      const base = x | (z << 4);
      const topB = d[base | (h << 8)], wx = ox + x, wz = oz + z;
      if (d[base | ((h + 1) << 8)] !== 0 || treeCols.has(x + z * 16)) continue;
      // reeds along the shoreline
      if ((topB === B.SAND || topB === B.GRASS) && h >= SEA && h <= SEA + 1) {
        const hAt = (ax, az) => (ax >= 0 && ax < 16 && az >= 0 && az < 16) ? cols[ax + az * 16].h : this.column(ox + ax, oz + az).h;
        if ((hAt(x + 1, z) < SEA || hAt(x - 1, z) < SEA || hAt(x, z + 1) < SEA || hAt(x, z - 1) < SEA) && ihash(wx, wz, s + 41) < 0.35) { d[base | ((h + 1) << 8)] = B.REED; continue; }
      }
      if (topB !== B.GRASS) continue;
      // mossy boulders
      if (ihash(wx, wz, s + 51) < 0.0016 && x > 0 && x < 15 && z > 0 && z < 15 && h + 2 < WH) {
        for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx * dx + dz * dz + dy * dy * 2 > 2.2) continue;
          const i = (x + dx) | ((z + dz) << 4) | ((h + 1 + dy - (dy === 0 && (dx || dz) ? 1 : 0)) << 8);
          d[i] = ihash(wx + dx, wz + dz, dy + s) < 0.55 ? B.MOSSY : B.COBBLE;
        }
        continue;
      }
      const r = ihash(wx, wz, s + 31);
      const patch = this.nP(wx / 38, wz / 38);
      let id = 0;
      if (col.forest > 0.05) {
        if (r < 0.012) id = B.BERRY_BUSH;
        else if (r < 0.07) id = B.TALLGRASS;
        else if (col.forest > 0.25 && r < 0.085) id = ihash(wx, wz, s + 33) < 0.5 ? B.MUSHROOM_RED : B.MUSHROOM_BROWN;
        else if (patch > 0.5 && r < 0.2) id = B.FLOWER_FROST;
      } else {
        if (r < 0.004) id = B.BERRY_BUSH;
        else if (patch > 0.42 && r < 0.2) id = patch > 0.62 ? B.FLOWER_SUN : (ihash(wx, wz, s + 32) < 0.5 ? B.FLOWER_EMBER : B.FLOWER_SUN);
        else if (r < 0.11) id = B.TALLGRASS;
      }
      if (id) d[base | ((h + 1) << 8)] = id;
    }
    this.carveCaves(c, cols);
    const em = this.edits.get(ckey(c.cx, c.cz));
    if (em) for (const [i, id] of em) d[i] = id;
    c.recalcAll();
    c.dirty = true;
  }
  // spaghetti tunnels + caverns from coarse 3D value noise, trilinearly interpolated
  carveCaves(c, cols) {
    const ox = c.cx * 16, oz = c.cz * 16, d = c.data, S = 4, NY = (WH / S) + 1;
    const L1 = new Float32Array(5 * 5 * NY), L2 = new Float32Array(5 * 5 * NY), L3 = new Float32Array(5 * 5 * NY);
    for (let k = 0; k < 5; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < 5; i++) {
      const x = ox + i * S, y = j * S, z = oz + k * S, n = i + k * 5 + j * 25;
      L1[n] = this.nV1(x / 22, y / 14, z / 22); L2[n] = this.nV2(x / 22, y / 14, z / 22); L3[n] = this.nV3(x / 30, y / 18, z / 30);
    }
    const lerpL = (L, x, y, z) => {
      const fx = x / S, fy = y / S, fz = z / S, i0 = fx | 0, j0 = fy | 0, k0 = fz | 0, tx = fx - i0, ty = fy - j0, tz = fz - k0;
      const i1 = Math.min(4, i0 + 1), k1 = Math.min(4, k0 + 1), j1 = Math.min(NY - 1, j0 + 1);
      const g = (i, j, k) => L[i + k * 5 + j * 25];
      const a = lerp(lerp(g(i0, j0, k0), g(i1, j0, k0), tx), lerp(g(i0, j0, k1), g(i1, j0, k1), tx), tz);
      const b = lerp(lerp(g(i0, j1, k0), g(i1, j1, k0), tx), lerp(g(i0, j1, k1), g(i1, j1, k1), tx), tz);
      return lerp(a, b, ty);
    };
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const h = cols[x + z * 16].h;
      if (h < SEA) continue; // keep sea floors sealed
      const ent = this.nEnt((ox + x) / 60, (oz + z) / 60) > 0.55;
      const top = ent ? h : h - 4;
      for (let y = 3; y <= top; y++) {
        const i = x | (z << 4) | (y << 8), b = d[i];
        if (!b || b === B.BEDROCK || b === B.WATER) continue;
        const a1 = lerpL(L1, x, y, z), a2 = lerpL(L2, x, y, z);
        let hole = Math.abs(a1) < 0.07 && Math.abs(a2) < 0.07;
        if (!hole && y < 42) hole = lerpL(L3, x, y, z) > 0.66 - (42 - y) * 0.003;
        if (hole) {
          d[i] = 0;
          // grass that loses its floor-to-sky dirt stays natural
          if (y + 1 <= h && d[i + 256] === B.TALLGRASS) d[i + 256] = 0;
        }
      }
      // cave floors: glowcaps and mushrooms
      for (let y = 4; y < h - 5; y++) {
        const i = x | (z << 4) | (y << 8);
        if (d[i] || !OPAQUE[d[i - 256]] || d[i - 256] === B.BEDROCK) continue;
        const r = ihash((ox + x) * 7 + y, oz + z, this.seed + 61);
        if (r < 0.007) d[i] = B.GLOWCAP; else if (r < 0.014) d[i] = B.MUSHROOM_BROWN;
      }
    }
  }
  // block edits (base64), then chest contents as JSON after a '|' (base64 never contains one)
  encodeEdits() {
    const e = encodeEditMap(this.edits), c = [];
    for (const ch of this.chests.values()) { const s = encodeSlots(ch.s); if (s.length) c.push([ch.x, ch.y, ch.z, ch.v | 0, s]); }
    return c.length ? e + '|' + JSON.stringify(c) : e;
  }
  loadEdits(str) {
    str = String(str || ''); const cut = str.indexOf('|');
    this.edits = decodeEditMap(cut < 0 ? str : str.slice(0, cut)); this.chests = new Map();
    if (cut >= 0) try {
      for (const c of JSON.parse(str.slice(cut + 1))) if (Array.isArray(c)) {
        const ch = this.chestAt(c[0] | 0, c[1] | 0, c[2] | 0, true); ch.v = c[3] | 0; ch.s = decodeSlots(c[4], 27);
      }
    } catch (e) { }
    this.editVer++;
  }
  chestAt(x, y, z, create) {
    const k = x + ',' + y + ',' + z; let c = this.chests.get(k);
    if (!c && create) { c = { x, y, z, v: 0, s: new Array(27).fill(null) }; this.chests.set(k, c); }
    return c || null;
  }
  // find a dry spawn column near origin
  findSpawn() {
    // gen 2: flat, friendly ground first (temperate grassland or woods), then anything that isn't water or a cliff
    const passes = this.gen === 1 ? [[null, 400, 99]] : [[[BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH], 260, 2],
      [[BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH, BIOME.TAIGA, BIOME.SAVANNA, BIOME.SNOWY, BIOME.DARK, BIOME.DESERT], 400, 3]];
    for (const [ok, maxR, flat] of passes) for (let r = 0; r < maxR; r += 4) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r), z = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
        const col = this.column(x, z);
        if (!(col.h > SEA + 2 && col.h < SEA + 20 && (!ok || ok.includes(col.biome)))) continue;
        if (flat < 99 && [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dz]) => Math.abs(this.column(x + dx, z + dz).h - col.h) > flat)) continue;
        return [x + 0.5, col.h + 1, z + 0.5];
      }
    }
    return [0.5, this.column(0, 0).h + 1, 0.5];
  }
}

/* ---------------- lighting + meshing ---------------- */
const LR = 15, RW = CH + LR * 2, RC = RW * RW, RSZ = RC * WH;
const rB = new Uint8Array(RSZ), rSky = new Uint8Array(RSZ), rBlk = new Uint8Array(RSZ), rH = new Int16Array(RC);
const lq = new Int32Array(1 << 20);

class VBuf {
  constructor(cap) { this.a = new Float32Array(cap || 36 * 4096); this.n = 0; this.quads = 0; }
  reset() { this.n = 0; this.quads = 0; }
  grow(k) { if (this.n + k > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  v(x, y, z, u, v, l, s, sky, blk) {
    const a = this.a, n = this.n;
    a[n] = x; a[n + 1] = y; a[n + 2] = z; a[n + 3] = u; a[n + 4] = v; a[n + 5] = l; a[n + 6] = s; a[n + 7] = sky; a[n + 8] = blk;
    this.n = n + 9;
  }
}
const FACES = [
  { n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0], shade: 0.66 },
  { n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0], shade: 0.66 },
  { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1], shade: 1.0 },
  { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], shade: 0.5 },
  { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], shade: 0.84 },
  { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0], shade: 0.84 },
];
const offOf = v => v[0] + v[2] * RW + v[1] * RC;
const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; // BL BR TR TL (r,u)
const CORNER_UV = [[0, 1], [1, 1], [1, 0], [0, 0]];
for (const f of FACES) {
  f.no = offOf(f.n);
  f.corners = CORNER_SIGNS.map(([sr, su]) => {
    const p = [0, 1, 2].map(k => 0.5 + f.n[k] * 0.5 + f.r[k] * sr * 0.5 + f.u[k] * su * 0.5);
    const o1 = offOf(f.r) * sr, o2 = offOf(f.u) * su;
    return { p, s1: f.no + o1, s2: f.no + o2, c: f.no + o1 + o2 };
  });
}
const AO_CURVE = [0.48, 0.66, 0.82, 1.0];
const MESH = { opaque: new VBuf(), cutout: new VBuf(), water: new VBuf() };

function buildLight(world, c) {
  // gather 3x3 neighbourhood
  const nb = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) nb.push(world.getChunk(c.cx + i, c.cz + j));
  rB.fill(0); rSky.fill(0); rBlk.fill(0);
  let maxY = 0;
  for (const n of nb) if (n && n.maxY > maxY) maxY = n.maxY;
  maxY = Math.min(WH - 1, maxY + 1);
  // copy blocks + heights for region columns
  for (let rz = 0; rz < RW; rz++) {
    const lz = rz - LR, cj = (lz >> 4) + 1, z = lz & 15;
    for (let ci = 0; ci < 3; ci++) {
      const ch = nb[ci + cj * 3];
      const x0 = Math.max(0, ci * 16 - 16 + LR), x1 = Math.min(RW, ci * 16 + LR); // region x range in this chunk
      if (x0 >= x1) continue;
      const lx0 = (x0 - LR) & 15;
      if (!ch) { for (let rx = x0; rx < x1; rx++) rH[rx + rz * RW] = -1; continue; }
      const len = x1 - x0, src = ch.data;
      for (let y = 0; y <= ch.maxY; y++) {
        const s0 = lx0 | (z << 4) | (y << 8), d0 = y * RC + rz * RW + x0;
        for (let k = 0; k < len; k++) rB[d0 + k] = src[s0 + k];
      }
      for (let k = 0; k < len; k++) rH[x0 + k + rz * RW] = ch.H[(lx0 + k) | (z << 4)];
    }
  }
  // ---- sky light BFS ----
  let qh = 0, qt = 0;
  const QM = lq.length - 1;
  for (let rz = 0; rz < RW; rz++) for (let rx = 0; rx < RW; rx++) {
    const col = rx + rz * RW, h = rH[col];
    if (h < 0) continue;
    // top blocker that lets light through (leaves)
    const ti = h * RC + col;
    if (LIGHTPASS[rB[ti]] && rSky[ti] < 13) { rSky[ti] = 13; lq[qt++ & QM] = ti; }
    // horizontal exposure from lower neighbour columns
    for (let k = 0; k < 4; k++) {
      const nx = rx + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = rz + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || nz < 0 || nx >= RW || nz >= RW) continue;
      const hn = rH[nx + nz * RW];
      if (hn >= h) continue;
      for (let y = Math.max(0, hn + 1); y < h; y++) {
        const i = y * RC + col;
        if (LIGHTPASS[rB[i]] && rSky[i] < 14) { rSky[i] = 14; lq[qt++ & QM] = i; }
      }
    }
  }
  while (qh < qt) {
    const i = lq[qh++ & QM], L = rSky[i];
    if (L <= 1) continue;
    const y = (i / RC) | 0, rem = i - y * RC, rz = (rem / RW) | 0, rx = rem - rz * RW;
    const nL = L - 1;
    // 6 neighbours
    for (let k = 0; k < 6; k++) {
      let j;
      if (k === 0) { if (rx >= RW - 1) continue; j = i + 1; }
      else if (k === 1) { if (rx <= 0) continue; j = i - 1; }
      else if (k === 2) { if (rz >= RW - 1) continue; j = i + RW; }
      else if (k === 3) { if (rz <= 0) continue; j = i - RW; }
      else if (k === 4) { if (y >= WH - 1) continue; j = i + RC; }
      else { if (y <= 0) continue; j = i - RC; }
      const jy = k === 4 ? y + 1 : k === 5 ? y - 1 : y;
      if (jy > rH[j - jy * RC]) continue; // already full sky
      const b = rB[j];
      if (!LIGHTPASS[b]) continue;
      const v = SKYBLOCK[b] ? nL - 1 : nL;
      if (rSky[j] < v) { rSky[j] = v; lq[qt++ & QM] = j; }
    }
  }
  // ---- block light BFS ----
  qh = qt = 0;
  for (let n = 0; n < 9; n++) {
    const ch = nb[n]; if (!ch || !ch.emitters.size) continue;
    const ci = n % 3, cj = (n / 3) | 0;
    for (const e of ch.emitters) {
      const ex = e & 15, ez = (e >> 4) & 15, ey = e >> 8;
      const rx = (ci - 1) * 16 + ex + LR, rz = (cj - 1) * 16 + ez + LR;
      if (rx < 0 || rz < 0 || rx >= RW || rz >= RW) continue;
      const i = ey * RC + rz * RW + rx;
      const L = EMIT[ch.data[e]];
      if (rBlk[i] < L) { rBlk[i] = L; lq[qt++ & QM] = i; }
    }
  }
  while (qh < qt) {
    const i = lq[qh++ & QM], L = rBlk[i];
    if (L <= 1) continue;
    const y = (i / RC) | 0, rem = i - y * RC, rz = (rem / RW) | 0, rx = rem - rz * RW;
    const nL = L - 1;
    for (let k = 0; k < 6; k++) {
      let j;
      if (k === 0) { if (rx >= RW - 1) continue; j = i + 1; }
      else if (k === 1) { if (rx <= 0) continue; j = i - 1; }
      else if (k === 2) { if (rz >= RW - 1) continue; j = i + RW; }
      else if (k === 3) { if (rz <= 0) continue; j = i - RW; }
      else if (k === 4) { if (y >= WH - 1) continue; j = i + RC; }
      else { if (y <= 0) continue; j = i - RC; }
      if (!LIGHTPASS[rB[j]]) continue;
      if (rBlk[j] < nL) { rBlk[j] = nL; lq[qt++ & QM] = j; }
    }
  }
  // fill full-sky cells for chunk + 1 border so lookups are branch-free
  for (let rz = LR - 1; rz <= LR + 16; rz++) for (let rx = LR - 1; rx <= LR + 16; rx++) {
    const col = rx + rz * RW;
    for (let y = Math.max(0, rH[col] + 1); y < WH; y++) rSky[y * RC + col] = 15;
  }
  return maxY;
}

function meshChunk(world, c) {
  const maxY = buildLight(world, c);
  const O = MESH.opaque, CU = MESH.cutout, W = MESH.water;
  O.reset(); CU.reset(); W.reset();
  const ox = c.cx * 16, oz = c.cz * 16, s = world.seed;
  const ymax = Math.min(WH - 1, c.maxY);
  const aoL = [0, 0, 0, 0], skL = [0, 0, 0, 0], bkL = [0, 0, 0, 0];
  for (let y = 0; y <= ymax; y++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const idx = y * RC + (lz + LR) * RW + (lx + LR);
    const id = rB[idx];
    if (!id) continue;
    const rt = RTYPE[id];
    const wx = ox + lx, wz = oz + lz;
    if (rt === RT_CUBE) {
      const buf = CUTOUT[id] ? CU : O;
      const isLeaf = isLeaves(id);
      for (let f = 0; f < 6; f++) {
        if (f === 3 && y === 0) continue;
        const F = FACES[f];
        const nbId = rB[idx + F.no];
        if (OPAQUE[nbId]) continue;
        if (CUTOUT[id] && nbId === id) continue;
        if (isLeaf && isLeaves(nbId)) continue;
        let layer = FACE_TEX[id][f];
        if (id === B.GRASS && f !== 2 && f !== 3) {
          const hh = ihash(wx, y, wz + f);
          if (hh < 0.12) layer = TEX.grass_side2;
          if (rB[idx + RC] === B.GRASS || OPAQUE[rB[idx + RC]]) layer = TEX.dirt;
        }
        // AO + smooth light
        for (let k = 0; k < 4; k++) {
          const C = F.corners[k];
          const o = idx + F.no, s1 = idx + C.s1, s2 = idx + C.s2, cc = idx + C.c;
          const a1 = AOCAST[rB[s1]], a2 = AOCAST[rB[s2]], a3 = AOCAST[rB[cc]];
          aoL[k] = (a1 && a2) ? 0 : 3 - (a1 + a2 + a3);
          let sk = rSky[o], bk = rBlk[o], cnt = 1;
          if (!OPAQUE[rB[s1]]) { sk += rSky[s1]; bk += rBlk[s1]; cnt++; }
          if (!OPAQUE[rB[s2]]) { sk += rSky[s2]; bk += rBlk[s2]; cnt++; }
          if (!(OPAQUE[rB[s1]] && OPAQUE[rB[s2]]) && !OPAQUE[rB[cc]]) { sk += rSky[cc]; bk += rBlk[cc]; cnt++; }
          skL[k] = sk / cnt / 15; bkL[k] = bk / cnt / 15;
        }
        // random rotation of top textures to break tiling
        let rot = 0;
        if (f === 2 && (id === B.GRASS || id === B.SAND || id === B.DIRT || id === B.STONE)) rot = (ihash(wx, wz, s + 5) * 4) | 0;
        const flip = (aoL[0] + skL[0] * 2 + aoL[2] + skL[2] * 2) < (aoL[1] + skL[1] * 2 + aoL[3] + skL[3] * 2);
        const flags = (isLeaf ? 4 : 0) + (TINTED[id] && c.tint ? c.tint[lx | (lz << 4)] * 16 : 0);
        buf.grow(36);
        for (let q = 0; q < 4; q++) {
          const k = flip ? (q + 1) & 3 : q;
          const C = F.corners[k], uvk = CORNER_UV[(k + rot) & 3];
          buf.v(wx + C.p[0], y + C.p[1], wz + C.p[2], uvk[0], uvk[1], layer, F.shade * AO_CURVE[aoL[k]] + flags, skL[k], bkL[k]);
        }
        buf.quads++;
      }
    } else if (rt === RT_CROSS) {
      const sk = rSky[idx] / 15, bk = rBlk[idx] / 15, layer = FACE_TEX[id][0];
      const jx = (ihash(wx, wz, s + 8) - 0.5) * 0.3, jz = (ihash(wz, wx, s + 8) - 0.5) * 0.3;
      const cx0 = wx + 0.5 + jx, cz0 = wz + 0.5 + jz, e = 0.43;
      const hgt = id === B.TALLGRASS ? 0.8 + ihash(wx, wz, 3) * 0.25 : 1;
      const wave = (id === B.TALLGRASS || id === B.REED || id === B.DEAD_BUSH || (id >= B.FLOWER_EMBER && id <= B.FLOWER_FROST)) ? 2 : 0, em = (EMIT[id] ? 8 : 0) + (TINTED[id] && c.tint ? c.tint[lx | (lz << 4)] * 16 : 0);
      CU.grow(72);
      for (const [ax, az] of [[1, 1], [1, -1]]) {
        const x0 = cx0 - ax * e, z0 = cz0 - az * e, x1 = cx0 + ax * e, z1 = cz0 + az * e;
        CU.v(x0, y, z0, 0, 1, layer, 0.92 + em, sk, bk);
        CU.v(x1, y, z1, 1, 1, layer, 0.92 + em, sk, bk);
        CU.v(x1, y + hgt, z1, 1, 0, layer, 0.92 + wave + em, sk, bk);
        CU.v(x0, y + hgt, z0, 0, 0, layer, 0.92 + wave + em, sk, bk);
        CU.quads++;
      }
    } else if (rt === RT_LIQUID) {
      const above = rB[idx + RC];
      const topH = above === B.WATER ? 1 : 0.875;
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        const nbId = rB[idx + F.no];
        if (nbId === B.WATER || OPAQUE[nbId]) continue;
        if (f === 3 && y === 0) continue;
        const o = idx + F.no;
        const sk = Math.max(rSky[o], rSky[idx]) / 15, bk = Math.max(rBlk[o], rBlk[idx]) / 15;
        let dep = 0; for (let k = idx; dep < 6 && k >= 0 && rB[k] === B.WATER; k -= RC) dep++;
        const depthF = f === 2 ? Math.min(1, (dep - 1) / 5) : 0.5;
        W.grow(36);
        for (let k = 0; k < 4; k++) {
          const C = F.corners[k], uvk = CORNER_UV[k];
          const py = C.p[1] === 1 ? topH : 0;
          W.v(wx + C.p[0], y + py, wz + C.p[2], uvk[0], uvk[1] * (f === 2 || f === 3 ? 1 : topH), TEX.water, depthF, sk, bk);
        }
        W.quads++;
      }
    } else if (rt === RT_TORCH) {
      emitTorch(CU, id, wx, y, wz, rSky[idx] / 15, 1);
    } else if (rt === RT_CAMPFIRE) {
      emitCampfire(CU, wx, y, wz, rSky[idx] / 15, rBlk[idx] / 15);
    } else if (rt === RT_DOOR) {
      // the half with a door below it is the top half
      const k = id - B.DOOR, side = (k & 1) ? ((k >> 1) + 1) & 3 : k >> 1, t = 3 / 16;
      const L = isDoor(rB[idx - RC]) ? TEX.door_top : TEX.door_bottom;
      const bx = DOOR_BOX[side], full = [0, 0, 1, 1], thin = [0, 0, t, 1];
      const uv = side & 1 ? [full, full, thin, thin, thin, thin] : [thin, thin, [0, 0, 1, t], [0, 0, 1, t], full, full];
      emitBox(CU, wx + bx[0], y, wz + bx[1], wx + bx[2], y + 1, wz + bx[3], L, uv, 1, rSky[idx] / 15, rBlk[idx] / 15, 0, null);
    } else if (rt === RT_LADDER) {
      const k = id - B.LADDER, e = 1 / 16, d = 0.02;
      const bx = k === 0 ? [d, 0, d + e, 1] : k === 1 ? [1 - d - e, 0, 1 - d, 1] : k === 2 ? [0, d, 1, d + e] : [0, 1 - d - e, 1, 1 - d];
      const T_ = TEX.ladder, layers = k < 2 ? [T_, T_, -1, -1, -1, -1] : [-1, -1, -1, -1, T_, T_];
      emitBox(CU, wx + bx[0], y, wz + bx[1], wx + bx[2], y + 1, wz + bx[3], layers, [0, 0, 1, 1], 1, rSky[idx] / 15, rBlk[idx] / 15, 0, null);
    } else if (rt === RT_BED) {
      const ft = FACE_TEX[id];
      emitBox(CU, wx, y, wz, wx + 1, y + 0.56, wz + 1, ft, [[0, 0.44, 1, 1], [0, 0.44, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1], [0, 0.44, 1, 1], [0, 0.44, 1, 1]], 1, Math.max(rSky[idx], rSky[idx + RC]) / 15, Math.max(rBlk[idx], rBlk[idx + RC]) / 15, 0, null);
    }
  }
  return { opaque: O, cutout: CU, water: W };
}

// door panel footprint per side: [x0, z0, x1, z1]
const DOOR_BOX = [[0, 0, 1, 3 / 16], [13 / 16, 0, 1, 1], [0, 13 / 16, 1, 1], [0, 0, 3 / 16, 1]];
// generic textured box, optional transform fn(p)->p ; uvr = [u0,v0,u1,v1] per face or single
function emitBox(buf, x0, y0, z0, x1, y1, z1, layers, uvr, shadeMul, sky, blk, flags, xf) {
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    const L = Array.isArray(layers) ? layers[f] : layers;
    if (L < 0) continue;
    const r = Array.isArray(uvr[0]) ? uvr[f] : uvr;
    buf.grow(36);
    for (let k = 0; k < 4; k++) {
      const C = F.corners[k], uvk = CORNER_UV[k];
      let p = [x0 + (x1 - x0) * C.p[0], y0 + (y1 - y0) * C.p[1], z0 + (z1 - z0) * C.p[2]];
      if (xf) p = xf(p);
      buf.v(p[0], p[1], p[2], lerp(r[0], r[2], uvk[0]), lerp(r[1], r[3], uvk[1]), L, F.shade * shadeMul + flags, sky, blk);
    }
    buf.quads++;
  }
}
const TORCH_UV_STICK = [7 / 16, 6 / 16, 9 / 16, 1];
const TORCH_UV_FLAME = [7 / 16, 2 / 16, 9 / 16, 6 / 16];
function torchXf(id, wx, y, wz) {
  if (id === B.TORCH) return p => [wx + p[0], y + p[1], wz + p[2]];
  const k = id - B.TORCH_W0; // 0: support at -x, 1: +x, 2: -z, 3: +z
  const dx = k === 0 ? 1 : k === 1 ? -1 : 0, dz = k === 2 ? 1 : k === 3 ? -1 : 0;
  const tilt = 0.38;
  return p => {
    // pivot around base centre, lean away from wall
    let lx = p[0] - 0.5, ly = p[1], lz = p[2] - 0.5;
    const ca = Math.cos(tilt), sa = Math.sin(tilt);
    // rotate in plane (d, y)
    const along = lx * dx + lz * dz;
    const nAlong = along * ca + ly * sa, nY = -along * sa + ly * ca;
    lx += (nAlong - along) * dx; lz += (nAlong - along) * dz;
    return [wx + 0.5 + lx - dx * 0.38, y + nY + 0.2, wz + 0.5 + lz - dz * 0.38];
  };
}
function emitCampfire(buf, wx, y, wz, sky, blk) {
  const L = TEX.camp_log, E = TEX.oak_top, xf = p => [wx + p[0], y + p[1], wz + p[2]];
  emitBox(buf, 0.08, 0, 0.34, 0.92, 0.2, 0.62, [E, E, L, L, L, L], [0, 0, 1, 0.3], 1, sky, blk, 0, xf);
  emitBox(buf, 0.34, 0.12, 0.08, 0.62, 0.32, 0.92, [L, L, L, L, E, E], [0, 0, 1, 0.3], 1, sky, blk, 0, xf);
  const F = TEX.fire;
  for (const [ax, az] of [[1, 1], [1, -1]]) {
    const e = 0.4, x0 = 0.5 - ax * e, z0 = 0.5 - az * e, x1 = 0.5 + ax * e, z1 = 0.5 + az * e;
    buf.grow(36);
    buf.v(wx + x0, y + 0.12, wz + z0, 0, 1, F, 1 + 8, sky, 1); buf.v(wx + x1, y + 0.12, wz + z1, 1, 1, F, 1 + 8, sky, 1);
    buf.v(wx + x1, y + 1.0, wz + z1, 1, 0, F, 1 + 10, sky, 1); buf.v(wx + x0, y + 1.0, wz + z0, 0, 0, F, 1 + 10, sky, 1);
    buf.quads++;
  }
}
function emitTorch(buf, id, wx, y, wz, sky, blk) {
  const xf = torchXf(id, wx, y, wz);
  const t = TEX.torch;
  emitBox(buf, 7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16, [t, t, -1, t, t, t], TORCH_UV_STICK, 1, sky, blk, 0, xf);
  emitBox(buf, 7 / 16, 10 / 16, 7 / 16, 9 / 16, 13 / 16, 9 / 16, t, [[7 / 16, 2 / 16, 9 / 16, 5 / 16], [7 / 16, 2 / 16, 9 / 16, 5 / 16], [7 / 16, 3 / 16, 9 / 16, 5 / 16], [7 / 16, 5 / 16, 9 / 16, 6 / 16], [7 / 16, 2 / 16, 9 / 16, 5 / 16], [7 / 16, 2 / 16, 9 / 16, 5 / 16]], 1, sky, 1, 8, xf);
}
