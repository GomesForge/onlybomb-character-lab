// Boss Battle items and coins (web game mode 4; the server's boss_items.py): the Korean client's four item slots
// on Q W A S, its special bombs (kinds 6..8), Rebirth, the coins and money bags on the floor with their "+N", the
// effect over a player using an item, the right-hand board of its HUD (stats, slots, purse) and the "recently used"
// icons under the user boards. docs/client/K_boss_flow.md §3, §4, §6.1; the function names are the Korean exe's.

import { loadSprite } from "../assets/spr.js";
import { Runs } from "./fb565.js";
import { Reader, Writer } from "../net/codec.js";
import { sfx, sfxRemote } from "./sound.js";
import { W } from "./mapdata.js";
import { Item, T_FLOOR, T_ITEM, T_BOMB, T_HARD, T_BURNING, T_ITEM_BURNING, Bomb } from "./objects.js";
import { N_ } from "../i18n.js";

const T = Math.trunc;
const DIR = "BattleBoss/Item/";
// The items the server sells (iteminfo.cfg ids): sprite base, effect (Effect01_SA / 02_SD / 03_SH), how long the
// "recently used" icon stays (FUN_0042bd30), the bomb kind (FUN_00470340); the names are English (i18n.js)
export const INFO = {
  2001: { name: N_("Double bomb"), spr: "SA01_Double01", eff: 0, ms: 6000, bomb: 6 },
  2101: { name: N_("Full power"), spr: "SA02_FullFire01", eff: 0, ms: 3000, bomb: 7 },
  2201: { name: N_("Slow bomb"), spr: "SA03_Slow01", eff: 0, ms: 3000, bomb: 8 },
  5006: { name: N_("Invincible"), spr: "SD01_PowerSuit06", eff: 1, ms: 6000 },
  5112: { name: N_("Speed-up"), spr: "SD02_Speedup12", eff: 1, ms: 12000 },
  8001: { name: N_("Rebirth"), spr: "SH01_Rebirth01", eff: 2, ms: 2000 },
};
const GUARD = 5006, SPEED = 5112, REBIRTH = 8001;
const EFFECTS = ["Effect01_SA", "Effect02_SD", "Effect03_SH", "Effect04_SHRe"];
const BOMBS = { 6: "01_Doublebomb", 7: "02_FullFirebomb", 8: "03_Slowbomb" };
const COIN_FILES = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "20", "30", "40", "50"];
export const COIN_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50];   // FUN_0042c460
const KEYS = ["item1", "item2", "item3", "item4"];             // 1P slots 0..3, Q W A S (FUN_0041fe20; controls.js)
const SLOT_XY = [[8, 161], [46, 161], [8, 195], [46, 195]];     // FUN_00420500, from the board's corner
const BOARD = [710, 63];                                        // UI_Boardplay, 1P (FUN_0041a540)
const TOP_SPEED = 6;                                            // speed-up: +0x145 = 6

const runs = (path) => loadSprite(path).then((s) => ({ r: Runs.fromSprite(s), n: s.count, period: s.b6 || 100 }))
  .catch((e) => { console.warn(e.message); return null; });

let shared = null;
export function loadBossItems() {
  if (!shared) {
    shared = (async () => {
      const s = { icon: {}, mini: {}, eff: [], bomb: {}, coin: [] };
      const jobs = [];
      for (const [id, it] of Object.entries(INFO)) {
        jobs.push(runs(DIR + it.spr + "_i.spr").then((r) => { s.icon[id] = r; }));
        jobs.push(runs(DIR + it.spr + "_m.spr").then((r) => { s.mini[id] = r; }));
      }
      EFFECTS.forEach((f, i) => jobs.push(runs(DIR + f + ".spr").then((r) => { s.eff[i] = r; })));
      for (const [k, f] of Object.entries(BOMBS)) {
        jobs.push(Promise.all([runs("bomb/" + f + ".spr"), runs("bomb/" + f + "_d.spr")]).then((r) => { s.bomb[k] = r; }));
      }
      COIN_FILES.forEach((f, i) => jobs.push(runs(DIR + "Bomey_" + f + ".spr").then((r) => { s.coin[i] = r; })));
      const more = { pocket: DIR + "Bomey_Pocket.spr", number: DIR + "Bomey_Number.spr", board: "UI/UI_Boardplay.spr",
        select: "UI/UI_ItemSelect.spr", main: "UI/UI_mainitem.spr", digits: "UI/UI_number_small.spr" };
      for (const [k, f] of Object.entries(more)) jobs.push(runs(f).then((r) => { s[k] = r; }));
      await Promise.all(jobs);
      return s;
    })();
  }
  return shared;
}

// A coin or a money bag on the floor (floor object types 14..27 / 28, FUN_0040e8e0): it pops up like an item, plays its
// first frames once, then loops from frame 5 (FUN_0040efa0) at 100 ms (coins) or 170 ms (the bag)
export class Pickup extends Item {
  constructor(x, y, kind, spr) {
    super(x, y, kind >= 0 ? 100 + kind : 128);
    this.coin = kind >= 0; this.kind = kind; this.spr = spr ? spr.r : null;
    this.n = spr ? spr.n : 1; this.period = this.coin ? 100 : 170;
  }

  animate(dt) {
    if (this.state === 0 || !this.visible) return super.animate(dt);
    this.t += dt;
    while (this.t >= this.period) {
      this.t -= this.period;
      if (++this.frame >= this.n) this.frame = Math.min(5, this.n - 1);
    }
  }
}

export class BossItems {
  constructor(world) {
    this.world = world;
    this.s = null;
    this.slots = new Map();                        // player id -> [{id, serial, n}] x 4 (0xdd)
    this.recent = new Map();                       // player id -> [{id, ms}] (FUN_0042bd30, at most 5)
    this.effects = new Map();                      // player id -> {spr, frame, t} (FUN_0042c350)
    this.popups = [];                              // "+N" over picked coins (FUN_00475e30)
    this.pending = -1;                             // +0xc19 / +0xc1a: the slot asked for, until 0xdf
    const shop = world.match.session && world.match.session.bossShop;
    this.purse = shop ? shop.mission : 0;          // +0xc00: the Mission Coins shown, the coins picked added
  }

  async load() { this.s = await loadBossItems(); }

  // ------------------------------------------------------------------ server events
  event(op, pkt) {
    const r = new Reader(pkt), w = this.world;
    switch (op) {
      case 0xdd: {                                 // FUN_00470750: a player's four slots
        const rec = [];
        for (let k = 0; k < 4; k++) {
          const o = 7 + 11 * k;
          rec.push({ id: r.i16(o), serial: r.u32(o + 2), n: pkt[o + 10] });
        }
        this.slots.set(r.i16(1), rec);
        return true;
      }
      case 0xdf: return this.onUsed(r.i16(1), r.i16(3), pkt[5], r.i16(6), pkt[16]), true;
      case 0xe2: return this.onSpecialBomb(r.i16(1), pkt[3], pkt[4], r.i16(5), r.i16(7)), true;
      case 0xe3: return this.onRebirth(r.i16(2), r.i16(4)), true;
      case 0xe0: {                                 // FUN_0043a2d0: the speed-up is over
        const p = w.player(r.i16(1));
        if (p) { p.speedUp = false; if (!p.speedForced) p.speedLvl = p.speedBase; }
        return true;
      }
      case 0xe4: {                                 // 0x43a730: coins appear
        for (let k = 0, n = pkt[1]; k < n && 4 + 3 * k < pkt.length; k++) {
          this.place(pkt[3 + 3 * k], pkt[4 + 3 * k], pkt[2 + 3 * k]);
        }
        return true;
      }
      case 0xe6: return this.onTaken(r.i16(1), pkt[3], pkt[4], COIN_VALUES[pkt[5]] || 0), true;
      case 0xe7: return this.place(pkt[3], pkt[4], -1), true;
      case 0xe9: {                                 // FUN_0043aa90: coins, or a skull's disease
        const id = r.i16(1), coins = r.i16(5);
        if (coins === -1) {
          const p = w.player(id);
          if (p && p.local) sfx("Corpse");
          w.setDisease(id, r.u16(7));
          this.onTaken(-1, pkt[3], pkt[4], 0);
        } else this.onTaken(id, pkt[3], pkt[4], coins);
        return true;
      }
    }
    return false;
  }

  place(x, y, kind) {                              // FUN_0040bc80: not on a hard block
    const w = this.world;
    const t = w.tile(x, y);
    if (t === T_HARD || !this.s) return;
    w.items.set(y * W + x, new Pickup(x, y, kind, kind >= 0 ? this.s.coin[kind] : this.s.pocket));
    w.setTile(x, y, t === T_BURNING ? T_ITEM_BURNING : T_ITEM);
  }

  onTaken(id, x, y, value) {                       // 0xe6 / 0xe9 (FUN_0043a8f0): the local taker counts it
    const w = this.world, p = id >= 0 ? w.player(id) : null;
    if (p && p.local && !p.out && p.state !== 5) {
      sfx("GetItem");
      if (value > 0) {
        this.purse += value;
        if (this.s && this.s.number) this.popups.push({ x, y, text: String(value), frame: 0, t: 0 });
      }
    }
    const i = y * W + x, it = w.items.get(i);
    if (it instanceof Pickup) {
      w.items.delete(i);
      if (w.grid[i] === T_ITEM || w.grid[i] === T_ITEM_BURNING) w.grid[i] = T_FLOOR;
    }
  }

  // the local player walks onto a coin or a bag (FUN_00436940): ask for it; true if it was one
  pickup(me, it) {
    if (!(it instanceof Pickup)) return false;
    it.hidden = true;
    if (it.coin) this.world.send(new Writer(6).u8(0xe5).i16(me.id).u8(it.x).u8(it.y).u8(0x63).done());
    else this.world.send(new Writer(9).u8(0xe8).i16(me.id).u8(it.x).u8(it.y).i16(-1).i16(-1).done());
    return true;
  }

  // a sliding or flying bomb runs over one (FUN_00403dd0 / FUN_00404460 pass no player)
  bombOver(it) {
    if (!(it instanceof Pickup)) return false;
    if (it.coin) this.world.send(new Writer(6).u8(0xe5).i16(-1).u8(it.x).u8(it.y).u8(0x63).done());
    else this.world.send(new Writer(9).u8(0xe8).i16(-1).u8(it.x).u8(it.y).i16(-1).i16(-1).done());
    return true;
  }

  // ------------------------------------------------------------------ using a slot (FUN_0041fe20 -> FUN_0043a090)
  keys(me, input) {
    for (let k = 0; k < 4; k++) if (input.take(KEYS[k])) this.use(me, k);
  }

  use(me, k) {
    const w = this.world, rec = (this.slots.get(me.id) || [])[k];
    if (this.pending >= 0 || me.out || me.state === 5 || me.state === 8 || !rec || rec.id < 0 || rec.n <= 0) return;
    if (rec.id === REBIRTH && !w.players.some((p) => p.active && p !== me && (p.out || p.state === 5))) return;
    this.pending = k;
    w.send(new Writer(19).u8(0xde).i16(me.id).i16(0).u8(k).i16(rec.id).u32(rec.serial).u32(0).u8(rec.n)
      .u8(me.tx).u8(me.ty).done());
  }

  onUsed(id, result, slot, iid, left) {            // 0xdf (FUN_00470590), to everyone
    const w = this.world, p = w.player(id);
    if (p && p.local) this.pending = -1;
    if (result === -1 || !p) return;
    const rec = (this.slots.get(id) || [])[slot];
    if (rec && rec.id === iid) { rec.n = left; if (left <= 0) rec.id = -1; }
    const info = INFO[iid];
    if (!info) return;
    const list = this.recent.get(id) || [];        // FUN_0042bd30: five at most, the oldest goes
    list.push({ id: iid, ms: info.ms });
    if (list.length > 5) list.shift();
    this.recent.set(id, list);
    this.effect(p, info.eff);
    if (iid === GUARD) p.vulnerable = false;       // +0xbbc until 0xa2
    else if (iid === SPEED) { p.speedUp = true; p.speedLvl = TOP_SPEED; }   // until 0xe0
  }

  effect(p, eff) {                                 // FUN_0042c240: the effect over the player, Item_E0(eff+1).wav
    if (this.s && this.s.eff[eff]) this.effects.set(p.id, { spr: this.s.eff[eff], frame: 0, t: 0 });
    const name = DIR + "Item_E0" + (eff + 1) + ".wav";
    if (p.local) sfx(name); else sfxRemote(name);
  }

  onSpecialBomb(owner, x, y, iid, id) {            // 0xe2 (FUN_00470340 -> FUN_0040e0b0): power 0 until its 0x69
    const w = this.world, info = INFO[iid];
    if (id < 0 || !info || !info.bomb || w.bombs.some((b) => b.alive && b.x === x && b.y === y)) return;
    for (const p of w.playersOn(x, y)) { p.bombOK = true; p.bombX = x; p.bombY = y; }
    const b = new Bomb(w, id, owner, x, y, 0, info.bomb);
    b.special = true;                              // not one of its owner's bombs
    w.bombs.push(b);
    w.setTile(x, y, T_BOMB);
    sfx("TakeDown");
  }

  onRebirth(reviver, revived) {                    // 0xe3 (FUN_0043a340): back on the reviver's tile once out
    const w = this.world, a = w.player(reviver), b = w.player(revived);
    if (!a || !b) return;
    w.match.hud.addLine(9, `${b.nick} is back, thanks to ${a.nick}!`);
    b.rebirthAt = [a.tx, a.ty];
    this.effect(b, 2);
    if (b.local) sfx(DIR + "Item_E04.wav");
  }

  // ------------------------------------------------------------------ per tick
  update(dt) {
    for (const list of this.recent.values()) {     // FUN_0042c350
      for (const e of list) e.ms -= dt;
      while (list.length && list[0].ms <= 0) list.shift();
      for (let i = list.length - 1; i >= 0; i--) if (list[i].ms <= 0) list.splice(i, 1);
    }
    for (const [id, e] of this.effects) {
      e.t += dt;
      while (e.t > e.spr.period) {
        e.t -= e.spr.period;
        if (++e.frame >= e.spr.n) { this.effects.delete(id); break; }
      }
    }
    const per = this.s && this.s.number ? this.s.number.period : 100;
    for (const pp of this.popups) {                // FUN_00475ff0: 30 steps, 1 px up each
      pp.t += dt;
      while (pp.t >= per) { pp.t -= per; pp.frame++; }
    }
    this.popups = this.popups.filter((pp) => pp.frame <= 29);
  }

  // ------------------------------------------------------------------ drawing
  bombSprites(kind) { return this.s ? this.s.bomb[kind] || null : null; }

  drawEffect(fb, p) {                              // FUN_0042c410 -> FUN_00401120: lightened over the player
    const e = this.effects.get(p.id);
    if (e) fb.lighten(e.spr.r, e.frame, T(p.X + p.ox) - 82, T(p.Y + p.oy) - 108);
  }

  drawPopups(fb) {                                 // FUN_00475f60: the digits rise and fade
    const num = this.s && this.s.number;
    if (!num) return;
    for (const pp of this.popups) {
      const n = pp.text.length, off = n > 1 ? 17 - 7 * n : 10;
      const x = 40 * pp.x + 40 + off, y = 38 * pp.y + 28 - pp.frame - 38;
      for (let i = 0; i < n; i++) fb.alpha(num.r, pp.text.charCodeAt(i) - 48, x + 15 * i, y, 30 - pp.frame);
    }
  }

  // the "recently used" icons under a user board (FUN_00420000): five 20x20 _m icons from its left edge
  drawRecent(fb, p, x, y) {
    const list = this.recent.get(p.id);
    if (!list || !this.s) return;
    list.forEach((e, i) => { const m = this.s.mini[e.id]; if (m) fb.opaque(m.r, 0, x + 3 + 23 * i, y + 44); });
  }

  // The right-hand board of the Korean HUD (FUN_0041a540, 1P): UI_Boardplay 0 at 50 %, 1..3 at 30/32, the stats
  // (FUN_0041a290), the four slots (FUN_00420500) and the purse (FUN_00420480)
  drawBoard(fb, me) {
    const s = this.s;
    if (!s || !s.board) return false;
    const [bx, by] = BOARD, b = s.board.r;
    fb.half(b, 0, bx, by);
    for (let f = 1; f <= 3; f++) fb.alpha(b, f, bx, by, 30);
    if (!me) return true;
    const main = s.main && s.main.r, dg = s.digits && s.digits.r, x = 718, y = 89;
    if (main) {
      fb.opaque(main, me.fullFire ? 7 : 0, x, y);
      fb.opaque(main, 1, x, y + 35);
      fb.opaque(main, [2, 11, 12][me.bombKind] ?? 2, x, y + 70);
      if (!me.vulnerable) fb.opaque(main, 6, x, y + 104);
      if (me.kick) fb.opaque(main, 3, x + 37, y);
      if (me.glove) fb.opaque(main, 4, x + 38, y + 35);
      if (me.punch) { if (me.special === 9) fb.opaque(main, 9, x + 38, y + 70); else fb.half(main, 9, x + 38, y + 70); }
      if (me.line) { if (me.special === 10) fb.opaque(main, 10, x + 38, y + 104); else fb.half(main, 10, x + 38, y + 104); }
    }
    if (dg) {
      if (!me.fullFire) fb.opaque(dg, Math.min(9, me.fire), x + 22, y + 16);
      fb.opaque(dg, Math.min(9, me.speedBase), x + 22, y + 51);   // +0x14b: not the speed-up
      fb.opaque(dg, Math.min(9, me.bombs), x + 22, y + 86);
    }
    const rec = this.slots.get(me.id) || [];
    rec.forEach((e, k) => {
      const sx = bx + SLOT_XY[k][0], sy = by + SLOT_XY[k][1];
      if (e.id > 0 && e.n > 0) {
        const ic = s.icon[e.id];
        if (ic) fb.opaque(ic.r, 0, sx, sy);
        fb.text(sx + 1, sy + 1, "QWAS"[k], 0xffff, 0);
      }
      if (e.n > 1 && dg) {
        const t = String(Math.min(99, e.n));
        if (t.length === 1) fb.opaque(dg, +t, sx + 20, sy + 15);
        else { fb.opaque(dg, +t[0], sx + 10, sy + 15); fb.opaque(dg, +t[1], sx + 20, sy + 15); }
      }
    });
    if (this.pending >= 0 && s.select) {
      fb.opaque(s.select.r, 0, bx + SLOT_XY[this.pending][0], by + SLOT_XY[this.pending][1]);
    }
    const txt = this.purse.toLocaleString("en-US"), n = txt.length;   // FUN_00426200: centred by length
    const shift = n < 3 ? 30 : n < 5 ? 24 : n < 7 ? 18 : n < 9 ? 12 : n < 11 ? 6 : 0;
    fb.text(710 + shift, 300, txt, 0xffe0, 0);
    return true;
  }
}
