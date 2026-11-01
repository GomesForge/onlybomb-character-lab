// 3D avatars (G_player.md §10, case 2). Without a special-character item BomberMan.exe builds a player's 37
// sprite sets itself (FUN_00403bd0 -> FUN_00403320): a body, a face and up to 8 items, posed by a motion and seen
// through a camera, drawn by a small fixed-point software renderer into 512x512 and halved to 256x256 RGB565.
// This is a port of that renderer, bit for bit: 4.12 fixed point with 32-bit wrap-around (Math.imul), C integer
// division (truncation), the same depth buckets and drawing order, and the exe's quirks kept on purpose.
// Pure JS (no DOM), so it also runs in Node for the tests.

const W2 = 512, H2 = 512;                 // FUN_00464250(0x100, 0x100) renders at twice the size
const FOCAL = 0x300, CX = 256, CY = 256, NEAR = 0x40;
const BG = 0xffff00ff, KEY = 0xf81f;      // background: magenta, the sprites' transparent colour
const ONE = 0x1000;

// FUN_00464250: sin table, 4096 steps per turn, 4.12 (cos = SIN[(a + 0x400) & 0xfff])
const SIN = new Int32Array(4096);
for (let i = 0; i < 4096; i++) SIN[i] = Math.trunc(Math.sin(i * 0.0015339807878856412) * 4096.0);

// (motion, camera) of each of the 37 rendered sets (DAT_004770b0); the girl body uses motion + 11 (63 -> 64)
export const SET_TABLE = [[4, 2], [4, 5], [4, 3], [4, 4], [10, 2], [10, 5], [10, 3], [10, 4], [11, 2], [11, 5],
  [11, 3], [11, 4], [7, 2], [7, 5], [7, 3], [7, 4], [5, 2], [5, 5], [5, 3], [5, 4], [8, 2], [8, 5], [8, 3], [8, 4],
  [9, 2], [9, 5], [9, 3], [9, 4], [6, 2], [6, 5], [6, 3], [6, 4], [3, 5], [13, 2], [12, 2], [63, 6], [63, 6]];
// the game's sprite-set slot k is rendered set BUILD_ORDER[k] (local_28 in FUN_00403bd0)
export const BUILD_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 28, 29, 30, 31, 12, 13, 14, 15, 32, 33, 34,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 36, 35];
// rendered sets 20..27 (riding Louie) lose the pixels of a mask (FUN_004031f0; north has none)
export const MASKS = { 20: "runmsks", 21: "runmskw", 23: "runmske", 24: "standmsks", 25: "standmskw", 27: "standmske" };
export const FACE_SET = 35;               // a 40x40 crop of the previous render (FUN_00403280)
export const GIRL_BODY = 1210001;

export function motionId(set, body) {
  const m = SET_TABLE[set][0];
  return body >= 1000000 ? (m === 0x3f ? 0x40 : m + 0xb) : m;
}

// ------------------------------------------------------------------ readers (FUN_00461720 / 30 / 50)
const u8 = (d, o) => d[o];
const s8 = (d, o) => (d[o] << 24) >> 24;
const s16 = (d, o) => (((d[o] << 8) | d[o + 1]) << 16) >> 16;
const i32 = (d, o) => (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];

// ------------------------------------------------------------------ fixed point
// every 3x3 product is (three wrapped 32-bit products summed with wrap-around) >> 12, like the exe's int code
function mul(a, b) {                      // a = a x b (row-major, row vectors)
  const r = new Int32Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = ((Math.imul(a[i * 3], b[j]) + Math.imul(a[i * 3 + 1], b[3 + j]) + Math.imul(a[i * 3 + 2], b[6 + j])) | 0) >> 12;
    }
  }
  a.set(r);
}
const ident = () => Int32Array.of(ONE, 0, 0, 0, ONE, 0, 0, 0, ONE);
function rotZ(a) { const s = SIN[a & 0xfff], c = SIN[(a + 0x400) & 0xfff]; return Int32Array.of(c, s, 0, -s, c, 0, 0, 0, ONE); }
function rotX(a) { const s = SIN[a & 0xfff], c = SIN[(a + 0x400) & 0xfff]; return Int32Array.of(ONE, 0, 0, 0, c, s, 0, -s, c); }
function rotY(a) { const s = SIN[a & 0xfff], c = SIN[(a + 0x400) & 0xfff]; return Int32Array.of(c, 0, -s, 0, ONE, 0, s, 0, c); }
const dot = (x, y, z, a, b, c) => ((Math.imul(x, a) + Math.imul(y, b) + Math.imul(z, c)) | 0) >> 12;

// ------------------------------------------------------------------ GIF (textures; palette colours, like OLE's bitmap)
export function decodeGif(d) {
  if (d[0] !== 0x47 || d[1] !== 0x49 || d[2] !== 0x46) throw new Error("not a GIF");
  const sw = d[6] | (d[7] << 8), sh = d[8] | (d[9] << 8), flags = d[10];
  let o = 13, pal = null;
  if (flags & 0x80) { pal = d.subarray(o, o + 3 * (2 << (flags & 7))); o += 3 * (2 << (flags & 7)); }
  const px = new Int32Array(sw * sh);
  for (;;) {
    const b = d[o++];
    if (b === 0x21) {                     // extension: skip its sub-blocks
      o++;
      while (d[o]) o += d[o] + 1;
      o++;
    } else if (b === 0x2c) {
      const ix = d[o] | (d[o + 1] << 8), iy = d[o + 2] | (d[o + 3] << 8);
      const iw = d[o + 4] | (d[o + 5] << 8), ih = d[o + 6] | (d[o + 7] << 8), f = d[o + 8];
      o += 9;
      let lpal = pal;
      if (f & 0x80) { lpal = d.subarray(o, o + 3 * (2 << (f & 7))); o += 3 * (2 << (f & 7)); }
      const idx = lzw(d, o, iw * ih);
      const rows = [];
      if (f & 0x40) { for (const [st, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = st; y < ih; y += step) rows.push(y); }
      else for (let y = 0; y < ih; y++) rows.push(y);
      for (let r = 0; r < ih; r++) {
        const y = iy + rows[r];
        if (y >= sh) continue;
        for (let x = 0; x < iw && ix + x < sw; x++) {
          const k = idx[r * iw + x] * 3;
          px[y * sw + ix + x] = (lpal[k] << 16) | (lpal[k + 1] << 8) | lpal[k + 2];
        }
      }
      return { w: sw, h: sh, px };
    } else throw new Error("bad GIF block");
  }
}
function lzw(d, o, n) {                   // the classic GIF LZW decoder (prefix / suffix tables and a stack)
  const min = d[o++], out = new Uint8Array(n);
  let len = 0;
  for (let p = o; d[p]; p += d[p] + 1) len += d[p];
  const buf = new Uint8Array(len);
  for (let p = o, w = 0; d[p]; p += d[p] + 1) { buf.set(d.subarray(p + 1, p + 1 + d[p]), w); w += d[p]; }
  const clear = 1 << min, eoi = clear + 1;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  for (let c = 0; c < clear; c++) suffix[c] = c;
  let size = min + 1, mask = (1 << size) - 1, avail = clear + 2, old = -1, first = 0;
  let datum = 0, bits = 0, top = 0, bi = 0, pi = 0;
  while (pi < n) {
    if (top === 0) {
      if (bits < size) {
        if (bi >= buf.length) break;
        datum |= buf[bi++] << bits; bits += 8;
        continue;
      }
      let code = datum & mask;
      datum >>= size; bits -= size;
      if (code > avail || code === eoi) break;
      if (code === clear) { size = min + 1; mask = (1 << size) - 1; avail = clear + 2; old = -1; continue; }
      if (old === -1) { stack[top++] = suffix[code]; old = code; first = code; continue; }
      const inCode = code;
      if (code === avail) { stack[top++] = first; code = old; }
      while (code > clear) { stack[top++] = suffix[code]; code = prefix[code]; }
      first = suffix[code];
      stack[top++] = first;
      if (avail < 4096) {
        prefix[avail] = old; suffix[avail] = first; avail++;
        if ((avail & mask) === 0 && avail < 4096) { size++; mask += avail; }
      }
      old = inCode;
    }
    out[pi++] = stack[--top];
  }
  return out;
}

function texture(gif) {                   // FUN_00465b50: power-of-two sizes; [4] log2 w, [6] w-1, [7] h-1, [10] pixels
  const g = decodeGif(gif);
  return { shift: Math.log2(g.w) | 0, wmask: g.w - 1, hmask: g.h - 1, px: g.px };
}

// ------------------------------------------------------------------ meshes (FUN_00464ed0), section start = magic
function parseMesh(d, p) {
  const nv = s16(d, p + 8);
  const verts = new Int32Array(Math.max(0, nv) * 6);        // x, y, z, screen x, screen y, depth
  let o = 10;
  for (let i = 0; i < nv; i++, o += 12) {
    verts[i * 6] = s16(d, p + o); verts[i * 6 + 1] = s16(d, p + o + 2); verts[i * 6 + 2] = s16(d, p + o + 4);
  }
  const nTex = u8(d, p + o++);
  for (let i = 0; i < nTex; i++) o += u8(d, p + o) + 1;   // names
  const nMat = u8(d, p + o++), mats = [];
  for (let i = 0; i < nMat; i++) {
    o += u8(d, p + o) + 1;
    mats.push({ mode: s8(d, p + o), tex: s8(d, p + o + 4) });
    o += 6;
  }
  const nFace = s16(d, p + o), faces = [];
  o += 2;
  for (let i = 0; i < nFace; i++) {
    const n = u8(d, p + o), mat = u8(d, p + o + 1);
    o += 2;
    const idx = [0, 0, 0, 0], u = [0, 0, 0, 0], v = [0, 0, 0, 0];
    for (let k = 0; k < n; k++, o += 4) {
      if (k < 4) { idx[k] = s16(d, p + o); u[k] = u8(d, p + o + 2); v[k] = u8(d, p + o + 3); }
    }
    faces.push({ n, mat, idx, u, v });
  }
  const nGroup = u8(d, p + o++), groups = [];
  for (let i = 0; i < nGroup; i++, o += 5) groups.push({ start: s16(d, p + o), end: s16(d, p + o + 2), bone: s8(d, p + o + 4) });
  return { verts, tex: new Array(nTex).fill(null), mats, faces, groups };
}

// ------------------------------------------------------------------ motions and cameras (FUN_00465ee0)
function parseTracks(payload) {
  const d = payload, p = 8;
  const nTrack = u8(d, p + 8), frames = s16(d, p + 9), tracks = [];
  let o = 0xb;
  for (let t = 0; t < nTrack; t++) {
    const n = u8(d, p + o++), keys = new Int32Array(n * 7);
    for (let k = 0; k < n; k++, o += 20) {
      keys[k * 7] = s16(d, p + o);
      keys[k * 7 + 1] = i32(d, p + o + 2); keys[k * 7 + 2] = i32(d, p + o + 6); keys[k * 7 + 3] = i32(d, p + o + 10);
      keys[k * 7 + 4] = s16(d, p + o + 14); keys[k * 7 + 5] = s16(d, p + o + 16); keys[k * 7 + 6] = s16(d, p + o + 18);
    }
    tracks.push(keys);
  }
  return { frames, tracks };
}

// the six values of a track at a frame: the two keys around it, interpolated with C integer division
function sample(keys, f, out) {
  const n = keys.length / 7;
  let k = 0;
  for (; k < n; k++) {
    if (f < keys[k * 7]) {
      const p = (k - 1) * 7, q = k * 7, df = f - keys[p], dt = keys[q] - keys[p];
      for (let j = 1; j < 7; j++) out[j - 1] = (Math.trunc(Math.imul(keys[q + j] - keys[p + j], df) / dt) + keys[p + j]) | 0;
      return;
    }
  }
  for (let j = 1; j < 7; j++) out[j - 1] = keys[(k - 1) * 7 + j];
}

// ------------------------------------------------------------------ the scene (FUN_004646d0)
export class Avatar3D {
  // body, face, items: decoded asset payloads (Uint8Array)
  constructor(body, face, items) {
    const d = body, len1 = i32(d, 4);
    this.body = parseMesh(d, 8);
    // bones: u8 count, then 13 bytes each (position s16 x3, angles s16 x3, s8 parent)
    const len2 = i32(d, 8 + len1), nb = u8(d, len1 + 0x14);
    this.bones = [];
    for (let i = 0, o = len1 + 0x15; i < nb; i++, o += 13) {
      this.bones.push({ pos: [s16(d, o), s16(d, o + 2), s16(d, o + 4)], rot: [s16(d, o + 6), s16(d, o + 8), s16(d, o + 10)],
        parent: s8(d, o + 12), bind: ident(), bindPos: new Int32Array(3), world: ident(), worldPos: new Int32Array(3) });
    }
    for (const b of this.bones) {        // rest pose; parents first, a later parent is still the identity
      b.bind = ident();
      mul(b.bind, rotZ(b.rot[2])); mul(b.bind, rotX(b.rot[1])); mul(b.bind, rotY(b.rot[0]));
      if (b.parent === -1) b.bindPos.set(b.pos);
      else {
        const P = this.bones[b.parent];
        mul(b.bind, P.bind);
        const [x, y, z] = b.pos, B = P.bind;
        b.bindPos[0] = (dot(x, y, z, B[0], B[3], B[6]) + P.bindPos[0]) | 0;
        b.bindPos[1] = (dot(x, y, z, B[1], B[4], B[7]) + P.bindPos[1]) | 0;
        b.bindPos[2] = (dot(x, y, z, B[2], B[5], B[8]) + P.bindPos[2]) | 0;
      }
    }
    for (const b of this.bones) {        // transposed: the inverse rest rotation
      const m = b.bind;
      b.bind = Int32Array.of(m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]);
    }
    // textures: [u32 size][GIF] x 10; the body uses the first two, the face replaces the second
    let o = len1 + 0xc + len2;
    const gifs = [];
    for (let k = 0; k < 10; k++) { const n = i32(d, o); gifs.push(d.subarray(o + 4, o + 4 + n)); o += 4 + n; }
    if (this.body.tex.length > 0) this.body.tex[0] = texture(gifs[0]);
    if (this.body.tex.length > 1) this.body.tex[1] = texture(face.subarray(8, 8 + i32(face, 4)));
    // items: [u32][u32 len][mesh][u32 size][GIF]
    this.items = (items || []).slice(0, 8).map((it) => {
      const n = i32(it, 4), m = parseMesh(it, 8);
      if (m.tex.length) m.tex[0] = texture(it.subarray(12 + n, 12 + n + i32(it, 8 + n)));
      return m;
    });
    this.buckets = new Array(0x10000);
    this.zbuf = new Int32Array(W2 * H2);
    this.color = new Int32Array(W2 * H2);
    this.out565 = new Uint16Array(256 * 256);
    this.motion = null;
    this.camera = null;
  }

  setMotion(payload) { this.motion = parseTracks(payload); return this.motion.frames; }
  setCamera(payload) { this.camera = parseTracks(payload); }

  // FUN_00461bb0: bone i follows track i (bones without a track keep their last pose)
  animate(f) {
    const v = new Int32Array(6), tracks = this.motion.tracks;
    for (let i = 0; i < tracks.length && i < this.bones.length; i++) {
      const b = this.bones[i];
      sample(tracks[i], f, v);
      const m = ident();
      mul(m, rotZ(v[5])); mul(m, rotX(v[4])); mul(m, rotY(v[3]));
      if (b.parent === -1) {
        b.world = m;
        b.worldPos[0] = v[0]; b.worldPos[1] = v[1]; b.worldPos[2] = v[2];
      } else {
        const P = this.bones[b.parent], W = P.world;
        mul(m, W);
        b.world = m;
        const x = v[0], y = v[1], z = v[2];
        b.worldPos[0] = (dot(x, y, z, W[0], W[3], W[6]) + P.worldPos[0]) | 0;
        b.worldPos[1] = (dot(x, y, z, W[1], W[4], W[7]) + P.worldPos[1]) | 0;
        b.worldPos[2] = (dot(x, y, z, W[2], W[5], W[8]) + P.worldPos[2]) | 0;
      }
    }
  }

  // FUN_00462a10: the camera's first track
  view(f) {
    const v = new Int32Array(6);
    sample(this.camera.tracks[0], f, v);
    const m = ident();
    mul(m, rotZ(v[5])); mul(m, rotX(v[4])); mul(m, rotY(v[3]));
    return { m, t: [v[0], v[1], v[2]] };
  }

  // FUN_004632f0: transform a model's vertices bone by bone, queue its visible polygons by depth
  project(model, view) {
    const V = view.m, [cx0, cy0, cz0] = view.t, verts = model.verts;
    for (let bi = 0; bi < this.bones.length; bi++) {
      const b = this.bones[bi];
      let C = null;
      for (let g = 0; g < model.groups.length; g++) {
        const grp = model.groups[g];
        if (grp.bone !== bi) continue;
        if (!C) { C = Int32Array.from(b.bind); mul(C, b.world); }
        for (let i = grp.start; i < grp.end; i++) {
          const k = i * 6;
          const px = ((Math.imul(ONE, verts[k]) >> 12) - (Math.imul(b.bindPos[0], ONE) >> 12)) | 0;
          const py = ((Math.imul(verts[k + 1], ONE) >> 12) - (Math.imul(b.bindPos[1], ONE) >> 12)) | 0;
          const pz = ((Math.imul(verts[k + 2], ONE) >> 12) - (Math.imul(b.bindPos[2], ONE) >> 12)) | 0;
          const wx = (dot(px, py, pz, C[0], C[3], C[6]) + b.worldPos[0] - cx0) | 0;
          const wy = (dot(px, py, pz, C[1], C[4], C[7]) + b.worldPos[1] - cy0) | 0;
          const wz = (dot(px, py, pz, C[2], C[5], C[8]) + b.worldPos[2] - cz0) | 0;
          const z = dot(wx, wy, wz, V[6], V[7], V[8]);
          if (z < NEAR) verts[g * 6 + 5] = 0;       // (sic) the exe clears the vertex at the group's index
          else {
            verts[k + 3] = (Math.trunc(Math.imul(FOCAL, dot(wx, wy, wz, V[0], V[1], V[2])) / z) + CX) | 0;
            verts[k + 4] = (CY - Math.trunc(Math.imul(FOCAL, dot(wx, wy, wz, V[3], V[4], V[5])) / z)) | 0;
            verts[k + 5] = z;
          }
        }
      }
    }
    for (const f of model.faces) {
      const n = f.n === 3 ? 3 : 4;
      let sum = 0, ok = true;
      for (let c = 0; c < n; c++) { const z = verts[f.idx[c] * 6 + 5]; if (z === 0) ok = false; sum = (sum + z) | 0; }
      if (!ok) continue;
      const bucket = n === 3 ? Math.trunc(sum / 3) >> 1 : sum >> 3;
      if (bucket < 0 || bucket > 0xffff) continue;      // (the exe would write past its bucket table)
      const mat = model.mats[f.mat];
      const poly = { n, mode: mat ? mat.mode : 0, tex: mat ? model.tex[mat.tex] : null,
        x: [], y: [], z: [], u: f.u, v: f.v, next: this.buckets[bucket] || null };
      for (let c = 0; c < n; c++) {
        const k = f.idx[c] * 6;
        poly.x.push(verts[k + 3]); poly.y.push(verts[k + 4]); poly.z.push(verts[k + 5]);
      }
      this.buckets[bucket] = poly;
    }
  }

  // FUN_00463ca0: far buckets first, textured spans with a depth test; magenta texels are holes
  rasterize() {
    const zb = this.zbuf, col = this.color;
    for (let bk = 0xffff; bk >= 0; bk--) {
      for (let p = this.buckets[bk]; p; p = p.next) {
        if (p.tex && p.mode === 0) this.drawPoly(p, zb, col);
      }
    }
  }

  drawPoly(p, zb, col) {
    const n = p.n, T = p.tex, shift = T.shift & 31, wm = T.wmask, hm = T.hmask, tp = T.px;
    const X = p.x, Y = p.y, Z = new Int32Array(n), U = new Int32Array(n), Vv = new Int32Array(n);
    let top = 0, bot = 0;
    for (let k = 0; k < n; k++) {
      Z[k] = p.z[k] << 12; U[k] = p.u[k] << 12; Vv[k] = p.v[k] << 12;
      if (Y[k] < Y[top]) top = k;
      if (Y[bot] < Y[k]) bot = k;
    }
    // left edge walks backwards, right edge forwards; start = the vertex left behind, end = the next lower one
    let li = top, ri = top;
    let lEy = Y[top], lEx = X[top] << 16, lEz = Z[top], lEu = U[top], lEv = Vv[top];
    let rEy = Y[top], rEx = X[top] << 16, rEz = Z[top], rEu = U[top], rEv = Vv[top];
    let lx = 0, lz = 0, lu = 0, lv = 0, gx = 0, gz = 0, gu = 0, gv = 0;
    let rx = 0, rz = 0, ru = 0, rv = 0, hx = 0, hz = 0, hu = 0, hv = 0;
    const yEnd = Y[bot];
    let row = Math.imul(W2, Y[top]);
    for (let y = Y[top]; y !== yEnd; y++) {
      if (y === lEy) {
        let ny, nx, nz, nu, nv;
        do {
          lx = lEx; lz = lEz; lu = lEu; lv = lEv;
          li = li - 1 < 0 ? n - 1 : li - 1;
          ny = Y[li]; nx = X[li] << 16; nz = Z[li]; nu = U[li]; nv = Vv[li];
          if (ny > lEy) break;
          lEy = ny; lEx = nx; lEz = nz; lEu = nu; lEv = nv;
        } while (true);
        const dy = ny - lEy;
        gx = Math.trunc((nx - lEx) / dy); gz = Math.trunc((nz - lEz) / dy);
        gu = Math.trunc((nu - lEu) / dy); gv = Math.trunc((nv - lEv) / dy);
        lEy = ny; lEx = nx; lEz = nz; lEu = nu; lEv = nv;
      }
      if (y === rEy) {
        let ny, nx, nz, nu, nv;
        do {
          rx = rEx; rz = rEz; ru = rEu; rv = rEv;
          ri = ri + 1 >= n ? 0 : ri + 1;
          ny = Y[ri]; nx = X[ri] << 16; nz = Z[ri]; nu = U[ri]; nv = Vv[ri];
          if (ny > rEy) break;
          rEy = ny; rEx = nx; rEz = nz; rEu = nu; rEv = nv;
        } while (true);
        const dy = ny - rEy;
        hx = Math.trunc((nx - rEx) / dy); hz = Math.trunc((nz - rEz) / dy);
        hu = Math.trunc((nu - rEu) / dy); hv = Math.trunc((nv - rEv) / dy);
        rEy = ny; rEx = nx; rEz = nz; rEu = nu; rEv = nv;
      }
      if (y >= 0 && y < H2) {
        let x0 = lx >> 16, x1 = rx >> 16, w = x1 - x0, dz = 0, du = 0, dv = 0;
        if (w !== 0) { dz = Math.trunc((rz - lz) / w); du = Math.trunc((ru - lu) / w); dv = Math.trunc((rv - lv) / w); }
        let z = lz, u = lu, v = lv;
        if (x0 < 0) {
          z = (lz - Math.imul(dz, x0)) | 0; u = (lu - Math.imul(du, x0)) | 0; v = (lv - Math.imul(dv, x0)) | 0; x0 = 0;
        }
        if (x1 > W2) x1 = W2;
        for (let x = x0 + row, e = x1 + row; x < e; x++) {
          if (z < zb[x]) {
            let t = tp[(((v >> 12) & hm) << shift) + ((u >> 12) & wm)];
            if (t === 0) t = 1;
            if (t !== 0xff00ff) { zb[x] = z; col[x] = t; }
          }
          z = (z + dz) | 0; u = (u + du) | 0; v = (v + dv) | 0;
        }
      }
      lx = (lx + gx) | 0; lz = (lz + gz) | 0; lu = (lu + gu) | 0; lv = (lv + gv) | 0;
      rx = (rx + hx) | 0; rz = (rz + hz) | 0; ru = (ru + hu) | 0; rv = (rv + hv) | 0;
      row += W2;
    }
  }

  // FUN_00461890 + FUN_00403030: frame f of the current motion/camera as 256x256 RGB565 (KEY = transparent)
  render(f) {
    this.zbuf.fill(0x7fff8000);
    this.color.fill(0);
    this.buckets.fill(null);
    this.animate(f);
    const view = this.view(f);
    for (const it of this.items) this.project(it, view);
    this.project(this.body, view);
    this.rasterize();
    const src = this.color, out = this.out565;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (2 * y) * W2 + 2 * x;
        const a = src[i], b = src[i + 1], c = src[i + W2], d = src[i + W2 + 1];
        let p = BG;
        if (a !== 0 && b !== 0 && c !== 0 && d !== 0) {
          const R = (((a >> 16) & 255) + ((b >> 16) & 255) + ((c >> 16) & 255) + ((d >> 16) & 255)) >> 2;
          const G = (((a >> 8) & 255) + ((b >> 8) & 255) + ((c >> 8) & 255) + ((d >> 8) & 255)) >> 2;
          const B = ((a & 255) + (b & 255) + (c & 255) + (d & 255)) >> 2;
          p = (0xff << 24) | (R << 16) | (G << 8) | B;
        }
        out[y * 256 + x] = (((p >> 16) & 255) >> 3) << 11 | (((p >> 8) & 255) >> 2) << 5 | ((p & 255) >> 3);
      }
    }
    return out;
  }
}

// FUN_00403280: the face icon, a 40x40 crop at (108, 108) moved to the top left (in place)
export function faceCrop(px) {
  const tmp = new Uint16Array(40 * 40), bg = px[0];
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) tmp[y * 40 + x] = px[(108 + y) * 256 + 108 + x];
  px.fill(bg);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) px[y * 256 + x] = tmp[y * 40 + x];
}

// FUN_004031f0: clear the pixels a mask frame covers (runs = Int32 quads x, y, n, offset)
export function applyMask(px, runs) {
  const bg = px[0];
  for (let i = 0; i < runs.length; i += 4) px.fill(bg, runs[i + 1] * 256 + runs[i], runs[i + 1] * 256 + runs[i] + runs[i + 2]);
}

// FUN_00403140: a 256x256 RGB565 frame as runs (x, y, n, pixels) of non-KEY pixels; runs may wrap rows like the exe's
export function toRuns(px) {
  const quads = [], pixels = [];
  let i = 0;
  while (i < 0x10000) {
    if (px[i] === KEY) { i++; continue; }
    let n = 1;
    while (i + n < 0x10000 && px[i + n] !== KEY) n++;
    quads.push(i & 0xff, i >> 8, n, pixels.length);
    for (let k = 0; k < n; k++) pixels.push(px[i + k]);
    i += n;
  }
  return { quads: Int32Array.from(quads), pixels: Uint16Array.from(pixels) };
}

// The 37 sprite sets in the game's slot order (FUN_00403bd0 / FUN_00403320), each a list of frames {quads, pixels}.
// load(kind, n) -> Promise<Uint8Array> (asset payloads); masks: { name: [frame quads...] }; slots: only these (the
// face, slot 36, is cut from the render before it, so slot 35 is drawn for it too).
export const PREVIEW_SLOT = 35, FACE_SLOT = 36;
export async function buildSets(desc, load, { masks = {}, slots = null } = {}) {
  const { body, face, items } = desc;
  const [bp, fp, ...ip] = await Promise.all([load(0, body), load(1, face), ...items.map((n) => load(2, n))]);
  const av = new Avatar3D(bp, fp, ip);
  const want = slots ? new Set(slots) : null;
  if (want && want.has(FACE_SLOT)) want.add(PREVIEW_SLOT);
  const sets = new Array(37).fill(null);
  for (let slot = 0; slot < 37; slot++) {
    if (want && !want.has(slot)) continue;
    const s = BUILD_ORDER[slot];
    const n = av.setMotion(await load(3, motionId(s, body))) + 1;
    av.setCamera(await load(4, SET_TABLE[s][1]));
    const frames = [];
    for (let f = 0; f < n; f++) {
      if (s === FACE_SET) faceCrop(av.out565);
      else {
        av.render(f);
        const m = masks[MASKS[s]];
        if (m && m.length) applyMask(av.out565, m[Math.min(f, m.length - 1)]);
      }
      frames.push(toRuns(av.out565));
    }
    sets[slot] = frames;
  }
  return sets;
}
