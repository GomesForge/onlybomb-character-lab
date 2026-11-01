// Builds 3D avatars off the main thread (avatar3d.js). Parts come from the server: /avatar/<kind>/<n>.bin.
import { buildSets } from "./avatar3d.js";

const parts = new Map();
let pass = "";                       // the page's pass (X-Pass): a hidden shop item's part goes to its owner (hidden.py)
function load(kind, n) {
  const key = kind + ":" + n;
  if (!parts.has(key)) {
    const headers = pass ? { "X-Pass": pass } : {};
    parts.set(key, fetch(new URL(`../../avatar/${kind}/${n}.bin`, import.meta.url), { headers }).then((r) => {
      if (!r.ok) throw new Error(`avatar part ${kind}/${n} is missing`);
      return r.arrayBuffer();
    }).then((b) => new Uint8Array(b)));
  }
  return parts.get(key);
}

let masks = {};
onmessage = async ({ data }) => {
  if (data.masks) { masks = data.masks; return; }
  const { id, outfit, slots } = data;
  pass = data.pass || "";
  try {
    const sets = await buildSets(outfit, load, { masks, slots });
    const transfer = [];
    for (const set of sets) if (set) for (const f of set) transfer.push(f.quads.buffer, f.pixels.buffer);
    postMessage({ id, sets }, transfer);
  } catch (e) {
    parts.forEach((p, k) => p.catch(() => parts.delete(k)));
    postMessage({ id, error: String(e.message || e) });
  }
};
