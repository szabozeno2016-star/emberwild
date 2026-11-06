/* =====================================================================
   UI: profile & skins, world list, parties, chat
   ===================================================================== */
Object.assign(UI, {
  draftSkin: null, profileMode: 'edit', worldsHost: false,

  async refreshContinue() {
    const b = $('continueBtn'); if (!Profile.exists) { b.classList.add('hidden'); return; }
    let list = []; try { list = await Saves.list(); } catch (e) { }
    this.lastWorld = list[0] || null;
    b.classList.toggle('hidden', !this.lastWorld);
    if (this.lastWorld) b.textContent = 'Continue — ' + (this.lastWorld.name || 'World');
  },
  needProfile() { if (Profile.exists) return false; this.show('welcome'); return true; },
  refreshChip() {
    const p = Profile.data; if (!p) return;
    const g = $('chipFace').getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, 32, 32);
    g.drawImage(Skins.face(p.skin, 32), 0, 0);
    $('chipName').textContent = p.name;
    $('chipKind').textContent = p.kind === 'guest' ? 'Guest · anonymous' : p.cloud ? 'Account · saved online' : 'Account · this device';
    $('profileChip').classList.toggle('hidden', !(Game.state === 'menu' && this.cur === 'title'));
  },

  /* ---------- profile & skin editor ---------- */
  openProfile() {
    const creating = this.profileMode === 'create' || !Profile.exists;
    const p = Profile.data;
    $('profTitle').textContent = creating ? 'Create Account' : 'Profile & Skin';
    this.draftSkin = (p ? p.skin : Skins.presets[0].skin).slice();
    $('pName').value = creating ? (p && p.kind === 'account' ? p.name : '') : p.name;
    $('pName').placeholder = 'Your name in parties';
    let st;
    if (creating) st = Cloud.canAccount ? 'Your account is linked to your Claude sign-in: name, skin and worlds are saved online and follow you to any device.' : 'Online saving isn’t available in this view, so your account will be kept in this browser.';
    else if (p.kind === 'guest') st = 'You’re playing as an anonymous guest. Nothing is linked to you, and your worlds stay in this browser.';
    else st = p.cloud ? 'Signed in with your Claude account. Changes are saved online.' : 'Account kept in this browser (online saving isn’t available with your access).';
    $('profStatus').textContent = st;
    $('profAlt').style.display = creating ? 'none' : '';
    $('profAlt').textContent = p && p.kind === 'guest' ? 'Create Account' : 'Switch to Guest';
    if (!this.skinUIBuilt) this.buildSkinUI();
    this.refreshSkinUI();
    setTimeout(() => $('pName').focus(), 60);
  },
  buildSkinUI() {
    this.skinUIBuilt = true;
    const grid = $('presetGrid');
    Skins.presets.forEach(pr => {
      const d = document.createElement('div'); d.className = 'preset';
      const c = Skins.figure(pr.skin, 1); d.appendChild(c);
      const s = document.createElement('span'); s.textContent = pr.name; d.appendChild(s);
      d.onclick = () => { GameAudio.click(); this.draftSkin = pr.skin.slice(); this.refreshSkinUI(); };
      d.dataset.key = Skins.key(pr.skin);
      grid.appendChild(d);
    });
    const rows = [
      ['Skin tone', 0, Skins.TONES], ['Hair', 1, Skins.HAIRS], ['Hair style', 2, Skins.STYLES], ['Eyes', 3, Skins.EYES],
      ['Outfit', 4, Skins.CLOTH], ['Accent', 5, Skins.CLOTH], ['Pattern', 8, Skins.PATTERNS], ['Trousers', 6, Skins.PANTS], ['Shoes', 7, Skins.SHOES],
    ];
    const box = $('skinCustom'); this.swatchRows = [];
    for (const [label, idx, pal] of rows) {
      const l = document.createElement('label'); l.textContent = label; box.appendChild(l);
      const sw = document.createElement('div'); sw.className = 'sw';
      pal.forEach((v, i) => {
        let el;
        if (v[0] === '#') { el = document.createElement('i'); el.style.background = v; el.title = label; }
        else { el = document.createElement('button'); el.className = 'btn'; el.textContent = v; }
        el.onclick = () => { GameAudio.click(); this.draftSkin[idx] = i; this.refreshSkinUI(); };
        sw.appendChild(el);
      });
      box.appendChild(sw); this.swatchRows.push([idx, sw]);
    }
  },
  refreshSkinUI() {
    const s = this.draftSkin, k = Skins.key(s);
    [...$('presetGrid').children].forEach(d => d.classList.toggle('on', d.dataset.key === k));
    for (const [idx, sw] of this.swatchRows) [...sw.children].forEach((el, i) => el.classList.toggle('on', i === s[idx]));
    const g = $('skinFig').getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, 64, 128);
    g.drawImage(Skins.figure(s, 2), 0, 0);
  },
  async saveProfile() {
    const creating = this.profileMode === 'create' || !Profile.exists;
    const name = cleanName($('pName').value);
    if (!name) { this.toast('Pick a name first (letters, numbers, - _ .)'); $('pName').focus(); return; }
    if (creating) {
      const r = await Profile.createAccount(name, this.draftSkin);
      this.toast(r.cloud ? `Account created — welcome, ${Profile.data.name}!` : 'Account created in this browser (online saving isn’t available with your access).', 'gold');
    } else {
      const ok = await Profile.update(name, this.draftSkin);
      this.toast(ok ? 'Profile saved' : 'Saved here, but the online copy could not be updated.');
    }
    this.profileMode = 'edit'; this.refreshChip();
    if (Game.state === 'play') this.show('pause'); else this.show('title');
  },
  profileAlt() {
    const p = Profile.data;
    if (p.kind === 'guest') { this.profileMode = 'create'; this.openProfile(); return; }
    this.confirm('Switch to guest?', 'You will play anonymously on this device. Your account and its online worlds stay saved; choose Create Account later to sign back in.', async () => {
      await Profile.signOut(); this.refreshChip(); this.show(Game.state === 'play' ? 'pause' : 'title');
    }, 'profile');
  },

  /* ---------- world list ---------- */
  async refreshWorlds() {
    $('worldsTitle').textContent = this.worldsHost ? 'Choose a World to Host' : 'Select World';
    $('worldsNote').textContent = Saves.cloud ? 'Worlds saved to your account' : (Profile.data && Profile.data.kind === 'guest' ? 'Guest worlds are saved in this browser only' : 'Worlds saved in this browser');
    const box = $('worldList'); box.innerHTML = '<div class="empty">Loading worlds…</div>';
    let list = [];
    try { list = await Saves.list(); } catch (e) { }
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="empty">No worlds yet. Create one to start exploring.</div>'; return; }
    for (const w of list) {
      const row = document.createElement('div'); row.className = 'wrow';
      const info = document.createElement('div'); info.className = 'wi';
      const n = document.createElement('div'); n.className = 'wn'; n.textContent = w.name || 'World';
      const d = document.createElement('div'); d.className = 'wd';
      d.textContent = `${w.mode === 'creative' ? 'Creative' : 'Survival · ' + DIFFICULTY[w.diff | 0]} · Day ${w.day || 1} · ${this.ago(w.savedAt)}`;
      info.append(n, d);
      const play = document.createElement('button'); play.className = 'btn primary'; play.textContent = this.worldsHost ? 'Host' : 'Play';
      play.onclick = async () => {
        GameAudio.init(); GameAudio.click(); play.disabled = true;
        const data = await Saves.load(w.id);
        if (!data) { this.toast('That world could not be loaded.'); play.disabled = false; return; }
        Game.loadWorld(data);
        if (this.worldsHost) Game.pendingHost = true;
        lockPointer(false);
      };
      const del = document.createElement('button'); del.className = 'btn'; del.textContent = 'Delete';
      del.onclick = () => { GameAudio.click(); this.confirm(`Delete “${w.name}”?`, 'This cannot be undone.', async () => { await Saves.remove(w.id); this.show('worlds'); }, 'worlds'); };
      row.append(info, play, del); box.appendChild(row);
    }
  },
  ago(t) {
    if (!t) return 'never played';
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString();
  },

  /* ---------- servers ---------- */
  async refreshServers() {
    const on = Servers.available;
    $('srvOff').classList.toggle('hidden', on); $('srvOn').classList.toggle('hidden', !on);
    $('srvCreateBtn').style.display = on ? '' : 'none';
    if (!on) return;
    const box = $('srvList'), st = $('srvStatus');
    st.textContent = '';
    if (!box.children.length) box.innerHTML = '<div class="empty">Looking for servers…</div>';
    const seq = this.srvSeq = (this.srvSeq || 0) + 1;
    const [list, cw] = await Promise.all([Servers.fetch(), Servers.checkWrite()]);
    if (seq !== this.srvSeq || this.cur !== 'servers') return;
    box.innerHTML = '';
    const icon = { pvp: I.STONE_SWORD, survival: B.GRASS, creative: B.BRICKS };
    for (const s of list) {
      const row = document.createElement('div'); row.className = 'srow' + (s.official ? ' official' : '');
      const ic = document.createElement('div'); ic.className = 'sic';
      const img = document.createElement('img'); img.src = this.icons[s.official ? I.SKY_SWORD : icon[s.mode]] || ''; img.alt = ''; ic.appendChild(img);
      const info = document.createElement('div'); info.className = 'si';
      const n = document.createElement('div'); n.className = 'sn';
      const nm = document.createElement('span'); nm.textContent = s.name; n.appendChild(nm);
      if (s.official) { const b = document.createElement('span'); b.className = 'badge off'; b.textContent = 'Official'; n.appendChild(b); }
      const mb = document.createElement('span'); mb.className = 'badge ' + s.mode; mb.textContent = SERVER_MODES[s.mode]; n.appendChild(mb);
      const d = document.createElement('div'); d.className = 'sd'; d.textContent = s.desc || SERVER_MODE_DESC[s.mode];
      const o = document.createElement('div'); o.className = 'so';
      const live = document.createElement('span'); if (s.online > 0) live.className = 'live';
      live.textContent = s.online > 0 ? `● ${s.online} online` : '○ Nobody online';
      o.appendChild(live);
      if (!s.official && s.ownerName) o.appendChild(document.createTextNode(` · by ${s.ownerName}`));
      info.append(n, d, o);
      const join = document.createElement('button'); join.className = 'btn primary'; join.textContent = 'Join';
      join.onclick = () => { GameAudio.init(); GameAudio.click(); this.joinServerUI(s, join); };
      row.append(ic, info, join);
      if (!s.official && s.owner && s.owner === Cloud.uid) {
        const del = document.createElement('button'); del.className = 'btn'; del.textContent = 'Delete';
        del.onclick = () => { GameAudio.click(); this.confirm(`Delete “${s.name}”?`, 'The server and everything built on it will be gone for everyone. This cannot be undone.', async () => {
          try { await Servers.remove(s); this.toast('Server deleted'); } catch (e) { this.toast(e.message); }
          this.show('servers');
        }, 'servers'); };
        row.appendChild(del);
      }
      box.appendChild(row);
    }
    if (Servers.fetchError) st.textContent = 'Only the official server is shown — the server list could not be loaded.';
    $('srvCreateBtn').disabled = cw === false;
    $('srvCreateBtn').title = cw === false ? 'Creating servers needs Contributor access to this game' : '';
    $('srvNote').textContent = cw === false
      ? 'You have view access: you can join any server, but creating one needs Contributor access. Your changes are saved while a player with edit access is online.'
      : 'Servers stay online for everyone. Whoever is playing keeps the world running.';
  },
  async joinServerUI(s, btn) {
    if (this.joining) return; this.joining = true;
    const st = $('srvStatus'); if (btn) btn.disabled = true;
    try { await Game.joinServer(s, t => st.textContent = `${s.name}: ${t}`); lockPointer(false); }
    catch (e) { st.textContent = e && e.message ? e.message : 'Could not join that server.'; if (btn) btn.disabled = false; }
    finally { this.joining = false; }
  },
  openNewServer() {
    if (!this.srvModeBuilt) {
      this.srvModeBuilt = true; this.newSrvMode = 'pvp';
      const seg = $('sMode');
      for (const m of ['pvp', 'survival', 'creative']) {
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = SERVER_MODES[m];
        b.onclick = () => { GameAudio.init(); GameAudio.click(); this.newSrvMode = m; this.refreshSrvMode(); };
        seg.appendChild(b);
      }
    }
    this.refreshSrvMode();
    $('sStatus').textContent = ''; $('srvMakeBtn').disabled = false;
    if (!$('sName').value) $('sName').value = (Profile.data ? Profile.data.name + '’s' : 'My') + ' Server';
    setTimeout(() => $('sName').select(), 60);
  },
  refreshSrvMode() {
    [...$('sMode').children].forEach((b, i) => b.classList.toggle('on', ['pvp', 'survival', 'creative'][i] === this.newSrvMode));
    $('sModeDesc').textContent = SERVER_MODE_DESC[this.newSrvMode];
  },
  async makeServer() {
    const st = $('sStatus'), btn = $('srvMakeBtn');
    if (btn.disabled) return; btn.disabled = true; st.textContent = 'Creating…';
    try {
      const srv = await Servers.create({ name: $('sName').value, desc: $('sDesc').value, mode: this.newSrvMode, seed: $('sSeed').value });
      $('sName').value = ''; $('sDesc').value = ''; $('sSeed').value = '';
      st.textContent = 'Starting your server…';
      await Game.joinServer(srv, t => st.textContent = t);
      lockPointer(false);
    } catch (e) { st.textContent = e && e.message ? e.message : 'Could not create the server.'; btn.disabled = false; }
  },

  /* ---------- parties ---------- */
  async joinFromInput() {
    const code = Net.norm($('joinCode').value), st = $('mpStatus');
    if (code.length !== 6) { st.textContent = 'Enter the 6-character code your friend gave you.'; return; }
    if (this.joining) return; this.joining = true;
    try { await Game.joinParty(code, s => st.textContent = s); lockPointer(false); }
    catch (e) { st.textContent = e && e.message ? e.message : 'Could not join that party.'; }
    finally { this.joining = false; }
  },
  partyOpened(code) {
    this.banner('Party open', `Code ${Net.pretty(code)} — share it with friends`);
    this.toast(Net.persist ? 'Friends who join will see everything you’ve built.' : 'Party saving is unavailable with your access, so late joiners won’t see earlier changes.');
    this.refreshPause(); this.partyChanged();
  },
  refreshPause() {
    const on = Net.active, srv = Game.server;
    $('partyInfo').style.display = on || srv ? 'block' : 'none';
    $('partyInfoLabel').textContent = srv ? (srv.official ? 'OFFICIAL SERVER' : 'SERVER · ' + SERVER_MODES[srv.mode].toUpperCase()) : 'PARTY CODE';
    $('partyCodeBig').textContent = srv ? srv.name : on ? Net.pretty(Net.code) : '';
    $('partyCodeBig').style.letterSpacing = srv ? '1px' : '';
    $('copyCodeBtn').style.display = srv ? 'none' : '';
    const pb = $('partyBtn');
    pb.style.display = (Net.available && Game.state === 'play' && !srv) ? '' : 'none';
    if (srv) {
      $('modeBtn').style.display = 'none';
      $('quitBtn').textContent = 'Leave Server';
      return;
    }
    pb.textContent = on ? (Net.isHost ? 'Close Party' : 'Leave Party (keep playing)') : 'Open to Party';
    $('modeBtn').style.display = on && !Net.isHost ? 'none' : '';
    $('quitBtn').textContent = on && !Net.isHost ? 'Leave Party & Quit' : (Game.worldId ? 'Save & Quit to Title' : 'Quit to Title');
  },
  leavePartyConfirm() {
    if (Net.isHost) {
      this.confirm('Close the party?', 'Everyone else will be disconnected. Your world stays saved.', async () => { await Net.leave(); this.show('pause'); }, 'pause');
    } else {
      this.confirm('Leave the party?', 'You can keep exploring a copy of this world on your own, and save it.', async () => {
        await Net.leave(); Game.worldId = newId(); Game.worldName = Game.worldName.replace(/ \(party\)$/, '') + ' (copy)'; this.show('pause');
      }, 'pause');
    }
  },
  copyCode() {
    const txt = Net.pretty(Net.code);
    try { navigator.clipboard.writeText(txt).then(() => this.toast('Code copied'), () => this.toast('Code: ' + txt)); }
    catch (e) { this.toast('Code: ' + txt); }
  },
  partyChanged() {
    const on = Net.active && this.hudOn;
    $('partyBox').classList.toggle('hidden', !on);
    if (on) {
      $('partyLabel').textContent = Net.server ? 'Server' : 'Party';
      $('partyCode').textContent = Net.server ? Net.server.name : Net.pretty(Net.code);
      const list = $('partyList'); list.innerHTML = '';
      for (const p of Net.players()) {
        const d = document.createElement('div'); if (p.you) d.className = 'you';
        d.textContent = (p.host ? '★ ' : '• ') + p.name + (p.you ? ' (you)' : '') + (Net.pvp ? `  ⚔${p.k} ☠${p.d}` : '');
        list.appendChild(d);
      }
    }
    if (this.cur === 'pause') this.refreshPause();
  },

  /* ---------- chat ---------- */
  chatLine(name, text, mine) {
    const log = $('chatLog');
    const d = document.createElement('div'); d.className = 'cl' + (name ? '' : ' sys');
    if (name) { const b = document.createElement('b'); b.textContent = name + ': '; d.appendChild(b); }
    d.appendChild(document.createTextNode(text));
    log.appendChild(d);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 9000); setTimeout(() => d.remove(), 10200);
  },
  openChat() {
    if (!Net.active || Game.ui) return;
    Game.ui = 'chat'; Input.keys = {}; Input.mouseL = Input.mouseR = false;
    const inp = $('chatInput'); inp.classList.remove('hidden'); inp.value = ''; setTimeout(() => inp.focus(), 0);
  },
  closeChat(send) {
    const inp = $('chatInput');
    if (send && inp.value.trim()) Net.chat(inp.value);
    inp.classList.add('hidden'); inp.blur();
    Game.ui = null;
    if (!Input.locked && !Input.noLock) lockPointer(true);
  },
  sleep(cb) {
    const f = $('fade'); f.style.transition = 'opacity 1.2s ease'; f.style.opacity = 1;
    Game.ui = 'sleep'; Input.keys = {};
    setTimeout(() => { cb(); this.banner('Good morning', 'You slept through the night.'); f.style.opacity = 0; setTimeout(() => { Game.ui = null; f.style.transition = ''; }, 900); }, 1600);
  },
  saveNote(t) {
    const n = $('saveNote'); n.textContent = t; n.style.opacity = 1;
    clearTimeout(this.saveNoteT); this.saveNoteT = setTimeout(() => n.style.opacity = 0, 2600);
  },
});
