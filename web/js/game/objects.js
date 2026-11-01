// Object layer of the match: blocks, bombs (idle / kicked / thrown / sky), pending bomb markers,
// explosions and flames, items, pressure blocks. Faithful to docs/client/H_objects.md (function
// names in comments are the original client's).

import { W, H } from "./mapdata.js";
import { sfx, sfxRemote } from "./sound.js";

// Client tile codes (H_objects §1)
export const T_FLOOR = 0, T_ITEM = 1, T_BOMB = 2, T_SOFT = 3, T_HARD = 4, T_BORDER = 5, T_BURNING = 6,
  T_KEEP = 8, T_ITEM_BURNING = 9;

export const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];     // 0 down, 1 left, 2 up, 3 right
export const REVERSE = [2, 3, 0, 1];

// Sprite origin of a map object on tile (x, y) (FUN_00406b50): px = 40x+20, py = 38y-7
export const originX = (x) => 40 * x + 20;
export const originY = (y) => 38 * y - 7;
export const tileOfX = (px) => Math.trunc(Math.trunc(px) / 40);
export const tileOfY = (py) => Math.trunc((Math.trunc(py) + 28) / 38);

// The common timer pattern (H_objects §0.2): returns the number of steps to take (0, 1 or 2).
export function ticks(o, key, dt, period) {
  o[key] += dt;
  if (o[key] < period) return 0;
  o[key] -= period;
  if (o[key] >= period) { o[key] -= period; return 2; }
  return 1;
}

// ------------------------------------------------------------------ blocks
export class Block {
  constructor(x, y, type, vHard = 0) {
    this.x = x; this.y = y;
    this.type = type;          // 0 soft (pp.spr), 1 hard (non.spr)
    this.vSoft = 0;
    this.vHard = vHard;
    this.pressure = false;
    this.falling = false;
    this.fallH = 0;
    this.alive = true;
  }
}

// ------------------------------------------------------------------ bombs
export class Bomb {
  constructor(world, id, owner, x, y, power, kind) {
    this.world = world;
    this.id = id;
    this.owner = owner;
    this.x = x; this.y = y;
    this.px = originX(x); this.py = originY(y);
    this.power = Math.min(15, power);
    this.kind = kind;
    this.state = 4;            // 4 appear, 0 idle, 1 sliding, 2 flying, 3 exploding
    this.frame = 0;
    this.t = 0;
    this.hold = 0; this.down = 0;
    this.kicker = -1; this.thrower = -1;
    this.kick = 0;             // 1 requested, 2 sliding
    this.slideT = 0;           // +0x9f
    this.dir = 4;
    this.throwing = 0;         // +0x66: 1 requested, 2 flying
    this.early = false;        // our own glove throw, flying before its 0x77 (world.throwBomb)
    this.punch = false;
    this.flySub = 0;           // +0x71
    this.height = 0;
    this.bouncing = false;
    this.bounceNext = false;   // +0x99
    this.onBorder = false;
    this.misobon = false;      // +0x5b: thrown from a revenge cart; its flames credit kills to the owner
    this.hit = false;
    this.chainDone = false;
    this.skyH = 0;
    this.countFrame = 0; this.countT = 0;   // Panel Attack: bomb.gra 3-2-1 frame (+0x36c) and its clock (+0x390)
    this.alive = true;
  }

  // appear (FUN_00407ce0) and idle pulse (FUN_00407db0)
  animate(dt) {
    if (this.state === 4) {
      if (this.kind === 3) return this.skyFall(dt);
      const n = ticks(this, "t", dt, 50);
      if (n) {
        this.frame += n;
        if (this.frame >= 6) { this.state = 0; this.frame = 0; this.t = 0; }
      }
      return;
    }
    if (this.state === 3) return;
    if (this.world.mode === 1) {           // FUN_00407db0, mode 1: one countdown frame per 150 ms, held on the last
      this.countT += dt;
      if (this.countT >= 150) { this.countT -= 150; this.countFrame = Math.min(this.countFrame + 1, 18); }
    }
    const n = ticks(this, "t", dt, 100);
    if (!n) return;
    if (n === 2) this.frame += this.down ? -1 : 1;
    if (!this.down) {
      if (this.frame === 0) { if (!this.hold) this.hold = 1; else { this.hold = 0; this.frame = 1; } } else this.frame++;
      if (this.frame >= 4) { this.down = 1; this.frame = 3; }
    } else {
      if (this.frame === 3 && !this.hold) this.hold = 1;
      else { if (this.frame === 3) this.hold = 0; this.frame--; }
      if (this.frame <= 0) { this.down = 0; this.frame = 0; }
    }
  }

  // Sky bomb (0x98): every 40 ms height -= 10; then 3 squash frames at 40 ms (H_objects §7.5).
  skyFall(dt) {
    const n = ticks(this, "t", dt, 40);
    for (let i = 0; i < n; i++) {
      if (this.skyH >= 10) this.skyH -= 10;
      else if (++this.frame > 2) {
        this.state = 0; this.frame = 0; this.skyH = 0;
        this.world.skyBombLanded(this);
        return;
      }
    }
  }

  setTileFromPos() {
    this.x = tileOfX(this.px);
    this.y = tileOfY(this.py);
  }

  snap(x = this.x, y = this.y) {
    this.x = x; this.y = y;
    this.px = originX(x); this.py = originY(y);
  }

  pastCentre(dir) {
    const cx = Math.trunc(this.px) + 40, cy = Math.trunc(this.py) + 56;
    switch (dir) {
      case 3: return ((cx - 40) % 40) >= 20;
      case 1: return ((cx - 40) % 40) <= 20;
      case 0: return ((cy - 28) % 38) >= 19;
      case 2: return ((cy - 28) % 38) <= 19;
    }
    return true;
  }

  // Kicked slide (FUN_00408030 / FUN_00408100): 0.4 px/ms in sub-steps of at most 4 px.
  slide(dt) {                                       // FUN_00408100 with arrows, tunnels and pads
    const w = this.world, g = w.gimmicks;
    this.slideT += dt;
    let dist = dt * 8.0 * 0.05;
    while (dist > 0 && this.state === 1) {
      const step = Math.min(4, dist);
      dist -= step;
      const [dx, dy] = DIRS[this.dir];
      this.px += dx * step; this.py += dy * step;
      this.setTileFromPos();
      const nx = this.x + dx, ny = this.y + dy;
      const arrow = g.arrowDirAt(this.x, this.y);
      if (arrow < 0) this.arrowLatch = false;
      else if (this.pastCentre(this.dir) && !this.arrowLatch) {
        this.dir = arrow;
        this.snap();
        const [ax, ay] = DIRS[arrow];
        const t2 = w.tile(this.x + ax, this.y + ay);
        if (t2 !== T_FLOOR && t2 !== T_ITEM) { this.stopSlide(); return; }
        this.arrowLatch = true;
        continue;
      }
      if (!g.tunnelAt(this.x, this.y)) this.inTunnel = false;
      else if (this.pastCentre(this.dir) && !this.inTunnel) { this.snap(); this.stopSlide(); return; }
      const nt = w.tile(nx, ny);
      const limit = this.slideT > w.slideLimit(this);
      if (nt === T_FLOOR && !w.playerIn(nx, ny) && !limit && g.padAt(nx, ny) < 0) continue;
      if (nt === T_ITEM) {
        const it = w.itemAt(nx, ny);
        if (it && it.type !== 13) { w.itemDestroyedByBomb(nx, ny); continue; }
        this.snap(); this.stopSlide(); return;
      }
      if (arrow >= 0) continue;
      if (!this.pastCentre(this.dir)) continue;
      this.snap();
      if (this.kind === 2 && !limit) { this.dir = REVERSE[this.dir]; continue; }
      this.stopSlide();
      return;
    }
  }

  stopSlide() {
    this.kick = 0;
    this.state = 0;
    this.world.slideStopped(this);
  }

  // Thrown / punched flight (FUN_004086d0 / FUN_004087f0).
  fly(dt) {
    if (this.flySub !== 0) return;
    const w = this.world;
    let dist = dt * 8.0 * 0.05 * (this.bouncing ? 0.6 : 1);
    while (dist > 0 && this.flySub === 0) {
      const step = Math.min(4, dist);
      dist -= step;
      const [dx, dy] = DIRS[this.dir];
      this.px += dx * step; this.py += dy * step;
      // wrap around the arena
      if (this.px < originX(0) - 20) this.px += 40 * W; else if (this.px >= originX(W) - 20) this.px -= 40 * W;
      if (this.py < originY(0) - 19) this.py += 38 * H; else if (this.py >= originY(H) - 19) this.py -= 38 * H;
      this.travel += step;
      this.setTileFromPos();
      const tileLen = dy ? 38 : 40;
      if (this.bouncing) this.height = Math.trunc(15 * (1 + Math.sin(Math.PI * this.bounceD / tileLen)));
      else this.height = Math.trunc(35 * Math.sin(Math.PI * Math.min(this.travel, this.flyN * tileLen) / (this.flyN * tileLen)) + 15);
      this.bounceD += step;
      // arrived at (past the centre of) the destination tile?
      const destX = ((this.destX % W) + W) % W, destY = ((this.destY % H) + H) % H;
      if (this.x !== destX || this.y !== destY || !this.pastCentre(this.dir)) continue;
      const t = w.tile(destX, destY);
      if (t < 2 && !w.overlayAt(destX, destY) && w.gimmicks.padAt(destX, destY) < 0) {
        if (t === T_ITEM) {
          const it = w.itemAt(destX, destY);
          if (it && it.type === 13) { this.bounceOn(); continue; }
          w.itemDestroyedByBomb(destX, destY);
        }
        if (this.bounceNext) { this.bounceNext = false; this.bounceOn(); continue; }
        this.snap(destX, destY);
        this.height = 0;
        this.flySub = 2;
        w.flightLanded(this);
        return;
      }
      this.bounceOn();
    }
  }

  bounceOn() {
    this.bouncing = true;
    this.height = 15;
    this.bounceD = 0;
    const [dx, dy] = DIRS[this.dir];
    this.destX += dx; this.destY += dy;
  }

  startFlight(dir, n) {
    this.state = 2;
    this.frame = 0;
    this.throwing = 2;
    this.dir = dir;
    this.flyN = n;
    this.travel = 0;
    this.bounceD = 0;
    this.height = 50;
    this.bouncing = false;
    this.flySub = 0;
    const [dx, dy] = DIRS[dir];
    this.destX = this.x + dx * n;
    this.destY = this.y + dy * n;
  }
}

// ------------------------------------------------------------------ pending bomb marker (FUN_0040af80)
export class Marker {
  constructor(x, y, kind) {
    this.x = x; this.y = y; this.kind = kind;
    this.px = originX(x); this.py = originY(y);
    this.frame = 0; this.t = 0;
  }
  animate(dt) {
    const n = ticks(this, "t", dt, 50);
    if (n) this.frame = (this.frame + n) % 4;
  }
}

// ------------------------------------------------------------------ explosions (one per 0x69)
export const K_NONE = 0, K_FLAME = 1, K_SOFT = 2, K_ITEM = 3, K_CENTRE = 4, K_BURNING = 6, K_CHAIN = 7;
export const PIECE_NONE = 0x80;

export class Explosion {
  constructor() {
    this.kind = new Uint8Array(W * H);
    this.owner = new Int16Array(W * H).fill(-1);
    this.by = new Int16Array(W * H).fill(-1);       // whose bomb's fire burns here (its bomb skin, bombskins.js)
    this.piece = new Uint8Array(W * H).fill(PIECE_NONE);
    this.frame = 0; this.t = 0; this.hold = 0;
    this.deadly = true;
    this.done = false;
  }

  // FUN_0040c9f0: 50 ms period, frame 0 held for two ticks, harmless from frame 7, done at 10.
  animate(dt) {
    const n = ticks(this, "t", dt, 50);
    if (!n) return;
    if (n === 2) this.frame++;
    if (this.frame === 0) { if (!this.hold) this.hold = 1; else { this.hold = 0; this.frame = 1; } } else this.frame++;
    if (this.frame >= 7) this.deadly = false;
    if (this.frame >= 10) { this.done = true; this.frame = 9; }
  }

  // FUN_0040d020 -> 0x40ce80 (arms) / 0x40cdb0 (final piece)
  computePieces() {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = this.kind[y * W + x];
      if (k === K_CENTRE || k === K_CHAIN) this.arms(x, y);
    }
    for (let i = 0; i < W * H; i++) this.piece[i] = finalPiece(this.piece[i]);
  }

  arms(x, y) {
    const ARM = [1, 2, 4, 8];
    this.piece[y * W + x] = 0x10;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      let last = -1;
      for (let cx = x + dx, cy = y + dy; cx >= 0 && cx < W && cy >= 0 && cy < H; cx += dx, cy += dy) {
        const k = this.kind[cy * W + cx];
        if (k !== K_FLAME && k !== K_ITEM && k !== K_BURNING) break;
        const i = cy * W + cx;
        this.piece[i] = ((this.piece[i] + 0x80) & 0xff) | ARM[d];
        last = i;
      }
      if (last >= 0 && this.piece[last] === ARM[d]) this.piece[last] = 0x20 | ARM[d];
    }
  }
}

function finalPiece(v) {
  if (v === PIECE_NONE) return PIECE_NONE;
  if (v & 0x10) return 0;
  const dn = v & 1, lf = v & 2, up = v & 4, rt = v & 8, end = v & 0x20;
  if (dn && !lf && !up && !rt) return end ? 6 : 2;
  if (!dn && up && !lf && !rt) return end ? 5 : 2;
  if (dn && up && !lf && !rt) return 2;
  if (dn) return 0;
  if (rt && !up && !lf) return end ? 3 : 1;
  if (lf && !up && !rt) return end ? 4 : 1;
  if (lf && rt && !up) return 1;
  return 0;
}

// ------------------------------------------------------------------ items (FUN_00412a30 & co.)
export class Item {
  constructor(x, y, type) {
    this.x = x; this.y = y; this.type = type;
    this.state = 0;            // 0 appearing, 1 idle
    this.wait = true;          // +100: nothing drawn for the first ~200 ms
    this.waitT = 0;
    this.effOn = true;         // createitem.eft running
    this.effFrame = 0; this.effT = 0; this.effHold = 0; this.effSlow = false;
    this.visible = false;      // shadow + icon shown
    this.frame = 0; this.t = 0; this.popHold = 0;
    this.hidden = false;       // picked up locally, waiting for 0x6e
  }

  animate(dt) {
    if (this.wait) {
      this.waitT += dt;
      if (this.waitT > 200) this.wait = false;
      return;
    }
    if (this.effOn) {
      const n = ticks(this, "effT", dt, this.effSlow ? 80 : 20);
      for (let i = 0; i < n; i++) {
        if (!this.effSlow) {
          if (this.effFrame === 0 && !this.effHold) this.effHold = 1;
          else { this.effHold = 0; this.effFrame++; }
          if (this.effFrame > 10) { this.effSlow = true; this.effFrame = 4; }
        } else if (++this.effFrame > 10) { this.effOn = false; break; }
        if (this.effSlow && this.effFrame >= 7) this.visible = true;
      }
    }
    if (!this.visible) return;
    if (this.state === 0) {
      const n = ticks(this, "t", dt, 80);
      for (let i = 0; i < n; i++) {
        if (this.frame === 0 && !this.popHold) this.popHold = 1;
        else { this.popHold = 0; this.frame++; }
        if (this.frame >= 5) { this.state = 1; this.frame = 5; this.t = 0; break; }
      }
    } else {
      const n = ticks(this, "t", dt, 250);
      if (n % 2) this.frame = this.frame === 4 ? 5 : 4;
    }
  }
}

export { sfx, sfxRemote };
