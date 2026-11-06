/* =====================================================================
   Proximity voice chat over the direct peer-to-peer links.
   Voices get quieter with distance and fade out past VOICE_RANGE blocks.
   Remote voices play through <audio> elements so the browser's echo
   cancellation keeps working; WebAudio is only used to see who's talking.
   ===================================================================== */
const VOICE_RANGE = 40;
const Voice = {
  stream: null, track: null, starting: null, remotes: new Map(), level: 0, ptt: false, analyser: null, buf: null,
  get mode() { return Settings.voice | 0; },            // 0 off, 1 open mic, 2 push-to-talk (V)
  get supported() { return Cloud.mode === 'relay' && typeof RTCPeerConnection !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
  get transmitting() { return !!this.track && (this.mode === 1 || (this.mode === 2 && this.ptt)); },
  async apply() {
    if (this.mode && this.supported) {
      if (!this.track && !this.starting) {
        this.starting = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
          .then(s => {
            this.stream = s; this.track = s.getAudioTracks()[0];
            this.track.enabled = this.transmitting;
            try {
              GameAudio.init();
              const c = GameAudio.ctx, src = c.createMediaStreamSource(s);
              this.analyser = c.createAnalyser(); this.analyser.fftSize = 512; this.buf = new Float32Array(512);
              src.connect(this.analyser);
            } catch (e) { }
            if (typeof Net !== 'undefined' && Net.room && Net.room.links) for (const l of Net.room.links.values()) this.attach(l);
            UI.toast(this.mode === 2 ? 'Voice chat on — hold V to talk' : 'Voice chat on — your microphone is live');
          })
          .catch(() => { Settings.voice = 0; saveSettings(); UI.toast('Microphone blocked — voice chat is off.'); if (UI.refreshSettings) UI.refreshSettings(); })
          .finally(() => { this.starting = null; });
      }
      if (this.track) this.track.enabled = this.transmitting;
    } else this.stop();
    UI.micTag && UI.micTag();
  },
  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = this.track = this.analyser = null;
    if (typeof Net !== 'undefined' && Net.room && Net.room.links) for (const l of Net.room.links.values()) if (l.audio) l.audio.sender.replaceTrack(null).catch(() => { });
  },
  attach(link) { if (link.audio && this.track) link.audio.sender.replaceTrack(this.track).catch(() => { }); },
  setPTT(down) { if (this.ptt === down) return; this.ptt = down; if (this.track) this.track.enabled = this.transmitting; UI.micTag && UI.micTag(); },
  remoteTrack(peer, stream) {
    let v = this.remotes.get(peer);
    if (v && v.stream === stream) return;
    if (v) this.removePeer(peer);
    const el = new Audio(); el.autoplay = true; el.srcObject = stream; el.volume = 0;
    el.play && el.play().catch(() => { });
    v = { stream, el, analyser: null, level: 0 };
    try {
      GameAudio.init();
      const c = GameAudio.ctx, src = c.createMediaStreamSource(stream);
      v.analyser = c.createAnalyser(); v.analyser.fftSize = 512; src.connect(v.analyser); v.src = src;
    } catch (e) { }
    this.remotes.set(peer, v);
  },
  removePeer(peer) {
    const v = this.remotes.get(peer); if (!v) return;
    try { v.el.pause(); v.el.srcObject = null; } catch (e) { }
    try { v.src && v.src.disconnect(); } catch (e) { }
    this.remotes.delete(peer);
  },
  clear() { for (const p of [...this.remotes.keys()]) this.removePeer(p); },
  rms(an) {
    if (!an) return 0;
    if (!this.buf) this.buf = new Float32Array(512);
    an.getFloatTimeDomainData(this.buf); let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return Math.sqrt(s / this.buf.length);
  },
  update(dt) {
    const P = Game.player;
    const master = (Settings.master / 100) * ((Settings.voiceVol === undefined ? 80 : Settings.voiceVol) / 100);
    for (const [peer, v] of this.remotes) {
      const r = Net.remotes.get(peer);
      let vol = 0;
      if (r && P && !(r.flags & 4)) {
        const d = Math.hypot(r.pos[0] - P.pos[0], r.pos[1] - P.pos[1], r.pos[2] - P.pos[2]);
        vol = Math.pow(Math.max(0, 1 - d / VOICE_RANGE), 1.3);
      }
      v.el.volume = clamp(vol * master, 0, 1);
      v.level = v.level * 0.7 + this.rms(v.analyser) * 0.3;
      if (r) r.speaking = v.level > 0.008 && vol > 0;
    }
    const lv = this.transmitting ? this.rms(this.analyser) : 0;
    this.level = this.level * 0.7 + lv * 0.3;
    const talking = this.transmitting && this.level > 0.008;
    if (talking !== this.talking) { this.talking = talking; UI.micTag && UI.micTag(); }
  },
};
