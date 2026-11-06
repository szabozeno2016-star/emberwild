/* =====================================================================
   Atmosphere: weather, rain, thunder, fireflies, falling leaves,
   dust, campfire cooking and the ambient soundscape
   ===================================================================== */
const Atmos = {
  rain: 0, rainTarget: 0, weatherT: 300, flash: 0, flick: 1, thunderT: 15, drops: [], sense: 0,
  near: { water: 0, fire: 0 }, outside: 1, underground: false, cooking: [],
  reset(w) {
    w = w || {};
    this.rain = this.rainTarget = clamp(+w.rain || 0, 0, 1);
    this.weatherT = +w.weatherT || 200 + Math.random() * 300;
    this.drops = []; this.flash = 0; this.cooking = [];
  },
  save() { return { rain: r2(this.rainTarget), weatherT: Math.round(this.weatherT) }; },
  update(dt, game) {
    const P = game.player, w = game.world, t = performance.now() / 1000;
    // ---- weather (singleplayer or party host decides) ----
    if (!Net.active || Net.isHost) {
      this.weatherT -= dt;
      if (this.weatherT <= 0) {
        const wet = Math.random() < 0.38;
        this.rainTarget = wet ? (Math.random() < 0.35 ? 1 : 0.6) : 0;
        this.weatherT = wet ? 140 + Math.random() * 200 : 260 + Math.random() * 420;
      }
    }
    const tgt = Settings.weather ? this.rainTarget : 0;
    this.rain += clamp(tgt - this.rain, -dt * 0.06, dt * 0.06);
    // torches and campfires breathe
    this.flick = 0.95 + 0.035 * Math.sin(t * 9.1) + 0.025 * Math.sin(t * 23.7 + 1.3) + 0.015 * Math.sin(t * 41.3);
    // storms
    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.rain > 0.8) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = 10 + Math.random() * 28;
        const d = Math.random();
        if (d < 0.6) this.flash = 1 - d * 0.6;
        GameAudio.thunder(d);
      }
    }
    // ---- where is the player? (sound + particles) ----
    const eye = game.eyePos(), H = w.skyHeight(Math.floor(eye[0]), Math.floor(eye[2]));
    this.outside = lerp(this.outside, eye[1] > H ? 1 : 0, 1 - Math.exp(-3 * dt));
    this.underground = eye[1] < H - 6 && eye[1] < SEA + 18;
    this.sense -= dt;
    if (this.sense <= 0) {
      this.sense = 0.5;
      let water = 0;
      for (let k = 0; k < 10; k++) {
        const x = Math.floor(P.pos[0] + (Math.random() - 0.5) * 16), z = Math.floor(P.pos[2] + (Math.random() - 0.5) * 16);
        if (w.getBlock(x, SEA, z) === B.WATER && Math.abs(P.pos[1] - SEA) < 10) water++;
      }
      this.near.water = Math.min(1, water / 4);
      let fire = 0; const cx = Math.floor(P.pos[0]) >> 4, cz = Math.floor(P.pos[2]) >> 4;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const c = w.getChunk(cx + i, cz + j); if (!c || !c.emitters.size) continue;
        for (const e of c.emitters) if (c.data[e] === B.CAMPFIRE || c.data[e] === B.FURNACE_LIT) {
          const d = Math.hypot((cx + i) * 16 + (e & 15) + 0.5 - P.pos[0], (e >> 8) - P.pos[1], (cz + j) * 16 + ((e >> 4) & 15) + 0.5 - P.pos[2]);
          fire = Math.max(fire, 1 - d / 10);
        }
      }
      this.near.fire = fire;
    }
    GameAudio.ambientTick(dt, { menu: false, rain: this.rain, outside: this.outside, height: eye[1], day: game.sky.day, night: game.sky.night,
      underground: this.underground, water: this.near.water, fire: this.near.fire });
    // ---- ambient particles ----
    const pm = Settings.particles;
    // fireflies over grass on clear nights
    if (game.sky.night > 0.6 && this.rain < 0.2 && Math.random() < dt * 3 * pm) {
      const x = Math.floor(P.pos[0] + (Math.random() - 0.5) * 28), z = Math.floor(P.pos[2] + (Math.random() - 0.5) * 28), h = w.skyHeight(x, z);
      const g = w.getBlock(x, h, z);
      if (g === B.GRASS || g === B.TALLGRASS || isLeaves(g)) {
        Particles.burst(x + Math.random(), h + 1.2 + Math.random() * 1.8, z + Math.random(), TEX.firefly, 1, {
          full: true, size: 0.075, grav: 0, speed: 0.3, up: 0, life: 6, emissive: true, blink: true, drag: 0.6, spread: 0.1,
          upd: (p, dt2) => { p.vx += (Math.random() - 0.5) * dt2 * 3; p.vy += (Math.random() - 0.5) * dt2 * 2; p.vz += (Math.random() - 0.5) * dt2 * 3; },
        });
      }
    }
    // glowcap spores drifting in caves
    if (this.underground && Math.random() < dt * 4) {
      const cx = Math.floor(P.pos[0]) >> 4, cz = Math.floor(P.pos[2]) >> 4;
      const c = w.getChunk(cx + ((Math.random() * 3) | 0) - 1, cz + ((Math.random() * 3) | 0) - 1);
      if (c && c.emitters.size) {
        const arr = Array.from(c.emitters), e = arr[(Math.random() * arr.length) | 0];
        if (c.data[e] === B.GLOWCAP) Particles.burst(c.cx * 16 + (e & 15) + 0.5, (e >> 8) + 0.6, c.cz * 16 + ((e >> 4) & 15) + 0.5, TEX.glowcap, 1,
          { size: 0.03, grav: -0.15, speed: 0.2, up: 0.1, life: 3, emissive: true, spread: 0.4, drag: 1 });
      }
    }
    // leaves drifting down from canopies
    if (game.sky.day > 0.3 && Math.random() < dt * 2.5 * pm) {
      const x = Math.floor(P.pos[0] + (Math.random() - 0.5) * 22), z = Math.floor(P.pos[2] + (Math.random() - 0.5) * 22), h = w.skyHeight(x, z);
      const id = w.getBlock(x, h, z);
      if (isLeaves(id) && !SOLID[w.getBlock(x, h - 1, z)]) {
        Particles.burst(x + Math.random(), h - 0.05, z + Math.random(), FACE_TEX[id][0], 1, {
          size: 0.07, grav: 0.35, speed: 0.2, up: 0, life: 7, drag: 1.8, spread: 0.1,
          upd: (p, dt2) => { p.vx += Math.sin(p.life * 2.4 + p.ph) * dt2 * 1.4; p.vz += Math.cos(p.life * 1.9 + p.ph) * dt2 * 1.2; },
        });
      }
    }
    // sprint dust
    if (P.alive && P.sprint && P.onGround && Math.random() < dt * 14 * pm) {
      const below = w.getBlock(Math.floor(P.pos[0]), Math.floor(P.pos[1] - 0.2), Math.floor(P.pos[2]));
      if (below && FACE_TEX[below]) Particles.burst(P.pos[0], P.pos[1] + 0.05, P.pos[2], FACE_TEX[below][2], 1, { size: 0.05, speed: 1.2, up: 0.6, life: 0.4, spread: 0.4 });
    }
    // ---- rain drops ----
    const want = Math.round(this.rain * 760 * Math.min(1.3, Math.max(0.2, pm)));
    const ce = game.camEye || eye;
    while (this.drops.length < want) this.drops.push(this.newDrop(ce, true));
    if (this.drops.length > want) this.drops.length = want;
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.y -= d.v * dt;
      if (Math.hypot(d.x - ce[0], d.z - ce[2]) > 20) { this.drops[i] = this.newDrop(ce, true); continue; }
      const g = w.skyHeight(Math.floor(d.x), Math.floor(d.z)) + 1;
      if (d.y < g) {
        if (g > ce[1] - 12 && Math.random() < 0.35 * Math.min(1, pm)) {
          const top = w.getBlock(Math.floor(d.x), g - 1, Math.floor(d.z));
          Particles.burst(d.x, g + 0.05, d.z, top === B.WATER ? TEX.water : TEX.rain, 1, { full: top !== B.WATER, size: 0.035, speed: 1.2, up: 1.2, life: 0.25, spread: 0.05 });
        }
        this.drops[i] = this.newDrop(ce, false);
      }
    }
    // ---- cooking ----
    for (let i = this.cooking.length - 1; i >= 0; i--) {
      const c = this.cooking[i];
      c.t -= dt;
      if (w.getBlock(c.x, c.y, c.z) !== B.CAMPFIRE) { Drops.spawn(I.RAW_HAUNCH, 1, undefined, c.x + 0.5, c.y + 0.6, c.z + 0.5); this.cooking.splice(i, 1); continue; }
      if (Math.random() < dt * 6) Particles.burst(c.x + 0.5, c.y + 0.7, c.z + 0.5, TEX.smoke, 1, { full: true, size: 0.06, grav: -1.5, speed: 0.3, up: 0.6, life: 0.8, grow: 0.12, spread: 0.3 });
      if (c.t <= 0) {
        Drops.spawn(I.ROAST_HAUNCH, 1, undefined, c.x + 0.5, c.y + 0.9, c.z + 0.5, [(Math.random() - 0.5), 3.5, (Math.random() - 0.5)]);
        GameAudio.pop(); this.cooking.splice(i, 1);
      }
    }
  },
  newDrop(c, anywhere) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 18;
    return { x: c[0] + Math.cos(a) * r, z: c[2] + Math.sin(a) * r, y: c[1] + (anywhere ? Math.random() * 22 - 4 : 14 + Math.random() * 8), v: 17 + Math.random() * 5 };
  },
  cook(x, y, z) {
    if (this.cooking.filter(c => c.x === x && c.y === y && c.z === z).length >= 4) return false;
    this.cooking.push({ x, y, z, t: 5 + this.cooking.length * 0.3 });
    GameAudio.sizzle();
    return true;
  },
  renderRain(dir) {
    if (!this.drops.length) return;
    const d = R.dyn, L = TEX.rain;
    let rx = -dir[2], rz = dir[0]; const rl = Math.hypot(rx, rz) || 1; rx = rx / rl * 0.09; rz = rz / rl * 0.09;
    for (const p of this.drops) {
      d.grow(36);
      d.v(p.x - rx, p.y, p.z - rz, 0, 1, L, 0.85, 1, 0); d.v(p.x + rx, p.y, p.z + rz, 1, 1, L, 0.85, 1, 0);
      d.v(p.x + rx, p.y + 0.8, p.z + rz, 1, 0, L, 0.85, 1, 0); d.v(p.x - rx, p.y + 0.8, p.z - rz, 0, 0, L, 0.85, 1, 0);
      d.quads++;
    }
    flushDyn();
  },
};
