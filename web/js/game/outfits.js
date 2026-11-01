// 3D outfits on the web client: the avatar's body, face and items (from the 52-byte descriptor in the room
// entries) built into the game's 37 sprite sets by avatar3d.js in a worker, the way BomberMan.exe builds them.

import { Runs } from "./fb565.js";
import { loadSprite } from "../assets/spr.js";
import { MASKS, PREVIEW_SLOT } from "./avatar3d.js";
import { passHeaders } from "./characters.js";

// The 3D outfit of an avatar descriptor, or null (a 2D character, see characters.js lookOfAvatar).
export function outfitOfAvatar(desc, look) {
  if (!desc || desc.length < 52 || look >= 0) return null;
  const v = new DataView(desc.buffer, desc.byteOffset, 52), body = v.getUint32(4, true);
  if (body < 200000) return null;                          // 1000..1038 are the 2D packs
  const items = [];
  for (let i = 0; i < 8; i++) { const n = v.getUint32(12 + 4 * i, true); if (n) items.push(n); }
  return { body, face: v.getUint32(8, true), items };
}
export const outfitKey = (o) => `${o.body}:${o.face}:${o.items.join(",")}`;

let worker = null, nextId = 1;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./avatar_worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (p) data.error ? p.reject(new Error(data.error)) : p.resolve(data.sets);
  };
  // the riding masks (FUN_004031f0) as frame quads
  Promise.all(Object.values(MASKS).map((name) => loadSprite(`lobby/ready/${name}.gra`)
    .then((s) => [name, Runs.fromSprite(s).frames]).catch(() => [name, []])))
    .then((list) => worker.postMessage({ masks: Object.fromEntries(list) }));
  return worker;
}
function build(outfit, slots) {
  const w = getWorker(), id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, outfit, slots, pass: passHeaders()["X-Pass"] || "" });   // (hidden parts: hidden.py)
  });
}

// frames {quads, pixels} -> one Runs (pixel offsets moved into one shared array)
function toRuns(frames) {
  let total = 0;
  for (const f of frames) total += f.pixels.length;
  const px = new Uint16Array(total), out = [];
  let o = 0;
  for (const f of frames) {
    px.set(f.pixels, o);
    const q = Int32Array.from(f.quads);
    for (let i = 3; i < q.length; i += 4) q[i] += o;
    out.push(q);
    o += f.pixels.length;
  }
  return new Runs(out, px, 256, 256);
}

const full = new Map(), previews = new Map();
// The 37 sprite sets of an outfit (cached; built once per outfit).
export function outfitSets(outfit) {
  const key = outfitKey(outfit);
  if (!full.has(key)) {
    const p = build(outfit, null).then((sets) => sets.map(toRuns));
    p.catch(() => full.delete(key));
    full.set(key, p);
  }
  return full.get(key);
}
// Only the standing portrait (slot 35, one frame): the room seats and the shop's preview.
export function outfitPreview(outfit) {
  const key = outfitKey(outfit);
  if (full.has(key)) return full.get(key).then((sets) => sets[PREVIEW_SLOT]);
  if (!previews.has(key)) {
    const p = build(outfit, [PREVIEW_SLOT]).then((sets) => toRuns(sets[PREVIEW_SLOT]));
    p.catch(() => previews.delete(key));
    previews.set(key, p);
  }
  return previews.get(key);
}

// Draw frame 0 of a Runs set into a canvas, cropped to its pixels and scaled to fit; `top` < 1 keeps only that share
// of its height from the top (the head: the shop's faces).
export function drawRunsFit(canvas, runs, margin = 0.9, top = 1) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let q = runs.frame(0);
  if (!q.length) return;
  let y0 = 1e9, y1 = -1;
  for (let i = 0; i < q.length; i += 4) { y0 = Math.min(y0, q[i + 1]); y1 = Math.max(y1, q[i + 1]); }
  if (top < 1) {
    const last = y0 + Math.max(1, Math.round((y1 - y0 + 1) * top)) - 1;
    q = q.filter((_, i) => q[i - i % 4 + 1] <= last);
    y1 = last;
  }
  let x0 = 1e9, x1 = -1;
  for (let i = 0; i < q.length; i += 4) { x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i] + q[i + 2] - 1); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, img = new ImageData(w, h), d = img.data;
  for (let i = 0; i < q.length; i += 4) {
    for (let k = 0; k < q[i + 2]; k++) {
      const x = q[i] + k - x0, y = q[i + 1] - y0;
      if (x >= w || y >= h) continue;
      const v = runs.px[q[i + 3] + k], o = (y * w + x) * 4;
      const r5 = v >> 11, g6 = (v >> 5) & 63, b5 = v & 31;
      d[o] = (r5 << 3) | (r5 >> 2); d[o + 1] = (g6 << 2) | (g6 >> 4); d[o + 2] = (b5 << 3) | (b5 >> 2); d[o + 3] = 255;
    }
  }
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  tmp.getContext("2d").putImageData(img, 0, 0);
  const s = Math.min(canvas.width / w, canvas.height / h) * margin;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, w, h, (canvas.width - w * s) / 2, (canvas.height - h * s) / 2, w * s, h * s);
}
