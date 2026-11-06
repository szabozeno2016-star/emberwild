/* =====================================================================
   Relay: multiplayer without claude.ai.
   A tiny MQTT 3.1.1 client over secure WebSockets talks to free public
   brokers. Every message goes to two brokers at once and is de-duplicated
   on arrival, so the game keeps working if one of them has a bad day.
     - RelayRoom mirrors the claude.ai `room` API (presence + peers)
     - RelayDB mirrors the parts of the `db` API the game uses, stored as
       retained messages (public: only shared game data goes here — never
       accounts or private saves)
   ===================================================================== */
const RELAY_PREFIX = 'emberwild/v1/';
const RELAY_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const RELAY_MAX = 110000;           // largest single message we send (bytes)
const RELAY_CHUNK = 40000;          // shared blobs are split into pieces this size (chars)

class MqttConn {
  constructor(url, clientId, will) {
    this.url = url; this.clientId = clientId; this.will = will;
    this.ws = null; this.ready = false; this.buf = new Uint8Array(0); this.pid = 1;
    this.acks = new Map(); this.onPublish = null; this.onState = null; this.pingT = null; this.closed = false;
  }
  connect(timeout = 8000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = e => { if (done) return; done = true; clearTimeout(to); try { this.ws && this.ws.close(); } catch (x) { } reject(e); };
      const to = setTimeout(() => fail(new Error('timeout')), timeout);
      let ws;
      try { ws = this.ws = new WebSocket(this.url, 'mqtt'); } catch (e) { fail(e); return; }
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(this.connectPacket());
      ws.onmessage = ev => {
        this.feed(new Uint8Array(ev.data), (type, flags, body) => {
          if (type === 2) { // CONNACK
            if (body[1] === 0) { this.ready = true; done = true; clearTimeout(to); this.startPing(); resolve(); this.onState && this.onState(true); }
            else fail(new Error('refused ' + body[1]));
          } else this.packet(type, flags, body);
        });
      };
      ws.onerror = () => fail(new Error('socket error'));
      ws.onclose = () => {
        const was = this.ready; this.ready = false; clearInterval(this.pingT);
        for (const [, cb] of this.acks) cb(false); this.acks.clear();
        if (!done) fail(new Error('closed'));
        else if (was && this.onState) this.onState(false);
      };
    });
  }
  close() {
    this.closed = true; clearInterval(this.pingT);
    try { if (this.ws && this.ws.readyState === 1) this.ws.send(new Uint8Array([0xe0, 0])); } catch (e) { }
    try { this.ws && this.ws.close(); } catch (e) { }
  }
  startPing() { clearInterval(this.pingT); this.pingT = setInterval(() => this.raw(new Uint8Array([0xc0, 0])), 20000); }
  raw(bytes) { if (this.ws && this.ws.readyState === 1) { this.ws.send(bytes); return true; } return false; }
  // ---- encoding ----
  static str(s) { const b = new TextEncoder().encode(s); return [b.length >> 8, b.length & 255, ...b]; }
  static packet(head, parts) {
    let len = 0; for (const p of parts) len += p.length;
    const lb = []; let x = len;
    do { let d = x % 128; x = Math.floor(x / 128); if (x > 0) d |= 128; lb.push(d); } while (x > 0);
    const out = new Uint8Array(1 + lb.length + len); out[0] = head; out.set(lb, 1);
    let o = 1 + lb.length; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  connectPacket() {
    const willFlag = this.will ? 0x04 : 0;
    const vh = [0, 4, 77, 81, 84, 84, 4, 0x02 | willFlag, 0, 45];
    const parts = [new Uint8Array(vh), new Uint8Array(MqttConn.str(this.clientId))];
    if (this.will) { parts.push(new Uint8Array(MqttConn.str(this.will.topic))); const p = new TextEncoder().encode(this.will.payload); parts.push(new Uint8Array([p.length >> 8, p.length & 255]), p); }
    return MqttConn.packet(0x10, parts);
  }
  publish(topic, payload, retain) {
    if (!this.ready) return false;
    const p = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
    return this.raw(MqttConn.packet(0x30 | (retain ? 1 : 0), [new Uint8Array(MqttConn.str(topic)), p]));
  }
  subscribe(filter) {
    return new Promise(res => {
      if (!this.ready) return res(false);
      const id = this.pid = (this.pid % 65000) + 1;
      this.acks.set(id, res);
      this.raw(MqttConn.packet(0x82, [new Uint8Array([id >> 8, id & 255, ...MqttConn.str(filter), 0])]));
      setTimeout(() => { if (this.acks.has(id)) { this.acks.delete(id); res(false); } }, 6000);
    });
  }
  unsubscribe(filter) {
    if (!this.ready) return;
    const id = this.pid = (this.pid % 65000) + 1;
    this.raw(MqttConn.packet(0xa2, [new Uint8Array([id >> 8, id & 255, ...MqttConn.str(filter)])]));
  }
  // ---- decoding ----
  feed(chunk, cb) {
    const b = new Uint8Array(this.buf.length + chunk.length); b.set(this.buf); b.set(chunk, this.buf.length);
    let o = 0;
    while (b.length - o >= 2) {
      let mul = 1, len = 0, i = o + 1, byte;
      do { if (i >= b.length) { this.buf = b.slice(o); return; } byte = b[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
      if (i + len > b.length) break;
      cb(b[o] >> 4, b[o] & 15, b.subarray(i, i + len));
      o = i + len;
    }
    this.buf = b.slice(o);
  }
  packet(type, flags, body) {
    if (type === 3) { // PUBLISH
      const tl = (body[0] << 8) | body[1];
      const topic = new TextDecoder().decode(body.subarray(2, 2 + tl));
      let o = 2 + tl; const qos = (flags >> 1) & 3;
      if (qos > 0) { const id = (body[o] << 8) | body[o + 1]; o += 2; if (qos === 1) this.raw(new Uint8Array([0x40, 2, id >> 8, id & 255])); }
      this.onPublish && this.onPublish(topic, body.slice(o), !!(flags & 1));
    } else if (type === 9) { // SUBACK
      const id = (body[0] << 8) | body[1]; const cb = this.acks.get(id);
      if (cb) { this.acks.delete(id); cb(body[2] !== 0x80); }
    }
  }
}

function topicMatch(filter, topic) {
  if (filter === topic) return true;
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

const Relay = {
  conns: [], peer: null, subs: new Map(), seen: new Set(), seenQ: [], connectP: null, live: 0, downSince: 0, errHandlers: new Set(), rooms: new Set(),
  get brokers() { return (typeof window !== 'undefined' && Array.isArray(window.__relayBrokers)) ? window.__relayBrokers : RELAY_BROKERS; },
  get connected() { return this.conns.some(c => c.ready); },
  ensure() {
    if (this.connected) return Promise.resolve();
    if (this.connectP) return this.connectP;
    if (!this.peer) this.peer = 'r' + Math.random().toString(36).slice(2, 12);
    const will = { topic: RELAY_PREFIX + 'will', payload: JSON.stringify({ t: 'b', f: this.peer }) };
    this.connectP = new Promise((resolve, reject) => {
      let pending = this.brokers.length, ok = false;
      if (!pending) { reject(new Error('No relay brokers configured.')); return; }
      this.conns = this.brokers.map(url => {
        const c = new MqttConn(url, 'ew' + this.peer + Math.random().toString(36).slice(2, 6), will);
        c.onPublish = (topic, payload, retained) => this.dispatch(topic, payload, retained, c);
        c.onState = up => this.connState(c, up);
        c.connect().then(() => { if (!ok) { ok = true; resolve(); } }, () => { this.retry(c); })
          .finally(() => { if (--pending === 0 && !ok) reject(new Error('Could not reach the multiplayer relay. Check your internet connection and try again.')); });
        return c;
      });
    }).finally(() => { this.connectP = null; });
    return this.connectP;
  },
  connState(c, up) {
    if (up) {
      this.downSince = 0;
      const back = c.everUp; c.everUp = true;
      Promise.all([...this.subs.keys()].map(f => c.subscribe(f))).then(() => {
        // after a dropped connection, say hello again so everyone re-sends their full state
        if (back) for (const r of this.rooms) if (!r.left) r.send({ t: 'h', d: r.mine });
      });
    } else {
      this.retry(c);
      if (!this.connected && !this.downSince) {
        this.downSince = Date.now();
        setTimeout(() => { if (!this.connected && this.downSince && Date.now() - this.downSince >= 19000) this.errHandlers.forEach(h => h(new Error('relay down'))); }, 20000);
      }
    }
  },
  retry(c) {
    if (c.closed || c.retrying) return;
    c.retrying = true;
    const wait = Math.min(15000, (c.backoff = (c.backoff || 1000) * 1.6));
    setTimeout(() => { c.retrying = false; if (c.closed || c.ready) return; c.connect().then(() => { c.backoff = 1000; }, () => this.retry(c)); }, wait);
  },
  dispatch(topic, payload, retained, conn) {
    for (const [f, hs] of this.subs) if (topicMatch(f, topic)) for (const h of hs) h(topic, payload, retained, conn);
  },
  /** de-duplicates live messages that arrive through both brokers */
  fresh(id) {
    if (this.seen.has(id)) return false;
    this.seen.add(id); this.seenQ.push(id);
    if (this.seenQ.length > 4000) this.seen.delete(this.seenQ.shift());
    return true;
  },
  async subscribe(filter, handler) {
    let hs = this.subs.get(filter);
    if (!hs) { hs = new Set(); this.subs.set(filter, hs); }
    hs.add(handler);
    const acks = await Promise.all(this.conns.filter(c => c.ready).map(c => c.subscribe(filter)));
    return acks.some(Boolean);
  },
  unsubscribe(filter, handler) {
    const hs = this.subs.get(filter); if (!hs) return;
    hs.delete(handler);
    if (!hs.size) { this.subs.delete(filter); for (const c of this.conns) c.unsubscribe(filter); }
  },
  publish(topic, payload, retain) {
    let any = false;
    for (const c of this.conns) if (c.publish(topic, payload, retain)) any = true;
    return any;
  },
};

/* ---------- direct peer-to-peer links (WebRTC), signalled through the relay ---------- */
const RTC_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
class PeerLink {
  constructor(room, peer, initiator) {
    this.room = room; this.peer = peer; this.initiator = initiator; this.open = false; this.failed = false; this.rtt = 0; this.pendingC = []; this.audio = null;
    const pc = this.pc = new RTCPeerConnection({ iceServers: RTC_ICE });
    pc.onicecandidate = e => { if (e.candidate) room.signal(peer, { c: e.candidate.toJSON() }); };
    pc.ontrack = e => { if (typeof Voice !== 'undefined') Voice.remoteTrack(peer, e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track])); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.fail(); };
    if (initiator) {
      this.bind(pc.createDataChannel('g', { ordered: true }));
      this.audio = pc.addTransceiver('audio', { direction: 'sendrecv' });
      this.offer();
    } else pc.ondatachannel = e => this.bind(e.channel);
    this.timer = setTimeout(() => { if (!this.open) this.fail(); }, 16000);
  }
  async offer() {
    try { await this.pc.setLocalDescription(await this.pc.createOffer()); this.room.signal(this.peer, { sdp: this.pc.localDescription.toJSON() }); }
    catch (e) { this.fail(); }
  }
  async onSignal(d) {
    if (this.failed) return;
    const pc = this.pc;
    try {
      if (d.sdp && d.sdp.type) {
        await pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') {
          const tr = pc.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
          if (tr) { tr.direction = 'sendrecv'; this.audio = tr; }
          await pc.setLocalDescription(await pc.createAnswer());
          this.room.signal(this.peer, { sdp: pc.localDescription.toJSON() });
        }
        for (const c of this.pendingC.splice(0)) await pc.addIceCandidate(c).catch(() => { });
      } else if (d.c) {
        if (pc.remoteDescription) await pc.addIceCandidate(d.c).catch(() => { });
        else this.pendingC.push(d.c);
      }
    } catch (e) { this.fail(); }
  }
  bind(dc) {
    this.dc = dc;
    dc.onopen = () => {
      this.open = true; clearTimeout(this.timer);
      this.pingT = setInterval(() => this.raw(JSON.stringify({ t: 'pi', ts: performance.now() })), 2000);
      this.raw(JSON.stringify({ t: 'pi', ts: performance.now() }));
      this.room.linkChanged(this);
      if (typeof Voice !== 'undefined') Voice.attach(this);
    };
    dc.onmessage = e => {
      const txt = typeof e.data === 'string' ? e.data : '';
      if (txt.startsWith('{"t":"pi"')) { try { this.raw(JSON.stringify({ t: 'po', ts: JSON.parse(txt).ts })); } catch (x) { } return; }
      if (txt.startsWith('{"t":"po"')) { try { const r = performance.now() - JSON.parse(txt).ts; this.rtt = this.rtt ? this.rtt * 0.7 + r * 0.3 : r; } catch (x) { } return; }
      this.room.onMsg(null, txt);
    };
    dc.onclose = () => { if (this.open) { this.open = false; this.room.linkChanged(this); } };
  }
  raw(s) { if (this.open && this.dc && this.dc.readyState === 'open') { try { this.dc.send(s); return true; } catch (e) { } } return false; }
  fail() {
    if (this.failed) return;
    this.failed = true; this.open = false; clearTimeout(this.timer); clearInterval(this.pingT);
    try { this.pc.close(); } catch (e) { }
    this.room.linkChanged(this);
  }
  close() { this.failed = true; this.open = false; clearTimeout(this.timer); clearInterval(this.pingT); try { this.dc && this.dc.close(); } catch (e) { } try { this.pc.close(); } catch (e) { } }
}

/* ---------- presence rooms (same shape as the claude.ai room API) ---------- */
class RelayRoom {
  constructor(name) {
    this.name = name; this.topic = RELAY_PREFIX + 'room/' + name;
    this.id = Relay.peer + '~' + Math.random().toString(36).slice(2, 8); // one id per visit, so rejoining starts clean
    this.mine = {}; this.others = new Map(); this.handlers = []; this.errs = []; this.seq = 0; this.left = false;
    this.onMsg = this.onMsg.bind(this); this.onWill = this.onWill.bind(this); this.onDown = e => this.errs.forEach(f => f(e));
    this.links = new Map(); this.p2p = typeof RTCPeerConnection !== 'undefined';
  }
  /** connection details for the player list: direct link or relay, and round-trip time */
  info(peer) {
    const l = this.links.get(peer), p = this.others.get(peer);
    if (l && l.open) return { direct: true, rtt: Math.round(l.rtt) };
    return { direct: false, rtt: p && p.rtt ? Math.round(p.rtt) : 0, connecting: !!(l && !l.failed) };
  }
  get allDirect() { if (!this.others.size) return false; for (const p of this.others.keys()) { const l = this.links.get(p); if (!l || !l.open) return false; } return true; }
  signal(to, d) { this.send({ t: 'sig', to, d }); }
  ensureLink(peer) {
    if (!this.p2p || this.left) return;
    const l = this.links.get(peer);
    if (l && !l.failed) return;
    if (l && l.failed && Date.now() - (l.failedAt || (l.failedAt = Date.now())) < 45000) return; // wait before trying again
    if (this.id < peer) this.links.set(peer, new PeerLink(this, peer, true));
  }
  linkChanged(l) {
    if (l.failed) l.failedAt = Date.now();
    if (typeof Net !== 'undefined' && Net.room === this) UI.partyChanged();
  }
  async start() {
    await Relay.subscribe(this.topic, this.onMsg);
    await Relay.subscribe(RELAY_PREFIX + 'will', this.onWill);
    Relay.errHandlers.add(this.onDown);
    Relay.rooms.add(this);
    this.send({ t: 'h', d: this.mine });
    this.kaT = setInterval(() => {
      this.send({ t: 'k' }); this.prune();
      // round-trip times for players we can only reach through the relay
      for (const p of this.others.values()) { const l = this.links.get(p.peer); if (!l || !l.open) this.send({ t: 'pi', to: p.peer, ts: performance.now() }); this.ensureLink(p.peer); }
    }, 4000);
    return this;
  }
  send(o) {
    o.f = this.id; o.s = ++this.seq;
    const s = JSON.stringify(o);
    if (s.length > RELAY_MAX) throw Object.assign(new Error('presence too large'), { code: 'invalid_argument' });
    // state updates go straight to players we have a direct link with; the relay carries the rest
    let viaRelay = o.t !== 'p' || !this.others.size;
    if (!viaRelay) for (const p of this.others.keys()) { const l = this.links.get(p); if (!l || !l.raw(s)) viaRelay = true; }
    if (viaRelay) Relay.publish(this.topic, s, false);
  }
  me() { return { peer: this.id, isMe: true, sameTab: true, kind: 'viewer', guest: true, presence: Object.freeze(Object.assign({}, this.mine)), updatedAt: Date.now() }; }
  view(p) { return { peer: p.peer, isMe: false, sameTab: false, kind: 'viewer', guest: true, presence: Object.freeze(Object.assign({}, p.state)), updatedAt: p.seen }; }
  peers() { return [this.me(), ...[...this.others.values()].map(p => this.view(p))]; }
  emit(joined, left, updated) {
    if (!joined.length && !left.length && !updated.length) return;
    const ch = { peers: this.peers(), joined: joined.map(p => this.view(p)), left: left.map(p => this.view(p)), updated: updated.map(p => this.view(p)) };
    this.handlers.forEach(h => { try { h(ch); } catch (e) { console.error(e); } });
  }
  presence(patch) {
    for (const k in patch) { if (patch[k] === null) delete this.mine[k]; else this.mine[k] = patch[k]; }
    try { this.send({ t: 'p', d: patch }); } catch (e) { return Promise.reject(e); }
    return Promise.resolve();
  }
  onPeers(h, err) {
    this.handlers.push(h); if (err) this.errs.push(err);
    setTimeout(() => h({ peers: this.peers(), joined: this.peers(), left: [], updated: [] }), 0);
    return () => { const i = this.handlers.indexOf(h); if (i >= 0) this.handlers.splice(i, 1); const j = this.errs.indexOf(err); if (j >= 0) this.errs.splice(j, 1); };
  }
  apply(p, data, s, full) {
    if (!data || typeof data !== 'object') return;
    if (full) for (const k of Object.keys(p.state)) if (!(k in data) && (p.fs[k] || 0) < s) delete p.state[k];
    for (const k in data) {
      if ((p.fs[k] || 0) > s) continue; // a newer value already arrived through the other broker
      p.fs[k] = s;
      if (data[k] === null) delete p.state[k]; else p.state[k] = data[k];
    }
  }
  onMsg(topic, payload) {
    if (this.left) return;
    let o; try { o = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder().decode(payload)); } catch (e) { return; }
    if (!o || typeof o.f !== 'string' || o.f === this.id || typeof o.s !== 'number') return;
    if (!Relay.fresh(this.topic + o.f + ':' + o.s)) return;
    if (o.t === 'sig') {
      if (o.to !== this.id || !this.p2p || !o.d) return;
      let l = this.links.get(o.f);
      if (o.d.sdp && o.d.sdp.type === 'offer' && (!l || l.failed)) {
        if (l) l.close();
        l = new PeerLink(this, o.f, false); this.links.set(o.f, l);
        const early = this.earlyC && this.earlyC.get(o.f); if (early) { l.pendingC.push(...early); this.earlyC.delete(o.f); }
      }
      if (l) l.onSignal(o.d);
      else if (o.d.c) { // a candidate that overtook its offer on the other broker
        if (!this.earlyC) this.earlyC = new Map();
        const a = this.earlyC.get(o.f) || []; a.push(o.d.c); this.earlyC.set(o.f, a.slice(-30));
      }
      return;
    }
    if (o.t === 'pi') { if (o.to === this.id) this.send({ t: 'po', to: o.f, ts: o.ts }); return; }
    if (o.t === 'po') {
      if (o.to === this.id) { const q = this.others.get(o.f); if (q && typeof o.ts === 'number') { const r = performance.now() - o.ts; q.rtt = q.rtt ? q.rtt * 0.7 + r * 0.3 : r; } }
      return;
    }
    let p = this.others.get(o.f), joined = false;
    if (o.t === 'b') { if (p) { this.others.delete(o.f); this.dropLink(o.f); this.emit([], [p], []); } return; }
    if (!p) { p = { peer: o.f, state: {}, fs: {}, seen: Date.now() }; this.others.set(o.f, p); joined = true; }
    p.seen = Date.now();
    if (o.t === 'h' || o.t === 'f') this.apply(p, o.d, o.s, true);
    else if (o.t === 'p') this.apply(p, o.d, o.s, false);
    // a newcomer (or anyone we've never heard of) gets our whole state
    if (o.t === 'h' || (joined && o.t !== 'f')) {
      clearTimeout(this.fullT); this.fullT = setTimeout(() => { if (!this.left) this.send({ t: 'f', d: this.mine }); }, 60 + Math.random() * 140);
    }
    if (joined) this.ensureLink(o.f);
    if (o.t === 'k' && !joined) return;
    this.emit(joined ? [p] : [], [], joined ? [] : [p]);
  }
  dropLink(peer) {
    const l = this.links.get(peer); if (l) { l.close(); this.links.delete(peer); }
    if (typeof Voice !== 'undefined') Voice.removePeer(peer);
  }
  onWill(topic, payload) {
    let o; try { o = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
    if (!o || typeof o.f !== 'string') return;
    const gone = [...this.others.values()].filter(p => p.peer.split('~')[0] === o.f);
    gone.forEach(p => { this.others.delete(p.peer); this.dropLink(p.peer); });
    if (gone.length) this.emit([], gone, []);
  }
  prune() {
    const now = Date.now(), gone = [];
    for (const p of this.others.values()) if (now - p.seen > 15000) gone.push(p);
    gone.forEach(p => { this.others.delete(p.peer); this.dropLink(p.peer); });
    if (gone.length) this.emit([], gone, []);
  }
  async leave() {
    if (this.left) return; this.left = true;
    clearInterval(this.kaT); clearTimeout(this.fullT);
    Relay.rooms.delete(this);
    for (const peer of [...this.links.keys()]) this.dropLink(peer);
    try { this.seq++; Relay.publish(this.topic, JSON.stringify({ t: 'b', f: this.id, s: this.seq }), false); } catch (e) { }
    Relay.unsubscribe(this.topic, this.onMsg); Relay.unsubscribe(RELAY_PREFIX + 'will', this.onWill);
    Relay.errHandlers.delete(this.onDown);
  }
}
const RelayRooms = {
  async join(name) {
    await Relay.ensure();
    return new RelayRoom(String(name)).start();
  },
};

/* ---------- shared documents as retained messages ---------- */
function relayTopic(path) { return RELAY_PREFIX + 'db/' + String(path).split('/').map(seg => [...seg].map(ch => (ch === '+' || ch === '#' || ch.codePointAt(0) < 32) ? '_' : ch).join('')).join('/'); }
function relaySnap(path, val) {
  return { id: path.split('/').pop(), exists: val !== null && val !== undefined, data: () => (val === null || val === undefined) ? undefined : JSON.parse(JSON.stringify(val)) };
}
/** wait for the retained messages on a filter: resolves shortly after every broker has answered */
async function relayCollect(filter, settle) {
  await Relay.ensure();
  const got = new Map(); // topic -> {ts, d}
  const h = (topic, payload) => {
    if (!payload.length) { if (!got.has(topic)) got.set(topic, null); return; }
    try {
      const o = JSON.parse(new TextDecoder().decode(payload));
      const cur = got.get(topic);
      if (o && typeof o.ts === 'number' && (!cur || o.ts >= cur.ts)) got.set(topic, o);
    } catch (e) { }
  };
  await Relay.subscribe(filter, h);
  await sleep(settle);
  Relay.unsubscribe(filter, h);
  return got;
}
const RelayDB = {
  doc(path) {
    path = String(path);
    return {
      id: path.split('/').pop(), path,
      async get() { const got = await relayCollect(relayTopic(path), 650); const v = got.get(relayTopic(path)); return relaySnap(path, v ? v.d : null); },
      async set(d) {
        await Relay.ensure();
        const s = JSON.stringify({ ts: Date.now(), d });
        if (s.length > RELAY_MAX) throw Object.assign(new Error('Document too large for the relay.'), { code: 'invalid_argument' });
        if (!Relay.publish(relayTopic(path), s, true)) throw Object.assign(new Error('Relay unavailable'), { code: 'unavailable' });
      },
      async update(d) {
        const cur = await this.get();
        if (!cur.exists) throw Object.assign(new Error('Document does not exist'), { code: 'not_found' });
        await this.set(Object.assign(cur.data(), d));
      },
      async delete() { await Relay.ensure(); Relay.publish(relayTopic(path), new Uint8Array(0), true); },
      collection: sub => RelayDB.collection(path + '/' + sub),
    };
  },
  collection(path) {
    path = String(path);
    return {
      path, doc: id => RelayDB.doc(path + '/' + (id || newId())),
      async get() {
        const got = await relayCollect(relayTopic(path) + '/+', 1100);
        const docs = [];
        for (const [topic, v] of got) if (v) docs.push(relaySnap(path + '/' + topic.split('/').pop(), v.d));
        return { docs, size: docs.length, empty: !docs.length };
      },
    };
  },
};

/* ---------- big text values (world edits) split across documents ---------- */
const Shared = {
  get chunk() { return Cloud.mode === 'relay' ? RELAY_CHUNK : PART; },
  async putText(colPath, text, extra) {
    const db = Cloud.sdb, parts = [];
    for (let i = 0; i < text.length; i += this.chunk) parts.push(text.slice(i, i + this.chunk));
    const col = db.collection(colPath);
    for (let i = 0; i < parts.length; i++) await col.doc('p' + i).set({ s: parts[i] });
    await col.doc('meta').set(Object.assign({}, extra || {}, { parts: parts.length, len: text.length, updated: Date.now() }));
  },
  async getText(colPath) {
    const db = Cloud.sdb, col = db.collection(colPath);
    const m = await col.doc('meta').get();
    if (!m.exists) return null;
    const meta = m.data() || {}, n = clamp(meta.parts | 0, 0, 200);
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => col.doc('p' + i).get().then(p => p.exists ? String(p.data().s || '') : null)));
    if (parts.some(p => p === null)) return { meta, text: null };
    const text = parts.join('');
    return { meta, text: meta.len === undefined || meta.len === text.length ? text : null };
  },
  async removeText(colPath) {
    const db = Cloud.sdb, col = db.collection(colPath);
    try {
      const m = await col.doc('meta').get();
      const n = m.exists ? clamp(m.data().parts | 0, 0, 200) : 0;
      for (let i = 0; i < n; i++) await col.doc('p' + i).delete();
      await col.doc('meta').delete();
    } catch (e) { }
  },
};
