// Side art: a battle map's picture made wider than the exe's 800x600 (the GM panel's Side scenery, database side_art,
// served at /sideart/<design>.png), drawn beside the screen on a page wider than 4:3 instead of the blurred copy
// (match.js fitFrame, render.js). Its PNG is 800 + 2 x side by 600 game pixels: opaque beside the screen; over the
// screen opaque where the art takes the map's place (a car the map cuts at its edge, drawn whole; all round the
// frame; or the whole picture, the floor tiles, blocks and players going over it), clear elsewhere. What it takes over
// the screen is drawn on any page, also one with no room beside the screen; the picture's layers drawn again later
// (Standard's bottom wall, Soccer's goal nets) take its colours there too (overlayFor). A page wider than the art gets
// the art mirrored on past its outer edge (sideFor): every
// page full, whatever its shape. A web-only arena (rooms of 7 to 12) has its own, made for its bigger screen (a slot
// of its own, below); without one it grows the field's as its background (arenaSideFor). Galaxy has slots of its own,
// and so has each custom map, for its own screen. docs/client/F_render.md §11.

import { rgb565, Runs } from "./fb565.js";

// Each design's slots: 0..8 the exe's 800x600 field's, then design + 9 x n for the n-th arena size (bmoserver/maps.py
// ARENAS, web.py SIDE_SCREENS), each art made for that screen; Galaxy's GALAXY_SLOT + n; a custom map's its map index
// (1000 + its id), for the screen of its field (bmoserver/db.py side_screen).
export const ARENAS = [[21, 17], [25, 19]];
export const GALAXY_SLOT = 27;
export const slotOf = (design, size = 0) => design + 9 * size;
export const screenOf = (size) => (size ? [40 * ARENAS[size - 1][0] + 120, 38 * ARENAS[size - 1][1] + 48] : [800, 600]);
export const arenaSize = (w, h) => ARENAS.findIndex(([aw, ah]) => aw === w && ah === h) + 1;   // 0: none of these

const LIST_MS = 30000;            // the list of maps with side art is asked again after this long (a match's start)
let list = null, listAt = 0;      // Promise of {design: version}
const cache = new Map();          // "design:version" -> Promise of the art or null

function versions() {
  if (!list || performance.now() - listAt > LIST_MS) {
    listAt = performance.now();
    list = fetch("sideart.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  }
  return list;
}

// {side, sw, sh (its screen), px: RGB565 of the whole picture, runs: [beside the screen, over it]} (FB.sideArt's quads
// x, y, n, offset), floor (it has the map's floor too: render.js draws no floor tiles over it), or null: no art in that
// slot (made for screen `size`: 0 the exe's field, n the n-th arena's or a custom map's of that size), or it would not
// load. A new version (the panel's) is read at the next match.
export async function sideArt(slot, size = 0) {
  const list = await versions(), v = list[slot];
  if (!v) return null;
  const key = slot + ":" + v;
  let p = cache.get(key);
  if (!p) {
    const floor = Array.isArray(list.floor) && list.floor.includes(slot);
    p = load(`sideart/${slot}.png?v=${encodeURIComponent(v)}`, ...screenOf(size))
      .then((art) => Object.assign(art, { floor }))
      .catch((e) => { console.warn("side art", slot, e); return null; });
    cache.set(key, p);
  }
  return p;
}

// The art for a frame `side` pixels wide at each side: the art itself when it has that much; else its own columns
// mirrored on past its outer edge (and back again on a very wide page), so the join shows no seam. The last one made
// is kept (a page changes size seldom).
export function sideFor(art, side) {
  if (side <= art.side) return art;
  if (art.wide && art.wide.side === side) return art.wide;
  const S = art.side, sw = art.sw, w0 = sw + 2 * S, w = sw + 2 * side, d = side - S;
  const col = (k) => { const m = k % (2 * S); return m < S ? m : 2 * S - 1 - m; };   // k px past the edge: its column
  const px = new Uint16Array(w * art.sh), beside = [], over = [];
  for (let y = 0; y < art.sh; y++) {
    const src = y * w0, dst = y * w;
    px.set(art.px.subarray(src, src + w0), dst + d);
    for (let k = 0; k < d; k++) {
      const c = col(k);
      px[dst + d - 1 - k] = art.px[src + c];
      px[dst + d + w0 + k] = art.px[src + w0 - 1 - c];
    }
    beside.push(0, y, side, dst, side + sw, y, side, dst + side + sw);
  }
  const o = art.runs[1];
  for (let i = 0; i < o.length; i += 4) over.push(o[i] + d, o[i + 1], o[i + 2], o[i + 1] * w + o[i] + d);
  art.wide = { side, sw, sh: art.sh, px, runs: [Int32Array.from(beside), Int32Array.from(over)] };
  return art.wide;
}

// The exe field's art (800 x 600) for a web-only arena's frame without its own (arenabg.js arenaBackground: the map's
// picture grown round a bigger field).
// Beside the screen each column is the art's with the rows the arena gave the scenery there (back.rows: made taller
// by seam insertion, as the picture's own scenery outside the border tiles, so the join shows no seam); past the
// art's edge its columns mirrored on, with their rows, as sideFor does. Over the screen, the art's whole things
// wherever the arena shows their pixels (back.at: for each screen pixel, sw x sh, the picture's pixel it shows,
// y * 800 + x, -1 for the field). The last one made is kept.
export function arenaSideFor(art, side, back, sw, sh) {
  if (art.arena && art.arena.side === side && art.arena.back === back) return art.arena;
  const S = art.side, w0 = 800 + 2 * S, fw = sw + 2 * side, { at, rows } = back;
  screenMask(art);
  const col = (k) => { const m = k % (2 * S); return m < S ? m : 2 * S - 1 - m; };   // k px past the edge: its column
  const px = new Uint16Array(fw * sh), beside = [], over = [];
  for (let j = 0; j < side; j++) {               // frame column j at the left, side + sw + j at the right
    const l = j >= side - S ? j - (side - S) : col(side - S - 1 - j);          // the art's column (= its block column)
    const r = j < S ? j : S - 1 - col(j - S);                                   // the art's column - (S + 800)
    for (let y = 0; y < sh; y++) {
      px[y * fw + j] = art.px[rows.left[l * sh + y] * w0 + l];
      px[y * fw + side + sw + j] = art.px[rows.right[(80 + r) * sh + y] * w0 + S + 800 + r];
    }
  }
  for (let y = 0; y < sh; y++) {
    const dst = y * fw;
    beside.push(0, y, side, dst, side + sw, y, side, dst + side + sw);
    let run = -1;
    for (let x = 0; x <= sw; x++) {
      const s = x < sw ? at[y * sw + x] : -1, on = s >= 0 && art.mask[s] === 1;
      if (on) px[dst + side + x] = art.px[((s / 800) | 0) * w0 + S + s % 800];
      if (on && run < 0) run = x;
      else if (!on && run >= 0) { over.push(side + run, y, x - run, dst + side + run); run = -1; }
    }
  }
  art.arena = { side, back, px, runs: [Int32Array.from(beside), Int32Array.from(over)] };
  return art.arena;
}

// Over the screen, where the art has pixels: art.mask, sw x sh, 1 there.
function screenMask(art) {
  if (!art.mask) {
    const { sw, sh, side } = art, o = art.runs[1];
    art.mask = new Uint8Array(sw * sh);
    for (let i = 0; i < o.length; i += 4) art.mask.fill(1, o[i + 1] * sw + o[i] - side, o[i + 1] * sw + o[i] - side + o[i + 2]);
  }
  return art.mask;
}

// The map's picture `runs` (its frames at screen positions) with the art's colours wherever the art takes its place:
// what render.js draws of the picture again over the floor or the players (Standard's bottom wall, Soccer's goal
// nets, the crater's frames) then stays the art's. The last one made is kept.
export function overlayFor(art, runs) {
  if (art.overlay && art.overlay.of === runs) return art.overlay.runs;
  const mask = screenMask(art), { sw, sh, side } = art, w0 = sw + 2 * side, px = runs.px.slice();
  for (const q of runs.frames) {
    for (let i = 0; i < q.length; i += 4) {
      const x = q[i], y = q[i + 1], n = q[i + 2], o = q[i + 3];
      if (y < 0 || y >= sh) continue;
      for (let k = Math.max(0, -x); k < n && x + k < sw; k++) {
        if (mask[y * sw + x + k]) px[o + k] = art.px[y * w0 + side + x + k];
      }
    }
  }
  art.overlay = { of: runs, runs: new Runs(runs.frames, px, runs.w, runs.h) };
  return art.overlay.runs;
}

// (the GM panel's Side scenery page loads a map's with it too: gm-panel/static/sidemaker.js grownArt)
export async function load(url, sw, sh) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const w = bmp.width, h = bmp.height, side = (w - sw) >> 1;
  if (side <= 0 || w !== sw + 2 * side || h !== sh) throw new Error(`${url}: ${w} x ${h}, not ${sw} + 2 x side by ${sh}`);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const d = g.getImageData(0, 0, w, h).data;
  const px = new Uint16Array(w * h), beside = [], over = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (d[4 * (y * w + x) + 3] < 128) { x++; continue; }
      const inside = x >= side && x < side + sw, end = inside ? side + sw : x < side ? side : w;
      const x0 = x;
      for (; x < end && d[4 * (y * w + x) + 3] >= 128; x++) {
        const i = y * w + x;
        px[i] = rgb565(d[4 * i], d[4 * i + 1], d[4 * i + 2]);
      }
      (inside ? over : beside).push(x0, y, x - x0, y * w + x0);
    }
  }
  return { side, sw, sh, px, runs: [Int32Array.from(beside), Int32Array.from(over)] };
}
