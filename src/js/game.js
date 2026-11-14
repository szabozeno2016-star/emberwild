/* =====================================================================
   Game: state, player, interaction, survival, streaming, frame
   ===================================================================== */
const Input = { keys: {}, mouseL: false, mouseR: false, pressL: false, pressR: false, dx: 0, dy: 0, locked: false, lastW: 0 };

class Inventory {
  constructor() { this.s = new Array(36).fill(null); this.armor = [null, null, null, null]; this.sel = 0; this.ver = 0; }
  get armorPoints() { return this.armor.reduce((a, st) => a + (st ? ITEMS[st.id].armor.points : 0), 0); }
  armorMats() { return this.armor.map(st => st ? ITEMS[st.id].armor.mat : 0); }
  get held() { return this.s[this.sel]; }
  touch() { this.ver++; }
  add(id, n, dur) {
    const def = ITEMS[id]; if (!def) return 0;
    const max = def.stack;
    if (max > 1) for (let i = 0; i < 36 && n > 0; i++) {
      const st = this.s[i];
      if (st && st.id === id && st.n < max) { const k = Math.min(n, max - st.n); st.n += k; n -= k; }
    }
    for (let i = 0; i < 36 && n > 0; i++) {
      if (!this.s[i]) {
        const k = Math.min(n, max);
        this.s[i] = { id, n: k }; if (def.tool || def.armor) this.s[i].d = dur !== undefined ? dur : (def.tool || def.armor).dur;
        n -= k;
      }
    }
    this.touch(); return n;
  }
  matches(id, key) { return typeof key === 'string' ? GROUPS[key].includes(id) : id === key; }
  count(key) { let c = 0; for (const st of this.s) if (st && this.matches(st.id, key)) c += st.n; return c; }
  remove(key, n) {
    for (let i = 35; i >= 0 && n > 0; i--) {
      const st = this.s[i];
      if (st && this.matches(st.id, key)) { const k = Math.min(n, st.n); st.n -= k; n -= k; if (!st.n) this.s[i] = null; }
    }
    this.touch();
  }
  canCraft(r) { return r.inp.every(([k, n]) => this.count(k) >= n); }
}

function newPlayer(spawn) {
  return {
    pos: spawn.slice(), vel: [0, 0, 0], hw: 0.3, h: 1.8, yaw: -Math.PI / 2, pitch: -0.15, onGround: false, alive: true,
    health: 20, hunger: 20, sat: 5, exh: 0, air: 15, fallDist: 0, inWater: false, headInWater: false, sprint: false, sneak: false,
    invuln: 0, regenT: 0, starveT: 0, drownT: 0, stepAcc: 0, bobPhase: 0, bobAmt: 0, eatT: 0, eatSnd: 0, swing: 0, swingT: 1,
    breakProg: 0, breakKey: null, breakDelay: 0, digSnd: 0, useCd: 0, attackCd: 0, hurtTilt: 0, fovBoost: 0, spawn: spawn.slice(),
    lastHeld: -1,
  };
}


const Game = {
  state: 'boot', mode: 'survival', world: null, menuWorld: null, player: null, inv: new Inventory(), cursor: null,
  time: 0.05, day: 1, sky: null, paused: false, ui: null, audio: GameAudio, worldName: 'New World',
  stats: null, menuCam: null, fps: 0, frames: 0, fpsT: 0, debug: false, benchNear: false, benchT: 0,
  server: null, serverSpawn: null, score: { k: 0, d: 0 }, playerTarget: null, wasSafe: false,
  target: null, mobTarget: null, lastNightWarn: 0, loadTarget: 0, loadDone: 0, hideHud: false,

  resetStats() { this.stats = { kills: 0, mined: 0, placed: 0 }; },
  get creative() { return this.mode === 'creative'; },

  /* ---------- menu backdrop ---------- */
  startMenu() {
    this.state = 'menu';
    if (!this.menuWorld) {
      this.menuWorld = new World(20261106);
      const sp = this.menuWorld.findSpawn();
      this.menuCam = { x: sp[0] + 40, z: sp[2] + 6, y: sp[1] + 12, t: 0 };
    }
    GameAudio.setMode('menu');
  },
  /* ---------- world lifecycle ---------- */
  disposeWorld(w) {
    if (!w) return;
    for (const c of w.chunks.values()) freeChunkMesh(c);
    w.chunks.clear();
  },
  newWorld(name, seedStr, difficulty, mode) {
    this.disposeWorld(this.menuWorld); this.menuWorld = null;
    this.disposeWorld(this.world);
    Settings.difficulty = difficulty; saveSettings();
    const seed = seedFromString(seedStr === '' ? String((Math.random() * 1e9) | 0) : seedStr);
    this.seedLabel = seedStr === '' ? String(seed) : seedStr;
    this.world = new World(seed); this.resetRealms();
    this.worldName = name || 'New World';
    this.worldId = newId(); this.created = Date.now();
    const spawn = this.world.findSpawn();
    this.player = newPlayer(spawn);
    this.inv = new Inventory(); this.cursor = null;
    this.mode = mode === 'creative' ? 'creative' : 'survival';
    if (this.creative) CREATIVE_START.forEach((id, i) => { this.inv.s[i] = { id, n: ITEMS[id].stack }; });
    this.time = 0.04; this.day = 1; this.lastNightDay = 0;
    this.resetStats(); Atmos.reset(); this.furnaces = new Map();
    Mobs.clear(); Drops.clear(); Particles.clear();
    this.state = 'loading';
    this.loadR = Math.min(Settings.renderDist, 5);
    UI.show('loading');
  },
  finishLoading() {
    const P = this.player, w = this.world;
    if (this.arriving) this.arriveRealm();
    // make sure we are not inside a tree / wall
    let x = Math.floor(P.pos[0]), z = Math.floor(P.pos[2]), y = Math.floor(P.pos[1]);
    while (y < WH - 2 && (SOLID[w.getBlock(x, y, z)] || SOLID[w.getBlock(x, y + 1, z)])) y++;
    P.pos[1] = y; P.spawn = this.keepSpawn || [P.pos[0], y, P.pos[2]]; this.keepSpawn = null;
    if (this.spawnAtLoaded) { P.pos[1] = y; this.spawnAtLoaded = false; }
    this.state = 'play'; this.paused = false; this.saveT = 60; this.view = 0;
    GameAudio.setMode('game');
    UI.enterGame();
    if (this.pendingNet && this.pendingNet.server) {
      const pn = this.pendingNet; this.pendingNet = null; Net.setupServer(pn.room, pn.server);
      P.protect = this.server.mode === 'pvp' ? 5 : 0;
      UI.banner(pn.server.name, pn.server.mode === 'pvp' ? 'PVP is on outside the spawn safe zone · T to chat' : SERVER_MODES[pn.server.mode] + ' server · T to chat');
    }
    else if (this.pendingNet) { const pn = this.pendingNet; this.pendingNet = null; Net.setup(pn.room, pn.code, false); UI.toast(`Joined ${Net.pretty(pn.code)} — press T to chat`); }
    else if (this.noHint) this.noHint = false;
    else setTimeout(() => UI.toast(this.creative ? (Input.touch ? 'Creative — double-tap ⇧ to fly · ⋯ opens every block' : 'Creative — double-tap Space to fly · E opens every block') : Input.touch ? 'Tap to place or use · hold to break · ⋯ opens crafting' : 'Hold left mouse to mine · E to craft · Esc for menu'), 900);
    if (this.pendingHost) { this.pendingHost = false; this.openParty(); }
  },
  async quitToTitle() {
    if (this.server) { this.saveServerPlayer(); await Net.leave(); this.server = null; }
    if (Net.active) await Net.leave();
    if (this.worldId && this.player) { try { await this.saveWorld(); } catch (e) { } }
    this.disposeWorld(this.world); this.world = null; this.player = null;
    Mobs.clear(); Drops.clear(); Particles.clear();
    this.paused = false; this.ui = null;
    this.startMenu();
    UI.show('title');
  },
  buildSave() {
    const P = this.player;
    const inv = []; this.inv.s.forEach((st, i) => { if (st) inv.push([i, st.id, st.n, st.d === undefined ? -1 : st.d]); });
    return {
      v: 2, gen: this.world.gen, id: this.worldId, name: this.worldName, seed: this.world.seed, seedLabel: String(this.seedLabel), mode: this.mode, diff: Settings.difficulty,
      time: this.time, day: this.day, created: this.created || Date.now(), savedAt: Date.now(),
      edits: this.dim ? (this.dimEdits[0] || '') : this.world.encodeEdits(), dim: this.dim, dims: (() => { const d = this.realmEdits(); delete d[0]; return d; })(), ret: this.ret, kingDead: this.kingDead,
      player: { pos: P.pos.map(r2), yaw: r2(P.yaw), pitch: r2(P.pitch), health: P.alive ? P.health : 20, hunger: P.hunger, sat: P.sat, spawn: P.spawn.map(r2), flying: !!P.flying, inv, sel: this.inv.sel,
        armor: this.inv.armor.map(st => st ? [st.id, st.d === undefined ? -1 : st.d] : null) },
      furnaces: this.allFurnaces(),
      stats: this.stats, weather: Atmos.save(),
    };
  },
  async saveWorld() {
    if (this.server) { this.saveServerPlayer(); return; }
    if (!this.worldId || !this.world || this.saving) return;
    this.saving = true; UI.saveNote('Saving…');
    try { const where = await Saves.save(this.buildSave()); UI.saveNote(where === 'cloud' ? 'Saved to your account' : 'Saved in this browser'); }
    catch (e) { UI.saveNote('Could not save: ' + (e && e.message ? e.message : 'storage unavailable')); }
    finally { this.saving = false; }
  },
  loadWorld(data) {
    this.disposeWorld(this.menuWorld); this.menuWorld = null;
    this.disposeWorld(this.world);
    Settings.difficulty = clamp(data.diff | 0, 0, 3);
    this.resetRealms(data);
    this.world = new World(data.seed | 0, data.gen === 3 ? 3 : data.gen === 2 ? 2 : 1, this.dim);
    this.world.loadEdits(this.dim ? (this.dimEdits[this.dim] || '') : (data.edits || ''));
    if (this.dim) this.dimEdits[0] = data.edits || '';
    this.worldId = data.id; this.worldName = data.name || 'World'; this.seedLabel = data.seedLabel || String(data.seed); this.created = data.created;
    this.mode = data.mode === 'creative' ? 'creative' : 'survival';
    const p = data.player || {};
    const spawn = Array.isArray(p.spawn) ? p.spawn : this.world.findSpawn();
    this.player = newPlayer(spawn); this.keepSpawn = Array.isArray(p.spawn) ? p.spawn.slice() : null;
    if (Array.isArray(p.pos)) this.player.pos = p.pos.slice();
    this.player.yaw = p.yaw || 0; this.player.pitch = p.pitch || 0; this.player.flying = !!p.flying && this.mode === 'creative';
    if (p.health) this.player.health = p.health; if (p.hunger !== undefined) this.player.hunger = p.hunger; if (p.sat !== undefined) this.player.sat = p.sat;
    this.inv = new Inventory(); this.cursor = null;
    for (const [i, id, n, d] of (p.inv || [])) if (ITEMS[id] && i >= 0 && i < 36) { this.inv.s[i] = { id, n: clamp(n, 1, ITEMS[id].stack) }; if (ITEMS[id].tool) this.inv.s[i].d = d >= 0 ? d : ITEMS[id].tool.dur; }
    this.inv.sel = clamp(p.sel | 0, 0, 8);
    (p.armor || []).forEach((a, s) => { if (a && ITEMS[a[0]] && ITEMS[a[0]].armor && ITEMS[a[0]].armor.slot === s) this.inv.armor[s] = { id: a[0], n: 1, d: a[1] >= 0 ? a[1] : ITEMS[a[0]].armor.dur }; });
    this.furnaces = new Map();
    for (const f of (data.furnaces || [])) {
      const fd = f[7] | 0; let st;
      if (fd === this.dim) st = this.furnaceAt(f[0], f[1], f[2], true);
      else { const m = this.dimFurn[fd] || (this.dimFurn[fd] = new Map()); st = { x: f[0], y: f[1], z: f[2], s: [null, null, null], burn: 0, burnMax: 0, prog: 0 }; m.set(f[0] + ',' + f[1] + ',' + f[2], st); }
      st.s = (f[3] || [null, null, null]).map(x => x && ITEMS[x[0]] ? { id: x[0], n: x[1] } : null); st.burn = +f[4] || 0; st.burnMax = +f[5] || 0; st.prog = +f[6] || 0;
    }
    this.time = data.time || 0.04; this.day = Math.floor(this.time) + 1; this.lastNightDay = (this.time % 1) > 0.52 ? this.day : 0;
    this.stats = Object.assign({ kills: 0, mined: 0, placed: 0 }, data.stats || {});
    Atmos.reset(data.weather);
    Mobs.clear(); Drops.clear(); Particles.clear();
    this.state = 'loading'; this.loadR = Math.min(Settings.renderDist, 5);
    UI.show('loading');
  },
  /* ---------- servers ---------- */
  async joinServer(srv, status) {
    if (!Cloud.room) throw new Error('Servers aren’t available in this view.');
    status && status('Connecting…');
    await Servers.checkWrite();
    const room = await Cloud.room.join(Servers.roomName(srv.id));
    status && status('Downloading the world…');
    const st = await Servers.loadState(srv.id);
    // a quick look for someone already there, to pick up the live clock and weather
    let keeper = null; const t0 = Date.now();
    while (Date.now() - t0 < 1500) {
      keeper = room.peers().find(p => !p.sameTab && !p.isMe && p.presence && p.presence.role === 'host' && typeof p.presence.t === 'number');
      if (keeper) break;
      await sleep(250);
    }
    this.startServerWorld(srv, st, keeper ? keeper.presence : null, room);
  },
  startServerWorld(srv, st, kp, room) {
    this.disposeWorld(this.menuWorld); this.menuWorld = null;
    this.disposeWorld(this.world);
    Settings.difficulty = srv.mode === 'creative' ? 0 : 2;
    this.resetRealms();
    this.world = new World(seedFromString(srv.seed), srv.gen === 3 ? 3 : srv.gen === 2 ? 2 : 1);
    this.world.loadEdits(st.edits || '');
    this.worldId = null; this.server = srv; this.worldName = srv.name; this.seedLabel = srv.seed; this.created = Date.now();
    this.mode = srv.mode === 'creative' ? 'creative' : 'survival';
    const spawn = this.world.findSpawn(); this.serverSpawn = spawn.slice();
    const sv = Servers.loadPlayer(srv.id) || {};
    this.player = newPlayer(spawn); this.inv = new Inventory(); this.cursor = null;
    const P = this.player;
    if (Array.isArray(sv.pos) && sv.pos.every(v => typeof v === 'number' && isFinite(v)) && sv.alive !== false) {
      P.pos = sv.pos.slice(); P.yaw = +sv.yaw || 0; P.pitch = +sv.pitch || 0;
      if (sv.health > 0) P.health = clamp(sv.health, 1, 20); if (sv.hunger >= 0) P.hunger = clamp(sv.hunger, 0, 20); if (sv.sat >= 0) P.sat = sv.sat;
      P.flying = !!sv.flying && this.creative;
    }
    this.keepSpawn = Array.isArray(sv.spawn) ? sv.spawn.slice() : spawn.slice();
    for (const [i, id, n, d] of (sv.inv || [])) if (ITEMS[id] && i >= 0 && i < 36) { this.inv.s[i] = { id, n: clamp(n, 1, ITEMS[id].stack) }; if (ITEMS[id].tool) this.inv.s[i].d = d >= 0 ? d : ITEMS[id].tool.dur; }
    (sv.armor || []).forEach((a, s) => { if (a && ITEMS[a[0]] && ITEMS[a[0]].armor && ITEMS[a[0]].armor.slot === s) this.inv.armor[s] = { id: a[0], n: 1, d: a[1] >= 0 ? a[1] : ITEMS[a[0]].armor.dur }; });
    this.inv.sel = clamp(sv.sel | 0, 0, 8);
    if (!sv.inv) { if (this.creative) CREATIVE_START.forEach((id, i) => { this.inv.s[i] = { id, n: ITEMS[id].stack }; }); else if (srv.mode === 'pvp') this.giveKit(); }
    this.score = { k: sv.score ? clamp(sv.score[0] | 0, 0, 99999) : 0, d: sv.score ? clamp(sv.score[1] | 0, 0, 99999) : 0 };
    const t = kp && typeof kp.t === 'number' ? kp.t : st.time;
    this.time = typeof t === 'number' && isFinite(t) ? Math.max(0, t) : 0.04;
    this.day = Math.floor(this.time) + 1; this.lastNightDay = (this.time % 1) > 0.52 ? this.day : 0;
    this.resetStats(); Atmos.reset(st.weather || undefined); if (kp && typeof kp.w === 'number') Atmos.rainTarget = clamp(kp.w, 0, 1);
    this.furnaces = new Map();
    Mobs.clear(); Drops.clear(); Particles.clear();
    this.pendingNet = { room, server: srv };
    this.state = 'loading'; this.loadR = Math.min(Settings.renderDist, 5);
    UI.show('loading');
  },
  saveServerPlayer() {
    if (!this.server || !this.player) return;
    const P = this.player, alive = P.alive;
    const inv = []; if (alive || !Net.pvp) this.inv.s.forEach((st, i) => { if (st) inv.push([i, st.id, st.n, st.d === undefined ? -1 : st.d]); });
    Servers.savePlayer(this.server.id, {
      v: 1, alive, pos: P.pos.map(r2), yaw: r2(P.yaw), pitch: r2(P.pitch), health: alive ? P.health : 20, hunger: P.hunger, sat: P.sat,
      spawn: P.spawn.map(r2), flying: !!P.flying, inv, sel: this.inv.sel, savedAt: Date.now(),
      armor: alive ? this.inv.armor.map(st => st ? [st.id, st.d === undefined ? -1 : st.d] : null) : [],
      score: [this.score.k, this.score.d],
    });
  },
  giveKit() {
    PVP_KIT.forEach(([id, n], i) => { if (!this.inv.s[i]) { this.inv.s[i] = { id, n }; if (ITEMS[id].tool) this.inv.s[i].d = ITEMS[id].tool.dur; } });
    this.inv.touch();
  },
  inSafeZone(x, z) {
    const s = this.serverSpawn;
    return !!(this.server && this.server.mode === 'pvp' && s && (x - s[0]) * (x - s[0]) + (z - s[2]) * (z - s[2]) < SAFE_R * SAFE_R);
  },
  safeNote(kind) {
    const now = performance.now(); if (now - (this.safeNoteT || 0) < 2500) return; this.safeNoteT = now;
    UI.toast(kind === 'build' ? 'The spawn area is protected — build outside the safe zone.' : 'No fighting in the spawn safe zone.');
  },
  pvpHitBy(r, dmg, knock) {
    const P = this.player; if (!P || !P.alive || this.creative || this.state !== 'play') return;
    if (P.protect > 0 || this.inSafeZone(P.pos[0], P.pos[2]) || this.inSafeZone(r.tpos[0], r.tpos[2])) return;
    if (Math.hypot(r.tpos[0] - P.pos[0], r.tpos[1] - P.pos[1], r.tpos[2] - P.pos[2]) > 7) return;
    P.lastAttacker = { peer: r.peer, name: r.name, t: performance.now() };
    this.damagePlayer(dmg, 'player', knock);
  },
  onKill(r, loot) {
    const P = this.player; if (!P) return;
    this.score.k++;
    if (P.alive) P.health = Math.min(20, P.health + 4);
    UI.banner('Victory', `You defeated ${r.name}`); GameAudio.pickup && GameAudio.pickup();
    let given = 0;
    for (let i = 0; i + 1 < loot.length && given < 40; i += 2) {
      const id = loot[i] | 0, n = loot[i + 1] | 0;
      if (!ITEMS[id] || n < 1) continue;
      Drops.spawn(id, Math.min(n, ITEMS[id].stack), undefined, r.pos[0], r.pos[1] + 1, r.pos[2], [(Math.random() - 0.5) * 4, 3 + Math.random() * 2, (Math.random() - 0.5) * 4]);
      given++;
    }
    UI.partyChanged();
  },

  async openParty() {
    if (Net.active) return;
    if (this.dim) { UI.toast('Return to the Overworld before opening a party.'); return; }
    try {
      const code = await Net.host();
      UI.partyOpened(code);
    } catch (e) { UI.toast('Could not open a party: ' + (e && e.message ? e.message : 'room unavailable')); }
  },
  async joinParty(code, status) {
    const r = await Net.join(code, status);
    this.disposeWorld(this.menuWorld); this.menuWorld = null;
    this.disposeWorld(this.world);
    const pm = r.pm;
    Settings.difficulty = clamp(pm.diff | 0, 0, 3);
    this.resetRealms();
    this.world = new World(pm.seed | 0, pm.gen === 3 ? 3 : pm.gen === 2 ? 2 : 1);
    this.world.loadEdits(r.edits);
    this.worldId = null; this.worldName = (String(pm.name || 'Party world').slice(0, 32)) + ' (party)'; this.seedLabel = pm.sl || String(pm.seed);
    this.mode = pm.mode === 'creative' ? 'creative' : 'survival';
    let spawn = r.pos && r.pos.every(v => typeof v === 'number' && isFinite(v)) ? [r.pos[0] + 1.5, r.pos[1], r.pos[2] + 0.5] : this.world.findSpawn();
    this.player = newPlayer(spawn); this.spawnAtLoaded = true;
    this.player.spawn = this.world.findSpawn();
    this.inv = new Inventory(); this.cursor = null;
    if (this.creative) CREATIVE_START.forEach((id, i) => { this.inv.s[i] = { id, n: ITEMS[id].stack }; });
    this.time = r.time; this.day = Math.floor(this.time) + 1; this.lastNightDay = (this.time % 1) > 0.52 ? this.day : 0;
    this.resetStats(); Atmos.reset(); this.furnaces = new Map();
    Mobs.clear(); Drops.clear(); Particles.clear();
    this.pendingNet = { room: r.room, code: r.code };
    this.state = 'loading'; this.loadR = Math.min(Settings.renderDist, 5);
    UI.show('loading');
  },

  /* ---------- chunk streaming ---------- */
  spiral: null,
  stream(world, px, pz, radius, budgetMs) {
    if (!this.spiral) {
      const s = [];
      for (let z = -20; z <= 20; z++) for (let x = -20; x <= 20; x++) s.push([x, z, x * x + z * z]);
      s.sort((a, b) => a[2] - b[2]); this.spiral = s;
    }
    const t0 = performance.now();
    const ccx = Math.floor(px) >> 4, ccz = Math.floor(pz) >> 4;
    // urgent remeshes first (block edits) — unbudgeted
    for (const c of world.chunks.values()) {
      if (c.urgent && c.mesh !== undefined) {
        c.urgent = false;
        if (this.neighboursReady(world, c)) { uploadChunkMesh(c, meshChunk(world, c)); c.dirty = false; }
      }
    }
    const r2 = (radius + 2) * (radius + 2), rm2 = radius * radius + 1;
    let generated = 0, meshed = 0, pending = 0;
    for (const [ox, oz, d2] of this.spiral) {
      if (d2 > r2) break;
      const cx = ccx + ox, cz = ccz + oz;
      let c = world.getChunk(cx, cz);
      if (!c) {
        if (performance.now() - t0 > budgetMs) { pending++; continue; }
        c = new Chunk(cx, cz); world.generate(c); world.chunks.set(ckey(cx, cz), c); generated++;
        continue;
      }
      if (d2 <= rm2 && c.dirty) {
        if (!this.neighboursReady(world, c)) { pending++; continue; }
        if (performance.now() - t0 > budgetMs) { pending++; continue; }
        uploadChunkMesh(c, meshChunk(world, c)); c.dirty = false; c.meshedOnce = true; meshed++;
      }
    }
    // unload far chunks occasionally
    world.unloadT = (world.unloadT || 0) + 1;
    if (world.unloadT > 60) {
      world.unloadT = 0;
      for (const [k, c] of world.chunks) {
        const d = Math.max(Math.abs(c.cx - ccx), Math.abs(c.cz - ccz));
        if (d > radius + 3 && c.mesh) { freeChunkMesh(c); c.dirty = true; }
        if (d > radius + 7) world.chunks.delete(k);
      }
    }
    return pending;
  },
  neighboursReady(world, c) {
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!world.getChunk(c.cx + i, c.cz + j)) return false;
    return true;
  },
  loadingProgress() {
    const w = this.world, P = this.player, r = this.loadR;
    const ccx = Math.floor(P.pos[0]) >> 4, ccz = Math.floor(P.pos[2]) >> 4;
    let total = 0, done = 0;
    for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) {
      if (x * x + z * z > r * r + 1) continue;
      total++; const c = w.getChunk(ccx + x, ccz + z); if (c && !c.dirty) done++;
    }
    return done / total;
  },

  /* ---------- helpers ---------- */
  eyePos() { const P = this.player; return [P.pos[0], P.pos[1] + (P.sneak ? 1.45 : 1.62), P.pos[2]]; },
  lookDir() { const P = this.player, cp = Math.cos(P.pitch); return [Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp]; },
  // where the player is pointing: the screen centre, or the spot under a finger on touch screens
  aimDir() {
    const a = Input.aim, f = this.lookDir(); if (!a || !Input.touch) return f;
    const P = this.player, r = [Math.cos(P.yaw), 0, Math.sin(P.yaw)];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const th = Math.tan((Settings.fov + (P.fovBoost || 0) * 10) * Math.PI / 360), ax = a[0] * th * innerWidth / innerHeight, ay = a[1] * th;
    const d = [f[0] + r[0] * ax + u[0] * ay, f[1] + r[1] * ax + u[1] * ay, f[2] + r[2] * ax + u[2] * ay], l = Math.hypot(d[0], d[1], d[2]);
    return [d[0] / l, d[1] / l, d[2] / l];
  },
  heldDef() { const h = this.inv.held; return h ? ITEMS[h.id] : null; },
  breakTime(id) {
    const def = BLOCKS[id]; if (!def) return -1;
    if (this.creative) return 0;
    if (def.hard < 0) return -1;
    if (def.hard === 0) return 0;
    const h = this.heldDef(), tool = h && h.tool;
    const speed = tool && def.tool === tool.type ? tool.speed : 1;
    const can = this.canHarvest(id);
    let t = def.hard * (can ? 1.5 : 5) / speed;
    if (this.player.headInWater) t *= 3;
    if (!this.player.onGround && !this.player.inWater) t *= 2;
    return t;
  },
  canHarvest(id) {
    const def = BLOCKS[id]; if (!def.tier) return true;
    const h = this.heldDef(), tool = h && h.tool;
    return !!(tool && tool.type === def.tool && tool.tier >= def.tier);
  },
  useTool(amount) {
    const st = this.inv.held; if (!st || st.d === undefined || this.creative) return;
    st.d -= amount;
    if (st.d <= 0) {
      const name = ITEMS[st.id].name;
      this.inv.s[this.inv.sel] = null; GameAudio.toolBreak(); UI.toast(`Your ${name} broke!`);
      const e = this.eyePos(), d = this.lookDir();
      Particles.burst(e[0] + d[0] * 0.6, e[1] - 0.3, e[2] + d[2] * 0.6, TEX[ITEMS[st.id].icon], 10, { size: 0.05, speed: 2 });
    }
    this.inv.touch();
  },
  addExh(v) { if (Settings.difficulty > 0 && !this.creative) this.player.exh += v; },

  /* ---------- block actions ---------- */
  breakBlock(x, y, z) {
    const w = this.world, id = w.getBlock(x, y, z);
    const can = this.canHarvest(id);
    if (isChest(id)) this.spillChest(x, y, z);
    if (isDoor(id)) { if (isDoor(w.getBlock(x, y + 1, z))) w.setBlock(x, y + 1, z, 0); if (isDoor(w.getBlock(x, y - 1, z))) w.setBlock(x, y - 1, z, 0); }
    w.setBlock(x, y, z, 0);
    GameAudio.breakBlock(id);
    const layer = FACE_TEX[id][id === B.GRASS ? 2 : 0];
    if (RTYPE[id] === RT_CROSS || isTorch(id)) Particles.burst(x + 0.5, y + 0.4, z + 0.5, layer, 8, { spread: 0.5, speed: 1.6 });
    else Particles.burst(x + 0.5, y + 0.5, z + 0.5, layer, 26, {});
    if (this.creative) { /* creative: no drops */ }
    else if (can) {
      const drops = BLOCKS[id].drop ? BLOCKS[id].drop(Math.random) : [[id, 1]];
      for (const [did, n] of drops) if (n > 0 && ITEMS[did]) Drops.spawn(did, n, undefined, x + 0.5, y + 0.4, z + 0.5);
    } else if (BLOCKS[id].tier && !this.creative) {
      UI.toast(BLOCKS[id].tier >= 2 ? 'This ore needs a Stone Pickaxe or better.' : 'You need a pickaxe to collect stone.');
    }
    if (BLOCKS[id].hard > 0) this.useTool(1);
    this.addExh(0.005);
    this.stats.mined++;
    this.checkSupport(x, y, z);
  },
  checkSupport(x, y, z, remote) {
    const w = this.world;
    const pop = (bx, by, bz) => {
      const id = w.getBlock(bx, by, bz);
      w.setBlock(bx, by, bz, 0, remote);
      if (this.creative || remote) return;
      const drops = BLOCKS[id].drop ? BLOCKS[id].drop(Math.random) : [[id, 1]];
      for (const [did, n] of drops) if (n > 0 && ITEMS[did]) Drops.spawn(did, n, undefined, bx + 0.5, by + 0.3, bz + 0.5);
      Particles.burst(bx + 0.5, by + 0.4, bz + 0.5, FACE_TEX[id][0], 6, { spread: 0.5, speed: 1.4 });
    };
    const above = w.getBlock(x, y + 1, z);
    if (isPlant(above) || above === B.TORCH) pop(x, y + 1, z);
    if (isDoor(above) && !isDoor(w.getBlock(x, y, z))) { if (isDoor(w.getBlock(x, y + 2, z))) w.setBlock(x, y + 2, z, 0, remote); pop(x, y + 1, z); }
    const sides = [[1, 0, B.TORCH_W0], [-1, 0, B.TORCH_W1], [0, 1, B.TORCH_W2], [0, -1, B.TORCH_W3]];
    for (const [dx, dz, tid] of sides) if (w.getBlock(x + dx, y, z + dz) === tid) pop(x + dx, y, z + dz);
    if (!OPAQUE[w.getBlock(x, y, z)]) sides.forEach(([dx, dz], k) => { if (w.getBlock(x + dx, y, z + dz) === B.LADDER + k) pop(x + dx, y, z + dz); });
  },
  tryPlace(hit) {
    const w = this.world, P = this.player, st = this.inv.held;
    if (!st) return false;
    const def = ITEMS[st.id]; if (!def.block) return false;
    let px = hit.x + hit.n[0], py = hit.y + hit.n[1], pz = hit.z + hit.n[2];
    if (REPLACEABLE[hit.id] && hit.id !== B.WATER) { px = hit.x; py = hit.y; pz = hit.z; }
    if (py < 1 || py >= WH - 1) return false;
    if (this.inSafeZone(px + 0.5, pz + 0.5)) { this.safeNote('build'); return false; }
    const cur = w.getBlock(px, py, pz);
    if (cur && !REPLACEABLE[cur]) return false;
    let id = def.block;
    if (id === B.LADDER) {
      // clicking a ladder extends it up (or down when looking down)
      if (isLadder(hit.id)) {
        const step = this.lookDir()[1] < -0.35 ? -1 : 1;
        let yy = hit.y; while (isLadder(w.getBlock(hit.x, yy, hit.z)) && Math.abs(yy - hit.y) < 64) yy += step;
        const k = hit.id - B.LADDER, sup = [[-1, 0], [1, 0], [0, -1], [0, 1]][k];
        if (w.getBlock(hit.x, yy, hit.z) !== 0 && !REPLACEABLE[w.getBlock(hit.x, yy, hit.z)]) return false;
        if (!OPAQUE[w.getBlock(hit.x + sup[0], yy, hit.z + sup[1])] || yy < 1 || yy >= WH - 1) return false;
        px = hit.x; py = yy; pz = hit.z; id = hit.id;
      } else {
        const n = hit.n;
        if (n[1] !== 0 || (px === hit.x && py === hit.y && pz === hit.z)) return false;
        if (!OPAQUE[w.getBlock(px - n[0], py, pz - n[2])] || cur === B.WATER) return false;
        id = n[0] === 1 ? B.LADDER : n[0] === -1 ? B.LADDER + 1 : n[2] === 1 ? B.LADDER + 2 : B.LADDER + 3;
      }
    }
    if (id === B.DOOR) {
      const up = w.getBlock(px, py + 1, pz);
      if ((up && !REPLACEABLE[up]) || up === B.WATER || cur === B.WATER || !OPAQUE[w.getBlock(px, py - 1, pz)] || py + 1 >= WH - 1) return false;
      const dx = P.pos[0] - (px + 0.5), dz = P.pos[2] - (pz + 0.5);
      const side = Math.abs(dz) >= Math.abs(dx) ? (dz < 0 ? 0 : 2) : (dx > 0 ? 1 : 3);
      id = B.DOOR + side * 2;
      const hw = P.hw;
      if (px + 1 > P.pos[0] - hw && px < P.pos[0] + hw && pz + 1 > P.pos[2] - hw && pz < P.pos[2] + hw && py + 2 > P.pos[1] && py < P.pos[1] + P.h) return false;
    }
    if (id === B.TORCH) {
      const n = (px === hit.x && py === hit.y && pz === hit.z) ? [0, 1, 0] : hit.n;
      const support = [px - n[0], py - n[1], pz - n[2]];
      if (!OPAQUE[w.getBlock(...support)]) return false;
      if (n[1] === 1) id = B.TORCH;
      else if (n[1] === -1) return false;
      else id = n[0] === 1 ? B.TORCH_W0 : n[0] === -1 ? B.TORCH_W1 : n[2] === 1 ? B.TORCH_W2 : B.TORCH_W3;
      if (cur === B.WATER) return false;
    }
    if (isPlant(id)) {
      const below = w.getBlock(px, py - 1, pz);
      if (BLOCKS[id].anyGround ? !OPAQUE[below] : (below !== B.GRASS && below !== B.DIRT)) return false;
      if (cur === B.WATER) return false;
    }
    if (id === B.CAMPFIRE && (!OPAQUE[w.getBlock(px, py - 1, pz)] || cur === B.WATER)) return false;
    if (id === B.CHEST) {
      // the latch faces whoever places it
      const dx = P.pos[0] - (px + 0.5), dz = P.pos[2] - (pz + 0.5);
      id = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? B.CHEST_E : B.CHEST_W) : (dz > 0 ? B.CHEST : B.CHEST_N);
      w.chests.delete(px + ',' + py + ',' + pz);
    }
    if (SOLID[id]) {
      const hw = P.hw;
      if (px + 1 > P.pos[0] - hw && px < P.pos[0] + hw && pz + 1 > P.pos[2] - hw && pz < P.pos[2] + hw && py + 1 > P.pos[1] && py < P.pos[1] + P.h) return false;
      for (const m of Mobs.list) if (px + 1 > m.pos[0] - 0.3 && px < m.pos[0] + 0.3 && pz + 1 > m.pos[2] - 0.3 && pz < m.pos[2] + 0.3 && py + 1 > m.pos[1] && py < m.pos[1] + 1.9) return false;
    }
    w.setBlock(px, py, pz, id);
    if (isDoor(id)) w.setBlock(px, py + 1, pz, id);
    GameAudio.place(id);
    if (!this.creative) { st.n--; if (!st.n) this.inv.s[this.inv.sel] = null; }
    this.inv.touch();
    this.stats.placed++;
    return true;
  },

  setMode(m) {
    this.mode = m;
    const P = this.player;
    if (P) { P.flying = m === 'creative' && P.flying; P.fallDist = 0; if (m === 'creative') { P.health = 20; P.hunger = 20; P.air = 15; } }
    Mobs.list.forEach(x => { if (m === 'creative') x.wanderT = 0; });
    this.inv.touch(); UI.lastHearts = UI.lastFood = '';
  },
  /* ---------- doors ---------- */
  toggleDoor(x, y, z) {
    const w = this.world, id = w.getBlock(x, y, z); if (!isDoor(id)) return;
    const y0 = isDoor(w.getBlock(x, y - 1, z)) ? y - 1 : y, nid = id ^ 1;
    // a closing door can't shut on someone standing in the doorway
    if (!((nid - B.DOOR) & 1)) {
      const P = this.player, hw = P.hw;
      if (x + 1 > P.pos[0] - hw && x < P.pos[0] + hw && z + 1 > P.pos[2] - hw && z < P.pos[2] + hw && y0 + 2 > P.pos[1] && y0 < P.pos[1] + P.h) { GameAudio.tone({ freq: 160, gain: 0.06, decay: 0.08, type: 'square' }); return; }
    }
    for (const yy of [y0, y0 + 1]) if (isDoor(w.getBlock(x, yy, z))) w.setBlock(x, yy, z, nid);
    GameAudio.door((nid - B.DOOR) & 1);
  },

  /* ---------- chests ---------- */
  spillChest(x, y, z) {
    const w = this.world, c = w.chestAt(x, y, z);
    if (!c) return;
    for (const st of c.s) if (st) Drops.spawn(st.id, st.n, st.d, x + 0.5, y + 0.5, z + 0.5, [(Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3]);
    c.s.fill(null); this.chestChanged(c);
    w.chests.delete(x + ',' + y + ',' + z);
    if (UI.chest === c) UI.closeInventory();
  },
  chestChanged(c) {
    c.v = (c.v | 0) + 1; this.world.editVer++;
    if (Net.active) Net.chestEdit(c);
  },
  chestClosed(c) { },
  applyRemoteChest(x, y, z, v, slots) {
    const w = this.world; if (!w) return;
    const c = w.chestAt(x, y, z, true);
    if (v <= c.v) return;
    c.v = v; c.s = decodeSlots(slots, 27); w.editVer++;
    if (UI.chest === c) { UI.refreshInventory(); }
  },
  checkOpenChest() {
    const c = UI.chest; if (!c) return;
    const P = this.player, gone = !isChest(this.world.getBlock(c.x, c.y, c.z));
    if (gone || !P.alive || Math.hypot(P.pos[0] - c.x - 0.5, P.pos[1] + 1 - c.y - 0.5, P.pos[2] - c.z - 0.5) > 8) UI.closeInventory();
  },

  /* ---------- furnaces ---------- */
  furnaces: new Map(),
  furnaceAt(x, y, z, create) {
    const k = x + ',' + y + ',' + z; let f = this.furnaces.get(k);
    if (!f && create) { f = { x, y, z, s: [null, null, null], burn: 0, burnMax: 0, prog: 0 }; this.furnaces.set(k, f); }
    return f;
  },
  updateFurnaces(dt) {
    const w = this.world;
    for (const [k, f] of this.furnaces) {
      if (!w.isLoaded(f.x, f.z)) continue;
      const id = w.getBlock(f.x, f.y, f.z);
      if (id !== B.FURNACE && id !== B.FURNACE_LIT) {
        f.s.forEach(st => st && Drops.spawn(st.id, st.n, undefined, f.x + 0.5, f.y + 0.5, f.z + 0.5));
        this.furnaces.delete(k); if (UI.furnace === f) UI.closeInventory(); continue;
      }
      const [inp, fuel, out] = f.s, res = inp ? SMELT[inp.id] : undefined;
      const can = res !== undefined && (!out || (out.id === res && out.n < ITEMS[res].stack));
      let changed = false;
      if (f.burn <= 0 && can && fuel && FUEL[fuel.id]) { f.burn = f.burnMax = FUEL[fuel.id]; fuel.n--; if (!fuel.n) f.s[1] = null; changed = true; }
      if (f.burn > 0) {
        f.burn -= dt;
        if (can) {
          f.prog += dt / SMELT_TIME;
          if (f.prog >= 1) { f.prog = 0; inp.n--; if (!inp.n) f.s[0] = null; if (out) out.n++; else f.s[2] = { id: res, n: 1 }; changed = true; }
        } else f.prog = 0;
      } else f.prog = Math.max(0, f.prog - dt * 2);
      const lit = f.burn > 0;
      if (lit && id === B.FURNACE) w.setBlock(f.x, f.y, f.z, B.FURNACE_LIT);
      else if (!lit && id === B.FURNACE_LIT) w.setBlock(f.x, f.y, f.z, B.FURNACE);
      if (changed && UI.furnace === f) UI.refreshInventory();
    }
  },
  useBed(x, y, z) {
    const P = this.player;
    if (this.dim) { UI.toast('You can’t rest in this realm.'); return; }
    P.spawn = [x + 0.5, y + 1, z + 0.5];
    if (Net.active) { UI.toast('Spawn point set. Sleeping through the night is off in parties.'); return; }
    if (this.sky.night < 0.5) { UI.toast('Spawn point set. You can only sleep at night.'); return; }
    if (!this.creative && Mobs.list.some(m => !m.animal && Math.hypot(m.pos[0] - P.pos[0], m.pos[2] - P.pos[2]) < 10)) { UI.toast('You can’t sleep with creatures nearby!'); return; }
    UI.sleep(() => {
      this.time = Math.floor(this.time + 0.3) + 0.02;
      this.sky = skyState(this.time % 1, Atmos.rain, 0);
      P.hunger = Math.max(Settings.difficulty ? 4 : 20, P.hunger - 3);
    });
  },
  /* ---------- damage ---------- */
  damagePlayer(amount, cause, knock) {
    const P = this.player;
    if (!P || !P.alive || (P.invuln > 0 && cause !== 'player') || amount <= 0) return;
    if (this.creative) return;
    if (cause === 'gloom' || cause === 'crawler' || cause === 'player') {
      const pts = this.inv.armorPoints;
      if (pts > 0) {
        amount *= 1 - Math.min(0.8, pts * 0.04);
        this.inv.armor.forEach((st, s) => {
          if (!st) return; st.d = (st.d === undefined ? ITEMS[st.id].armor.dur : st.d) - 1;
          if (st.d <= 0) { this.inv.armor[s] = null; GameAudio.toolBreak(); UI.toast(`Your ${ITEMS[st.id].name} broke!`); }
        });
        this.inv.touch();
      }
    }
    P.health -= amount; P.invuln = 0.55; P.hurtTilt = 1;
    GameAudio.hurt(); UI.hurtFlash();
    if (knock) { P.vel[0] += knock[0] * 7; P.vel[2] += knock[1] * 7; P.vel[1] = Math.max(P.vel[1], 4.5); }
    this.addExh(0.1);
    if (P.health <= 0) this.die(cause);
  },
  die(cause) {
    const P = this.player;
    P.health = 0; P.alive = false; P.eatT = 0;
    const la = P.lastAttacker, byPlayer = Net.active && Net.pvp && la && performance.now() - la.t < 10000;
    if (Net.active && Net.pvp) {
      this.score.d++;
      const loot = [];
      if (byPlayer) {
        const take = st => { if (st && loot.length < 80) loot.push(st.id, st.n); };
        this.inv.s.forEach(take); take(this.cursor); this.inv.armor.forEach(take);
        this.inv.s.fill(null); this.cursor = null; this.inv.armor.fill(null); this.inv.touch();
      }
      Net.deathEvent(byPlayer ? la.peer : '', byPlayer ? 'player' : cause, loot);
      UI.partyChanged();
      if (byPlayer) { GameAudio.death(); UI.showDeath(`You were defeated by ${la.name}.`); return; }
    }
    // in the realms you keep what you carry (you wake up back home)
    if (!this.dim) for (let i = 0; i < 36; i++) {
      const st = this.inv.s[i]; if (!st) continue;
      Drops.spawn(st.id, st.n, st.d, P.pos[0], P.pos[1] + 1, P.pos[2], [(Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6]);
      this.inv.s[i] = null;
    }
    if (this.cursor && !this.dim) { Drops.spawn(this.cursor.id, this.cursor.n, this.cursor.d, P.pos[0], P.pos[1] + 1, P.pos[2]); this.cursor = null; }
    if (!this.dim) for (let s = 0; s < 4; s++) { const st = this.inv.armor[s]; if (st) { Drops.spawn(st.id, 1, st.d, P.pos[0], P.pos[1] + 1, P.pos[2], [(Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6]); this.inv.armor[s] = null; } }
    this.inv.touch();
    GameAudio.death();
    const msgs = { crawler: 'You were bitten by a Duskcrawler.', fire: 'You stood too close to the campfire.', fall: 'You fell from a high place.', cactus: 'You hugged a cactus.', lava: 'You fell into lava.', magma: 'You stood on magma for too long.', scorch: 'You were burned by a Scorchling.', king: 'The Hollow King struck you down.', gloom: 'You were caught by a Gloomling.', starve: 'You starved.', drown: 'You drowned.', void: 'You fell out of the world.' };
    UI.showDeath(msgs[cause] || 'You perished.');
  },
  respawn() {
    const P = this.player;
    const sp = P.spawn;
    Object.assign(P, newPlayer(sp));
    if (this.dim) { this.travel(0, { pos: sp.slice(), respawn: true }); return; }
    if (this.server && this.server.mode === 'pvp') {
      P.protect = 5;
      if (this.inv.s.every(s => !s)) { this.giveKit(); UI.toast('You got a fresh starter kit.'); }
    }
    UI.enterGame();
  },

  /* ---------- per-frame update ---------- */
  update(dt) {
    const P = this.player, w = this.world;
    // time of day
    const prevT = this.time;
    this.time += dt / DAY_LEN;
    if (this.dim) { Atmos.rain = Atmos.rainTarget = 0; this.sky = realmSky(this.dim); } else this.sky = skyState(this.time % 1, Atmos.rain, Atmos.flash);
    const newDay = Math.floor(this.time + 0.0) + 1;
    if (newDay > this.day) { this.day = newDay; UI.banner(`Day ${this.day}`, 'The sun rises over the wilds.'); GameAudio.chime(); }
    if ((this.time % 1) > 0.52 && this.lastNightDay !== this.day) {
      this.lastNightDay = this.day;
      UI.banner('Night falls', Settings.difficulty ? 'Gloomlings stir in the dark. Light torches or take shelter.' : 'The stars come out.');
    }
    if (P.alive) this.updatePlayer(dt);
    Atmos.update(dt, this);
    this.updateFurnaces(dt); this.checkOpenChest();
    Mobs.update(w, dt, this);
    Drops.update(w, dt, P.alive ? P : null, d => {
      const before = d.n;
      const left = this.inv.add(d.id, d.n, d.dur);
      if (left < before) {
        GameAudio.pop();
        UI.pickupNote(d.id, before - left);
      }
      return left;
    });
    Particles.update(w, dt);
    // ambient torch particles
    if (Math.random() < dt * 8) {
      const cx = Math.floor(P.pos[0]) >> 4, cz = Math.floor(P.pos[2]) >> 4;
      const c = w.getChunk(cx + ((Math.random() * 3) | 0) - 1, cz + ((Math.random() * 3) | 0) - 1);
      if (c && c.emitters.size) {
        const arr = Array.from(c.emitters); const e = arr[(Math.random() * arr.length) | 0];
        const id = c.data[e];
        const ex = c.cx * 16 + (e & 15), ez = c.cz * 16 + ((e >> 4) & 15), ey = e >> 8;
        if (id === B.CAMPFIRE) {
          Particles.burst(ex + 0.5, ey + 0.9, ez + 0.5, TEX.smoke, 1, { full: true, size: 0.12, grav: -1.1, speed: 0.25, up: 0.6, life: 2.2, spread: 0.25, grow: 0.22, drag: 0.4 });
          if (Math.random() < 0.6) Particles.burst(ex + 0.5, ey + 0.5, ez + 0.5, TEX.spark, 1, { full: true, size: 0.025, grav: -2.5, speed: 0.8, up: 1, life: 0.9, spread: 0.3, emissive: true });
        } else if (isTorch(id)) {
          const p = torchXf(id, ex, ey, ez)([0.5, 14 / 16, 0.5]);
          Particles.burst(p[0], p[1], p[2], Math.random() < 0.6 ? TEX.smoke : TEX.spark, 1, { full: true, size: 0.045, grav: -0.8, speed: 0.15, up: 0.3, life: 0.6, spread: 0.02, emissive: true, grow: 0.04 });
        }
      }
    }
    this.benchT -= dt;
    if (this.benchT <= 0) { this.benchT = 0.4; this.benchNear = this.scanBench(); }
  },
  scanBench() {
    const P = this.player, w = this.world;
    const x0 = Math.floor(P.pos[0]), y0 = Math.floor(P.pos[1]), z0 = Math.floor(P.pos[2]);
    for (let y = -2; y <= 3; y++) for (let z = -4; z <= 4; z++) for (let x = -4; x <= 4; x++) if (w.getBlock(x0 + x, y0 + y, z0 + z) === B.BENCH) return true;
    return false;
  },
  updatePlayer(dt) {
    const P = this.player, w = this.world, K = Input.keys, uiBlock = !!this.ui || this.paused;
    P.invuln -= dt; P.hurtTilt = Math.max(0, P.hurtTilt - dt * 3); P.useCd -= dt; P.attackCd -= dt; P.breakDelay -= dt;
    if (P.protect > 0) P.protect -= dt;
    const safe = this.inSafeZone(P.pos[0], P.pos[2]);
    if (safe !== this.wasSafe) { this.wasSafe = safe; UI.zoneTag(safe); }
    // look via arrow keys (accessibility)
    if (!uiBlock) {
      const ks = 2.2 * dt;
      if (K.ArrowLeft) P.yaw -= ks; if (K.ArrowRight) P.yaw += ks;
      if (K.ArrowUp) P.pitch = clamp(P.pitch + ks, -1.55, 1.55); if (K.ArrowDown) P.pitch = clamp(P.pitch - ks, -1.55, 1.55);
    }
    let fx = 0, fz = 0;
    if (!uiBlock) { if (K.KeyW) fz += 1; if (K.KeyS) fz -= 1; if (K.KeyA) fx -= 1; if (K.KeyD) fx += 1; if (Input.touch) { fx += Input.tx; fz += Input.tz; } }
    const len = Math.hypot(fx, fz); if (len > 1) { fx /= len; fz /= len; }
    const shiftDown = !uiBlock && !!(K.ShiftLeft || K.ShiftRight || K.KeyC);
    if (!this.creative) P.flying = false;
    P.sneak = shiftDown && !P.flying;
    if (!uiBlock && (K.ControlLeft || K.ControlRight || Input.tsprint) && fz > 0 && P.hunger > 6) P.sprint = true;
    if (fz <= 0 || P.sneak || (P.hunger <= 6 && Settings.difficulty > 0) || P.eatT > 0) P.sprint = false;
    let speed = P.flying ? (P.sprint ? 19 : 10.5) : P.sneak ? 1.35 : P.sprint ? 5.8 : 4.3;
    if (P.eatT > 0) speed *= 0.35;
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    const tx = (fx * cy + fz * sy) * speed, tz = (fx * sy - fz * cy) * speed;
    const feet = w.getBlock(Math.floor(P.pos[0]), Math.floor(P.pos[1] + 0.3), Math.floor(P.pos[2]));
    const wasInWater = P.inWater;
    P.inLava = feet === B.LAVA; P.inWater = feet === B.WATER || P.inLava;
    { const lx = Math.floor(P.pos[0]), lz = Math.floor(P.pos[2]); P.onLadder = !P.flying && !P.inWater && (isLadder(feet) || isLadder(w.getBlock(lx, Math.floor(P.pos[1] + 1.2), lz)) || isLadder(w.getBlock(lx, Math.floor(P.pos[1]), lz))); }
    // pushed out if a block (a closing door, someone else's build) ends up inside us
    if (aabbHitsSolid(w, P.pos[0] - P.hw, P.pos[1] + 0.05, P.pos[2] - P.hw, P.pos[0] + P.hw, P.pos[1] + P.h - 0.05, P.pos[2] + P.hw)) {
      let done = false;
      for (const s of [0.15, 0.3, 0.5, 0.7]) {
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = P.pos[0] + ox * s, nz = P.pos[2] + oz * s;
          if (!aabbHitsSolid(w, nx - P.hw, P.pos[1] + 0.05, nz - P.hw, nx + P.hw, P.pos[1] + P.h - 0.05, nz + P.hw)) { P.pos[0] = nx; P.pos[2] = nz; done = true; break; }
        }
        if (done) break;
      }
    }
    const eye = this.eyePos();
    { const hb = w.getBlock(Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2])); P.headInWater = hb === B.WATER; P.headInLava = hb === B.LAVA; }
    this.updateRealm(dt);
    if (P.inWater && !wasInWater && P.vel[1] < -6) { GameAudio.splash(); Particles.burst(P.pos[0], P.pos[1] + 0.5, P.pos[2], TEX.water, 14, { full: false, speed: 3, up: 3 }); }
    const jump = !uiBlock && K.Space;
    if (P.flying) {
      const k = 1 - Math.exp(-7 * dt);
      P.vel[0] = lerp(P.vel[0], tx, k); P.vel[2] = lerp(P.vel[2], tz, k);
      P.vel[1] = lerp(P.vel[1], ((jump ? 1 : 0) - (shiftDown ? 1 : 0)) * 8.5, 1 - Math.exp(-10 * dt));
    } else if (P.inWater) {
      const k = 1 - Math.exp(-5 * dt);
      P.vel[0] = lerp(P.vel[0], tx * 0.55, k); P.vel[2] = lerp(P.vel[2], tz * 0.55, k);
      if (jump) P.vel[1] = Math.min(P.vel[1] + 20 * dt, 3.4);
      else P.vel[1] = Math.max(P.vel[1] - 7 * dt, -2.4);
    } else if (P.onLadder) {
      // climb with forward or jump, hold on while sneaking, otherwise slide down slowly
      const k = 1 - Math.exp(-12 * dt);
      P.vel[0] = lerp(P.vel[0], tx * 0.8, k); P.vel[2] = lerp(P.vel[2], tz * 0.8, k);
      if (jump || (fz > 0 && !uiBlock)) P.vel[1] = 3.4;
      else if (P.sneak) P.vel[1] = 0;
      else P.vel[1] = Math.max(P.vel[1] - 30 * dt, -2.6);
      P.fallDist = 0;
      P.climbAcc = (P.climbAcc || 0) + Math.abs(P.vel[1]) * dt;
      if (P.climbAcc > 1.1) { P.climbAcc = 0; GameAudio.step(B.OAK_PLANKS); }
    } else {
      const acc = P.onGround ? 15 : 3.0;
      const k = 1 - Math.exp(-acc * dt);
      P.vel[0] = lerp(P.vel[0], tx, k); P.vel[2] = lerp(P.vel[2], tz, k);
      P.vel[1] = Math.max(P.vel[1] - 30 * dt, -58);
      if (jump && P.onGround) {
        P.vel[1] = 9.1;
        if (P.sprint) { P.vel[0] += sy * 1.6; P.vel[2] -= cy * 1.6; }
        this.addExh(P.sprint ? 0.2 : 0.05);
      }
    }
    const y0 = P.pos[1], x0 = P.pos[0], z0 = P.pos[2];
    const res = moveEntity(w, P, P.vel[0] * dt, P.vel[1] * dt, P.vel[2] * dt, P.sneak && P.onGround);
    if (res.y) P.vel[1] = 0;
    if (res.x) { P.vel[0] = 0; if (P.inWater && jump) P.vel[1] = 5.5; }
    if (res.z) { P.vel[2] = 0; if (P.inWater && jump) P.vel[1] = 5.5; }
    if (res.x || res.z) P.sprint = P.sprint && !(res.x && res.z);
    if (P.flying && P.onGround && shiftDown) P.flying = false;
    if (this.creative) P.fallDist = 0;
    // fall damage
    if (P.inWater) P.fallDist = 0;
    else if (!P.onGround && P.pos[1] < y0) P.fallDist += y0 - P.pos[1];
    if (P.onGround) {
      if (P.fallDist > 1.4) {
        P.landDip = Math.min(0.28, P.fallDist * 0.035);
        const below = w.getBlock(Math.floor(P.pos[0]), Math.floor(P.pos[1] - 0.2), Math.floor(P.pos[2]));
        if (below && FACE_TEX[below]) Particles.burst(P.pos[0], P.pos[1] + 0.05, P.pos[2], FACE_TEX[below][2], Math.min(14, 3 + P.fallDist * 2) | 0, { size: 0.05, speed: 2, up: 0.8, life: 0.5, spread: 0.6 });
      }
      const landOn = w.getBlock(Math.floor(P.pos[0]), Math.floor(P.pos[1] - 0.2), Math.floor(P.pos[2]));
      if (landOn === B.CLOUD && P.fallDist > 1.4) { if (!P.sneak) P.vel[1] = Math.min(13, 5 + P.fallDist * 1.1); GameAudio.pop && GameAudio.pop(); }
      else if (P.fallDist > 3.4) {
        const dmg = Math.ceil((P.fallDist - 3.2) * (landOn === B.HAY ? 0.2 : 1));
        this.damagePlayer(dmg, 'fall');
        GameAudio.dig(w.getBlock(Math.floor(P.pos[0]), Math.floor(P.pos[1] - 0.5), Math.floor(P.pos[2])), 1.5);
      }
      P.fallDist = 0;
    }
    if (P.pos[1] < -20) {
      if (this.creative) { P.pos[1] = WH + 4; P.vel = [0, 0, 0]; P.flying = true; }
      else this.damagePlayer(100, 'void');
    }
    // steps, bobbing, exhaustion
    const moved = Math.hypot(P.pos[0] - x0, P.pos[2] - z0);
    if (P.onGround) {
      P.stepAcc += moved; P.bobPhase += moved * 1.9;
      if (P.stepAcc > (P.sprint ? 1.9 : 1.6)) {
        P.stepAcc = 0;
        const below = w.getBlock(Math.floor(P.pos[0]), Math.floor(P.pos[1] - 0.2), Math.floor(P.pos[2]));
        if (below && !P.sneak) GameAudio.step(below);
      }
    }
    P.bobAmt = lerp(P.bobAmt, P.onGround && !P.flying && moved > 0.001 ? Math.min(1, moved / dt / 4.3) : 0, 1 - Math.exp(-10 * dt));
    this.addExh(moved * (P.sprint ? 0.12 : P.inWater ? 0.03 : 0.02) + dt * 0.01);
    P.fovBoost = lerp(P.fovBoost, P.sprint ? 1 : 0, 1 - Math.exp(-8 * dt));

    // ---- interaction ----
    const e = this.eyePos(), d = this.aimDir();
    const hit = raycast(w, e, d, 5);
    const mh = Mobs.hitTest(e, d, 3.6), ph = Net.pvp ? Net.hitTestPlayers(e, d, 3.6) : null;
    const near = x => x && (!hit || x.t < hit.t || isPlant(hit.id));
    this.playerTarget = near(ph) && (!mh || ph.t < mh.t) ? ph.r : null;
    this.mobTarget = !this.playerTarget && near(mh) ? mh.mob : null;
    this.target = (this.mobTarget || this.playerTarget) ? null : hit;
    // a finger tap: hit the creature it touched, otherwise use or place there (released on the next frame)
    if (Input.tap === 1) { if (this.mobTarget || this.playerTarget) Input.mouseL = Input.pressL = true; else Input.mouseR = Input.pressR = true; Input.tap = 2; }
    else if (Input.tap === 2) { Input.mouseL = Input.mouseR = false; Input.tap = 0; Input.aim = null; }
    P.swingT = Math.min(1, P.swingT + dt * 3.2);
    const held = this.inv.held, hdef = held ? ITEMS[held.id] : null;
    if (this.inv.sel !== P.lastHeld) { P.lastHeld = this.inv.sel; P.eatT = 0; P.equipT = 0; }
    P.equipT = Math.min(1, (P.equipT || 0) + dt * 5);
    if (!uiBlock && Input.mouseL) {
      if (Input.pressL) { P.swingT = 0; GameAudio.swing(); Net.swingCount++; }
      if (this.playerTarget && Input.pressL && P.attackCd <= 0) {
        const r = this.playerTarget;
        let dmg = hdef && hdef.tool ? hdef.tool.dmg : 1;
        const crit = !P.onGround && P.vel[1] < 0; if (crit) dmg = Math.ceil(dmg * 1.5);
        P.attackCd = 0.45; P.breakProg = 0; Net.swingCount++;
        if (this.inSafeZone(P.pos[0], P.pos[2]) || this.inSafeZone(r.pos[0], r.pos[2]) || P.protect > 0) this.safeNote('fight');
        else {
          const kx = r.pos[0] - P.pos[0], kz = r.pos[2] - P.pos[2], kl = Math.hypot(kx, kz) || 1;
          Net.pvpHit(r.peer, dmg, kx / kl, kz / kl);
          r.hurtT = 0.3; GameAudio.mobHurt();
          Particles.burst(r.pos[0], r.pos[1] + 1.3, r.pos[2], TEX.spark, crit ? 10 : 4, { full: true, size: 0.05, emissive: true, speed: 3 });
          if (hdef && hdef.tool) this.useTool(hdef.tool.type === 'sword' ? 1 : 2);
          this.addExh(0.1);
        }
      } else if (this.mobTarget && Input.pressL && P.attackCd <= 0) {
        const m = this.mobTarget;
        let dmg = hdef && hdef.tool ? hdef.tool.dmg : 1;
        if (!P.onGround && P.vel[1] < 0) { dmg = Math.ceil(dmg * 1.5); Particles.burst(m.pos[0], m.pos[1] + 1.4, m.pos[2], TEX.spark, 8, { full: true, size: 0.05, emissive: true, speed: 3 }); }
        m.health -= dmg; m.hurt = 0.35; m.byPlayer = true; m.myHit = performance.now();
        Net.swingCount++;
        if (Net.active && !Net.isHost) {
          const kx0 = m.pos[0] - P.pos[0], kz0 = m.pos[2] - P.pos[2], kl0 = Math.hypot(kx0, kz0) || 1;
          Net.attack(m.id, dmg, kx0 / kl0, kz0 / kl0);
          if (m.health <= 0 && !m.dropped) { m.dropped = true; if (Math.random() < 0.65) Drops.spawn(I.COAL, 1, undefined, m.pos[0], m.pos[1] + 1, m.pos[2]); }
        }
        const kx = m.pos[0] - P.pos[0], kz = m.pos[2] - P.pos[2], kl = Math.hypot(kx, kz) || 1;
        const kbf = m.type === 'king' ? 0.12 : 1;
        m.vel[0] += kx / kl * 7 * kbf; m.vel[2] += kz / kl * 7 * kbf; if (kbf === 1) m.vel[1] = 5;
        Mobs.onHit(m, P.pos); if (!m.animal) GameAudio.mobHurt(); P.attackCd = 0.4;
        if (hdef && hdef.tool) this.useTool(hdef.tool.type === 'sword' ? 1 : 2);
        this.addExh(0.1);
        P.breakProg = 0;
      } else if (this.target && P.breakDelay <= 0 && this.inSafeZone(this.target.x + 0.5, this.target.z + 0.5)) {
        if (Input.pressL) this.safeNote('build');
      } else if (this.target && P.breakDelay <= 0) {
        const t = this.target, key = t.x + ',' + t.y + ',' + t.z;
        if (P.breakKey !== key) { P.breakKey = key; P.breakProg = 0; P.digSnd = 0; }
        const bt = this.breakTime(t.id);
        if (bt >= 0) {
          P.breakProg += bt === 0 ? 1 : dt / bt;
          P.digSnd -= dt;
          if (P.swingT > 0.6) P.swingT = 0;
          if (P.digSnd <= 0 && bt > 0) {
            P.digSnd = 0.24; GameAudio.dig(t.id, 0.7);
            const fl = FACE_TEX[t.id][t.n[1] === 1 ? 2 : 0];
            Particles.burst(t.x + 0.5 + t.n[0] * 0.55, t.y + 0.5 + t.n[1] * 0.55, t.z + 0.5 + t.n[2] * 0.55, fl, 3, { spread: 0.6, speed: 1.5, up: 0.5 });
          }
          if (P.breakProg >= 1) { this.breakBlock(t.x, t.y, t.z); P.breakProg = 0; P.breakKey = null; P.breakDelay = this.creative ? 0.2 : 0.16; }
        }
      }
    } else { P.breakProg = 0; P.breakKey = null; }
    // right click: use / eat / place
    if (!uiBlock && Input.mouseR) {
      const tgt = this.target;
      if (tgt && tgt.id === B.BENCH && !P.sneak && Input.pressR) { UI.openInventory(); Input.mouseR = false; }
      else if (tgt && (tgt.id === B.FURNACE || tgt.id === B.FURNACE_LIT) && !P.sneak && Input.pressR) { UI.openInventory(this.furnaceAt(tgt.x, tgt.y, tgt.z, true)); Input.mouseR = false; }
      else if (tgt && isGate(tgt.id) && !P.sneak && Input.pressR) { Input.mouseR = false; P.swingT = 0; this.useGate(tgt); return; }
      else if (tgt && isDoor(tgt.id) && !P.sneak && Input.pressR) { this.toggleDoor(tgt.x, tgt.y, tgt.z); Input.mouseR = false; P.swingT = 0; }
      else if (tgt && isChest(tgt.id) && !P.sneak && Input.pressR) { UI.openInventory(null, this.world.chestAt(tgt.x, tgt.y, tgt.z, true)); Input.mouseR = false; P.swingT = 0; }
      else if (tgt && tgt.id === B.BED && !P.sneak && Input.pressR) { this.useBed(tgt.x, tgt.y, tgt.z); Input.mouseR = false; }
      else if (hdef && hdef.armor && Input.pressR) {
        const sl = hdef.armor.slot, old = this.inv.armor[sl];
        this.inv.armor[sl] = held; this.inv.s[this.inv.sel] = old; this.inv.touch(); GameAudio.place(B.COBBLE); P.swingT = 0;
        UI.toast(`Equipped ${hdef.name}`);
      }
      else if (tgt && tgt.id === B.CAMPFIRE && held && held.id === I.RAW_HAUNCH && Input.pressR) {
        if (Atmos.cook(tgt.x, tgt.y, tgt.z)) { held.n--; if (!held.n) this.inv.s[this.inv.sel] = null; this.inv.touch(); P.swingT = 0; }
      }
      else if (hdef && hdef.food && (P.hunger < 20 || Settings.difficulty === 0)) {
        P.eatT += dt; P.eatSnd -= dt;
        if (P.eatSnd <= 0) {
          P.eatSnd = 0.22; GameAudio.eat();
          Particles.burst(e[0] + d[0] * 0.5, e[1] - 0.25, e[2] + d[2] * 0.5, TEX[hdef.icon], 3, { speed: 1.2, size: 0.05, up: 0.5 });
        }
        if (P.eatT >= 1.4) {
          P.eatT = 0;
          P.hunger = Math.min(20, P.hunger + hdef.food); P.sat = Math.min(P.hunger, P.sat + hdef.sat);
          held.n--; if (!held.n) this.inv.s[this.inv.sel] = null; this.inv.touch();
          GameAudio.burp();
        }
      } else if (tgt && P.useCd <= 0 && hdef && hdef.block) {
        if (this.tryPlace(tgt)) { P.swingT = 0; P.useCd = 0.22; }
        else P.useCd = 0.22;
      }
    } else { P.eatT = 0; P.useCd = 0; }
    Input.pressL = Input.pressR = false;

    // ---- survival ----
    // cactus pricks anyone brushing against it
    if (!this.creative) {
      const e = 0.06, hw = P.hw + e; let prick = false;
      for (let yy = Math.floor(P.pos[1] - e); yy <= Math.floor(P.pos[1] + P.h) && !prick; yy++)
        for (let zz = Math.floor(P.pos[2] - hw); zz <= Math.floor(P.pos[2] + hw) && !prick; zz++)
          for (let xx = Math.floor(P.pos[0] - hw); xx <= Math.floor(P.pos[0] + hw); xx++) if (w.getBlock(xx, yy, zz) === B.CACTUS) { prick = true; break; }
      P.cactusT = prick ? (P.cactusT || 0) - dt : 0;
      if (prick && P.cactusT <= 0) { P.cactusT = 0.5; this.damagePlayer(1, 'cactus'); }
    }
    if (!this.creative && w.getBlock(Math.floor(P.pos[0]), Math.floor(P.pos[1] + 0.1), Math.floor(P.pos[2])) === B.CAMPFIRE) {
      P.fireT = (P.fireT || 0) + dt;
      if (P.fireT > 0.8) { P.fireT = 0; this.damagePlayer(1, 'fire'); }
    } else P.fireT = 0.6;
    if (this.creative) { P.health = 20; P.hunger = 20; P.air = 15; P.drownT = 0; return; }
    const diff = Settings.difficulty;
    if (diff === 0) { P.hunger = 20; if (P.health < 20) { P.regenT += dt; if (P.regenT > 1) { P.regenT = 0; P.health++; } } }
    else {
      while (P.exh >= 4) { P.exh -= 4; if (P.sat > 0) P.sat = Math.max(0, P.sat - 1); else P.hunger = Math.max(0, P.hunger - 1); }
      if (P.hunger >= 18 && P.health < 20) {
        P.regenT += dt;
        if (P.regenT >= 3.5) { P.regenT = 0; P.health = Math.min(20, P.health + 1); P.exh += 3; }
      } else P.regenT = 0;
      if (P.hunger <= 0) {
        P.starveT += dt;
        if (P.starveT >= 4) { P.starveT = 0; const floor = diff === 1 ? 10 : diff === 2 ? 1 : 0; if (P.health > floor) this.damagePlayer(1, 'starve'); }
      } else P.starveT = 0;
    }
    if (P.headInWater) {
      P.air -= dt;
      if (P.air <= 0) { P.drownT += dt; if (P.drownT >= 1) { P.drownT = 0; this.damagePlayer(2, 'drown'); } }
    } else { P.air = Math.min(15, P.air + dt * 6); P.drownT = 0; }
  },

  /* ---------- rendering ---------- */
  render(world, cam, sky, opts) {
    const gl = R.gl, cv = R.canvas;
    const post = R.postOK && GFX.bloom;
    if (post) { ensurePost(cv.width, cv.height); gl.bindFramebuffer(gl.FRAMEBUFFER, R.post.scene.fb); }
    if (post && !R.postOK) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return this.render(world, cam, sky, opts); }
    gl.viewport(0, 0, cv.width, cv.height);
    const fogCol = opts.underwater ? mix3([0.05, 0.16, 0.36], [0.02, 0.05, 0.12], sky.night) : sky.fog;
    gl.clearColor(fogCol[0], fogCol[1], fogCol[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const aspect = cv.width / cv.height;
    const radius = opts.radius;
    const far = Math.max(radius * 16 + 48, 220);
    M4.persp(R.proj, cam.fov * Math.PI / 180, aspect, 0.06, far + 400);
    M4.lookDir(R.view, cam.eye, cam.dir);
    if (cam.roll) { const rm = M4.create(); M4.rotZ(rm, cam.roll); M4.mul(R.view, rm, R.view); }
    M4.mul(R.vp, R.proj, R.view);
    // sky
    const vRot = new Float32Array(R.view); vRot[12] = vRot[13] = vRot[14] = 0;
    const pv = M4.mul(M4.create(), R.proj, vRot);
    M4.invert(R.invVPsky, pv);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    if (!opts.underwater) {
      gl.useProgram(R.progSky);
      gl.uniformMatrix4fv(R.uSky.uInv, false, R.invVPsky);
      gl.uniform3fv(R.uSky.uSun, sky.sun); gl.uniform3fv(R.uSky.uZen, sky.zen); gl.uniform3fv(R.uSky.uHor, sky.hor);
      gl.uniform3fv(R.uSky.uGlow, sky.glow); gl.uniform1f(R.uSky.uNight, sky.night); gl.uniform1f(R.uSky.uTime, opts.time);
      gl.uniform1f(R.uSky.uSunset, sky.sunset); gl.uniform1f(R.uSky.uRain, sky.rain || 0);
      gl.bindVertexArray(R.skyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    // main program
    gl.useProgram(R.progMain);
    const U = R.uMain;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, R.tex); gl.uniform1i(U.uTex, 0);
    gl.uniformMatrix4fv(U.uVP, false, R.vp);
    gl.uniform3fv(U.uCam, cam.eye); gl.uniform3fv(U.uCamF, cam.eye); gl.uniform1f(U.uTime, opts.time); gl.uniform1f(U.uFlick, Atmos.flick);
    gl.uniform1f(U.uDay, sky.dayLight); gl.uniform3fv(U.uSunCol, sky.sunCol); gl.uniform3fv(U.uFog, fogCol);
    gl.uniform1i(U.uTexA, 3); gl.uniform1f(U.uAniso, R.anisoOn ? 1 : 0);
    gl.uniform3fv(U.uBiome, TINTS);
    gl.uniform1f(U.uWave, GFX.wave ? 1 : 0); gl.uniform1f(U.uFastLeaves, GFX.fastLeaves ? 1 : 0); gl.uniform1f(U.uFancyWater, GFX.fancyWater ? 1 : 0);
    const fogFar = opts.underwater ? 22 : (radius * 16 - 2) * (1 - 0.35 * (sky.rain || 0)) * (sky.fogMul || 1), fogNear = opts.underwater ? 1 : fogFar * (sky.fogMul ? 0.3 : 0.72);
    gl.uniform3fv(U.uAmb, sky.amb || [0.035, 0.035, 0.05]);
    gl.uniform2f(U.uFogR, fogNear, fogFar);
    gl.uniform1f(U.uAlpha, 1); gl.uniform1f(U.uWater, 0); gl.uniform4f(U.uTint, 0, 0, 0, 0); gl.uniform1f(U.uCutoff, 0.5);
    const planes = frustumPlanes(R.vp);
    const vis = [];
    const ccx = Math.floor(cam.eye[0]) >> 4, ccz = Math.floor(cam.eye[2]) >> 4;
    for (const c of world.chunks.values()) {
      if (!c.mesh) continue;
      const dx = c.cx - ccx, dz = c.cz - ccz;
      if (dx * dx + dz * dz > (radius + 1) * (radius + 1)) continue;
      const x0 = c.cx * 16, z0 = c.cz * 16;
      if (!boxVisible(planes, x0, 0, z0, x0 + 16, c.maxY + 2, z0 + 16)) continue;
      vis.push([c, dx * dx + dz * dz]);
    }
    vis.sort((a, b) => a[1] - b[1]);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    let drawn = 0, quads = 0;
    for (const [c] of vis) { const p = c.mesh.opaque; if (p) { gl.bindVertexArray(p.vao); gl.drawElements(gl.TRIANGLES, p.quads * 6, gl.UNSIGNED_INT, 0); drawn++; quads += p.quads; } }
    gl.disable(gl.CULL_FACE);
    for (const [c] of vis) { const p = c.mesh.cutout; if (p) { gl.bindVertexArray(p.vao); gl.drawElements(gl.TRIANGLES, p.quads * 6, gl.UNSIGNED_INT, 0); quads += p.quads; } }
    this.drawStats = { drawn, quads };
    // entities
    if (opts.entities) {
      Drops.render(world, opts.time); flushDyn();
      Mobs.render(world, opts.time);
      if (opts.models) opts.models(world);
    }
    // block selection + cracks
    if (opts.target) {
      const t = opts.target;
      let bx0 = t.x, by0 = t.y, bz0 = t.z, bx1 = t.x + 1, by1 = t.y + 1, bz1 = t.z + 1;
      if (isPlant(t.id)) { bx0 += 0.12; bz0 += 0.12; bx1 -= 0.12; bz1 -= 0.12; by1 -= 0.1; }
      if (isTorch(t.id)) { bx0 += 0.3; bz0 += 0.3; bx1 -= 0.3; bz1 -= 0.3; by1 -= 0.25; }
      if (opts.breakProg > 0 && !isPlant(t.id)) {
        const stage = Math.min(9, Math.floor(opts.breakProg * 10));
        const e = 0.003;
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -1);
        emitBox(R.dyn, bx0 - e, by0 - e, bz0 - e, bx1 + e, by1 + e, bz1 + e, TEX['crack' + stage], [0, 0, 1, 1], 1, 1, 1, 0, null);
        gl.uniform4f(U.uTint, 0, 0, 0, 0);
        flushDyn();
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }
      gl.useProgram(R.progLine);
      gl.uniformMatrix4fv(R.uLine.uVP, false, R.vp);
      gl.uniform4f(R.uLine.uCol, 0.05, 0.04, 0.03, 0.75);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(R.lineVAO); gl.bindBuffer(gl.ARRAY_BUFFER, R.lineBuf);
      const e = 0.004;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, boxLines(bx0 - e, by0 - e, bz0 - e, bx1 + e, by1 + e, bz1 + e));
      gl.drawArrays(gl.LINES, 0, 24);
      gl.disable(gl.BLEND);
      gl.useProgram(R.progMain);
    }
    // particles (alpha tested)
    if (opts.entities) {
      const r = [R.view[0], R.view[4], R.view[8]], u = [R.view[1], R.view[5], R.view[9]];
      if (!opts.underwater) Atmos.renderRain(cam.dir);
      // soft particles: blended, no depth writes
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.uniform1f(U.uCutoff, 0.02);
      Particles.render(world, r, u); flushDyn();
      gl.depthMask(true); gl.disable(gl.BLEND); gl.uniform1f(U.uCutoff, 0.5);
    }
    // clouds
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (Settings.clouds && R.clouds && !opts.underwater && !sky.noClouds) {
      gl.uniform1f(U.uAlpha, 0.8); gl.uniform1f(U.uCutoff, 0);
      gl.uniform2f(U.uFogR, fogFar * 1.1, fogFar * 3.6);
      const tile = CLOUD_CELLS * CLOUD_SIZE, drift = opts.time * 1.1;
      const bx = Math.floor((cam.eye[0] - drift) / tile), bz = Math.floor(cam.eye[2] / tile);
      gl.enable(gl.CULL_FACE);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const ox = (bx + i) * tile + drift, oz = (bz + j) * tile;
        const m = M4.create(); M4.translate(m, ox, CLOUD_Y, oz);
        const vp = M4.mul(M4.create(), R.vp, m);
        gl.uniformMatrix4fv(U.uVP, false, vp);
        gl.uniform3f(U.uCam, cam.eye[0] - ox, cam.eye[1] - CLOUD_Y, cam.eye[2] - oz);
        gl.bindVertexArray(R.clouds.vao); gl.drawElements(gl.TRIANGLES, R.clouds.quads * 6, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.CULL_FACE);
      gl.uniformMatrix4fv(U.uVP, false, R.vp); gl.uniform3fv(U.uCam, cam.eye);
      gl.uniform2f(U.uFogR, fogNear, fogFar);
    }
    // water
    gl.depthMask(false);
    gl.uniform1f(U.uWater, 1); gl.uniform1f(U.uAlpha, 0.74); gl.uniform1f(U.uCutoff, 0);
    for (let i = vis.length - 1; i >= 0; i--) { const p = vis[i][0].mesh.water; if (p) { gl.bindVertexArray(p.vao); gl.drawElements(gl.TRIANGLES, p.quads * 6, gl.UNSIGNED_INT, 0); } }
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.uniform1f(U.uWater, 0); gl.uniform1f(U.uAlpha, 1); gl.uniform1f(U.uCutoff, 0.5);
    // sun / moon rays (Heavenly) are gathered from the open sky before the hand is drawn
    let rayTint = null;
    if (post) {
      let str = 0, uv = [0.5, 0.5];
      if (GFX.rays && !opts.underwater) {
        const up = sky.sun[1] > -0.04, d = up ? sky.sun : [-sky.sun[0], -sky.sun[1], -sky.sun[2]];
        const c = [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) c[i] = pv[i] * d[0] + pv[4 + i] * d[1] + pv[8 + i] * d[2] + pv[12 + i];
        if (c[3] > 0.01) {
          uv = [c[0] / c[3] * 0.5 + 0.5, c[1] / c[3] * 0.5 + 0.5];
          const off = Math.max(Math.abs(uv[0] - 0.5), Math.abs(uv[1] - 0.5));
          str = (1 - smoothstep(0.55, 1.25, off)) * (1 - (sky.rain || 0) * 0.85) * (up ? 0.42 * smoothstep(-0.04, 0.12, sky.sun[1]) + 0.14 * sky.sunset : 0.22 * smoothstep(0.02, 0.2, -sky.sun[1]));
        }
        rayTint = up ? [1, 0.88 - sky.sunset * 0.2, 0.7 - sky.sunset * 0.25] : [0.6, 0.72, 1];
      }
      postRays(uv, str);
      gl.useProgram(R.progMain);
    }
    // held item / hand
    if (opts.hand) this.renderHand(world, cam, opts);
    if (post) postComposite(GFX.rays, rayTint);
    gl.bindVertexArray(null);
  },
  renderHand(world, cam, opts) {
    const gl = R.gl, U = R.uMain, P = this.player, cv = R.canvas;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const proj = M4.persp(M4.create(), 70 * Math.PI / 180, cv.width / cv.height, 0.02, 10);
    gl.uniformMatrix4fv(U.uVP, false, proj);
    gl.uniform3f(U.uCam, 0, 0, 0);
    gl.uniform2f(U.uFogR, 100, 200);
    const [sky, blk] = lightAt(world, cam.eye[0], cam.eye[1], cam.eye[2]);
    const held = this.inv.held;
    const sw = Math.sin(Math.min(1, P.swingT) * Math.PI);
    const bob = Settings.bobbing ? P.bobAmt : 0;
    const bx = Math.sin(P.bobPhase) * 0.035 * bob, byy = -Math.abs(Math.cos(P.bobPhase)) * 0.035 * bob;
    const eat = P.eatT > 0 ? Math.min(1, P.eatT * 4) : 0;
    const eq = 1 - (P.equipT === undefined ? 1 : P.equipT);
    const m = M4.create();
    M4.translate(m, 0.56 + bx - eat * 0.42 - sw * 0.12, -0.56 + byy - eq * 0.5 + eat * (0.2 + Math.sin(P.eatT * 22) * 0.03) - sw * 0.1, -0.86 + sw * -0.18);
    M4.rotX(m, -sw * 0.9);
    M4.rotY(m, sw * 0.35);
    if (!held) {
      // arm
      M4.rotX(m, 0.6); M4.rotY(m, -0.25); M4.rotZ(m, 0.15);
      emitBox(R.dyn, -0.13, -0.13, -0.2, 0.13, 0.13, 0.75, TEX.arm, [[0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 0.38], [0, 0.4, 1, 1], [0, 0, 1, 1], [0, 0.4, 1, 1]], 1, sky, blk, 0, p => [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]);
    } else {
      const t = itemTemplate(held.id);
      if (t.kind === 'cube') {
        M4.translate(m, 0.0, 0.2, 0.02);
        M4.rotY(m, 0.78); M4.rotX(m, 0.05);
        M4.scale(m, 0.33, 0.33, 0.33);
      } else {
        M4.translate(m, -0.04, 0.16, 0.02);
        M4.rotY(m, 0.55); M4.rotZ(m, 0.12);
        M4.scale(m, -0.62, 0.62, 0.62);
      }
      if (held.id === B.TORCH) M4.scale(m, 0.8, 0.8, 0.8);
      const emis = held.id === B.TORCH ? 8 : 0;
      pushTemplate(t, m, sky, Math.max(blk, emis ? 0.9 : 0), 0);
    }
    flushDyn();
  },

  /* ---------- main frame ---------- */
  frame(dt, now) {
    const t = now / 1000;
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.frames / this.fpsT); this.frames = 0; this.fpsT = 0; }
    GameAudio.updateMusic(dt, { night: this.sky ? this.sky.night > 0.5 : false, underground: this.state === 'play' && Atmos.underground });
    if (this.state === 'menu') GameAudio.ambientTick(dt, { menu: true, rain: 0, outside: 1, height: 74, day: 1, night: 0 });
    // automatic resolution: trade sharpness for smoothness on slower machines
    this.resT = (this.resT || 0) + dt;
    if (this.resT > 2 && this.state === 'play' && !this.paused) {
      this.resT = 0;
      const old = R.dynScale || 1;
      if (!Settings.autoRes) R.dynScale = 1;
      else if (this.fps && this.fps < 38) R.dynScale = Math.max(0.5, old - 0.1);
      else if (this.fps > 56) R.dynScale = Math.min(1, old + 0.05);
      if (R.dynScale !== old) resize();
    }
    if (this.state === 'menu' && this.menuWorld) {
      const mc = this.menuCam, w = this.menuWorld;
      mc.t += dt;
      mc.x -= dt * 2.4;
      const ahead = w.column(Math.floor(mc.x - 14), Math.floor(mc.z));
      const here = w.column(Math.floor(mc.x), Math.floor(mc.z));
      const ty = Math.max(ahead.h, here.h, SEA) + 11;
      mc.y = lerp(mc.y, ty, 1 - Math.exp(-0.6 * dt));
      const yaw = -Math.PI / 2 + Math.sin(mc.t * 0.05) * 0.35, pitch = -0.1 + Math.sin(mc.t * 0.07) * 0.03;
      const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
      const r = Math.min(Settings.renderDist, 7);
      this.stream(w, mc.x, mc.z, r, 7);
      const sky = skyState(0.484);
      this.sky = sky;
      const eye = [mc.x, mc.y, mc.z];
      let models = null;
      if (UI.cur === 'profile' && UI.draftSkin) {
        const rt = [Math.cos(yaw), 0, Math.sin(yaw)];
        const aspect = R.canvas.width / R.canvas.height, side = 3.6 * Math.tan(36 * Math.PI / 180) * aspect * (aspect > 1.2 ? 0.55 : 0.2);
        const px = eye[0] + dir[0] * 3.6 + rt[0] * side, pz = eye[2] + dir[2] * 3.6 + rt[2] * side, py = eye[1] - 1.0;
        const faceYaw = Math.atan2(-dir[0], dir[2]) + Math.sin(t * 0.6) * 0.7 + (UI.previewSpin || 0);
        models = () => { drawPlayerModel({ x: px, y: py, z: pz, yaw: faceYaw, pitch: 0, walk: t * 4, walkAmt: 0.35, skin: UI.draftSkin, sky: 1, blk: 0.25 }); flushDyn(); };
      }
      this.render(w, { eye, dir, fov: 72 }, sky, { radius: r, time: t, entities: !!models, models, hand: false });
      return;
    }
    if (this.pendingTravel && this.state === 'play') { const pt = this.pendingTravel; this.pendingTravel = null; this.travel(pt[0], pt[1]); }
    if (this.state === 'loading') {
      const pending = this.stream(this.world, this.player.pos[0], this.player.pos[2], this.loadR, 40);
      const p = this.loadingProgress();
      UI.loadingProgress(p);
      if (p >= 1) this.finishLoading();
      return;
    }
    if (this.state === 'play') {
      const P = this.player, w = this.world;
      if (!this.paused || Net.active) this.update(dt);
      Net.update(dt);
      if (this.worldId && !this.paused) { this.saveT -= dt; if (this.saveT <= 0) { this.saveT = 60; this.saveWorld(); } }
      this.stream(w, P.pos[0], P.pos[2], Settings.renderDist, this.paused ? 12 : 5);
      const eye = this.eyePos();
      P.landDip = lerp(P.landDip || 0, 0, 1 - Math.exp(-7 * dt)); eye[1] -= P.landDip;
      const bob = Settings.bobbing ? P.bobAmt : 0;
      eye[1] += -Math.abs(Math.cos(P.bobPhase)) * 0.06 * bob;
      const side = Math.sin(P.bobPhase) * 0.03 * bob;
      eye[0] += Math.cos(P.yaw) * side; eye[2] += Math.sin(P.yaw) * side;
      let dir = this.lookDir(), camEye = eye;
      if (this.view) {
        // third person: pull the camera back (or in front) without passing through blocks
        const back = this.view === 1 ? [-dir[0], -dir[1], -dir[2]] : dir;
        let dist = 4;
        for (let s = 0.2; s <= 4; s += 0.1) { const q = [eye[0] + back[0] * s, eye[1] + back[1] * s, eye[2] + back[2] * s]; if (SOLID[w.getBlock(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]))]) { dist = Math.max(0.3, s - 0.3); break; } }
        camEye = [eye[0] + back[0] * dist, eye[1] + back[1] * dist, eye[2] + back[2] * dist];
        if (this.view === 2) dir = [-dir[0], -dir[1], -dir[2]];
      }
      this.camEye = camEye;
      const cam = { eye: camEye, dir, fov: Settings.fov + P.fovBoost * 10, roll: P.hurtTilt * 0.08 * Math.sin(P.hurtTilt * 9) };
      const sky = this.sky || skyState(this.time % 1);
      const models = world => {
        if (Net.active) Net.render(world);
        if (this.view && P.alive) {
          const [sk, bk] = lightAt(world, P.pos[0], P.pos[1] + 1.5, P.pos[2]);
          drawPlayerModel({ x: P.pos[0], y: P.pos[1], z: P.pos[2], yaw: P.yaw, pitch: P.pitch, walk: P.bobPhase * 1.6, walkAmt: P.bobAmt, swing: P.swingT < 1 ? Math.sin(P.swingT * Math.PI) : 0,
            sneak: P.sneak, skin: Profile.data ? Profile.data.skin : Skins.presets[0].skin, held: this.inv.held ? this.inv.held.id : 0, armor: this.inv.armorMats(), sky: sk, blk: bk });
          flushDyn();
        }
      };
      this.render(w, cam, sky, {
        radius: Settings.renderDist, time: t, entities: true, hand: P.alive && !this.hideHud && !this.view, models,
        target: this.target, breakProg: P.breakProg, underwater: P.headInWater,
      });
      if (Net.active) Net.updateTags(cam);
      UI.updateHUD(dt);
    }
  },
};
