// One TCP-equivalent connection to the login server or a channel, tunnelled through
// the server's WebSocket bridge (/ws/<port>). Behaves like BomberMan.exe's network layer:
// takes the cipher key from the 0x426 hello, pre-increments a counter for type-1 frames,
// switches to cipher2 (key from 0x7ef) and frame type 5 while in a match.

import { Cipher, Deframer, T_ENC, T_PLAIN, T_GAME_ENC, T_GAME, T_MSG_ENC2, T_GAME2, concat, frame, packMsg, hex } from "./codec.js";

export const DEBUG = { net: false };

export class Connection extends EventTarget {
  constructor(port) {
    super();
    this.port = port;
    this.cipher = new Cipher(0, 0);
    this.cipher2 = new Cipher(0, 0);
    this.counter = 0;
    this.gameMode = false;
    this.deframer = new Deframer();
    this.closed = false;
    this.waiters = [];
    this.backlog = [];          // recent messages nobody waited for (several can arrive in one chunk)
    this.held = null;           // frames kept while something is set up (hold / release)
    this.closeInfo = null;      // how the WebSocket ended: {code, reason, clean}
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${proto}//${location.host}/ws/${port}`);
    this.ws.binaryType = "arraybuffer";
    this.opened = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("cannot connect to the server"));
    });
    this.ws.onmessage = (ev) => this.onData(new Uint8Array(ev.data));
    this.ws.onclose = (ev) => {
      this.closed = true;
      this.closeInfo = { code: ev.code, reason: String(ev.reason || "").slice(0, 60), clean: !!ev.wasClean };
      for (const w of this.waiters) w.reject(new Error("connection closed"));
      this.waiters = [];
      this.dispatchEvent(new CustomEvent("close", { detail: this.closeInfo }));
    };
  }

  close() {
    this.closed = true;
    try { this.ws.close(); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ receive
  onData(chunk) {
    for (const f of this.deframer.feed(chunk)) {
      if (this.held) this.held.push(f);
      else this.handle(f);
    }
  }

  handle({ type, body }) {
    try {
      this.onFrame(type, body);
    } catch (e) {
      console.error("frame handling failed", e);
    }
  }

  // Keep the frames that arrive until release() (at most `ms`): the match being set up after 0x7dc (its code loads
  // first: session.js), so what the server sends right after it (a player coming back gets it all at once) reaches it
  hold(ms = 5000) {
    this.held = this.held || [];
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => this.release(), ms);
  }

  release() {
    clearTimeout(this.holdTimer);
    const held = this.held || [];
    this.held = null;
    while (held.length && !this.held) this.handle(held.shift());
    if (this.held) this.held.unshift(...held);       // (held again meanwhile: the rest first)
  }

  onFrame(type, body) {
    let plain;
    switch (type) {
      case T_PLAIN: return this.onMessage(body.subarray(4));
      case T_ENC: plain = this.cipher.decrypt(body); return this.onMessage(plain.subarray(4));
      case T_MSG_ENC2: return this.onMessage(this.cipher2.decrypt(body));
      case T_GAME_ENC: return this.onGame(type, this.cipher2.decrypt(body));
      case T_GAME: case T_GAME2: return this.onGame(type, body);
    }
  }

  onMessage(raw) {
    const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const id = v.getUint16(0, true), n = v.getUint16(2, true);
    const data = raw.slice(4, 4 + n);
    if (id === 0x426) this.cipher = Cipher.fromHello(data);
    if (id === 0x7ef) this.cipher2 = Cipher.fromHello(data);
    if (DEBUG.net) console.debug("S->C", hex(id), data);
    const w = this.waiters.find((x) => x.id === id);
    if (w) {
      this.waiters.splice(this.waiters.indexOf(w), 1);
      clearTimeout(w.timer);
      w.resolve(data);
    } else {
      this.backlog.push({ id, data, at: performance.now() });
      if (this.backlog.length > 32) this.backlog.shift();
    }
    this.dispatchEvent(new CustomEvent("message", { detail: { id, data } }));
  }

  onGame(type, pkt) {
    this.dispatchEvent(new CustomEvent("game", { detail: { type, pkt } }));
  }

  // Resolve with the data of the next message `id`.
  expect(id, timeoutMs = 8000) {
    const now = performance.now();
    this.backlog = this.backlog.filter((m) => now - m.at < 10000);
    const i = this.backlog.findIndex((m) => m.id === id);
    if (i >= 0) return Promise.resolve(this.backlog.splice(i, 1)[0].data);
    return new Promise((resolve, reject) => {
      const w = { id, resolve, reject };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`no answer from the server (${hex(id)})`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  // ------------------------------------------------------------------ send
  raw(bytes) {
    if (!this.closed && this.ws.readyState === WebSocket.OPEN) this.ws.send(bytes);
  }

  send(id, data = new Uint8Array(0)) {
    if (DEBUG.net) console.debug("C->S", hex(id), data);
    const msg = packMsg(id, data);
    if (this.gameMode) return this.raw(frame(T_MSG_ENC2, this.cipher2.encrypt(msg)));
    this.counter = (this.counter + 1) >>> 0;
    const c = new Uint8Array(4);
    new DataView(c.buffer).setUint32(0, this.counter, true);
    this.raw(frame(T_ENC, this.cipher.encrypt(concat(c, msg))));
  }

  // Compact game request to the server (frame type 3 = cipher2(packet + 4 zero bytes)).
  sendGame(pkt) { this.raw(frame(T_GAME_ENC, this.cipher2.encrypt(concat(pkt, new Uint8Array(4))))); }

  // Movement etc. relayed verbatim to the other players (frame type 4).
  sendRelay(pkt) { this.raw(frame(T_GAME, pkt)); }

  // In-game chat, relayed to everyone including us (frame type 6).
  sendChat(pkt) { this.raw(frame(T_GAME2, pkt)); }
}
