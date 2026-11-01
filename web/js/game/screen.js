// How the match's frame (fb565.js: SW x SH RGB565, drawn like the exe) reaches the page: Options → Display → Screen
// filter (display.js). The frame goes to the GPU as a 565 texture and one WebGL pass draws it:
//   classic  the frame at its own size, enlarged by the page (soft), as BomberMan.exe's 800x600 always was here
//   sharp    at the screen's own pixels, every game pixel a crisp square with a one-pixel soft edge (sharp bilinear)
//   smooth   at the screen's own pixels, the edges of the pixel art rounded (Hyllian's xBR level 2, one pass)
//   crt      at the screen's own pixels, scanlines and an aperture grille, like a tube TV
// Without WebGL every filter is classic (2D canvas, FB.present), "sharp" as the page's pixelated scaling.
// A shader that will not build here falls back to sharp, then classic.
// HD characters (fb565.js HD_SHEETS): where one shows on the frame, a second pass draws its picture K times larger
// over the filter's at the screen's own pixels (then classic too draws there, the frame enlarged soft as the page
// did). Not in Performance mode, nor on a device too slow for them (watchHd).

import { active, display } from "./display.js";
import { HD_SHEETS, HD_STATE } from "./fb565.js";

export const FILTERS = ["classic", "sharp", "smooth", "crt"];
// watchHd: HD characters go for the rest of the visit when, with them on the screen (from GRACE_MS after they first
// show), the game draws under SLOW_FPS for SLOW_MS (checked every WATCH_MS) and each draw takes over SLOW_DRAW_MS
// (Match drawMs), or the frames come under STALL_FPS: a device it is too much for, not a browser saving power at 30
const GRACE_MS = 3000, WATCH_MS = 2000, SLOW_MS = 6000, SLOW_FPS = 45, SLOW_DRAW_MS = 8, STALL_FPS = 24;
// The canvas at the screen's own pixels (a filter, HD), but never more than it shows: Classic with HD characters no
// larger than HD_SIZE times the frame (their pictures' own pixels: the page enlarges the rest). watchSize: on a device
// that misses frames with it (MISS_SHARE of them late, or all under MISS_FPS, over SIZE_MS) while the game's own
// drawing is quick (the GPU's work, the page's), drawn SIZE_STEP smaller, down to SIZE_FLOOR times the frame; kept
// for the visit (sizeKept)
const HD_SIZE = 2, SIZE_MS = 2000, MISS_SHARE = 0.1, MISS_FPS = 45, SIZE_STEP = 0.8, SIZE_FLOOR = 2;
let sizeKept = 1;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x + 1.0, 1.0 - aPos.y) * 0.5;   // texture row 0 = the frame's top line
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex;
uniform vec2 uSrc;      // the frame's size
uniform vec2 uOut;      // the canvas's size
varying vec2 vUv;
`;

// texture filtering of each program: NEAREST reads whole game pixels, LINEAR lets sharp / crt place their blend
const FRAG = {
  classic: { linear: false, src: HEAD + `
void main() { gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0); }` },

  sharp: { linear: true, src: HEAD + `
void main() {
  vec2 scale = max(uOut / uSrc, vec2(1.0));
  vec2 texel = vUv * uSrc, d = fract(texel) - 0.5, edge = 0.5 - 0.5 / scale;
  vec2 f = (d - clamp(d, -edge, edge)) * scale + 0.5;
  gl_FragColor = vec4(texture2D(uTex, (floor(texel) + f) / uSrc).rgb, 1.0);
}` },

  // xBR-lv2 by Hyllian (MIT), corner rule C. The four corners of a game pixel are worked out at once, one per vec4
  // component (x bottom-right, y top-right, z top-left, w bottom-left), each in its own rotated neighbourhood.
  smooth: { linear: false, src: HEAD + `
const vec3 Yw = vec3(0.2126, 0.7152, 0.0722) * 48.0;
const float EQ = 15.0;
const float LV2 = 2.0;
const vec4 Ao = vec4(1.0, -1.0, -1.0, 1.0), Bo = vec4(1.0, 1.0, -1.0, -1.0), Co = vec4(1.5, 0.5, -0.5, 0.5);
const vec4 Ax = vec4(1.0, -1.0, -1.0, 1.0), Bx = vec4(0.5, 2.0, -0.5, -2.0), Cx = vec4(1.0, 1.0, -0.5, 0.0);
const vec4 Ay = vec4(1.0, -1.0, -1.0, 1.0), By = vec4(2.0, 0.5, -2.0, -0.5), Cy = vec4(2.0, 0.0, -1.0, 0.5);
const vec4 Ci = vec4(0.25);
const vec4 dl = vec4(0.25), dl_l = vec4(0.125, 0.25, 0.125, 0.25), dl_u = vec4(0.25, 0.125, 0.25, 0.125);

vec2 cell;
vec3 T(float dx, float dy) { return texture2D(uTex, (cell + vec2(dx, dy)) / uSrc).rgb; }
vec4 L4(vec3 a, vec3 b, vec3 c, vec3 d) { return vec4(dot(a, Yw), dot(b, Yw), dot(c, Yw), dot(d, Yw)); }
vec4 df(vec4 a, vec4 b) { return abs(a - b); }
float cdf(vec3 a, vec3 b) { vec3 d = abs(a - b); return d.r + d.g + d.b; }
vec4 eq(vec4 a, vec4 b) { return step(df(a, b), vec4(EQ)); }
vec4 neq(vec4 a, vec4 b) { return vec4(1.0) - eq(a, b); }
vec4 wd(vec4 a, vec4 b, vec4 c, vec4 d, vec4 e, vec4 f, vec4 g, vec4 h) {
  return df(a, b) + df(a, c) + df(d, e) + df(d, f) + 4.0 * df(g, h);
}

void main() {
  vec2 pos = vUv * uSrc, fp = fract(pos);
  cell = floor(pos) + 0.5;
  //     A1 B1 C1
  //  A0  A  B  C C4
  //  D0  D  E  F F4
  //  G0  G  H  I I4
  //     G5 H5 I5
  vec3 A1 = T(-1.0, -2.0), B1 = T(0.0, -2.0), C1 = T(1.0, -2.0);
  vec3 A = T(-1.0, -1.0), B = T(0.0, -1.0), C = T(1.0, -1.0);
  vec3 D = T(-1.0, 0.0), E = T(0.0, 0.0), F = T(1.0, 0.0);
  vec3 G = T(-1.0, 1.0), H = T(0.0, 1.0), I = T(1.0, 1.0);
  vec3 G5 = T(-1.0, 2.0), H5 = T(0.0, 2.0), I5 = T(1.0, 2.0);
  vec3 A0 = T(-2.0, -1.0), D0 = T(-2.0, 0.0), G0 = T(-2.0, 1.0);
  vec3 C4 = T(2.0, -1.0), F4 = T(2.0, 0.0), I4 = T(2.0, 1.0);

  vec4 b = L4(B, D, H, F), c = L4(C, A, G, I), e = L4(E, E, E, E);
  vec4 d = b.yzwx, f = b.wxyz, g = c.zwxy, h = b.zwxy, i = c.wxyz;
  vec4 i4 = L4(I4, C1, A0, G5), i5 = L4(I5, C4, A1, G0), h5 = L4(H5, F4, B1, D0), f4 = h5.yzwx;

  vec4 fx = Ao * fp.y + Bo * fp.x, fx_l = Ax * fp.y + Bx * fp.x, fx_u = Ay * fp.y + By * fp.x;

  vec4 irlv0 = neq(e, f) * neq(e, h);
  vec4 irlv1 = irlv0 * (neq(f, b) * neq(f, c) + neq(h, d) * neq(h, g)
    + eq(e, i) * (neq(f, f4) * neq(f, i4) + neq(h, h5) * neq(h, i5)) + eq(e, g) + eq(e, c));
  vec4 irlv2l = neq(e, g) * neq(d, g);
  vec4 irlv2u = neq(e, c) * neq(b, c);

  vec4 fx45i = clamp((fx + dl - Co - Ci) / (2.0 * dl), 0.0, 1.0);
  vec4 fx45 = clamp((fx + dl - Co) / (2.0 * dl), 0.0, 1.0);
  vec4 fx30 = clamp((fx_l + dl_l - Cx) / (2.0 * dl_l), 0.0, 1.0);
  vec4 fx60 = clamp((fx_u + dl_u - Cy) / (2.0 * dl_u), 0.0, 1.0);

  vec4 wd1 = wd(e, c, g, i, h5, f4, h, f), wd2 = wd(h, d, i5, f, i4, b, e, i);
  vec4 edri = step(wd1, wd2) * irlv0;
  vec4 edr = step(wd1 + vec4(0.1), wd2) * step(vec4(0.5), irlv1);
  vec4 edr_l = step(LV2 * df(f, g), df(h, c)) * irlv2l * edr;
  vec4 edr_u = step(LV2 * df(h, c), df(f, g)) * irlv2u * edr;

  vec4 m = max(max(edr_l * fx30, edr_u * fx60), max(edr * fx45, edri * fx45i));
  vec4 px = step(df(e, f), df(e, h));
  vec3 res1 = mix(E, mix(H, F, px.x), m.x);
  res1 = mix(res1, mix(B, D, px.z), m.z);
  vec3 res2 = mix(E, mix(F, B, px.y), m.y);
  res2 = mix(res2, mix(D, H, px.w), m.w);
  gl_FragColor = vec4(mix(res1, res2, step(cdf(E, res1), cdf(E, res2))), 1.0);
}` },

  // Each game line a beam (wider where it is bright), three samples down every screen pixel so that a small scale
  // shows no stripes of its own; across, the sharp filter. Scanlines and the grille fade out below 2x.
  crt: { linear: true, src: HEAD + `
vec3 beam(float dist, vec3 c) {
  vec3 s = mix(vec3(0.30), vec3(0.46), c);
  return exp(-0.5 * (dist * dist) / (s * s));
}

void main() {
  vec2 scale = uOut / uSrc, texel = vUv * uSrc;
  float sx = max(scale.x, 1.0), dx = fract(texel.x) - 0.5, edge = 0.5 - 0.5 / sx;
  float x = (floor(texel.x) + (dx - clamp(dx, -edge, edge)) * sx + 0.5) / uSrc.x;
  vec3 crt = vec3(0.0);
  for (int k = -1; k <= 1; k++) {
    float y = texel.y + float(k) / (3.0 * scale.y) - 0.5, y0 = floor(y), t = y - y0;
    vec3 c0 = texture2D(uTex, vec2(x, (y0 + 0.5) / uSrc.y)).rgb, c1 = texture2D(uTex, vec2(x, (y0 + 1.5) / uSrc.y)).rgb;
    crt += c0 * beam(t, c0) + c1 * beam(1.0 - t, c1);
  }
  crt /= 3.0;                              // (the beams keep the line's brightness on average)
  float col = mod(floor(gl_FragCoord.x), 3.0);
  vec3 grille = vec3(0.82) + 0.18 * vec3(col == 0.0, col == 1.0, col == 2.0);
  crt *= grille * 1.13;                    // (the grille takes 12 % away)
  vec3 plain = texture2D(uTex, vec2(x, (floor(texel.y) + 0.5) / uSrc.y)).rgb;
  gl_FragColor = vec4(mix(plain, min(crt, vec3(1.0)), clamp(scale.y - 1.0, 0.0, 1.0)), 1.0);
}` },
};

// The HD pass: a quad over the sheet's box for each HD sheet the frame drew (FB.hdMap: the map tells which game
// pixels it still shows, and what it covered there); in those its picture (premultiplied: soft edges over what it
// covered), elsewhere what the filter drew.
const HD_VERT = `
attribute vec2 aPos;
uniform vec4 uRect;     // the frame's rect on the frame: x, y, w, h (game pixels)
uniform vec2 uSrc;
void main() {
  vec2 p = (uRect.xy + aPos * uRect.zw) / uSrc;
  gl_Position = vec4(p * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const HD_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uMap;     // each game pixel: the colour under the sheet, which sheet shows there (alpha: its number)
uniform sampler2D uSheet;   // the sheet's frames K times larger
uniform vec2 uSrc, uOut, uSheetSize;
uniform vec2 uCell;         // its corner in the sheet's picture
uniform vec4 uRect;
uniform float uK, uIndex;
uniform vec4 uTint;         // a: 1 for a sheet whose greys the game tints with rgb (FUN_0042d2b0), marked in the
                            // picture by its alpha's lowest bit (tools/pack_hd.py)
void main() {
  vec2 f = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y) * uSrc / uOut;   // where on the frame
  vec4 m = texture2D(uMap, (floor(f) + 0.5) / uSrc);
  if (abs(m.a * 255.0 - uIndex) > 0.5) discard;
  vec2 t = clamp((f - uRect.xy) * uK, vec2(0.5), uRect.zw * uK - 0.5);
  vec4 c = texture2D(uSheet, (uCell + t) / uSheetSize);
  if (uTint.a > 0.5 && c.a > 0.0) {         // where the game tints (the nearest pixel's mark), tinted as the game's
    float grey = mod(floor(texture2D(uSheet, (uCell + floor(t) + 0.5) / uSheetSize).a * 255.0 + 0.5), 2.0);
    vec3 s = c.rgb / c.a;
    float l = (min(min(s.r, s.g), s.b) + max(max(s.r, s.g), s.b)) * 0.5;
    vec3 tint = l < 0.5 ? uTint.rgb * l * 2.0 : uTint.rgb + (1.0 - uTint.rgb) * (l * 2.0 - 1.0);
    c.rgb = mix(s, tint, grey) * c.a;
  }
  gl_FragColor = vec4(m.rgb * (1.0 - c.a) + c.rgb, 1.0);
}`;
const HD_UNIFORMS = ["uRect", "uSrc", "uOut", "uSheetSize", "uCell", "uK", "uIndex", "uTint", "uMap", "uSheet"];

export class Screen {
  constructor(canvas) {
    this.canvas = canvas;
    this.filter = FILTERS.includes(active.filter) ? active.filter : "classic";
    this.srcW = canvas.width; this.srcH = canvas.height;
    this.outW = 0; this.outH = 0;          // the canvas's device pixels (sharp / smooth / crt)
    this.hdBig = false;                    // classic drawn at those too (an HD character came)
    this.res = sizeKept;                   // of those, the share drawn (watchSize)
    this.gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false });
    if (this.gl) {
      this.onLost = (e) => { e.preventDefault(); this.ready = false; };
      this.onRestored = () => this.init();
      canvas.addEventListener("webglcontextlost", this.onLost);
      canvas.addEventListener("webglcontextrestored", this.onRestored);
      this.init();
    }
    if (!this.ready) {                     // no WebGL here (or a canvas that already has a 2D context)
      this.gl = null;
      this.ctx = canvas.getContext("2d");
      if (this.filter !== "classic") canvas.style.imageRendering = "pixelated";
      this.filter = "classic";
    }
    if (this.filter !== "classic") this.observe();
  }

  init() {
    const gl = this.gl;
    this.ready = false;
    this.prog = null;
    for (const name of new Set([this.filter, "sharp", "classic"])) {
      this.prog = program(gl, FRAG[name].src);
      if (this.prog) { this.filter = name; break; }
      console.warn(`screen filter ${name}: the shader did not build here`);
    }
    if (!this.prog) return;
    gl.useProgram(this.prog);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // one big triangle
    gl.enableVertexAttribArray(0);         // (aPos, in every program)
    this.uSrc = gl.getUniformLocation(this.prog, "uSrc");
    this.uOut = gl.getUniformLocation(this.prog, "uOut");
    this.tex = texture(gl, FRAG[this.filter].linear || this.hdBig);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    this.texW = this.texH = 0;
    this.maxDim = Math.min(...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    this.initHd();
    this.ready = true;
  }

  initHd() {
    const gl = this.gl;
    this.hdTex = new Map();                // an HD sheet -> its texture (null: too big for this GPU)
    this.hdNext = 0;                       // HD_SHEETS before this one have theirs
    this.hdList = [];                      // the last frame's HD sheets that show
    this.hdRects = [];                     // the map's boxes they were in
    this.mapW = this.mapH = 0;
    this.hdProg = program(gl, HD_FRAG, HD_VERT);
    if (!this.hdProg) { console.warn("HD characters: the shader did not build here"); return; }
    this.hdU = Object.fromEntries(HD_UNIFORMS.map((n) => [n, gl.getUniformLocation(this.hdProg, n)]));
    gl.useProgram(this.hdProg);
    gl.uniform1i(this.hdU.uMap, 1);
    gl.uniform1i(this.hdU.uSheet, 2);
    gl.useProgram(this.prog);
    this.hdBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hdBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.activeTexture(gl.TEXTURE1);
    this.mapTex = texture(gl, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  }

  // The canvas's size in device pixels, as the page lays it out (the match's CSS does not change).
  observe() {
    const fit = (w, h) => {
      if (!w || !h) return;                // the game screen hidden
      this.outW = Math.min(this.maxDim || 4096, Math.round(w));
      this.outH = Math.min(this.maxDim || 4096, Math.round(h));
      this.applySize();
      if (this.texW) this.render();        // a new size draws the last frame again at once
    };
    const r = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    fit(r.width * dpr, r.height * dpr);
    this.ro = new ResizeObserver(([en]) => {   // the exact device pixels where the browser gives them and they agree
      const dp = en.devicePixelContentBoxSize && en.devicePixelContentBoxSize[0], k = window.devicePixelRatio || 1;
      const w = en.contentRect.width * k, h = en.contentRect.height * k;
      if (dp && Math.abs(dp.inlineSize - w) <= 2 && Math.abs(dp.blockSize - h) <= 2) fit(dp.inlineSize, dp.blockSize);
      else fit(w, h);                      // (an emulated screen scale reports CSS pixels there)
    });
    try { this.ro.observe(this.canvas, { box: "device-pixel-content-box" }); } catch (e) { this.ro.observe(this.canvas); }
  }

  // The frame's size (Match.sizeScreen): the canvas is that size for classic, the screen's for the others.
  resize(w, h) {
    this.srcW = w; this.srcH = h;
    this.applySize();
  }

  applySize() {
    const big = (this.filter !== "classic" || this.hdBig) && this.outW > 0;
    let w = big ? this.outW : this.srcW, h = big ? this.outH : this.srcH;
    if (big) {
      const most = this.filter === "classic" ? this.share(HD_SIZE) : 1;
      const k = Math.min(1, most, Math.max(this.res, this.share(SIZE_FLOOR)));
      w = Math.round(w * k); h = Math.round(h * k);
    }
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  // The share of the screen's pixels at which the canvas is n times the frame each way
  share(n) {
    return Math.max((n * this.srcW) / this.outW, (n * this.srcH) / this.outH);
  }

  // Each animation frame (match.js, SIZE_MS ...): the canvas a step smaller on a device that misses frames with it
  watchSize(now, drawMs) {
    const w = this.sizeWatch ||= { from: now, last: now, gaps: [] }, gap = now - w.last;
    w.last = now;
    const room = this.outW > 0 && this.canvas.width > Math.ceil(this.outW * this.share(SIZE_FLOOR)) + 1;
    if (!room || document.hidden || gap > 250 || this.hdNext < HD_SHEETS.length) {
      w.from = now;
      w.gaps.length = 0;
      return;
    }
    w.gaps.push(gap);
    if (now - w.from < SIZE_MS) return;
    const beat = w.gaps.slice().sort((a, b) => a - b)[Math.floor(w.gaps.length / 10)];   // (the screen's own)
    const late = w.gaps.filter((g) => g > beat * 1.5).length / w.gaps.length;
    w.from = now;
    w.gaps.length = 0;
    if ((late < MISS_SHARE && beat < 1000 / MISS_FPS) || drawMs > SLOW_DRAW_MS) return;
    this.res = sizeKept = (this.canvas.width / this.outW) * SIZE_STEP;
    this.applySize();
    if (this.texW) this.render();
  }

  present(fb) {
    if (!this.gl) { if (this.ctx) fb.present(this.ctx); return; }
    if (!this.ready) return;
    const gl = this.gl, w = fb.image.width, h = fb.image.height;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (this.texW !== w || this.texH !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, fb.px);
      this.texW = w; this.texH = h;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, fb.px);
    }
    this.hd(fb);
    this.render();
  }

  // The frame's HD sheets: their pictures to the GPU (and one more of those loaded, ahead of its first use), the map
  // of where each shows: only the boxes of the last frame's (cleared) and this one's sent.
  hd(fb) {
    if (!this.hdProg) return;
    const gl = this.gl, lite = display.lite || HD_STATE.slow;
    const list = lite ? [] : fb.hdBlits.filter((b) => this.sheetTexture(b.r.hd)).slice(0, 255);
    for (let s; (s = HD_SHEETS[this.hdNext]) && (this.hdTex.has(s) || s.bad);) this.hdNext++;
    if (!lite && this.hdNext < HD_SHEETS.length) this.sheetTexture(HD_SHEETS[this.hdNext]);
    if (list.length && this.filter === "classic" && !this.hdBig) this.bigClassic();
    if (!list.length && !this.hdRects.length) { this.hdList = list; return; }
    const W = this.texW, H = this.texH;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mapTex);
    if (this.mapW !== W || this.mapH !== H) {
      this.map = new Uint8Array(W * H * 4);
      this.map32 = new Uint32Array(this.map.buffer);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.map);
      this.mapW = W; this.mapH = H; this.hdRects = [];
    }
    const old = this.hdRects, rects = [];
    for (const [x, y, w, h] of old) for (let j = y; j < y + h; j++) this.map32.fill(0, j * W + x, j * W + x + w);
    for (const b of list) {                // (a frame's box holds every pixel of it: tools/hd_sheets.py)
      const [bx, by, bw, bh] = b.r.hd.boxes[b.f];
      const x0 = Math.max(0, b.x + bx), y0 = Math.max(0, b.y + by);
      const x1 = Math.min(W, b.x + bx + bw), y1 = Math.min(H, b.y + by + bh);
      if (x1 > x0 && y1 > y0) rects.push([x0, y0, x1 - x0, y1 - y0]);
    }
    if (list.length) fb.hdMap(list, this.map32);
    for (const r of merged(old.concat(rects))) this.sendRect(r);
    gl.activeTexture(gl.TEXTURE0);
    this.hdRects = rects;
    this.hdList = list;
  }

  // A box of the map to its texture (bound), its lines copied together first (WebGL 1 sends no part of a line).
  sendRect([x, y, w, h]) {
    const n = w * h * 4, W4 = this.mapW * 4;
    if (!this.rectBuf || this.rectBuf.length < n) this.rectBuf = new Uint8Array(n);
    const buf = this.rectBuf.subarray(0, n);
    for (let j = 0; j < h; j++) buf.set(this.map.subarray((y + j) * W4 + x * 4, (y + j) * W4 + (x + w) * 4), j * w * 4);
    this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, x, y, w, h, this.gl.RGBA, this.gl.UNSIGNED_BYTE, buf);
  }

  // An HD sheet's texture, made the first time its picture is decoded (characters.js: until then none, and it is
  // decoded; none either for a picture bigger than this GPU takes). The decoded picture goes once it is on the GPU.
  sheetTexture(s) {
    if (!s || this.hdTex.has(s)) return s && this.hdTex.get(s);
    if (!s.pixels) {
      if (!s.bad) s.decode();
      return null;
    }
    const gl = this.gl;
    let t = null;
    if (s.w <= this.maxTex && s.h <= this.maxTex) {
      gl.activeTexture(gl.TEXTURE2);
      t = texture(gl, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, s.w, s.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, s.pixels);
      gl.activeTexture(gl.TEXTURE0);
    }
    this.hdTex.set(s, t);
    s.pixels = null;
    return t;
  }

  // Classic with an HD character: the canvas the screen's size, the frame enlarged soft by the GPU (as the page did).
  bigClassic() {
    const gl = this.gl;
    this.hdBig = true;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (this.ro) this.applySize(); else this.observe();
  }

  render() {
    const gl = this.gl, cw = this.canvas.width, ch = this.canvas.height;
    if (!this.ready) return;
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(this.uSrc, this.texW, this.texH);
    gl.uniform2f(this.uOut, cw, ch);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.hdList.length) this.drawHd(cw, ch);
  }

  drawHd(cw, ch) {
    const gl = this.gl, u = this.hdU;
    gl.useProgram(this.hdProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.hdBuf);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(u.uSrc, this.texW, this.texH);
    gl.uniform2f(u.uOut, cw, ch);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mapTex);
    gl.activeTexture(gl.TEXTURE2);
    this.hdList.forEach((b, i) => {
      const s = b.r.hd, [bx, by] = s.box, k = s.scale, [ax, ay, rx, ry, rw, rh] = s.rects[b.f] || [0, 0, 0, 0, 0, 0];
      if (!rw || !rh) return;
      gl.bindTexture(gl.TEXTURE_2D, this.hdTex.get(s));
      gl.uniform4f(u.uRect, b.x + bx + rx / k, b.y + by + ry / k, rw / k, rh / k);
      gl.uniform2f(u.uSheetSize, s.w, s.h);
      gl.uniform2f(u.uCell, ax, ay);
      gl.uniform1f(u.uK, k);
      gl.uniform1f(u.uIndex, i + 1);
      const tint = s.greyBit && b.r.hdTint;
      if (tint) gl.uniform4f(u.uTint, tint[0] / 255, tint[1] / 255, tint[2] / 255, 1);
      else gl.uniform4f(u.uTint, 0, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
    gl.activeTexture(gl.TEXTURE0);
  }

  // Each animation frame (match.js): true once this device is too slow for HD characters (GRACE_MS ...): the match
  // lets them go (characters.js dropHd, dropHd). Not out of sight.
  watchHd(now, drawMs) {
    const w = this.hdWatch ||= { from: now, last: now, frames: 0, slow: 0, shown: null };
    if (this.hdList.length && w.shown === null) w.shown = now;
    const on = this.hdList.length > 0 && now - w.shown >= GRACE_MS && !HD_STATE.slow && !document.hidden;
    if (!on || now - w.last > 250) {
      Object.assign(w, { from: now, last: now, frames: 0 });
      if (!on) w.slow = 0;
      return false;
    }
    w.last = now;
    w.frames++;
    if (now - w.from < WATCH_MS) return false;
    const fps = (w.frames * 1000) / (now - w.from);
    w.slow = fps < SLOW_FPS && (drawMs > SLOW_DRAW_MS || fps < STALL_FPS) ? w.slow + 1 : 0;
    Object.assign(w, { from: now, frames: 0 });
    return w.slow * WATCH_MS >= SLOW_MS;
  }

  // The HD characters' textures freed, classic the frame's own size again
  dropHd() {
    const gl = this.gl;
    if (gl && !gl.isContextLost()) for (const t of this.hdTex.values()) if (t) gl.deleteTexture(t);
    if (this.hdTex) this.hdTex.clear();
    this.hdList = [];
    this.hdRects = [];
    this.hdNext = 0;
    if (!this.hdBig || !gl) return;
    this.hdBig = false;
    const f = FRAG[this.filter] && FRAG[this.filter].linear ? gl.LINEAR : gl.NEAREST;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    this.applySize();
    if (this.texW) this.render();
  }

  dispose() {
    if (this.ro) this.ro.disconnect();
    this.canvas.style.imageRendering = "";
    const gl = this.gl;
    if (!gl) return;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    if (!gl.isContextLost()) {
      gl.deleteTexture(this.tex);
      gl.deleteBuffer(this.buf);
      gl.deleteProgram(this.prog);
      if (this.hdProg) {
        for (const t of this.hdTex.values()) if (t) gl.deleteTexture(t);
        gl.deleteTexture(this.mapTex);
        gl.deleteBuffer(this.hdBuf);
        gl.deleteProgram(this.hdProg);
      }
    }
    this.ready = false;
  }
}

// Boxes that overlap as one round both: the same pixels sent once (a character's box last frame and this one's)
function merged(list) {
  const out = [];
  for (let [x, y, w, h] of list) {
    for (let i = 0; i < out.length;) {
      const [a, b, c, d] = out[i];
      if (x < a + c && a < x + w && y < b + d && b < y + h) {
        const x1 = Math.max(x + w, a + c), y1 = Math.max(y + h, b + d);
        x = Math.min(x, a); y = Math.min(y, b); w = x1 - x; h = y1 - y;
        out.splice(i, 1);
        i = 0;
      } else {
        i++;
      }
    }
    out.push([x, y, w, h]);
  }
  return out;
}

// A texture of the active unit, bound, clamped at its edges, its pixels read blended (linear) or whole.
function texture(gl, linear) {
  const t = gl.createTexture(), f = linear ? gl.LINEAR : gl.NEAREST;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function program(gl, fragSrc, vertSrc = VERT) {
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
    console.warn(gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  };
  const v = shader(gl.VERTEX_SHADER, vertSrc), f = v && shader(gl.FRAGMENT_SHADER, fragSrc);
  if (!f) { if (v) gl.deleteShader(v); return null; }
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (gl.getProgramParameter(p, gl.LINK_STATUS)) return p;
  console.warn(gl.getProgramInfoLog(p));
  gl.deleteProgram(p);
  return null;
}
