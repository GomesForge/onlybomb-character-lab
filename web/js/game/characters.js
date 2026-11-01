// Characters (docs/client/G_player.md §10). In the original the body comes from the avatar
// descriptor: a "special character" item selects a 37-sprite pack in Data/cache plus a colour that
// tints the grey pixels (FUN_0042d2b0). Pack 1000 is the White Bomberman. Every player's character comes
// from the avatar in the room entries (0x7d8), so the web client draws what BomberMan.exe draws.

import { Runs, HD_SHEETS, HD_STATE } from "./fb565.js";
import { Sprite, loadSprite } from "../assets/spr.js";
import { unscramble } from "./scramble.js";
import { display } from "./display.js";
import { hdPixels } from "./hdpixels.js";

// colour table at 0x477b00
export const COLOURS = [
  [220, 220, 220], [255, 30, 10], [235, 95, 220], [220, 210, 180], [210, 210, 210], [40, 150, 255], [220, 220, 220],
  [200, 200, 200], [90, 170, 50], [70, 70, 100], [216, 206, 186], [70, 70, 70], [0, 60, 240], [30, 130, 255],
  [120, 70, 240], [0, 0, 0], [255, 105, 105], [73, 227, 52], [255, 240, 91], [220, 170, 170], [83, 115, 158],
  [50, 50, 50], [255, 20, 20], [0, 50, 255], [50, 200, 30], [255, 255, 0], [255, 220, 20], [160, 160, 160],
  [160, 62, 44], [234, 0, 0], [50, 50, 50], [255, 0, 0], [255, 212, 0], [255, 0, 0],
];

// The special-character table at 0x477100 (FUN_00403610): avatar item -> [pack, colour index, condition on
// avatar +0x30 (1: >= 0, 2: > 4, 3: > 8, 4: > 14)]. Two id ranges of 46 entries; 100025 and 100026 are the same yellow.
const TABLE = new Map();
{
  const first = [[100020, 1000, 0], [100021, 1000, 21], [100022, 1000, 22], [100023, 1000, 23], [100024, 1000, 24],
    [100025, 1000, 26], [100026, 1000, 26], [100027, 1000, 27]];
  for (let k = 0; k < 20; k++) first.push([100028 + k, 1001 + k, 1 + k]);
  for (let k = 0; k < 14; k++) first.push([100052 + k, 1021 + k, 29 + k]);
  for (let k = 0; k < 4; k++) first.push([100067 + k, 1035 + k, 43 + k]);
  const second = [];
  for (let id = 1100018; id <= 1100045; id++) second.push(id);
  for (let id = 1100048; id <= 1100058; id++) second.push(id);
  second.push(1100060, 1100061, 1100062, 1100064, 1100065, 1100066, 1100067);
  first.forEach(([id, pack, col], k) => {
    const e = [pack, col, pack === 1007 || pack === 1010 ? 2 : 1];
    TABLE.set(id, e);
    TABLE.set(second[k], e);
  });
}
const COLOUR_NAMES = ["White", "Black", "Red", "Blue", "Green", "Yellow", "Grey"];

// character (look) n -> [pack, colour index, name, avatar item]: the table's 45 distinct entries in its order (then
// the web-only characters, addCharacters).
// The server stores a player's character as that item in the account's avatar, as BomberMan.exe reads it.
export const CHARACTERS = [...TABLE].filter(([id]) => id < 1000000 && id !== 100026)
  .map(([id, [pack, col]], n) => [pack, col, n < 7 ? COLOUR_NAMES[n] : `Special ${n - 6}`, id]);
export const CHARACTER_COUNT = CHARACTERS.length;
const LOOK_OF = new Map(CHARACTERS.map(([pack, col], n) => [pack + ":" + col, n]));

// The web-only characters (the shop's "characters", in the server's /config.json), after the 45. BomberMan.exe shows
// built-in character `look`. One of its own 37 sheets (web/skins/characters/<folder>/, not tinted: colour null) comes
// by its id from the game's port ("sheets": "c<id>") or by its folder from the GM panel's ("folder": "f<folder>");
// another: another look of `look`, its pack "m<pack>" from the models folder.
const FALLBACK = new Map();          // a web-only pack -> the built-in one drawn if its files are missing
const HD_PACKS = new Map();          // one with HD sheets ("hd": 1) -> its shop id
// (the ones it adds: the shop's catalogue brings the hidden ones this page may see, bmoserver/hidden.py)
export function addCharacters(list) {
  const before = CHARACTERS.length;
  for (const { id, name, look, folder, sheets, hd } of list || []) {
    const base = CHARACTERS[look];
    if (!base || TABLE.has(id)) continue;
    const pack = folder ? "f" + folder : sheets ? "c" + id : "m" + base[0], colour = folder || sheets ? null : base[1];
    FALLBACK.set(pack, base[0]);
    if (sheets && hd) HD_PACKS.set(pack, id);
    TABLE.set(id, [pack, colour, 1]);
    LOOK_OF.set(pack + ":" + colour, CHARACTERS.length);
    CHARACTERS.push([pack, colour, name, id]);
  }
  return CHARACTERS.length - before;
}
// a web-only character a player wears that this page does not know (a hidden one: not in /config.json): the page
// asks the catalogue again (main.js)
const WEB_CHARACTERS = [7000000, 8000000];
let unknownCharacter = () => {};
const unknownIds = new Set();        // (once each: one the catalogue does not bring is not this page's to see)
export function onUnknownCharacter(fn) { unknownCharacter = fn; }

// Character shown for a 52-byte avatar descriptor (FUN_00403bd0): its first special-character item whose condition
// holds, or -1 for a 3D avatar (the web client cannot draw those and shows the White Bomberman).
export function lookOfAvatar(desc) {
  if (!desc || desc.length < 52) return -1;
  const v = new DataView(desc.buffer, desc.byteOffset, 52), level = v.getInt32(0x30, true);
  for (let i = 0; i < 8; i++) {
    const id = v.getUint32(12 + 4 * i, true), e = TABLE.get(id);
    if (e && level >= [0, 0, 5, 9, 15][e[2]]) return LOOK_OF.get(e[0] + ":" + e[1]);
    if (!e && id >= WEB_CHARACTERS[0] && id < WEB_CHARACTERS[1] && !unknownIds.has(id)) {
      unknownIds.add(id);
      unknownCharacter(id);
    }
  }
  return -1;
}

export function characterName(c) { return (CHARACTERS[c] || CHARACTERS[0])[2]; }

// Sprite-set layout (FUN_00401aa0): index = group + dir (0 s, 1 w, 2 n, 3 e)
export const SET_MO = 0, SET_ST = 4, SET_TH = 8, SET_PA = 12, SET_PU = 16, SET_DD = 20, SET_WI = 21, SET_WA = 22,
  SET_MSB = 23, SET_RUI_MO = 27, SET_RUI_ST = 31, SET_PREVIEW = 35, SET_FACE = 36;
const WHITE_FILES = ["mo_s", "mo_w", "mo_n", "mo_e", "st_s", "st_w", "st_n", "st_e", "th_s", "th_w", "th_n", "th_e",
  "pa_s", "pa_w", "pa_n", "pa_e", "pu_s", "pu_w", "pu_n", "pu_e", "dd", "wi", "wa", "msb_ch_s", "msb_ch_w",
  "msb_ch_n", "msb_ch_e", "rui_mo_s", "rui_mo_w", "rui_mo_n", "rui_mo_e", "rui_st_s", "rui_st_w", "rui_st_n",
  "rui_st_e", "st_s", "face"];

// ------------------------------------------------------------------ Data/cache/*.dat (docs/tools/E_cachedat.py)
const ALPH = "0PQ12RH3J4K5L6M7NEFGZS8TVAB9CWXY";
function cacheName(id) {
  let u = (id ^ 0x19640421) >>> 0, s = "";
  for (let i = 0; i < 7; i++) { s += ALPH[u & 31]; u >>>= 5; }
  return s;
}
function* prng(id) {
  let s = id & 0xffff, c = (id >>> 16) & 0xffff;
  for (;;) {
    const ebx = (((s & 0x7f) << 8) ^ (s & 0x7f00)) | ((c ^ s) & 0xff);
    const bit = ((s >> 14) & 1) ^ (s & 1);
    c = (c + 1) & 0xffff;
    s = (bit + 2 * ebx) & 0xffff;
    yield ((s & 0xff) ^ (s >> 8)) & 0xff;
  }
}
// A web-only character's own files from the game's port (bmoserver/web.py player_file): to signed-in pages only, with
// their pass (0x8d3, session.js setFilesPass) as X-Pass, scrambled for that page (scramble.js). The GM panel has no
// pass: its port sends them plain.
let filesPass = null;                // the game's page: a promise of its pass (bytes); the GM panel's: null
let passArrived = null, passHex = "";
export function expectFilesPass() {
  if (!filesPass) filesPass = new Promise((resolve) => { passArrived = resolve; });
}
export function setFilesPass(pass) {
  if (passArrived) passArrived(pass);
  passArrived = null;
  filesPass = Promise.resolve(pass);
  passHex = toHex(pass);
}
const toHex = (pass) => Array.from(pass, (b) => b.toString(16).padStart(2, "0")).join("");
// X-Pass once the pass came (else none): it also tells the server which account's hidden shop items this page may
// get (bmoserver/hidden.py): the catalogue, their files
export const passHeaders = () => (passHex ? { "X-Pass": passHex } : {});
// a file with the pass, as a URL a picture shows (a hidden shop item's the page owns: not without it)
export async function passUrl(path) {
  const r = await fetch(path, { headers: passHeaders() });
  if (!r.ok) throw new Error(`no ${path}`);
  return URL.createObjectURL(await r.blob());
}
async function playerFile(path) {
  // (no pass in 15 s, a server of before: asked for without one)
  const pass = filesPass && await Promise.race([filesPass, new Promise((r) => setTimeout(r, 15000, null))]);
  const headers = pass ? { "X-Pass": toHex(pass) } : {};
  const r = await fetch(path, { headers });
  if (!r.ok) throw new Error(`no ${path}`);
  const data = new Uint8Array(await r.arrayBuffer()), nonce = r.headers.get("X-Scrambled");
  return (nonce && pass ? unscramble(data, pass, nonce) : data).buffer;
}

// a web-only character's sheets in the game's order (preview.gra may be missing: st_s.gra): by folder ("f", the GM
// panel's port) or by shop id ("c", the game's)
const FOLDER_FILES = WHITE_FILES.slice(0, 35).concat(["preview", "face"]);
async function loadFolder(folder) {
  const get = (f) => fetch(`skins/characters/${encodeURIComponent(folder)}/${f}.gra`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`no ${folder}/${f}.gra`))));
  return Promise.all(FOLDER_FILES.map((f) => (f === "preview" ? get(f).catch(() => get("st_s")) : get(f))));
}
function loadSheets(id) {
  const get = (f) => playerFile(`skins/c/${id}/${f}.gra`);
  return Promise.all(FOLDER_FILES.map((f) => (f === "preview" ? get(f).catch(() => get("st_s")) : get(f))));
}

async function loadPack(n) {
  let data;
  if (typeof n === "string" && n[0] === "f") return loadFolder(n.slice(1));
  if (typeof n === "string" && n[0] === "c") return loadSheets(n.slice(1));
  if (typeof n === "string") {      // "m<pack>": a web-only character's pack, from the server's models folder
    data = new Uint8Array(await playerFile(`avatar/model/0/${n.slice(1)}.bin`));
  } else {
    const r = await fetch(`data/cache/${cacheName(n)}.dat`, { headers: passHeaders() });   // (hidden: hidden.py)
    if (!r.ok) throw new Error(`missing game file Data/cache/${cacheName(n)}.dat`);
    const raw = new Uint8Array(await r.arrayBuffer());
    const g = prng(n);
    const hdr = new Uint8Array(8);
    for (let i = 0; i < 8; i++) hdr[i] = raw[i] ^ g.next().value;
    const size = new DataView(hdr.buffer).getUint32(0, true);
    data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = raw[8 + i] ^ g.next().value;
  }
  const v = new DataView(data.buffer);
  const count = v.getUint32(0, true), files = [];
  let p = 4;
  for (let i = 0; i < count; i++) {
    const len = v.getUint32(p, true);
    p += 4;
    files.push(data.slice(p, p + len).buffer);
    p += len;
  }
  return files;
}

const packCache = new Map();
const loading = new Set();           // packs on their way (HD sheets wait for them: setsIdle)
function packSprites(n) {
  let p = packCache.get(n);
  if (!p) {
    p = loadPack(n).then((files) => files.map((b, i) => new Sprite(`pack${n}/${i}`, b)))
      .catch(async () => {
        // a web-only pack missing: the built-in one; no cache file: the White set from Data/player/White (= pack 1000)
        if (typeof n === "string") return packSprites(FALLBACK.get(n) ?? 1000);
        return Promise.all(WHITE_FILES.map((f) => loadSprite(`player/White/${f}.gra`)));
      });
    packCache.set(n, p);
    loading.add(p);
    p.finally(() => loading.delete(p)).catch(() => {});
  }
  return p;
}
// every pack asked for here (the room's players', the match's: what it cannot start without)
async function setsIdle() {
  while (loading.size) await Promise.allSettled([...loading]);
}

// 37 Runs, tinted for character c (cached per character).
const setCache = new Map();
export function characterSet(c) {
  const [pack, colour] = CHARACTERS[c] || CHARACTERS[0];
  const key = pack + ":" + colour;
  let p = setCache.get(key);
  if (!p) {
    const [R, G, B] = COLOURS[colour] || [0, 0, 0];
    p = packSprites(pack).then((sprites) => sprites.map((s) => (colour === null ? Runs.fromSprite(s)
      : Runs.fromSprite(s).tinted(R, G, B))));
    // HD sheets: a web-only character's that has them, a game pack's (the White's in every colour, a Special's:
    // the game's page only)
    const hd = display.lite || HD_STATE.slow ? null : HD_PACKS.has(pack) ? `skins/c/${HD_PACKS.get(pack)}/hd`
      : HD_GAME_PACKS.has(pack) && filesPass ? `skins/packs/${pack}/hd` : null;
    if (hd) p.then((runs) => wantHd(hd, runs, colour === null ? null : [R, G, B])).catch(() => {});
    setCache.set(key, p);
  }
  return p;
}

// HD sheets (bmoserver/web.py /skins/c/<id>/hd/, /skins/packs/<pack>/hd/; fb565.js HD_SHEETS) by where they come
// from: the sets that want them (with the colour their greys are tinted with: a game pack's), the sheets come so far.
// Each sheet's picture goes on its Runs as it comes (until then, and without one, the game's pixels alone).
let HD_GAME_PACKS = new Set();       // the game's packs with HD sheets (/config.json "hd_packs")
export function setHdPacks(list) { HD_GAME_PACKS = new Set(list || []); }
const HD_FROM = new Map();
function wantHd(base, runs, tint) {
  if (HD_STATE.slow) return;
  let h = HD_FROM.get(base);
  if (!h) {
    h = { sets: [], sheets: new Map() };
    HD_FROM.set(base, h);
    loadHd(base, h).catch(() => {});
  }
  h.sets.push([runs, tint]);
  for (const [i, sheet] of h.sheets) attachHd(runs, i, sheet, tint);
}
function attachHd(runs, i, sheet, tint) {
  const r = runs[i];
  if (r && r.n === sheet.frames && !r.hd) { r.hd = sheet; r.hdTint = tint; }
}

// Their files come once every character's own sheets are here (setsIdle: those first on a slow line), HD_FETCHES at a
// time for all the characters together, by sheet: every character's walking and standing ones first. Each kept as it
// came (the WebP, a PNG of before) and decoded when the screen needs it (decode(): the pixels go once on the GPU).
const HD_FETCHES = 6;
const hdQueue = [];                  // [sheet index, base, its name, hd.json, its entry, HD_FROM's]
let hdFetching = 0;
async function loadHd(base, h) {
  await setsIdle();
  const meta = JSON.parse(new TextDecoder().decode(await playerFile(`${base}/hd.json`)));
  for (let i = 0; i < SET_PREVIEW; i++) {
    const name = FOLDER_FILES[i], m = meta.sheets && meta.sheets[name];
    if (m) hdQueue.push([i, base, name, meta, m, h]);
  }
  nextHd();
}
function nextHd() {
  while (hdFetching < HD_FETCHES && hdQueue.length && !HD_STATE.slow) {
    let k = 0;
    for (let j = 1; j < hdQueue.length; j++) if (hdQueue[j][0] < hdQueue[k][0]) k = j;
    hdFetching++;
    fetchHd(...hdQueue.splice(k, 1)[0]).catch(() => {}).finally(() => { hdFetching--; nextHd(); });
  }
}
async function fetchHd(i, base, name, meta, m, h) {
  await setsIdle();
  const webp = meta.format === "webp";
  const bytes = new Uint8Array(await playerFile(`${base}/${name}.${webp ? "webp" : "png"}`));
  if (HD_STATE.slow) return;
  const k = meta.scale, [bx, by, bw, bh] = m.box;
  let w = m.size && m.size[0], h2 = m.size && m.size[1], rects = m.rects;
  if (!rects) {                      // (before: a PNG, its frames in a grid of boxes)
    const size = new DataView(bytes.buffer, bytes.byteOffset + 16, 8);           // (IHDR: width, height)
    [w, h2] = [size.getUint32(0), size.getUint32(4)];
    rects = Array.from({ length: m.frames }, (_, f) => [(f % m.cols) * bw * k, Math.floor(f / m.cols) * bh * k, 0, 0,
      bw * k, bh * k]);
  }
  const boxes = rects.map(([, , rx, ry, rw, rh]) => (rw ? [bx + Math.floor(rx / k), by + Math.floor(ry / k),
    Math.ceil((rx + rw) / k) - Math.floor(rx / k), Math.ceil((ry + rh) / k) - Math.floor(ry / k)] : [0, 0, 0, 0]));
  const sheet = { scale: k, box: m.box, rects, boxes, frames: m.frames, w, h: h2, greyBit: !!meta.grey_bit,
    type: webp ? "image/webp" : "image/png", bytes, pixels: null, bad: false, decoding: null };
  sheet.decode = () => (sheet.decoding ||= decodeHd(sheet));
  h.sheets.set(i, sheet);
  HD_SHEETS.push(sheet);
  for (const [runs, tint] of h.sets) attachHd(runs, i, sheet, tint);
}

// An HD sheet's pixels (hdpixels.js) from its picture: by hd_worker.js, off the page's thread (the page itself where
// that cannot); a picture that will not decode: bad, never asked again.
let hdWorker = null, workerOk = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
const hdJobs = new Map();
let hdJob = 0;
function decodeHd(sheet) {
  return (workerOk ? inWorker(sheet).catch(() => hdPixels(sheet.bytes, sheet.type)) : hdPixels(sheet.bytes, sheet.type))
    .then((px) => { if (sheet.bytes) sheet.pixels = px; }, () => { sheet.bad = true; })
    .finally(() => { sheet.decoding = null; });
}
function inWorker(sheet) {
  if (!hdWorker) {
    try {
      hdWorker = new Worker(new URL("./hd_worker.js", import.meta.url), { type: "module" });
    } catch (e) {
      workerOk = false;
      return Promise.reject(e);
    }
    hdWorker.onmessage = ({ data }) => {
      const p = hdJobs.get(data.id);
      hdJobs.delete(data.id);
      if (!p) return;
      if (data.pixels) return p.resolve(data.pixels);
      if (/OffscreenCanvas/.test(data.error)) workerOk = false;
      p.reject(new Error(data.error));
    };
    hdWorker.onerror = () => {         // (one that will not start: a browser of before)
      workerOk = false;
      for (const p of hdJobs.values()) p.reject(new Error("no HD worker"));
      hdJobs.clear();
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++hdJob, bytes = sheet.bytes.slice();
    hdJobs.set(id, { resolve, reject });
    hdWorker.postMessage({ id, bytes, type: sheet.type }, [bytes.buffer]);
  });
}

// This page's device is too slow for HD characters (screen.js watchHd, match.js): none for the rest of the visit,
// the ones here let go (the screen lets go of theirs: Screen.dropHd).
export function dropHd() {
  HD_STATE.slow = true;
  hdQueue.length = 0;
  for (const h of HD_FROM.values()) {
    for (const [runs] of h.sets) for (const r of runs) if (r && r.hd) { r.hd = null; r.hdTint = null; }
  }
  for (const s of HD_SHEETS) { s.bytes = s.pixels = null; s.bad = true; }
  HD_SHEETS.length = 0;
}

// Louie (ride) sprites per mount 0..3: [MO s,w,n,e, ST s,w,n,e] tinted (FUN_00414790).
const LOUIE_TINT = [[255, 100, 200], [0, 255, 100], [0, 114, 188], [166, 124, 82]];
let louie = null;
export function louieSets() {
  if (!louie) {
    const files = ["MO_S", "MO_W", "MO_N", "MO_E", "ST_S", "ST_W", "ST_N", "ST_E"];
    louie = Promise.all(files.map((f) => loadSprite(`player/Lui/${f}.gra`)))
      .then((sprites) => LOUIE_TINT.map(([r, g, b]) => sprites.map((s) => Runs.fromSprite(s).tinted(r, g, b))));
  }
  return louie;
}

// For the room screen: recolour function for Sprite.frame() (same tint as the game).
export function characterRecolor(c) {
  const [, colour] = CHARACTERS[c] || CHARACTERS[0];
  const [R, G, B] = COLOURS[colour] || [0, 0, 0];
  const tint = (C, L) => (L < 128 ? Math.trunc(C * L / 128) : Math.trunc(C + (256 - C) * (L - 128) / 128));
  return (s) => {
    let r5 = s >> 11, g5 = (s >> 6) & 31, b5 = s & 31;
    let r, g, b;
    if (r5 === g5 && g5 === b5 && colour !== null) {     // (null: a character of its own, not tinted)
      const L = b5 << 3;
      r = tint(R, L) & 0xf8; g = tint(G, L) & 0xfc; b = tint(B, L) & 0xf8;
    } else {
      r = r5 << 3; g = ((s >> 5) & 63) << 2; b = b5 << 3;
    }
    return [r | (r >> 5), g | (g >> 6), b | (b >> 5)];
  };
}

// Preview sprite (standing south) of character c for the room's cards, the profile and the shop. A web-only character
// from the game's port: its picture alone (/skins/c/<id>/preview.gra: any signed-in page gets it, the rest only the
// pages that draw it, bmoserver/filepass.py may_have), unless its whole set is here already (characterSet).
const previewCache = new Map();
export async function characterPreview(c) {
  const [pack, , , id] = CHARACTERS[c] || CHARACTERS[0];
  if (!filesPass || typeof pack !== "string" || pack[0] === "f" || packCache.has(pack)) {
    return (await packSprites(pack))[SET_PREVIEW];
  }
  let p = previewCache.get(pack);
  if (!p) {
    p = playerFile(`skins/c/${id}/preview.gra`).then((b) => new Sprite(`preview${pack}`, b))
      .catch(async () => (await packSprites(FALLBACK.get(pack) ?? 1000))[SET_PREVIEW]);
    previewCache.set(pack, p);
  }
  return p;
}
