// A player of the match (docs/client/G_player.md). Positions are the original's doubles X/Y
// (sprite anchor); every rule below mirrors the function named in the comment.

import { A } from "./assets.js";
import { EFT_PLAYER, rgb565 } from "./fb565.js";
import { W, H } from "./mapdata.js";
import { SET_MO, SET_ST, SET_TH, SET_PA, SET_PU, SET_DD, SET_WI, SET_WA, SET_MSB, SET_RUI_MO, SET_RUI_ST, SET_FACE,
  characterSet, louieSets } from "./characters.js";
import { outfitSets } from "./outfits.js";
import { DIRS, T_BOMB, T_SOFT, T_BORDER, T_KEEP } from "./objects.js";
import { sfx } from "./sound.js";
import { PAINT565 } from "./panel.js";

const T = Math.trunc;
export const BASE_SPEED = [1.3, 2.8, 3.3, 3.8, 4.3, 4.8, 5.3, 15.0];
// The battle maps' speed level at a round's start on the Basic, Normal and Advanced pages (map sets 0-8, 9-17, 18-26;
// the custom maps and the rooms of 7-12 play the Normal page's): the server's start_speed (config.json, as Road has
// them in the original), which the server's speed check follows too (anticheat.base_level)
const START_SPEED = [4, 6, 6];
export function setStartSpeed(levels) {
  if (!Array.isArray(levels)) return;
  levels.slice(0, 3).forEach((v, i) => { if (Number.isInteger(v) && v >= 1 && v <= 6) START_SPEED[i] = v; });
}
const PAGE_SETS = 27;
export const startSpeed = (mapSet) => (mapSet >= 0 && mapSet < PAGE_SETS ? START_SPEED[Math.floor(mapSet / 9)] : 0);
// the most a Speed item takes it to (FUN_0042a5f0: 4 before the Normal page, then 6), never under the map's start
export const speedCap = (mapSet) => Math.max(mapSet >= 9 ? 6 : 4, startSpeed(mapSet));
const WALK = [80, 70, 65, 60, 55, 50, 45, 20];
const DUR = [80, 120, 60, 70, 50, 70, 60, 40];
const OVERLAY_MS = [100, 100, 100, 100, 60, 100];
export const OV_MY = 0, OV_SUPER = 2, OV_CURES = 3, OV_GETITEM = 4, OV_STAR = 5;
const OV_EFT = ["my", "my_in", "super", "cures", "get_item", "star"];

// Other players between their packets (web client only; the exe snaps them every 110 ms): a walking peer keeps
// walking with its own speed and collision, as the exe does for UDP peers, for at most COAST_MS after the last
// packet. A correction moves the collision position at once and eases the drawn one after it.
const COAST_MS = 250;
const SMOOTH_HALF_MS = 30;     // the drawn offset halves every 30 ms
const SNAP_PX = 60;            // corrections larger than this are drawn at once

// Revenge cart (misobon, G_player §12): after dying, a player rides the outer border and throws bombs inwards.
const CART_SPEED = 3.8;        // px per 20 ms (FUN_0041dd90)

// The actions the player reads (input.js; the keys and gamepad buttons for them: controls.js, the exe's FUN_00459320
// defaults: arrows, Left Shift or Space = bomb, Z = special)
export const KEYS = { up: "up", down: "down", left: "left", right: "right", bomb: "bomb", special: "special" };

export const TEAM_COLOURS = [rgb565(255, 170, 170), rgb565(150, 255, 255), rgb565(0, 255, 0)];

// FUN_00426d40: the name colour of teams 0..2, white without a team. In Panel Attack every player has a "team" (its
// paint colour, the slot without a real team): for 3..5 the exe returns a garbage value, we use the paint colour.
export function labelColour(p) {
  if (p.team >= 0 && p.team <= 2) return TEAM_COLOURS[p.team];
  if (p.team > 2 && p.world.mode === 1) return PAINT565[p.team + 1] ?? 0xffff;
  return 0xffff;
}

export class Player {
  constructor(world, entry, slot) {
    this.world = world;
    this.slot = slot;
    this.id = entry.id;
    this.nick = entry.nick;
    this.team = entry.team;
    this.cls = entry.cls;
    this.char = entry.char;
    this.look = entry.look >= 0 ? entry.look : 0;   // character from the avatar
    this.outfit = entry.outfit || null;              // or a 3D avatar, built like the exe does (outfits.js)
    this.guild = entry.guild || "";
    this.bot = !!entry.bot;                // a training's bot (bot.js): this page plays it, as its own player
    this.local = entry.id === world.match.myId || this.bot;
    this.active = true;
    this.set = null;
    this.louie = null;
    this.state = 1; this.dir = 0; this.frame = 0; this.frame2 = 0;
    this.stateT = 0; this.walkT = 0; this.hold = 0;
    this.X = 0; this.Y = 0;
    this.overlays = OV_EFT.map(() => ({ on: false, frame: 0, t: 0 }));
    this.relayT = 0;
    this.sentState = -1; this.sentDir = -1;
    this.spawnIdx = slot;                  // +0x6f8, from 0x83
    this.respawn = null;                   // Hyper Bomb: tile to come back on after the death animation (+0x168)
    this.noPickup = false;                 // +0x709: killed by the goal, takes no more items
    this.sinceRelay = 0; this.ox = 0; this.oy = 0;   // drawn offset of a remote player (see COAST_MS)
    this.ringT = 0;
    this.warpPhase = 0; this.warpDest = -1; this.warpLatch = false; this.introRise = false;
    this.prevTx = -1; this.prevTy = -1;
    this.wonThisRound = 0; this.roundsWon = 0; this.pointsDelta = 0; this.totalPoints = 0; this.title = "";
    this.resetStats(world.mapSet);
    this.resetCart();
    this.moveBy(0, 0);
  }

  async load() {
    // the player's own character or 3D avatar, in team battle too (the teams show by rings and name colours); a 3D
    // avatar that cannot be built shows the character
    const set = this.outfit ? outfitSets(this.outfit).catch(() => characterSet(this.look)) : characterSet(this.look);
    [this.set, this.louie] = await Promise.all([set, louieSets()]);
  }

  frames(idx) { return this.set && this.set[idx] ? this.set[idx].n : 1; }

  // ------------------------------------------------------------------ stats (FUN_00425250)
  resetStats(mapSet) {
    this.fire = 2; this.speedBase = 1; this.bombs = 1;
    if (mapSet === 0) { this.fire = 5; this.speedBase = 4; this.bombs = 5; }
    else if (mapSet === 6) this.speedBase = 4;
    else if (mapSet === 9 || mapSet === 18) { this.fire = 8; this.speedBase = 6; this.bombs = 8; }
    else if (mapSet === 15 || mapSet === 24) this.speedBase = 6;
    else if (mapSet === 39) this.speedBase = 6;            // Hyper Bomb Circuit
    else if (mapSet >= 28 && mapSet <= 35) { this.bombs = 2; if (mapSet === 35) this.speedBase = 6; }   // Panel Attack
    if (startSpeed(mapSet)) this.speedBase = startSpeed(mapSet);            // (server extension: every battle map)
    this.speedLvl = this.speedBase;
    this.placed = 1;                       // +0x97: bombs placed + 1
    this.kick = 0; this.glove = 0; this.punch = 0; this.line = 0; this.fullFire = 0;
    this.parts = 0;                        // +0x135: HyperBomb parts carried
    this.bombKind = 0; this.special = -1;
    this.mount = -1; this.hasMount = false;
    this.vulnerable = true;                // +0x718 (barrier item sets 0)
    this.disease = 0; this.sick = false; this.autoWalk = false; this.speedForced = false;
    this.speedUp = false;                  // Boss Battle speed-up item (+0xc14): top speed until 0xe0
    this.bombOK = false; this.bombX = -1; this.bombY = -1;
    this.grabAt = null;                    // [x, y]: the glove key came before our bomb there did (world.onBombPlaced)
    this.hitReported = false;
    this.kickFreeze = false; this.kickFreezeT = 0;
    this.stunned = false; this.stunT = 0;
    this.dash = false; this.jump = -1; this.jumpH = 0; this.jumpT = 0;   // +0x1b5, +0x1b0, +0x19c, +0x194
    this.louiePunch = false;               // +0x6f7
    this.contact = new Set();              // +0x13c: disease contact already reported (ids)
    this.restTx = -1; this.restTy = -1;    // +0xa0/+0xa4: tile while not walking
    this.dismountBlink = false; this.reviveBlink = false; this.blinkPhase = 0; this.blinkT = 0; this.blinkTotal = 0;
    this.out = false;
    for (const o of this.overlays || []) o.on = false;
    const tr = this.world.match.training;
    if (tr && tr.full) this.fullItems(mapSet);
  }

  // A training's "Start with full items" (training.js, which gives its own copy the same): the most fire, bombs and
  // speed an item gets on this map (world.onItemEffect), kick, glove and punch
  fullItems(mapSet) {
    this.fire = this.bombs = mapSet >= 9 ? 8 : 5;
    this.speedBase = this.speedLvl = speedCap(mapSet);
    this.kick = 1; this.glove = 1; this.punch = 1; this.special = 9;
  }

  // ------------------------------------------------------------------ geometry
  moveBy(dx, dy) {                         // FUN_00424de0
    this.X += dx; this.Y += dy;
    this.recompute();
    if (this.clampTile()) this.snapTo(this.tx, this.ty);
  }

  recompute() {
    const ix = T(this.X), iy = T(this.Y);
    this.left = ix + 30; this.right = ix + 62; this.cx = ix + 46;
    this.top = iy + 59; this.bottom = iy + 91; this.cy = iy + 75;
    this.tx = T((ix + 6) / 40); this.tileLeft = this.tx * 40 + 40;
    this.ty = T((iy + 47) / 38); this.tileTop = this.ty * 38 + 28;
  }

  clampTile() {                            // FUN_00428980 (normal maps): tx 1..15, ty 1..13 (inside the border)
    const w = this.world, g = w.gimmicks;
    if (w.mapSet === 21 && g && g.pads.length) return this.clampPads(g);
    let c = false;
    if (this.tx < 1) { this.tx = 1; c = true; } else if (this.tx > W - 2) { this.tx = W - 2; c = true; }
    if (this.ty < 1) { this.ty = 1; c = true; } else if (this.ty > H - 2) { this.ty = H - 2; c = true; }
    return c;
  }

  clampPads(g) {                           // set 21: border pads wrap to the other side (J_gimmicks §4.2.5)
    const w = this.world;
    const k = g.padAt(this.tx, this.ty);
    if (k < 0) {
      let c = false;
      if (this.tx < 0) { this.tx = 0; c = true; } else if (this.tx > 16) { this.tx = 16; c = true; }
      if (this.ty < 0) { this.ty = 0; c = true; } else if (this.ty > 14) { this.ty = 14; c = true; }
      return c;
    }
    if (w.tile(this.tx, this.ty) === 5) {  // pad closed by hurry-up: back inside, or die
      const y = this.ty, x = this.tx;
      const inner = this.tx < 1 ? [1, 15] : [15, 1];
      if (w.tile(inner[0], y) === 0) this.tx = inner[0];
      else if (w.tile(inner[1], y) === 0) this.tx = inner[1];
      else if (this.local && this.state !== 5 && this.state !== 8) w.localDied(this, -1);
      return this.tx !== x;
    }
    if (this.cx < 60 || this.cx > 700 || this.cy < 49 || this.cy > 580) {
      this.dash = false; this.jump = -1; this.jumpH = 0;
      this.tx = g.pads[k].tx; this.ty = g.pads[k].ty;
      return true;
    }
    return false;
  }

  snapTo(tx, ty) {                         // FUN_00424d40
    this.X = 40 * tx + 14; this.Y = 38 * ty - 26;
    this.ox = 0; this.oy = 0;
    this.recompute();
  }

  spawnAt(tx, ty) {                        // FUN_00424f60
    this.snapTo(tx, ty);
    this.hitReported = false;              // +0x4c: a revived player can be hit again
    this.state = 1; this.frame = 0; this.frame2 = 0; this.dir = 0;
    this.bombOK = false;
    this.out = false;
    this.active = true;
    this.noPickup = false;
    this.dismountBlink = false; this.reviveBlink = false; this.blinkPhase = 0; this.blinkT = 0; this.blinkTotal = 0;
    this.resetCart();
  }

  resetCart() {                            // the cart fields of FUN_00424f60
    this.inCart = false;                   // +0x142
    this.cartX = 0; this.cartY = 0;        // +0x143 / +0x14b (anchor, like X/Y)
    this.cartTx = 0; this.cartTy = 0;      // +0x153 / +0x157
    this.cartAnim = 4;                     // +0x163: moving 0 down, 1 left, 2 up, 3 right, 4 idle
    this.cartSide = 0;                     // +0x164: border side 0 top, 1 right, 2 bottom, 3 left
    this.cartBombs = 1;                    // +0x165: cart bombs out + 1
    this.reviveVictim = -1; this.reviveX = 0; this.reviveY = 0;   // +0x166..: revive here once that player is out
    this.cartT = 0; this.sentCart = -1;
    this.sinceCart = 0; this.cox = 0; this.coy = 0;               // remote carts, like sinceRelay / ox / oy
  }

  // ------------------------------------------------------------------ movement
  speed(dt) {                              // FUN_0042b240
    const hy = this.world.hyper;
    if (hy && hy.frozen(this)) { this.snapTo(this.tx, this.ty); return 0; }   // 3 parts on the goal
    let v = BASE_SPEED[this.speedLvl] ?? BASE_SPEED[1];
    v = this.world.gimmickSpeedMod(this, v);
    return v * dt * 0.05;
  }

  moveDir(dir, dist) {                     // FUN_0042b9e0: collision steps of at most 4 px
    let rem = dist;
    let guard = 64;
    while (rem !== 0 && guard-- > 0) {
      const chunk = rem < 4.0 ? rem : 4.0;
      if (dir === 0) this.stepDown(chunk); else if (dir === 1) this.stepLeft(chunk);
      else if (dir === 2) this.stepUp(chunk); else this.stepRight(chunk);
      rem -= chunk;
      if (rem < 0 && chunk < 0) break;     // negative distances are applied in one step
    }
  }

  step(dir, d) {
    if (dir === 0) this.stepDown(d); else if (dir === 1) this.stepLeft(d);
    else if (dir === 2) this.stepUp(d); else this.stepRight(d);
  }

  M(x, y) { return this.world.tile(x, y); }
  freeLim() { return this.bombOK ? 2 : 1; }
  stopAtObstacle() { this.dash = false; if (this.autoWalk) { this.autoWalk = false; this.state = 1; } }
  finish() {                               // FUN_00428910
    if (this.bombOK && (this.tx !== this.bombX || this.ty !== this.bombY)) this.bombOK = false;
  }

  stepDown(d) {                            // FUN_00427eb0
    const row = T((this.bottom + T(d) - 28) / 38);
    const colL = T((this.left - 40) / 40), colR = T((this.right - 40) / 40);
    const lim = this.bombOK && this.bombY === row ? 2 : 1;
    const freeL = this.M(colL, row) <= lim, freeR = this.M(colR, row) <= lim;
    if (colL === colR && this.bottom >= this.tileTop + 37 && !this.hasMount && this.kick > 0
        && this.tryKick(this.tx, this.ty + 1, 0)) return;
    if (freeL && freeR) this.moveBy(0, d);
    else {
      const rightColLeftPx = colR * 40 + 40;
      this.stopAtObstacle();
      const aL = this.M(colL, row - 1), aR = this.M(colR, row - 1);
      if (this.bottom !== this.tileTop + 37) this.moveBy(0, this.tileTop + 37 - this.bottom);
      if (freeL) {
        const t = this.right - rightColLeftPx;
        if (t < d) d = t + 1;
        if (!(aL <= this.freeLim())) return this.finish();
        this.moveBy(-d, 0);
      } else if (freeR) {
        const t = rightColLeftPx - this.left;
        if (t < d) d = t;
        if (!(aR <= this.freeLim())) return this.finish();
        this.moveBy(d, 0);
      }
    }
    this.finish();
  }

  stepUp(d) {                              // FUN_00428140
    const row = T((this.top - T(d) - 28) / 38);
    const colL = T((this.left - 40) / 40), colR = T((this.right - 40) / 40);
    const lim = this.bombOK && this.bombY === row ? 2 : 1;
    const freeL = this.M(colL, row) <= lim, freeR = this.M(colR, row) <= lim;
    if (colL === colR && this.top <= this.tileTop && !this.hasMount && this.kick > 0
        && this.tryKick(this.tx, this.ty - 1, 2)) return;
    if (freeL && freeR) this.moveBy(0, -d);
    else {
      const rightColLeftPx = colR * 40 + 40;
      this.stopAtObstacle();
      const aL = this.M(colL, row + 1), aR = this.M(colR, row + 1);
      if (this.top !== this.tileTop) this.moveBy(0, this.tileTop - this.top);
      if (freeL) {
        const t = this.right - rightColLeftPx;
        if (t < d) d = t + 1;
        if (aL <= this.freeLim()) this.moveBy(-d, 0);
      } else if (freeR) {
        const t = rightColLeftPx - this.left;
        if (t < d) d = t;
        if (aR <= this.freeLim()) this.moveBy(d, 0);
      }
    }
    this.finish();
  }

  stepLeft(d) {                            // FUN_004283d0
    const col = T((this.left - T(d) - 40) / 40);
    const rowT = T((this.top - 28) / 38), rowB = T((this.bottom - 28) / 38);
    const lim = this.bombOK && this.bombX === col ? 2 : 1;
    const freeT = this.M(col, rowT) <= lim, freeB = this.M(col, rowB) <= lim;
    if (rowT === rowB && this.left <= this.tileLeft && !this.hasMount && this.kick > 0
        && this.tryKick(this.tx - 1, this.ty, 1)) return;
    if (freeT && freeB) this.moveBy(-d, 0);
    else {
      const botRowTopPx = rowB * 38 + 28;
      this.stopAtObstacle();
      const cB = this.M(col + 1, rowB), cT = this.M(col + 1, rowT);
      if (this.left !== this.tileLeft) this.moveBy(this.tileLeft - this.left, 0);
      if (freeT) {
        const t = this.bottom - botRowTopPx;
        if (t < d) d = t + 1;
        if (cT <= this.freeLim()) this.moveBy(0, -d);
      } else if (freeB) {
        const t = botRowTopPx - this.top;
        if (t < d) d = t;
        if (cB <= this.freeLim()) this.moveBy(0, d);
      }
    }
    this.finish();
  }

  stepRight(d) {                           // FUN_00428670
    const col = T((this.right + T(d) - 40) / 40);
    const rowT = T((this.top - 28) / 38), rowB = T((this.bottom - 28) / 38);
    const lim = this.bombOK && this.bombX === col ? 2 : 1;
    const freeT = this.M(col, rowT) <= lim, freeB = this.M(col, rowB) <= lim;
    if (rowT === rowB && this.right >= this.tileLeft + 39 && !this.hasMount && this.kick > 0
        && this.tryKick(this.tx + 1, this.ty, 3)) return;
    if (freeT && freeB) this.moveBy(d, 0);
    else {
      const botRowTopPx = rowB * 38 + 28;
      this.stopAtObstacle();
      const cB = this.M(col - 1, rowB), cT = this.M(col - 1, rowT);
      if (this.right !== this.tileLeft + 39) this.moveBy(this.tileLeft + 39 - this.right, 0);
      if (freeT) {
        const t = this.bottom - botRowTopPx;
        if (t < d) d = t + 1;
        if (cT <= this.freeLim()) this.moveBy(0, -d);
      } else if (freeB) {
        const t = botRowTopPx - this.top;
        if (t < d) d = t;
        if (cB <= this.freeLim()) this.moveBy(0, d);
      }
    }
    this.finish();
  }

  tryKick(x, y, dir) {                     // FUN_00427d00
    if (!this.local) return false;
    const w = this.world;
    if (w.tile(x, y) !== T_BOMB) return false;
    const b = w.staticBombAt(x, y);
    if (!b || b.kick || b.throwing) return false;
    const [dx, dy] = DIRS[dir];
    const beyond = w.tile(x + dx, y + dy);
    if (beyond !== 0 && beyond !== 1) return false;
    b.kick = 1;
    w.sendKick(b, this, dir);
    sfx("Kick");
    this.state = 1;
    this.kickFreeze = true; this.kickFreezeT = 0;
    w.sendMove(this);
    return true;
  }

  // ------------------------------------------------------------------ local update (FUN_0041e6a0)
  readDirection(input) {
    let d = input.held(KEYS.down) ? 0 : input.held(KEYS.left) ? 1 : input.held(KEYS.up) ? 2 : input.held(KEYS.right) ? 3 : 4;
    if (d < 4 && (this.disease & 4)) d = [2, 3, 0, 1][d];
    return d;
  }

  localUpdate(dt, input, blocked) {
    const w = this.world, s = this.state;
    let beat = false;
    if (s <= 3 && !this.out) {
      if (!this.dash && this.jump < 0) {
        this.relayT += dt;
        if (this.relayT >= 110) { this.relayT -= 110; beat = true; }
      }
      if (!this.dash) {
        if (!this.autoWalk && !blocked && s !== 7 && s !== 2 && s !== 3) {
          const d = this.readDirection(input);
          if (d === 4) { this.state = 1; this.frame2 = 0; }
          else {
            this.state = 0;
            this.dir = d;
            const dist = this.speed(dt);
            w.tileTriggers(this);
            this.moveDir(this.dir, dist);
            if (this.disease & 8) this.autoWalk = true;
          }
        }
      } else this.dashStep(dt);
      if (this.state === 1) w.standPush(this, dt);
    } else if (s === 4 && this.stunned) this.stunTimer(dt);
    else if (this.inCart && !w.hurry && !blocked) this.cartUpdate(dt, input);
    if (this.state !== 7 && this.autoWalk && !this.dismountBlink && !this.reviveBlink && !this.dash && this.jump < 0) {
      this.moveDir(this.dir, this.speed(dt));
      w.tileTriggers(this);
      this.state = 0;
    }
    if (!blocked) this.bombKey(input);
    if (w.hyper) w.hyper.goalCheck(this);  // FUN_0045f4d0
    if (!blocked) {
      if (input.take(KEYS.special)) {
        if (this.hasMount) this.mountSpecial();
        else if (this.special === 10) this.lineBomb();
        else if (this.special === 9) this.doPunch();
      }
    }
    // 0x66 goes out after this tick's move: every 110 ms (the exe's relay heartbeat) and, unlike the exe, at once
    // when the player starts, stops, turns or changes state, so the other web clients can walk it in between.
    if (this.state < 5 && !this.out && !this.dash && this.jump < 0
        && (beat || this.state !== this.sentState || this.dir !== this.sentDir)) {
      w.sendMove(this);
      if (!beat) this.relayT = 0;
    }
  }

  dashStep(dt) {                           // FUN_0042b980
    this.state = 1;
    const before = [this.X, this.Y];
    this.moveDir(this.dir, 15.0 * dt * 0.05);
    if (this.X === before[0] && this.Y === before[1]) this.dash = false;
  }

  stunTimer(dt) {                          // FUN_00429dc0
    this.stunT += dt;
    if (this.stunT >= 1000) { this.stunned = false; this.state = 1; this.frame = 0; }
  }

  bombKey(input) {                         // §7.1
    const w = this.world;
    const trigger = input.take(KEYS.bomb) || (this.disease & 0x10) !== 0;
    if (!trigger || (this.disease & 0x40)) return;
    if (this.inCart) {                     // cart bomb: from a border tile or a wrap pad, one at a time
      if ((w.tile(this.cartTx, this.cartTy) === T_BORDER || w.gimmicks.padAt(this.cartTx, this.cartTy) >= 0)
          && this.cartBombs < 2) w.cartBombRequest(this, this.cartTx, this.cartTy);
      return;
    }
    const pending = w.pendingCount();
    const busy = [2, 3, 4, 5, 8].includes(this.state);
    const coming = w.markerAt(this.tx, this.ty);  // our bomb here is on its way (0x67 sent, its 0x68 not back yet)
    if (this.placed + pending <= this.bombs && !busy && w.tile(this.tx, this.ty) === 0
        && !coming && !w.warpAt(this.tx, this.ty)
        && (!(this.disease & 0x20) || this.placed + pending < 2)) {
      w.placeBombRequest(this, this.tx, this.ty);
    }
    // the glove: lift the bomb underfoot. A press that comes before that bomb does is kept: it is thrown the moment
    // its 0x68 is here (world.onBombPlaced), so a quick double tap never waits for a third
    if (!this.grab() && coming && this.canGrab()) this.grabAt = [this.tx, this.ty];
  }

  canGrab() {
    return this.glove && !this.dismountBlink && !this.reviveBlink && !this.hasMount
      && ![2, 3, 4, 5, 8].includes(this.state) && !this.world.overlayAt(this.tx, this.ty);
  }

  grab() {                                 // the glove throw of the bomb this player stands on (world.throwBomb)
    const w = this.world;
    const b = w.tile(this.tx, this.ty) === T_BOMB ? w.staticBombAt(this.tx, this.ty) : null;
    if (!b || b.throwing || b.kick || !this.canGrab()) return false;
    this.state = 2; this.frame = 0; this.frame2 = 0; this.hold = 0; this.stateT = 0;
    sfx("Throw");
    w.throwBomb(b, this, this.dir);
    return true;
  }

  doPunch() {                              // FUN_004205a0
    if (this.state === 8 || [2, 3, 4, 5].includes(this.state)) return;
    const [dx, dy] = DIRS[this.dir];
    const x = this.tx + dx, y = this.ty + dy;
    const b = this.world.staticBombAt(x, y);
    if (!b || b.throwing || b.kick || this.world.overlayAt(x, y)) return;
    b.throwing = 1; b.punch = true;
    if (this.hasMount && this.mount === 2) { this.louiePunch = true; this.state = 0; }   // Blue Louie
    else this.state = 3;
    this.frame = 0; this.hold = 0; this.stateT = 0;
    sfx("Kick");
    this.world.sendPunch(b, this, this.dir);
  }

  lineBomb() {                             // FUN_004200f0
    if ((this.disease & 0x40) || [2, 3, 4, 5, 8].includes(this.state)) return;
    const w = this.world;
    const cap = (this.disease & 0x20) ? 1 : this.bombs;
    const avail = cap + 1 - this.placed - w.pendingCount();
    const [dx, dy] = DIRS[this.dir];
    const tiles = [];
    for (let i = 0; i < Math.min(8, avail); i++) {
      const x = this.tx + dx * i, y = this.ty + dy * i;
      if (w.tile(x, y) !== 0 || w.markerAt(x, y) || w.remotePlayerAt(x, y, this) || w.gimmicks.goalAt(x, y)) break;
      tiles.push([x, y]);
    }
    if (tiles.length) w.lineBombRequest(this, tiles);
  }

  // ------------------------------------------------------------------ animation
  walkClock(dt) {                          // in FUN_0041a2d0, every slot
    this.walkT += dt;
    if (this.walkT > WALK[this.speedLvl] && this.state === 0) {
      this.walkT = 0;
      this.frame = (this.frame + 1) % this.frames(SET_MO + this.dir);
    }
  }

  animate(dt) {                            // FUN_004275d0 (state animations) + overlay/blink timers
    this.warpCheck();
    const s = this.state;
    if (s >= 1 && s <= 4) { this.restTx = this.tx; this.restTy = this.ty; }
    if (s === 0 && this.louiePunch) {      // FUN_004277c0: the Blue Louie punch runs its walk frames 0..2
      this.stateT += dt;
      if (this.stateT >= DUR[0]) {
        this.stateT -= DUR[0];
        if (this.frame > 2) { this.frame = 0; this.state = 1; this.louiePunch = false; }
      }
    }
    if (s !== 0 && s !== 8) {
      this.stateT += dt;
      const dur = DUR[s];
      while (this.stateT >= dur) {
        this.stateT -= dur;
        this.stepState(s);
        if (this.state !== s) break;
      }
    }
    for (let k = 0; k < 6; k++) {
      const o = this.overlays[k];
      if (!o.on) continue;
      o.t += dt;
      if (o.t >= OVERLAY_MS[k]) {
        o.t -= OVERLAY_MS[k];
        const e = A[OV_EFT[k]];
        const n = e ? e.n : 1;
        if (++o.frame >= n) { if (k === OV_GETITEM) o.on = false; o.frame = 0; }
      }
    }
    this.overlays[OV_MY].on = this === this.world.me && this.state !== 8;
    this.overlays[OV_CURES].on = this.sick;
    this.overlays[OV_SUPER].on = !this.vulnerable;
    this.overlays[OV_STAR].on = this.state === 4;
    this.ringT = (this.ringT + dt) % 1000;
    if (this.dismountBlink || this.reviveBlink) {   // FUN_0042adc0 / FUN_0042ae40: 150 ms blink, invulnerable
      this.blinkT += dt; this.blinkTotal += dt;
      if (this.blinkT >= 150) {
        this.blinkT -= 150;
        this.blinkPhase ^= 1;
        this.frame = (this.frame + 1) % this.frames(SET_ST + this.dir);
      }
      if (this.blinkTotal >= (this.dismountBlink ? 1500 : 2500)) {
        this.dismountBlink = false; this.reviveBlink = false; this.blinkPhase = 0; this.blinkTotal = 0;
      }
    }
    if (this.kickFreeze) { this.kickFreezeT += dt; if (this.kickFreezeT >= 300) this.kickFreeze = false; }
  }

  warpCheck() {                            // warp trigger, local players only (J_gimmicks §4.1)
    const w = this.world, g = w.gimmicks;
    if ((this.prevTx !== this.tx || this.prevTy !== this.ty) && this.warpLatch) this.warpLatch = false;
    this.prevTx = this.tx; this.prevTy = this.ty;
    if (!this.local || !g || !g.warps.length || w.match.phase !== 0 || this.state === 5 || this.state === 8
        || this.out || w.match.scene !== 6) return;
    if (this.warpLatch || this.state === 7 || g.warpIndexAt(this.tx, this.ty) < 0) return;
    const d = g.warpDest(this.tx, this.ty);
    this.frame = 0; this.state = 7; this.stateT = 0; this.introRise = false;
    this.snapTo(this.tx, this.ty);
    this.warpDest = d; this.warpPhase = 0;
    w.sendWarp(this);
  }

  warpStep() {                             // FUN_00427860: sink, teleport, rise (40 ms per wa frame)
    const n = this.frames(SET_WA), w = this.world;
    if (this.warpPhase === 0) {
      if (++this.frame >= n) {
        this.frame = 0; this.warpPhase = 1;
        const wp = this.warpDest >= 0 ? w.gimmicks.warps[this.warpDest] : null;
        if (wp) { this.frame = n - 1; this.snapTo(wp.x, wp.y); this.prevTx = wp.x; this.prevTy = wp.y; }
      }
    } else if (--this.frame < 1) {
      this.frame = 0;
      if (this.local) w.sendMove(this, 0x21);
      this.state = 1;
      this.warpPhase = 0; this.warpLatch = true; this.warpDest = -1;
      if (this.local && w.tile(this.tx, this.ty) > 2 && !this.out) w.localDied(this, -1);   // FUN_00426e80
    }
  }

  applyWarp(pkt) {                         // 0x7b from a peer (FUN_00433c10)
    const v = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
    const drawnX = this.X + this.ox, drawnY = this.Y + this.oy;
    this.X = v.getInt16(3, true); this.Y = v.getInt16(5, true);
    this.moveBy(0, 0);
    this.ox = drawnX - this.X; this.oy = drawnY - this.Y;
    if (this.ox * this.ox + this.oy * this.oy > SNAP_PX * SNAP_PX) { this.ox = 0; this.oy = 0; }
    this.state = pkt[7]; this.frame = 0; this.stateT = 0;
    this.warpDest = pkt[8] === 0xff ? -1 : pkt[8]; this.warpPhase = 0; this.introRise = false;
  }

  holdStep(n) {                            // frame 0 shown for two steps
    if (this.frame === 0 && !this.hold) { this.hold = 1; return false; }
    this.hold = 0;
    this.frame++;
    if (this.frame >= n) { this.frame = 0; return true; }
    return false;
  }

  stepState(s) {
    switch (s) {
      case 1: this.holdStep(this.frames(SET_ST + this.dir)); break;
      case 2: if (this.holdStep(this.frames(SET_TH + this.dir))) this.state = 1; break;
      case 3: if (this.holdStep(this.frames(SET_PU + this.dir))) this.state = 1; break;
      case 4: this.frame = (this.frame + 1) % this.frames(SET_PA + this.dir); break;
      case 5: {                            // FUN_00427c80
        const n = this.frames(SET_DD);
        this.frame = this.frame2;
        if (this.frame2 === 0 && !this.hold) this.hold = 1;
        else { this.hold = 0; this.frame2++; }
        if (this.frame2 >= n) { this.out = true; this.enterCart(); this.state = 8; this.sick = false; }
        break;
      }
      case 6: break;                       // victory pose frames are driven by the HUD (70 ms)
      case 7:
        if (this.introRise) { if (this.frame > 0) this.frame--; }   // round-start rise (FUN_00421b80)
        else this.warpStep();
        break;
    }
  }

  // ------------------------------------------------------------------ network input
  applyRelay(pkt) {                        // FUN_00432250 (relay path, recvMode 2)
    const st = pkt[8];
    if (this.state === 5 || this.state === 8 || st === 5 || st === 8 || this.jump > 0 || this.dash) return;
    const v = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
    const drawnX = this.X + this.ox, drawnY = this.Y + this.oy;
    const smooth = this.state !== 7 && st !== 0x21;          // a warp teleports
    this.X = v.getInt16(3, true);
    this.Y = v.getInt16(5, true);
    this.dir = pkt[7] & 3;
    if (st !== 0x20) {                     // the exe turns a bomb-sync into state 0; here it only moves the player
      this.state = (st === 0x1e || st === 0x1f || st === 0x21) ? 1 : st;
      this.frame = pkt[9];
    }
    this.moveBy(0, 0);
    if (st === 0x1e) this.dash = true;     // FUN_0042b3d0: Green Louie dash
    else if (st === 0x1f) { this.jumpT = 0; this.jump = -1; this.startJump(); }   // Pink Louie jump
    this.sinceRelay = 0;
    this.ox = drawnX - this.X; this.oy = drawnY - this.Y;
    if (!smooth || this.ox * this.ox + this.oy * this.oy > SNAP_PX * SNAP_PX) { this.ox = 0; this.oy = 0; }
  }

  remoteUpdate(dt) {                       // FUN_0042aef0, with the UDP-peer walking for relay peers too
    this.sinceRelay += dt;
    if (this.ox !== 0 || this.oy !== 0) {
      const k = Math.pow(0.5, dt / SMOOTH_HALF_MS);
      this.ox *= k; this.oy *= k;
      if (Math.abs(this.ox) < 0.25 && Math.abs(this.oy) < 0.25) { this.ox = 0; this.oy = 0; }
    }
    if (this.inCart) this.remoteCart(dt);
    if (this.state === 5 || this.state === 6 || this.state === 8) return;
    if (this.state === 0) {
      if (!this.dash && this.jump < 0 && this.sinceRelay < COAST_MS) this.moveDir(this.dir, this.speed(dt));
    } else if (this.state === 1) {
      if (this.dash) this.dashStep(dt);
      else if (this.jump > 0) this.jumpStep(dt);
      else this.world.standPush(this, dt);
    } else if (this.state === 4 && this.stunned) this.stunTimer(dt);
  }

  // ------------------------------------------------------------------ Louie specials (G_player §7.3)
  mountSpecial() {                         // FUN_0041ff40
    const w = this.world;
    if (this.mount === 0) {                // pink: jump
      if (this.jump < 1 && !w.overlayAt(this.tx, this.ty)) { this.startJump(); w.sendMove(this, 0x1f); }
    } else if (this.mount === 1) {         // green: dash until blocked
      if (!this.dash) { this.dash = true; w.sendMove(this, 0x1e); }
    } else if (this.mount === 2) this.doPunch();   // blue
    else if (this.mount === 3) this.lineBomb();    // brown
  }

  startJump() {                            // FUN_00429f10: 1 or 2 tiles ahead, over a bomb or soft block, else a hop
    const w = this.world, [dx, dy] = DIRS[this.dir];
    const x1 = this.tx + dx, y1 = this.ty + dy, x2 = x1 + dx, y2 = y1 + dy;
    const t1 = w.tile(x1, y1);
    const hop = () => { this.jump = 1; this.state = 1; this.jumpT = 0; };
    if ((t1 > 3 && t1 !== T_KEEP) || w.overlayAt(x1, y1) || w.warpAt(this.tx, this.ty)) return hop();
    if (w.warpAt(x1, y1)) return this.jumpTo(40, 38);             // onto the object ahead
    const free2 = w.tile(x2, y2) <= 1 && !w.overlayAt(x2, y2);
    if (t1 === T_BOMB || t1 === T_SOFT || t1 === T_KEEP) return free2 ? this.jumpTo(80, 76) : hop();
    return free2 ? this.jumpTo(80, 76) : this.jumpTo(40, 38);
  }

  jumpTo(px, py) {                         // FUN_00429df0: distance to the target centre, from the tile edge
    this.jump = 2; this.state = 1; this.jumpT = 0;
    const d = this.dir;
    if (d === 0) { this.jumpDist = this.tileTop - this.cy + 19 + py; this.jumpTarget = this.cy + this.jumpDist; }
    else if (d === 2) { this.jumpDist = this.cy - this.tileTop - 19 + py; this.jumpTarget = this.cy - this.jumpDist; }
    else if (d === 1) { this.jumpDist = this.cx - this.tileLeft - 20 + px; this.jumpTarget = this.cx - this.jumpDist; }
    else { this.jumpDist = this.tileLeft - this.cx + 20 + px; this.jumpTarget = this.cx + this.jumpDist; }
  }

  jumpStep(dt) {                           // FUN_0042a1e0: 2.5 px per 20 ms, height = sin arc × 50 px
    const d = dt * 2.5 * 0.05;
    this.jumpT += d;
    let h = 0;
    if (this.jump === 1) h = T(Math.sin(this.jumpT * 3.141592 * (1 / 76)) * 50);
    else if (this.jump === 2) {
      const dir = this.dir;
      if (dir === 0) this.moveBy(0, d); else if (dir === 1) this.moveBy(-d, 0);
      else if (dir === 2) this.moveBy(0, -d); else this.moveBy(d, 0);
      const arrived = dir === 0 ? this.jumpTarget <= this.cy : dir === 2 ? this.cy <= this.jumpTarget
        : dir === 1 ? this.cx <= this.jumpTarget : this.jumpTarget <= this.cx;
      h = arrived ? 0 : T(Math.sin(this.jumpT * 3.141592 / this.jumpDist) * 50);
    }
    this.jumpH = h;
    if (this.jumpH < 1) {
      this.jumpH = 0; this.jumpT = 0; this.jump = -1;
      if (this.local) this.world.landed(this);
    }
  }

  // ------------------------------------------------------------------ drawing (FUN_004259c0)
  drawShadow(fb) {                         // FUN_00426c30
    fb.half(A.bomb_s, 0, T(this.X + this.ox) + 3, T(this.Y + this.oy) + 10);
  }

  drawBody(fb) {
    if (!this.set) return;
    const ax = T(this.X + this.ox) - 82, ay = T(this.Y + this.oy) - 108;
    const set = this.set;
    const hy = this.world.hyper, oy = this.hasMount && !this.dismountBlink ? ay - this.jumpH : ay;
    if (this.overlays[OV_GETITEM].on) this.drawOverlay(fb, OV_GETITEM, ax, ay);
    if (hy) hy.drawOrbit(fb, this, ax, oy, true);
    if (this.hasMount && !this.dismountBlink && this.louie) {
      const jy = ay - this.jumpH, L = this.louie[this.mount] || this.louie[0];
      if (this.state === 0) { fb.opaque(L[this.dir], this.frame, ax, jy); fb.opaque(set[SET_RUI_MO + this.dir], this.frame, ax, jy); }
      else if (this.state === 6) fb.opaque(set[SET_WI], this.frame, ax, ay);
      else { fb.opaque(L[4 + this.dir], this.frame, ax, jy); fb.opaque(set[SET_RUI_ST + this.dir], this.frame, ax, jy); }
    } else if (this.dismountBlink || this.reviveBlink) {
      const idx = this.state === 0 ? SET_MO + this.dir : this.state === 6 ? SET_WI : SET_ST + this.dir;
      if (this.blinkPhase) fb.white(set[idx], this.frame, ax, ay); else fb.opaque(set[idx], this.frame, ax, ay);
    } else {
      const idx = [SET_MO + this.dir, SET_ST + this.dir, SET_TH + this.dir, SET_PU + this.dir, SET_PA + this.dir,
        SET_DD, SET_WI, SET_WA][this.state];
      if (idx !== undefined) fb.opaque(set[idx], this.frame, ax, ay);
      if (this.state === 4) this.drawOverlay(fb, OV_STAR, ax, ay);
      if (this === this.world.me) this.drawOverlay(fb, OV_MY, ax, ay);
    }
    if (this.sick) this.drawOverlay(fb, OV_CURES, ax, ay - this.jumpH);
    if (!this.vulnerable) this.drawOverlay(fb, OV_SUPER, ax, ay - this.jumpH);
    if (this.team >= 0 && this.team <= 2 && ![5, 6, 7].includes(this.state) && this.world.mode !== 1) {   // no ring in Panel Attack
      const ring = [A.ringr, A.ringb, A.ringg][this.team];
      fb.alpha(ring, T(this.ringT / 100), ax, ay - this.jumpH, 16);
    }
    if (hy) hy.drawOrbit(fb, this, ax, oy, false);
  }

  drawOverlay(fb, k, x, y) {
    const o = this.overlays[k];
    if (!o.on) return;
    fb.eft(A[OV_EFT[k]], o.frame, x, y, EFT_PLAYER);
  }

  drawName(fb) {
    this.drawLabel(fb, T(this.X + this.ox) + 14, T(this.Y + this.oy) - this.jumpH + 15);
  }

  drawLabel(fb, x, y) {                    // FUN_00426cc0: centred on 11 characters, team colour
    const colour = labelColour(this);
    fb.text(x + (11 - this.nick.length) * 3, y, this.nick, colour, 0);
  }

  // ------------------------------------------------------------------ revenge cart (G_player §12)
  enterCart() {                            // FUN_00428dc0, at the end of the death animation
    const w = this.world;
    if (w.mode !== 0 || this.inCart || w.hurry || !w.match.rules[4] || w.mapSet % 9 === 8) return;   // Battle, not Soccer
    this.inCart = true;
    const y = Math.min(H - 2, Math.max(1, this.ty));
    if (this.tx > W >> 1) { this.cartSet(W - 1, y); this.cartSide = 1; } else { this.cartSet(0, y); this.cartSide = 3; }
    this.cartAnim = 4; this.sinceCart = 0; this.cox = 0; this.coy = 0;
  }

  cartSet(x, y) {                          // FUN_00428ff0
    this.cartTx = x; this.cartTy = y;
    this.cartX = 40 * x + 14; this.cartY = 38 * y - 26;
  }

  cartMove(dir, d) {                       // FUN_00429100 / 180 / 200 / 280 + FUN_00429070
    // the lane runs from tile lo to hiX / hiY: 1..15 x 1..13 (Basic maps 2..14 x 2..12, inside their hard ring)
    const lo = this.world.mapSet < 9 ? 2 : 1, hiX = W - 1 - lo, hiY = H - 1 - lo;
    if (dir === 0) { this.cartY += d; if (this.cartY + 75 > 38 * hiY + 47) this.cartY = 38 * hiY - 29; }
    else if (dir === 1) { this.cartX -= d; if (this.cartX + 46 < 40 * lo + 60) this.cartX = 40 * lo + 14; }
    else if (dir === 2) { this.cartY -= d; if (this.cartY + 75 < 38 * lo + 47) this.cartY = 38 * lo - 28; }
    else if (dir === 3) { this.cartX += d; if (this.cartX + 46 > 40 * hiX + 60) this.cartX = 40 * hiX + 13; }
    this.cartTx = T((T(this.cartX) + 6) / 40);
    this.cartTy = T((T(this.cartY) + 47) / 38);
  }

  cartUpdate(dt, input) {                  // cart branch of FUN_0041e6a0
    const held = (k) => input.held(k);
    if (!held(KEYS.down) && !held(KEYS.left) && !held(KEYS.up) && !held(KEYS.right)) this.cartAnim = 4;   // FUN_0041e4a0
    else this.cartInput(dt, held);
    // 0x87 every 110 ms like the exe (FUN_00421ff0) and, for the web clients, at once when it starts, stops or turns
    this.cartT += dt;
    const beat = this.cartT > 109;
    if (beat) this.cartT -= 110;
    if (beat || this.cartSide * 8 + this.cartAnim !== this.sentCart) {
      this.world.sendCart(this);
      if (!beat) this.cartT = 0;
    }
  }

  cartInput(dt, held) {                    // FUN_00429300: along the side; the other axis at a corner changes side
    const d = CART_SPEED * dt * 0.05, small = this.world.mapSet < 9;
    const lo = small ? 2 : 1, hiX = W - 1 - lo, hiY = H - 1 - lo, R = W - 1, B = H - 1;
    const turn = (x, y, side, anim) => { this.cartSet(x, y); this.cartSide = side; this.cartAnim = anim; };
    const side = this.cartSide;
    if (side === 1 || side === 3) {
      if (held(KEYS.down)) { this.cartMove(0, d); this.cartAnim = 0; return; }
      if (held(KEYS.up)) { this.cartMove(2, d); this.cartAnim = 2; return; }
      if (side === 1 && this.cartTx === R && held(KEYS.left)) {
        if (this.cartTy === lo) turn(hiX, 0, 0, 1); else if (this.cartTy === hiY) turn(hiX, B, 2, 1);
      } else if (side === 3 && this.cartTx === 0 && held(KEYS.right)) {
        if (this.cartTy === lo) turn(lo, 0, 0, 3); else if (this.cartTy === hiY) turn(lo, B, 2, 3);
      }
    } else {
      if (held(KEYS.left)) { this.cartMove(1, d); this.cartAnim = 1; return; }
      if (held(KEYS.right)) { this.cartMove(3, d); this.cartAnim = 3; return; }
      if (side === 2 && this.cartTy === B && held(KEYS.up)) {
        if (this.cartTx === lo) turn(0, hiY, 3, 2); else if (this.cartTx === hiX) turn(R, hiY, 1, 2);
      } else if (side === 0 && this.cartTy === 0 && held(KEYS.down)) {
        if (this.cartTx === lo) turn(0, lo, 3, 0); else if (this.cartTx === hiX) turn(R, lo, 1, 0);
      }
    }
  }

  applyCart(pkt) {                         // 0x87 relayed (FUN_00432530)
    if (!this.world.hurry && this.state === 8) {
      const v = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
      const drawnX = this.cartX + this.cox, drawnY = this.cartY + this.coy, was = this.inCart;
      this.inCart = true;
      this.cartX = v.getInt16(3, true); this.cartY = v.getInt16(5, true);
      this.cartSide = pkt[7] & 3; this.cartAnim = pkt[8];
      this.cartTx = T((T(this.cartX) + 6) / 40); this.cartTy = T((T(this.cartY) + 47) / 38);
      this.sinceCart = 0;
      this.cox = was ? drawnX - this.cartX : 0; this.coy = was ? drawnY - this.cartY : 0;
      if (this.cox * this.cox + this.coy * this.coy > SNAP_PX * SNAP_PX) { this.cox = 0; this.coy = 0; }   // corner
    } else if (this.state < 2) this.inCart = false;
  }

  remoteCart(dt) {                         // web client: keep a moving cart moving between its packets
    this.sinceCart += dt;
    if (this.cox !== 0 || this.coy !== 0) {
      const k = Math.pow(0.5, dt / SMOOTH_HALF_MS);
      this.cox *= k; this.coy *= k;
      if (Math.abs(this.cox) < 0.25 && Math.abs(this.coy) < 0.25) { this.cox = 0; this.coy = 0; }
    }
    if (this.cartAnim < 4 && this.sinceCart < COAST_MS && !this.world.hurry) this.cartMove(this.cartAnim, CART_SPEED * dt * 0.05);
  }

  drawCart(fb) {                           // FUN_00428ed0
    if (!this.set) return;
    const cx = T(this.cartX + this.cox), cy = T(this.cartY + this.coy);
    const x = cx - 82, y = cy - 108, s = this.cartSide;
    fb.half(A.msb, s + 8, x, y);                     // shadow
    fb.opaque(A.msb, s, x, y);                       // cart
    fb.opaque(this.set[SET_MSB + s], 0, x, y);       // head, looking into the arena
    fb.opaque(A.msb, s + 4, x, y);                   // cart front
    this.drawLabel(fb, cx + 10, cy + 30);
  }

  face() { return this.set ? this.set[SET_FACE] : null; }
}
