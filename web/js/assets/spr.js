// Decoder for the game's .spr / .gra sprite files (docs/client/F_render.md).
//
//   00 00 01 01  kind:u8  frames:u8  b6:u8 ...  width:u16 @0x0b  height:u16 @0x0d
//   frame end offsets: frames x u32 @0x13 (in 16-bit words from the data start)
//   data start = 0x13 + 4 * frames; each frame = runs { x:u16, y:u16, n:u16, n x RGB565 }
//
// The kind byte (0 or 3) does not change how a sprite is drawn: every file is plain RGB565 and
// shadows are all-black sprites that the game blends at 50 %.

const cache = new Map();

export class Sprite {
  constructor(path, buf) {
    const b = new Uint8Array(buf);
    const v = new DataView(buf);
    if (b[0] !== 0 || b[1] !== 0 || b[2] !== 1 || b[3] !== 1) throw new Error(`${path}: not a sprite file`);
    this.path = path;
    this.kind = b[4];
    this.count = b[5];
    this.b6 = b[6];
    this.w = v.getUint16(0x0b, true);
    this.h = v.getUint16(0x0d, true);
    this.raw = [];
    const base = 0x13 + 4 * this.count;
    let start = 0;
    for (let i = 0; i < this.count; i++) {
      const end = v.getUint32(0x13 + 4 * i, true);
      this.raw.push({ from: base + 2 * start, to: base + 2 * end });
      start = end;
    }
    this.view = v;
    this.canvases = new Map();   // "frame|variant" -> canvas
  }

  // Pixel runs of frame i: calls fn(x, y, rgb565) for every opaque pixel.
  eachPixel(i, fn) {
    const { from, to } = this.raw[i];
    const v = this.view;
    let p = from;
    while (p + 6 <= to) {
      const x = v.getUint16(p, true), y = v.getUint16(p + 2, true), n = v.getUint16(p + 4, true);
      p += 6;
      for (let k = 0; k < n; k++, p += 2) fn(x + k, y, v.getUint16(p, true));
    }
  }

  // Canvas with frame i. `recolor(rgb565) -> [r,g,b]` optionally changes colours (character colours).
  frame(i, recolor = null, variant = "") {
    i = Math.max(0, Math.min(this.count - 1, i | 0));
    const key = i + "|" + variant;
    let c = this.canvases.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(this.w, this.h);
    const d = img.data, w = this.w, h = this.h;
    this.eachPixel(i, (x, y, px) => {
      if (x >= w || y >= h) return;
      const o = (y * w + x) * 4;
      let r, g, b;
      if (recolor) [r, g, b] = recolor(px);
      else { r = (px >> 11) & 31; g = (px >> 5) & 63; b = px & 31; r = (r << 3) | (r >> 2); g = (g << 2) | (g >> 4); b = (b << 3) | (b >> 2); }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    });
    ctx.putImageData(img, 0, 0);
    this.canvases.set(key, c);
    return c;
  }

  // Bounding box of the opaque pixels of frame i (for previews).
  bbox(i) {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    this.eachPixel(i, (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; });
    return x1 < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}

export function loadSprite(path) {
  const key = path.toLowerCase();
  let p = cache.get(key);
  if (!p) {
    p = fetch("data/" + path).then((r) => {
      if (!r.ok) throw new Error(`missing game file Data/${path}`);
      return r.arrayBuffer();
    }).then((buf) => new Sprite(path, buf));
    cache.set(key, p);
  }
  return p;
}

export function loadBinary(path) {
  return fetch("data/" + path).then((r) => {
    if (!r.ok) throw new Error(`missing game file Data/${path}`);
    return r.arrayBuffer();
  });
}
