/* =====================================================================
   Boot, input, pointer lock, main loop
   ===================================================================== */
function resize() {
  const cv = R.canvas; if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const levels = [0.5, 0.7, 0.85, 1, Math.min(dpr, 1.5), Math.min(Math.max(dpr, 1) * 1.25, 2.5)];
  const scale = (levels[Settings.quality] || 1) * (Settings.autoRes ? (R.dynScale || 1) : 1);
  const w = Math.max(1, Math.floor(innerWidth * scale)), h = Math.max(1, Math.floor(innerHeight * scale));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
}
function lockPointer(fromGesture) {
  const cv = R.canvas;
  if (Input.noLock) { UI.show(null); return; }
  if (!cv.requestPointerLock) { Input.noLock = true; UI.toast('Mouse capture unavailable — move the mouse or use the arrow keys to look.'); UI.show(null); return; }
  try {
    const p = cv.requestPointerLock();
    if (p && p.catch) p.catch(() => onLockFail());
  } catch (e) { onLockFail(); }
}
function onLockFail() {
  UI.lockFails++;
  if (Game.state !== 'play' || Game.ui || Game.paused) return;
  if (UI.lockFails >= 3) {
    Input.noLock = true; UI.show(null);
    UI.toast('Mouse capture is blocked here — move the mouse or use the arrow keys to look.');
    return;
  }
  UI.show('resume');
}
document.addEventListener('pointerlockchange', () => {
  Input.locked = document.pointerLockElement === R.canvas;
  if (Input.locked) { UI.lockFails = 0; if (UI.cur === 'resume') UI.show(null); return; }
  Input.mouseL = Input.mouseR = false; Input.keys = {};
  if (Game.state === 'play' && !Game.ui && !Game.paused && Game.player && Game.player.alive) UI.openPause();
  else if (Game.ui === 'chat') { /* chat keeps the game running */ }
});
document.addEventListener('pointerlockerror', () => onLockFail());

function inGameActive() {
  return Game.state === 'play' && !Game.paused && !Game.ui && Game.player && Game.player.alive && (Input.locked || Input.noLock);
}
function bindInput() {
  const cv = R.canvas;
  document.addEventListener('mousemove', e => {
    if (!inGameActive()) return;
    const P = Game.player, s = 0.0022 * Settings.sens / 100;
    let mx = e.movementX || 0, my = e.movementY || 0;
    if (Math.abs(mx) > 300 || Math.abs(my) > 300) return; // ignore spikes
    P.yaw += mx * s;
    P.pitch = clamp(P.pitch - my * s * (Settings.invertY ? -1 : 1), -1.55, 1.55);
  });
  cv.addEventListener('mousedown', e => {
    GameAudio.init();
    if (Game.state !== 'play' || Game.paused || Game.ui) return;
    if (!Input.locked && !Input.noLock) { lockPointer(true); return; }
    e.preventDefault();
    if (e.button === 0) { Input.mouseL = true; Input.pressL = true; }
    else if (e.button === 2) { Input.mouseR = true; Input.pressR = true; }
    else if (e.button === 1) pickBlock();
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) Input.mouseL = false;
    if (e.button === 2) Input.mouseR = false;
  });
  window.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('wheel', e => {
    if (!inGameActive()) return;
    const inv = Game.inv;
    inv.sel = (inv.sel + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
  }, { passive: true });
  window.addEventListener('blur', () => { Input.keys = {}; Input.mouseL = Input.mouseR = false; UI.showPlayers(false); Voice.setPTT(false); });
  window.addEventListener('keydown', e => {
    const code = e.code;
    if (e.target && e.target.tagName === 'INPUT') return;
    if (Game.state === 'play') {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F3', 'F5', 'Tab', 'KeyQ', 'Slash'].includes(code)) e.preventDefault();
      if (UI.cur === 'inv') { if (code === 'KeyE' || code === 'Escape') UI.closeInventory(); return; }
      if (UI.cur === 'pause') { if (code === 'Escape') UI.resume(); return; }
      if (['settings', 'help', 'confirm'].includes(UI.cur)) { if (code === 'Escape') UI.show('pause'); return; }
      if (Game.paused || Game.ui || !Game.player.alive) return;
      if (e.repeat) { Input.keys[code] = true; return; }
      Input.keys[code] = true;
      if (code.startsWith('Digit')) { const n = +code.slice(5); if (n >= 1 && n <= 9) Game.inv.sel = n - 1; }
      else if (code === 'KeyE') UI.openInventory();
      else if (code === 'KeyT' && Net.active) { e.preventDefault(); UI.openChat(); }
      else if (code === 'Slash' && Net.active) { e.preventDefault(); UI.openChat('/'); }
      else if (code === 'Tab' && Net.active) UI.showPlayers(true);
      else if (code === 'KeyV' && Net.active) Voice.setPTT(true);
      else if (code === 'F5') { e.preventDefault(); Game.view = ((Game.view || 0) + 1) % 3; }
      else if (code === 'KeyQ') dropHeld(e.ctrlKey || e.metaKey);
      else if (code === 'F3') { Game.debug = !Game.debug; $('debug').classList.toggle('hidden', !Game.debug); $('fpsBox').classList.toggle('hidden', Game.debug || !Settings.showFps); }
      else if (code === 'F1') Game.hideHud = !Game.hideHud;
      else if (code === 'Space' && Game.creative) {
        const now = performance.now();
        if (now - (Input.lastSpace || 0) < 300) { Game.player.flying = !Game.player.flying; Game.player.vel[1] = 0; Input.lastSpace = 0; UI.toast(Game.player.flying ? 'Flying — Space up, Shift down' : 'Landed'); }
        else Input.lastSpace = now;
      }
      else if (code === 'KeyW') {
        const now = performance.now();
        if (now - Input.lastW < 280 && Game.player.hunger > 6) Game.player.sprint = true;
        Input.lastW = now;
      }
      else if (code === 'Escape' && Input.noLock) UI.openPause();
    } else if (Game.state === 'menu') {
      if (code === 'Escape' && UI.cur && UI.cur !== 'title') { GameAudio.click(); UI.show('title'); }
    }
  });
  window.addEventListener('keyup', e => {
    Input.keys[e.code] = false;
    if (e.code === 'Tab') UI.showPlayers(false);
    if (e.code === 'KeyV') Voice.setPTT(false);
  });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden && Game.state === 'play' && Game.worldId) Game.saveWorld(); });
  window.addEventListener('pagehide', () => { if (Game.state === 'play' && Game.worldId && !Saves.cloud) { try { Saves.save(Game.buildSave()); } catch (e) { } } });
}
function dropHeld(all) {
  const inv = Game.inv, st = inv.held; if (!st) return;
  const n = all ? st.n : 1;
  throwStack(st, n);
  st.n -= n; if (st.n <= 0) inv.s[inv.sel] = null;
  inv.touch();
  Game.player.swingT = 0;
}
function pickBlock() {
  const t = Game.target; if (!t) return;
  let id = t.id; if (isTorch(id)) id = B.TORCH;
  if (!ITEMS[id]) return;
  const inv = Game.inv;
  for (let i = 0; i < 9; i++) if (inv.s[i] && inv.s[i].id === id) { inv.sel = i; return; }
  if (Game.creative) {
    let slot = inv.sel;
    for (let i = 0; i < 9; i++) if (!inv.s[i]) { slot = i; break; }
    inv.s[slot] = { id, n: ITEMS[id].stack }; inv.sel = slot; inv.touch(); return;
  }
  for (let i = 9; i < 36; i++) if (inv.s[i] && inv.s[i].id === id) { const tmp = inv.s[inv.sel]; inv.s[inv.sel] = inv.s[i]; inv.s[i] = tmp; inv.touch(); return; }
}

let lastT = performance.now(), errCount = 0;
function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now;
  try { Game.frame(dt, now); UI.fxFrame(dt); }
  catch (e) { errCount++; window.__lastError = e; if (errCount < 5) console.error(e); }
  requestAnimationFrame(loop);
}
function showError(msg) {
  const d = document.createElement('div'); d.id = 'err';
  d.innerHTML = `<div><div style="font-size:30px;margin-bottom:12px">Emberwild couldn’t start</div><div>${msg}</div><div style="color:#9c8c7b;margin-top:12px;font-size:16px">This game needs a browser with WebGL2 (recent Chrome, Edge, Firefox or Safari).</div></div>`;
  document.body.appendChild(d);
}
(function boot() {
  const img = new Image();
  img.onload = () => {
    try { initRenderer($('gl'), img); }
    catch (e) { showError(e.message); return; }
    UI.init(img);
    bindInput();
    resize();
    Game.startMenu();
    UI.show('title');
    UI.fadeIn();
    const ci = $('chatInput');
    ci.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') UI.closeChat(true); else if (e.key === 'Escape') UI.closeChat(false); });
    $('profileChip').addEventListener('click', () => { GameAudio.init(); GameAudio.click(); UI.act('profile'); });
    $('joinCode').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') UI.act('mpJoin'); });
    $('pName').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') UI.act('profSave'); });
    const readInvite = () => {
      const m = /^#(party|server)=([A-Za-z0-9-]{3,40})$/.exec(location.hash || '');
      if (!m) return false;
      UI.pendingInvite = m[1] === 'party' ? { party: Net.norm(m[2]) } : { server: m[2].toLowerCase() };
      return true;
    };
    window.addEventListener('hashchange', () => { if (readInvite() && Cloud.ready && Profile.exists) UI.runInvite(); });
    readInvite();
    Cloud.init().then(() => Profile.load()).then(() => {
      if (!Cloud.canAccount) $('wCreateSub').textContent = 'Pick a name and skin for multiplayer. Your account and worlds are kept in this browser.';
      UI.refreshChip(); UI.refreshContinue();
      if (!Profile.exists && UI.cur === 'title') UI.show('welcome');
      else if (UI.cur === 'title') UI.show('title');
      if (UI.pendingInvite && Profile.exists) UI.runInvite();
      else if (UI.pendingInvite) $('wCreateSub').textContent = 'Pick a name and skin — then you’ll join your friend straight away.';
    });
    requestAnimationFrame(t => { lastT = t; loop(t); });
  };
  img.onerror = () => showError('Texture atlas failed to load.');
  img.src = 'data:image/png;base64,__ATLAS_B64__';
})();
