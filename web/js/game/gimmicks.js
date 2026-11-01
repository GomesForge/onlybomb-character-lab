// Map gimmicks (docs/client/J_gimmicks.md): warps, conveyor belts + border pads + direction switch, drift
// sand, arrows (fixed / rotating), tunnels and Soccer goals, cracking ice, speed panels, and the Hyper Bomb
// goal zone with its four drills. Created from Data/map/map.spr every round.

import { A } from "./assets.js";
import { Writer } from "../net/codec.js";
import { W, H, mapObjects } from "./mapdata.js";

const T = Math.trunc;
const TX = (c) => 40 + 40 * c, TY = (r) => 28 + 38 * r;

// belt type -> [sprite name, push dir (-1 = curve), reversed frame]
const BELT_SPRITE = ["cb_n", "cb_w", "cb_n", "cb_w", "cb_se", "cb_se", "cb_ne", "cb_ne", "cb_en", "cb_en", "cb_es",
  "cb_es", "cb_ss", "cb_ss", "cb_we", "cb_we", "cb_ns", "cb_ns", "cb_ee", "cb_ee"];
const BELT_REVERSED = (t) => t === 0 || t === 3 || (t >= 5 && t % 2 === 1);
const TUNNEL_BOUNCE = [0, -8, -14, -18, -20, -20, -18, -14, -8, 0, -2, -3, -2, 0];

export class Gimmicks {
  constructor(world) {
    this.world = world;
    this.fastBelts = false;       // app+0x2c2: toggled by 0x96, never reset (client quirk)
    this.panelLatch = false;      // gamenet+0x2835: reset only by 0x9d
    this.reset();
  }

  reset() {
    this.warps = []; this.belts = []; this.sand = []; this.arrows = []; this.tunnels = [];
    this.ice = []; this.panels = []; this.switches = []; this.pads = [];
    this.zone = null; this.drills = [];         // Hyper Bomb (DAT_005190d0 / DAT_005190cc)
    this.countTiles = [];                       // Panel Attack Factory (DAT_005190d4)
    this.overlay = new Uint8Array(W * H);
    this.beltAt_ = new Int8Array(W * H).fill(-1);
    this.beltT = 0; this.beltFrame = 0; this.sandT = 0;
  }

  // ------------------------------------------------------------------ creation (FUN_0041b200)
  load(mapSet) {
    this.reset();
    this.mapSet = mapSet;
    const w = this.world;
    for (const o of mapObjects(mapSet)) {
      const p8 = o.param & 0xff;
      switch (o.type) {
        case 0: case 1:
          if (this.warps.length < 20) this.warps.push({ x: o.x, y: o.y, dest: o.type === 0 ? p8 : 0xff, frame: 0, t: 0 });
          break;
        case 2: this.addSand(o.x, o.y, p8, false); break;
        case 3: this.addBelt(o.x, o.y, o.param); break;
        case 4: if (this.switches.length < 2) this.switches.push({ x: o.x, y: o.y, state: 0, latch: false }); break;
        case 6: case 7:
          if (this.arrows.length < 40) this.arrows.push({ x: o.x, y: o.y, dir: p8 & 3, rotating: o.type === 7 });
          break;
        case 8: case 14: {
          if (this.tunnels.length >= 20) break;
          const kind = o.type === 14 ? 3 : [7, 16, 25].includes(mapSet) ? 2 : 1;
          this.tunnels.push({ x: o.x, y: o.y, kind, bouncing: false, step: 0, t: 0 });
          if (kind !== 3) {
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const x = o.x + dx, y = o.y + dy;
              if (x >= 0 && x < W && y >= 0 && y < H) this.overlay[y * W + x] = 1;
            }
          }
          break;
        }
        case 9: if (this.ice.length < 20) this.ice.push({ x: o.x, y: o.y, state: 0, latch: false }); break;
        case 12: if (this.panels.length < 10) this.panels.push({ x: o.x, y: o.y, frame: 0, latch: false }); break;
        case 16:                                   // FUN_004102e0: count tile, at most 5
          if (this.countTiles.length < 5) this.countTiles.push({ x: o.x, y: o.y, state: 0, owner: -1 });
          break;
        case 17:                                   // FUN_00411260: goal at (x+1, y+1), drills on the corners
          if (this.zone) break;
          this.zone = { x: o.x + 1, y: o.y + 1, frame: 0, t: 0 };
          for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2]]) this.drills.push({ x: o.x + dx, y: o.y + dy, frame: 0, t: 0 });
          break;
        case 15:                                   // drift sand over the whole floor
          for (let y = 1; y <= 13; y++) for (let x = 1; x <= 15; x++) {
            const t = w.tile(x, y);
            if (t !== 4 && t !== 5) this.addSand(x, y, p8, true);
          }
          break;
      }
    }
  }

  addBelt(x, y, type) {
    if (this.belts.length >= 100 || type < 0 || type > 19) return;
    this.belts.push({ x, y, type });
    if (x >= 0 && x < W && y >= 0 && y < H) this.beltAt_[y * W + x] = this.belts.length - 1;
    const target = { 12: [x, 0], 14: [16, y], 15: [16, y], 17: [x, 14], 18: [0, y], 19: [0, y] }[type];
    if (target && this.pads.length < 20) this.pads.push({ x, y, tx: target[0], ty: target[1] });
  }

  addSand(x, y, dir, fill) {
    if (this.sand.length >= 200) return;
    const s = { x, y, dir, fill, frame: 0 };
    s.sprite = this.sandSprite(s);
    this.sand.push(s);
  }

  sandSprite(o) {                                  // FUN_0040ad80
    if (o.dir === 1 || o.dir === 3) return o.fill ? ((o.y & 1) ? "ds_tr2" : "ds_tr1") : "ds_r";
    return o.fill ? ((o.x & 1) ? "ds_tl2" : "ds_tl1") : "ds_l";
  }

  // ------------------------------------------------------------------ queries
  beltAt(x, y) {
    if (x < 0 || x >= W || y < 0 || y >= H) return -1;
    const k = this.beltAt_[y * W + x];
    return k < 0 ? -1 : this.belts[k].type;
  }
  sandAt(x, y) { const s = this.sand.find((o) => o.x === x && o.y === y); return s ? s.dir : -1; }
  warpIndexAt(x, y) { return this.warps.findIndex((o) => o.x === x && o.y === y); }
  warpDest(x, y) {                                 // FUN_00428d40
    const k = this.warpIndexAt(x, y);
    if (k < 0) return -1;
    if (this.warps[k].dest !== 0xff) return this.warps[k].dest;
    const n = this.warps.length;
    let r = Math.floor(Math.random() * n);
    if (r === k) r = (r + 1) % n;
    return r;
  }
  arrowDirAt(x, y) { const a = this.arrows.find((o) => o.x === x && o.y === y); return a ? a.dir : -1; }
  tunnelAt(x, y) { return this.tunnels.find((o) => o.x === x && o.y === y) || null; }
  goalAt(x, y) { return this.tunnels.some((o) => o.kind === 3 && o.x === x && o.y === y); }
  overlayAt(x, y) { return x >= 0 && x < W && y >= 0 && y < H && this.overlay[y * W + x] !== 0; }
  padAt(x, y) { return this.pads.findIndex((o) => o.x === x && o.y === y); }
  // flames / blocks of a cell are visible unless an igloo or toy tunnel covers it (FUN_0040c950)
  cellVisible(x, y) { return !this.overlayAt(x, y) || !!this.tunnelAt(x, y - 1); }

  // ------------------------------------------------------------------ clocks (FUN_00420f20 part)
  update(dt) {
    this.beltT += dt;
    const period = this.fastBelts ? 30 : 60;
    if (this.beltT >= period) {
      this.beltT -= period;
      const n = A.cb_w ? A.cb_w.n : 4;
      if (++this.beltFrame >= n) this.beltFrame = 0;
    }
    if (this.sand.length) {
      this.sandT += dt;
      if (this.sandT >= 200) {
        this.sandT -= 200;
        for (const s of this.sand) {
          const n = A[s.sprite] ? A[s.sprite].n : 4;
          if (s.dir === 0 || s.dir === 1) { if (--s.frame < 0) s.frame = n - 1; }
          else if (++s.frame >= n) s.frame = 0;
        }
      }
    }
    const warpFrames = this.warpSprite() ? this.warpSprite().n : this.panelWarp() ? this.panelWarp().n : 5;
    for (const wp of this.warps) {
      wp.t += dt;
      if (wp.t >= 100) { wp.t -= 100; if (++wp.frame >= warpFrames) wp.frame = 0; }
    }
    for (const t of this.tunnels) {
      if (!t.bouncing) continue;
      t.t += dt;
      if (t.t >= 40) {
        t.t -= 40; t.step++;
        if (t.t >= 40) { t.t -= 40; t.step++; }
        if (t.step > 13) { t.bouncing = false; t.step = 0; t.t = 0; }
      }
    }
  }

  tunnelFlash(x, y) {
    const t = this.tunnelAt(x, y);
    if (t) { t.bouncing = true; t.step = 0; }
  }

  // ------------------------------------------------------------------ players (J_gimmicks §4.2.4, §4.3, §6)
  speedMod(p, v) {
    const t = this.beltAt(p.tx, p.ty);
    if (t >= 0) {
      const b = this.fastBelts ? 2.0 : 1.0, d = p.dir;
      switch (t) {
        case 0: case 12: case 16: v = d === 0 ? v + b : d === 2 ? v - b : v; break;
        case 1: case 15: case 19: v = d === 1 ? v + b : d === 3 ? v - b : v; break;
        case 2: case 13: case 17: v = d === 2 ? v + b : d === 0 ? v - b : v; break;
        case 3: case 14: case 18: v = d === 3 ? v + b : d === 1 ? v - b : v; break;
        case 4: case 10: v = (d === 0 || d === 3) ? v + b : v - b; break;
        case 5: case 11: v = (d === 0 || d === 3) ? v - b : v + b; break;
        case 6: case 8: v = (d === 0 || d === 1) ? v - b : v + b; break;
        case 7: case 9: v = (d === 0 || d === 1) ? v + b : v - b; break;
      }
    }
    const s = this.sandAt(p.tx, p.ty);
    if (s >= 0) { if (p.dir === s) v += 1.0; else if (p.dir === (s + 2) % 4) v -= 1.0; }
    return v;
  }

  standPush(p, dt) {                               // FUN_0042b5f0 then FUN_0042b950 (state 1 only)
    const t = this.beltAt(p.tx, p.ty);
    if (t >= 0) {
      let left = dt * (this.fastBelts ? 2.0 : 1.0) * 0.05;
      while (left > 0) {
        const s = Math.min(left, 4.0);
        const sx = (p.cx - 40) % 40, sy = (p.cy - 28) % 38;
        let dir = -1;
        switch (t) {
          case 0: case 12: case 16: dir = 0; break;
          case 1: case 15: case 19: dir = 1; break;
          case 2: case 13: case 17: dir = 2; break;
          case 3: case 14: case 18: dir = 3; break;
          case 4: dir = sy < 19 ? 0 : 3; break;   case 5: dir = sx > 19 ? 1 : 2; break;
          case 6: dir = sy < 19 ? 3 : 2; break;   case 7: dir = sx < 20 ? 0 : 1; break;
          case 8: dir = sx > 19 ? 2 : 3; break;   case 9: dir = sy > 18 ? 1 : 0; break;
          case 10: dir = sx < 20 ? 3 : 0; break;  case 11: dir = sy > 18 ? 2 : 1; break;
        }
        if (dir >= 0) p.step(dir, s);
        left -= s;
      }
    }
    const sd = this.sandAt(p.tx, p.ty);
    if (sd >= 0) {
      for (let left = dt * 0.05; left > 0;) { const s = Math.min(left, 4.0); p.step(sd, s); left -= s; }
    }
  }

  // Tile triggers of the local player on walking ticks (FUN_0041db30): leaving a switch / panel / ice.
  tileTriggers(p) {
    const w = this.world;
    for (const o of this.switches) {
      if (p.tx === o.x && p.ty === o.y) o.latch = true;
      else if (o.latch) { o.latch = false; w.send(new Writer(4).u8(0x97).zeros(3).done()); }
    }
    for (const o of this.panels) {
      if (p.tx === o.x && p.ty === o.y) o.latch = true;
      else if (o.latch && !this.panelLatch) {
        this.panelLatch = true;
        w.send(new Writer(6).u8(0x9c).i16(p.id).u8(o.x).u8(o.y).u8(0xff).done());
      }
    }
    for (const o of this.ice) {
      if (p.tx === o.x && p.ty === o.y) { o.latch = true; continue; }
      if (!o.latch) continue;
      o.latch = false;
      if (o.state !== 2 && !w.players.some((q) => q.active && q.tx === o.x && q.ty === o.y)) {
        w.send(new Writer(4).u8(0x9a).u8(o.x).u8(o.y).u8(0xff).done());
      }
    }
  }

  // ------------------------------------------------------------------ server events
  event(op, pkt) {
    switch (op) {
      case 0x86:                                   // rotate the rotating arrows
        for (const a of this.arrows) if (a.rotating) a.dir = pkt[1] === 0 ? (a.dir + 1) & 3 : (a.dir + 3) & 3;
        return true;
      case 0x96: this.fastBelts = !this.fastBelts; return true;
      case 0x97:                                   // reverse every belt, flip the direction switches
        for (const s of this.switches) s.state = 1 - s.state;
        for (const b of this.belts) b.type = b.type >= 4 ? b.type ^ 1 : [2, 3, 0, 1][b.type];
        return true;
      case 0x99:
        for (const s of this.sand) { s.dir = pkt[1]; s.sprite = this.sandSprite(s); }
        return true;
      case 0x9b: {
        const o = this.ice.find((q) => q.x === pkt[1] && q.y === pkt[2]);
        if (o) {
          if (pkt[3] === 0) o.state = 1;
          else if (pkt[3] === 1) { o.state = 2; this.world.setTile(o.x, o.y, 8); }
        }
        return true;
      }
      case 0x9d: {                                 // speed panel answer (FUN_00436080)
        const id = new DataView(pkt.buffer, pkt.byteOffset).getInt16(1, true);
        const e = pkt[5];
        const p = this.world.player(id);
        if (p) {
          p.speedBase = e;
          if (!(p.disease & 1) && !(p.disease & 2)) p.speedLvl = e;
          this.panelLatch = false;
        }
        const o = this.panels.find((q) => q.x === pkt[3] && q.y === pkt[4]);
        if (o) { o.latch = false; o.frame = e - 1; }
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ drawing
  warpSprite() {                                   // HighTech's own warps (FUN_0045ea40), 80x80
    const h = this.world.hyper;
    return h && h.theme && h.theme.warp ? h.theme.warp : null;
  }

  panelWarp() { return this.world.panel ? this.world.panel.warpSprite() : null; }   // PanelPaint WarpTile.spr

  drawFloor(fb) {                                  // step 2 of the draw order, all opaque at (TX, TY)
    for (const s of this.sand) fb.opaque(A[s.sprite], s.frame, TX(s.x), TY(s.y));
    for (const o of this.ice) if (o.state) fb.opaque(A.crackice, o.state - 1, TX(o.x), TY(o.y));
    for (const b of this.belts) {
      const f = BELT_REVERSED(b.type) ? 3 - this.beltFrame : this.beltFrame;
      fb.opaque(A[BELT_SPRITE[b.type]], f, TX(b.x), TY(b.y));
    }
    const ws = this.warpSprite();
    for (const wp of this.warps) {
      if (ws) fb.opaque(ws, wp.frame, TX(wp.x) - 20, TY(wp.y) - 40);
      else fb.opaque(this.panelWarp() || A.warp, wp.frame, TX(wp.x), TY(wp.y));
    }
    for (const a of this.arrows) fb.opaque(a.rotating ? A.arrow_change : A.arrow, a.dir, TX(a.x), TY(a.y));
    if (this.zone && this.world.hyper) this.world.hyper.drawZone(fb);
    for (const s of this.switches) fb.opaque(A.dirswitch, s.state, TX(s.x), TY(s.y));
    for (const o of this.panels) fb.opaque(A.speedswitch, o.frame, TX(o.x), TY(o.y));
  }

  drawTunnelShadow(fb, t) {                        // FUN_0042ea10
    if (t.kind === 3) return;
    fb.half(A.tunnel, t.kind === 1 ? 1 : 4, TX(t.x) - 80, TY(t.y) - 76);
  }

  drawTunnel(fb, t) {                              // FUN_0042e6e0
    if (t.kind === 3) return;
    const x = TX(t.x) - 80, y = TY(t.y) - 76;
    fb.opaque(A.tunnel, t.kind === 1 ? 0 : 3, x, y);
    fb.opaque(A.tunnel, t.kind === 1 ? 2 : 5, x, y + (t.bouncing ? TUNNEL_BOUNCE[t.step] || 0 : 0));
  }
}
