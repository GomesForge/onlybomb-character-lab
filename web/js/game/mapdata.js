// Map data shared with the server (bmoserver/maps.py):
//   Data/map/block.spr  46 map sets x 100 variants x 128 bytes, 17x15 nibbles (high first):
//                       0 floor, 1 soft block, 2 hard block, 9 border
//   Data/map/map.spr    46 records: 0xff+2 skipped, u16 n, n x 7-byte objects, 14 skipped, u8,
//                       6 x {s16 x, s16 y} spawn tiles, 1 skipped, u8
// The Korean client's files (data/kr/map/...) have 50 sets: sets 46..49 come from them (47..49 = Boss Battle caves).

import { loadBinary } from "../assets/spr.js";

// The field size: BomberMan.exe's 17x15, or a web-only arena of a room of 12 or a custom map's (server extension
// 0x8b5). Live bindings, so every module sees the size of the match being played.
export let W = 17, H = 15;
export const FLOOR = 0, SOFT = 1, HARD = 2, BORDER = 9;

let blocks = null, records = null, arena = null;

// arena = {w, h, spawns: [[x, y], ...], grown}: a field from the server (0x8b5) without map objects: a room of 12's
// generated arena, or a custom map's screen; grown: the map's picture is grown round it (an arena; a custom map's big
// screen without its own picture); null = the map's own field
export function setArena(a) {
  arena = a;
  W = a ? a.w : 17;
  H = a ? a.h : 15;
}
export function isArena() { return arena !== null && arena.grown; }

const SETS = 46, KR_SETS = 50;

export async function loadMapData() {
  if (!blocks) {
    const [b, m] = await Promise.all([loadBinary("map/block.spr"), loadBinary("map/map.spr")]);
    blocks = new Uint8Array(b);
    records = parseMapSpr(new DataView(m), SETS);
    try {                                    // the Korean sets after ours (Boss Battle); fine without them
      const [kb, km] = await Promise.all([loadBinary("kr/map/block.spr"), loadBinary("kr/map/map.spr")]);
      if (kb.byteLength >= KR_SETS * 12800 && blocks.length === SETS * 12800) {
        const all = new Uint8Array(KR_SETS * 12800);
        all.set(blocks);
        all.set(new Uint8Array(kb, SETS * 12800, (KR_SETS - SETS) * 12800), SETS * 12800);
        blocks = all;
        records = records.concat(parseMapSpr(new DataView(km), KR_SETS).slice(SETS));
      }
    } catch (e) { /* no Korean data on this server */ }
  }
}

function parseMapSpr(v, sets) {
  const out = [];
  let off = 0;
  for (let m = 0; m < sets; m++) {
    off += 0xff + 2;
    const n = v.getInt16(off, true);
    const objects = [];
    for (let i = 0; i < n; i++) {            // {s16 x, s16 y, s16 param, u8 type} (J_gimmicks §1.1)
      const o = off + 2 + i * 7;
      objects.push({ x: v.getInt16(o, true), y: v.getInt16(o + 2, true), param: v.getInt16(o + 4, true), type: v.getUint8(o + 6) });
    }
    off += 2 + n * 7;
    const items = [];                        // how many of each item type its soft blocks hide (maps.py item_pool)
    for (let i = 0; i < 14; i++) items.push(v.getUint8(off + i));
    off += 14 + 1;
    const spawns = [];
    for (let i = 0; i < 6; i++) spawns.push([v.getInt16(off + 4 * i, true), v.getInt16(off + 4 * i + 2, true)]);
    off += 24 + 2;
    out.push({ objects, spawns, items });
  }
  return out;
}

// Block layout of (map set, variant) as a flat array, index y*W+x. `record`: the tiles in block.spr's format to use
// instead (an arena, server extension 0x8b5).
export function layout(mapSet, variant, record = null) {
  const idx = mapSet * 100 + variant;
  const g = new Uint8Array(W * H);
  const src = record || blocks, base = record ? 0 : idx * 128, n = Math.ceil(W * H / 2);
  if (!src || base + n > src.length) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      g[y * W + x] = (x === 0 || y === 0 || x === W - 1 || y === H - 1) ? BORDER : (x % 2 && y % 2) ? HARD : FLOOR;
    }
    return g;
  }
  for (let i = 0; i < n; i++) {
    const b = src[base + i];
    g[i * 2] = b >> 4;
    if (i * 2 + 1 < W * H) g[i * 2 + 1] = b & 15;
  }
  return g;
}

export function spawnTile(mapSet, index) {
  if (arena) return arena.spawns[index] || null;
  const r = records && records[mapSet];
  if (!r || index < 0 || index > 5 || r.spawns[index][0] < 0) return null;
  return r.spawns[index];
}

export function mapObjects(mapSet) {
  if (arena) return [];
  return (records && records[mapSet]) ? records[mapSet].objects : [];
}

// The items hidden under a map set's soft blocks, one entry per item (maps.py item_pool): the designers' counts
export function mapItems(mapSet) {
  const counts = (records && records[mapSet]) ? records[mapSet].items : [];
  return counts.flatMap((n, type) => Array(n).fill(type));
}
