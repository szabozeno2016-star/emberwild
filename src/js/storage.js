/* =====================================================================
   Platform capabilities, profiles (account / guest) and world saves
   ===================================================================== */
const Cloud = {
  user: null, db: null, room: null, uid: null, ready: false, readyP: null,
  init() {
    const use = n => {
      try {
        if (typeof claude === 'undefined' || !claude || typeof claude.use !== 'function') return Promise.resolve(null);
        return Promise.race([claude.use(n), new Promise(r => setTimeout(() => r(null), 10000))]).catch(() => null);
      } catch (e) { return Promise.resolve(null); }
    };
    this.readyP = (async () => {
      const [u, d, r] = await Promise.all([use('user'), use('db'), use('room')]);
      this.user = u; this.db = d; this.room = r;
      if (u) { try { this.uid = await u.id(); } catch (e) { this.uid = null; } }
      this.ready = true;
    })();
    return this.readyP;
  },
  get canAccount() { return !!(this.db && this.uid); },
  path(...p) { return ['data', 'users', this.uid, ...p].join('/'); },
};
const LS = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { } },
};

/* ---------------- profile ---------------- */
const Profile = {
  data: null, // {kind:'account'|'guest', cloud:bool, name, skin:[...]}
  async load() {
    let local = LS.get('emberwild.profile');
    if (local && local.kind === 'guest') { local.name = cleanName(local.name) || 'Guest'; local.skin = Skins.sanitize(local.skin); local.cloud = false; this.data = local; return local; }
    if (Cloud.canAccount) {
      try {
        const s = await Cloud.db.doc(Cloud.path('profile')).get();
        if (s.exists) {
          const d = s.data();
          this.data = { kind: 'account', cloud: true, name: cleanName(d.name) || 'Player', skin: Skins.sanitize(d.skin) };
          return this.data;
        }
      } catch (e) { }
    }
    if (local && local.kind) { local.name = cleanName(local.name) || 'Player'; local.skin = Skins.sanitize(local.skin); local.cloud = false; this.data = local; }
    return this.data;
  },
  get exists() { return !!this.data; },
  async createAccount(name, skin) {
    const p = { kind: 'account', cloud: false, name: cleanName(name) || 'Player', skin: Skins.sanitize(skin) };
    let err = null;
    if (Cloud.canAccount) {
      try {
        const ref = Cloud.db.doc(Cloud.path('profile')), old = await ref.get();
        await ref.set({ name: p.name, skin: p.skin, created: old.exists && old.data().created || Date.now(), updated: Date.now() }); p.cloud = true;
      } catch (e) { err = e; }
    }
    this.data = p; LS.set('emberwild.profile', { kind: p.kind, name: p.name, skin: p.skin });
    return { cloud: p.cloud, err };
  },
  guest(skin) {
    const n = 'Guest-' + (1000 + Math.floor(Math.random() * 9000));
    this.data = { kind: 'guest', cloud: false, name: n, skin: Skins.sanitize(skin || Skins.presets[(Math.random() * Skins.presets.length) | 0].skin) };
    LS.set('emberwild.profile', { kind: 'guest', name: this.data.name, skin: this.data.skin });
    return this.data;
  },
  async update(name, skin) {
    const p = this.data; if (!p) return;
    p.name = cleanName(name) || p.name; p.skin = Skins.sanitize(skin);
    LS.set('emberwild.profile', { kind: p.kind, name: p.name, skin: p.skin });
    if (p.kind === 'account' && p.cloud) {
      try { await Cloud.db.doc(Cloud.path('profile')).set({ name: p.name, skin: p.skin, updated: Date.now() }); } catch (e) { return false; }
    }
    return true;
  },
  async signOut() {
    // leave the account: keeps cloud data, switches this device to a guest
    this.guest(this.data && this.data.skin);
  },
};
function cleanName(s) { return String(s || '').replace(/[^\w\- .]/g, '').trim().slice(0, 16); }

/* ---------------- world saves ---------------- */
const PART = 180000;
const Saves = {
  get cloud() { return !!(Profile.data && Profile.data.kind === 'account' && Profile.data.cloud && Cloud.canAccount); },
  worldsCol() { return Cloud.db.doc(Cloud.path('profile')).collection('worlds'); },
  async list() {
    if (this.cloud) {
      try {
        const q = await this.worldsCol().get();
        return q.docs.filter(d => d.exists).map(d => d.data()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      } catch (e) { }
    }
    return (LS.get('emberwild.worlds') || []).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  },
  async load(id) {
    if (this.cloud) {
      try {
        const ref = this.worldsCol().doc(id), s = await ref.get();
        if (s.exists) {
          const meta = s.data(); let edits = '';
          for (let i = 0; i < (meta.parts || 0); i++) {
            const p = await ref.collection('parts').doc('p' + i).get();
            if (p.exists) edits += p.data().s || '';
          }
          return Object.assign({}, meta, { edits });
        }
      } catch (e) { }
    }
    return LS.get('emberwild.w.' + id);
  },
  async save(data) {
    const meta = Object.assign({}, data); delete meta.edits;
    if (this.cloud) {
      const ref = this.worldsCol().doc(data.id);
      const parts = [];
      for (let i = 0; i < data.edits.length; i += PART) parts.push(data.edits.slice(i, i + PART));
      meta.parts = parts.length;
      const retry = async f => { try { return await f(); } catch (e) { if (e && e.code === 'unavailable') { await new Promise(r => setTimeout(r, 700)); return await f(); } throw e; } };
      for (let i = 0; i < parts.length; i++) await retry(() => ref.collection('parts').doc('p' + i).set({ s: parts[i] }));
      await retry(() => ref.set(meta));
      return 'cloud';
    }
    const ok = LS.set('emberwild.w.' + data.id, data);
    const idx = (LS.get('emberwild.worlds') || []).filter(w => w.id !== data.id);
    idx.push(meta); LS.set('emberwild.worlds', idx);
    if (!ok) throw new Error('This browser has no room left to save the world.');
    return 'local';
  },
  async remove(id) {
    if (this.cloud) { try { await this.worldsCol().doc(id).delete(); } catch (e) { } }
    LS.del('emberwild.w.' + id);
    LS.set('emberwild.worlds', (LS.get('emberwild.worlds') || []).filter(w => w.id !== id));
  },
};
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
