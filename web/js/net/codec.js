// Wire format of BomberMan.exe (see bmoserver/codec.py and docs/PROTOCOL.md).
//   frame   = "#%" type:u8 len:i16 body[len-2] ":/"
//   MESSAGE = id:u16 len:u16 data

export const T_ENC = 1, T_PLAIN = 2, T_GAME_ENC = 3, T_GAME = 4, T_MSG_ENC2 = 5, T_GAME2 = 6;
export const PROTOCOL_VERSION = 0x0835;

export class Cipher {
  constructor(key = 0, mode = 0) { this.key = key & 0xff; this.mode = mode; }

  static fromHello(d) {
    const hx = (c) => (c >= 0x30 && c <= 0x39) ? c - 0x30 : (c >= 0x41 && c <= 0x46) ? c - 0x37 : -1;
    const mode = (d[7] << 24) >> 24;
    return new Cipher((hx(d[9]) * 16 + hx(d[5])) & 0xff, mode);
  }

  encrypt(data) {
    const n = data.length, out = new Uint8Array(n), k = this.key;
    for (let i = 0; i < n; i++) out[i] = (data[this.mode === 1 ? i : n - 1 - i] + k) & 0xff;
    return out;
  }

  decrypt(data) {
    const n = data.length, out = new Uint8Array(n), k = this.key;
    for (let i = 0; i < n; i++) out[this.mode === 1 ? i : n - 1 - i] = (data[i] - k) & 0xff;
    return out;
  }
}

export function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function packMsg(id, data = new Uint8Array(0)) {
  const out = new Uint8Array(4 + data.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, id, true);
  v.setUint16(2, data.length, true);
  out.set(data, 4);
  return out;
}

export function frame(type, body) {
  const out = new Uint8Array(body.length + 7);
  out[0] = 0x23; out[1] = 0x25; out[2] = type;
  new DataView(out.buffer).setInt16(3, body.length + 2, true);
  out.set(body, 5);
  out[out.length - 2] = 0x3a; out[out.length - 1] = 0x2f;
  return out;
}

export class Deframer {
  constructor() { this.buf = new Uint8Array(0); }

  feed(chunk) {
    this.buf = concat(this.buf, chunk);
    const frames = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 5) break;
      if (b[0] !== 0x23 || b[1] !== 0x25 || b[2] < 1 || b[2] > 6) {
        let j = -1;
        for (let i = 1; i < b.length - 1; i++) if (b[i] === 0x23 && b[i + 1] === 0x25) { j = i; break; }
        this.buf = j < 0 ? new Uint8Array(0) : b.slice(j);
        continue;
      }
      const n = new DataView(b.buffer, b.byteOffset).getInt16(3, true);
      if (n < 2) { this.buf = b.slice(2); continue; }
      if (b.length < n + 5) break;
      frames.push({ type: b[2], body: b.slice(5, 5 + n - 2) });
      this.buf = b.slice(n + 5);
    }
    return frames;
  }
}

// Little helpers for building and reading binary records.
export class Writer {
  constructor(size = 64) { this.buf = new Uint8Array(size); this.v = new DataView(this.buf.buffer); this.n = 0; }
  grow(k) {
    if (this.n + k <= this.buf.length) return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    nb.set(this.buf); this.buf = nb; this.v = new DataView(nb.buffer);
  }
  u8(x) { this.grow(1); this.v.setUint8(this.n, x & 0xff); this.n += 1; return this; }
  i16(x) { this.grow(2); this.v.setInt16(this.n, x, true); this.n += 2; return this; }
  u16(x) { this.grow(2); this.v.setUint16(this.n, x & 0xffff, true); this.n += 2; return this; }
  i32(x) { this.grow(4); this.v.setInt32(this.n, x, true); this.n += 4; return this; }
  u32(x) { this.grow(4); this.v.setUint32(this.n, x >>> 0, true); this.n += 4; return this; }
  bytes(b) { this.grow(b.length); this.buf.set(b, this.n); this.n += b.length; return this; }
  zeros(k) { this.grow(k); this.n += k; return this; }
  cstr(s, size) { const b = encodeText(s).slice(0, size - 1); this.bytes(b); return this.zeros(size - b.length); }
  chat(s, size) { const b = encodeChat(s, size - 1); this.bytes(b); return this.zeros(size - b.length); }
  done() { return this.buf.slice(0, this.n); }
}

export class Reader {
  constructor(data, off = 0) { this.d = data; this.v = new DataView(data.buffer, data.byteOffset, data.byteLength); this.o = off; }
  u8(at) { return this.v.getUint8(at); }
  i8(at) { return this.v.getInt8(at); }
  i16(at) { return at + 2 <= this.d.length ? this.v.getInt16(at, true) : 0; }
  u16(at) { return at + 2 <= this.d.length ? this.v.getUint16(at, true) : 0; }
  i32(at) { return at + 4 <= this.d.length ? this.v.getInt32(at, true) : 0; }
  u32(at) { return at + 4 <= this.d.length ? this.v.getUint32(at, true) : 0; }
  cstr(at, size) { return decodeText(this.d.subarray(at, Math.min(this.d.length, at + size))); }
  chat(at, size) { return decodeChat(this.d.subarray(at, Math.min(this.d.length, at + size))); }
}

// The game uses Shift-JIS (cp932). Browsers can decode it but not encode it, so outgoing text (names of rooms, the
// sign-in) is limited to ASCII (anything else becomes "?"), which is also all the original client could type on a
// non-Japanese keyboard. The chat is UTF-8 (encodeChat, below).
const sjis = new TextDecoder("shift_jis");
export function decodeText(bytes) {
  let n = bytes.indexOf(0);
  if (n < 0) n = bytes.length;
  return sjis.decode(bytes.subarray(0, n));
}
// The game's text is ASCII here (BomberMan.exe's cp932): an accented letter goes without its accent ("manutenção":
// "manutencao"), anything else as "?"
export function encodeText(s) {
  s = String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c >= 0x20 && c < 0x7f ? c : 0x3f;
  }
  return out;
}

// Chat is UTF-8 between the server and the browser, accents and all (the hello 0x4b1 says "a web client"; the server
// writes BomberMan.exe's in cp932, without the accents): what was typed, as bytes, at most `most`, never half a letter
const utf8In = new TextDecoder("utf-8"), utf8Out = new TextEncoder();
export function encodeChat(s, most = 280) {
  const b = utf8Out.encode(String(s).normalize("NFC"));
  let n = Math.min(b.length, most);
  while (n > 0 && n < b.length && (b[n] & 0xc0) === 0x80) n--;        // (a letter's later bytes: 10xxxxxx)
  return b.subarray(0, n);
}
export function decodeChat(bytes) {
  let n = bytes.indexOf(0);
  if (n < 0) n = bytes.length;
  return utf8In.decode(bytes.subarray(0, n));
}

export function hex(n, w = 4) { return "0x" + n.toString(16).padStart(w, "0"); }
