// Hyper Bomb (game mode 2, map sets 37..43): the theme graphics and their animations, the goal (0xab / 0xac)
// with its map-wide boom, the parts orbiting their carrier, and parts thrown across the map (0xaa).
// docs/client/F_render.md §5.5; FUN_0045eb90, FUN_0045f040, FUN_0045f590, FUN_0045f290, FUN_00412c10.

import { loadSprite } from "../assets/spr.js";
import { Runs, EFT_STD } from "./fb565.js";
import { A } from "./assets.js";
import { W, H } from "./mapdata.js";
import { T_FLOOR, T_ITEM, T_SOFT } from "./objects.js";
import { Writer } from "../net/codec.js";
import { sfx } from "./sound.js";

const T = Math.trunc;
export const MODE_HYPER = 2;
export const GOAL_PARTS = 3;
export const PART = 13;                           // item type of a HyperBomb part
export const isHyperMap = (m) => m >= 37 && m <= 43;

const THEME_DIR = { 37: "01_HighTech", 38: "02_Catacomb", 39: "03_Circuit", 40: "04_Military", 41: "06_PirateShip",
  42: "07_SnowLand", 43: "08_Spaceship" };
const EXTRAS = {                                   // FUN_0045ea40
  37: { warp: "Warp01.spr" },
  40: { etc1: "Etc01.spr" },
  42: { etc1: "Etc01.spr", etc2: "Etc02.spr", etc3: "Etc03.spr" },
  43: { gate: "Back_Gate.spr", mon1: "Back_Monitor01.spr", mon2: "Back_Monitor02.spr", rob1: "Back_Robot01.spr",
    rob2: "Back_Robot02.spr" },
};
const NO_TILES = new Set([40, 41, 42]);            // Military, PirateShip, SnowLand paint the floor in Back01
const MILITARY_T1 = [5, 4, 3, 2, 1, 0, 23, 22, 21, 20, 19, 18, 17, 16];
const MILITARY_T2 = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 23, 22, 21];
const FLY_SPEED = 8.0 * 0.6;                       // px per frame, not scaled by dt (FUN_00412c10)

const themes = new Map();
export function loadHyperTheme(mapSet) {
  if (!isHyperMap(mapSet)) return Promise.resolve(null);
  if (!themes.has(mapSet)) {
    const dir = "HyperBomb/" + THEME_DIR[mapSet] + "/";
    const files = { back: "Back01.spr", hard: "Hard01.spr", soft: "Soft01.spr", hard_s: "Hard01_S.spr",
      soft_s: "Soft01_S.spr", drill: "Drill01.spr", drill_s: "Drill01_S.spr", zone: "Zone01.spr", ...EXTRAS[mapSet] };
    if (!NO_TILES.has(mapSet)) files.tile = "Tile01.spr";
    const t = {};
    themes.set(mapSet, Promise.all(Object.entries(files).map(([k, f]) => loadSprite(dir + f)
      .then((s) => { t[k] = Runs.fromSprite(s); }).catch(() => {}))).then(() => t));
  }
  return themes.get(mapSet);
}

// The client's Hyper object (DAT_00514a50): one per match.
export class Hyper {
  constructor(world) {
    this.world = world;
    this.theme = null;
    this.reset();
  }

  async load(mapSet) {
    this.themeSet = mapSet;
    this.theme = await loadHyperTheme(mapSet);
  }

  reset() {                                        // FUN_0045eb90 on every map load
    this.goalSent = false;                         // +0x50a
    this.winner = -1;                              // who reached the goal this round (0xac)
    this.boomOn = false;                           // +0x516
    this.boomFrame = 0;                            // +0x410
    this.boomCells = new Uint8Array(W * H);
    this.clockT = 0;                               // +0x8: the 80 ms step of the orbit and the boom
    this.orbit = this.orbit || 0;                  // +0x418: 0..23
    this.anim = this.anim || 0; this.animDown = false; this.animT = 0;   // +0x518 / +0x517
    this.anim2 = 0;                                // +0x7d8 (Spaceship monitors)
    this.flakes = Array.from({ length: 25 }, () => ({ x: 0, y: 0, amp: 0, t: 0, x0: 0, period: 0, end: 0 }));
    this.flying = [];                              // parts thrown by 0xaa
  }

  // ------------------------------------------------------------------ per tick (FUN_0045f040)
  update(dt) {
    const w = this.world, mapSet = w.mapSet;
    this.clockT += dt;
    if (this.clockT > 80) {
      this.clockT -= 80;
      if (++this.orbit > 23) this.orbit = 0;
      if (this.boomOn && ++this.boomFrame >= (A.boom ? A.boom.n : 10) - 1) this.boomOn = false;
    }
    const g = w.gimmicks;
    for (const o of [g.zone, ...g.drills]) {       // FUN_0045fdd0: one frame per 100 ms
      if (!o) continue;
      o.t += dt;
      if (o.t > 99) {
        o.t -= 100;
        const spr = this.theme && (o === g.zone ? this.theme.zone : this.theme.drill);
        if (++o.frame >= (spr ? spr.n : 1)) o.frame = 0;
      }
    }
    const t = this.theme || {};
    if (mapSet === 40) {                           // FUN_0045faa0: ping-pong 0..13, 500 ms
      this.animT += dt;
      if (this.animT > 500) {
        this.animT = 0;
        this.anim += this.animDown ? -1 : 1;
        if (this.anim < 1 || this.anim > 12) this.animDown = !this.animDown;
      }
    } else if (mapSet === 42) {                    // FUN_0045fb00 + FUN_0045fb50
      this.animT += dt;
      if (this.animT > 200) {
        this.animT = 0;
        if (++this.anim >= (t.etc1 ? t.etc1.n : 1)) this.anim = 0;
      }
      this.snow(dt);
    } else if (mapSet === 43) {                    // FUN_0045fc30: 150 ms
      this.animT += dt;
      if (this.animT > 150) {
        this.animT = 0;
        if (++this.anim2 >= (t.mon1 ? t.mon1.n : 1)) this.anim2 = 0;
        if (!this.animDown) { if (++this.anim >= (t.gate ? t.gate.n : 1)) this.animDown = true; }
        else if (--this.anim < 1) this.animDown = false;
      }
    }
    for (const it of this.flying) { it.animate(dt); this.flyStep(it); }
    this.flying = this.flying.filter((it) => it.flying && !it.gone);
  }

  snow(dt) {                                       // FUN_0045fb50: 25 flakes swaying down
    for (const f of this.flakes) {
      if (f.y === 0) {
        const r = Math.floor(Math.random() * 32768);
        f.x = r % 700; f.x0 = r % 700; f.y = r % 100; f.amp = r % 5 + 1;
        f.period = r % 50 + 20; f.end = r % 200 + 300 + f.y; f.t = 0;
      } else if (f.y < 601 && f.y <= f.end) {
        f.t += dt;
        if (f.t > f.period) {
          f.t -= f.period;
          f.y++;
          f.x = T(Math.sin(f.y * 0.3183099524062959) * f.amp) + f.x0;
        }
      } else Object.assign(f, { x: 0, y: 0, amp: 0, t: 0, x0: 0, period: 0, end: 0 });
    }
  }

  // ------------------------------------------------------------------ the goal
  // FUN_0045f260: the player stands on the zone's centre tile
  onGoal(p) { const z = this.world.gimmicks.zone; return !!z && p.tx === z.x && p.ty === z.y; }
  // FUN_0042b240: a carrier of 3+ parts on the goal is held on the tile centre
  frozen(p) { return this.onGoal(p) && p.parts >= GOAL_PARTS; }
  // The carrier who stepped on the goal with the parts (0xab sent) or won: nothing kills them on this screen any more.
  // The server takes the goal before any death they report after it (one connection, in order) and refuses those,
  // so no screen shows them dying; a refusal (0xac -2) makes them mortal again
  safe(p) { return this.winner === p.id || (this.goalSent && this.frozen(p)); }

  goalCheck(p) {                                   // FUN_0045f4d0, local players every tick
    if (!this.onGoal(p) || p.parts < GOAL_PARTS || this.goalSent || this.boomOn) return;
    this.goalSent = true;
    this.world.send(new Writer(4).u8(0xab).i16(p.id).u8(0).done());
    p.snapTo(p.tx, p.ty);
  }

  onGoalResult(id, team) {                         // 0xac (FUN_0045f480 -> FUN_0045f290 + FUN_0045edf0)
    if (team === -2) { this.goalSent = false; return; }
    this.winner = id;
    const w = this.world, z = w.gimmicks.zone;
    for (const p of w.players) {
      if (!p.active) continue;
      const loses = team === -1 ? p.id !== id : p.team !== team;
      if (loses) {
        p.state = 5; p.frame2 = 0; p.hold = 0; p.stateT = 0;
        p.hasMount = false; p.mount = -1; p.dismountBlink = false;
        p.noPickup = true;                         // +0x709
        p.respawn = null;                          // +0x166 = -1
        p.hitReported = true;
      }
      if (p.id === id && z) p.snapTo(z.x, z.y);
    }
    this.startBoom();
  }

  startBoom() {                                    // FUN_0045edf0: every floor, item, bomb and soft-block cell
    if (this.boomOn) return;
    const g = this.world.grid;
    for (let i = 0; i < W * H; i++) this.boomCells[i] = g[i] <= T_SOFT ? 1 : 0;
    this.boomFrame = 0;
    this.boomOn = true;
    sfx("Bomb");
  }

  // ------------------------------------------------------------------ parts thrown across the map (0xaa)
  onFlyingItems(pkt) {                             // FUN_00436460 -> FUN_0040fda0
    const w = this.world;
    for (let k = 0, n = pkt[1]; k < n; k++) {
      const o = 2 + 5 * k;
      const x = pkt[o], y = pkt[o + 1], tx = pkt[o + 2], ty = pkt[o + 3], dir = pkt[o + 4];
      const i = y * W + x, it = w.items.get(i);
      if (!it) continue;
      w.items.delete(i);
      w.setTile(x, y, T_FLOOR);
      it.flying = true; it.dir = dir & 3; it.tx = tx; it.ty = ty;
      it.px = 40 * x + 20; it.py = 38 * y - 7;
      this.flying.push(it);
    }
  }

  flyStep(it) {                                    // FUN_00412c10
    const w = this.world;
    const d = FLY_SPEED;
    if (it.dir === 0) it.py += d; else if (it.dir === 1) it.px -= d; else if (it.dir === 2) it.py -= d; else it.px += d;
    let ix = T(it.px), iy = T(it.py);
    it.x = T(ix / 40); it.y = T((iy + 28) / 38);
    let wx = -1, wy = -1;                          // wrap inside columns 2..14, rows 2..13
    if (it.x < 2) { wx = 14; wy = it.y; }
    else if (it.x < 15) { if (it.y < 2) { wx = it.x; wy = 13; } else if (it.y >= 14) { wx = it.x; wy = 2; } }
    else { wx = 2; wy = it.y; }
    if (wx >= 0) { it.x = wx; it.y = wy; it.px = 40 * wx + 20; it.py = 38 * wy - 7; ix = T(it.px); iy = T(it.py); }
    const past = it.dir === 0 ? (iy + 28) % 38 > 18 : it.dir === 1 ? ix % 40 < 21
      : it.dir === 2 ? (iy + 28) % 38 < 20 : ix % 40 > 19;
    if (!past || it.x !== it.tx || it.y !== it.ty) return;
    const t = w.tile(it.x, it.y);
    const blocked = w.overlayAt(it.x, it.y) || w.gimmicks.padAt(it.x, it.y) >= 0;    // FUN_004104c0: pads
    if (t >= 2 || blocked) return;                 // keeps flying round until the tile is free
    const i = it.y * W + it.x;
    if (w.items.has(i)) return;
    it.flying = false;
    it.px = 40 * it.x + 20; it.py = 38 * it.y - 7;
    w.items.set(i, it);
    w.setTile(it.x, it.y, T_ITEM);
    if (t === T_FLOOR && w.isMaster()) w.send(new Uint8Array([0xad, it.x, it.y]));
  }

  // a flying part passes over the local player (FUN_00426d80): ask for it by its target tile
  catchFlying(me) {
    for (const it of this.flying) {
      if (it.hidden || it.x !== me.tx || it.y !== me.ty) continue;
      sfx("GetItem");
      it.hidden = true;
      this.world.send(new Writer(8).u8(0x6d).i16(me.id).u8(it.tx).u8(it.ty).u8(0x63).u16(0x63).done());
      return true;
    }
    return false;
  }

  takeFlying(x, y) {                               // 0x6e for a part: FUN_004331e0 finds it by its target
    for (const it of this.flying) if (it.tx === x && it.ty === y) it.gone = true;
  }

  // ------------------------------------------------------------------ drawing
  // The background (FUN_0045f590(bg, 1) + FUN_0045f9c0) in two parts: Back01 and the Tile01 checker, still (drawn once
  // and copied in after that: render.js still, while stillKey and the border cells are the same) ...
  drawStill(fb) {
    const t = this.theme, w = this.world;
    if (!t) return;
    fb.opaque(t.back, 0, 0, 0);
    if (!NO_TILES.has(w.mapSet) && t.tile) {
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        if (c === 1 || c === 15 || r === 1 || r === 13 || w.grid[r * W + c] === 5) continue;
        fb.opaque(t.tile, (c + r) & 1, 40 + 40 * c, 28 + 38 * r);
      }
    }
  }

  stillKey() { const t = this.theme; return [t, t && t.back, t && t.tile, this.world.mapSet]; }

  // ... and the Spaceship gate over it, animated
  drawGate(fb) {
    const t = this.theme;
    if (t && this.world.mapSet === 43) fb.opaque(t.gate, this.anim, 164, 0);
  }

  drawForeground(fb) {                             // FUN_0045f590(bg, 0)
    const t = this.theme, w = this.world;
    if (!t) return;
    if (t.back && t.back.n > 1) fb.opaque(t.back, 1, 0, 0);
    if (w.mapSet === 40) {
      fb.opaque(t.etc1, MILITARY_T1[this.anim] ?? 0, -100, -100);
      fb.opaque(t.etc1, MILITARY_T2[this.anim] ?? 0, 600, 180);
    } else if (w.mapSet === 42) {
      fb.opaque(t.etc1, this.anim, 46, 513);
      fb.opaque(t.etc2, this.anim, 677, 39);
      for (const f of this.flakes) fb.opaque(t.etc3, 0, f.x, f.y);
    } else if (w.mapSet === 43) {
      fb.opaque(t.mon1, this.anim2, 42, 303);
      fb.opaque(t.mon2, this.anim2, 358, 506);
      fb.opaque(t.rob1, this.anim, 0, 0);
      fb.opaque(t.rob2, this.anim, 644, 406);
    }
  }

  drawZone(fb) {                                   // FUN_0045fe10, with the floor gimmicks
    const z = this.world.gimmicks.zone;
    if (z && this.theme) fb.opaque(this.theme.zone, z.frame, 40 + 40 * z.x - 80, 28 + 38 * z.y - 76);
  }

  drawDrillShadow(fb, o) { if (this.theme) fb.opaque(this.theme.drill_s, 0, 40 + 40 * o.x - 20, 28 + 38 * o.y - 38); }
  drawDrill(fb, o) { if (this.theme) fb.opaque(this.theme.drill, o.frame, 40 + 40 * o.x - 20, 28 + 38 * o.y - 38); }

  drawBoom(fb) {                                   // FUN_0045eec0
    if (!this.boomOn) return;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (this.boomCells[r * W + c]) fb.eft(A.boom, this.boomFrame, 30 + 40 * c, 13 + 38 * r, EFT_STD);
    }
  }

  // part k at frame orbit - 8k: frames 0..11 pass behind the body (FUN_0045ecf0, drawn before it),
  // 12..23 in front of it (FUN_0045ed70, drawn after it)
  drawOrbit(fb, p, x, y, back) {
    if (p.state === 5 || p.state === 7 || !p.parts || !A.hyperball) return;
    for (let k = 0; k < p.parts; k++) {
      let f = this.orbit - 8 * k;
      if (f < 0) f += 24;
      if (back ? f >= 0 && f < 12 : f > 11 && f < 24) fb.opaque(A.hyperball, f, x, y);
    }
  }
}
