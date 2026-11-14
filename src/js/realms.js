/* =====================================================================
   The realms: gates, travelling between worlds, the Hollow King and the ending.
   One World object is alive at a time; the others wait as saved edits.
   ===================================================================== */
// light and colour of each realm (the Overworld keeps its day and night)
function realmSky(dim) {
  const s = skyState(dim === 2 ? 0.17 : 0.75, 0, 0);
  if (dim === 1) Object.assign(s, { zen: [0.16, 0.03, 0.02], hor: [0.44, 0.11, 0.04], fog: [0.30, 0.07, 0.03], dayLight: 0.3, sunCol: [1, 0.6, 0.4], day: 0, night: 0, sunset: 0, sun: [0.2, -0.97, 0.1],
    amb: [0.52, 0.31, 0.23], fogMul: 0.75, noClouds: true });
  else if (dim === 2) Object.assign(s, { zen: [0.34, 0.56, 1.0], hor: [1.0, 0.9, 0.82], fog: [0.97, 0.91, 0.88], dayLight: 1.06, sunCol: [1, 0.97, 0.9], day: 1, night: 0, amb: [0.16, 0.16, 0.2] });
  else Object.assign(s, { zen: [0.01, 0.0, 0.04], hor: [0.15, 0.05, 0.28], fog: [0.07, 0.03, 0.14], dayLight: 0.46, sunCol: [0.76, 0.62, 1.0], day: 0, night: 1, sunset: 0, amb: [0.27, 0.22, 0.4], noClouds: true });
  s.rain = 0;
  return s;
}
Object.assign(Game, {
  dim: 0, dimEdits: {}, dimFurn: {}, ret: null, kingDead: false, arriving: null,

  resetRealms(data) {
    data = data || {};
    this.dim = clamp(data.dim | 0, 0, 3); this.dimEdits = {}; this.dimFurn = {}; this.arriving = null;
    const de = data.dims || {};
    for (const k of [0, 1, 2, 3]) if (typeof de[k] === 'string') this.dimEdits[k] = de[k];
    this.ret = data.ret && Array.isArray(data.ret.pos) ? { pos: data.ret.pos.slice(0, 3).map(Number), yaw: +data.ret.yaw || 0 } : null;
    this.kingDead = !!data.kingDead;
    $('bossBar').classList.add('hidden'); $('realmTint').style.opacity = 0;
  },
  // every realm's edits, for saving: the live world plus the ones that are waiting
  realmEdits() {
    const out = {};
    for (const k of [0, 1, 2, 3]) { const e = k === this.dim ? this.world.encodeEdits() : this.dimEdits[k]; if (e) out[k] = e; }
    return out;
  },
  allFurnaces() {
    const out = [], add = (map, dim) => { for (const f of map.values()) out.push([f.x, f.y, f.z, f.s.map(st => st ? [st.id, st.n] : null), r2(f.burn), f.burnMax, r2(f.prog), dim]); };
    add(this.furnaces, this.dim);
    for (const k in this.dimFurn) if ((k | 0) !== this.dim && this.dimFurn[k]) add(this.dimFurn[k], k | 0);
    return out;
  },

  useGate(t) {
    if (Net.active || this.server) { UI.toast('The gates only open in single-player worlds.'); return; }
    const realm = t.id === B.GATE_EMBER ? 1 : t.id === B.GATE_SKY ? 2 : 3;
    this.pendingTravel = [realm === this.dim ? 0 : realm];
  },
  travel(to, opt) {
    opt = opt || {};
    const P = this.player, from = this.dim;
    if (to === from || !this.world || this.state !== 'play') return;
    if (from === 0 && !opt.respawn) this.ret = { pos: P.pos.map(r2), yaw: r2(P.yaw) };
    this.dimEdits[from] = this.world.encodeEdits(); this.dimFurn[from] = this.furnaces;
    const seed = this.world.seed, gen = this.world.gen, px = Math.floor(P.pos[0]), pz = Math.floor(P.pos[2]);
    this.disposeWorld(this.world);
    this.dim = to;
    this.world = new World(seed, gen, to); this.world.loadEdits(this.dimEdits[to] || '');
    this.furnaces = this.dimFurn[to] || new Map();
    Mobs.clear(); Drops.clear(); Particles.clear();
    Atmos.rain = 0; if (to) Atmos.rainTarget = 0;
    let land = null;
    if (to === 0) P.pos = opt.pos ? opt.pos.slice() : this.ret ? this.ret.pos.slice() : P.spawn.slice();
    else { land = this.world.realmLanding(px, pz); P.pos = [land[0] + 0.5, land[1], land[2] + 0.5]; }
    P.vel = [0, 0, 0]; P.fallDist = 0; P.air = 15; P.breakProg = 0; P.feather = !!opt.drop; P.onGround = false;
    if (!this.creative) P.flying = false;
    this.keepSpawn = P.spawn; this.arriving = { to, land, drop: !!opt.drop };
    this.target = null; this.mobTarget = null; Input.mouseL = Input.mouseR = false;
    this.state = 'loading'; this.loadR = Math.min(Settings.renderDist, 4);
    $('bossBar').classList.add('hidden'); $('realmTint').style.opacity = 0;
    UI.show('loading');
    $('loadTitle').textContent = to ? 'Entering ' + REALMS[to].name + '…' : opt.drop ? 'Falling through the clouds…' : 'Returning to the Overworld…';
    GameAudio.gate();
  },
  // called once the destination has loaded: make the landing safe and leave a gate home
  arriveRealm() {
    const a = this.arriving, P = this.player, w = this.world; this.arriving = null; this.noHint = true;
    if (a.to && a.land) {
      const [x, y, z] = a.land, gate = B.GATE_EMBER + a.to - 1, floor = [0, B.CINDER_BRICKS, B.HALO_BRICKS, B.NULL_BRICKS][a.to];
      let has = false;
      for (let dx = -3; dx <= 3 && !has; dx++) for (let dz = -3; dz <= 3 && !has; dz++) for (let dy = -2; dy <= 3; dy++) if (isGate(w.getBlock(x + dx, y + dy, z + dz))) { has = true; break; }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!SOLID[w.getBlock(x + dx, y - 1, z + dz)]) w.setBlock(x + dx, y - 1, z + dz, floor);
        for (let dy = 0; dy <= 2; dy++) { const b = w.getBlock(x + dx, y + dy, z + dz); if (b && !isGate(b)) w.setBlock(x + dx, y + dy, z + dz, 0); }
      }
      if (!has) w.setBlock(x + 1, y, z, gate);
      P.pos = [x + 0.5, y, z + 0.5]; P.yaw = Math.PI / 2;
      if (a.to === 3) { P.yaw = 0; if (!this.kingDead) { const c = w.realmColumn(0, 0); Mobs.list.push(new Gloomling(0.5, c.h + 2, 0.5, 0, 'king')); } }
    }
    if (a.drop) { P.pos[1] = WH + 40; P.feather = true; }
    UI.banner(REALMS[a.to].name, a.drop ? 'You fell out of the sky.' : a.to === 3 && this.kingDead ? 'The throne is empty.' : REALMS[a.to].sub);
  },
  kingDefeated(m) {
    this.kingDead = true; this.stats.kills++;
    for (let k = 0; k < 6; k++) Particles.burst(m.pos[0], m.pos[1] + 1 + k * 0.7, m.pos[2], TEX.spark, 26, { full: true, size: 0.12, grav: -0.5, emissive: true, speed: 6, life: 1.4 });
    Drops.spawn(I.EMBER_CROWN, 1, undefined, m.pos[0], m.pos[1] + 2, m.pos[2]);
    Drops.spawn(I.SKYSHARD, 8, undefined, m.pos[0] + 0.5, m.pos[1] + 2, m.pos[2]);
    Drops.spawn(I.AURORITE, 4, undefined, m.pos[0], m.pos[1] + 2, m.pos[2] + 0.5);
    for (const g of Mobs.list) if (g !== m && g.type === 'gloom') g.health = 0;
    $('bossBar').classList.add('hidden');
    UI.banner('The Hollow King has fallen', 'Take the Ember Crown.');
    GameAudio.fanfare();
    if (this.worldId) this.saveT = 0;
    setTimeout(() => {
      if (this.state !== 'play' || !this.player || !this.player.alive) return;
      this.paused = true; Input.mouseL = Input.mouseR = false; Input.keys = {};
      $('winName').textContent = Profile.data ? Profile.data.name : 'You';
      UI.show('win');
      if (document.pointerLockElement) document.exitPointerLock();
    }, 4200);
  },
  // per-frame realm rules: lava and magma burns, the boss bar, soft landings after falling out of the Aether
  updateRealm(dt) {
    const P = this.player, w = this.world;
    if (P.feather) { P.fallDist = 0; if (P.vel[1] < -12) P.vel[1] = -12; if ((P.onGround && P.pos[1] < WH) || P.inWater) P.feather = false; }
    if (!this.creative && P.alive) {
      if (P.inLava) { P.lavaT = (P.lavaT || 0) - dt; if (P.lavaT <= 0) { P.lavaT = 0.5; this.damagePlayer(4, 'lava'); } } else P.lavaT = 0;
      const under = w.getBlock(Math.floor(P.pos[0]), Math.floor(P.pos[1] - 0.1), Math.floor(P.pos[2]));
      if (under === B.MAGMA && P.onGround && !P.sneak) { P.magmaT = (P.magmaT || 0) - dt; if (P.magmaT <= 0) { P.magmaT = 0.8; this.damagePlayer(1, 'magma'); } } else P.magmaT = 0.3;
    }
    $('realmTint').style.opacity = P.headInLava ? 0.85 : 0;
    if (this.dim === 3) {
      const k = Mobs.list.find(m => m.type === 'king'), bar = $('bossBar');
      bar.classList.toggle('hidden', !k || this.hideHud);
      if (k) bar.querySelector('i').style.width = clamp(k.health / k.maxHealth * 100, 0, 100) + '%';
    }
    // fall out of the Aether and you come down in the Overworld, gently
    if (this.dim === 2 && P.pos[1] < -16 && P.alive) this.pendingTravel = [0, { drop: true, pos: [P.pos[0], WH + 40, P.pos[2]] }];
  },
});
