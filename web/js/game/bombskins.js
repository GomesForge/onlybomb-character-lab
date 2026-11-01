// Bomb skins (server extension, docs/protocol/C_room.md §5.7): shop.json "bombs", each a folder of web/skins/bombs/
// that the catalogue lists with its files. A skin replaces how a player's normal bombs look (bomb.spr resting and
// appearing, bomb_d.spr the placing marker, bomb_s.spr the shadow, bomb_f.eft the fuse spark) and the fire of all
// their bombs (flame_*.eft, boom_block.eft). What a skin lacks stays the game's own. Pierce and water bombs keep their
// look, as it tells the other players what they do. A player who picks Classic explosions (Options → Display,
// display.js) sees every fire as the game's own; the bombs keep their skin.
import { Runs, Eft, EFT_STD } from "./fb565.js";
import { Sprite, loadSprite, loadBinary } from "../assets/spr.js";
import { passHeaders } from "./characters.js";

export const SKIN_BASE = 8000000;            // the room entry's +0x29 is the skin id - SKIN_BASE (0: the game's bomb)
// the flame pieces in the order of A.flames (render.js): centre, horizontal, vertical, right, left, up, down end
const FLAME_FILES = ["flame_center.eft", "flame_hor.eft", "flame_ver.eft", "flame_right.eft", "flame_left.eft",
  "flame_up.eft", "flame_down.eft"];

let catalogue = null;
function skinList() {
  if (!catalogue) {     // (with the pass: the hidden ones this page may see, bmoserver/hidden.py)
    catalogue = fetch("shop/catalogue.json", { headers: passHeaders(), cache: "no-store" }).then((r) => r.json())
      .then((c) => c.bombs || [])
      .catch(() => { catalogue = null; return []; });
  }
  return catalogue;
}
// the shop has the catalogue already (main.js)
export function setSkinList(list) { if (list) catalogue = Promise.resolve(list); }
// a skin a player uses that the list lacks (a hidden one a player online just put on): main.js asks the catalogue again
let unknownSkin = () => {};
const unknownIds = new Set();                // (once each: one the catalogue does not bring is not this page's to see)
export function onUnknownSkin(fn) { unknownSkin = fn; }

const skins = new Map();                     // id -> Promise<skin or null>

// skin = { id, name, sprites: {idle, marker, shadow} (Sprite, for the shop), idle, marker, shadow (Runs, for the
// match), fuse, boom (Eft), flames: [7 Eft] }; any of them null when the folder lacks the file
export function bombSkin(id) {
  if (!id) return Promise.resolve(null);
  let p = skins.get(id);
  if (!p) {
    p = skinList().then((list) => {
      const s = list.find((x) => x.id === id);
      if (!s) {
        skins.delete(id);                    // (asked again once the list has it)
        if (!unknownIds.has(id)) { unknownIds.add(id); unknownSkin(id); }
        return null;
      }
      const files = s.files || {};
      return buildSkin(id, s.name, (f) => (files[f]
        ? fetch(`skins/bombs/${encodeURIComponent(s.folder)}/${encodeURIComponent(files[f])}`, { headers: passHeaders() })
          .then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
        : Promise.resolve(null)));
    });
    skins.set(id, p);
  }
  return p;
}

// A skin's file as the game reads it: a Sprite (.spr) or an Eft (.eft, an effect). Throws if it is not one, or if
// its pixels run past its end (the GM panel checks an upload with it).
export function readSkinFile(name, buf) {
  if (name.endsWith(".spr")) {
    const s = new Sprite(name, buf);
    if (!s.count || !s.w || !s.h) throw new Error(`${name}: a sprite without frames`);
    for (let i = 0; i < s.count; i++) s.eachPixel(i, () => {});
    return s;
  }
  const e = new Eft(buf);
  if (!e.n || !e.w || !e.h || e.w > 1024 || e.h > 1024) throw new Error(`${name}: not an effect file`);
  return e;
}

async function buildSkin(id, name, bin) {
  const read = async (f) => { const b = await bin(f); try { return b ? readSkinFile(f, b) : null; } catch (e) { return null; } };
  const [idle, marker, shadow, fuse, boom, ...flames] = await Promise.all([read("bomb.spr"), read("bomb_d.spr"),
    read("bomb_s.spr"), read("bomb_f.eft"), read("boom_block.eft"), ...FLAME_FILES.map(read)]);
  const runs = (x) => (x ? Runs.fromSprite(x) : null);
  return { id, name, sprites: { idle, marker, shadow }, idle: runs(idle), marker: runs(marker),
    shadow: runs(shadow), fuse, boom, flames };
}

// The GM panel: a skin of the files in hand ({name: ArrayBuffer}, before they are uploaded); forget the skins and the
// list read before (one changed)
export function skinFromFiles(files, name = "") { return buildSkin(0, name, (f) => Promise.resolve(files[f] || null)); }
export function forgetSkins() { skins.clear(); catalogue = null; }

// The game's own bomb, spark and fire (Data/) in the same form: the shop's "Classic", and what a skin lacks there.
let classic = null;
export function classicSkin() {
  if (!classic) {
    classic = (async () => {
      const spr = (p) => loadSprite(p).catch(() => null);
      const eft = (f) => loadBinary("effect/" + f).then((b) => new Eft(b)).catch(() => null);
      const [idle, marker, shadow, fuse, boom, ...flames] = await Promise.all([spr("bomb/bomb.spr"), spr("bomb/bomb_d.spr"),
        spr("bomb/bomb_s.spr"), eft("bomb_f.eft"), eft("boom_block.eft"),
        ...["CENTER", "HOR", "VER", "RIGHT", "LEFT", "UP", "DOWN"].map((n) => eft("FLAME_" + n + ".EFT"))]);
      return { id: 0, name: "Classic", sprites: { idle, marker, shadow }, fuse, boom, flames };
    })();
  }
  return classic;
}

// The shop's preview at time t (ms): the resting bomb twice its size with its spark (frames 0,0,1,2,3,3,3,2,1 at
// 100 ms, H_objects.md §3.4), and under it a row of its fire (left end, centre, right end; 10 frames at 50 ms).
const PULSE = [0, 0, 1, 2, 3, 3, 3, 2, 1];
const comp = typeof document !== "undefined" ? document.createElement("canvas") : null;
export function drawBombPreview(ctx, skin, base, t) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const idle = (skin && skin.sprites.idle) || base.sprites.idle, fuse = (skin && skin.fuse) || base.fuse;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#3b6b45";
  ctx.fillRect(0, 0, W, H);
  const f = PULSE[Math.floor(t / 100) % PULSE.length];
  comp.width = comp.height = 80;
  const c = comp.getContext("2d");
  if (idle) c.drawImage(idle.frame(f), 0, 0);
  if (fuse) c.drawImage(eftCanvas(fuse, Math.min(f, 3), EFT_STD), 0, 0);
  ctx.drawImage(comp, 14, 20, 52, 54, (W - 104) >> 1, 0, 104, 108);   // the bomb's area of the 80x80 frame
  const ff = Math.floor((t % 900) / 50);
  if (ff >= 10) return;
  [4, 0, 3].forEach((piece, k) => {
    const e = (skin && skin.flames[piece]) || base.flames[piece];
    if (e) ctx.drawImage(eftCanvas(e, ff, EFT_STD), ((W - 120) >> 1) + 40 * k, H - 40);
  });
}

// An effect frame as a canvas: the 8 layers with the table's alphas (/32), both pixels of a pair in the first one's
// colour, as the game draws it (FUN_0040b6b0). For the shop's preview; kept per effect and frame.
const eftCanvases = new WeakMap();
export function eftCanvas(e, f, table) {
  let byFrame = eftCanvases.get(e);
  if (!byFrame) eftCanvases.set(e, (byFrame = new Map()));
  const key = f + "|" + table.join(",");
  if (byFrame.has(key)) return byFrame.get(key);
  const c = document.createElement("canvas");
  byFrame.set(key, c);
  c.width = e.w;
  c.height = e.h;
  const ctx = c.getContext("2d"), img = ctx.createImageData(e.w, e.h), d = img.data;
  const layers = e.frames[Math.max(0, Math.min(e.n - 1, f | 0))] || [];
  for (let l = 0; l < 8; l++) {
    const q = layers[l];
    if (!q || table[l] > 32) continue;
    const a = Math.round((table[l] * 255) / 32);
    for (let i = 0; i < q.length; i += 4) {
      const x0 = q[i], y = q[i + 1], n = q[i + 2], o = q[i + 3];
      if (y >= e.h) continue;
      for (let k = 0; k < n; k++) {
        const x = x0 + k;
        if (x >= e.w) continue;
        const px = e.px[o + (k & ~1)], j = (y * e.w + x) * 4;
        d[j] = ((px >> 11) << 3) | (px >> 13);
        d[j + 1] = (((px >> 5) & 63) << 2) | ((px >> 9) & 3);
        d[j + 2] = ((px & 31) << 3) | ((px >> 2) & 7);
        d[j + 3] = a;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
