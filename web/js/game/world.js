// The play field: map grid, players, bombs, flames, items, pressure blocks; server events and the
// requests the local player sends (docs/client/G_player.md, H_objects.md, protocol D_ingame.md).

import { Writer, Reader } from "../net/codec.js";
import { W, H, layout, spawnTile, isArena } from "./mapdata.js";
import { Player, speedCap } from "./player.js";
import { Block, Bomb, Marker, Explosion, Item, DIRS, T_FLOOR, T_ITEM, T_BOMB, T_SOFT, T_HARD, T_BORDER,
  T_BURNING, T_KEEP, T_ITEM_BURNING, K_FLAME, K_SOFT, K_ITEM, K_CENTRE, K_BURNING, K_CHAIN, ticks } from "./objects.js";
import { sfx, sfxRemote, sfxLoop, stop as stopSound } from "./sound.js";
import { Gimmicks } from "./gimmicks.js";
import { Hyper, MODE_HYPER, PART } from "./hyper.js";
import { Panel, MODE_PANEL } from "./panel.js";
import { Boss, MODE_BOSS } from "./boss.js";
import { DropStage, isDropStage } from "./dropstage.js";
import { BossItems } from "./bossitems.js";

const NIB_TO_TILE = { 0: T_FLOOR, 1: T_SOFT, 2: T_HARD, 9: T_BORDER };
const MODE_DROP = 3;                         // Drop Bomb (server extension): Battle, but bombs only fall from the sky

export class World {
  constructor(match, entries) {
    this.match = match;
    this.mapSet = match.mapSet;
    this.variant = match.variant;
    this.arena = isArena();                  // a web-only arena of a room of 12 (W x H from the server)
    this.stepMs = 20;
    this.clock = 0;                          // ms of game time stepped (in 0x66 for the server's checks: anticheat.py)
    this.grid = new Uint8Array(W * H);
    this.mode = match.mode || 0;             // DAT_0050ebf4: 0 Battle, 2 Hyper Bomb
    this.hyper = this.mode === MODE_HYPER ? new Hyper(this) : null;
    this.drop = this.mode === MODE_DROP;
    this.stage = this.drop && isDropStage(this.mapSet) ? new DropStage(this) : null;   // Grand Blue / Matrix
    this.boss = this.mode === MODE_BOSS ? new Boss(this) : null;   // Boss Battle (server extension, boss.js)
    this.bossItems = this.boss ? new BossItems(this) : null;      // ... its item slots and coins (bossitems.js)
    this.players = entries.map((e, i) => new Player(this, e, i));
    this.me = this.players.find((p) => p.id === match.myId) || null;
    this.training = match.training;          // a training (training.js): whoever dies comes back at their start
    this.bots = this.players.filter((p) => p.bot);   // ... and its bots, which this page plays (bot.js)
    this.panel = this.mode === MODE_PANEL ? new Panel(this) : null;
    this.gimmicks = new Gimmicks(this);
    this.blocks = new Map();
    this.bombs = [];
    this.markers = [];
    this.explosions = [];
    this.items = new Map();
    this.walker = null;
    this.nextLine = null;                   // a 0x85 line that came before the previous one ended
    this.hurry = false;
    this.animA = 0; this.animAT = 0;        // app+0xf9: random-map block frame (0..2, 150 ms)
    this.animB = 0; this.animBT = 0;        // app+0xfb: random-map background phase (0..3, 100 ms)
  }

  load() { return Promise.all(this.players.map((p) => p.load())); }

  // the look of the blocks and of the map's picture (render.js): its map set's, or a custom map's theme
  get design() { return this.match.custom ? this.match.custom.theme : this.mapSet % 9; }

  // ------------------------------------------------------------------ map
  loadRound(mapSet, variant, record = null) {
    this.mapSet = mapSet;
    this.variant = variant;
    const g = layout(mapSet, variant, record);
    this.blocks.clear();
    const design = this.design;
    for (let i = 0; i < W * H; i++) this.grid[i] = NIB_TO_TILE[g[i]] ?? T_FLOOR;
    this.gimmicks.load(mapSet);             // FUN_0041b200: after the grid, before the blocks and the players
    const hy = this.hyper, pa = this.panel;
    const softKinds = hy && hy.theme && hy.theme.soft ? hy.theme.soft.n : 2;
    let pillar = 0;
    const paSoft = pa && pa.theme && pa.theme.soft ? pa.theme.soft.n : ({ 29: 2, 30: 4, 35: 2 }[mapSet] || 1);
    for (let i = 0; i < W * H && !this.boss; i++) {   // (the caves' hard tiles are pits painted in Back01)
      const t = this.grid[i], x = i % W, y = Math.floor(i / W);
      if (t !== T_SOFT && t !== T_HARD) continue;
      let v = 0;                                    // FUN_0040f7b0: block variants
      if (hy) {
        // the ring c 1/15, r 1/13 is painted in Back01, and the drills stand on their own hard tiles
        if (t === T_HARD && (x === 1 || x === 15 || y === 1 || y === 13 || this.gimmicks.drills.some((d) => d.x === x && d.y === y))) continue;
        if (t === T_SOFT && mapSet === 40) v = Math.floor(Math.random() * softKinds);
      } else if (this.stage) {
        // Drop Bomb stages: the hard ring round the 13x9 field is the frame of the picture; v = the pillar's place
        if (x <= 1 || x >= W - 2 || y <= 2 || y >= H - 3) continue;
        v = pillar++;
      } else if (pa) {                              // Space / Factory / Airport soft blocks, Circus / Boxing corners
        if (t === T_SOFT && (mapSet === 29 || mapSet === 30 || mapSet === 35)) v = Math.floor(Math.random() * paSoft);
        if (t === T_HARD && mapSet === 28 && (x === 2 || x === 14) && (y === 2 || y === 12)) v = 1;
        if (t === T_HARD && mapSet === 34 && (x === 4 || x === 12) && (y === 4 || y === 10)) v = 1;
      } else if (t === T_HARD && mapSet < 27) {
        if (design === 4) v = Math.floor(Math.random() * 3);
        else if (design === 7) v = Math.floor(Math.random() * 2);
      }
      const blk = new Block(x, y, t === T_SOFT ? 0 : 1, t === T_HARD ? v : 0);
      if (t === T_SOFT) blk.vSoft = v;
      this.blocks.set(i, blk);
    }
    if (hy) hy.reset();
    if (pa) pa.reset();                     // FUN_00410330, after the blocks
    if (this.boss) this.boss.reset();       // KR FUN_0046fc70 -> FUN_00471740
    if (this.stage) this.stage.reset();
    this.bombs = [];
    this.markers = [];
    this.explosions = [];
    this.items.clear();
    this.walker = null;
    this.nextLine = null;                   // a 0x85 line that came before the previous one ended
    this.hurry = false;
    for (const p of this.players) {
      p.resetStats(mapSet);
      p.state = 1;
      p.wonThisRound = 0;
    }
    stopSound("SetSkull");
  }

  tile(x, y) { return x >= 0 && x < W && y >= 0 && y < H ? this.grid[y * W + x] : T_BORDER; }
  setTile(x, y, v) { if (x >= 0 && x < W && y >= 0 && y < H) this.grid[y * W + x] = v; }
  player(id) { return this.players.find((p) => p.id === id && p.active); }
  playerAny(id) { return this.players.find((p) => p.id === id); }
  bombById(id) { return this.bombs.find((b) => b.alive && b.id === id); }
  staticBombAt(x, y) { return this.bombs.find((b) => b.alive && b.x === x && b.y === y && (b.state === 0 || b.state === 4) && !b.kick && !b.throwing); }
  itemAt(x, y) { return this.items.get(y * W + x); }
  markerAt(x, y) { return this.markers.some((m) => m.x === x && m.y === y); }
  pendingCount() { return this.markers.length; }
  playersOn(x, y) { return this.players.filter((p) => p.active && !p.out && p.state !== 8 && p.tx === x && p.ty === y); }
  remotePlayerAt(x, y, me) { return this.players.some((p) => p !== me && p.active && p.state !== 8 && p.tx === x && p.ty === y); }
  playerIn(x, y) {                                   // FUN_00408650
    const l = 40 * x + 40, t = 38 * y + 28;
    return this.players.some((p) => p.active && p.state !== 8 && p.tx === x && p.ty === y
      && p.right >= l && p.left < l + 40 && p.bottom >= t && p.top < t + 38);
  }
  slideLimit() {
    const d = this.me ? this.me.disease : 0;
    return (d & 0x80) ? 999 : (d & 0x100) ? 5999 : 2699;
  }

  // Map gimmicks (docs/client/J_gimmicks.md)
  gimmickSpeedMod(p, v) { return this.gimmicks.speedMod(p, v); }
  tileTriggers(p) { this.gimmicks.tileTriggers(p); }
  standPush(p, dt) { this.gimmicks.standPush(p, dt); }
  // tiles where the bomb key does nothing: warps, border pads, Soccer goals
  warpAt(x, y) { const g = this.gimmicks; return g.warpIndexAt(x, y) >= 0 || g.padAt(x, y) >= 0 || g.goalAt(x, y); }
  overlayAt(x, y) { return this.gimmicks.overlayAt(x, y); }

  sendWarp(p) {                                      // 0x7b relayed to the other players
    this.match.conn.sendRelay(new Writer(9).u8(0x7b).u16(p.id).i16(Math.trunc(p.X)).i16(Math.trunc(p.Y))
      .u8(7).u8(p.warpDest < 0 ? 0xff : p.warpDest).done());
  }

  // ------------------------------------------------------------------ per tick (FUN_0041a2d0 order)
  update(dt, playing) {
    const m = this.match, input = m.input;
    this.clock += dt;
    for (const p of this.players) if (p.active) p.walkClock(dt);
    const me = this.me;
    if (playing && me && me.active && m.phase === 0 && !me.kickFreeze && me.jump < 0) {
      me.localUpdate(dt, input, m.hud.inputBlocked());
      if (this.bossItems && !m.hud.inputBlocked()) this.bossItems.keys(me, input);   // Q W A S (FUN_0041fe20)
    }
    for (const b of this.bots) {             // with the keys their heads press (bot.js)
      if (playing && b.active && m.phase === 0 && !b.kickFreeze && b.jump < 0) b.localUpdate(dt, b.brain, false);
    }
    // FUN_00420f20: state animations (+ revenge-cart revives), pickups, objects
    for (const p of this.players) {
      if (!p.active) continue;
      p.animate(dt);
      if (p.reviveVictim !== -1) this.reviveCheck(p);
      if ((this.hyper || this.panel || this.training) && p.out && p.respawn && p.state === 8) this.respawn(p);
      if (p.rebirthAt && p.out && p.state === 8) this.reborn(p);
    }
    if (me && playing && m.phase === 0) this.pickup(me);
    if (playing && m.phase === 0) for (const b of this.bots) if (b.active) this.pickup(b);
    this.animA = (this.animA + ticks(this, "animAT", dt, 150)) % 3;
    this.animB = (this.animB + ticks(this, "animBT", dt, 100)) % 4;
    for (const b of this.bombs) if (b.alive) b.animate(dt);
    for (const mk of this.markers) mk.animate(dt);
    for (const it of this.items.values()) it.animate(dt);
    if (this.hyper) this.hyper.update(dt);
    if (this.panel) this.panel.update(dt);
    for (const e of this.explosions) e.animate(dt);
    if (this.explosions.some((e) => e.done)) this.freeExplosions();
    this.walkerUpdate(dt);
    this.gimmicks.update(dt);
    if (this.boss) this.boss.update(dt);     // KR FUN_004700a0, at the end of FUN_0041f5e0
    if (this.stage) this.stage.update(dt);
    if (this.bossItems) this.bossItems.update(dt);
    // FUN_00420b40: moving bombs, flame hits
    for (const b of this.bombs) {
      if (!b.alive) continue;
      if (b.state === 1) b.slide(dt);
      else if (b.state === 2) b.fly(dt);
    }
    if (me && playing && m.phase === 0) {
      this.diseaseContact(me);
      if (me.hasMount && me.jump > 0) me.jumpStep(dt);
      this.hitTest(me);
      if (this.boss) this.boss.contact(me, dt);   // KR FUN_0041f300
    }
    for (const b of this.bots) {
      if (!b.active || !playing || m.phase !== 0) continue;
      this.diseaseContact(b);
      if (b.hasMount && b.jump > 0) b.jumpStep(dt);
      this.hitTest(b);
    }
    if (me && me.sick) sfxLoop("SetSkull"); else stopSound("SetSkull");
    for (const p of this.players) if (p.active && !p.local) p.remoteUpdate(dt);
    this.bombs = this.bombs.filter((b) => b.alive);
  }

  diseaseContact(me) {                               // FUN_0042a3b0: once per pair, at most one per tick
    if (me.inCart || me.out || me.state === 5 || me.state === 8) return;
    for (const o of this.players) {
      if (o === me || !o.active || o.out || o.state === 5 || o.inCart || me.contact.has(o.id)) continue;
      const touch = (o.tx === me.tx && o.ty === me.ty) || (o.tx === me.restTx && o.ty === me.restTy);
      if (!touch || o.disease === me.disease) continue;
      this.send(new Writer(9).u8(0x89).i16(me.id).i16(o.id).u16(0x63).u16(0x63).done());
      me.contact.add(o.id);
      return;
    }
  }

  landed(me) {                                       // end of a Louie jump: pickup, then FUN_00426f60
    this.pickup(me);
    const blk = this.blocks.get(me.ty * W + me.tx);
    if (blk && blk.pressure && me.state !== 5 && me.state !== 8) {
      me.hasMount = false; me.mount = -1; me.dismountBlink = false; me.reviveBlink = false;
      this.localDied(me, -1);
    }
  }

  pickup(me) {                                       // FUN_00426d80
    if (me.state === 5 || me.state === 8 || me.out || me.jump >= 1 || me.noPickup) return;
    if (this.hyper && this.hyper.catchFlying(me)) return;
    const it = this.itemAt(me.tx, me.ty);
    if (!it || it.hidden || this.tile(me.tx, me.ty) !== T_ITEM) return;
    if (this.bossItems && this.bossItems.pickup(me, it)) return;   // a coin or a money bag: 0xe5 / 0xe8
    sfx("GetItem");
    it.hidden = true;
    this.send(new Writer(8).u8(0x6d).i16(me.id).u8(me.tx).u8(me.ty).u8(0x63).u16(0x63).done());
  }

  hitTest(me) {                                      // FUN_0040caa0
    if (me.hitReported || [5, 7, 8].includes(me.state) || me.out || me.jump >= 1) return;
    if (this.hyper && this.hyper.safe(me)) return;     // on the goal with the parts: no death, no lost mount
    const i = me.ty * W + me.tx;
    for (const e of this.explosions) {
      if (!e.deadly) continue;
      const v = e.kind[i];
      if (v === 0 || v >= 5) continue;
      if (me.hasMount && !me.dismountBlink) {
        if (me.vulnerable && !me.rideHitSent) { me.rideHitSent = true; this.send(new Writer(3).u8(0xa3).i16(me.id).done()); }
        return;
      }
      if (me.dismountBlink || me.reviveBlink || !me.vulnerable) return;
      this.localDied(me, this.hurry ? -1 : e.owner[i]);
      return;
    }
  }

  localDied(me, killer = -1) {
    if (this.hyper && this.hyper.safe(me)) return;   // on the goal with the parts: the round is theirs
    me.autoWalk = false;
    me.state = 5; me.frame = 0; me.frame2 = 0; me.hold = 0; me.stateT = 0;
    me.hitReported = true;
    this.send(new Writer(7).u8(0x6b).i16(me.id).u8(me.tx).u8(me.ty).i16(killer).done());
  }

  // ------------------------------------------------------------------ requests
  send(pkt) { if (!this.match.watching) this.match.conn.sendGame(pkt); }     // (a game master watching sends nothing)

  // FUN_0042a4f0: the client of the lowest spawn index reports landed items (0xad)
  isMaster() {
    const live = this.players.filter((p) => p.active).sort((a, b) => a.spawnIdx - b.spawnIdx);
    return live.length > 0 && live[0].local;
  }

  sendMove(p, state = p.state) {                     // 0x66 relayed (frame type 4)
    if (state < 0x1e) { p.sentState = state; p.sentDir = p.dir; }
    // + u32 game ms (server extension): the server checks the move against the time it took and cuts it off
    const pkt = new Writer(14).u8(0x66).u16(p.id).i16(Math.trunc(p.X)).i16(Math.trunc(p.Y))
      .u8(p.dir).u8(state).u8(p.frame & 0xff).u32(Math.trunc(this.clock)).done();
    this.match.conn.sendRelay(pkt);
  }

  sendCart(p) {                                      // 0x87 relayed: revenge cart position (FUN_00432490)
    p.sentCart = p.cartSide * 8 + p.cartAnim;
    this.match.conn.sendRelay(new Writer(9).u8(0x87).u16(p.id).i16(Math.trunc(p.cartX)).i16(Math.trunc(p.cartY))
      .u8(p.cartSide).u8(p.cartAnim).done());
  }

  cartBombRequest(p, x, y) {                         // 0x67 from the cart: no marker, no sound
    this.send(new Writer(9).u8(0x67).u16(0xffff).i16(p.id).u8(x).u8(y).u8(0x63).u8(p.bombKind).done());
  }

  placeBombRequest(p, x, y) {
    if (this.drop) return;                           // Drop Bomb: nobody places bombs (the server would refuse)
    this.markers.push(new Marker(x, y, p.bombKind));
    sfx("TakeDown");
    this.send(new Writer(9).u8(0x67).u16(0xffff).i16(p.id).u8(x).u8(y).u8(0x63).u8(p.bombKind).done());
  }

  lineBombRequest(p, tiles) {
    if (this.drop) return;
    for (const [x, y] of tiles) this.markers.push(new Marker(x, y, p.bombKind));
    const w = new Writer(25).u8(0x8c).i16(p.id).u8(p.dir).u8(tiles.length);
    for (let i = 0; i < 8; i++) w.i16(-1);
    w.u8(tiles[0][0]).u8(tiles[0][1]).u8(0x63).u8(p.bombKind);
    sfx("TakeDown");
    this.send(w.done());
  }

  sendKick(b, p, dir) {
    this.send(new Writer(12).u8(0x71).i16(b.id).i16(p.id).u8(b.x).u8(b.y).u8(dir).u16(0xffff).u8(b.kind).u8(0x63).done());
  }
  sendThrow(b, p, dir) {
    this.send(new Writer(10).u8(0x76).i16(b.id).i16(p.id).u8(b.x).u8(b.y).u8(dir).u8(b.kind).u8(0x63).done());
  }
  // The local glove throw (player.js grab): the bomb flies here at once, as on a LAN, not a round trip later; the
  // server's 0x77 then only confirms it (or, refused, puts it back: onFlight). The others see it with that 0x77.
  throwBomb(b, p, dir) {
    b.throwing = 1;
    this.sendThrow(b, p, dir);
    if (this.tile(b.x, b.y) === T_BOMB) this.setTile(b.x, b.y, T_FLOOR);
    b.thrower = p.id; b.punch = false; b.early = true;
    b.startFlight(dir, 5);
  }
  sendPunch(b, p, dir) {
    this.send(new Writer(10).u8(0x8e).i16(b.id).i16(p.id).u8(b.x).u8(b.y).u8(dir).u8(b.kind).u8(0x63).done());
  }
  itemDestroyedByBomb(x, y) {                        // 0x6d with id -1 (server dedups)
    if (this.bossItems && this.bossItems.bombOver(this.itemAt(x, y))) return;   // coins: 0xe5 / 0xe8 with id -1
    this.send(new Writer(8).u8(0x6d).u16(0xffff).u8(x).u8(y).u8(0x63).u16(0x63).done());
  }

  slideStopped(b) {                                  // FUN_00433840 -> 0x73 (kicker only: a player this page plays)
    const k = this.player(b.kicker);
    if (k && k.local) {
      this.send(new Writer(12).u8(0x73).i16(b.id).i16(k.id).u8(b.x).u8(b.y).u8(b.kind)
        .i16(b.token || 0).u8(0x63).u8(b.dir).done());
    }
  }

  flightLanded(b) {
    const t = this.player(b.thrower);
    if (t && t.local) {
      b.throwing = 0;
      this.send(new Writer(9).u8(b.punch ? 0x90 : 0x78).i16(b.id).i16(t.id).u8(b.x).u8(b.y).u8(b.kind).u8(0x63).done());
      b.flySub = 3;
    }
  }

  // ------------------------------------------------------------------ server events
  event(op, pkt) {
    if (this.gimmicks.event(op, pkt)) return;
    if (this.boss && op >= 0xd2 && op <= 0xdc) return this.boss.event(op, pkt);
    if (this.bossItems && op >= 0xdd && op <= 0xe9 && this.bossItems.event(op, pkt)) return;
    const r = new Reader(pkt);
    switch (op) {
      case 0x68: return this.onBombPlaced(r.i16(1), r.i16(3), pkt[5], pkt[6], pkt[7], pkt[8]);
      case 0x69: return this.onExplosion(pkt);
      case 0x6a: return this.onItems(pkt);
      case 0x6c: return this.onDeath(r.i16(1), pkt[3], pkt[4], r.i16(5), pkt[7], pkt[8]);
      case 0x6e: return this.onItemEffect(r.i16(1), pkt[3], pkt[4], pkt[5], r.i16(6));
      case 0x72: return this.onKick(r.i16(1), r.i16(3), pkt[5], pkt[6], pkt[7], r.i16(8), pkt[11]);
      case 0x74: return this.onSlideEnd(r.i16(1), pkt[5], pkt[6], pkt[7], pkt[10], pkt[11]);
      case 0x77: return this.onFlight(r.i16(1), r.i16(3), pkt[5], pkt[6], pkt[7], pkt[8], pkt[9], false);
      case 0x8f: return this.onFlight(r.i16(1), r.i16(3), pkt[5], pkt[6], pkt[7], pkt[8], pkt[9], true);
      case 0x79: case 0x91: return this.onLanding(r.i16(1), pkt[5], pkt[6], pkt[7], pkt[8]);
      case 0x83: return this.spawn(pkt);
      case 0x85: return this.onPressureLine(pkt[1], pkt[2], pkt[3], pkt[4]);
      case 0x88: return this.setDisease(r.i16(1), r.u16(3));
      case 0x8a: {
        const a = this.player(r.i16(1)), b = this.player(r.i16(3));
        if (a) this.setDisease(a.id, r.u16(5) | r.u16(7));
        if (b) this.setDisease(b.id, r.u16(5) | r.u16(7));
        if ((a && a.local) || (b && b.local)) sfx("InfectSkull");
        if (a && b) { a.contact.delete(b.id); b.contact.delete(a.id); }
        return;
      }
      case 0x8d: return this.onLineBomb(pkt);
      case 0x95: return;
      case 0x98: return this.onSkyBomb(r.i16(1), pkt[3], pkt[4]);
      case 0xa2: { const p = this.player(r.i16(1)); if (p) p.vulnerable = true; return; }
      case 0xa4: {
        const p = this.player(r.i16(1));
        if (p) { p.hasMount = false; p.mount = -1; p.dismountBlink = true; p.blinkTotal = 0; p.rideHitSent = false; }
        return;
      }
      case 0xaa: if (this.hyper) this.hyper.onFlyingItems(pkt); return;
      case 0xca: case 0xcb: if (this.panel) this.panel.event(op, pkt); return;
      case 0xac: if (this.hyper) this.hyper.onGoalResult(r.i16(1), (pkt[3] << 24) >> 24); return;
    }
  }

  // Back in the middle of a round to watch it (the server's rejoin.py: 0x8c9 and h_game Match.snapshot): what the
  // round's events made of its layout so far, laid over it; the events after it come as they do for everyone. False
  // when it is not this field.
  applySnapshot(s) {
    if (s.w !== W || s.h !== H) return false;
    if (s.hurry) this.hurry = true;                 // (0x84: no revenge carts any more)
    for (let i = 0; i < W * H; i++) {
      const t = NIB_TO_TILE[s.cells[i]] ?? T_FLOOR, was = this.grid[i];
      if (t === T_FLOOR && was === T_SOFT) { this.blocks.delete(i); this.grid[i] = T_FLOOR; }   // blown up
      else if (t === T_HARD && was !== T_HARD && was !== T_BORDER) {                         // a HURRY UP block
        const blk = new Block(i % W, Math.floor(i / W), 1);
        blk.pressure = true;
        this.blocks.set(i, blk);
        this.grid[i] = T_HARD;
      }
    }
    for (const { x, y, type } of s.items) {
      if (this.tile(x, y) !== T_FLOOR || type > 13) continue;
      const it = new Item(x, y, type);
      it.state = 1; it.wait = false; it.effOn = false;   // (lying there already: no appearing)
      this.items.set(y * W + x, it);
      this.setTile(x, y, T_ITEM);
    }
    for (const b of s.bombs) {
      if (this.bombById(b.id)) continue;
      const bomb = new Bomb(this, b.id, b.owner, b.x, b.y, Math.min(15, b.power), b.kind);
      if (b.air > 0) bomb.skyH = Math.min(300, Math.round(b.air / 40) * 10);   // a sky bomb still falling
      else bomb.state = 0;
      const t = this.tile(b.x, b.y);
      if (t === T_FLOOR && !b.air) this.setTile(b.x, b.y, T_BOMB);
      else if (t === T_BORDER) { bomb.onBorder = true; bomb.misobon = true; }   // a revenge cart's
      this.bombs.push(bomb);
    }
    for (const q of s.players) {
      const p = this.playerAny(q.id);
      if (!p || !p.active || p.local) continue;
      p.resetStats(this.mapSet);
      p.spawnAt(q.x, q.y);
      if (!q.alive) {                               // out of the round: as at the end of its death (player.js)
        p.out = true;
        p.enterCart();
        p.state = 8;
        if (q.cart) p.applyCart(q.cart);
        continue;
      }
      if (q.mount >= 0 && q.mount <= 3) { p.mount = q.mount; p.hasMount = true; }
      if (q.move) p.applyRelay(q.move);             // (where its last 0x66 put it)
    }
    const g = this.gimmicks, pkt = (...b) => new Uint8Array(b);
    for (let k = 0; k < (s.arrows & 3); k++) g.event(0x86, pkt(0x86, 0));
    if (s.switches & 1) g.event(0x97, pkt(0x97, 0));
    if (g.sand.length) g.event(0x99, pkt(0x99, s.sand));
    for (const c of s.ice) {
      g.event(0x9b, pkt(0x9b, c.x, c.y, 0));
      if (c.broken) g.event(0x9b, pkt(0x9b, c.x, c.y, 1));
    }
    return true;
  }

  relayed(op, pkt) {
    if (op === 0x66) {
      const p = this.player(new Reader(pkt).u16(1));
      if (p && !p.local) p.applyRelay(pkt);
    } else if (op === 0x7b) {
      const p = this.player(new Reader(pkt).u16(1));
      if (p && !p.local) p.applyWarp(pkt);
    } else if (op === 0x87) {
      const p = this.player(new Reader(pkt).u16(1));
      if (p && !p.local) p.applyCart(pkt);
    }
  }

  playerLeft(id) {                                   // 0x7da
    for (const b of this.bombs) {
      if ((b.state === 1 && b.kicker === id) || (b.state === 2 && b.thrower === id)) this.removeBomb(b);
    }
    const p = this.playerAny(id);
    if (p) p.active = false;
  }

  spawn(pkt) {                                       // 0x83 (FUN_00434740)
    const p = this.playerAny(new Reader(pkt).i16(1));
    if (!p) return;
    let t = pkt[3] !== 0xff ? spawnTile(this.mapSet, pkt[3]) : null;
    if (!t) t = [pkt[4], pkt[5]];
    if (pkt[3] !== 0xff) p.spawnIdx = pkt[3];          // +0x6f8
    p.resetStats(this.mapSet);
    p.spawnAt(t[0], t[1]);
  }

  roundStart() {                                     // 0x7f: local players rise out of the floor
    for (const p of this.players) {
      if (!p.active) continue;
      p.hitReported = false;
      if (p.local) { p.state = 7; p.introRise = true; p.frame = Math.max(0, p.frames(22) - 1); p.stateT = 0; }
    }
  }

  introDone() {
    for (const p of this.players) if (p.local && p.active) { p.state = 1; p.frame = 0; p.introRise = false; }
  }

  roundOver() {
    for (const p of this.players) p.overlays.forEach((o, k) => { if (k !== 0) o.on = false; });
    if (this.boss) this.boss.roundEnd();
  }

  hurryUp() {                                        // 0x84 (FUN_00434990): every revenge cart is gone
    this.hurry = true;
    for (const p of this.players) p.inCart = false;
  }

  respawn(p) {                                       // FUN_00420f20, modes 1/2: back at the spawn point
    p.spawnAt(p.respawn[0], p.respawn[1]);
    p.respawn = null;
    p.reviveBlink = true;                            // +0x1bd: blinking and invulnerable
    p.state = 1;
    if (p.local) this.sendMove(p);                   // FUN_00424eb0 -> 0x66
    if (p === this.me) {                             // "revived" (no banner outside Battle)
      this.match.hud.revived(0);
      sfx("Revive");
    }
  }

  reborn(p) {                                        // Boss Battle Rebirth (0xe3): back on the reviver's tile
    p.spawnAt(p.rebirthAt[0], p.rebirthAt[1]);
    p.rebirthAt = null;
    p.reviveBlink = true;                            // +0x1e6: 2.5 s blink, invulnerable
    p.state = 1;
    if (p.local) {
      this.sendMove(p);
      this.match.hud.revived(0);
      sfx("Revive");
    }
  }

  reviveCheck(p) {                                   // FUN_00420f20: the cart player takes the victim's place
    const v = this.players.find((q) => q.active && q.id === p.reviveVictim);
    if (!v || v.state !== 8) return;
    p.spawnAt(p.reviveX, p.reviveY);
    p.reviveBlink = true;                            // 2.5 s blink, invulnerable
    p.state = 1;
    // (the exe's "YOU REVIVE" banner and Revive.wav never play: spawnAt clears the id they test first)
  }

  onBombPlaced(id, owner, x, y, power, kind) {       // 0x68 (FUN_00432820 / FUN_0040e5c0)
    this.markers = this.markers.filter((m) => !(m.x === x && m.y === y));
    if (id < 0 || kind > 2) return;
    const o = this.player(owner);
    const t = this.tile(x, y), pad = this.gimmicks.padAt(x, y) >= 0;
    if (t === T_FLOOR && !pad) {
      const on = this.playersOn(x, y);
      for (const p of on) { p.bombOK = true; p.bombX = x; p.bombY = y; }
      if (o && !o.local && on.length) sfxRemote("TakeDown");
      const b = new Bomb(this, id, owner, x, y, power, kind);
      this.bombs.push(b);
      this.setTile(x, y, T_BOMB);
      if (o) o.placed++;
      if (o && o.local) {
        this.sendMove(o, 0x20);
        const g = o.grabAt;                          // the glove key came first (player.js bombKey): throw it now
        o.grabAt = null;
        if (g && g[0] === x && g[1] === y && o.tx === x && o.ty === y) o.grab();
      }
    } else if (t === T_BORDER || pad) {              // misobon cart bomb: thrown inwards by its owner
      const b = new Bomb(this, id, owner, x, y, power, kind);
      b.onBorder = true; b.misobon = true;
      this.bombs.push(b);
      if (o) o.cartBombs++;
      if (o && o.local) {
        const dir = x === 0 ? 3 : y === 0 ? 0 : x === W - 1 ? 1 : 2;
        b.throwing = 1;
        this.sendThrow(b, o, dir);
      }
    }
  }

  removeBomb(b) {                                    // FUN_0040ea10
    if (!b.alive) return;
    b.alive = false;
    const o = b.special ? null : this.player(b.owner);   // (an item's bomb is not one of its owner's)
    if (o) { if (o.cartBombs > 1) o.cartBombs--; else if (o.placed > 1) o.placed--; }
    if (!b.onBorder && this.tile(b.x, b.y) === T_BOMB) this.setTile(b.x, b.y, T_FLOOR);
  }

  onExplosion(pkt) {                                 // 0x69 (FUN_00432920)
    if (this.match.phase === 1 || this.match.phase === 2) return;
    const n = Math.floor(pkt.length / 7);
    const r = new Reader(pkt);
    const first = this.bombById(r.i16(1));
    if (!first) return;                              // (the original would corrupt memory)
    if (this.boss) {                                 // KR FUN_004361a0: [6] of each record is that bomb's fire
      first.power = Math.min(15, pkt[6]);
      for (let k = 1; k < n; k++) { const o = this.bombById(r.i16(7 * k + 1)); if (o) o.power = Math.min(15, pkt[7 * k + 6]); }
    }
    const E = new Explosion();
    this.gimmicks.tunnelFlash(first.x, first.y);
    for (let k = 1; k < n; k++) {
      const x = pkt[7 * k + 3], y = pkt[7 * k + 4];
      if (x < W && y < H) E.kind[y * W + x] = K_CHAIN;
      this.gimmicks.tunnelFlash(x, y);
    }
    first.chainDone = true;
    this.explode(first, E);
    let again = true;
    while (again) {
      again = false;
      for (const o of this.bombs) {
        if (o.alive && o.hit && !o.chainDone) { this.explode(o, E); o.chainDone = true; again = true; }
      }
    }
    for (let i = 0; i < W * H; i++) {
      const x = i % W, y = Math.floor(i / W);
      switch (E.kind[i]) {
        case K_SOFT: this.blocks.delete(i); this.grid[i] = T_BURNING; E.kind[i] = K_BURNING; break;
        case K_ITEM: this.items.delete(i); this.grid[i] = T_FLOOR; break;
        case K_CENTRE: case K_CHAIN: {
          for (const b of this.bombs) if (b.alive && b.x === x && b.y === y && b.state !== 2) this.removeBomb(b);
          if (this.grid[i] !== T_KEEP && this.grid[i] !== T_BURNING) this.grid[i] = T_FLOOR;
          break;
        }
      }
    }
    E.computePieces();
    this.explosions.push(E);
    if (this.explosions.length > 50) this.explosions.shift();
  }

  explode(b, E) {                                    // FUN_00407ef0
    sfx("Bomb");
    b.state = 3;
    b.frame = 0;
    this.traceFlames(b, E);
  }

  traceFlames(b, E) {                                // FUN_00409380
    const at = (x, y) => y * W + x;
    const by = b.kind <= 2 ? b.owner : -1;          // a player's bomb: its fire in that player's bomb skin
    E.kind[at(b.x, b.y)] = K_CENTRE;
    E.by[at(b.x, b.y)] = by;
    if (b.misobon) E.owner[at(b.x, b.y)] = b.owner;
    const pa = this.panel;                          // mode 1: the fire paints in the owner's colour
    if (pa) pa.paint(b.x, b.y, b.owner);
    const mark = (i) => { E.by[i] = by; if (b.misobon) E.owner[i] = b.owner; if (pa) pa.paint(i % W, Math.floor(i / W), b.owner); };
    for (let dir = 0; dir < 4; dir++) {
      const [dx, dy] = DIRS[dir];
      for (let s = 1; s <= b.power; s++) {
        const x = b.x + dx * s, y = b.y + dy * s;
        if (x < 0 || x >= W || y < 0 || y >= H) break;
        const i = at(x, y), t = this.grid[i], g = E.kind[i];
        if (t === T_BURNING) break;
        if (t === T_ITEM_BURNING) {
          const it = this.items.get(i);
          if (it && it.type === 13) this.grid[i] = T_ITEM;
          else { if (it) this.items.delete(i); this.grid[i] = T_BURNING; }
          break;
        }
        if (g === K_FLAME) { if (t === T_FLOOR) continue; break; }
        if ((g >= K_SOFT && g <= K_CENTRE) || g === K_BURNING) break;
        if (g === K_CHAIN) {
          const o = this.bombs.find((q) => q.alive && q.x === x && q.y === y && q.state !== 2 && q.state !== 3);
          if (o) { o.hit = true; o.frame = 0; if (b.misobon) E.owner[i] = b.owner; }
          break;
        }
        if (g !== 0) continue;
        if (t === T_FLOOR || t === T_KEEP) { E.kind[i] = K_FLAME; mark(i); continue; }
        if (t === T_ITEM) {
          const it = this.items.get(i);
          if (!it || it.type !== 13) { E.kind[i] = K_ITEM; mark(i); if (b.kind === 1) continue; }
          break;
        }
        if (t === T_SOFT) { E.kind[i] = K_SOFT; E.by[i] = by; if (b.misobon) E.owner[i] = b.owner; if (b.kind === 1) continue; break; }
        break;
      }
    }
  }

  freeExplosions() {                                 // FUN_004100b0
    const done = this.explosions.filter((e) => e.done);
    this.explosions = this.explosions.filter((e) => !e.done);
    for (const E of done) {
      for (let i = 0; i < W * H; i++) {
        if (E.kind[i] !== K_BURNING) continue;
        const falling = this.blocks.get(i);
        if (falling && falling.falling) continue;
        if (this.grid[i] === T_ITEM_BURNING) this.grid[i] = T_ITEM;
        else if (this.grid[i] === T_BURNING) this.grid[i] = T_FLOOR;
      }
    }
  }

  onItems(pkt) {                                     // 0x6a (FUN_00433080)
    const n = Math.min(125, pkt[1]);
    const r = new Reader(pkt);
    for (let k = 0; k < n; k++) {
      const type = r.i16(2 + 4 * k), x = pkt[4 + 4 * k], y = pkt[5 + 4 * k];
      if (type < 0 || type > 13 || this.tile(x, y) === T_HARD) continue;
      this.items.set(y * W + x, new Item(x, y, type));
      this.setTile(x, y, this.tile(x, y) === T_BURNING ? T_ITEM_BURNING : T_ITEM);
    }
  }

  onItemEffect(id, x, y, type, param) {              // 0x6e (FUN_004331e0 -> FUN_0042a5f0)
    const i = y * W + x;
    if (this.items.has(i)) {
      this.items.delete(i);
      if (this.grid[i] === T_ITEM || this.grid[i] === T_ITEM_BURNING) this.grid[i] = T_FLOOR;
    }
    if (type === PART && this.hyper) this.hyper.takeFlying(x, y);
    const p = id >= 0 ? this.player(id) : null;
    if (!p || p.state === 5 || p.state === 8) return;
    if (!p.local) { sfxRemote("GetItem"); if (type === 5) sfxRemote("Corpse"); }
    else if (type === 5) sfx("Corpse");
    const big = this.mapSet >= 9, cap = this.boss ? 4 : big ? 8 : 5;   // KR FUN_0042a360: fire and bombs 4 in a boss stage
    switch (type) {
      case 0: if (!p.fullFire) p.fire = Math.min(cap, p.fire + 1); break;
      case 1: p.speedBase = Math.min(speedCap(this.mapSet), p.speedBase + 1); if (!p.speedForced && !p.speedUp) p.speedLvl = p.speedBase; break;
      case 2: p.bombs = Math.min(cap, p.bombs + 1); break;
      case 3: p.kick = 1; break;
      case 4: p.glove = 1; break;
      case 5: this.setDisease(p.id, param); break;
      case 6: p.vulnerable = false; break;
      case 7: p.fire = 15; p.fullFire = 1; break;
      case 8: if (param >= 1 && param <= 4) { p.mount = param - 1; p.hasMount = true; } break;
      case 9: p.punch = 1; p.special = 9; break;
      case 10: p.line = 1; p.special = 10; break;
      case 11: p.bombKind = 1; break;
      case 12: p.bombKind = 2; break;
      case 13: p.parts++; break;                    // HyperBomb part (+0x135), no cap
    }
    const o = p.overlays[4];
    o.on = true; o.frame = 0; o.t = 0;
  }

  setDisease(id, mask) {                             // FUN_004274e0
    const p = this.player(id);
    if (!p) return;
    const wasSick = p.sick;
    p.disease = mask;
    p.sick = mask !== 0;
    if (mask & 1) { p.speedLvl = 0; p.speedForced = true; }
    else if (mask & 2) { p.speedLvl = 7; p.speedForced = true; }
    else { p.speedForced = false; p.speedLvl = p.speedUp ? 6 : p.speedBase; }
    if (!(mask & 8)) p.autoWalk = false;
    if (wasSick && !p.sick && p.local) sfx("FreeSkull");
  }

  onDeath(id, x, y, reviver, f, g) {                 // 0x6c (FUN_00432dd0)
    const p = this.playerAny(id);
    if (!p) return;
    if (g === 2) this.walkTo(x, y);
    p.state = 5; p.frame = 0; p.frame2 = 0; p.hold = 0; p.stateT = 0;
    p.resetStats(this.mapSet);
    p.hitReported = true;
    if (p.tx !== x || p.ty !== y) p.snapTo(x, y);
    sfxRemote("Death");
    if (this.hyper || this.training) {                // FUN_0045f170: [5..6] = 1 -> back at the own spawn point
      const t = reviver === 1 ? spawnTile(this.mapSet, p.spawnIdx) : null;
      p.respawn = t ? [t[0], t[1]] : null;
      return;
    }
    if (this.panel) {                                 // FUN_0045ffd0: always back, and the panels turn neutral
      const t = spawnTile(this.mapSet, p.spawnIdx);
      p.respawn = t ? [t[0], t[1]] : null;
      this.panel.wipe(id);
      return;
    }
    const r = reviver !== -1 ? this.player(reviver) : null;          // killed by a revenge cart
    if (r) { r.reviveVictim = id; r.reviveX = x; r.reviveY = y; }
  }

  onKick(id, kicker, x, y, dir, token, result) {     // 0x72 (FUN_004336a0)
    const b = this.bombById(id);
    if (!b || result !== 1) return;
    if (this.tile(b.x, b.y) === T_BOMB) this.setTile(b.x, b.y, T_FLOOR);
    b.snap(x, y);
    b.dir = dir; b.state = 1; b.kicker = kicker; b.kick = 2; b.slideT = token; b.token = token;
    const k = this.player(kicker);
    if (k && !k.local) k.state = 1;
  }

  onSlideEnd(id, x, y, kind, power, result) {        // 0x74 (FUN_004338e0)
    const b = this.bombById(id);
    if (!b) return;
    if (result === 1) {
      b.state = 0; b.frame = 0; b.kick = 0; b.snap(x, y); b.kind = kind; b.power = Math.min(15, power);
      b.inTunnel = !!this.gimmicks.tunnelAt(x, y);
      this.setTile(x, y, T_BOMB);
      for (const p of this.playersOn(x, y)) { p.bombOK = true; p.bombX = x; p.bombY = y; }
    } else if (result === 0) {
      b.alive = false;
      if (this.tile(b.x, b.y) < 3) this.setTile(b.x, b.y, T_FLOOR);
      const o = this.player(b.owner);
      if (o && o.placed > 1) o.placed--;
    }
  }

  onFlight(id, thrower, x, y, dir, kind, result, punch) {   // 0x77 / 0x8f
    const b = this.bombById(id);
    const t = this.player(thrower);
    if (b && t && t.local && b.early) {              // our glove throw, flying since the key (throwBomb)
      b.early = false;
      if (result !== 1 && b.state === 2) {           // the server said no: it lies where it has it
        b.state = 0; b.frame = 0; b.throwing = 0; b.flySub = 0; b.height = 0; b.bouncing = false; b.thrower = -1;
        b.snap(x, y);
        this.setTile(x, y, T_BOMB);
        for (const p of this.playersOn(x, y)) { p.bombOK = true; p.bombX = x; p.bombY = y; }
      }
      return;
    }
    if (!b || !t || result !== 1) return;
    if (this.tile(b.x, b.y) === T_BOMB) this.setTile(b.x, b.y, T_FLOOR);
    b.snap(x, y);
    b.thrower = thrower; b.punch = punch; b.kind = kind;
    const cart = !punch && (t.inCart || b.onBorder);   // FUN_00433d80: a cart throw leaves the rider in state 8
    const n = punch ? 3 : cart ? (this.mapSet < 9 ? 4 : 3) : 5;
    b.startFlight(dir, n);
    if (!t.local && !cart) { t.state = punch ? 3 : 2; t.frame = 0; t.hold = 0; }
  }

  onLanding(id, x, y, kind, result) {                // 0x79 / 0x91
    const b = this.bombById(id);
    if (!b) return;
    if (result === 1) {
      b.state = 0; b.frame = 0; b.throwing = 0; b.flySub = 0; b.onBorder = false;
      b.snap(x, y); b.kind = kind; b.height = 0;
      this.setTile(x, y, T_BOMB);
      this.stunPlayersOn(x, y);
    } else {
      b.bounceNext = false;
      b.flySub = 0;
      b.bounceOn();
    }
  }

  stunPlayersOn(x, y) {                              // FUN_0040ee90
    for (const p of this.playersOn(x, y)) {
      if ((p.state !== 0 && p.state !== 1) || p.hasMount || p.reviveBlink) continue;
      p.state = 4; p.frame = 0; p.stunned = true; p.stunT = 0;
      p.bombOK = true; p.bombX = x; p.bombY = y;
      sfx("Faint");
      if (p.local) this.send(new Writer(4).u8(0x94).i16(p.id).u8(0x63).done());
    }
  }

  onLineBomb(pkt) {                                  // 0x8d (FUN_00435630)
    const r = new Reader(pkt);
    const owner = r.i16(1), dir = pkt[3], count = Math.min(8, pkt[4]);
    const x0 = pkt[0x15], y0 = pkt[0x16], power = pkt[0x17], kind = pkt[0x18];
    const [dx, dy] = DIRS[dir & 3];
    for (let i = 0; i < count; i++) {
      const x = x0 + dx * i, y = y0 + dy * i;
      this.markers = this.markers.filter((m) => !(m.x === x && m.y === y));
      const id = r.i16(5 + 2 * i);
      if (id >= 0) this.onBombPlaced(id, owner, x, y, power, kind);
    }
  }

  onSkyBomb(id, x, y) {                              // 0x98 (FUN_0040ee20)
    if (this.bombs.some((b) => b.alive && b.x === x && b.y === y)) return;
    const b = new Bomb(this, id, -1, x, y, 15, 3);
    b.skyH = 300;
    this.bombs.push(b);
  }

  // Boss Battle 0xdb: an earth bomb (KR FUN_0040dfd0): power 0 until its 0x69, no owner; it destroys an item under it
  // and turns its tile into a bomb tile whatever was there
  earthBomb(id, x, y, kind) {
    if (this.bombs.filter((b) => b.alive).length >= 200) return;
    if (this.tile(x, y) === T_ITEM) this.items.delete(y * W + x);
    this.bombs.push(new Bomb(this, id, -1, x, y, 0, kind));
    this.setTile(x, y, T_BOMB);
  }

  moveEarthBomb(id, x, y) {                          // KR FUN_0040df40: in one step, no animation
    const b = this.bombById(id);
    if (!b) return;
    this.setTile(b.x, b.y, T_FLOOR);
    b.snap(x, y);
    this.setTile(x, y, T_BOMB);
  }

  skyBombLanded(b) {                                 // FUN_0040ee90
    this.setTile(b.x, b.y, T_BOMB);
    this.stunPlayersOn(b.x, b.y);
  }

  // ------------------------------------------------------------------ pressure blocks (0x85, FUN_00418750)
  // FUN_004349f0 lands what is left of the previous line at once. The server sends each line just as the previous
  // one should end here, so a line that comes a little early (network jitter, a slow frame) waits for the previous
  // one instead; only a line that falls a whole line behind is landed at once.
  onPressureLine(x, y, dir, count) {
    const line = { x, y, dir: dir & 3, count };
    if (!this.walker || !this.walker.active) return this.startLine(line, 0);
    if (this.nextLine) {
      while (this.walker.active) this.walkerStep();
      this.startLine(this.nextLine, 0);
      if (!this.walker.active) return this.startLine(line, 0);
    }
    this.nextLine = line;
  }

  startLine(line, t) {
    this.nextLine = null;
    this.walker = { ...line, t, active: line.count > 0 };
    if (line.count > 0) this.spawnFalling(line.x, line.y);
  }

  // 0x6c g = 2 (FUN_00432dd0): a block crushed the victim, land the line up to its tile. Only a tile still ahead:
  // stepping on to one the line has already passed would land the whole rest of the line at once.
  walkTo(x, y) {
    const ahead = (l) => {
      const [dx, dy] = DIRS[l.dir];
      for (let k = 0; k < l.count; k++) if (l.x + dx * k === x && l.y + dy * k === y) return true;
      return false;
    };
    const w = this.walker;
    if (!w || !w.active) return;
    if (!ahead(w)) {
      if (!this.nextLine || !ahead(this.nextLine)) return;
      while (w.active) this.walkerStep();
      this.startLine(this.nextLine, 0);
    }
    const v = this.walker;
    while (v.active && (v.x !== x || v.y !== y)) this.walkerStep();
  }

  spawnFalling(x, y) {                               // FUN_0040f670
    const i = y * W + x;
    const blk = new Block(x, y, 1);
    blk.pressure = true; blk.falling = true; blk.fallH = 230;
    const under = this.blocks.get(i);
    blk.under = under || null;
    this.blocks.set(i, blk);
  }

  walkerUpdate(dt) {
    for (const blk of this.blocks.values()) if (blk.falling) blk.fallH = Math.max(0, blk.fallH - dt);
    let w = this.walker;
    if (!w || !w.active) return;
    w.t += dt;
    for (;;) {
      while (w.active && w.t >= 300) { w.t -= 300; this.walkerStep(); }
      if (w.active || !this.nextLine) return;
      this.startLine(this.nextLine, w.t);          // the waiting line goes on in step
      w = this.walker;
    }
  }

  walkerStep() {
    const w = this.walker;
    const { x, y } = w;
    const i = y * W + x;
    // crush (FUN_004184c0): items, soft blocks and static bombs vanish; the local player dies
    this.items.delete(i);
    for (const b of this.bombs) if (b.alive && b.x === x && b.y === y && b.state !== 2) this.removeBomb(b);
    const me = this.me;
    if (me && me.active && !me.out && me.state !== 5 && me.state !== 8 && me.tx === x && me.ty === y && !me.hitReported) {
      this.localDied(me, -1);
    }
    // land (FUN_0040f6e0)
    sfx("Block");
    const blk = this.blocks.get(i);
    if (blk) { blk.falling = false; blk.fallH = 0; blk.type = 1; blk.under = null; }
    this.grid[i] = T_HARD;
    const [dx, dy] = DIRS[w.dir];
    w.x += dx; w.y += dy;
    if (--w.count <= 0) { w.active = false; return; }
    this.spawnFalling(w.x, w.y);
  }
}
