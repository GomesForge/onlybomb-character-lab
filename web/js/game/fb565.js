// Software frame buffer like BomberMan.exe's: 800x600 RGB565, every sprite blitted in integer
// 565 space with the client's blend rules, converted to RGBA once per frame (docs/client/F_render.md §3).

// Screen size: the exe's 800x600, bigger for a web-only arena (match.js). Live bindings like mapdata's W / H.
// The frame that reaches the page can be wider than the screen: SIDE pixels of side art at its left and its right
// (sideart.js, on a page wider than 4:3). The game draws in the screen's positions, never past its edges.
export let SW = 800, SH = 600, SIDE = 0;
export function setScreen(w, h, side = 0) { SW = w; SH = h; SIDE = side; }

const SHORT_RUN = 40;              // FB.opaque: runs up to this long are copied pixel by pixel (faster than a subarray)

// RGB565 -> RGBA (little-endian Uint32) lookup
const LUT = new Uint32Array(65536);
for (let v = 0; v < 65536; v++) {
  const r5 = v >> 11, g6 = (v >> 5) & 63, b5 = v & 31;
  const r = (r5 << 3) | (r5 >> 2), g = (g6 << 2) | (g6 >> 4), b = (b5 << 3) | (b5 >> 2);
  LUT[v] = (0xff << 24) | (b << 16) | (g << 8) | r;
}

export function rgb565(r, g, b) { return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3); }

// Per-channel a/32 blend with both terms truncated separately (FUN_0042c600).
function alpha565(d, s, a) {
  const ia = 32 - a;
  return (((((d >> 11) * ia) >> 5) + (((s >> 11) * a) >> 5)) << 11)
    | ((((((d >> 5) & 63) * ia) >> 5) + ((((s >> 5) & 63) * a) >> 5)) << 5)
    | ((((d & 31) * ia) >> 5) + (((s & 31) * a) >> 5));
}

// ------------------------------------------------------------------ sprite runs
// A sprite frame in blit form: runs[] = x, y, n, pixelOffset (Int32 quads) into px.
export class Runs {
  constructor(frames, px, w, h) { this.frames = frames; this.px = px; this.w = w; this.h = h; this.n = frames.length; }

  static fromSprite(spr) {
    if (spr._runs) return spr._runs;
    const v = spr.view, frames = [];
    let total = 0;
    for (const { from, to } of spr.raw) total += (to - from) >> 1;
    const px = new Uint16Array(total);
    let o = 0;
    for (const { from, to } of spr.raw) {
      const q = [];
      let p = from;
      while (p + 6 <= to) {
        const x = v.getUint16(p, true), y = v.getUint16(p + 2, true), n = v.getUint16(p + 4, true);
        p += 6;
        q.push(x, y, n, o);
        for (let k = 0; k < n; k++, p += 2) px[o++] = v.getUint16(p, true);
      }
      frames.push(Int32Array.from(q));
    }
    spr._runs = new Runs(frames, px, spr.w, spr.h);
    return spr._runs;
  }

  frame(i) { return this.frames[Math.max(0, Math.min(this.n - 1, i | 0))]; }

  // Load-time recolouring FUN_0042d2b0: grey pixels (R5 == G6>>1 == B5) are tinted towards (R,G,B).
  tinted(R, G, B) {
    const px = new Uint16Array(this.px.length);
    const tint = (C, L) => (L < 128 ? Math.trunc(C * L / 128) : Math.trunc(C + (256 - C) * (L - 128) / 128));
    for (let i = 0; i < px.length; i++) {
      const s = this.px[i], r5 = s >> 11, g5 = (s >> 6) & 31, b5 = s & 31;
      if (r5 === g5 && g5 === b5) {
        const L = b5 << 3;
        const r = tint(R, L), g = tint(G, L), b = tint(B, L);
        px[i] = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
      } else px[i] = s;
    }
    return new Runs(this.frames, px, this.w, this.h);
  }
}

// .eft effect: u32 N, W, H, then N frames x 8 layers {u32 words, runs}; layer = alpha level (F_render §7).
export class Eft {
  constructor(buf) {
    const v = new DataView(buf);
    this.n = v.getUint32(0, true);
    this.w = v.getUint32(4, true);
    this.h = v.getUint32(8, true);
    this.frames = [];
    let p = 12;
    const all = [];
    let total = 0;
    for (let f = 0; f < this.n; f++) {
      const layers = [];
      for (let l = 0; l < 8; l++) {
        const words = v.getUint32(p, true);
        p += 4;
        const end = p + words * 2, q = [];
        while (p + 6 <= end) {
          const x = v.getUint16(p, true), y = v.getUint16(p + 2, true), n = v.getUint16(p + 4, true);
          p += 6;
          q.push(x, y, n, total);
          for (let k = 0; k < n; k++, p += 2) { all.push(v.getUint16(p, true)); total++; }
        }
        p = end;
        layers.push(q.length ? Int32Array.from(q) : null);
      }
      this.frames.push(layers);
    }
    this.px = Uint16Array.from(all);
  }
}

export const EFT_STD = [2, 7, 10, 15, 18, 22, 28, 30];
export const EFT_PLAYER = [1, 4, 7, 10, 13, 17, 20, 25];
export const EFT_ITEM = [1, 3, 6, 8, 10, 12, 15, 25];

// ------------------------------------------------------------------ 6x12 bitmap font (Data/font/Font_Eng_6.fnt)
let fontBits = null;
export function setFont(buf) { fontBits = new Uint8Array(buf); }
const textCache = new Map();
const TOP = 4;                     // mask rows over the 12 px cell: a capital's accent, then the outline

// Accented letters, which the game's font lacks: the plain letter and its mark, in the cell's rows (a capital's goes 3
// rows higher, over it; the cedilla under the letter). An i or j loses its dot under one.
const MARKS = {
  0x300: [[2, 0], [3, 1]],                                     // grave: à
  0x301: [[4, 0], [3, 1]],                                     // acute: á
  0x302: [[3, 0], [2, 1], [4, 1]],                             // circumflex: â
  0x303: [[2, 0], [3, 0], [5, 0], [1, 1], [4, 1]],             // tilde: ã
  0x308: [[2, 1], [4, 1]],                                     // diaeresis: ü
  0x327: [[3, 9], [4, 10], [2, 11], [3, 11]],                  // cedilla: ç
};
function accented(c) {
  const d = String.fromCodePoint(c).normalize("NFD");
  return d.length === 2 && /[A-Za-z]/.test(d[0]) && MARKS[d.charCodeAt(1)] ? [d.charCodeAt(0), d.charCodeAt(1)] : null;
}

function textMask(str) {
  let m = textCache.get(str);
  if (m) return m;
  const codes = [];
  for (const ch of str) codes.push(ch.codePointAt(0));
  const w = codes.length * 6 + 2, h = TOP + 12 + 1;
  const mask = new Uint8Array(w * h);         // 1 = glyph, 2 = outline
  let x0 = 1;
  const wide = [];
  const glyph = (c, from) => {
    for (let y = from; y < 12; y++) {
      const b = fontBits[0xc0 + c * 12 + y];
      for (let x = 0; x < 6; x++) if ((b >> (7 - x)) & 1) mask[(y + TOP) * w + x0 + x] = 1;
    }
  };
  for (const c of codes) {
    const acc = c >= 0x80 && fontBits ? accented(c) : null;
    if (c < 0x80 && fontBits) glyph(c, 0);
    else if (acc) {
      const [base, mark] = acc, capital = base < 0x61;
      glyph(base, base === 0x69 || base === 0x6a ? 3 : 0);
      for (const [x, y] of MARKS[mark]) mask[(y + (capital && y < 3 ? -3 : 0) + TOP) * w + x0 + x] = 1;
    } else wide.push([x0, c]);
    x0 += 6;
  }
  if (wide.length) drawWide(mask, w, h, wide);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x] !== 1) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const k = (y + dy) * w + x + dx;
      if (k >= 0 && k < mask.length && mask[k] === 0) mask[k] = 2;
    }
  }
  m = { mask, w, h };
  if (textCache.size > 400) textCache.clear();
  textCache.set(str, m);
  return m;
}

// Characters outside the bitmap font (Japanese names): rasterise with a system font, 1-bit.
function drawWide(mask, w, h, list) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.font = '12px "MS Gothic", "Osaka", monospace';
  g.textBaseline = "top";
  g.fillStyle = "#fff";
  for (const [x, code] of list) g.fillText(String.fromCodePoint(code), x, TOP);
  const d = g.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] > 127) mask[i] = 1;
}

export function textWidth(str) { return str.length * 6; }

// A canvas (the web client's own images, not game sprites) for FB.rgba: RGB565 pixels and alpha /32.
export function canvasRgba(c) {
  const w = c.width, h = c.height, d = c.getContext("2d").getImageData(0, 0, w, h).data;
  const px = new Uint16Array(w * h), a = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    px[i] = rgb565(d[4 * i], d[4 * i + 1], d[4 * i + 2]);
    a[i] = (d[4 * i + 3] + 4) >> 3;
  }
  return { w, h, px, a };
}

// ------------------------------------------------------------------ HD characters
// A character's match sheets K times larger (tools/hd_sheets.py), which the screen draws where the character shows
// (screen.js): characters.js sets a sheet's Runs .hd = {scale, box, rects, boxes, frames, w, h, type, bytes, pixels,
// decode(), bad} once its picture is here (kept as it came; decode() makes pixels, premultiplied RGBA, until the
// screen has sent them to the GPU; rects: each frame's [x, y] in the picture, [x, y] from the box's corner, w, h,
// K-times pixels; boxes: each frame's box on the frame, game pixels round its rect), and lists it in HD_SHEETS for
// the screen to send ahead of its first use; .hdTint the colour the game tints its greys with ([R, G, B]: a game
// pack's sheets, Runs.tinted), the HD picture's then too where its alpha's lowest bit marks the game's greys
// (greyBit: tools/pack_hd.py). HD_STATE.slow: this page's device too slow for them (characters.js dropHd): none from
// then on.
export const HD_SHEETS = [];
export const HD_STATE = { slow: false };

// ------------------------------------------------------------------ frame buffer
export class FB {
  constructor() {
    // the sizes when made: a frame of another size is a new FB (render.js)
    this.sw = SW; this.sh = SH; this.side = SIDE;
    this.fw = SW + 2 * SIDE;       // the frame's width: px rows are this long
    this.x0 = SIDE; this.x1 = SIDE + SW;                         // the screen's columns in the frame
    this.px = new Uint16Array(this.fw * SH);
    this.image = new ImageData(this.fw, SH);
    this.out = new Uint32Array(this.image.data.buffer);
    this.ox = 0; this.oy = 0;      // added to every position (an 800x600 screen drawn inside a bigger one)
    this.hdBlits = [];             // this frame's sheets with HD pictures, in the order drawn: {r, f, x, y} (screen.js)
    this.under = null;             // what each of them covered, where it drew
  }

  // Draw with (ox, oy) added to every position.
  at(ox, oy, fn) {
    const x = this.ox, y = this.oy;
    this.ox = ox; this.oy = oy;
    try { fn(); } finally { this.ox = x; this.oy = y; }
  }

  clear(c = 0) { this.px.fill(c); }

  // Opaque copy of every run pixel (FUN_0042bf80 / FUN_0042c020). A short run (a block's or a shadow's row, most of a
  // frame's runs) is copied pixel by pixel: making a subarray for it costs more than copying it. A sheet with an HD
  // picture is listed in hdBlits, what it covers kept in under (its picture's soft edges go over it).
  opaque(r, f, x, y) {
    if (!r) return;
    x += this.ox + this.x0; y += this.oy;
    const q = r.frame(f), px = r.px, fb = this.px, L = this.x0, R = this.x1, S = this.fw, B = this.sh;
    let under = null;
    if (r.hd) {
      under = this.under || (this.under = new Uint16Array(fb.length));
      this.hdBlits.push({ r, f: Math.max(0, Math.min(r.n - 1, f | 0)), x, y });
    }
    for (let i = 0; i < q.length; i += 4) {
      const yy = y + q[i + 1];
      if (yy < 0 || yy >= B) continue;
      let xx = x + q[i], n = q[i + 2], o = q[i + 3];
      if (xx < L) { n -= L - xx; o += L - xx; xx = L; }
      if (xx + n > R) n = R - xx;
      if (n <= 0) continue;
      const d = yy * S + xx;
      if (under) for (let k = 0; k < n; k++) { under[d + k] = fb[d + k]; fb[d + k] = px[o + k]; }
      else if (n > SHORT_RUN) fb.set(px.subarray(o, o + n), d);
      else for (let k = 0; k < n; k++) fb[d + k] = px[o + k];
    }
  }

  // 50 % blend (FUN_0042c120); with the all-zero shadow sprites it halves the destination.
  half(r, f, x, y) {
    if (!r) return;
    this.each(r.frame(f), r.px, x, y, (d, s) => ((s & 0xf7de) >> 1) + ((d & 0xf7de) >> 1));
  }

  // Alpha a/32 (FUN_0042c600); orMask 0xFFFF = white silhouette at that alpha (FUN_0042d000).
  alpha(r, f, x, y, a, orMask = 0) {
    if (!r || a <= 0) return;
    if (a >= 32 && !orMask) return this.opaque(r, f, x, y);
    this.each(r.frame(f), r.px, x, y, (d, s) => alpha565(d, s | orMask, a));
  }

  // Horizontal mirror inside a w-pixel-wide frame: source x lands at x + w - 1 - x (KR FUN_0042f510, boss turns).
  mirror(r, f, x, y, w = r ? r.w : 0) {
    if (!r) return;
    const q = r.frame(f), px = r.px, fb = this.px, L = this.x0, R = this.x1, S = this.fw, B = this.sh;
    x += this.ox + L; y += this.oy;
    for (let i = 0; i < q.length; i += 4) {
      const yy = y + q[i + 1];
      if (yy < 0 || yy >= B) continue;
      const row = yy * S, n = q[i + 2], o = q[i + 3], x0 = x + w - 1 - q[i];
      for (let k = 0; k < n; k++) {
        const xx = x0 - k;
        if (xx >= L && xx < R) fb[row + xx] = px[o + k];
      }
    }
  }

  // Only the pixels with x <= px < x + cw and y <= py < y + ch, opaque or at alpha a/32 with orMask (KR FUN_0042f700
  // / FUN_0042f830: the boss HP bar).
  clip(r, f, x, y, cw, ch, a = 32, orMask = 0) {
    if (!r || cw <= 0 || ch <= 0) return;
    const q = r.frame(f), px = r.px, fb = this.px, L = this.x0, R = this.x1, S = this.fw, B = this.sh;
    const x1 = x + cw, y1 = y + ch;
    for (let i = 0; i < q.length; i += 4) {
      const sy = y + q[i + 1];
      if (sy >= y1) continue;
      const yy = sy + this.oy;
      if (yy < 0 || yy >= B) continue;
      const row = yy * S, n = q[i + 2], o = q[i + 3];
      for (let k = 0; k < n; k++) {
        const sx = x + q[i] + k;
        if (sx >= x1) break;
        const xx = sx + this.ox + L;
        if (xx < L || xx >= R) continue;
        const s = px[o + k] | orMask;
        fb[row + xx] = a >= 32 ? s : alpha565(fb[row + xx], s, a);
      }
    }
  }

  // Per channel the brighter of the two (KR FUN_00401000: the boss HP spark).
  lighten(r, f, x, y) {
    if (!r) return;
    this.each(r.frame(f), r.px, x, y, (d, s) => Math.max(d & 0xf800, s & 0xf800) | Math.max(d & 0x07e0, s & 0x07e0)
      | Math.max(d & 0x001f, s & 0x001f));
  }

  // Per channel the sum of the two, at most white: a glow on black (Drop Bomb's Matrix rings, dropstage.js).
  add(r, f, x, y) {
    if (!r) return;
    this.each(r.frame(f), r.px, x, y, (d, s) => Math.min(0xf800, (d & 0xf800) + (s & 0xf800))
      | Math.min(0x07e0, (d & 0x07e0) + (s & 0x07e0)) | Math.min(0x001f, (d & 0x001f) + (s & 0x001f)));
  }

  // White silhouette (FUN_0042bde0).
  white(r, f, x, y) {
    if (!r) return;
    this.each(r.frame(f), r.px, x, y, () => 0xffff);
  }

  each(q, px, x, y, fn) {
    const fb = this.px, L = this.x0, R = this.x1, S = this.fw, B = this.sh;
    x += this.ox + L; y += this.oy;
    for (let i = 0; i < q.length; i += 4) {
      const yy = y + q[i + 1];
      if (yy < 0 || yy >= B) continue;
      const row = yy * S, n = q[i + 2], o = q[i + 3], x0 = x + q[i];
      for (let k = 0; k < n; k++) {
        const xx = x0 + k;
        if (xx < L || xx >= R) continue;
        fb[row + xx] = fn(fb[row + xx], px[o + k]);
      }
    }
  }

  // .eft frame: 8 alpha layers; both pixels of a pair take the first source pixel (FUN_0040b6b0).
  eft(e, f, x, y, table = EFT_STD) {
    if (!e) return;
    const L = this.x0, R = this.x1, S = this.fw, B = this.sh;
    x += this.ox + L; y += this.oy;
    const layers = e.frames[Math.max(0, Math.min(e.n - 1, f | 0))], px = e.px, fb = this.px;
    for (let l = 0; l < 8; l++) {
      const q = layers[l], a = table[l];
      if (!q || a > 32) continue;
      for (let i = 0; i < q.length; i += 4) {
        const yy = y + q[i + 1];
        if (yy < 0 || yy >= B) continue;
        const row = yy * S, n = q[i + 2], o = q[i + 3], x0 = x + q[i];
        for (let k = 0; k < n; k++) {
          const xx = x0 + k;
          if (xx < L || xx >= R) continue;
          fb[row + xx] = alpha565(fb[row + xx], px[o + (k & ~1)], a);
        }
      }
    }
  }

  // Darken a rectangle to 50 % (FUN_00424470, chat input bar).
  darken(x0, y0, x1, y1) {
    const fb = this.px, L = this.x0, R = this.x1, S = this.fw;
    x0 += this.ox + L; x1 += this.ox + L; y0 += this.oy; y1 += this.oy;
    for (let y = Math.max(0, y0); y < Math.min(this.sh, y1); y++) {
      for (let x = Math.max(L, x0); x < Math.min(R, x1); x++) fb[y * S + x] = (fb[y * S + x] & 0xf7de) >> 1;
    }
  }

  // An image from canvasRgba, blended by its alpha.
  rgba(img, x, y) {
    if (!img) return;
    const fb = this.px, L = this.x0, R = this.x1, S = this.fw, B = this.sh;
    x += this.ox + L; y += this.oy;
    for (let j = 0; j < img.h; j++) {
      const yy = y + j;
      if (yy < 0 || yy >= B) continue;
      for (let i = 0; i < img.w; i++) {
        const xx = x + i, k = j * img.w + i, a = img.a[k];
        if (!a || xx < L || xx >= R) continue;
        const o = yy * S + xx;
        fb[o] = a >= 32 ? img.px[k] : alpha565(fb[o], img.px[k], a);
      }
    }
  }

  pset(x, y, c) {
    x += this.ox + this.x0; y += this.oy;
    if (x >= this.x0 && x < this.x1 && y >= 0 && y < this.sh) this.px[y * this.fw + x] = c;
  }

  // Text with an 8-neighbour outline (FUN_0042e300); (x, y) = top-left of the 12 px cell.
  text(x, y, str, fg = 0xffff, outline = 0) {
    if (!str) return;
    const L = this.x0, R = this.x1, S = this.fw, B = this.sh;
    x += this.ox + L; y += this.oy;
    const { mask, w, h } = textMask(str), fb = this.px;
    for (let j = 0; j < h; j++) {
      const yy = y - TOP + j;
      if (yy < 0 || yy >= B) continue;
      for (let i = 0; i < w; i++) {
        const m = mask[j * w + i];
        if (!m) continue;
        const xx = x - 1 + i;
        if (xx < L || xx >= R) continue;
        if (m === 1) fb[yy * S + xx] = fg;
        else if (outline !== null) fb[yy * S + xx] = outline;
      }
    }
  }

  // A whole screen of pixels (sw x sh, an arena's background) into the screen; beside it nothing changes.
  paste(src) {
    if (this.fw === this.sw) { this.px.set(src); return; }
    for (let y = 0; y < this.sh; y++) this.px.set(src.subarray(y * this.sw, (y + 1) * this.sw), y * this.fw + this.x0);
  }

  // Side art (sideart.js): run list f (0 beside the screen, 1 over the screen's margin) at frame positions, its
  // screen on this frame's; not clipped to the screen. The art can be wider than this frame: its outer columns go.
  sideArt(a, f) {
    const q = a.runs[f], px = a.px, fb = this.px, S = this.fw, B = this.sh, dx = this.x0 - a.side;
    for (let i = 0; i < q.length; i += 4) {
      const yy = q[i + 1];
      if (yy >= B) continue;
      let xx = q[i] + dx, n = q[i + 2], o = q[i + 3];
      if (xx < 0) { n += xx; o -= xx; xx = 0; }
      if (xx + n > S) n = S - xx;
      if (n > 0) fb.set(px.subarray(o, o + n), yy * S + xx);
    }
  }

  // Where this frame's HD sheets still show (screen.js): for each of `list` (hdBlits' that the screen has pictures of,
  // a later one over an earlier), each pixel that still has the colour it drew gets in map32 (the words of a
  // frame-sized RGBA texture) the colour it covered and its number in the list + 1 (as alpha). Only inside the
  // frame's box (the screen sends and clears the map by boxes).
  hdMap(list, map32) {
    const fb = this.px, under = this.under, S = this.fw;
    list.forEach((b, i) => {
      const q = b.r.frame(b.f), px = b.r.px, tag = (i + 1) << 24, [bx, by, bw, bh] = b.r.hd.boxes[b.f];
      const L = Math.max(this.x0, b.x + bx), R = Math.min(this.x1, b.x + bx + bw);
      const T = Math.max(0, b.y + by), B = Math.min(this.sh, b.y + by + bh);
      for (let j = 0; j < q.length; j += 4) {
        const yy = b.y + q[j + 1];
        if (yy < T || yy >= B) continue;
        let xx = b.x + q[j], n = q[j + 2], o = q[j + 3];
        if (xx < L) { n -= L - xx; o += L - xx; xx = L; }
        if (xx + n > R) n = R - xx;
        if (n <= 0) continue;
        for (let k = 0, d = yy * S + xx; k < n; k++, d++) {
          if (fb[d] === px[o + k]) map32[d] = (LUT[under[d]] & 0xffffff) | tag;
        }
      }
    });
  }

  // A small copy of the frame for the page beside the game (match.js: the blurred copy, enlarged by the page): each
  // pixel of `image` (ImageData) the mean of 4 x 4 samples of its block, its colours saturated (sat) and darkened
  // (dim), then softened by `blur` passes of a 3 x 3 box. No filter on the page, no read back from the GPU: the same
  // cost on any screen.
  small(image, dim, sat, blur) {
    const W = image.width, H = image.height, S = this.fw, px = this.px, bw = this.fw / W, bh = this.sh / H;
    if (!this.smallA || this.smallA.length !== W * H * 3) {
      this.smallA = new Float32Array(W * H * 3);
      this.smallB = new Float32Array(W * H * 3);
    }
    let a = this.smallA, b = this.smallB;
    const rr = 0.213 + 0.787 * sat, rg = 0.715 - 0.715 * sat, rb = 0.072 - 0.072 * sat;   // (CSS saturate())
    const gr = 0.213 - 0.213 * sat, gg = 0.715 + 0.285 * sat, bb = 0.072 + 0.928 * sat;
    for (let j = 0, o = 0; j < H; j++) {
      for (let i = 0; i < W; i++, o += 3) {
        let r = 0, g = 0, bl = 0;
        for (let v = 0; v < 4; v++) {
          const row = Math.min(this.sh - 1, Math.floor((j + (v + 0.5) / 4) * bh)) * S;
          for (let u = 0; u < 4; u++) {
            const c = LUT[px[row + Math.min(S - 1, Math.floor((i + (u + 0.5) / 4) * bw))]];
            r += c & 255; g += (c >> 8) & 255; bl += (c >> 16) & 255;
          }
        }
        const k = dim / 16;
        a[o] = (rr * r + rg * g + rb * bl) * k;
        a[o + 1] = (gr * r + gg * g + rb * bl) * k;
        a[o + 2] = (gr * r + rg * g + bb * bl) * k;
      }
    }
    for (let p = 0; p < blur; p++) {
      for (let j = 0; j < H; j++) {
        const y0 = Math.max(0, j - 1), y1 = Math.min(H - 1, j + 1);
        for (let i = 0; i < W; i++) {
          const x0 = Math.max(0, i - 1), x1 = Math.min(W - 1, i + 1), n = (y1 - y0 + 1) * (x1 - x0 + 1);
          let r = 0, g = 0, bl = 0;
          for (let y = y0; y <= y1; y++) {
            for (let x = x0, q = (y * W + x0) * 3; x <= x1; x++, q += 3) { r += a[q]; g += a[q + 1]; bl += a[q + 2]; }
          }
          const o = (j * W + i) * 3;
          b[o] = r / n; b[o + 1] = g / n; b[o + 2] = bl / n;
        }
      }
      [a, b] = [b, a];
    }
    const d = image.data;
    for (let o = 0, q = 0; o < W * H * 3; o += 3, q += 4) {
      d[q] = a[o]; d[q + 1] = a[o + 1]; d[q + 2] = a[o + 2]; d[q + 3] = 255;
    }
  }

  present(ctx) {
    const px = this.px, out = this.out;
    for (let i = 0; i < px.length; i++) out[i] = LUT[px[i]];
    ctx.putImageData(this.image, 0, 0);
  }
}
