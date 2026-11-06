/* =====================================================================
   Physics, raycasting, particles, item drops, creatures
   ===================================================================== */
function solidAt(world, x, y, z) {
  if (y < 0) return 1; if (y >= WH) return 0;
  const c = world.chunks.get(ckey(x >> 4, z >> 4));
  if (!c) return 1;
  return SOLID[c.data[(x & 15) | ((z & 15) << 4) | (y << 8)]];
}
function aabbHitsSolid(world, x0, y0, z0, x1, y1, z1) {
  const ax = Math.floor(x0), bx = Math.floor(x1 - 1e-7), ay = Math.floor(y0), by = Math.floor(y1 - 1e-7), az = Math.floor(z0), bz = Math.floor(z1 - 1e-7);
  for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) if (solidAt(world, x, y, z)) return true;
  return false;
}
// e: {pos, vel, hw, h, onGround}; returns collision flags
function moveEntity(world, e, dx, dy, dz, sneakGuard) {
  const p = e.pos, hw = e.hw, h = e.h;
  const res = { x: false, y: false, z: false };
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.4));
  const sx = dx / steps, sy = dy / steps, sz = dz / steps;
  let landed = false;
  for (let s = 0; s < steps; s++) {
    // Y
    if (sy && !res.y) {
      const ny = p[1] + sy;
      if (aabbHitsSolid(world, p[0] - hw, ny, p[2] - hw, p[0] + hw, ny + h, p[2] + hw)) {
        if (sy < 0) { p[1] = Math.floor(ny) + 1; landed = true; }
        else { p[1] = Math.ceil(ny + h) - 1 - h - 1e-4; }
        res.y = true;
      } else p[1] = ny;
    }
    // X
    if (sx) {
      const nx = p[0] + sx;
      let blocked = aabbHitsSolid(world, nx - hw, p[1], p[2] - hw, nx + hw, p[1] + h, p[2] + hw);
      if (!blocked && sneakGuard && !aabbHitsSolid(world, nx - hw, p[1] - 0.6, p[2] - hw, nx + hw, p[1] - 0.01, p[2] + hw)) blocked = true;
      if (blocked) {
        if (sx > 0) p[0] = Math.max(p[0], Math.ceil(nx + hw) - 1 - hw - 1e-4); else p[0] = Math.min(p[0], Math.floor(nx - hw) + 1 + hw + 1e-4);
        res.x = true;
      } else p[0] = nx;
    }
    // Z
    if (sz) {
      const nz = p[2] + sz;
      let blocked = aabbHitsSolid(world, p[0] - hw, p[1], nz - hw, p[0] + hw, p[1] + h, nz + hw);
      if (!blocked && sneakGuard && !aabbHitsSolid(world, p[0] - hw, p[1] - 0.6, nz - hw, p[0] + hw, p[1] - 0.01, nz + hw)) blocked = true;
      if (blocked) {
        if (sz > 0) p[2] = Math.max(p[2], Math.ceil(nz + hw) - 1 - hw - 1e-4); else p[2] = Math.min(p[2], Math.floor(nz - hw) + 1 + hw + 1e-4);
        res.z = true;
      } else p[2] = nz;
    }
  }
  e.onGround = landed || (dy <= 0 && aabbHitsSolid(world, p[0] - hw, p[1] - 0.03, p[2] - hw, p[0] + hw, p[1], p[2] + hw));
  return res;
}
// ---- voxel raycast (DDA) ----
function raycast(world, o, d, maxDist) {
  let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
  const stx = d[0] > 0 ? 1 : -1, sty = d[1] > 0 ? 1 : -1, stz = d[2] > 0 ? 1 : -1;
  const tdx = d[0] ? Math.abs(1 / d[0]) : Infinity, tdy = d[1] ? Math.abs(1 / d[1]) : Infinity, tdz = d[2] ? Math.abs(1 / d[2]) : Infinity;
  let tmx = d[0] ? (stx > 0 ? x + 1 - o[0] : o[0] - x) * tdx : Infinity;
  let tmy = d[1] ? (sty > 0 ? y + 1 - o[1] : o[1] - y) * tdy : Infinity;
  let tmz = d[2] ? (stz > 0 ? z + 1 - o[2] : o[2] - z) * tdz : Infinity;
  let n = [0, 0, 0], t = 0;
  for (let i = 0; i < 64; i++) {
    const id = world.getBlock(x, y, z);
    if (TARGETABLE[id]) return { x, y, z, id, n, t };
    if (tmx < tmy && tmx < tmz) { x += stx; t = tmx; tmx += tdx; n = [-stx, 0, 0]; }
    else if (tmy < tmz) { y += sty; t = tmy; tmy += tdy; n = [0, -sty, 0]; }
    else { z += stz; t = tmz; tmz += tdz; n = [0, 0, -stz]; }
    if (t > maxDist) return null;
  }
  return null;
}
function rayAABB(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = 1e9;
  const lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) return -1; continue; }
    let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
// approximate light at a point (for entities)
function lightAt(world, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const H = world.skyHeight(bx, bz);
  let sky = by > H ? 1 : Math.max(0.25, 1 - (H - by) * 0.09);
  let blk = 0;
  const cx = bx >> 4, cz = bz >> 4;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const c = world.getChunk(cx + i, cz + j); if (!c || !c.emitters.size) continue;
    for (const e of c.emitters) {
      const ex = (cx + i) * 16 + (e & 15), ez = (cz + j) * 16 + ((e >> 4) & 15), ey = e >> 8;
      const dd = Math.abs(ex - bx) + Math.abs(ey - by) + Math.abs(ez - bz);
      const v = (14 - dd) / 15; if (v > blk) blk = v;
    }
  }
  return [sky, blk];
}
function torchNear(world, x, y, z, r) {
  const cx = x >> 4, cz = z >> 4;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const c = world.getChunk(cx + i, cz + j); if (!c || !c.emitters.size) continue;
    for (const e of c.emitters) {
      const ex = (cx + i) * 16 + (e & 15), ez = (cz + j) * 16 + ((e >> 4) & 15), ey = e >> 8;
      if (Math.abs(ex - x) + Math.abs(ey - y) + Math.abs(ez - z) <= r) return true;
    }
  }
  return false;
}

/* ---------------- particles ---------------- */
const Particles = {
  list: [],
  burst(x, y, z, layer, n, opts) {
    opts = opts || {};
    if (n > 1) n = Math.max(1, Math.round(n * Math.min(1.4, Settings.particles)));
    for (let i = 0; i < n; i++) {
      if (this.list.length > 900) this.list.shift();
      const sp = opts.speed || 2.6;
      this.list.push({
        x: x + (Math.random() - 0.5) * (opts.spread || 0.8), y: y + (Math.random() - 0.5) * (opts.spread || 0.8), z: z + (Math.random() - 0.5) * (opts.spread || 0.8),
        vx: (Math.random() - 0.5) * sp, vy: Math.random() * sp * 0.9 + (opts.up || 0.8), vz: (Math.random() - 0.5) * sp,
        life: 0, max: (opts.life || 0.7) + Math.random() * 0.5, layer,
        u0: opts.full ? 0 : (Math.random() * 12 | 0) / 16, v0: opts.full ? 0 : (Math.random() * 12 | 0) / 16, us: opts.full ? 1 : 4 / 16,
        size: (opts.size || 0.09) * (0.7 + Math.random() * 0.6), grav: opts.grav === undefined ? 14 : opts.grav, emissive: !!opts.emissive, drag: opts.drag || 0,
        grow: opts.grow || 0, L: null, blink: !!opts.blink, ph: Math.random() * 6.28, upd: opts.upd || null,
      });
    }
  },
  update(world, dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life += dt;
      if (p.life > p.max) { L.splice(i, 1); continue; }
      if (p.upd) p.upd(p, dt);
      p.vy -= p.grav * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (p.grav > 0 && solidAt(world, Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        p.vx *= 0.3; p.vz *= 0.3; p.vy = 0;
      } else { p.x = nx; p.y = ny; p.z = nz; }
      p.size += p.grow * dt;
    }
  },
  render(world, camR, camU) {
    const d = R.dyn;
    for (const p of this.list) {
      const fade = Math.min(1, (p.max - p.life) / 0.35, p.life / 0.08 + 0.3);
      const s = (p.blink ? p.size * Math.max(0, Math.sin(p.life * 2.2 + p.ph)) : p.size) * fade;
      if (s <= 0.002) continue;
      if (!p.L) p.L = p.emissive ? [1, 1] : lightAt(world, p.x, p.y, p.z);
      const [sky, blk] = p.L;
      const fl = p.emissive ? 8 : 0;
      d.grow(36);
      const cs = [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]];
      for (const [a, b, u, v] of cs) {
        d.v(p.x + (camR[0] * a + camU[0] * b) * s, p.y + (camR[1] * a + camU[1] * b) * s, p.z + (camR[2] * a + camU[2] * b) * s,
          p.u0 + u * p.us, p.v0 + v * p.us, p.layer, 1 + fl, sky, blk);
      }
      d.quads++;
    }
  },
  clear() { this.list.length = 0; },
};

/* ---------------- item drops ---------------- */
class Drop {
  constructor(id, n, dur, x, y, z, vx, vy, vz) {
    this.id = id; this.n = n; this.dur = dur;
    this.pos = [x, y, z]; this.vel = [vx || 0, vy || 0, vz || 0];
    this.hw = 0.125; this.h = 0.25; this.onGround = false; this.age = 0; this.pickupDelay = 0.4; this.spin = Math.random() * 6;
  }
}
const Drops = {
  list: [],
  spawn(id, n, dur, x, y, z, vel) {
    const v = vel || [(Math.random() - 0.5) * 2.4, 3.2 + Math.random() * 1.5, (Math.random() - 0.5) * 2.4];
    const d = new Drop(id, n, dur, x, y, z, v[0], v[1], v[2]);
    this.list.push(d); return d;
  },
  update(world, dt, player, onPickup) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.age += dt; d.pickupDelay -= dt;
      if (d.age > 300) { this.list.splice(i, 1); continue; }
      const inWater = world.getBlock(Math.floor(d.pos[0]), Math.floor(d.pos[1] + 0.1), Math.floor(d.pos[2])) === B.WATER;
      d.vel[1] -= (inWater ? 2 : 18) * dt;
      if (inWater) { d.vel[1] = Math.max(d.vel[1], -1.2); d.vel[1] += 3.2 * dt; }
      const k = d.onGround ? Math.exp(-10 * dt) : Math.exp(-1.2 * dt);
      d.vel[0] *= k; d.vel[2] *= k;
      // stuck inside a block -> pop up
      if (solidAt(world, Math.floor(d.pos[0]), Math.floor(d.pos[1] + 0.12), Math.floor(d.pos[2]))) { d.pos[1] += 4 * dt; d.vel[1] = 0; }
      else {
        const r = moveEntity(world, d, d.vel[0] * dt, d.vel[1] * dt, d.vel[2] * dt);
        if (r.y) d.vel[1] = 0; if (r.x) d.vel[0] = 0; if (r.z) d.vel[2] = 0;
      }
      // attraction to player
      if (player && player.alive && d.pickupDelay <= 0) {
        const dx = player.pos[0] - d.pos[0], dy = player.pos[1] + 0.8 - d.pos[1], dz = player.pos[2] - d.pos[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 2.2) {
          if (dist < 0.9) {
            const left = onPickup(d);
            if (left <= 0) { this.list.splice(i, 1); continue; }
            d.n = left; d.pickupDelay = 1.5;
          } else {
            const f = 14 / Math.max(dist, 0.3);
            d.vel[0] += dx * f * dt; d.vel[1] += dy * f * dt; d.vel[2] += dz * f * dt;
          }
        }
      }
    }
    // merge nearby identical stacks occasionally
    if (Math.random() < 0.05) {
      const L = this.list;
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const a = L[i], b = L[j];
        if (a.id !== b.id || a.dur !== undefined || b.dur !== undefined) continue;
        if (Math.abs(a.pos[0] - b.pos[0]) + Math.abs(a.pos[1] - b.pos[1]) + Math.abs(a.pos[2] - b.pos[2]) < 0.8 && a.n + b.n <= ITEMS[a.id].stack) {
          a.n += b.n; L.splice(j, 1); j--;
        }
      }
    }
  },
  render(world, time) {
    for (const d of this.list) {
      const t = itemTemplate(d.id);
      const bob = Math.sin(d.age * 2.2 + d.spin) * 0.06 + 0.2;
      const [sky, blk] = lightAt(world, d.pos[0], d.pos[1] + 0.3, d.pos[2]);
      const copies = d.n > 16 ? 3 : d.n > 1 ? 2 : 1;
      for (let c = 0; c < copies; c++) {
        const m = M4.create();
        M4.translate(m, d.pos[0] + c * 0.06, d.pos[1] + bob + c * 0.05, d.pos[2] + c * 0.04);
        M4.rotY(m, d.age * 1.4 + d.spin);
        const s = t.kind === 'cube' ? 0.26 : 0.42;
        M4.scale(m, s, s, s);
        pushTemplate(t, m, sky, blk);
      }
    }
  },
  clear() { this.list.length = 0; },
};

/* ---------------- creatures ---------------- */
let MOB_ID = 1;
class Gloomling {
  constructor(x, y, z, id) {
    this.type = 'gloom';
    this.id = id || MOB_ID++;
    this.pos = [x, y, z]; this.tpos = [x, y, z]; this.vel = [0, 0, 0]; this.hw = 0.3; this.h = 1.9;
    this.yaw = Math.random() * 6.28; this.onGround = false;
    this.health = 16; this.hurt = 0; this.attackCd = 0; this.walk = 0; this.burn = 0;
    this.wanderT = 0; this.wanderYaw = this.yaw; this.dead = false; this.growlT = 2 + Math.random() * 6; this.swing = 0;
  }
}
class Mossback {
  constructor(x, y, z, id) {
    this.type = 'moss'; this.id = id || MOB_ID++;
    this.pos = [x, y, z]; this.tpos = [x, y, z]; this.vel = [0, 0, 0]; this.hw = 0.42; this.h = 1.25;
    this.yaw = Math.random() * 6.28; this.onGround = false; this.health = 8; this.hurt = 0; this.walk = 0;
    this.wanderT = Math.random() * 3; this.mode = 'idle'; this.graze = 0; this.fleeT = 0; this.fleeFrom = null; this.callT = 4 + Math.random() * 12; this.swing = 0;
  }
}
class Crawler {
  constructor(x, y, z, id) {
    this.type = 'crawl'; this.id = id || MOB_ID++;
    this.pos = [x, y, z]; this.tpos = [x, y, z]; this.vel = [0, 0, 0]; this.hw = 0.45; this.h = 0.7;
    this.yaw = Math.random() * 6.28; this.onGround = false; this.health = 10; this.hurt = 0; this.attackCd = 0; this.walk = 0;
    this.wanderT = 0; this.wanderYaw = this.yaw; this.idle = false; this.swing = 0; this.hissT = 3 + Math.random() * 5; this.lunge = 0;
  }
}
const Mobs = {
  list: [], spawnT: 0, animalT: 2, crawlT: 2,
  clear() { this.list.length = 0; },
  mirror(flat) {
    const seen = new Set();
    for (let i = 0; i + 8 < flat.length; i += 9) {
      const id = flat[i] | 0, moss = flat[i + 1] === 1, crawl = flat[i + 1] === 2; seen.add(id);
      let m = this.list.find(x => x.id === id);
      if (!m) { const C = moss ? Mossback : crawl ? Crawler : Gloomling; m = new C(flat[i + 2], flat[i + 3], flat[i + 4], id); m.pos = [+flat[i + 2] || 0, +flat[i + 3] || 0, +flat[i + 4] || 0]; this.list.push(m); }
      m.tpos = [+flat[i + 2] || 0, +flat[i + 3] || 0, +flat[i + 4] || 0]; m.yaw = +flat[i + 5] || 0;
      if (flat[i + 6]) m.hurt = Math.max(m.hurt, 0.2);
      m.walk = +flat[i + 7] || 0;
      if (moss) m.graze = clamp(+flat[i + 8] || 0, 0, 1); else if (flat[i + 8]) m.swing = 1;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      if (!seen.has(m.id)) {
        Particles.burst(m.pos[0], m.pos[1] + 1, m.pos[2], TEX.smoke, 16, { full: true, size: 0.2, grav: -1.5, speed: 2, life: 0.8, drag: 2, grow: 0.25 });
        if (m.myHit && performance.now() - m.myHit < 1500 && !m.dropped && (m.type !== 'gloom' || Math.random() < 0.65)) Drops.spawn(m.type === 'moss' ? I.RAW_HAUNCH : m.type === 'crawl' ? I.SILK : I.COAL, 1, undefined, m.pos[0], m.pos[1] + 1, m.pos[2]);
        this.list.splice(i, 1);
      }
    }
  },
  update(world, dt, game) {
    const P = game.player, diff = Settings.difficulty;
    if (Net.active && !Net.isHost) {
      for (const m of this.list) {
        for (let k = 0; k < 3; k++) m.pos[k] = lerp(m.pos[k], m.tpos[k], 1 - Math.exp(-10 * dt));
        m.hurt = Math.max(0, m.hurt - dt); m.swing = Math.max(0, m.swing - dt * 3);
      }
      return;
    }
    // everyone the creatures can hunt: local player + party guests
    const targets = [];
    if (P.alive) targets.push({ peer: null, pos: P.pos });
    if (Net.active) for (const t of Net.remotePositions()) targets.push(t);
    const night = game.sky.night;
    // spawning
    this.spawnT -= dt;
    const cap = [0, 4, 7, 10][diff];
    if (diff > 0 && !game.creative && this.spawnT <= 0 && P.alive) {
      this.spawnT = 1.5;
      if (night > 0.7 && this.list.filter(m => m.type === 'gloom').length < cap) {
        for (let tries = 0; tries < 6; tries++) {
          const tp = targets.length ? targets[(Math.random() * targets.length) | 0].pos : P.pos;
          const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 18;
          const x = Math.floor(tp[0] + Math.cos(a) * r), z = Math.floor(tp[2] + Math.sin(a) * r);
          if (!world.isLoaded(x, z)) continue;
          const h = world.skyHeight(x, z);
          if (h < 1 || h >= WH - 3) continue;
          const g = world.getBlock(x, h, z);
          if (!OPAQUE[g] || g === B.WATER) continue;
          if (solidAt(world, x, h + 1, z) || solidAt(world, x, h + 2, z) || world.getBlock(x, h + 1, z) === B.WATER) continue;
          if (torchNear(world, x, h + 1, z, 9)) continue;
          this.list.push(new Gloomling(x + 0.5, h + 1, z + 0.5));
          game.audio.growl(0.4);
          break;
        }
      }
    }
    // Duskcrawlers lurk in dark caves at any hour
    this.crawlT -= dt;
    if (this.crawlT <= 0 && diff > 0 && !game.creative && targets.length) {
      this.crawlT = 2;
      const cap = [0, 2, 4, 6][diff];
      if (this.list.filter(m => m.type === 'crawl').length < cap) {
        const tp = targets[(Math.random() * targets.length) | 0].pos;
        for (let tries = 0; tries < 8; tries++) {
          const x = Math.floor(tp[0] + (Math.random() - 0.5) * 48), z = Math.floor(tp[2] + (Math.random() - 0.5) * 48);
          if (Math.hypot(x - tp[0], z - tp[2]) < 12 || !world.isLoaded(x, z)) continue;
          const sh = world.skyHeight(x, z);
          let y = -1;
          for (let yy = Math.max(3, Math.floor(tp[1]) - 10); yy <= Math.min(sh - 6, Math.floor(tp[1]) + 10); yy++)
            if (world.getBlock(x, yy, z) === 0 && world.getBlock(x, yy + 1, z) === 0 && OPAQUE[world.getBlock(x, yy - 1, z)]) { y = yy; break; }
          if (y < 0 || torchNear(world, x, y, z, 10)) continue;
          this.list.push(new Crawler(x + 0.5, y, z + 0.5));
          break;
        }
      }
    }
    // grazing herds in daylight
    this.animalT -= dt;
    if (this.animalT <= 0 && targets.length) {
      this.animalT = 3;
      const herd = this.list.filter(m => m.type === 'moss');
      if (game.sky.day > 0.5 && herd.length < 7) {
        const tp = targets[(Math.random() * targets.length) | 0].pos;
        const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 20;
        const x = Math.floor(tp[0] + Math.cos(a) * r), z = Math.floor(tp[2] + Math.sin(a) * r);
        const h = world.isLoaded(x, z) ? world.skyHeight(x, z) : -1;
        if (h > SEA && world.getBlock(x, h, z) === B.GRASS && !herd.some(m => Math.hypot(m.pos[0] - x, m.pos[2] - z) < 24)) {
          const n = 2 + ((Math.random() * 2) | 0);
          for (let k = 0; k < n; k++) {
            const sx = x + ((Math.random() * 5) | 0) - 2, sz = z + ((Math.random() * 5) | 0) - 2, sh = world.skyHeight(sx, sz);
            if (world.getBlock(sx, sh, sz) === B.GRASS && !solidAt(world, sx, sh + 1, sz)) this.list.push(new Mossback(sx + 0.5, sh + 1, sz + 0.5));
          }
        }
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      if (m.type === 'moss') { if (this.updateAnimal(world, m, dt, game, targets)) this.list.splice(i, 1); continue; }
      if (m.type === 'crawl') { if (this.updateCrawler(world, m, dt, game, targets)) this.list.splice(i, 1); continue; }
      let tgt = null, best = 1e9;
      for (const t of targets) { const d = Math.hypot(t.pos[0] - m.pos[0], t.pos[2] - m.pos[2]); if (d < best) { best = d; tgt = t; } }
      const tpos = tgt ? tgt.pos : P.pos;
      const dx = tpos[0] - m.pos[0], dz = tpos[2] - m.pos[2], dy = tpos[1] - m.pos[1];
      const dist = Math.hypot(dx, dz);
      if ((dist > 80 && !(Net.active && targets.some(t => Math.hypot(t.pos[0] - m.pos[0], t.pos[2] - m.pos[2]) < 80))) || m.health <= 0) {
        if (m.health <= 0) {
          Particles.burst(m.pos[0], m.pos[1] + 1, m.pos[2], TEX.smoke, 22, { full: true, size: 0.2, grav: -1.5, speed: 2, life: 0.8, drag: 2, grow: 0.25 });
          Particles.burst(m.pos[0], m.pos[1] + 1.2, m.pos[2], TEX.spark, 10, { full: true, size: 0.07, grav: -0.5, emissive: true, speed: 3, life: 0.6 });
          if (m.byPlayer && Math.random() < 0.65) Drops.spawn(I.COAL, 1 + (Math.random() < 0.3 ? 1 : 0), undefined, m.pos[0], m.pos[1] + 1, m.pos[2]);
          game.audio.poof(); if (m.byPlayer) game.stats.kills++;
        }
        this.list.splice(i, 1); continue;
      }
      m.hurt = Math.max(0, m.hurt - dt); m.attackCd -= dt; m.swing = Math.max(0, m.swing - dt * 3);
      // daylight burn
      if (game.sky.day > 0.55) {
        const H = world.skyHeight(Math.floor(m.pos[0]), Math.floor(m.pos[2]));
        if (m.pos[1] + 1 > H) {
          m.burn += dt;
          if (Math.random() < dt * 14) Particles.burst(m.pos[0], m.pos[1] + 1 + Math.random(), m.pos[2], Math.random() < 0.5 ? TEX.smoke : TEX.spark, 1, { full: true, size: 0.1, grav: -2, speed: 0.6, life: 0.7, emissive: true, grow: 0.1 });
          if (m.burn > 1) { m.burn = 0.001; m.health -= 3; m.hurt = 0.2; m.byPlayer = false; }
        }
      }
      const inWater = world.getBlock(Math.floor(m.pos[0]), Math.floor(m.pos[1] + 0.5), Math.floor(m.pos[2])) === B.WATER;
      let tx = 0, tz = 0, speed = 0;
      const chasing = !!tgt && !game.creative && dist < 22 && Math.abs(dy) < 12;
      if (chasing) {
        m.yaw = Math.atan2(dx, -dz);
        speed = dist > 1.2 ? [0, 2.4, 3.0, 3.6][diff] : 0;
        tx = Math.sin(m.yaw); tz = -Math.cos(m.yaw);
        m.growlT -= dt;
        if (m.growlT < 0) { m.growlT = 4 + Math.random() * 6; game.audio.growl(clamp(1 - dist / 22, 0.1, 1)); }
        if (dist < 1.5 && Math.abs(dy) < 1.6 && m.attackCd <= 0) {
          m.attackCd = 1.1; m.swing = 1;
          const dmg = [0, 2, 3, 5][diff];
          if (tgt.peer) Net.hostHit(tgt.peer, dmg, dx / (dist || 1), dz / (dist || 1));
          else game.damagePlayer(dmg, 'gloom', [dx / (dist || 1), dz / (dist || 1)]);
        }
      } else {
        m.wanderT -= dt;
        if (m.wanderT <= 0) { m.wanderT = 2 + Math.random() * 4; m.wanderYaw = Math.random() * 6.28; m.idle = Math.random() < 0.4; }
        if (!m.idle) { m.yaw = m.wanderYaw; speed = 1.1; tx = Math.sin(m.yaw); tz = -Math.cos(m.yaw); }
      }
      const kb = m.hurt > 0.15 ? 0.2 : 1;
      const acc = m.onGround ? 10 : 2;
      m.vel[0] = lerp(m.vel[0], tx * speed, 1 - Math.exp(-acc * dt * kb));
      m.vel[2] = lerp(m.vel[2], tz * speed, 1 - Math.exp(-acc * dt * kb));
      m.vel[1] -= (inWater ? 6 : 28) * dt;
      if (inWater) { m.vel[1] = Math.max(m.vel[1], -2); if (speed) m.vel[1] += 14 * dt; }
      m.vel[1] = Math.max(m.vel[1], -50);
      const res = moveEntity(world, m, m.vel[0] * dt, m.vel[1] * dt, m.vel[2] * dt);
      if (res.y) m.vel[1] = 0;
      if ((res.x || res.z) && m.onGround && speed > 0) m.vel[1] = 8.2;
      m.walk += Math.hypot(m.vel[0], m.vel[2]) * dt * 2.2;
      // push away from player a bit
      if (dist < 0.6 && tgt) { m.pos[0] -= dx * dt * 2; m.pos[2] -= dz * dt * 2; }
    }
  },
  updateAnimal(world, m, dt, game, targets) {
    let near = 1e9;
    for (const t of targets) near = Math.min(near, Math.hypot(t.pos[0] - m.pos[0], t.pos[2] - m.pos[2]));
    if (m.health <= 0 || near > 110) {
      if (m.health <= 0) {
        Particles.burst(m.pos[0], m.pos[1] + 0.8, m.pos[2], TEX.smoke, 14, { full: true, size: 0.16, grav: -1.2, speed: 1.6, life: 0.7, drag: 2, grow: 0.2 });
        Particles.burst(m.pos[0], m.pos[1] + 0.9, m.pos[2], TEX.moss_back, 10, { speed: 2.4 });
        if (m.byPlayer) { Drops.spawn(I.RAW_HAUNCH, 1 + (Math.random() < 0.5 ? 1 : 0), undefined, m.pos[0], m.pos[1] + 0.8, m.pos[2]); if (Math.random() < 0.8) Drops.spawn(I.HIDE, 1 + (Math.random() < 0.35 ? 1 : 0), undefined, m.pos[0], m.pos[1] + 0.8, m.pos[2]); }
        game.audio.animal(0.8, true);
      }
      return true;
    }
    m.hurt = Math.max(0, m.hurt - dt); m.fleeT -= dt; m.wanderT -= dt;
    let speed = 0, tx = 0, tz = 0;
    if (m.fleeT > 0 && m.fleeFrom) {
      m.yaw = Math.atan2(m.pos[0] - m.fleeFrom[0], -(m.pos[2] - m.fleeFrom[2])); speed = 4.2; m.graze = Math.max(0, m.graze - dt * 4);
    } else {
      if (m.wanderT <= 0) {
        const r = Math.random();
        m.mode = r < 0.35 ? 'walk' : r < 0.75 ? 'graze' : 'idle';
        m.wanderT = 2 + Math.random() * 5;
        if (m.mode === 'walk') m.yaw += (Math.random() - 0.5) * 2.4;
      }
      if (m.mode === 'walk') {
        speed = 1.2;
        // don't wander into water or off cliffs
        const ax = Math.floor(m.pos[0] + Math.sin(m.yaw) * 1.2), az = Math.floor(m.pos[2] - Math.cos(m.yaw) * 1.2);
        const ah = world.skyHeight(ax, az);
        if (world.getBlock(ax, ah, az) === B.WATER || ah < m.pos[1] - 3) { m.yaw += Math.PI * 0.7; m.wanderT = 1; }
      }
      m.graze = lerp(m.graze, m.mode === 'graze' ? 0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 260)) : 0, 1 - Math.exp(-6 * dt));
    }
    tx = Math.sin(m.yaw); tz = -Math.cos(m.yaw);
    const inWater = world.getBlock(Math.floor(m.pos[0]), Math.floor(m.pos[1] + 0.4), Math.floor(m.pos[2])) === B.WATER;
    const acc = m.onGround ? 8 : 2;
    m.vel[0] = lerp(m.vel[0], tx * speed, 1 - Math.exp(-acc * dt)); m.vel[2] = lerp(m.vel[2], tz * speed, 1 - Math.exp(-acc * dt));
    m.vel[1] -= (inWater ? 4 : 28) * dt; if (inWater) m.vel[1] = Math.max(m.vel[1], -1) + 10 * dt;
    m.vel[1] = Math.max(m.vel[1], -50);
    const res = moveEntity(world, m, m.vel[0] * dt, m.vel[1] * dt, m.vel[2] * dt);
    if (res.y) m.vel[1] = 0;
    if ((res.x || res.z) && m.onGround && speed > 0) m.vel[1] = 7.5;
    m.walk += Math.hypot(m.vel[0], m.vel[2]) * dt * 2.6;
    m.callT -= dt;
    if (m.callT <= 0) { m.callT = 8 + Math.random() * 16; if (near < 16) game.audio.animal(clamp(1 - near / 16, 0.15, 1)); }
    return false;
  },
  updateCrawler(world, m, dt, game, targets) {
    let tgt = null, best = 1e9;
    for (const t of targets) { const d = Math.hypot(t.pos[0] - m.pos[0], t.pos[2] - m.pos[2]) + Math.abs(t.pos[1] - m.pos[1]) * 0.5; if (d < best) { best = d; tgt = t; } }
    if (m.health <= 0 || best > 72) {
      if (m.health <= 0) {
        Particles.burst(m.pos[0], m.pos[1] + 0.4, m.pos[2], TEX.smoke, 16, { full: true, size: 0.15, grav: -1.2, speed: 1.8, life: 0.7, drag: 2, grow: 0.2 });
        if (m.byPlayer) { Drops.spawn(I.SILK, 1 + (Math.random() < 0.5 ? 1 : 0), undefined, m.pos[0], m.pos[1] + 0.4, m.pos[2]); game.stats.kills++; }
        game.audio.poof();
      }
      return true;
    }
    m.hurt = Math.max(0, m.hurt - dt); m.attackCd -= dt; m.swing = Math.max(0, m.swing - dt * 3); m.lunge = Math.max(0, m.lunge - dt * 2);
    const diff = Settings.difficulty;
    const dx = tgt.pos[0] - m.pos[0], dz = tgt.pos[2] - m.pos[2], dy = tgt.pos[1] - m.pos[1], dist = Math.hypot(dx, dz);
    let speed = 0;
    const chasing = !game.creative && dist < 18 && Math.abs(dy) < 6;
    if (chasing) {
      m.yaw = Math.atan2(dx, -dz); speed = dist > 1.3 ? [0, 3.0, 3.6, 4.2][diff] : 0;
      m.hissT -= dt; if (m.hissT <= 0) { m.hissT = 3 + Math.random() * 4; game.audio.hiss(clamp(1 - dist / 18, 0.1, 1)); }
      if (dist < 1.6 && Math.abs(dy) < 1.4 && m.attackCd <= 0) {
        m.attackCd = 0.9; m.swing = 1; m.lunge = 1;
        const dmg = [0, 2, 2, 3][diff];
        if (tgt.peer) Net.hostHit(tgt.peer, dmg, dx / (dist || 1), dz / (dist || 1));
        else game.damagePlayer(dmg, 'crawler', [dx / (dist || 1), dz / (dist || 1)]);
      }
    } else {
      m.wanderT -= dt;
      if (m.wanderT <= 0) { m.wanderT = 1.5 + Math.random() * 3; m.wanderYaw = Math.random() * 6.28; m.idle = Math.random() < 0.5; }
      if (!m.idle) { m.yaw = m.wanderYaw; speed = 1.4; }
    }
    const tx = Math.sin(m.yaw), tz = -Math.cos(m.yaw), acc = m.onGround ? 12 : 2, kb = m.hurt > 0.15 ? 0.2 : 1;
    m.vel[0] = lerp(m.vel[0], tx * speed, 1 - Math.exp(-acc * dt * kb)); m.vel[2] = lerp(m.vel[2], tz * speed, 1 - Math.exp(-acc * dt * kb));
    m.vel[1] = Math.max(m.vel[1] - 28 * dt, -50);
    const res = moveEntity(world, m, m.vel[0] * dt, m.vel[1] * dt, m.vel[2] * dt);
    if (res.y) m.vel[1] = 0;
    if ((res.x || res.z) && m.onGround && speed > 0) m.vel[1] = 7.5;
    m.walk += Math.hypot(m.vel[0], m.vel[2]) * dt * 4;
    return false;
  },
  onHit(m, from) { if (m.type === 'moss') { m.fleeT = 5; m.fleeFrom = from.slice(); m.mode = 'walk'; GameAudio.animal(0.9, true); } },
  hitTest(o, d, maxDist) {
    let best = null, bt = maxDist;
    for (const m of this.list) {
      const w = m.type === 'moss' ? 0.5 : m.type === 'crawl' ? 0.55 : 0.4, hh = m.type === 'moss' ? 1.3 : m.type === 'crawl' ? 0.8 : 2.0;
      const t = rayAABB(o, d, m.pos[0] - w, m.pos[1], m.pos[2] - w, m.pos[0] + w, m.pos[1] + hh, m.pos[2] + w);
      if (t >= 0 && t < bt) { bt = t; best = m; }
    }
    return best ? { mob: best, t: bt } : null;
  },
  render(world, time) {
    const gl = R.gl;
    for (const m of this.list) {
      const [sky, blk] = lightAt(world, m.pos[0], m.pos[1] + 1.5, m.pos[2]);
      const base = M4.create();
      M4.translate(base, m.pos[0], m.pos[1], m.pos[2]);
      M4.rotY(base, -m.yaw);
      const sw = Math.sin(m.walk) * 0.7;
      const S = TEX.gloom_skin, F = TEX.gloom_face;
      const box = (mat, x0, y0, z0, x1, y1, z1, layers, flags) => {
        emitBox(R.dyn, x0, y0, z0, x1, y1, z1, layers, [0, 0, 1, 1], 1, sky, blk, flags || 0, p => {
          return [mat[0] * p[0] + mat[4] * p[1] + mat[8] * p[2] + mat[12], mat[1] * p[0] + mat[5] * p[1] + mat[9] * p[2] + mat[13], mat[2] * p[0] + mat[6] * p[1] + mat[10] * p[2] + mat[14]];
        });
      };
      if (m.type === 'crawl') {
        const Sk = TEX.crawler_skin, Fc = TEX.crawler_face;
        const body = M4.create(); body.set(base); M4.translate(body, 0, 0.12 + Math.abs(Math.sin(m.walk * 2)) * 0.03, 0);
        box(body, -0.34, 0.18, -0.1, 0.34, 0.5, 0.55, Sk);
        const hd = M4.create(); hd.set(body); M4.translate(hd, 0, 0.32, -0.1 - m.lunge * 0.15);
        box(hd, -0.25, -0.15, -0.4, 0.25, 0.17, 0, [Sk, Sk, Sk, Sk, Sk, Fc]);
        box(hd, -0.25, -0.15, -0.412, 0.25, 0.17, -0.404, [-1, -1, -1, -1, -1, TEX.crawler_eyes], 8);
        for (let k = 0; k < 3; k++) for (const side of [-1, 1]) {
          const l = M4.create(); l.set(body); M4.translate(l, side * 0.32, 0.32, -0.02 + k * 0.24);
          M4.rotY(l, side * (0.25 - k * 0.25)); M4.rotZ(l, side * (0.7 + Math.sin(m.walk * 2 + k * 2.1 + (side > 0 ? 0 : 3.14)) * 0.25));
          box(l, side > 0 ? 0 : -0.62, -0.04, -0.04, side > 0 ? 0.62 : 0, 0.04, 0.04, Sk);
        }
        gl.uniform4f(R.uMain.uTint, 0.85, 0.1, 0.1, m.hurt > 0 ? 0.45 : 0);
        flushDyn();
        continue;
      }
      if (m.type === 'moss') {
        const Fu = TEX.moss_fur, Mb = TEX.moss_back, Fc = TEX.moss_face, Hn = TEX.camp_log;
        for (const [lx, lz, ph] of [[-0.22, -0.34, 1], [0.22, -0.34, -1], [-0.22, 0.34, -1], [0.22, 0.34, 1]]) {
          const l = M4.create(); l.set(base); M4.translate(l, lx, 0.5, lz); M4.rotX(l, sw * ph * 0.8);
          box(l, -0.08, -0.5, -0.08, 0.08, 0, 0.08, Fu);
        }
        box(base, -0.34, 0.48, -0.5, 0.34, 1.02, 0.5, [Fu, Fu, Mb, Fu, Fu, Fu]);
        box(base, -0.37, 0.92, -0.44, 0.37, 1.14, 0.44, Mb);
        const h = M4.create(); h.set(base); M4.translate(h, 0, 0.92, -0.5); M4.rotX(h, -m.graze * 0.95 + Math.sin(time * 1.3 + m.id) * 0.04);
        box(h, -0.21, -0.26, -0.38, 0.21, 0.16, 0.02, [Fu, Fu, Fu, Fu, Fu, Fc]);
        box(h, -0.24, 0.1, -0.2, -0.16, 0.26, -0.12, Hn); box(h, 0.16, 0.1, -0.2, 0.24, 0.26, -0.12, Hn);
        gl.uniform4f(R.uMain.uTint, 0.85, 0.1, 0.1, m.hurt > 0 ? 0.45 : 0);
        flushDyn();
        continue;
      }
      // legs
      for (const side of [-1, 1]) {
        const l = M4.create(); l.set(base); M4.translate(l, side * 0.13, 0.72, 0); M4.rotX(l, sw * side);
        box(l, -0.11, -0.72, -0.11, 0.11, 0, 0.11, S);
      }
      // torso (hunched)
      const t = M4.create(); t.set(base); M4.translate(t, 0, 0.72, 0); M4.rotX(t, 0.22);
      box(t, -0.29, 0, -0.17, 0.29, 0.74, 0.17, S);
      // spines
      for (let k = 0; k < 3; k++) box(t, -0.05, 0.18 + k * 0.2, 0.17, 0.05, 0.28 + k * 0.2, 0.3, S);
      // head
      const hm = M4.create(); hm.set(t); M4.translate(hm, 0, 0.74, -0.06);
      M4.rotX(hm, -0.2 + Math.sin(time * 2 + m.walk) * 0.05);
      box(hm, -0.25, 0, -0.25, 0.25, 0.5, 0.25, [S, S, S, S, S, F]);
      box(hm, -0.25, 0, -0.262, 0.25, 0.5, -0.256, [-1, -1, -1, -1, -1, TEX.gloom_eyes], 8);
      // long arms
      for (const side of [-1, 1]) {
        const a = M4.create(); a.set(t); M4.translate(a, side * 0.39, 0.66, 0);
        M4.rotX(a, -sw * side * 0.8 - m.swing * 1.6);
        M4.rotZ(a, side * 0.08);
        box(a, -0.09, -0.98, -0.09, 0.09, 0.06, 0.09, S);
      }
      gl.uniform4f(R.uMain.uTint, 0.85, 0.1, 0.1, m.hurt > 0 ? 0.45 : 0);
      flushDyn();
    }
    gl.uniform4f(R.uMain.uTint, 0, 0, 0, 0);
  },
};
