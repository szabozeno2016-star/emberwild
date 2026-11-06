/* =====================================================================
   Audio: synthesized SFX and generative ambient music (all original)
   ===================================================================== */
const GameAudio = {
  ctx: null, master: null, sfx: null, music: null, noiseBuf: null, delay: null, musicTimer: 0, mode: 'menu', phraseLeft: 0, nextNote: 0, ready: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { }); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.music = c.createGain();
      // music bus: lowpass + feedback delay "room"
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      const dl = c.createDelay(1.5); dl.delayTime.value = 0.42;
      const fb = c.createGain(); fb.gain.value = 0.38;
      const wet = c.createGain(); wet.gain.value = 0.45;
      this.music.connect(lp); lp.connect(this.master); lp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(this.master);
      const len = c.sampleRate * 1.5, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
      this.applyVolumes();
      this.ready = true;
    } catch (e) { this.ctx = null; }
  },
  applyVolumes() {
    if (!this.ctx) return;
    const m = Settings.master / 100;
    this.master.gain.value = m * m;
    this.sfx.gain.value = (Settings.sfx / 100);
    this.music.gain.value = (Settings.music / 100) * 0.55;
    if (this.amb) this.amb.bus.gain.value = Settings.ambient / 100;
  },
  noise(o) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + (o.delay || 0);
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.value = o.freq || 1000; f.Q.value = o.q || 1;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || 0.3, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.attack || 0.004) + (o.decay || 0.1));
    src.connect(f); f.connect(g); g.connect(o.bus || this.sfx);
    src.start(t, Math.random() * 1.2, (o.decay || 0.1) + 0.05);
  },
  tone(o) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.decay || 0.2));
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.attack || 0.005) + (o.decay || 0.2));
    osc.connect(g); g.connect(o.bus || this.sfx);
    osc.start(t); osc.stop(t + (o.attack || 0.005) + (o.decay || 0.2) + 0.05);
  },
  mat(id) { return (BLOCKS[id] && BLOCKS[id].sound) || 'stone'; },
  dig(id, vol) {
    const m = this.mat(id), v = vol || 1, r = 0.9 + Math.random() * 0.25;
    if (m === 'stone') { this.noise({ freq: 1500 * r, q: 1.4, gain: 0.32 * v, decay: 0.07 }); this.tone({ freq: 140 * r, gain: 0.12 * v, decay: 0.05, type: 'triangle' }); }
    else if (m === 'wood') { this.noise({ freq: 620 * r, q: 5, gain: 0.4 * v, decay: 0.09 }); this.tone({ freq: 190 * r, to: 150, gain: 0.16 * v, decay: 0.08, type: 'triangle' }); }
    else if (m === 'grass') { this.noise({ type: 'lowpass', freq: 1300 * r, q: 0.7, gain: 0.35 * v, decay: 0.11 }); }
    else if (m === 'sand') { this.noise({ type: 'highpass', freq: 2200 * r, q: 0.5, gain: 0.22 * v, decay: 0.14, attack: 0.02 }); }
    else if (m === 'leaves') { this.noise({ freq: 3200 * r, q: 0.6, gain: 0.2 * v, decay: 0.16, attack: 0.015 }); }
    else if (m === 'glass') { this.tone({ freq: 1900 * r, gain: 0.1 * v, decay: 0.12 }); this.noise({ freq: 4000, q: 2, gain: 0.15 * v, decay: 0.05 }); }
  },
  breakBlock(id) {
    const m = this.mat(id);
    this.dig(id, 1.4);
    if (m === 'glass') { for (let k = 0; k < 4; k++) this.tone({ freq: 1500 + Math.random() * 2500, gain: 0.08, decay: 0.2, delay: k * 0.03 }); }
    else this.noise({ delay: 0.03, type: 'lowpass', freq: 700, gain: 0.25, decay: 0.12 });
  },
  place(id) { this.dig(id, 1.1); this.tone({ freq: 90, gain: 0.12, decay: 0.06, type: 'sine' }); },
  step(id) { const m = this.mat(id); this.dig(id, m === 'stone' ? 0.35 : 0.45); },
  pop() { this.tone({ freq: 680 + Math.random() * 200, to: 1300, gain: 0.12, decay: 0.07 }); },
  click() { this.tone({ freq: 520, to: 380, gain: 0.14, decay: 0.06, type: 'triangle' }); this.noise({ freq: 2500, q: 2, gain: 0.08, decay: 0.03 }); },
  hover() { this.tone({ freq: 880, gain: 0.03, decay: 0.04, type: 'triangle' }); },
  hurt() { this.tone({ freq: 240, to: 120, gain: 0.3, decay: 0.18, type: 'square' }); this.noise({ type: 'lowpass', freq: 600, gain: 0.3, decay: 0.12 }); },
  eat() { for (let k = 0; k < 3; k++) this.noise({ freq: 900 + Math.random() * 600, q: 1.5, gain: 0.25, decay: 0.06, delay: k * 0.08 }); },
  burp() { this.tone({ freq: 110, to: 70, gain: 0.2, decay: 0.25, type: 'sawtooth' }); },
  splash() { this.noise({ type: 'lowpass', freq: 1800, gain: 0.4, decay: 0.35, attack: 0.01 }); },
  growl(v) { v = v || 0.6; this.tone({ freq: 70 + Math.random() * 20, to: 48, gain: 0.25 * v, decay: 0.7, type: 'sawtooth', attack: 0.12 }); this.noise({ type: 'lowpass', freq: 400, gain: 0.25 * v, decay: 0.6, attack: 0.1 }); },
  mobHurt() { this.tone({ freq: 160, to: 90, gain: 0.25, decay: 0.15, type: 'sawtooth' }); this.noise({ freq: 800, gain: 0.2, decay: 0.08 }); },
  poof() { this.noise({ type: 'lowpass', freq: 900, gain: 0.35, decay: 0.4, attack: 0.02 }); this.tone({ freq: 300, to: 60, gain: 0.15, decay: 0.4 }); },
  swing() { this.noise({ type: 'bandpass', freq: 1200, q: 0.8, gain: 0.1, decay: 0.12, attack: 0.03 }); },
  craft() { this.click(); this.tone({ freq: 660, gain: 0.08, decay: 0.12, delay: 0.05, type: 'triangle' }); this.tone({ freq: 990, gain: 0.07, decay: 0.15, delay: 0.1, type: 'triangle' }); },
  chime() { [523, 659, 784, 1046].forEach((f, k) => this.tone({ freq: f, gain: 0.1, decay: 0.5, delay: k * 0.09, type: 'triangle' })); },
  toolBreak() { this.tone({ freq: 900, to: 200, gain: 0.2, decay: 0.2, type: 'square' }); this.noise({ freq: 3000, gain: 0.2, decay: 0.1 }); },
  death() { [392, 330, 262, 196].forEach((f, k) => this.tone({ freq: f, gain: 0.14, decay: 0.6, delay: k * 0.22, type: 'triangle' })); },
  // ---- ambience ----
  amb: null,
  initAmbience() {
    if (!this.ready || this.amb) return;
    const c = this.ctx, bus = c.createGain(); bus.connect(this.master);
    const loop = (lp, hp, q) => {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f1 = c.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = lp; f1.Q.value = q || 0.7;
      const f2 = c.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = hp;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f1); f1.connect(f2); f2.connect(g); g.connect(bus); src.start();
      return { g, f1 };
    };
    this.amb = { bus, rain: loop(3200, 500), wind: loop(520, 120, 1.4), t: { bird: 3, cricket: 2, drip: 4, lap: 3, crackle: 0.5 } };
    this.applyVolumes();
  },
  ambientTick(dt, s) {
    if (!this.ready) return;
    if (!this.amb) this.initAmbience();
    const A = this.amb, c = this.ctx, now = c.currentTime;
    A.bus.gain.setTargetAtTime((Settings.ambient / 100) * (s.menu ? 0.5 : 1), now, 0.3);
    const rainG = s.rain * (0.08 + 0.32 * s.outside);
    A.rain.g.gain.setTargetAtTime(rainG, now, 0.6);
    A.rain.f1.frequency.setTargetAtTime(s.outside > 0.5 ? 3200 : 900, now, 0.6);
    const gust = 0.6 + 0.4 * Math.sin(now * 0.31) * Math.sin(now * 0.13 + 1);
    const windG = (0.012 + Math.max(0, (s.height - 66) / 40) * 0.09 + s.rain * 0.03) * s.outside * gust;
    A.wind.g.gain.setTargetAtTime(windG, now, 1.2);
    const T = A.t; for (const k in T) T[k] -= dt;
    if (s.menu) return;
    if (T.bird <= 0) { T.bird = 3 + Math.random() * 8; if (s.day > 0.6 && s.outside > 0.6 && s.rain < 0.3) this.bird(); }
    if (T.cricket <= 0) { T.cricket = 0.7 + Math.random() * 1.8; if (s.night > 0.6 && s.outside > 0.6 && s.rain < 0.3) this.cricket(); }
    if (T.drip <= 0) { T.drip = 2.5 + Math.random() * 7; if (s.underground) this.drip(); }
    if (T.lap <= 0) { T.lap = 3 + Math.random() * 5; if (s.water > 0) this.lap(s.water); }
    if (T.crackle <= 0) { T.crackle = 0.08 + Math.random() * 0.35; if (s.fire > 0) this.crackle(s.fire); }
  },
  pan(p) { const n = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null; if (n) { n.pan.value = p; n.connect(this.amb ? this.amb.bus : this.sfx); } return n; },
  bird() {
    const c = this.ctx, bus = this.pan((Math.random() - 0.5) * 1.6) || this.amb.bus, n = 2 + (Math.random() * 4 | 0), base = 2400 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const t = c.currentTime + i * (0.09 + Math.random() * 0.06), o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), t); o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + 0.06);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.1);
    }
  },
  cricket() {
    const c = this.ctx, bus = this.pan((Math.random() - 0.5) * 1.8) || this.amb.bus, f = 4000 + Math.random() * 900;
    for (let i = 0; i < 3 + (Math.random() * 4 | 0); i++) {
      const t = c.currentTime + i * 0.055, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.014, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.05);
    }
  },
  drip() {
    const bus = this.pan((Math.random() - 0.5) * 1.4) || this.amb.bus, f = 900 + Math.random() * 900;
    this.tone({ freq: f, to: f * 0.55, gain: 0.05, decay: 0.12, bus }); this.tone({ freq: f * 0.8, to: f * 0.45, gain: 0.015, decay: 0.2, delay: 0.32, bus });
    if (Math.random() < 0.2) this.noise({ type: 'lowpass', freq: 120, gain: 0.08, decay: 1.6, attack: 0.5, bus });
  },
  lap(v) { this.noise({ type: 'lowpass', freq: 700 + Math.random() * 300, gain: 0.05 * v, attack: 0.5, decay: 1.1, bus: this.amb.bus }); },
  crackle(v) { this.noise({ type: 'highpass', freq: 2500 + Math.random() * 2500, q: 0.8, gain: (0.04 + Math.random() * 0.06) * v, decay: 0.02, rate: 1.5, bus: this.amb.bus }); },
  sizzle() { this.noise({ type: 'highpass', freq: 3500, gain: 0.1, attack: 0.05, decay: 0.5 }); },
  thunder(dist) {
    const d = dist || 0;
    this.noise({ type: 'lowpass', freq: 260 - d * 120, gain: 0.5 - d * 0.25, attack: 0.03 + d * 0.3, decay: 3.2, delay: d * 1.5, rate: 0.6 });
    this.tone({ freq: 48, to: 32, gain: 0.25 - d * 0.1, attack: 0.05, decay: 2.2, delay: d * 1.5 });
  },
  hiss(v) { v = v || 0.5; this.noise({ type: 'highpass', freq: 3200, q: 0.8, gain: 0.12 * v, attack: 0.05, decay: 0.45, rate: 1.3 }); this.tone({ freq: 220, to: 150, gain: 0.04 * v, decay: 0.3, type: 'sawtooth' }); },
  animal(v, hurt) {
    v = v || 0.6; const f = hurt ? 190 : 105 + Math.random() * 25;
    this.tone({ freq: f, to: f * 0.8, gain: 0.12 * v, attack: 0.08, decay: hurt ? 0.25 : 0.7, type: 'sawtooth' });
    this.tone({ freq: f * 2.01, to: f * 1.6, gain: 0.04 * v, attack: 0.08, decay: hurt ? 0.2 : 0.6, type: 'triangle' });
  },
  // ---- generative music: chord progressions with pad, bass and melody ----
  setMode(m) { this.mode = m; this.mus = null; this.musicRest = m === 'menu' ? 0.5 : 20 + Math.random() * 20; },
  note(midi, dur, gain, when, kind) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + (when || 0), f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = c.createGain(); g.connect(this.music);
    const soft = kind === 'pad' || kind === 'bass' || kind === true;
    const att = soft ? (kind === 'bass' ? 0.4 : 1.1) : 0.012;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + att); g.gain.exponentialRampToValueAtTime(0.0001, t + att + dur);
    const parts = kind === 'bell' ? [['sine', 1, 1], ['sine', 2.76, 0.25], ['sine', 5.4, 0.08]]
      : kind === 'bass' ? [['sine', 1, 1], ['triangle', 2, 0.15]]
      : soft ? [['triangle', 1, 0.7], ['sine', 2, 0.25], ['sine', 0.5, 0.4]] : [['triangle', 1, 1], ['sine', 2, 0.35], ['sine', 3, 0.08]];
    for (const [type, mul, gm] of parts) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f * mul; o.detune.value = (Math.random() - 0.5) * (soft ? 10 : 4);
      const og = c.createGain(); og.gain.value = gm; o.connect(og); og.connect(g);
      o.start(t); o.stop(t + att + dur + 0.1);
    }
  },
  updateMusic(dt, ctx) {
    if (!this.ready || Settings.music <= 0) return;
    ctx = ctx || {};
    const mood = ctx.underground ? 'cave' : ctx.night ? 'night' : 'day';
    if (!this.mus) {
      this.musicRest -= dt;
      if (this.musicRest > 0) return;
      const P = {
        day: { root: 62, scale: [0, 2, 4, 5, 7, 9, 11], progs: [[0, 4, 5, 3], [0, 3, 5, 4], [5, 3, 0, 4], [0, 2, 3, 3]], beat: 4.2, mel: 'pluck' },
        night: { root: 57, scale: [0, 2, 3, 5, 7, 8, 10], progs: [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6]], beat: 5.0, mel: 'bell' },
        cave: { root: 52, scale: [0, 1, 3, 5, 7, 8, 10], progs: [[0, 1, 0, 6], [0, 5, 0, 1]], beat: 6.0, mel: 'bell' },
      }[mood];
      const prog = [].concat(P.progs[(Math.random() * P.progs.length) | 0], P.progs[(Math.random() * P.progs.length) | 0]);
      this.mus = { P, prog, i: 0, t: 0, mood };
    }
    const M = this.mus;
    M.t -= dt;
    if (M.t > 0) return;
    if (M.i >= M.prog.length) {
      this.mus = null;
      this.musicRest = this.mode === 'menu' ? 1.5 : 50 + Math.random() * 70;
      return;
    }
    const P = M.P, deg = M.prog[M.i++], sc = P.scale;
    const tone = k => P.root + sc[(deg + k) % 7] + 12 * Math.floor((deg + k) / 7);
    const chord = [tone(0), tone(2), tone(4)];
    chord.forEach((n, k) => this.note(n, P.beat * 1.05, M.mood === 'cave' ? 0.022 : 0.03, k * 0.04, 'pad'));
    this.note(chord[0] - 12, P.beat * 1.1, 0.05, 0, 'bass');
    // melody: chord tones and passing notes on a loose rhythm
    const steps = M.mood === 'cave' ? 2 : 4;
    let prev = chord[1] + 12;
    for (let s = 0; s < steps; s++) {
      if (Math.random() < (M.mood === 'cave' ? 0.5 : 0.28)) continue;
      const pool = Math.random() < 0.7 ? chord.map(n => n + 12) : [tone(1) + 12, tone(3) + 12, tone(5) + 12];
      pool.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
      const n = pool[Math.random() < 0.6 ? 0 : (Math.random() * pool.length) | 0];
      prev = n;
      this.note(n, P.mel === 'bell' ? 2.6 : 1.7, P.mel === 'bell' ? 0.045 : 0.06, s * P.beat / steps + (Math.random() - 0.5) * 0.05, P.mel);
    }
    M.t = P.beat;
  },
};
