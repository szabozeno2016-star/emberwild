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
    if (Input.touch && performance.now() - (Input.lastTouch || 0) < 900) return; // a finger, already handled
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
      if (UI.cur === 'realms') { if (code === 'Escape') UI.show('settings'); return; }
      if (['settings', 'help', 'confirm', 'profile'].includes(UI.cur)) { if (code === 'Escape') UI.show('pause'); return; }
      if (Game.paused || Game.ui || !Game.player.alive) return;
      if (e.repeat) { Input.keys[code] = true; return; }
      Input.keys[code] = true;
      if (code.startsWith('Digit')) { const n = +code.slice(5); if (n >= 1 && n <= 9) Game.inv.sel = n - 1; }
      else if (code === 'KeyE') UI.openInventory();
      else if (code === 'KeyT' && Net.active) { e.preventDefault(); UI.openChat(); }
      else if (code === 'KeyO') { UI.openPause(); UI.act('profile'); }
      else if (code === 'Slash' && Net.active) { e.preventDefault(); UI.openChat('/'); }
      else if (code === 'Tab' && Net.active) UI.showPlayers(true);
      else if (code === 'KeyV' && Net.active) Voice.setPTT(true);
      else if (code === 'F5') { e.preventDefault(); Game.view = ((Game.view || 0) + 1) % 3; }
      else if (code === 'KeyQ') dropHeld(e.ctrlKey || e.metaKey);
      else if (code === 'F3') { Game.debug = !Game.debug; $('debug').classList.toggle('hidden', !Game.debug); $('fpsBox').classList.toggle('hidden', Game.debug || !Settings.showFps); }
      else if (code === 'F1') Game.hideHud = !Game.hideHud;
      else if (code === 'Space' && Game.creative) {
        const now = performance.now();
        if (now - (Input.lastSpace || 0) < 300) { toggleFly(); Input.lastSpace = 0; }
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
  let id = t.id; if (isTorch(id)) id = B.TORCH; if (isChest(id)) id = B.CHEST; if (id === B.FURNACE_LIT) id = B.FURNACE;
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

/* ---------- phones and tablets: touch controls (chosen silently when the device needs them) ---------- */
function toggleFly() {
  const P = Game.player; P.flying = !P.flying; P.vel[1] = 0;
  UI.toast(P.flying ? (Input.touch ? 'Flying — ⇧ up, ⇩ down' : 'Flying — Space up, Shift or C down') : 'Landed');
}
function detectTouch() {
  const ua = navigator.userAgent || '';
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  let coarse = false; try { coarse = matchMedia('(hover: none) and (pointer: coarse)').matches; } catch (e) { }
  return /[?&#]touch=1/.test(location.search + location.hash) || ((mobileUA || coarse) && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window));
}
function initTouch() {
  if (!detectTouch()) return;
  Input.touch = true; Input.noLock = true; Input.tx = Input.tz = 0;
  document.body.classList.add('touch');
  const cv = R.canvas, stick = $('tcStick'), knob = $('tcKnob');
  // --- walking: a thumb stick ---
  let sid = null;
  const stickMove = e => {
    const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width / 2 - 8;
    let dx = e.clientX - cx, dy = e.clientY - cy; const len = Math.hypot(dx, dy);
    if (len > max) { dx *= max / len; dy *= max / len; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    const nx = dx / max, nz = -dy / max, dead = 0.16;
    Input.tx = Math.abs(nx) < dead ? 0 : nx; Input.tz = Math.abs(nz) < dead ? 0 : nz;
    Input.tsprint = len >= max * 0.98 && nz > 0.8;
  };
  const stickEnd = () => { sid = null; Input.tx = Input.tz = 0; Input.tsprint = false; knob.style.transform = ''; };
  stick.addEventListener('pointerdown', e => { e.preventDefault(); GameAudio.init(); sid = e.pointerId; try { stick.setPointerCapture(sid); } catch (x) { } stickMove(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) stickMove(e); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => stick.addEventListener(n, e => { if (e.pointerId === sid) stickEnd(); }));
  // --- buttons ---
  const hold = (el, down, up) => {
    el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); GameAudio.init(); try { el.setPointerCapture(e.pointerId); } catch (x) { } down(); });
    ['pointerup', 'pointercancel'].forEach(n => el.addEventListener(n, e => { e.preventDefault(); if (up) up(); }));
    el.addEventListener('contextmenu', e => e.preventDefault());
  };
  hold($('tcJump'), () => {
    Input.keys.Space = true;
    if (Game.creative && Game.player && inGameActive()) { const now = performance.now(); if (now - (Input.lastSpace || 0) < 320) { toggleFly(); Input.lastSpace = 0; } else Input.lastSpace = now; }
  }, () => { Input.keys.Space = false; });
  hold($('tcSneak'), () => {
    const P = Game.player; if (P && P.flying) { Input.keys.ShiftLeft = true; return; }
    Input.sneakLock = !Input.sneakLock; Input.keys.ShiftLeft = Input.sneakLock; $('tcSneak').classList.toggle('on', Input.sneakLock);
  }, () => { if (!Input.sneakLock) Input.keys.ShiftLeft = false; });
  hold($('tcPause'), () => { Input.sneakLock = false; $('tcSneak').classList.remove('on'); UI.openPause(); });
  hold($('tcInv'), () => { if (inGameActive()) UI.openInventory(); });
  hold($('tcView'), () => { Game.view = ((Game.view || 0) + 1) % 3; });
  hold($('tcChat'), () => { if (Net.active && inGameActive()) UI.openChat(); });
  // hotbar: tap a slot to hold it, tap it again to open the inventory
  UI.hotEls.forEach((el, i) => el.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); if (!inGameActive()) return;
    if (Game.inv.sel === i && performance.now() - (Input.lastHot || 0) < 400) UI.openInventory();
    Game.inv.sel = i; Input.lastHot = performance.now();
  }));
  // --- the world: drag to look, tap to place or use (or hit a creature), hold to break ---
  let lid = null, lx = 0, ly = 0, sx0 = 0, sy0 = 0, t0 = 0, moved = 0, holding = false, holdTimer = 0;
  const aimAt = e => { Input.aim = [(e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2]; };
  const endHold = () => { clearTimeout(holdTimer); if (holding) { holding = false; Input.mouseL = Input.mouseR = false; } };
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault(); GameAudio.init(); Input.lastTouch = performance.now();
    if (!inGameActive() || lid !== null) return;
    lid = e.pointerId; lx = sx0 = e.clientX; ly = sy0 = e.clientY; t0 = performance.now(); moved = 0; holding = false;
    try { cv.setPointerCapture(lid); } catch (x) { }
    aimAt(e);
    holdTimer = setTimeout(() => {
      if (lid === null || moved > 14 || !inGameActive()) return;
      holding = true;
      const st = Game.inv.held, food = st && ITEMS[st.id].food && !Game.creative && !Game.mobTarget;
      if (food) { Input.mouseR = true; Input.pressR = true; } else { Input.mouseL = true; Input.pressL = true; }
    }, 260);
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId !== lid) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    moved = Math.max(moved, Math.hypot(e.clientX - sx0, e.clientY - sy0));
    Input.lastTouch = performance.now();
    if (moved > 8 && inGameActive()) {
      const P = Game.player, s = 0.0055 * Settings.sens / 100;
      P.yaw += dx * s; P.pitch = clamp(P.pitch - dy * s * (Settings.invertY ? -1 : 1), -1.55, 1.55);
    }
    if (holding) aimAt(e); else if (moved > 14) Input.aim = null;
  });
  cv.addEventListener('pointerup', e => {
    if (e.pointerId !== lid) return;
    lid = null; Input.lastTouch = performance.now();
    const wasHold = holding; endHold();
    if (!wasHold && moved <= 14 && performance.now() - t0 < 320 && inGameActive()) { aimAt(e); Input.tap = 1; }
    else Input.aim = null;
  });
  cv.addEventListener('pointercancel', e => { if (e.pointerId === lid) { lid = null; endHold(); Input.aim = null; } });
  cv.addEventListener('touchstart', e => { if (Game.state === 'play') e.preventDefault(); }, { passive: false });
  window.addEventListener('orientationchange', () => setTimeout(() => UI.applySettings(), 250));
  window.addEventListener('resize', () => UI.applySettings());
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
    initTouch();
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
      if (UI.pendingInvite && !Profile.exists) $('wCreateSub').textContent = 'Pick a name and skin — then you’ll join your friend straight away.';
      if (UI.cur === 'title') UI.afterBoot();
    });
    requestAnimationFrame(t => { lastT = t; loop(t); });
  };
  img.onerror = () => showError('Texture atlas failed to load.');
  img.src = 'data:image/png;base64,__ATLAS_B64__';
})();
