// The background of a web-only arena (a room of 7 to 12: aw x ah tiles, server maps.py ARENAS) grown from the map's
// 800x600 picture, and the side art made taller to go with it (docs/client/F_render.md §11). Its own module: the GM
// panel draws arenas with it too (gm-panel/static/sidemaker.js), for their own side scenery.

const TX = (c) => 40 + 40 * c, TY = (r) => 28 + 38 * r;

// Frame f of r as a w x h pixel buffer (0 where it has no pixels).
function pixels(r, f, w, h, into = new Uint16Array(w * h)) {
  const q = r.frame(f);
  for (let i = 0; i < q.length; i += 4) {
    const x = q[i], y = q[i + 1], n = q[i + 2], o = q[i + 3];
    if (y >= h) continue;
    for (let k = 0; k < n && x + k < w; k++) into[y * w + x + k] = r.px[o + k];
  }
  return into;
}

// The background of a web-only arena: the map's 800x600 picture around the aw x ah field, nothing stretched. Each side
// keeps its corners and its middle piece and grows by repeating a stretch of itself, inside windows picked by eye
// per scenery (away from the clock, the cars, the goal nets...). Within a window the start and length of the repeat
// are measured so that it joins seamlessly; a regular pattern (studs, kerbs) may be resampled by up to 8 % to fit.
// The 18 rows under the bottom border, where the second row of panels sits, repeat a few rows of it (FOOT).
// Floors come from tile.spr. Windows must stay inside the border corners: x 80..680, y 66..560.
const ZONES = {     // design -> windows [from, to] along the top, the bottom and both sides; shortest side repeat
  0: { top: [[160, 600]], side: [[120, 480]], min: 70 },   // the crater: grows both ways, one repeat each
  1: { top: [[120, 300], [460, 640]], side: [[66, 190], [360, 540]], min: 36 },
  2: { top: [[100, 270], [490, 660]], side: [[66, 250], [330, 540]], min: 70 },
  3: { top: [[180, 380], [400, 590]], side: [[140, 250], [350, 470]], min: 70 },
  4: { top: [[80, 230], [530, 680]], bottom: [[80, 360], [400, 680]], side: [[66, 540]], min: 140 },
  5: { top: [[100, 380], [400, 660]], side: [[66, 290], [310, 540]], min: 70 },
  6: { top: [[100, 380], [400, 660]], side: [[66, 170], [430, 560]], min: 50 },
  7: { top: [[120, 380], [400, 640]], side: [[100, 290], [310, 520]], min: 70 },
};
const FOOT = { 1: [566, 16], 2: [566, 16], 3: [578, 16], 4: [593, 6], 5: [566, 17], 6: [566, 16], 7: [566, 17] };
const BANDS = { top: [0, 66], bottom: [560, 600], left: [0, 80], right: [680, 800] };

// The repeat [a, p] inside window [lo, hi) that adds `share` pixels with the best join, or null. A repeat of
// [a, a + p) joins well when the picture around a + p looks like the picture around a (8 lines, across the band);
// short repeats are preferred a little. extra: more pictures the repeat runs through, {rgb, w (its width), band},
// each counting as much as the band (the crater's side art, which repeats with it: arenaBackground).
function bestZone(rgb, side, [lo, hi], share, min, band = BANDS[side], extra = []) {
  const across = side === "top" || side === "bottom";
  const parts = [{ rgb, w: 800, band }, ...extra].map(({ rgb, w, band: [b0, b1] }) => {
    const qs = Math.max(2, Math.floor((b1 - b0) / 60));    // ~60 samples across a band, at most every 2nd line
    return { rgb, w, b0, b1, qs, step: across ? 1 : w, n: Math.ceil((b1 - b0) / qs) };
  });
  const d = new Float64Array(hi - lo);
  let best = null;
  for (let p = Math.min(min, Math.max(6, share)); p < hi - lo - 8; p++) {
    const len = p + share, k = Math.max(1, Math.round(len / p)), scale = len / (k * p);
    if (Math.abs(scale - 1) > 0.08) continue;
    for (let x = lo; x + p < hi; x++) {          // d[x - lo]: line x against line x + p, each part's mean
      let s = 0;
      for (const { rgb, w, b0, b1, qs, step, n } of parts) {
        let t = 0;
        for (let q = b0; q < b1; q += qs) {
          const i = 3 * (across ? q * w + x : x * w + q), j = i + 3 * step * p;
          t += Math.abs(rgb[i] - rgb[j]) + Math.abs(rgb[i + 1] - rgb[j + 1]) + Math.abs(rgb[i + 2] - rgb[j + 2]);
        }
        s += t / n;
      }
      d[x - lo] = s;
    }
    for (let a = lo + 4; a + p + 4 <= hi; a++) {
      let s = 0;
      for (let j = -4; j < 4; j++) s += d[a + j - lo];
      const c = s / (8 * parts.length) + 0.02 * p + 100 * Math.abs(scale - 1);
      if (!best || c < best.c) best = { c, a, p };
    }
  }
  return best && [best.a, best.p];
}

// Source index for each of `out` indices along one side of `n` source pixels: the zones [a, p] share the extra
// length, each repeated (and resampled) to fill its part. (stretchMap: the same lengths, stretched.)
function axisMap(n, out, zones) {
  const m = new Int16Array(out), g = out - n;
  let o = 0, x = 0;
  zones.sort((u, v) => u[0] - v[0]).forEach(([a, p], i) => {
    const share = Math.floor(g / zones.length) + (i < g % zones.length ? 1 : 0), len = p + share;
    const k = Math.max(1, Math.round(len / p));
    while (x < a) m[o++] = x++;
    for (let t = 0; t < len; t++) m[o++] = a + Math.floor(t * k * p / len) % p;
    x = a + p;
  });
  while (o < out) m[o++] = Math.min(x++, n - 1);
  return m;
}

const rgbOf = (px) => {
  const rgb = new Uint8Array(3 * px.length);
  px.forEach((s, i) => { rgb[3 * i] = s >> 11 << 3; rgb[3 * i + 1] = (s >> 5 & 63) << 2; rgb[3 * i + 2] = (s & 31) << 3; });
  return rgb;
};

// Seam insertion (Avidan and Shamir's seam carving): `add` rows more in rows [lo, hi) of a picture bw wide and bh
// high (rgb, 3 bytes a pixel), each along the cheapest path across it (a row a column, a step of at most one row from
// one column to the next): the things painted there keep their shape, the ground between them grows. A pixel costs
// its detail (how much it differs from its neighbours) and how far its colour is from the ground's (`ground`: the
// picture's commonest colours), so that a smooth thing (a bomb) is not taken for ground. The paths are found one by
// one on the picture shrunk by those before. Returns how many times more each pixel of [lo, hi) is drawn, column by
// column (extra[c * h + j], j: its row - lo).
function seamRows(rgb, bw, bh, lo, hi, add, ground) {
  const h = hi - lo, extra = new Uint8Array(bw * h);
  const E = new Float32Array(bw * h), idx = new Int16Array(bw * h), cost = new Float32Array(bw * h);
  const from = new Int8Array(bw * h);
  for (let c = 0; c < bw; c++) {
    const cl = 3 * Math.max(0, c - 1), cr = 3 * Math.min(bw - 1, c + 1);
    for (let j = 0; j < h; j++) {
      const r = lo + j, row = 3 * bw * r, up = 3 * bw * Math.max(0, r - 1), dn = 3 * bw * Math.min(bh - 1, r + 1);
      let e = 0, far = 1e9;
      for (let ch = 0; ch < 3; ch++) {
        e += Math.abs(rgb[row + cr + ch] - rgb[row + cl + ch]) + Math.abs(rgb[dn + 3 * c + ch] - rgb[up + 3 * c + ch]);
      }
      for (let g = 0; g < ground.length; g += 3) {
        const i = row + 3 * c;
        far = Math.min(far, Math.abs(rgb[i] - ground[g]) + Math.abs(rgb[i + 1] - ground[g + 1]) + Math.abs(rgb[i + 2] - ground[g + 2]));
      }
      E[c * h + j] = e + (ground.length ? far : 0);
      idx[c * h + j] = j;
    }
  }
  let s = 0;
  for (let len = h; s < add && len > 2; s++, len--) {
    for (let j = 0; j < len; j++) cost[j] = E[idx[j]];
    for (let c = 1; c < bw; c++) {
      const p = (c - 1) * h, q = c * h;
      for (let j = 0; j < len; j++) {
        let best = cost[p + j], f = 0;
        if (j > 0 && cost[p + j - 1] < best) { best = cost[p + j - 1]; f = -1; }
        if (j + 1 < len && cost[p + j + 1] < best) { best = cost[p + j + 1]; f = 1; }
        cost[q + j] = best + E[q + idx[q + j]];
        from[q + j] = f;
      }
    }
    const last = (bw - 1) * h;
    let j = 0;
    for (let t = 1; t < len; t++) if (cost[last + t] < cost[last + j]) j = t;
    for (let c = bw - 1; c >= 0; c--) {           // back along the path: drawn twice, out of the shrunk picture
      const q = c * h, next = j + from[q + j];
      extra[q + idx[q + j]]++;
      idx.copyWithin(q + j, q + j + 1, q + len);
      j = next;
    }
  }
  for (let t = 0; s < add; s++, t++) {           // (a window too short for them all: the rest spread evenly)
    const j = Math.floor((t + 0.5) * h / (add - s + t));
    for (let c = 0; c < bw; c++) extra[c * h + j]++;
  }
  return extra;
}

// The ground's colours of a picture (rgb): the commonest ones (8 levels a channel), as many as cover 40 % of it (at
// most 6), each its pixels' mean, [r, g, b, r, g, b...].
function groundOf(rgb) {
  const n = new Uint32Array(512), sum = new Float64Array(512 * 3), total = rgb.length / 3;
  for (let i = 0; i < rgb.length; i += 3) {
    const b = (rgb[i] >> 5) << 6 | (rgb[i + 1] >> 5) << 3 | rgb[i + 2] >> 5;
    n[b]++; sum[3 * b] += rgb[i]; sum[3 * b + 1] += rgb[i + 1]; sum[3 * b + 2] += rgb[i + 2];
  }
  const out = [];
  let covered = 0;
  for (const b of [...n.keys()].sort((u, v) => n[v] - n[u]).slice(0, 6)) {
    if (covered >= 0.4 * total || !n[b]) break;
    out.push(sum[3 * b] / n[b], sum[3 * b + 1] / n[b], sum[3 * b + 2] / n[b]);
    covered += n[b];
  }
  return out;
}

// The scenery beside an arena's border tiles made as tall as the screen by seam insertion (seamRows): a picture bw
// wide and 600 high (rgb), each window {lo, hi, add} of its rows given `add` rows more, the rest as they are. The
// paths are found on the picture at half size (each two rows), an eighth of the work: an odd row more, at full size.
// Returns for each column and screen row (sh of them) the picture's row (rows[c * sh + y]).
function sceneryRows(rgb, bw, windows, sh) {
  const n = new Uint8Array(bw * 600).fill(1);   // times each pixel is drawn
  const w2 = bw >> 1, half = new Uint8Array(3 * w2 * 300), k = 3 * bw;
  for (let y = 0; y < 300; y++) {
    for (let c = 0; c < w2; c++) {
      for (let ch = 0; ch < 3; ch++) {
        const i = 3 * (2 * y * bw + 2 * c) + ch;
        half[3 * (y * w2 + c) + ch] = (rgb[i] + rgb[i + 3] + rgb[i + k] + rgb[i + k + 3] + 2) >> 2;
      }
    }
  }
  const ground = groundOf(half);
  for (const { lo, hi, add } of windows) {
    const l2 = (lo + 1) >> 1, h2 = (hi >> 1) - l2, e2 = seamRows(half, w2, 300, l2, l2 + h2, add >> 1, ground);
    for (let c = 0; c < bw; c++) {
      const q = Math.min(w2 - 1, c >> 1) * h2;
      for (let j = 0; j < h2; j++) { n[c * 600 + 2 * (l2 + j)] += e2[q + j]; n[c * 600 + 2 * (l2 + j) + 1] += e2[q + j]; }
    }
    if (add & 1) {
      const e1 = seamRows(rgb, bw, 600, lo, hi, 1, ground), h = hi - lo;
      for (let c = 0; c < bw; c++) for (let j = 0; j < h; j++) n[c * 600 + lo + j] += e1[c * h + j];
    }
  }
  const rows = new Int16Array(bw * sh);
  for (let c = 0; c < bw; c++) {
    let o = c * sh;
    for (let r = 0; r < 600; r++) for (let k = n[c * 600 + r]; k > 0 && o < (c + 1) * sh; k--) rows[o++] = r;
    while (o < (c + 1) * sh) rows[o++] = 599;
  }
  return rows;
}

// {px: the background, sw x sh (40 x 38 px a tile, a 40 px margin at the left, 80 px for the clock and the item
// panel at the right, the player panels along the top and the bottom); at: for each of its pixels the one of the 800x600 picture it shows (y * 800 + x),
// -1 for the field; with side art, rows: the scenery's rows (sceneryRows), {left, right, lw, rw}}. With the map's side
// art (sideart.js arenaSideFor, which draws it beside the screen with these rows) the scenery outside the border tiles
// (x < 40, x >= 720 of the picture) and the art beside it are made taller by seam insertion over the side windows and
// the rows under the bottom border, so that the big things painted there keep their shape; the border tiles still
// repeat, row for row with the field (picked on them alone), and outside the windows both are as the picture has
// them (Road's cars). The crater grows as a whole: its art repeats with it, the repeats picked across the art as well.
export function arenaBackground(bg, design, art, aw, ah) {
  const sw = 40 * aw + 120, sh = 38 * ah + 48;
  const src = pixels(bg, 0, 800, 600);
  if (design === 1) { pixels(bg, 2, 800, 600, src); pixels(bg, 1, 800, 600, src); }
  const rgb = rgbOf(src), at = new Int32Array(sw * sh).fill(-1), out = new Uint16Array(sw * sh);
  let rows = null;
  const done = () => { at.forEach((s, i) => { if (s >= 0) out[i] = src[s]; }); return { px: out, at, rows }; };
  const Z = ZONES[design] || ZONES[1], gx = sw - 800, gy = TY(ah - 1) - TY(14);
  const found = (side, wins, g, min, band, extra) => wins.map((win, i) => {
    const zone = bestZone(rgb, side, win, Math.floor(g / wins.length) + (i < g % wins.length ? 1 : 0), min, band, extra);
    return zone && { win, zone };
  }).filter(Boolean);
  const zones = (...a) => found(...a).map((z) => z.zone);
  if (art) art.rgb = art.rgb || rgbOf(art.px);
  if (design === 0) {                // the crater is painted across the whole picture, field and all: it grows both ways
    const w = art && 800 + 2 * art.side;
    const extra = art ? [{ rgb: art.rgb, w, band: [0, art.side] }, { rgb: art.rgb, w, band: [art.side + 800, w] }] : [];
    const xs = axisMap(800, sw, gx ? zones("top", Z.top, gx, 36, [0, 600]) : []);
    const ys = axisMap(600, sh, zones("left", Z.side, sh - 600, Z.min, [0, 800], extra));
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) at[y * sw + x] = ys[y] * 800 + xs[x];
    return done();
  }
  const top = axisMap(800, sw, gx ? zones("top", Z.top, gx, 36) : []);
  const bottom = axisMap(800, sw, gx ? zones("bottom", Z.bottom || Z.top, gx, 36) : []);
  const lz = gy ? found("left", Z.side, gy, Z.min, art ? [40, 80] : undefined) : [];
  const rz = gy ? found("right", Z.side, gy, Z.min, art ? [680, 720] : undefined) : [];
  const ls = axisMap(560, TY(ah - 1), lz.map((z) => z.zone)), rs = axisMap(560, TY(ah - 1), rz.map((z) => z.zone));
  const [fa, fp] = FOOT[design] || FOOT[1], fh = sh - TY(ah - 1), foot = axisMap(40, fh, [[fa - 560, fp]]);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let sx, sy;
      if (y < TY(1)) { sx = top[x]; sy = y; }
      else if (y >= TY(ah - 1)) { sx = bottom[x]; sy = 560 + foot[y - TY(ah - 1)]; }
      else if (x < TX(1)) { sx = x; sy = ls[y]; }
      else if (x >= TX(aw - 1)) { sx = x - gx; sy = rs[y]; }
      else continue;                              // the field: floor tiles
      at[y * sw + x] = sy * 800 + sx;
    }
  }
  if (art) {                         // the scenery: the art beside the screen and the picture's own outside the border
    const S = art.side, w0 = 800 + 2 * S, lw = S + 40, rw = 80 + S;
    const block = (w, pick) => {      // pick(c) -> [rgb, its width, its column]
      const b = new Uint8Array(3 * w * 600);
      for (let c = 0; c < w; c++) {
        const [from, fw, fc] = pick(c);
        for (let y = 0; y < 600; y++) b.set(from.subarray(3 * (y * fw + fc), 3 * (y * fw + fc) + 3), 3 * (y * w + c));
      }
      return b;
    };
    const windows = (zs) => (zs.length ? zs.map(({ win: [lo, hi] }, i) => ({ lo, hi,     // as the border tiles' shares
      add: Math.floor(gy / zs.length) + (i < gy % zs.length ? 1 : 0) })) : [{ lo: 66, hi: 560, add: gy }])
      .concat([{ lo: 560, hi: 600, add: fh - 40 }]);
    rows = {
      lw, rw,
      left: sceneryRows(block(lw, (c) => (c < S ? [art.rgb, w0, c] : [rgb, 800, c - S])), lw, windows(lz), sh),
      right: sceneryRows(block(rw, (c) => (c < 80 ? [rgb, 800, 720 + c] : [art.rgb, w0, S + 720 + c])), rw, windows(rz), sh),
    };
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < 40; x++) at[y * sw + x] = rows.left[(S + x) * sh + y] * 800 + x;
      for (let c = 0; c < 80; c++) at[y * sw + sw - 80 + c] = rows.right[c * sh + y] * 800 + 720 + c;
    }
  }
  return done();
}
