// A training bot's head (training.js): it plays with the keys a player presses (player.js localUpdate reads them with
// held() and take(), as it reads input.js's keyboard), so it walks, collides and kicks as a player does. Each step it
// looks at the field as this page has it (world.js) and at the bombs' fuses (the training's own clock), then: runs from
// where fire will be, picks up the power-ups near it, lays a bomb by a soft block or a rival when it can still get
// away, and goes for the blocks and the rivals.

import { KEYS, BASE_SPEED } from "./player.js";
import { DIRS, T_FLOOR, T_ITEM, T_SOFT, T_HARD, T_BORDER, T_BURNING, T_ITEM_BURNING, K_FLAME, K_CENTRE } from "./objects.js";
import { W, H } from "./mapdata.js";
import { SC_PLAY } from "./scenes.js";

const DIR_KEYS = [KEYS.down, KEYS.left, KEYS.up, KEYS.right];
const REVERSED = [2, 3, 0, 1];          // the skull's reversed controls (disease bit 2): player.js readDirection
const SKULL = 5;
const FLAME_MS = 650;                    // a blast's flames, and a little more: stay out of them this long
const EARLY_MS = 150;                    // ... and from this long before they come
const SEARCH = 14;                       // tiles a plan looks ahead
const THINK_MS = [150, 350];             // a new plan this often (a random time between), sooner when the old one fails
const BOMB_CHANCE = 0.6;                 // by a block or a rival, how often it lays a bomb (when it can get away)
const CHASE = 3;                         // it goes this near a rival

export class Brain {
  constructor(player, training) {
    this.p = player;
    this.training = training;
    this.keys = new Set();               // held this step
    this.pressed = new Set();            // pressed once (take)
    this.path = [];                      // tiles to walk, next first
    this.nextPlan = 0;
    this.clock = 0;
  }

  // the input.js interface player.js reads
  held(k) { return this.keys.has(k); }
  take(k) { const on = this.pressed.has(k); this.pressed.delete(k); return on; }

  think(dt) {
    const p = this.p, w = p.world, m = w.match;
    this.clock += dt;
    this.keys.clear();
    if (!p.active || p.out || p.state >= 5 || m.phase !== 0 || m.scene !== SC_PLAY) { this.path = []; return; }
    const danger = this.dangerMap();
    const here = p.ty * W + p.tx;
    if (this.clock >= this.nextPlan || !this.pathOk(danger)) this.plan(danger, here);
    this.walk(here);
  }

  // ------------------------------------------------------------------ what the field holds
  tileMs() { return 40 / (BASE_SPEED[this.p.speedLvl] * 0.05); }

  walkable(i) {
    const t = this.p.world.grid[i];
    return t === T_FLOOR || t === T_ITEM;
  }

  // Ms until fire reaches each tile (Infinity: none coming; 0: in flames now): every bomb's blast, at its fuse's end
  // or as soon as another blast reaches it (a chain), and the flames burning now. `extra`: one more bomb, as if laid.
  dangerMap(extra = null) {
    const w = this.p.world, d = new Float64Array(W * H).fill(Infinity);
    const bombs = [];
    for (const b of w.bombs) {
      if (!b.alive || b.state === 2 || b.state === 3) continue;          // in the air, or going off now
      bombs.push({ x: b.x, y: b.y, power: b.power, pierce: b.kind === 1, t: this.training.fuseLeft(b.id) });
    }
    if (extra) bombs.push(extra);
    const at = new Map(bombs.map((b) => [b.y * W + b.x, b]));
    const blasts = bombs.map((b) => this.blast(b, at));
    for (let changed = true, n = 0; changed && n < bombs.length; n++) {   // chains: the earliest blast that reaches it
      changed = false;
      bombs.forEach((b, k) => {
        for (const i of blasts[k]) {
          const o = at.get(i);
          if (o && o !== b && b.t < o.t) { o.t = b.t; changed = true; }
        }
      });
    }
    bombs.forEach((b, k) => { for (const i of blasts[k]) d[i] = Math.min(d[i], b.t); });
    for (const e of w.explosions) {
      if (!e.deadly) continue;
      for (let i = 0; i < W * H; i++) if (e.kind[i] >= K_FLAME && e.kind[i] <= K_CENTRE) d[i] = 0;
    }
    return d;
  }

  blast(b, at) {                         // the tiles a bomb's fire covers (world.js traceFlames, without the chains)
    const g = this.p.world.grid, out = [b.y * W + b.x];
    for (const [dx, dy] of DIRS) {
      for (let s = 1; s <= b.power; s++) {
        const x = b.x + dx * s, y = b.y + dy * s;
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        const i = y * W + x, t = g[i];
        if (t === T_HARD || t === T_BORDER) break;
        out.push(i);
        if (at.has(i)) break;
        if (t === T_SOFT || t === T_BURNING || t === T_ITEM_BURNING || t === T_ITEM) { if (!b.pierce) break; }
      }
    }
    return out;
  }

  // Can it be on tile i during [t - one tile, t + one tile] without meeting the flames?
  safeAt(danger, i, t) {
    const d = danger[i], ms = this.tileMs();
    if (d === 0) return false;
    if (d === Infinity) return true;
    return t + ms < d - EARLY_MS || t - ms > d + FLAME_MS;
  }

  // Breadth first from `start` to the nearest tile `goal` takes, walking only where it may be when it gets there: the
  // tiles to walk (start not in it), or null. Same-length ways are tried in a random order, so it does not always
  // take the same one.
  search(danger, start, goal, depth = SEARCH) {
    const ms = this.tileMs(), prev = new Int32Array(W * H).fill(-2), dist = new Int32Array(W * H);
    prev[start] = -1;
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      if (i !== start && goal(i, dist[i] * ms)) {
        const path = [];
        for (let j = i; j !== start; j = prev[j]) path.unshift(j);
        return path;
      }
      if (dist[i] >= depth) continue;
      const x = i % W, y = (i / W) | 0;
      for (const k of shuffled4()) {
        const [dx, dy] = DIRS[k], nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (prev[j] !== -2 || !this.walkable(j) || !this.safeAt(danger, j, (dist[i] + 1) * ms)) continue;
        prev[j] = i;
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
    return null;
  }

  rivals() {
    const p = this.p;
    return p.world.players.filter((o) => o !== p && o.active && !o.out && o.state < 5);
  }

  // ------------------------------------------------------------------ deciding
  plan(danger, here) {
    const p = this.p, w = p.world;
    this.nextPlan = this.clock + THINK_MS[0] + Math.random() * (THINK_MS[1] - THINK_MS[0]);
    const safe = (i) => danger[i] === Infinity;
    if (!safe(here)) {                   // fire is coming here: the nearest tile it does not reach, else the latest one
      this.path = this.search(danger, here, safe) || this.latest(danger, here);
      return;
    }
    if (this.wantsBomb(here) && Math.random() < BOMB_CHANCE) {
      const escape = this.escapeAfterBomb(here);
      if (escape) { this.pressed.add(KEYS.bomb); this.path = escape; return; }
    }
    const items = (i) => safe(i) && w.grid[i] === T_ITEM && (w.items.get(i) || {}).type !== SKULL;
    const rivals = this.rivals();
    const nearRival = (i) => safe(i) && rivals.some((o) => Math.abs(o.tx - i % W) + Math.abs(o.ty - ((i / W) | 0)) <= CHASE);
    const byBlock = (i) => safe(i) && this.nextToBlock(i);
    this.path = this.search(danger, here, items, 6)
      || (Math.random() < 0.5 ? this.search(danger, here, nearRival) || this.search(danger, here, byBlock)
        : this.search(danger, here, byBlock) || this.search(danger, here, nearRival))
      || this.search(danger, here, (i) => safe(i) && Math.random() < 0.2, 4)
      || [];
  }

  latest(danger, here) {                 // no tile out of reach of the fire: the one it reaches last
    let best = null, bestT = danger[here];
    this.search(danger, here, (i) => { if (danger[i] > bestT) { bestT = danger[i]; best = i; } return false; });
    return best === null ? [] : this.search(danger, here, (i) => i === best) || [];
  }

  nextToBlock(i) {
    const g = this.p.world.grid, x = i % W, y = (i / W) | 0;
    return DIRS.some(([dx, dy]) => g[(y + dy) * W + x + dx] === T_SOFT);
  }

  wantsBomb(here) {                      // a soft block next to it, or a rival its fire would reach
    const p = this.p, w = p.world;
    if (p.placed > p.bombs || w.grid[here] !== T_FLOOR || w.markers.length || (p.disease & 0x40)) return false;
    if (this.nextToBlock(here)) return true;
    const at = new Map();
    for (const b of w.bombs) if (b.alive) at.set(b.y * W + b.x, b);
    const reach = new Set(this.blast({ x: p.tx, y: p.ty, power: p.fire, pierce: p.bombKind === 1 }, at));
    return this.rivals().some((o) => reach.has(o.ty * W + o.tx));
  }

  // The way out if it lays a bomb here now, or null: to a tile no fire reaches, before its own bomb goes off
  escapeAfterBomb(here) {
    const p = this.p;
    const fuse = (p.disease & 0x80) ? 1000 : (p.disease & 0x100) ? 6000 : this.training.fuseMs;
    const after = this.dangerMap({ x: p.tx, y: p.ty, power: p.fire, pierce: p.bombKind === 1, t: fuse });
    return this.search(after, here, (i) => after[i] === Infinity);
  }

  pathOk(danger) {
    const ms = this.tileMs();
    return this.path.every((i, k) => this.walkable(i) && this.safeAt(danger, i, k * ms));
  }

  // ------------------------------------------------------------------ walking
  // Towards the next tile of the path, a tile at a time: on it, to its middle (so the turn after it fits the
  // corridor); there, the next one.
  walk(here) {
    const p = this.p;
    while (this.path.length) {
      const i = this.path[0], x = i % W, y = (i / W) | 0;
      const cx = 40 * x + 60, cy = 38 * y + 49, tol = Math.max(3, BASE_SPEED[p.speedLvl] / 2 + 0.5);
      if (here === i && Math.abs(p.cx - cx) <= tol && Math.abs(p.cy - cy) <= tol) { this.path.shift(); continue; }
      let d;
      if (x !== p.tx) d = x > p.tx ? 3 : 1;
      else if (y !== p.ty) d = y > p.ty ? 0 : 2;
      else if (Math.abs(p.cx - cx) > tol) d = p.cx < cx ? 3 : 1;
      else d = p.cy < cy ? 0 : 2;
      if (p.disease & 4) d = REVERSED[d];
      this.keys.add(DIR_KEYS[d]);
      return;
    }
  }
}

function shuffled4() {
  const a = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
