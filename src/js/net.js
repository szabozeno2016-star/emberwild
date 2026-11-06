/* =====================================================================
   Multiplayer: party codes over the platform `room` (presence only, so
   every invited viewer can play) + a `parties/<code>` db doc written by
   the host so late joiners receive the world's edits.
   ===================================================================== */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = v => Math.round(v * 100) / 100;

const Net = {
  active: false, isHost: false, code: null, room: null, me: null, unsub: [],
  remotes: new Map(), seq: 0, ring: [], atkSeq: 0, atkRing: [], hitSeq: 0, hitRing: [], chatSeq: 0, chatMsg: null,
  sent: {}, sendT: 0, persist: false, docT: 0, docVer: -1, docBusy: false, swingCount: 0, hostLeft: false,
  // servers
  server: null, pvp: false, myJ: 0, saver: false, saveT: 0, timeSaveT: 0, hbT: 0, pvSeq: 0, pvRing: [], dkSeq: 0, dk: null,

  get available() { return !!Cloud.room; },
  makeCode() { let s = ''; for (let i = 0; i < 6; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]; return s; },
  norm(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); },
  pretty(code) { return code ? code.slice(0, 3) + '-' + code.slice(3) : ''; },
  roomName(code) { return 'ew-party-' + code.toLowerCase(); },

  /* ---------- hosting ---------- */
  async host() {
    if (!Cloud.room) throw new Error('Multiplayer is not available in this view.');
    const code = this.makeCode();
    const room = await Cloud.room.join(this.roomName(code));
    this.setup(room, code, true);
    this.persist = false;
    if (Cloud.db) {
      try { await Cloud.db.doc('parties/' + code).set(this.partyDoc()); this.persist = true; this.docVer = Game.world.editVer; }
      catch (e) { this.persist = false; }
    }
    this.chatSys(`Party open — code ${this.pretty(code)}`);
    return code;
  },
  partyDoc() {
    const e = Game.world.encodeEdits();
    return { v: 1, code: this.code, seed: Game.world.seed, seedLabel: String(Game.seedLabel || ''), name: Game.worldName, mode: Game.mode,
      diff: Settings.difficulty, time: Game.time, edits: e.length < 240000 ? e : '', updated: Date.now() };
  },
  /* ---------- joining ---------- */
  async join(code, status) {
    if (!Cloud.room) throw new Error('Multiplayer is not available in this view.');
    code = this.norm(code);
    if (code.length !== 6) throw new Error('Party codes have 6 letters and numbers.');
    status && status('Connecting…');
    const room = await Cloud.room.join(this.roomName(code));
    status && status('Looking for the host…');
    let host = null; const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      host = room.peers().find(p => !p.isMe && p.presence && p.presence.role === 'host' && p.presence.pm);
      if (host) break;
      await sleep(300);
    }
    if (!host) { try { await room.leave(); } catch (e) { } throw new Error('No party found with that code. Check the code and make sure the host is still in their world.'); }
    let edits = '';
    if (Cloud.db) {
      status && status('Downloading the world…');
      try { const s = await Cloud.db.doc('parties/' + code).get(); if (s.exists && s.data().seed === host.presence.pm.seed) edits = s.data().edits || ''; } catch (e) { }
    }
    const hp = host.presence;
    return { room, code, pm: hp.pm, time: typeof hp.t === 'number' ? hp.t : 0.05, pos: Array.isArray(hp.p) ? hp.p : null, edits };
  },
  setup(room, code, isHost) {
    this.room = room; this.code = code; this.isHost = isHost; this.active = true; this.hostLeft = false;
    this.remotes.clear(); this.ring = []; this.atkRing = []; this.hitRing = []; this.sent = {}; this.seq = 0;
    const meP = room.peers().find(p => p.sameTab); this.me = meP ? meP.peer : null;
    this.unsub.push(room.onPeers(ch => this.onPeers(ch), e => this.onError(e)));
    Game.world.onEdit = (x, y, z, id) => this.localEdit(x, y, z, id);
    UI.partyChanged();
  },
  setupServer(room, srv) {
    this.server = srv; this.pvp = srv.mode === 'pvp'; this.myJ = Date.now(); this.saver = false;
    this.saveT = 5; this.timeSaveT = 45; this.hbT = 1.5; this.pvRing = []; this.dk = null; this.persist = false;
    this.setup(room, null, false);
    this.docVer = Game.world.editVer;
    this.elect();
  },
  /** servers: the longest-connected player runs the world; the longest-connected writer saves it */
  elect() {
    if (!this.server || !this.active) return;
    const me = { peer: this.me || '~', j: this.myJ, cw: Servers.canWrite !== false, me: true };
    const all = [me, ...[...this.remotes.values()].map(r => ({ peer: r.peer, j: r.j, cw: r.cw }))];
    all.sort((a, b) => (a.j - b.j) || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
    const keeper = !!all[0].me;
    if (keeper !== this.isHost) { this.isHost = keeper; Mobs.clear(); }
    const w = all.find(x => x.cw);
    const saver = !!Cloud.db && !!w && !!w.me;
    if (saver && !this.saver) { this.hbT = Math.min(this.hbT, 1); }
    this.saver = saver;
  },
  async saveServer() {
    if (!this.server || this.docBusy || !Game.world) return;
    this.docBusy = true; const ver = Game.world.editVer, id = this.server.id;
    try { await Servers.saveState(id, Game.world.encodeEdits(), Game.time, Atmos.save()); this.docVer = ver; Servers.noteWrite(true); }
    catch (e) { if (e && /permission|denied|forbidden/i.test(String(e.code || '') + ' ' + String(e.message || ''))) { Servers.noteWrite(false); this.elect(); } }
    finally { this.docBusy = false; }
  },
  async leave(silent) {
    if (this.server && this.active) {
      const srv = this.server;
      if (this.saver && Game.world) {
        if (Game.world.editVer !== this.docVer) { this.docBusy = false; await Promise.race([this.saveServer(), sleep(5000)]); }
        try { await Promise.race([Servers.heartbeat(srv, this.remotes.size), sleep(3000)]); } catch (e) { }
      }
    }
    const room = this.room, code = this.code, wasHost = this.isHost, persist = this.persist;
    this.active = false; this.room = null;
    this.unsub.forEach(u => { try { u(); } catch (e) { } }); this.unsub = [];
    for (const r of this.remotes.values()) r.tag && r.tag.remove();
    this.remotes.clear();
    if (Game.world) Game.world.onEdit = null;
    if (!wasHost) Mobs.clear();
    if (room) { try { await room.leave(); } catch (e) { } }
    if (wasHost && persist && Cloud.db) { try { await Cloud.db.doc('parties/' + code).delete(); } catch (e) { } }
    this.code = null; this.isHost = false; this.server = null; this.pvp = false; this.saver = false; this.dk = null; this.pvRing = [];
    UI.partyChanged();
  },
  onError(e) {
    if (!this.active) return;
    UI.toast(this.server ? 'Lost connection to the server.' : 'Lost connection to the party.');
    this.leave(true);
  },

  /* ---------- outgoing ---------- */
  localEdit(x, y, z, id) {
    this.seq++;
    this.ring.push([this.seq, x, y, z, id]);
    if (this.ring.length > 32) this.ring.shift();
  },
  attack(mobId, dmg, kx, kz) {
    this.atkRing.push([++this.atkSeq, mobId, dmg, r2(kx), r2(kz)]);
    if (this.atkRing.length > 4) this.atkRing.shift();
  },
  hostHit(peer, dmg, kx, kz) {
    this.hitRing.push([++this.hitSeq, peer, dmg, r2(kx), r2(kz)]);
    if (this.hitRing.length > 6) this.hitRing.shift();
  },
  pvpHit(peer, dmg, kx, kz) {
    this.pvRing.push([++this.pvSeq, peer, dmg, r2(kx), r2(kz)]);
    if (this.pvRing.length > 6) this.pvRing.shift();
  },
  deathEvent(killer, cause, loot) { this.dk = [++this.dkSeq, killer || '', String(cause || '').slice(0, 10), loot.slice(0, 80)]; },
  hitTestPlayers(o, d, maxDist) {
    let best = null, bt = maxDist;
    for (const r of this.remotes.values()) {
      if (r.flags & 4) continue;
      const h = (r.flags & 1) ? 1.65 : 1.85;
      const t = rayAABB(o, d, r.pos[0] - 0.36, r.pos[1], r.pos[2] - 0.36, r.pos[0] + 0.36, r.pos[1] + h, r.pos[2] + 0.36);
      if (t >= 0 && t < bt) { bt = t; best = r; }
    }
    return best ? { r: best, t: bt } : null;
  },
  chat(text) {
    text = [...String(text)].filter(ch => { const c = ch.codePointAt(0); return !(c < 32 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff); }).join('').trim().slice(0, 120);
    if (!text) return;
    this.chatMsg = [++this.chatSeq, text];
    UI.chatLine(Profile.data.name, text, true);
  },
  chatSys(text) { UI.chatLine(null, text); },
  buildPresence() {
    const P = Game.player, pr = Profile.data;
    const o = {
      v: 1, role: this.isHost ? 'host' : 'guest', n: pr.name, sk: Skins.key(pr.skin),
      p: [r2(P.pos[0]), r2(P.pos[1]), r2(P.pos[2])], r: [r2(P.yaw), r2(P.pitch)],
      st: [(P.sneak ? 1 : 0) | (P.flying ? 2 : 0) | (P.alive ? 0 : 4), this.swingCount, Game.inv.held ? Game.inv.held.id : 0],
      e: [].concat(...this.ring), a: [].concat(...this.atkRing), c: this.chatMsg, ar: Game.inv.armorMats(),
      hp: P.alive ? Math.max(0, Math.ceil(P.health)) : 0,
    };
    if (this.server) {
      o.j = this.myJ; o.cw = Servers.canWrite === false ? 0 : 1;
      if (this.pvp) { o.pv = [].concat(...this.pvRing); o.sc = [Game.score.k, Game.score.d]; o.dk = this.dk; }
    }
    if (this.isHost) {
      o.pm = { seed: Game.world.seed, sl: String(Game.seedLabel || '').slice(0, 40), name: Game.worldName.slice(0, 32), mode: Game.mode, diff: Settings.difficulty };
      o.t = Math.round(Game.time * 10000) / 10000;
      o.m = [].concat(...Mobs.list.slice(0, 16).map(m => [m.id, m.type === 'moss' ? 1 : m.type === 'crawl' ? 2 : 0, r2(m.pos[0]), r2(m.pos[1]), r2(m.pos[2]), r2(m.yaw), m.hurt > 0 ? 1 : 0, r2(m.walk % 100), m.type === 'moss' ? r2(m.graze) : (m.swing > 0.5 ? 1 : 0)]));
      o.w = r2(Atmos.rainTarget);
      o.h = this.hitRing.map(h => h.slice());
    }
    return o;
  },
  update(dt) {
    if (!this.active) return;
    // send presence (~12 Hz), only the fields that changed
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 0.08;
      const o = this.buildPresence(), patch = {}; let any = false;
      for (const k in o) { const s = JSON.stringify(o[k]); if (this.sent[k] !== s) { patch[k] = o[k]; this.sent[k] = s; any = true; } }
      if (any) this.room.presence(patch).catch(e => { if (e && e.code === 'invalid_argument') { this.ring = this.ring.slice(-8); this.sent = {}; } });
    }
    // host: keep the party doc's edits fresh for late joiners
    if (this.isHost && this.persist) {
      this.docT -= dt;
      if (this.docT <= 0 && !this.docBusy && Game.world.editVer !== this.docVer) {
        this.docT = 3; this.docBusy = true; const ver = Game.world.editVer;
        const e = Game.world.encodeEdits();
        Cloud.db.doc('parties/' + this.code).update({ edits: e.length < 240000 ? e : '', time: Game.time, updated: Date.now() })
          .then(() => { this.docVer = ver; }).catch(() => { }).finally(() => { this.docBusy = false; });
      }
    }
    // servers: the saver keeps the shared world and the online count up to date
    if (this.server && this.saver) {
      this.saveT -= dt; this.timeSaveT -= dt; this.hbT -= dt;
      if (!this.docBusy && ((this.saveT <= 0 && Game.world.editVer !== this.docVer) || this.timeSaveT <= 0)) { this.saveT = 5; this.timeSaveT = 60; this.saveServer(); }
      if (this.hbT <= 0) {
        this.hbT = 30;
        Servers.heartbeat(this.server, this.remotes.size + 1).then(() => Servers.noteWrite(true))
          .catch(e => { if (e && /permission|denied|forbidden/i.test(String(e.code || '') + ' ' + String(e.message || ''))) { Servers.noteWrite(false); this.elect(); } });
      }
    }
    // interpolate remote players
    for (const r of this.remotes.values()) {
      if (r.hurtT > 0) r.hurtT -= dt;
      const k = 1 - Math.exp(-12 * dt);
      const ox = r.pos[0], oz = r.pos[2];
      for (let i = 0; i < 3; i++) r.pos[i] = lerp(r.pos[i], r.tpos[i], k);
      let dy = r.tyaw - r.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      r.yaw += dy * k; r.pitch = lerp(r.pitch, r.tpitch, k);
      const sp = Math.hypot(r.pos[0] - ox, r.pos[2] - oz) / Math.max(dt, 1e-4);
      r.walk += sp * dt * 2.2; r.walkAmt = lerp(r.walkAmt, (r.flags & 2) ? 0 : Math.min(1, sp / 4.3), 1 - Math.exp(-8 * dt));
      r.swingT = Math.min(1, r.swingT + dt * 3.2);
    }
  },

  /* ---------- incoming ---------- */
  onPeers(ch) {
    if (!this.active) return;
    if (!this.me) { const meP = ch.peers.find(p => p.sameTab); if (meP) this.me = meP.peer; }
    for (const p of ch.joined.concat(ch.updated)) if (!p.sameTab) this.ingest(p);
    for (const p of ch.left) {
      const r = this.remotes.get(p.peer);
      if (!r) continue;
      r.tag && r.tag.remove(); this.remotes.delete(p.peer);
      this.chatSys(`${r.name} left the ${this.server ? 'server' : 'party'}`);
      if (r.host && !this.isHost && !this.server) this.hostGone();
    }
    if (this.server) this.elect();
    UI.partyChanged();
  },
  ingest(p) {
    const s = p.presence || {};
    if (s.v !== 1 || !Array.isArray(s.p)) return;
    let r = this.remotes.get(p.peer);
    const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
    if (!r) {
      r = { peer: p.peer, name: 'Player', skin: Skins.presets[0].skin, pos: s.p.map(num), tpos: s.p.map(num), yaw: 0, tyaw: 0, pitch: 0, tpitch: 0,
        walk: 0, walkAmt: 0, swingT: 1, lastSwing: null, flags: 0, held: 0, lastE: 0, lastA: 0, lastC: 0, lastH: 0, host: false, tag: null,
        j: 9e15, cw: true, hp: 20, hurtT: 0, score: [0, 0], lastPv: 0, lastDk: 0 };
      // first sight: apply the whole ring, but don't replay old chat, hits or deaths
      if (Array.isArray(s.c)) r.lastC = num(s.c[0]);
      if (Array.isArray(s.pv)) for (let i = 0; i + 4 < s.pv.length; i += 5) r.lastPv = Math.max(r.lastPv, num(s.pv[i]));
      if (Array.isArray(s.dk)) r.lastDk = num(s.dk[0]);
      this.remotes.set(p.peer, r);
      this.chatSys(`${cleanName(s.n) || 'A player'} joined the ${this.server ? 'server' : 'party'}`);
    }
    if (typeof s.j === 'number' && isFinite(s.j)) r.j = s.j;
    r.cw = s.cw !== 0;
    if (typeof s.hp === 'number') { const hp = clamp(s.hp, 0, 20); if (hp < r.hp && hp > 0) r.hurtT = 0.35; r.hp = hp; }
    if (Array.isArray(s.sc)) r.score = [clamp(num(s.sc[0]) | 0, 0, 99999), clamp(num(s.sc[1]) | 0, 0, 99999)];
    if (this.pvp && Array.isArray(s.pv)) {
      for (let i = 0; i + 4 < s.pv.length; i += 5) {
        const sq = num(s.pv[i]); if (sq <= r.lastPv) continue; r.lastPv = sq;
        if (!this.me || s.pv[i + 1] !== this.me) continue;
        // at most ~2.5 hits a second from any one player, however the messages bunch up
        const now = performance.now();
        r.pvTok = Math.min(3, (r.pvTok === undefined ? 3 : r.pvTok) + (now - (r.pvT || now)) / 1000 * 2.5); r.pvT = now;
        if (r.pvTok < 1) continue; r.pvTok -= 1;
        Game.pvpHitBy(r, clamp(num(s.pv[i + 2]), 0, 12), [clamp(num(s.pv[i + 3]), -1, 1), clamp(num(s.pv[i + 4]), -1, 1)]);
      }
    }
    if (this.pvp && Array.isArray(s.dk) && num(s.dk[0]) > r.lastDk) { r.lastDk = num(s.dk[0]); this.onRemoteDeath(r, s.dk); }
    r.host = s.role === 'host';
    r.name = cleanName(s.n) || 'Player';
    if (typeof s.sk === 'string') r.skin = Skins.sanitize(s.sk);
    r.armor = Array.isArray(s.ar) ? s.ar.slice(0, 4).map(v => clamp(v | 0, 0, 3)) : [0, 0, 0, 0];
    r.tpos = [num(s.p[0]), clamp(num(s.p[1]), -64, WH + 64), num(s.p[2])];
    if (Array.isArray(s.r)) { r.tyaw = num(s.r[0]); r.tpitch = clamp(num(s.r[1]), -1.6, 1.6); }
    if (Array.isArray(s.st)) {
      r.flags = num(s.st[0]) | 0; r.held = ITEMS[num(s.st[2])] ? num(s.st[2]) : 0;
      if (r.lastSwing !== null && s.st[1] !== r.lastSwing) r.swingT = 0;
      r.lastSwing = s.st[1];
    }
    // block edits
    if (Array.isArray(s.e)) {
      let maxSeq = r.lastE;
      for (let i = 0; i + 4 < s.e.length; i += 5) {
        const sq = num(s.e[i]); if (sq <= r.lastE) continue;
        const x = num(s.e[i + 1]) | 0, y = num(s.e[i + 2]) | 0, z = num(s.e[i + 3]) | 0, id = num(s.e[i + 4]) | 0;
        if (y >= 0 && y < WH && (id === 0 || BLOCKS[id])) this.applyEdit(x, y, z, id);
        if (sq > maxSeq) maxSeq = sq;
      }
      r.lastE = maxSeq;
    }
    // chat
    if (Array.isArray(s.c) && num(s.c[0]) > r.lastC) { r.lastC = num(s.c[0]); UI.chatLine(r.name, String(s.c[1] || '').slice(0, 120)); }
    // host processes attacks on its creatures
    if (this.isHost && Array.isArray(s.a)) {
      for (let i = 0; i + 4 < s.a.length; i += 5) {
        const sq = num(s.a[i]); if (sq <= r.lastA) continue; r.lastA = sq;
        const m = Mobs.list.find(m => m.id === num(s.a[i + 1]));
        if (m) { m.health -= clamp(num(s.a[i + 2]), 0, 8); m.hurt = 0.35; m.byPlayer = false; m.vel[0] += clamp(num(s.a[i + 3]), -1, 1) * 7; m.vel[2] += clamp(num(s.a[i + 4]), -1, 1) * 7; m.vel[1] = 5; Mobs.onHit(m, r.tpos); if (m.type !== 'moss') GameAudio.mobHurt(); }
      }
    }
    // guests follow the host's clock, creatures and hits
    if (r.host && !this.isHost) {
      if (typeof s.t === 'number') { if (Math.abs(s.t - Game.time) > 0.0015) Game.time = s.t; }
      if (Array.isArray(s.m)) Mobs.mirror(s.m);
      if (typeof s.w === 'number') Atmos.rainTarget = clamp(s.w, 0, 1);
      if (Array.isArray(s.h)) for (const h of s.h) {
        if (!Array.isArray(h) || num(h[0]) <= r.lastH) continue; r.lastH = num(h[0]);
        if (h[1] === this.me) Game.damagePlayer(clamp(num(h[2]), 0, 10), 'gloom', [clamp(num(h[3]), -1, 1), clamp(num(h[4]), -1, 1)]);
      }
      if (s.pm && s.pm.mode && s.pm.mode !== Game.mode) Game.setMode(s.pm.mode === 'creative' ? 'creative' : 'survival');
    }
  },
  onRemoteDeath(r, dk) {
    const killer = typeof dk[1] === 'string' && dk[1] ? dk[1] : null;
    const verbs = { fall: 'fell from a high place', drown: 'drowned', fire: 'got too close to a fire', gloom: 'was caught by a Gloomling', crawler: 'was bitten by a Duskcrawler', starve: 'starved', void: 'fell out of the world' };
    if (killer && killer === this.me) {
      this.chatSys(`You defeated ${r.name}!`);
      Game.onKill(r, Array.isArray(dk[3]) ? dk[3] : []);
    } else if (killer) {
      const k = this.remotes.get(killer);
      this.chatSys(`${r.name} was defeated by ${k ? k.name : 'another player'}`);
    } else this.chatSys(`${r.name} ${verbs[dk[2]] || 'perished'}`);
  },
  applyEdit(x, y, z, id) {
    const w = Game.world;
    if (this.pvp && Game.inSafeZone(x + 0.5, z + 0.5)) return;
    if (w.getBlock(x, y, z) === id && w.isLoaded(x, z)) return;
    if (w.isLoaded(x, z)) { w.setBlock(x, y, z, id, true); if (id === 0) Game.checkSupport(x, y, z, true); }
    else {
      const k = ckey(x >> 4, z >> 4); let em = w.edits.get(k); if (!em) { em = new Map(); w.edits.set(k, em); }
      em.set((x & 15) | ((z & 15) << 4) | (y << 8), id); w.editVer++;
    }
  },
  hostGone() {
    if (this.hostLeft) return;
    this.hostLeft = true;
    UI.banner('The host left', 'You can keep exploring this world on your own — it will be saved as a copy.');
    Game.worldId = newId(); Game.worldName = (Game.worldName || 'Party world').replace(/ \(party\)$/, '') + ' (copy)';
    this.leave(true);
  },
  players() {
    // [{name, host, you}]
    const list = [{ name: Profile.data ? Profile.data.name : 'You', host: this.isHost && !this.server, you: true, k: Game.score ? Game.score.k : 0, d: Game.score ? Game.score.d : 0 }];
    for (const r of this.remotes.values()) list.push({ name: r.name, host: r.host && !this.server, you: false, k: r.score[0], d: r.score[1] });
    if (this.pvp) list.sort((a, b) => b.k - a.k || a.d - b.d);
    return list;
  },
  remotePositions() { return [...this.remotes.values()].filter(r => !(r.flags & 4)).map(r => ({ peer: r.peer, pos: r.pos })); },

  /* ---------- rendering ---------- */
  render(world) {
    const gl = R.gl;
    for (const r of this.remotes.values()) {
      if (r.flags & 4) continue;
      const [sky, blk] = lightAt(world, r.pos[0], r.pos[1] + 1.5, r.pos[2]);
      const hurt = r.hurtT > 0;
      if (hurt) { flushDyn(); gl.uniform4f(R.uMain.uTint, 0.85, 0.1, 0.1, 0.45); }
      drawPlayerModel({ x: r.pos[0], y: r.pos[1], z: r.pos[2], yaw: r.yaw, pitch: r.pitch, walk: r.walk, walkAmt: r.walkAmt,
        swing: Math.sin(Math.min(1, r.swingT) * Math.PI), sneak: !!(r.flags & 1), skin: r.skin, held: r.held, armor: r.armor, sky, blk });
      if (hurt) { flushDyn(); gl.uniform4f(R.uMain.uTint, 0, 0, 0, 0); }
    }
    flushDyn();
  },
  updateTags(cam) {
    const layer = $('tags'); if (!layer) return;
    const vp = R.vp, W = innerWidth, H = innerHeight;
    for (const r of this.remotes.values()) {
      if (!r.tag) { r.tag = document.createElement('div'); r.tag.className = 'tag'; layer.appendChild(r.tag); }
      const label = this.pvp ? `${r.name}  ❤ ${Math.ceil(r.hp / 2)}` : r.name;
      if (r.tag.textContent !== label) r.tag.textContent = label;
      const x = r.pos[0], y = r.pos[1] + ((r.flags & 1) ? 1.9 : 2.1), z = r.pos[2];
      const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      const d = Math.hypot(x - cam.eye[0], y - cam.eye[1], z - cam.eye[2]);
      if (cw <= 0.1 || d > 64 || (r.flags & 4) || Game.hideHud) { r.tag.style.display = 'none'; continue; }
      const cx = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw, cy = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw;
      r.tag.style.display = '';
      r.tag.style.transform = `translate(${(cx * 0.5 + 0.5) * W}px, ${(1 - (cy * 0.5 + 0.5)) * H}px) translate(-50%, -100%)`;
      r.tag.style.opacity = d > 40 ? Math.max(0.2, 1 - (d - 40) / 24) : 1;
    }
  },
};
