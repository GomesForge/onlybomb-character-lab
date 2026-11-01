// Training (web only, the lobby's Training button): a match in this page alone, with no bots or up to 3 (bot.js), on
// a battle map, with or without its soft blocks and with the items picked; no clock and no end: whoever dies comes
// back at their start, and the training goes on until the player leaves it. Nothing goes to the server and nothing
// counts (no points, coins, results or missions).
//
// The match is the real one (match.js, world.js, player.js): TrainingConn stands in for its connection (net/conn.js)
// and Training answers its requests as the server's match does (bmoserver/h_game.py: bomb ids and fuses, explosions
// and chains, the items under the blocks, kicks, throws, punches, lines of bombs, diseases, the vest, Louies), on the
// match's own 20 ms steps (Match.update), so it goes on in a hidden tab as a match does.

import { Writer, Reader } from "../net/codec.js";
import { W, H, FLOOR, SOFT, HARD, BORDER, layout, spawnTile, mapItems } from "./mapdata.js";
import { DIRS, T_SOFT, T_FLOOR } from "./objects.js";
import { CHARACTERS } from "./characters.js";
import { SKIN_BASE } from "./bombskins.js";
import { Brain } from "./bot.js";

export const MAX_BOTS = 3;
const BOT_ID = 32001;                           // the bots' player ids (not a real player's: those are lower)
const FIRE = 0, BOMB = 2, SKULL = 5, VEST = 6, FULL_FIRE = 7, LOUIE = 8;
const DISEASES = [1, 2, 4, 8, 16, 32, 64, 128, 256];   // the skull's 9 diseases (h_game DISEASES)
const SHORT_FUSE = 0x80, LONG_FUSE = 0x100;
// the server's default item weights (h_game DEFAULT_ITEM_WEIGHTS): a map without its own list
const WEIGHTS = { 0: 30, 2: 30, 1: 14, 3: 7, 4: 5, 9: 4, 10: 3, 7: 2, 8: 3, 11: 2, 5: 2, 6: 1, 12: 2 };
const DROP_CHANCE = 0.4;                        // ... the share of its blocks hiding one (item_drop_chance)
const FLOOR_POOL = 20;                          // ... or, without blocks, the items that come out before more do
const FULL_POWER = { 0: [5, 5], 9: [8, 8], 18: [8, 8] };   // map set -> fire, bombs at the start (player.js resetStats)
const FLAME_HOT_MS = 400;                       // flames set off a bomb coming into them this long (FLAME_HOT_S)
const KILL_GRACE_MS = 600;                      // a fire's owner is kept this much longer (deaths come a little late)
const ROT_ARROW_SETS = new Set([8, 17, 22, 25, 26]), ARROW_MS = 6000;   // the rotating arrows turn (0x86)
const FLOOR_ITEM_MS = 5000, FLOOR_ITEMS = 6;    // no blocks: an item on the floor this often, while fewer lie there
const RESPAWN = 1;                              // 0x6c [5..6]: back at the start after the death (world.onDeath)
const DIED_KILLED = 0, DIED_SELF = 1, DIED_OTHER = 6;   // the kill feed's causes (h_game DIED_*)

const rand = (n) => Math.floor(Math.random() * n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const key = (x, y) => y * W + x;

// "Random" (0, 9, 18) is a map of its page picked at the start; the maps with layouts get one of their 100
// (h_room.resolve_map, has_layouts)
const resolveMap = (m) => (m % 9 === 0 ? m + 1 + rand(8) : m);
const hasLayouts = (m) => (m >= 10 && m <= 17) || (m >= 19 && m <= 26);

// Stands in for the match's Connection: what the match sends goes to the training, which answers on its steps
class TrainingConn extends EventTarget {
  constructor(training) { super(); this.training = training; this.gameMode = true; }
  release() {}
  send(id, data = new Uint8Array(0)) { this.training.message(id, data); }
  sendGame(pkt) { this.training.request(pkt); }
  sendRelay() {}                                // moves: nobody else to show them to
  sendChat(pkt) { this.training.out.push({ type: 6, pkt }); }   // the match chat: back to its writer
}

export class Training {
  // opts: {map (0..26), bots (0..3), blocks (bool), full (bool), items (bit t: item type t drops)}; timing: the
  // server's match timings and rules (config.json "training": fuse_ms, burn_ms, disease_s, barrier_s,
  // kick_chain)
  constructor(session, opts, timing = {}) {
    this.session = session;
    this.blocks = !!opts.blocks;
    this.full = !!opts.full;                    // everyone starts, and comes back, with full items (player.js fullItems)
    this.itemMask = opts.items;
    this.mapSet = resolveMap(opts.map);
    this.variant = hasLayouts(this.mapSet) ? rand(100) : 0;
    this.fuseMs = timing.fuse_ms || 2500;
    this.burnMs = timing.burn_ms || 600;
    this.diseaseMs = 1000 * (timing.disease_s || 15);
    this.barrierMs = 1000 * (timing.barrier_s || 10);
    this.kickChain = timing.kick_chain !== false;   // off: kicked and thrown bombs pass flames (h_game kick_chain)
    this.conn = new TrainingConn(this);
    this.myId = session.myId;
    this.entries = [this.myEntry(), ...this.botEntries(Math.max(0, Math.min(MAX_BOTS, opts.bots | 0)))];
    this.now = 0;                               // ms of training stepped
    this.out = [];                              // what the match gets on the next step: {type, pkt} or {id, data}
    this.timers = [];
    this.bombs = new Map();
    this.items = new Map();                     // tile -> item type
    this.burn = new Map();                      // tile -> {until, kind: "block" | "item"}: still burning
    this.fire = new Map();                      // tile -> until: in flames (no item comes back there)
    this.hot = new Map();                       // tile -> until: flames that set off a bomb coming there
    this.fireBy = new Map();                    // tile -> {until, owners}: whose fire it is (the kill feed)
    this.hidden = new Map();                    // soft block -> the item under it
    this.floorPool = [];
    this.cracked = new Set();
    this.states = new Map(this.entries.map((e) => [e.id, { id: e.id, items: [], disease: 0, cure: null, vest: null }]));
    for (const st of this.states.values()) this.resetStats(st);
    this.nextBomb = 1;
    this.started = false;
    this.stopped = false;
    this.match = null;
    this.brains = [];
    this.onEnd = null;                          // the player left: back to the lobby (main.js)
  }

  // ------------------------------------------------------------------ the match's room
  myEntry() {
    const s = this.session, me = s.users.get(s.myId) || {}, o = s.outfit;
    const wearing = !!(o && o.wearing);
    return { id: s.myId, slot: 0, nick: me.nick || "?", team: -1, cls: me.cls || 0, char: 0,
      look: wearing ? -1 : Math.max(0, o ? o.look : 0), outfit: wearing ? { body: o.body, face: o.face, items: o.items } : null,
      guild: "", map: this.mapSet, variant: this.variant,
      bomb: s.wallet && s.wallet.bomb > SKIN_BASE ? s.wallet.bomb - SKIN_BASE : 0 };
  }

  botEntries(n) {
    const mine = this.myEntry().look, looks = shuffle([1, 2, 3, 4, 5, 6, 0].filter((l) => l !== mine && l < CHARACTERS.length));
    const out = [];
    for (let i = 0, id = BOT_ID; i < n; i++, id++) {
      if (id === this.session.myId) id++;
      out.push({ id, slot: i + 1, nick: `BOT-${i + 1}`, team: -1, cls: 0, char: 0, look: looks[i % looks.length],
        outfit: null, guild: "", map: this.mapSet, variant: this.variant, bomb: 0, bot: true });
    }
    return out;
  }

  // What the match takes for its session (match.js reads these)
  sessionFor() {
    const s = this.session;
    return {
      conn: this.conn, myId: this.myId, training: this, rejoinState: null, layout: null, bossShop: null,
      room: { players: new Map(this.entries.map((e) => [e.id, e])), rules: [1, 0, 0, 0, 0], info: { mode: 0, team: 0 },
        number: -1, watch: false, map: this.mapSet, items: this.itemMask },
      gameType: () => 0,
      layoutFor: () => null,
      get belts() { return s.belts; },
      beltOf: (points) => s.beltOf(points),
      get superBroadcast() { return s.superBroadcast; },
    };
  }

  attach(match) { this.match = match; }

  // The world has laid out the map (match.js start): without blocks, the soft ones go; the bots get their heads
  roundLoaded(world) {
    const g = layout(this.mapSet, this.variant);
    this.grid = Array.from(g, (t) => (t === SOFT && !this.blocks ? FLOOR : t));
    if (!this.blocks) {
      for (let i = 0; i < W * H; i++) {
        if (world.grid[i] !== T_SOFT) continue;
        world.grid[i] = T_FLOOR;
        world.blocks.delete(i);
      }
    }
    this.world = world;
    this.brains = world.players.filter((p) => p.bot).map((p) => (p.brain = new Brain(p, this)));
    this.hideItems();
  }

  // ------------------------------------------------------------------ steps (Match.update, before the world's)
  update(dt) {
    this.now += dt;
    for (const b of [...this.bombs.values()]) {
      if (!b.fuseDone && this.now >= b.fuseAt && this.bombs.get(b.id) === b) this.fuseExpired(b);
    }
    const due = this.timers.filter((t) => t.at <= this.now);
    this.timers = this.timers.filter((t) => t.at > this.now);
    for (const t of due.sort((a, b) => a.at - b.at)) if (!t.off) t.fn();
    // a kicked bomb that slides into flames goes off there (kick_chain on)
    for (const b of this.kickChain ? [...this.bombs.values()] : []) {
      if (!b.moving || !b.slide || this.bombs.get(b.id) !== b) continue;
      const [x, y] = this.slideTile(b);
      if (this.inFlames(x, y)) { this.endSlide(b, x, y); this.explode(b); }
    }
    const out = this.out;
    this.out = [];
    for (const o of out) {
      if (o.id !== undefined) this.match.onMessage(o.id, o.data);
      else this.conn.dispatchEvent(new CustomEvent("game", { detail: { type: o.type, pkt: o.pkt } }));
    }
    for (const b of this.brains) b.think(dt);
  }

  later(ms, fn) { const t = { at: this.now + ms, fn, off: false }; this.timers.push(t); return t; }
  emit(pkt) { this.out.push({ type: 3, pkt }); }
  tell(id, data) { this.out.push({ id, data }); }

  // Ms until bomb `id` goes off (0: as soon as it rests), for the bots
  fuseLeft(id) {
    const b = this.bombs.get(id);
    return !b ? this.fuseMs : b.fuseDone ? 0 : Math.max(0, b.fuseAt - this.now);
  }

  // ------------------------------------------------------------------ MESSAGEs and requests from the match
  message(id) {
    if (id === 0x42b) {                         // its address: everyone is "relayed" (there is nobody else)
      const w = new Writer(36);
      for (let i = 0; i < 6; i++) w.i16(-1).i16(0).i16(0);
      this.match.onMessage(0x7f2, w.done());
    } else if (id === 0x3f8) {                  // it left (match.quit): back to the lobby
      this.stopped = true;
      setTimeout(() => this.onEnd && this.onEnd(), 0);
    }
  }

  request(raw) {
    if (this.stopped) return;
    const pkt = new Uint8Array(raw.length + 32);
    pkt.set(raw);
    const r = new Reader(pkt), op = pkt[0];
    switch (op) {
      case 0x7e: if (!this.started) this.start(); return;
      case 0x67: return this.placeBomb(r.i16(3), pkt[5], pkt[6], pkt[8] > 2 ? 0 : pkt[8]);
      case 0x6b: return this.died(r.i16(1), pkt[3], pkt[4]);
      case 0x6d: return this.takeItem(r.i16(1), pkt[3], pkt[4]);
      case 0x71: return this.kick(r.i16(1), r.i16(3), pkt);
      case 0x73: return this.kickStop(r.i16(1), pkt[5], pkt[6]);
      case 0x76: case 0x8e: return this.lift(op === 0x8e ? 0x8f : 0x77, r.i16(1), r.i16(3), pkt);
      case 0x78: case 0x90: return this.land(op === 0x90 ? 0x91 : 0x79, r.i16(1), pkt[5], pkt[6]);
      case 0x8c: return this.lineBomb(r.i16(1), pkt[3], Math.min(8, pkt[4]), pkt[0x15], pkt[0x16], pkt[0x18]);
      case 0x89: return this.contact(r.i16(1), r.i16(3));
      case 0x97: return this.emit(new Uint8Array([0x97, 0]));
      case 0x9a: {                              // cracking ice: cracks, then breaks through
        const c = key(pkt[1], pkt[2]), state = this.cracked.has(c) ? 1 : 0;
        this.cracked.add(c);
        return this.emit(new Uint8Array([0x9b, pkt[1], pkt[2], state]));
      }
      case 0x9c: return this.emit(new Writer(6).u8(0x9d).i16(r.i16(1)).u8(pkt[3]).u8(pkt[4]).u8(1 + rand(6)).done());
      case 0xa3: return this.emit(new Writer(3).u8(0xa4).i16(r.i16(1)).done());
    }
  }

  // ------------------------------------------------------------------ the round
  start() {
    this.started = true;
    const points = [0, 1, 2, 3, 4, 5].filter((i) => spawnTile(this.mapSet, i));
    const picks = shuffle(points.slice());
    this.entries.forEach((e, i) => {
      this.states.get(e.id).spawn = picks[i % picks.length];
      this.emit(new Writer(9).u8(0x83).i16(e.id).u8(picks[i % picks.length]).zeros(5).done());
    });
    this.emit(new Writer(5).u8(0x7f).i16(0).u16(0).done());    // no clock (hud.js: none drawn in a training)
    if (ROT_ARROW_SETS.has(this.mapSet)) this.later(ARROW_MS, () => this.turnArrows());
    if (!this.blocks) this.later(FLOOR_ITEM_MS, () => this.floorItem());
  }

  turnArrows() {
    this.emit(new Uint8Array([0x86, 0]));
    this.later(ARROW_MS, () => this.turnArrows());
  }

  resetStats(st) {                             // back to the map's start (player.js resetStats; the client's own too)
    const most = this.mapSet >= 9 ? 8 : 5;     // (full items: the most an item gets, as player.js fullItems)
    const [fire, bombs] = this.full ? [most, most] : FULL_POWER[this.mapSet] || [2, 1];
    st.power = fire; st.capacity = bombs; st.items = [];
    st.disease = 0;
    if (st.cure) st.cure.off = true;
    if (st.vest) st.vest.off = true;
    st.cure = st.vest = null;
  }

  // ------------------------------------------------------------------ the items
  allowed(t) { return !!(this.itemMask >> t & 1); }

  // The map's own items, with the ones switched off replaced by the ones left (h_game allowed_pool); a map without
  // its list: FLOOR_POOL of the allowed items, by the server's weights
  pool() {
    const own = mapItems(this.mapSet), kept = own.filter((t) => this.allowed(t));
    if (!own.length) return Array.from({ length: FLOOR_POOL }, () => this.pickItem()).filter((t) => t !== null);
    const fill = kept.length ? kept : null;
    const out = kept.slice();
    for (let i = kept.length; i < own.length; i++) { const t = fill ? fill[rand(fill.length)] : this.pickItem(); if (t !== null) out.push(t); }
    return out;
  }

  pickItem() {
    const list = Object.entries(WEIGHTS).filter(([t]) => this.allowed(+t));
    let r = Math.random() * list.reduce((s, [, w]) => s + w, 0);
    for (const [t, w] of list) { r -= w; if (r <= 0) return +t; }
    return list.length ? +list[list.length - 1][0] : null;
  }

  hideItems() {
    this.hidden.clear();
    const pool = shuffle(this.pool());
    if (!this.blocks) { this.floorPool = pool; return; }
    const soft = shuffle(this.grid.flatMap((t, i) => (t === SOFT ? [i] : [])));
    if (!mapItems(this.mapSet).length) {        // no list of its own: by chance, block by block
      for (const c of soft) { if (Math.random() < DROP_CHANCE) { const t = this.pickItem(); if (t !== null) this.hidden.set(c, t); } }
      return;
    }
    pool.forEach((t, i) => { if (i < soft.length) this.hidden.set(soft[i], t); });
  }

  // No blocks: an item comes out on the floor every FLOOR_ITEM_MS while fewer than FLOOR_ITEMS lie there
  floorItem() {
    this.later(FLOOR_ITEM_MS, () => this.floorItem());
    if (this.items.size >= FLOOR_ITEMS) return;
    if (!this.floorPool.length) this.floorPool = shuffle(this.pool());
    const free = this.freeFloor();
    if (!free.length || !this.floorPool.length) return;
    this.dropItems([[free[rand(free.length)], this.floorPool.pop()]]);
  }

  dropItems(list) {                             // 0x6a {n, n x {i16 type, u8 x, u8 y}}
    if (!list.length) return;
    const w = new Writer(2 + 4 * list.length).u8(0x6a).u8(list.length);
    for (const [c, t] of list) { this.items.set(c, t); w.i16(t).u8(c % W).u8((c / W) | 0); }
    this.emit(w.done());
  }

  freeFloor() {                                 // h_game free_floor
    const out = [];
    for (let c = 0; c < W * H; c++) {
      if (this.grid[c] !== FLOOR || this.items.has(c) || (this.fire.get(c) || 0) > this.now || this.bombAt(c % W, (c / W) | 0)
        || this.burning(c)) continue;
      out.push(c);
    }
    return out;
  }

  takeItem(who, x, y) {                         // 0x6d -> 0x6e (h_game op_item)
    const c = key(x, y), it = this.items.get(c);
    if (it === undefined) return;
    this.items.delete(c);
    const st = who >= 0 ? this.states.get(who) : null;
    let param = 0;
    if (st) {
      if (it === FIRE) st.power = Math.min(this.mapSet >= 9 ? 8 : 5, st.power + 1);
      else if (it === FULL_FIRE) st.power = 15;
      else if (it === BOMB) st.capacity = Math.min(8, st.capacity + 1);
      else if (it === LOUIE) param = 1 + rand(4);
      else if (it === SKULL) { param = DISEASES[rand(DISEASES.length)]; this.setDisease(st, param); }
      else if (it === VEST) this.giveVest(st);
      st.items.push(it);
    }
    this.emit(new Writer(8).u8(0x6e).i16(st ? who : -1).u8(x).u8(y).u8(it).i16(param).done());
  }

  setDisease(st, mask) {                        // until the cure: 0x88 {id, 0}
    st.disease = mask;
    if (st.cure) st.cure.off = true;
    st.cure = mask ? this.later(this.diseaseMs, () => {
      st.cure = null;
      if (!st.disease) return;
      st.disease = 0;
      this.emit(new Writer(5).u8(0x88).i16(st.id).u16(0).done());
    }) : null;
  }

  giveVest(st) {                                // until 0xa2 {id}
    if (st.vest) st.vest.off = true;
    st.vest = this.later(this.barrierMs, () => { st.vest = null; this.emit(new Writer(3).u8(0xa2).i16(st.id).done()); });
  }

  contact(a, b) {                               // 0x89 -> 0x8a: players who touch share their diseases
    const sa = this.states.get(a), sb = this.states.get(b);
    if (!sa || !sb || sa === sb || sa.disease === sb.disease) return;
    const mask = sa.disease | sb.disease;
    this.setDisease(sa, mask);
    this.setDisease(sb, mask);
    this.emit(new Writer(9).u8(0x8a).i16(a).i16(b).u16(mask).u16(mask).done());
  }

  // ------------------------------------------------------------------ deaths
  died(victim, x, y) {                          // 0x6b -> 0x6c: back at its start after the death (RESPAWN)
    const st = this.states.get(victim);
    if (!st) return;
    const items = st.items;
    this.resetStats(st);
    const [killer, cause] = this.blame(victim, x, y);
    this.tell(0x8ba, new Writer(5).i16(victim).i16(killer).u8(cause).done());
    this.emit(new Writer(9).u8(0x6c).i16(victim).u8(x).u8(y).i16(RESPAWN).u8(0).u8(0).done());
    this.giveBack(items);
  }

  blame(victim, x, y) {                         // the fire's owner there: a rival before the victim itself
    const f = this.fireBy.get(key(x, y));
    if (!f || f.until <= this.now) return [-1, DIED_OTHER];
    const rival = f.owners.find((o) => o !== victim);
    return rival !== undefined ? [rival, DIED_KILLED] : [victim, DIED_SELF];
  }

  giveBack(items) {                             // its power-ups come back on the floor (h_game give_back)
    const back = items.filter((t) => t !== SKULL && t !== VEST && t !== LOUIE);
    const free = shuffle(this.freeFloor());
    this.dropItems(back.slice(0, free.length).map((t, i) => [free[i], t]));
  }

  // ------------------------------------------------------------------ bombs
  tile(x, y) { return x >= 0 && y >= 0 && x < W && y < H ? this.grid[key(x, y)] : BORDER; }

  bombAt(x, y) {
    for (const b of this.bombs.values()) if (b.x === x && b.y === y && !b.moving) return b;
    return null;
  }

  burning(c) {                                  // "block" or "item" while it burns, else null
    const v = this.burn.get(c);
    if (!v) return null;
    if (v.until <= this.now) { this.burn.delete(c); return null; }
    return v.kind;
  }

  canPlace(x, y) {
    return this.tile(x, y) === FLOOR && !this.items.has(key(x, y)) && !this.burning(key(x, y)) && !this.bombAt(x, y)
      && this.bombs.size < 200;
  }

  newBomb(owner, x, y, kind) {
    const st = this.states.get(owner);
    const fuse = st.disease & SHORT_FUSE ? 1000 : st.disease & LONG_FUSE ? 6000 : this.fuseMs;
    const b = { id: this.nextBomb, owner, x, y, power: Math.min(15, st.power), kind, moving: false, slide: false,
      punch: false, fuseDone: false, fuseAt: this.now + fuse };
    this.nextBomb = this.nextBomb < 30000 ? this.nextBomb + 1 : 1;
    this.bombs.set(b.id, b);
    return b;
  }

  placeBomb(owner, x, y, kind) {                // 0x67 -> 0x68
    const st = this.states.get(owner);
    const mine = [...this.bombs.values()].filter((b) => b.owner === owner).length;
    const b = st && mine < st.capacity && this.canPlace(x, y) ? this.newBomb(owner, x, y, kind) : null;
    this.emit(new Writer(12).u8(0x68).i16(b ? b.id : -1).i16(owner).u8(x).u8(y).u8(b ? b.power : 0).u8(kind)
      .zeros(3).done());
  }

  lineBomb(owner, d, count, x0, y0, kind) {     // 0x8c -> 0x8d (h_game op_line_bomb)
    const st = this.states.get(owner);
    if (!st || d > 3) return;
    const [dx, dy] = DIRS[d], ids = [];
    let left = st.capacity - [...this.bombs.values()].filter((b) => b.owner === owner).length;
    for (let i = 0; i < count; i++) {
      const x = x0 + dx * i, y = y0 + dy * i;
      if (left > 0 && this.canPlace(x, y)) { ids.push(this.newBomb(owner, x, y, kind > 2 ? 0 : kind).id); left--; }
      else { ids.push(-1); if (i) break; }
    }
    const w = new Writer(25).u8(0x8d).i16(owner).u8(d).u8(count);
    for (let i = 0; i < 8; i++) w.i16(ids[i] ?? -1);
    this.emit(w.u8(x0).u8(y0).u8(Math.min(15, st.power)).u8(kind > 2 ? 0 : kind).done());
  }

  fuseExpired(b) {                              // h_game fuse_expired
    b.fuseDone = true;
    if (b.moving && b.slide) { const [x, y] = this.slideTile(b); this.endSlide(b, x, y); }
    if (!b.moving) this.explode(b);
  }

  // Where a kicked bomb is now: this page slides it (objects.js slide), so where the world has it
  slideTile(b) {
    const wb = this.world.bombById(b.id);
    return wb && wb.state === 1 ? [wb.x, wb.y] : [b.x, b.y];
  }

  endSlide(b, x, y) {                           // it stops there for everyone (0x74)
    b.x = x; b.y = y; b.moving = b.slide = false;
    this.emit(new Writer(12).u8(0x74).i16(b.id).i16(0).u8(x).u8(y).u8(b.kind).i16(0).u8(b.power).u8(1).done());
  }

  inFlames(x, y) { return this.kickChain && (this.hot.get(key(x, y)) || 0) > this.now; }

  cameToRest(b) {                               // stopped or landed: off now if its fuse ended or it lies in flames
    if (b.fuseDone || this.inFlames(b.x, b.y)) this.explode(b);
  }

  kick(id, who, pkt) {                          // 0x71 -> 0x72
    const b = this.bombs.get(id);
    if (!b || b.moving) return;
    b.moving = b.slide = true;
    this.emit(new Writer(12).u8(0x72).i16(id).i16(who).u8(pkt[5]).u8(pkt[6]).u8(pkt[7]).i16(0).u8(0).u8(1).done());
  }

  kickStop(id, x, y) {                          // 0x73 -> 0x74
    const b = this.bombs.get(id);
    if (!b) return;
    this.endSlide(b, this.tile(x, y) === FLOOR ? x : b.x, this.tile(x, y) === FLOOR ? y : b.y);
    this.cameToRest(b);
  }

  lift(reply, id, who, pkt) {                   // 0x76 glove / 0x8e punch -> 0x77 / 0x8f
    const b = this.bombs.get(id);
    if (!b) return;
    const ok = !b.moving;
    if (ok) { b.moving = true; b.slide = false; b.punch = reply === 0x8f; }
    this.emit(new Writer(10).u8(reply).i16(id).i16(who).u8(ok ? pkt[5] : b.x).u8(ok ? pkt[6] : b.y).u8(pkt[7] & 3)
      .u8(b.kind).u8(ok ? 1 : 0).done());
  }

  land(reply, id, x, y) {                       // 0x78 / 0x90 -> 0x79 / 0x91
    const b = this.bombs.get(id);
    if (!b) return;
    const free = this.tile(x, y) === FLOOR && !this.bombAt(x, y);
    if (free) { b.x = x; b.y = y; b.moving = false; }
    this.emit(new Writer(9).u8(reply).i16(id).i16(0).u8(x).u8(y).u8(b.kind).u8(free ? 1 : 0).done());
    if (free) this.cameToRest(b);
  }

  // Flames like the clients' (h_game explode): per direction, up to the bomb's power; a hard block stops them; a bomb,
  // resting or kicked and sliding there (kick_chain on), chains and stops them; a soft block or an item burns and stops
  // them unless the bomb pierces; a block or an item still burning stops them. One 0x69 for the whole chain.
  explode(first) {
    const chain = [first], queue = [first], burnedSoft = new Set(), burnedItems = new Set(), flames = new Set();
    const reach = new Map();
    const sliding = new Map();
    for (const o of this.kickChain ? this.bombs.values() : []) {
      if (o.moving && o.slide) { const [x, y] = this.slideTile(o); if (!sliding.has(key(x, y))) sliding.set(key(x, y), o); }
    }
    while (queue.length) {
      const b = queue.shift(), pierce = b.kind === 1, mine = new Set([key(b.x, b.y)]);
      reach.set(b, mine);
      flames.add(key(b.x, b.y));
      for (const [dx, dy] of DIRS) {
        for (let s = 1; s <= b.power; s++) {
          const x = b.x + dx * s, y = b.y + dy * s, c = key(x, y), t = this.tile(x, y);
          if (t === HARD || t === BORDER) break;
          const burn = this.burning(c);
          if (burn === "item") break;
          flames.add(c);
          mine.add(c);
          if (burn === "block") {
            if (this.items.has(c)) { burnedItems.add(c); break; }
            if (!pierce) break;
            continue;
          }
          const other = this.bombAt(x, y) || sliding.get(c);
          if (other) {
            if (!chain.includes(other)) {
              if (other.moving) this.endSlide(other, x, y);
              chain.push(other);
              queue.push(other);
            }
            break;
          }
          if (t === SOFT) { burnedSoft.add(c); if (!pierce) break; continue; }
          if (this.items.has(c)) { burnedItems.add(c); if (!pierce) break; }
        }
      }
    }
    const w = new Writer(7 * chain.length);
    chain.forEach((b, i) => w.u8(i ? 0 : 0x69).i16(b.id).u8(b.x).u8(b.y).u8(0).u8(0));
    for (const b of chain) this.bombs.delete(b.id);
    this.emit(w.done());
    const until = this.now + this.burnMs;
    for (const c of flames) { this.fire.set(c, until); this.hot.set(c, this.now + FLAME_HOT_MS); }
    const by = new Map();                       // tile -> the owners of the bombs whose own fire covers it
    for (const b of chain) {
      for (const c of reach.get(b)) {
        const who = by.get(c) || [];
        if (!who.includes(b.owner)) who.push(b.owner);
        by.set(c, who);
      }
    }
    for (const [c, who] of by) {
      const old = this.fireBy.get(c);           // an earlier blast's fire is still there too
      if (old && old.until > this.now) for (const o of old.owners) if (!who.includes(o)) who.push(o);
      this.fireBy.set(c, { until: until + KILL_GRACE_MS, owners: who });
    }
    for (const c of burnedItems) {
      if (burnedSoft.has(c)) continue;
      this.items.delete(c);
      if (!this.burn.has(c)) this.burn.set(c, { until, kind: "item" });
    }
    const drops = [];
    for (const c of burnedSoft) {
      this.grid[c] = FLOOR;
      this.burn.set(c, { until, kind: "block" });
      const t = this.hidden.get(c);
      this.hidden.delete(c);
      if (t !== undefined) drops.push([c, t]);
    }
    this.dropItems(drops.slice(0, 125));
  }
}
