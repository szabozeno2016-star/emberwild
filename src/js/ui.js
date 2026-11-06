/* =====================================================================
   UI: menus, logo, HUD, inventory & crafting, settings
   ===================================================================== */
const $ = id => document.getElementById(id);
const SCREENS = ['title', 'new', 'settings', 'credits', 'multi', 'help', 'quit', 'loading', 'pause', 'inv', 'death', 'resume', 'confirm', 'welcome', 'profile', 'worlds', 'servers', 'newserver'];
const LOAD_TIPS = [
  'Tip: hold the left mouse button on a tree to collect logs.',
  'Tip: torches keep Gloomlings from appearing nearby.',
  'Tip: stand near a Workbench to unlock tool recipes.',
  'Tip: Gloomlings burn away when the sun comes up.',
  'Tip: oak and birch leaves sometimes drop apples.',
  'Tip: sneak with Shift to stop at ledges.',
  'Tip: rare crystals glitter deep underground. Bring a stone pickaxe.',
];
const GLYPHS = {
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
};

const UI = {
  cur: null, tiles: [], icons: {}, hotEls: [], invEls: {}, lastInvVer: -1, lastSel: -1, lastHearts: '', lastFood: '', lastBub: '',
  nameT: 0, tab: 'All', hoverSlot: null, fxParts: [], hudOn: false, cfCb: null, lockFails: 0,

  init(atlas) {
    // tile canvases
    for (let l = 0; l < TEX_WHITE; l++) {
      const c = document.createElement('canvas'); c.width = c.height = 16;
      c.getContext('2d').drawImage(atlas, (l % ATLAS.cols) * 16, ((l / ATLAS.cols) | 0) * 16, 16, 16, 0, 0, 16, 16);
      this.tiles[l] = c;
    }
    const big = (name, scale, dark) => {
      const c = document.createElement('canvas'); c.width = c.height = 16 * scale; const g = c.getContext('2d');
      g.imageSmoothingEnabled = false; g.drawImage(this.tiles[TEX[name]], 0, 0, 16 * scale, 16 * scale);
      if (dark) { g.fillStyle = `rgba(0,0,0,${dark})`; g.fillRect(0, 0, c.width, c.height); }
      return `url(${c.toDataURL()})`;
    };
    const root = document.documentElement.style;
    root.setProperty('--stone', big('stone', 4));
    root.setProperty('--planks', big('oak_planks', 4));
    root.setProperty('--dark', big('basalt', 4));
    const ac = document.createElement('canvas'); ac.width = atlas.width; ac.height = atlas.height;
    ac.getContext('2d').drawImage(atlas, 0, 0);
    root.setProperty('--atlas', `url(${ac.toDataURL()})`);
    // item icons
    for (const it of ITEMS) if (it) this.icons[it.id] = this.makeIcon(it);
    this.buildLogo();
    this.buildHUD();
    this.buildInventory();
    this.buildSettings();
    this.buildNewWorld();
    this.bindButtons();
    this.applySettings();
    // fx canvas
    this.fx = $('fx'); this.fxg = this.fx.getContext('2d');
  },
  makeIcon(it) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    if (it.iso) {
      const ft = FACE_TEX[it.block];
      const shade = (layer, f) => {
        const t = document.createElement('canvas'); t.width = t.height = 16; const tg = t.getContext('2d');
        tg.drawImage(this.tiles[layer], 0, 0);
        if (f < 1) { tg.globalCompositeOperation = 'source-atop'; tg.fillStyle = `rgba(0,0,0,${1 - f})`; tg.fillRect(0, 0, 16, 16); }
        return t;
      };
      const S = 28 / 16, Hh = 14 / 16;
      g.setTransform(S, Hh, -S, Hh, 32, 4); g.drawImage(shade(ft[2], 1), 0, 0); g.drawImage(shade(ft[2], 1), 0.02, 0.02);
      g.setTransform(S, Hh, 0, S, 4, 18); g.drawImage(shade(ft[4], 0.78), 0, 0);
      g.setTransform(S, -Hh, 0, S, 32, 32); g.drawImage(shade(ft[0], 0.6), 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      const layer = it.block ? FACE_TEX[it.block][0] : TEX[it.icon];
      g.drawImage(this.tiles[layer], 0, 0, 64, 64);
    }
    return c.toDataURL();
  },

  /* ---------- logo ---------- */
  buildLogo() {
    const word = 'EMBERWILD', cell = 14, depth = 9, pad = 10;
    let cols = 0; const pos = [];
    for (const ch of word) { pos.push(cols); cols += GLYPHS[ch][0].length + 1; }
    cols -= 1;
    const W = cols * cell + pad * 2, Hc = 7 * cell + pad * 2 + depth + 6;
    const cv = $('logo'); cv.width = W; cv.height = Hc;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    const grid = []; for (let y = 0; y < 7; y++) grid.push(new Array(cols).fill(0));
    [...word].forEach((ch, k) => GLYPHS[ch].forEach((row, y) => [...row].forEach((v, x) => { if (v === '#') grid[y][pos[k] + x] = 1; })));
    const at = (x, y) => y >= 0 && y < 7 && x >= 0 && x < cols && grid[y][x];
    const X = x => pad + x * cell, Y = y => pad + y * cell;
    // outline + extrusion
    for (let d = depth + 3; d >= 0; d--) for (let y = 0; y < 7; y++) for (let x = 0; x < cols; x++) {
      if (!at(x, y)) continue;
      if (d > depth) { g.fillStyle = '#0a0706'; g.fillRect(X(x) - 3, Y(y) - 3 + Math.min(d, depth), cell + 6, cell + 6); }
      else if (d > 0) { const k = d / depth; g.fillStyle = `rgb(${54 - k * 26},${48 - k * 24},${46 - k * 22})`; g.fillRect(X(x), Y(y) + d, cell, cell); }
    }
    // faces with continuous stone texture
    const face = document.createElement('canvas'); face.width = W; face.height = Hc; const fg = face.getContext('2d'); fg.imageSmoothingEnabled = false;
    const stone = this.tiles[TEX.stone], grass = this.tiles[TEX.grass_side];
    for (let y = 0; y < 7; y++) for (let x = 0; x < cols; x++) {
      if (!at(x, y)) continue;
      fg.drawImage(stone, (x * 7) % 9, (y * 7) % 9, 7, 7, X(x), Y(y), cell, cell);
    }
    // warm sunset gradient on the faces
    fg.globalCompositeOperation = 'source-atop';
    const grd = fg.createLinearGradient(0, pad, 0, pad + 7 * cell);
    grd.addColorStop(0, 'rgba(255,240,220,0.10)'); grd.addColorStop(0.55, 'rgba(255,170,90,0.10)'); grd.addColorStop(1, 'rgba(255,110,40,0.32)');
    fg.fillStyle = grd; fg.fillRect(0, 0, W, Hc);
    fg.globalCompositeOperation = 'source-over';
    // bevels
    for (let y = 0; y < 7; y++) for (let x = 0; x < cols; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) { fg.fillStyle = 'rgba(255,255,255,.35)'; fg.fillRect(X(x), Y(y), cell, 2); }
      if (!at(x - 1, y)) { fg.fillStyle = 'rgba(255,255,255,.18)'; fg.fillRect(X(x), Y(y), 2, cell); }
      if (!at(x, y + 1)) { fg.fillStyle = 'rgba(0,0,0,.35)'; fg.fillRect(X(x), Y(y) + cell - 2, cell, 2); }
      if (!at(x + 1, y)) { fg.fillStyle = 'rgba(0,0,0,.25)'; fg.fillRect(X(x) + cell - 2, Y(y), 2, cell); }
    }
    // grass caps with drips
    for (let y = 0; y < 7; y++) for (let x = 0; x < cols; x++) {
      if (!at(x, y) || y > 0) continue;
      fg.drawImage(grass, (x * 7) % 9, 0, 7, 3, X(x), Y(y) - 1, cell, 7);
      fg.fillStyle = 'rgba(190,255,140,.35)'; fg.fillRect(X(x), Y(y) - 1, cell, 2);
    }
    g.drawImage(face, 0, 0);
  },

  /* ---------- screens ---------- */
  show(name) {
    for (const s of SCREENS) { const el = $('sc-' + s); if (el) el.classList.toggle('show', s === name); }
    this.cur = name;
    const menu = Game.state === 'menu';
    $('menuShade').classList.toggle('on', menu && ['title', 'new', 'settings', 'credits', 'multi', 'help', 'welcome', 'worlds', 'servers', 'newserver'].includes(name));
    $('profileChip').classList.toggle('hidden', !(menu && name === 'title' && Profile.exists));
    if (name === 'profile') this.openProfile();
    if (name === 'worlds') this.refreshWorlds();
    if (name === 'servers') this.refreshServers();
    if (name === 'newserver') this.openNewServer();
    if (name === 'multi') { $('mpOff').classList.toggle('hidden', Net.available); $('mpOn').classList.toggle('hidden', !Net.available); $('mpStatus').textContent = ''; }
    $('fx').style.opacity = menu && name !== 'quit' ? 1 : 0;
    if (name === 'credits') { const r = document.querySelector('.credits .roll'); r.style.animation = 'none'; void r.offsetWidth; r.style.animation = ''; }
    if (name === 'loading') { $('loadBar').style.width = '0%'; $('loadTip').textContent = LOAD_TIPS[(Math.random() * LOAD_TIPS.length) | 0]; }
    if (name === 'pause') {
      $('pauseInfo').textContent = `${Game.worldName} · Day ${Game.day} · Seed ${Game.seedLabel}`;
      $('modeBtn').textContent = 'Game Mode: ' + (Game.creative ? 'Creative' : 'Survival');
      this.refreshPause();
    }
    if (name === 'settings') this.refreshSettings();
    if (name === 'title') { this.setHUD(false); if (GameAudio.mode !== 'menu') GameAudio.setMode('menu'); this.refreshContinue(); }
  },
  back() {
    if (Game.state === 'play') { this.show('pause'); return; }
    this.show('title');
  },
  fadeIn() { const f = $('fade'); f.style.transition = 'none'; f.style.opacity = 1; void f.offsetWidth; f.style.transition = ''; f.style.opacity = 0; },
  setHUD(on) { this.hudOn = on; $('hud').classList.toggle('hidden', !on); $('vignette').classList.toggle('on', on); },
  bindButtons() {
    document.querySelectorAll('[data-act]').forEach(b => {
      b.addEventListener('click', e => {
        GameAudio.init(); GameAudio.click();
        const r = b.getBoundingClientRect();
        b.style.setProperty('--rx', (e.clientX - r.left) + 'px'); b.style.setProperty('--ry', (e.clientY - r.top) + 'px');
        b.classList.remove('ripple'); void b.offsetWidth; b.classList.add('ripple');
        this.act(b.dataset.act);
      });
      b.addEventListener('mouseenter', () => { if (GameAudio.ready) GameAudio.hover(); });
    });
    $('cfNo').onclick = () => { GameAudio.click(); this.show(this.cfBack || 'pause'); };
    $('cfYes').onclick = () => { GameAudio.click(); const cb = this.cfCb; this.cfCb = null; cb && cb(); };
    $('sc-resume').addEventListener('mousedown', e => { e.preventDefault(); GameAudio.init(); lockPointer(true); });
    $('sc-inv').addEventListener('mousedown', e => {
      if (e.target === $('sc-inv') && Game.cursor) { // click outside panels drops the held stack
        const st = Game.cursor; Game.cursor = null; throwStack(st, e.button === 2 ? 1 : st.n);
        this.refreshCursor();
      }
    });
  },
  act(a) {
    switch (a) {
      case 'single': if (!this.needProfile()) { this.worldsHost = false; this.show('worlds'); } break;
      case 'continue': if (this.lastWorld) { Saves.load(this.lastWorld.id).then(d => { if (d) { this.worldsHost = false; Game.loadWorld(d); lockPointer(false); } else this.toast('That world could not be loaded.'); }); } break;
      case 'newWorld': this.show('new'); setTimeout(() => $('wName').select(), 50); break;
      case 'multi': if (!this.needProfile()) this.show('multi'); break;
      case 'servers': if (!this.needProfile()) this.show('servers'); break;
      case 'srvRefresh': this.refreshServers(); break;
      case 'srvCreate': this.show('newserver'); break;
      case 'srvMake': this.makeServer(); break;
      case 'mpHost': this.worldsHost = true; this.show('worlds'); break;
      case 'mpJoin': this.joinFromInput(); break;
      case 'wCreate': this.profileMode = 'create'; this.show('profile'); break;
      case 'wGuest': Profile.guest(); this.refreshChip(); this.show('title'); this.toast(`Playing as ${Profile.data.name}`); break;
      case 'profile': this.profileMode = 'edit'; this.show('profile'); break;
      case 'profSave': this.saveProfile(); break;
      case 'profCancel': if (this.profileMode === 'create' && !Profile.exists) this.show('welcome'); else this.back(); break;
      case 'profAlt': this.profileAlt(); break;
      case 'party': if (Net.active) this.leavePartyConfirm(); else Game.openParty().then(() => this.refreshPause()); break;
      case 'copyCode': this.copyCode(); break;
      case 'settings': this.show('settings'); break;
      case 'credits': this.show('credits'); break;
      case 'help': this.show('help'); break;
      case 'back': this.back(); break;
      case 'quit': this.show('quit'); break;
      case 'toTitle': this.show('title'); break;
      case 'music': {
        if (Settings.music > 0) { this.savedMusic = Settings.music; Settings.music = 0; } else Settings.music = this.savedMusic || 45;
        saveSettings(); GameAudio.applyVolumes(); this.applySettings(); this.toastMenu(Settings.music ? 'Music on' : 'Music off');
        break;
      }
      case 'create': {
        const name = $('wName').value.trim() || 'New World';
        Game.newWorld(name, $('wSeed').value.trim(), this.newDiff, this.newMode);
        if (this.worldsHost) Game.pendingHost = true;
        lockPointer(false);
        break;
      }
      case 'resume': this.resume(); break;
      case 'quitWorld':
        if (Game.server) this.confirm(`Leave ${Game.server.name}?`, 'Your character, items and score on this server are kept for next time. The world stays online for everyone else.', () => { Game.quitToTitle(); this.fadeIn(); }, Game.player && Game.player.alive ? 'pause' : 'death');
        else if (Net.active && !Net.isHost) this.confirm('Leave the party?', 'You will return to the title screen. The party world belongs to the host, so it is not saved for you.', () => { Game.quitToTitle(); this.fadeIn(); }, Game.player && Game.player.alive ? 'pause' : 'death');
        else if (!Game.worldId) this.confirm('Quit to title?', 'This party copy has not been saved.', () => { Game.quitToTitle(); this.fadeIn(); }, 'pause');
        else { Game.quitToTitle().then(() => this.fadeIn()); }
        break;
      case 'respawn': Game.respawn(); break;
      case 'toggleMode':
        Game.setMode(Game.creative ? 'survival' : 'creative');
        $('modeBtn').textContent = 'Game Mode: ' + (Game.creative ? 'Creative' : 'Survival');
        this.toast(Game.creative ? 'Creative mode — double-tap Space to fly' : 'Survival mode');
        break;
      case 'resetSettings': Object.assign(Settings, DEFAULT_SETTINGS); saveSettings(); this.applySettings(); this.refreshSettings(); break;
    }
    $('musicBtn').style.opacity = Settings.music > 0 ? 1 : 0.45;
  },
  toastMenu(t) { this.toast(t); },
  zoneTag(on) { $('zoneTag').classList.toggle('hidden', !on); },
  confirm(title, text, cb, backTo) { $('cfTitle').textContent = title; $('cfText').textContent = text; this.cfCb = cb; this.cfBack = backTo; this.show('confirm'); },

  /* ---------- new world ---------- */
  buildNewWorld() {
    const mseg = $('wMode'); this.newMode = 'survival';
    const mdesc = { survival: 'Gather, craft and survive the nights. Health, hunger and Gloomlings.', creative: 'Unlimited blocks, flying and instant breaking. Build anything you can imagine.' };
    for (const m of ['survival', 'creative']) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = m === 'survival' ? 'Survival' : 'Creative';
      b.onclick = () => { GameAudio.init(); GameAudio.click(); this.newMode = m; updM(); };
      mseg.appendChild(b);
    }
    const updM = () => {
      [...mseg.children].forEach((b, i) => b.classList.toggle('on', ['survival', 'creative'][i] === this.newMode));
      $('modeDesc').textContent = mdesc[this.newMode];
      $('diffField').style.display = $('diffDesc').style.display = this.newMode === 'creative' ? 'none' : '';
    };
    updM();
    const seg = $('wDiff'); this.newDiff = Settings.difficulty;
    const desc = ['No creatures, no hunger. Pure building and exploring.', 'Gentle nights: fewer Gloomlings, softer hits. Hunger stops at half health.', 'The intended experience: hungry days and dangerous nights.', 'Fierce nights and starvation can be fatal.'];
    DIFFICULTY.forEach((d, i) => {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = d;
      b.onclick = () => { GameAudio.init(); GameAudio.click(); this.newDiff = i; upd(); };
      seg.appendChild(b);
    });
    const upd = () => { [...seg.children].forEach((b, i) => b.classList.toggle('on', i === this.newDiff)); $('diffDesc').textContent = desc[this.newDiff]; };
    upd();
    $('wName').addEventListener('keydown', e => { if (e.key === 'Enter') this.act('create'); e.stopPropagation(); });
    $('wSeed').addEventListener('keydown', e => { if (e.key === 'Enter') this.act('create'); e.stopPropagation(); });
  },

  /* ---------- settings ---------- */
  setDefs: [
    { sec: 'Video' },
    { k: 'graphics', label: 'Graphics', seg: GFX_NAMES, hints: [
      'Potato — 3-chunk view, half resolution, no clouds, solid leaves, still plants. For very old machines.',
      'Bad — 4 chunks at 70% resolution, no clouds, solid leaves and few particles.',
      'Medium — 6 chunks, clouds, swaying plants and see-through leaves.',
      'Normal — 8 chunks at full resolution with shimmering, reflective water.',
      'Good — 11 chunks, sharp HiDPI rendering, crisp texture filtering, soft bloom and richer colour.',
      'Heavenly — 15 chunks, supersampled, strong bloom, sun & moon rays and a cinematic grade. Needs a strong GPU.'] },
    { k: 'renderDist', label: 'Render distance', min: 2, max: 16, step: 1, fmt: v => v + ' chunks' },
    { k: 'fov', label: 'Field of view', min: 50, max: 110, step: 1, fmt: v => v + '°' },
    { k: 'quality', label: 'Resolution', cycle: QUALITY },
    { k: 'guiScale', label: 'Interface size', cycle: ['Small', 'Normal', 'Large'], values: [1.5, 2, 2.5] },
    { k: 'clouds', label: 'Clouds', toggle: true },
    { k: 'weather', label: 'Weather (rain & storms)', toggle: true },
    { k: 'particles', label: 'Particles', cycle: ['Minimal', 'Low', 'Some', 'Full', 'Lots', 'Max'], values: [0.15, 0.4, 0.65, 1, 1.25, 1.6] },
    { k: 'autoRes', label: 'Auto resolution (smoother)', toggle: true },
    { k: 'bobbing', label: 'View bobbing', toggle: true },
    { sec: 'Controls & Audio' },
    { k: 'sens', label: 'Mouse sensitivity', min: 10, max: 250, step: 5, fmt: v => v + '%' },
    { k: 'invertY', label: 'Invert mouse Y', toggle: true },
    { k: 'master', label: 'Master volume', min: 0, max: 100, step: 1, fmt: v => v + '%' },
    { k: 'music', label: 'Music', min: 0, max: 100, step: 1, fmt: v => v + '%' },
    { k: 'sfx', label: 'Sound effects', min: 0, max: 100, step: 1, fmt: v => v + '%' },
    { k: 'ambient', label: 'Ambience', min: 0, max: 100, step: 1, fmt: v => v + '%' },
    { k: 'showFps', label: 'Show FPS', toggle: true },
    { sec: 'Gameplay' },
    { k: 'difficulty', label: 'Difficulty', cycle: DIFFICULTY },
  ],
  buildSettings() {
    const grid = $('setGrid'); grid.innerHTML = ''; this.setEls = {};
    for (const d of this.setDefs) {
      if (d.sec) { const h = document.createElement('div'); h.className = 'sechead'; h.textContent = d.sec; grid.appendChild(h); continue; }
      const w = document.createElement('div'); w.className = 'set';
      if (d.seg) {
        w.className = 'set wide';
        w.innerHTML = `<div class="lab"><span>${d.label}</span><b></b></div><div class="gfxseg"></div><div class="gfxhint"></div>`;
        const seg = w.querySelector('.gfxseg'), b = w.querySelector('b'), hint = w.querySelector('.gfxhint');
        const btns = d.seg.map((name, i) => {
          const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = name;
          btn.addEventListener('click', () => {
            GameAudio.init(); GameAudio.click();
            applyGraphicsPreset(i); saveSettings(); this.applySettings(); this.refreshSettings();
            if (Game.state === 'play') this.toast('Graphics: ' + name);
          });
          seg.appendChild(btn); return btn;
        });
        this.setEls[d.k] = () => {
          const lv = Settings.graphics | 0, pr = GFX_PRESETS[lv];
          btns.forEach((x, i) => x.classList.toggle('on', i === lv));
          b.textContent = Object.keys(pr).every(k => Settings[k] === pr[k]) ? '' : 'customised';
          hint.textContent = d.hints[lv];
        };
        grid.appendChild(w); continue;
      }
      if (d.min !== undefined) {
        w.innerHTML = `<div class="lab"><span>${d.label}</span><b></b></div><input type="range" min="${d.min}" max="${d.max}" step="${d.step}">`;
        const inp = w.querySelector('input'), b = w.querySelector('b');
        inp.addEventListener('input', () => { Settings[d.k] = +inp.value; b.textContent = d.fmt(+inp.value); this.applySettings(); });
        inp.addEventListener('change', () => { saveSettings(); GameAudio.init(); GameAudio.click(); if (this.setEls.graphics) this.setEls.graphics(); });
        this.setEls[d.k] = () => { inp.value = Settings[d.k]; b.textContent = d.fmt(Settings[d.k]); };
      } else {
        w.innerHTML = `<div class="lab"><span>${d.label}</span></div><button class="btn"></button>`;
        const btn = w.querySelector('button');
        btn.addEventListener('click', () => {
          GameAudio.init(); GameAudio.click();
          if (d.toggle) Settings[d.k] = !Settings[d.k];
          else if (d.values) { const i = d.values.indexOf(Settings[d.k]); Settings[d.k] = d.values[(i + 1) % d.values.length]; }
          else Settings[d.k] = (Settings[d.k] + 1) % d.cycle.length;
          saveSettings(); this.applySettings(); this.refreshSettings();
        });
        this.setEls[d.k] = () => {
          btn.textContent = d.toggle ? (Settings[d.k] ? 'On' : 'Off') : d.values ? d.cycle[Math.max(0, d.values.indexOf(Settings[d.k]))] : d.cycle[Settings[d.k]];
        };
      }
      grid.appendChild(w);
    }
  },
  refreshSettings() { for (const k in this.setEls) this.setEls[k](); },
  applySettings() {
    document.documentElement.style.setProperty('--gs', Settings.guiScale);
    GameAudio.applyVolumes();
    $('fpsBox').classList.toggle('hidden', !Settings.showFps || !!Game.debug);
    resize();
    if (typeof setAniso === 'function') setAniso(GFX.aniso);
    this.lastHearts = this.lastFood = ''; this.lastInvVer = -1; this.lastArmor = -1;
    $('musicBtn').style.opacity = Settings.music > 0 ? 1 : 0.45;
  },

  /* ---------- HUD ---------- */
  buildHUD() {
    const hb = $('hotbar');
    for (let i = 0; i < 9; i++) { const s = document.createElement('div'); s.className = 'slot'; hb.appendChild(s); this.hotEls.push(s); }
    const mk = (parent, n) => { const out = []; for (let i = 0; i < n; i++) { const d = document.createElement('div'); d.className = 'ico'; d.innerHTML = '<i></i><i></i>'; parent.appendChild(d); out.push(d); } return out; };
    this.heartEls = mk($('hearts'), 10); this.foodEls = mk($('food'), 10); this.bubEls = mk($('bubbles'), 10); this.armorEls = mk($('armorRow'), 10);
  },
  iconPos(el, name) {
    if (!name) { el.style.display = 'none'; return; }
    el.style.display = '';
    const l = TEX[name], gs = Settings.guiScale;
    el.style.backgroundPosition = `${-(l % ATLAS.cols) * 16 * gs}px ${-((l / ATLAS.cols) | 0) * 16 * gs}px`;
  },
  slotHTML(st) {
    if (!st) return '';
    let h = `<img src="${this.icons[st.id]}">`;
    if (st.n > 1) h += `<span class="n">${st.n}</span>`;
    const def = ITEMS[st.id];
    const mx = def.tool ? def.tool.dur : def.armor ? def.armor.dur : 0;
    if (mx && st.d !== undefined && st.d < mx) {
      const f = st.d / mx;
      h += `<div class="dur"><i style="width:${f * 100}%;background:hsl(${f * 120},90%,50%)"></i></div>`;
    }
    return h;
  },
  enterGame() {
    Game.ui = null; Game.paused = false;
    this.show(null);
    this.setHUD(true);
    $('crosshair').style.display = '';
    this.partyChanged();
    this.fadeIn();
    if (!Input.locked && !Input.noLock) lockPointer(false);
  },
  updateHUD(dt) {
    if (!this.hudOn) return;
    const P = Game.player, inv = Game.inv;
    $('hud').style.visibility = Game.hideHud ? 'hidden' : 'visible';
    $('bars').style.visibility = Game.creative ? 'hidden' : 'visible';
    if (inv.ver !== this.lastInvVer || inv.sel !== this.lastSel) {
      if (inv.sel !== this.lastSel && inv.held) { $('itemName').textContent = ITEMS[inv.held.id].name; this.nameT = 2.2; }
      this.lastInvVer = inv.ver; this.lastSel = inv.sel;
      this.hotEls.forEach((el, i) => { el.innerHTML = this.slotHTML(inv.s[i]) + `<span class="key">${i + 1}</span>`; el.classList.toggle('sel', i === inv.sel); });
      if (this.cur === 'inv') this.refreshInventory();
    }
    this.nameT -= dt; $('itemName').style.opacity = this.nameT > 0 ? Math.min(1, this.nameT * 2) : 0;
    const showBars = Settings.difficulty > 0 || true;
    const hp = Math.max(0, Math.ceil(P.health)), hu = Math.ceil(P.hunger);
    const hk = hp + ':' + (P.invuln > 0.3 ? 1 : 0);
    if (hk !== this.lastHearts) {
      this.lastHearts = hk;
      this.heartEls.forEach((el, i) => {
        const [bg, fg] = el.children;
        this.iconPos(bg, 'heart_empty');
        this.iconPos(fg, hp >= (i + 1) * 2 ? 'heart_full' : hp === i * 2 + 1 ? 'heart_half' : null);
      });
      $('hearts').classList.toggle('low', hp <= 4);
    }
    if (String(hu) !== this.lastFood) {
      this.lastFood = String(hu);
      this.foodEls.forEach((el, i) => {
        const [bg, fg] = el.children;
        this.iconPos(bg, 'food_empty');
        this.iconPos(fg, hu >= (i + 1) * 2 ? 'food_full' : hu === i * 2 + 1 ? 'food_half' : null);
      });
    }
    const ap = inv.armorPoints;
    if (ap !== this.lastArmor) {
      this.lastArmor = ap;
      this.armorEls.forEach((el, i) => { const [bg, fg] = el.children; this.iconPos(bg, 'armor_empty'); this.iconPos(fg, ap >= (i + 1) * 2 ? 'armor_full' : ap === i * 2 + 1 ? 'armor_half' : null); });
      $('armorRow').style.visibility = ap > 0 ? 'visible' : 'hidden';
    }
    if (this.furnace && this.cur === 'inv') {
      const f = this.furnace;
      $('flameFill').style.height = (f.burn > 0 ? Math.min(100, f.burn / (f.burnMax || 1) * 100) : 0) + '%';
      $('arrowFill').style.width = Math.round(f.prog * 100) + '%';
      $('furnState').textContent = f.burn > 0 ? 'Burning' : (f.s[0] && !f.s[1] ? 'Needs fuel' : '');
    }
    const bub = P.headInWater || P.air < 15 ? Math.ceil(Math.max(0, P.air) / 1.5) : -1;
    if (String(bub) !== this.lastBub) {
      this.lastBub = String(bub);
      this.bubEls.forEach((el, i) => { const [bg, fg] = el.children; this.iconPos(bg, null); this.iconPos(fg, i < bub ? 'bubble' : null); el.style.display = bub < 0 ? 'none' : ''; });
    }
    $('eatBar').style.opacity = P.eatT > 0 ? 1 : 0; $('eatBar').firstChild.style.width = Math.min(100, P.eatT / 1.4 * 100) + '%';
    $('water').style.opacity = P.headInWater ? 1 : 0;
    if (Game.debug) {
      const f = this.facing(P.yaw);
      const col = Game.world.column(Math.floor(P.pos[0]), Math.floor(P.pos[2]));
      const biome = col.h > SEA + 18 ? 'Highlands' : col.forest > 0.28 ? 'Deep forest' : col.forest > 0.05 ? 'Woodland' : col.h <= SEA + 1 ? 'Shore' : 'Meadow';
      const tod = Game.time % 1, hrs = (tod * 24 + 6) % 24;
      $('debug').textContent = `Emberwild v0.1  ${Game.fps} fps  ${Game.creative ? 'Creative' + (P.flying ? ' (flying)' : '') : 'Survival'}\nXYZ ${P.pos[0].toFixed(2)} ${P.pos[1].toFixed(2)} ${P.pos[2].toFixed(2)}\nChunk ${Math.floor(P.pos[0]) >> 4}, ${Math.floor(P.pos[2]) >> 4}   Facing ${f}\nBiome ${biome}\nDay ${Game.day}  ${String(Math.floor(hrs)).padStart(2, '0')}:${String(Math.floor((hrs % 1) * 60)).padStart(2, '0')}\nChunks ${Game.world.chunks.size} loaded, ${Game.drawStats ? Game.drawStats.drawn : 0} drawn\nQuads ${Game.drawStats ? Game.drawStats.quads : 0}\nCreatures ${Mobs.list.length}  Drops ${Drops.list.length}\nHunger ${P.hunger} Sat ${P.sat.toFixed(1)} Exh ${P.exh.toFixed(2)}`;
    } else if (Settings.showFps) $('fpsBox').textContent = Game.fps + ' fps';
  },
  facing(yaw) {
    const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return ['North (-Z)', 'East (+X)', 'South (+Z)', 'West (-X)'][Math.round(a / (Math.PI / 2)) % 4];
  },
  toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast' + (kind ? ' ' + kind : ''); t.textContent = msg;
    const box = $('toasts'); box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.remove(), 3400);
    if (Game.state !== 'play') { box.parentElement.classList.remove('hidden'); }
  },
  banner(title, sub) {
    const b = $('banner'); b.querySelector('.bt').textContent = title; b.querySelector('.bs').textContent = sub || '';
    b.classList.add('show'); clearTimeout(this.bannerT); this.bannerT = setTimeout(() => b.classList.remove('show'), 3800);
  },
  pickupNote(id, n) {
    const box = $('pickups');
    const last = box.lastElementChild;
    if (last && last.dataset.id == id && performance.now() - last.dataset.t < 1500) {
      const c = +last.dataset.n + n; last.dataset.n = c; last.dataset.t = performance.now(); last.querySelector('span').textContent = `+${c} ${ITEMS[id].name}`;
      last.style.animation = 'none'; void last.offsetWidth; last.style.animation = '';
      return;
    }
    const d = document.createElement('div'); d.className = 'pk'; d.dataset.id = id; d.dataset.n = n; d.dataset.t = performance.now();
    d.innerHTML = `<img src="${this.icons[id]}"><span>+${n} ${ITEMS[id].name}</span>`;
    box.appendChild(d); while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => d.remove(), 2800);
  },
  hurtFlash() { const h = $('hurt'); h.style.transition = 'none'; h.style.opacity = 1; void h.offsetWidth; h.style.transition = ''; h.style.opacity = 0; },
  loadingProgress(p) { $('loadBar').style.width = Math.round(p * 100) + '%'; },
  showDeath(msg) {
    Game.ui = 'death';
    $('deathMsg').textContent = msg;
    $('crosshair').style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(() => this.show('death'), 600);
  },
  openPause() {
    if (Game.state !== 'play' || Game.ui) return;
    Game.paused = true; this.show('pause');
    Input.mouseL = Input.mouseR = false; Input.keys = {};
  },
  resume() {
    Game.paused = false; Game.ui = null; this.show(null);
    lockPointer(true);
  },

  /* ---------- inventory ---------- */
  buildInventory() {
    const mk = (parent, idx) => {
      const s = document.createElement('div'); s.className = 'slot';
      s.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.slotClick(idx, e.button, e.shiftKey); });
      s.addEventListener('mouseenter', () => { this.hoverSlot = idx; this.showTip(this.getS(idx)); });
      s.addEventListener('mouseleave', () => { this.hoverSlot = null; this.hideTip(); });
      s.addEventListener('contextmenu', e => e.preventDefault());
      parent.appendChild(s); this.invEls[idx] = s;
    };
    for (let i = 9; i < 36; i++) mk($('invMain'), i);
    for (let i = 0; i < 9; i++) mk($('invHot'), i);
    for (let i = 0; i < 4; i++) mk($('armorSlots'), 200 + i);
    mk($('fIn'), 300); mk($('fFuel'), 301); mk($('fOut'), 302);
    const ph = ['hide_helm', 'hide_chest', 'hide_legs', 'hide_boots'];
    this.armorPH = ph.map(n => { const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').drawImage(this.tiles[TEX[n]], 0, 0); return c.toDataURL(); });
    const sl = $('smeltList');
    for (const [a, b] of [[B.COBBLE, B.STONE], [B.SAND, B.GLASS], [I.SUNVEIN, I.SUNVEIN_INGOT], [I.RAW_HAUNCH, I.ROAST_HAUNCH], [B.OAK_LOG, I.CHARCOAL], [B.MOSSY, B.COBBLE]]) {
      const sp = document.createElement('span'); sp.innerHTML = `<img src="${this.icons[a]}">→<img src="${this.icons[b]}">`;
      sp.appendChild(document.createTextNode(' ' + ITEMS[b].name)); sl.appendChild(sp);
    }
    const ct = $('catTabs'); this.catTab = 'All';
    for (const t of ['All', 'Building', 'Nature', 'Ores', 'Items']) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = t;
      b.onclick = () => { GameAudio.click(); this.catTab = t; this.refreshCatalog(); };
      ct.appendChild(b);
    }
    $('catPanel').addEventListener('mousedown', e => {
      if (Game.cursor && !e.target.closest('.tabs')) { Game.cursor = null; this.refreshCursor(); GameAudio.tone({ freq: 300, to: 120, gain: 0.1, decay: 0.1 }); }
    });
    const tabs = $('tabs');
    for (const t of ['All', 'Basics', 'Tools', 'Armour', 'Building']) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = t;
      b.onclick = () => { GameAudio.click(); this.tab = t; this.refreshRecipes(); };
      tabs.appendChild(b);
    }
    document.addEventListener('mousemove', e => {
      const c = $('cursorStack'); c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px';
      const tt = $('tooltip'); tt.style.left = (e.clientX + 16) + 'px'; tt.style.top = (e.clientY + 12) + 'px';
    });
  },
  openInventory(furnace) {
    if (Game.state !== 'play' || !Game.player.alive) return;
    this.furnace = furnace || null;
    $('furnPanel').classList.toggle('hidden', !this.furnace);
    Game.ui = 'inv'; Input.mouseL = Input.mouseR = false; Input.keys = {};
    Game.benchNear = Game.scanBench();
    $('craftPanel').classList.toggle('hidden', Game.creative || !!this.furnace);
    $('catPanel').classList.toggle('hidden', !Game.creative || !!this.furnace);
    if (Game.creative) this.refreshCatalog();
    this.show('inv'); this.refreshInventory();
    if (document.pointerLockElement) document.exitPointerLock();
  },
  closeInventory() {
    if (Game.cursor) { const left = Game.inv.add(Game.cursor.id, Game.cursor.n, Game.cursor.d); if (left) throwStack({ ...Game.cursor, n: left }, left); Game.cursor = null; }
    this.refreshCursor(); this.hideTip(); this.furnace = null;
    Game.ui = null; this.show(null);
    lockPointer(true);
  },
  refreshInventory() {
    const inv = Game.inv;
    for (let i = 0; i < 36; i++) this.invEls[i].innerHTML = this.slotHTML(inv.s[i]);
    for (let s = 0; s < 4; s++) this.invEls[200 + s].innerHTML = inv.armor[s] ? this.slotHTML(inv.armor[s]) : `<img class="ph" src="${this.armorPH[s]}">`;
    if (this.furnace) for (let k = 0; k < 3; k++) this.invEls[300 + k].innerHTML = this.slotHTML(this.furnace.s[k]);
    const fg = $('invFig').getContext('2d'); fg.imageSmoothingEnabled = false; fg.clearRect(0, 0, 64, 128);
    if (Profile.data) fg.drawImage(Skins.figure(Profile.data.skin, 2), 0, 0);
    const P = Game.player, S = Game.stats, tod = Game.time % 1;
    const phase = tod < 0.04 ? 'Dawn' : tod < 0.45 ? 'Day' : tod < 0.52 ? 'Dusk' : tod < 0.96 ? 'Night' : 'Dawn';
    $('invStats').innerHTML = `<span>World <b>${Game.worldName}</b> · ${Game.creative ? 'Creative' : 'Survival'}</span><span>Day <b>${Game.day}</b> · ${phase}</span>
      ${Game.creative ? '' : `<span>Health <b>${Math.ceil(P.health)}/20</b></span><span>Hunger <b>${Math.ceil(P.hunger)}/20</b></span>`}
      <span>Armour <b>${inv.armorPoints}</b> · ${Math.round(Math.min(0.8, inv.armorPoints * 0.04) * 100)}% less damage</span>
      <span>Blocks mined <b>${S.mined}</b></span><span>Creatures defeated <b>${S.kills}</b></span>
      <div class="full">Shift-click armour to wear it. Right-click splits a stack.</div>`;
    this.refreshRecipes(); this.refreshCursor();
  },
  refreshCursor() {
    const c = $('cursorStack'), st = Game.cursor;
    c.classList.toggle('hidden', !st);
    c.innerHTML = st ? `<img src="${this.icons[st.id]}">${st.n > 1 ? `<span class="n">${st.n}</span>` : ''}` : '';
  },
  showTip(st, extra) {
    const tt = $('tooltip');
    if (!st) { tt.style.opacity = 0; return; }
    const def = ITEMS[st.id];
    tt.querySelector('.tn').textContent = def.name;
    let d = def.desc || '';
    if (def.tool) d = `${def.tool.type === 'sword' ? 'Attack damage ' + def.tool.dmg : 'Mining speed ×' + def.tool.speed}. Durability ${st.d !== undefined ? st.d : def.tool.dur}/${def.tool.dur}`;
    if (def.food) d = def.desc;
    if (def.armor) d = `Armour +${def.armor.points}. Durability ${st.d !== undefined ? st.d : def.armor.dur}/${def.armor.dur}. Right-click while holding it to wear.`;
    tt.querySelector('.td').textContent = extra || d;
    tt.style.opacity = 1;
  },
  hideTip() { $('tooltip').style.opacity = 0; },
  // slot addressing: 0-35 inventory, 200-203 armour, 300-302 furnace (input, fuel, output)
  getS(i) { const inv = Game.inv; if (i < 36) return inv.s[i]; if (i >= 200 && i < 204) return inv.armor[i - 200]; if (i >= 300 && this.furnace) return this.furnace.s[i - 300]; return null; },
  setS(i, v) { const inv = Game.inv; if (i < 36) inv.s[i] = v; else if (i >= 200 && i < 204) inv.armor[i - 200] = v; else if (i >= 300 && this.furnace) this.furnace.s[i - 300] = v; },
  accepts(i, st) {
    if (!st) return true;
    if (i >= 200 && i < 204) return !!(ITEMS[st.id].armor && ITEMS[st.id].armor.slot === i - 200);
    if (i === 300) return SMELT[st.id] !== undefined;
    if (i === 301) return !!FUEL[st.id];
    if (i === 302) return false;
    return true;
  },
  moveInto(st, targets) {
    const max = ITEMS[st.id].stack;
    for (const k of targets) { const t = this.getS(k); if (t && t.id === st.id && max > 1 && t.n < max && this.accepts(k, st)) { const m = Math.min(st.n, max - t.n); t.n += m; st.n -= m; if (!st.n) return true; } }
    for (const k of targets) { if (!this.getS(k) && this.accepts(k, st)) { this.setS(k, st); return true; } }
    return false;
  },
  slotClick(i, button, shift) {
    const inv = Game.inv, c = Game.cursor, cur = this.getS(i);
    GameAudio.click();
    if (shift && button === 0 && cur) {
      const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);
      let targets;
      if (i < 36) {
        const def = ITEMS[cur.id];
        if (def.armor && !inv.armor[def.armor.slot]) targets = [200 + def.armor.slot];
        else if (this.furnace && SMELT[cur.id] !== undefined) targets = [300];
        else if (this.furnace && FUEL[cur.id]) targets = [301];
        else targets = i < 9 ? range(9, 36) : range(0, 9);
      } else targets = range(0, 36);
      this.setS(i, null);
      if (!this.moveInto(cur, targets)) this.setS(i, cur);
    } else if (button === 0) {
      if (i === 302) {
        if (cur && (!c || (c.id === cur.id && c.n + cur.n <= ITEMS[c.id].stack))) { if (c) c.n += cur.n; else Game.cursor = cur; this.setS(i, null); }
      } else if (!c) { Game.cursor = cur; this.setS(i, null); }
      else if (!this.accepts(i, c)) { GameAudio.tone({ freq: 160, gain: 0.08, decay: 0.08, type: 'square' }); }
      else if (!cur) { this.setS(i, c); Game.cursor = null; }
      else if (cur.id === c.id && ITEMS[c.id].stack > 1) { const m = Math.min(c.n, ITEMS[c.id].stack - cur.n); cur.n += m; c.n -= m; if (!c.n) Game.cursor = null; }
      else { this.setS(i, c); Game.cursor = cur; }
    } else if (button === 2) {
      if (!c && cur && i !== 302) { const h = Math.ceil(cur.n / 2); Game.cursor = { id: cur.id, n: h, d: cur.d }; cur.n -= h; if (!cur.n) this.setS(i, null); }
      else if (c && this.accepts(i, c) && (!cur || (cur.id === c.id && cur.n < ITEMS[c.id].stack))) {
        if (cur) cur.n++; else this.setS(i, { id: c.id, n: 1, d: c.d });
        c.n--; if (!c.n) Game.cursor = null;
      }
    }
    inv.touch(); this.refreshInventory(); this.showTip(this.getS(i));
  },
  refreshRecipes() {
    const box = $('recipes'), inv = Game.inv;
    [...$('tabs').children].forEach(b => b.classList.toggle('on', b.textContent === this.tab));
    const bs = $('benchState');
    bs.textContent = Game.benchNear ? '✓ Workbench nearby' : 'No workbench nearby'; bs.className = Game.benchNear ? 'ok' : 'no';
    box.innerHTML = '';
    const list = RECIPES.filter(r => this.tab === 'All' || r.cat === this.tab);
    list.sort((a, b) => (this.recipeOK(b) - this.recipeOK(a)));
    for (const r of list) {
      const ok = this.recipeOK(r);
      const el = document.createElement('div'); el.className = 'rc' + (ok ? '' : ' no');
      const ing = r.inp.map(([k, n]) => {
        const have = inv.count(k);
        const icon = typeof k === 'string' ? this.icons[GROUPS[k][0]] : this.icons[k];
        const nm = typeof k === 'string' ? GROUP_NAMES[k] : ITEMS[k].name;
        return `<span class="${have >= n ? '' : 'miss'}" title="${nm}"><img src="${icon}">${n} ${nm}</span>`;
      }).join('');
      const tag = r.bench ? `<span class="tag ${Game.benchNear ? '' : 'lock'}">${Game.benchNear ? 'Workbench' : '🔒 Workbench'}</span>` : '';
      el.innerHTML = `<div class="out"><img src="${this.icons[r.out[0]]}">${r.out[1] > 1 ? `<b>${r.out[1]}</b>` : ''}</div><div class="info"><div class="nm">${ITEMS[r.out[0]].name}</div><div class="ing">${ing}</div></div>${tag}`;
      el.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        if (!this.recipeOK(r)) { GameAudio.tone({ freq: 160, gain: 0.08, decay: 0.08, type: 'square' }); if (r.bench && !Game.benchNear) this.toast('Stand near a Workbench to craft this.'); return; }
        this.craft(r, e.shiftKey ? 64 : 1);
      });
      el.addEventListener('mouseenter', () => this.showTip({ id: r.out[0], n: r.out[1] }, ITEMS[r.out[0]].desc || (r.bench ? 'Crafted at a Workbench.' : 'Click to craft · Shift-click to craft many.')));
      el.addEventListener('mouseleave', () => this.hideTip());
      box.appendChild(el);
    }
  },
  refreshCatalog() {
    [...$('catTabs').children].forEach(b => b.classList.toggle('on', b.textContent === this.catTab));
    const box = $('catalog'); box.innerHTML = '';
    for (const id of CREATIVE_TABS[this.catTab]) {
      const s = document.createElement('div'); s.className = 'slot';
      s.innerHTML = `<img src="${this.icons[id]}">`;
      s.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        if (Game.cursor) { Game.cursor = null; this.refreshCursor(); return; }
        const st = { id, n: e.button === 2 ? 1 : ITEMS[id].stack };
        if (ITEMS[id].tool) st.d = ITEMS[id].tool.dur;
        GameAudio.click();
        if (e.shiftKey) {
          const inv = Game.inv; let slot = -1;
          for (let i = 0; i < 9; i++) if (!inv.s[i]) { slot = i; break; }
          inv.s[slot < 0 ? inv.sel : slot] = st; inv.touch(); this.refreshInventory();
        } else { Game.cursor = st; this.refreshCursor(); }
      });
      s.addEventListener('mouseenter', () => this.showTip({ id, n: 1 }));
      s.addEventListener('mouseleave', () => this.hideTip());
      s.addEventListener('contextmenu', e => e.preventDefault());
      box.appendChild(s);
    }
  },
  recipeOK(r) { return Game.inv.canCraft(r) && (!r.bench || Game.benchNear) ? 1 : 0; },
  craft(r, times) {
    const inv = Game.inv; let done = 0;
    const max = Math.max(1, Math.floor(ITEMS[r.out[0]].stack / r.out[1]));
    times = Math.min(times, max);
    for (let k = 0; k < times; k++) {
      if (!this.recipeOK(r)) break;
      for (const [key, n] of r.inp) inv.remove(key, n);
      const left = inv.add(r.out[0], r.out[1]);
      if (left) throwStack({ id: r.out[0], n: left }, left);
      done++;
    }
    if (!done) return;
    GameAudio.craft();
    const id = r.out[0];
    this.toast(`Crafted ${done * r.out[1]} × ${ITEMS[id].name}`);
    this.refreshInventory();
  },

  /* ---------- menu embers ---------- */
  fxFrame(dt) {
    const cv = this.fx; if (!cv || cv.style.opacity === '0') return;
    const w = innerWidth, h = innerHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = this.fxg; g.clearRect(0, 0, w, h);
    const P = this.fxParts;
    while (P.length < 70) P.push({ x: Math.random() * w, y: h + Math.random() * h * 0.6, vy: 18 + Math.random() * 46, s: 2 + Math.random() * 3, ph: Math.random() * 6, life: 0 });
    for (const p of P) {
      p.y -= p.vy * dt; p.ph += dt * 1.6; p.x += Math.sin(p.ph) * 12 * dt;
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      const a = Math.min(1, (h - p.y) / (h * 0.25)) * (0.5 + 0.5 * Math.sin(p.ph * 3)) * Math.min(1, p.y / (h * 0.4));
      g.fillStyle = `rgba(255,${150 + (p.s * 20 | 0)},${60 + (p.s * 8 | 0)},${Math.max(0, a) * 0.75})`;
      g.fillRect(p.x | 0, p.y | 0, p.s | 0, p.s | 0);
    }
  },
};

function throwStack(st, n) {
  if (!Game.player) return;
  const e = Game.eyePos(), d = Game.lookDir();
  Drops.spawn(st.id, n, st.d, e[0] + d[0] * 0.4, e[1] - 0.3, e[2] + d[2] * 0.4, [d[0] * 5, d[1] * 5 + 1.5, d[2] * 5]).pickupDelay = 1.5;
  Game.inv.touch();
}
