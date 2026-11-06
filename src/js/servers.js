/* =====================================================================
   Servers: persistent shared worlds anyone can drop into at any time.
   There is no machine running them — whoever is online keeps the world
   going. The longest-connected player simulates creatures, time and
   weather; the longest-connected player who can write to the shared
   database saves the world's changes and the "online" count.
     servers/<id>               listing (name, mode, seed, owner, online)
     servers/<id>/state/meta    { parts, time, weather, updated }
     servers/<id>/state/p<n>    { s: encoded block edits }
   ===================================================================== */
const OFFICIAL_SERVERS = [
  { id: 'pvp', name: 'PVP', mode: 'pvp', seed: 'emberwild-pvp-arena', official: true,
    desc: 'The official battle world. Fight other players, raid their forts and climb the leaderboard. The spawn area is a safe zone.' },
];
const SERVER_MODES = { pvp: 'PVP', survival: 'Survival', creative: 'Creative' };
const SERVER_MODE_DESC = {
  pvp: 'Survival with player-vs-player combat. Defeated players drop their loot to the winner. Spawn is a safe zone.',
  survival: 'A shared survival world. Build together and survive the nights — players can’t hurt each other.',
  creative: 'Unlimited blocks and flying for everyone. Build anything together.',
};
const PVP_KIT = [[I.STONE_SWORD, 1], [I.STONE_PICK, 1], [I.STONE_AXE, 1], [I.ROAST_HAUNCH, 6], [B.OAK_PLANKS, 24], [B.TORCH, 8]];
const SAFE_R = 12;           // spawn safe-zone radius on PVP servers (blocks)
const SERVER_STALE = 75000;  // an "online" heartbeat older than this means nobody is there

const Servers = {
  list: [], canWrite: null, writeChecked: false,
  get available() { return !!Cloud.room; },
  ref(id) { return Cloud.db.doc('servers/' + id); },
  stateCol(id) { return this.ref(id).collection('state'); },
  roomName(id) { return 'ew-srv-' + String(id).toLowerCase(); },
  official(id) { return OFFICIAL_SERVERS.find(s => s.id === id) || null; },
  clean(s) { return [...String(s || '')].filter(ch => { const c = ch.codePointAt(0); return !(c < 32 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff); }).join('').trim(); },

  /** may this viewer write shared docs? true / false / null (unknown — try and see) */
  async checkWrite() {
    if (this.writeChecked) return this.canWrite;
    this.writeChecked = true;
    if (!Cloud.db) { this.canWrite = false; return false; }
    try { const v = Cloud.user && Cloud.user.can ? await Cloud.user.can('data.write') : null; this.canWrite = v === true ? true : v === false ? false : null; }
    catch (e) { this.canWrite = null; }
    return this.canWrite;
  },
  noteWrite(ok) { if (ok) this.canWrite = true; else if (this.canWrite !== true) this.canWrite = false; },

  async fetch() {
    const rows = OFFICIAL_SERVERS.map(s => Object.assign({ online: 0 }, s));
    if (Cloud.db) {
      try {
        const q = await Promise.race([Cloud.db.collection('servers').get(), sleep(10000).then(() => { throw new Error('timeout'); })]);
        for (const d of q.docs) {
          if (!d.exists) continue;
          const v = d.data() || {}, id = d.id;
          const fresh = typeof v.seen === 'number' && Date.now() - v.seen < SERVER_STALE;
          const online = fresh ? clamp(v.online | 0, 0, 99) : 0;
          const off = rows.find(r => r.official && r.id === id);
          if (off) { off.online = online; continue; }
          if (!SERVER_MODES[v.mode] || !/^[a-z0-9]{4,24}$/.test(id)) continue;
          rows.push({ id, name: this.clean(v.name).slice(0, 24) || 'Server', desc: this.clean(v.desc).slice(0, 90), mode: v.mode,
            seed: String(v.seed || id).slice(0, 40), owner: v.owner || null, ownerName: cleanName(v.ownerName) || '', created: v.created || 0, updated: v.updated || 0, online });
        }
      } catch (e) { this.fetchError = true; }
    }
    rows.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || b.online - a.online || (b.updated || 0) - (a.updated || 0));
    this.list = rows;
    return rows;
  },
  mine() { return this.list.filter(s => !s.official && s.owner && s.owner === Cloud.uid); },

  async create(o) {
    if (!Cloud.db || !Cloud.uid) throw new Error('Creating servers needs the live connection claude.ai gives this game.');
    const name = this.clean(o.name).slice(0, 24), desc = this.clean(o.desc).slice(0, 90);
    if (!name) throw new Error('Give your server a name.');
    if (OFFICIAL_SERVERS.some(s => s.name.toLowerCase() === name.toLowerCase())) throw new Error('That name belongs to an official server. Pick another.');
    if (this.mine().length >= 3) throw new Error('You can have up to 3 servers. Delete one first.');
    const id = newId().replace(/[^a-z0-9]/g, '').slice(0, 16);
    const seed = this.clean(o.seed).slice(0, 40) || String((Math.random() * 1e9) | 0);
    const doc = { v: 1, id, name, desc, mode: SERVER_MODES[o.mode] ? o.mode : 'survival', seed, owner: Cloud.uid, ownerName: Profile.data ? Profile.data.name : '',
      created: Date.now(), updated: Date.now(), online: 0, seen: 0 };
    try { await this.ref(id).set(doc); this.noteWrite(true); }
    catch (e) { this.noteWrite(false); throw new Error('You don’t have permission to create servers here. Ask the game’s owner to share it with you as a Contributor.'); }
    return Object.assign({}, doc, { online: 0 });
  },
  async remove(srv) {
    if (!Cloud.db || srv.official) return;
    try {
      const m = await this.stateCol(srv.id).doc('meta').get();
      const parts = m.exists ? (m.data().parts | 0) : 0;
      for (let i = 0; i < parts; i++) { try { await this.stateCol(srv.id).doc('p' + i).delete(); } catch (e) { } }
      try { await this.stateCol(srv.id).doc('meta').delete(); } catch (e) { }
      await this.ref(srv.id).delete();
    } catch (e) { throw new Error('Could not delete that server.'); }
  },

  /* ---------- world state ---------- */
  async loadState(id) {
    const out = { edits: '', time: null, weather: null };
    if (!Cloud.db) return out;
    try {
      const m = await this.stateCol(id).doc('meta').get();
      if (!m.exists) return out;
      const meta = m.data() || {};
      out.time = typeof meta.time === 'number' && isFinite(meta.time) ? meta.time : null;
      out.weather = meta.weather || null;
      let s = '';
      for (let i = 0; i < clamp(meta.parts | 0, 0, 64); i++) {
        const p = await this.stateCol(id).doc('p' + i).get();
        if (p.exists) s += String(p.data().s || '');
      }
      out.edits = s;
    } catch (e) { }
    return out;
  },
  async saveState(id, edits, time, weather) {
    const parts = [];
    for (let i = 0; i < edits.length; i += PART) parts.push(edits.slice(i, i + PART));
    const col = this.stateCol(id);
    for (let i = 0; i < parts.length; i++) await col.doc('p' + i).set({ s: parts[i] });
    await col.doc('meta').set({ parts: parts.length, time, weather, updated: Date.now() });
  },
  async heartbeat(srv, online) {
    const ref = this.ref(srv.id);
    if (srv.official) await ref.set({ v: 1, id: srv.id, official: true, online, seen: Date.now() });
    else await ref.update({ online, seen: online > 0 ? Date.now() : 0, updated: Date.now() });
  },

  /* ---------- your character on each server (kept in this browser) ---------- */
  playerKey(id) { return 'emberwild.srv.' + id + '.' + (Cloud.uid || 'local'); },
  loadPlayer(id) { return LS.get(this.playerKey(id)); },
  savePlayer(id, data) { LS.set(this.playerKey(id), data); },
};
