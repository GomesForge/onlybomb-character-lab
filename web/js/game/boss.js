// Boss Battle (web game mode 4 = the Korean client's game mode 3, BomberManK.exe of Jan 2005): the EarthBomb boss that
// the server drives (ops 0xd2..0xdc), the cave stages (map sets 47..49) with their animated layers and music, the boss
// HP board and face, earth bombs (bomb kinds 4 and 5) and the boss's body, which stuns the local player (0x94).
// docs/client/K_boss.md; the function names are the Korean exe's.

import { loadSprite } from "../assets/spr.js";
import { Runs } from "./fb565.js";
import { Reader, Writer } from "../net/codec.js";
import { sfx, music } from "./sound.js";

const T = Math.trunc;
export const MODE_BOSS = 4;
export const isBossMap = (m) => m >= 47 && m <= 49;

const DIR = "BattleBoss/Boss/01_EarthBomb/";
// Sprite of each state (FUN_00470e50): form A, the armoured walker, and form B, the spiked ball. 31..34: form A's turns.
const TABLE_A = ["BoB_ent", "BoA_sto_S", "BoA_sto_W", "BoA_sto_N", "BoA_sto_E", "BoA_bre", "BoA_win", "BoA_lo1",
  "BoA_lo2", "BoA_cha", "BoA_dam_S", "BoA_dam_W", "BoA_dam_N", "BoA_dam_E", "BoA_mov_S", "BoB_mov", "BoA_mov_W",
  "BoB_mov", "BoA_mov_N", "BoB_mov", "BoA_mov_E", "BoB_mov", "BoA_rat", "BoA_at1", "BoA_at2", "BoA_at1", "BoA_at2",
  "BoA_jum", "BoA_lan", "BoB_ca2", "BoB_ca1", "BoA_tun_EN", "BoA_tun_NW", "BoA_tun_WS", "BoA_tun_SE", "Shadow"];
const TABLE_B = ["BoB_ent", "BoB_sto", "BoB_sto", "BoB_sto", "BoB_sto", "BoB_bre", "BoA_win", "BoA_lo1", "BoA_lo2",
  "BoB_cha", "BoB_dam", "BoB_dam", "BoB_dam", "BoB_dam", "BoB_mov", "BoB_mov", "BoB_mov", "BoB_mov", "BoB_mov",
  "BoB_mov", "BoB_mov", "BoB_mov", "BoB_rat", "BoB_at1", "BoB_at1", "BoB_at1", "BoB_at2", "BoB_jum", "BoB_lan",
  "BoB_ca2", "BoB_ca1", null, null, null, null, "Shadow"];
const SHADOW = 35;

// Boss directions (+0x9c): 0 E, 1 S, 2 W, 3 N, 4 NW, 5 NE, 6 SE, 7 SW, -1 none (not the players' code).
const SPEED = [0.025, 0.09, 0.10, 0.11, 0.12, 0.13, 0.14, 0.15, 0.19, 0.23, 0.27, 0.35, 0.45];   // px/ms (FUN_004721d0)
const MOVE_STATE = [20, 14, 16, 18, 17, 19, 21, 15];
const STEP = [[1, 0], [0, 1], [-1, 0], [0, -1], [-1, -1], [1, -1], [1, 1], [-1, 1]];
const STOP_STATE = [4, 1, 2, 3];
const DAM_STATE = [13, 10, 11, 12];
const TURN = [[0, 12, 12, 1], [4, 0, 11, 4], [3, 3, 0, 10], [9, 2, 2, 0]];   // FUN_00472720: old dir x new dir
const SEG_END = { 1: 3, 2: 2, 3: 1, 4: 0, 9: 0, 10: 3, 11: 2, 12: 1 };      // the direction a turn segment ends in
const SEG_SPRITE = { 1: 31, 2: 32, 3: 33, 4: 34, 9: 32, 10: 31, 11: 34, 12: 33 };   // 9..12 drawn mirrored
const ATTACK = { 1: [23, "Boss_EE02"], 2: [24, "Boss_EE03"], 3: [25, "Boss_EE04"], 4: [26, "Boss_EE05"],
  5: [26, "Boss_EE05"], 6: [29, "Boss_EE05"], 7: [30, "Boss_EE05"] };
const BAR = 570;                                  // HP bar width (+0x0c)

// The caves (FUN_0046fc70 / FUN_0046ff70 / FUN_00470110): Back01 frame 0 behind, frame 1 in front, extra layers.
const STAGES = {
  47: { dir: "01_Cave", bgm: "BGM_Earth_01.mp3",
    back: [["back_c1", 23, 431], ["back_c3", 8, 255], ["back_c4", 56, 160], ["back_c8", 482, 22]],
    front: [["back_c51", 474, 555], ["back_c7", 682, 430]] },
  48: { dir: "02_Cave", bgm: "BGM_Earth_02.mp3", flow: "back_river" },
  49: { dir: "03_Cave", bgm: "BGM_Earth_03.mp3", flow: "back_lava" },
};

const runs = (path) => loadSprite(path).then((s) => ({ r: Runs.fromSprite(s), n: s.count, period: s.b6 }))
  .catch((e) => { console.warn(e.message); return null; });

let shared = null;                                 // boss sprites, HUD and earth bombs: loaded once
function loadShared() {
  if (!shared) {
    shared = (async () => {
      const names = [...new Set([...TABLE_A, ...TABLE_B].filter(Boolean))];
      const got = new Map(await Promise.all(names.map(async (n) => [n, await runs(DIR + n + ".spr")])));
      const ui = {};
      const files = { board: "UI/UI_BoardBoss.spr", end: "UI/UI_BoardBoss_end.spr", spark: "UI/UI_BoardHP_Spark.spr",
        norm: DIR + "UI_BossEarth_norm.spr", dam: DIR + "UI_BossEarth_dam.spr", last: DIR + "UI_BossEarth_last.spr",
        eb1: DIR + "Earthbomb01.spr", eb1d: DIR + "Earthbomb01_d.spr", eb2: DIR + "Earthbomb02.spr",
        eb2d: DIR + "Earthbomb02_d.spr",
        // the result screens (FUN_0046fdd0, K_boss.md §4.5); the Korean result_back, narrower than ours
        resMiddle: "UI/UI_ResultMiddle.spr", resMiddleTxt: "UI/UI_ResultMiddletxt.spr", resFinalTxt: "UI/UI_ResultFinal_Txt.spr",
        resBoard: "UI/UI_ResultBoard.spr", resEarth: DIR + "UI_ResultFinal_Earth.spr", resBack: "kr/result/result_back.spr" };
      await Promise.all(Object.entries(files).map(async ([k, f]) => { ui[k] = await runs(f); }));
      return { A: TABLE_A.map((n) => (n && got.get(n)) || null), B: TABLE_B.map((n) => (n && got.get(n)) || null), ui };
    })();
  }
  return shared;
}

const stages = new Map();
function loadStage(mapSet) {
  const st = STAGES[mapSet];
  if (!st) return Promise.resolve(null);
  if (!stages.has(mapSet)) {
    const dir = "BattleBoss/Map/" + st.dir + "/";
    stages.set(mapSet, (async () => {
      const back01 = await runs(dir + "Back01.spr");
      const layer = async ([n, x, y]) => ({ spr: await runs(dir + n + ".spr"), x, y });
      return { back01, back: await Promise.all((st.back || []).map(layer)), front: await Promise.all((st.front || []).map(layer)),
        flow: st.flow ? await runs(dir + st.flow + ".spr") : null, bgm: "BattleBoss/Boss/01_EarthBomb/" + st.bgm };
    })());
  }
  return stages.get(mapSet);
}

// The boss object (DAT_0049fcec) and the stage object (0x49ac88): one per match.
export class Boss {
  constructor(world) {
    this.world = world;
    this.s = null;                                 // shared sprites
    this.stage = null;
    this.layers = [];                              // animated cave layers: {spr, x, y, frame, t}
    this.flowFrame = 0; this.flowT = 0; this.flowDown = false;
    this.appearances = world.match.rules[0] || 1;  // +0x14f: the room's stage count (0x7dc), -1 at each 0xdc
    this.dir = -1; this.moving = false; this.speed = 0; this.turn = 0; this.destC = 0; this.destR = 0;
    this.t1 = 1; this.t2 = 1; this.t3 = 1;
    this.disp = BAR;                               // DAT_0048aeb8: the bar as drawn, drains 1 px a tick
    this.hudFlash = 0; this.flashT = 0; this.sparkFrame = 0; this.sparkT = 0; this.faceFrame = 0; this.faceT2 = 0;
    this.reset();
  }

  async load(mapSet) {
    this.themeSet = mapSet;
    this.s = await loadShared();
    await this.loadStage(mapSet);
  }

  async loadStage(mapSet) {                         // every stage load: background layers and music (FUN_0046fc70)
    const st = await loadStage(mapSet);
    if (this.themeSet !== mapSet) return;
    this.stage = st;
    this.layers = st ? st.back.concat(st.front).map((l) => ({ ...l, frame: l.spr ? Math.floor(Math.random() * l.spr.n) : 0, t: 0 })) : [];
    this.flowFrame = 0; this.flowT = 0; this.flowDown = false;
    if (st) music(st.bgm);
  }

  reset() {                                        // FUN_00471740, at every stage load
    this.active = false; this.dead = false;
    this.max = 50; this.hp = 50; this.width = BAR;
    this.frame = 0; this.t72 = 0; this.t76 = 0; this.blink = 0;
    this.face = 0; this.faceT = 0;
    this.form = 0; this.state = 0;
    this.setpos(0, 0);
  }

  // ------------------------------------------------------------------ position (FUN_00470a20 / FUN_00470ab0)
  setpos(c, r) {
    this.x = 40 * c - 100; this.y = 38 * r - 217;
    this.col = c; this.row = r;
    this.box();
  }

  moveBy(dx, dy) {
    this.x += dx; this.y += dy;
    this.box();
    this.col = T(T(this.x + 100) / 40); this.row = T(T(this.y + 217) / 38);
  }

  box() {                                          // +0x62: the body, the only thing that touches players
    this.hitL = T(this.x) + 150; this.hitT = T(this.y) + 240; this.hitR = this.hitL + 80; this.hitB = this.hitT + 75;
  }

  spr(form, state) { const t = form ? this.s.B : this.s.A; return t ? t[state] : null; }

  // ------------------------------------------------------------------ server ops (FUN_00470180 / FUN_004702c0)
  event(op, pkt) {
    if (!this.s) return;
    const r = new Reader(pkt);
    switch (op) {
      case 0xd2: return this.rest(pkt[2], r.i16(3), r.i16(5));
      case 0xd3: return this.walk(pkt[2], pkt[3], r.i16(4), r.i16(6), r.i16(8), r.i16(10));
      case 0xd4: return this.change();
      case 0xd5: return this.jump(r.i16(1), r.i16(3), true);
      case 0xd6: return this.land(r.i16(1), r.i16(3));
      case 0xd7: return this.attack(pkt[1], r.i16(2), r.i16(4));
      case 0xd9: return this.jump(r.i16(1), r.i16(3), false);
      case 0xda: return this.damage(pkt[1], r.i16(2));
      case 0xdb: return this.earthBombs(pkt[1], pkt[2], pkt);
      case 0xdc: return this.spawn(pkt[2], r.i16(3), r.i16(5), r.i16(7));
    }
  }

  rest(e, c, d) {                                  // 0xd2 (FUN_004726e0): breathing; the frame goes on
    this.dir = e; this.moving = false;
    if (c !== this.col || d !== this.row) this.setpos(c, d);
    this.state = 5;
  }

  walk(e, f, c, d, g, h) {                         // 0xd3 (FUN_00472820): turn on the spot (form A), then walk to (g, h)
    if (e > 7 || f > 12) return;
    this.turn = this.form === 1 ? 0 : turnFrom(this.dir, e);
    this.dir = e; this.state = MOVE_STATE[e]; this.moving = true; this.speed = f; this.frame = 0;
    this.destC = g; this.destR = h;
    this.setpos(c, d);
  }

  change() {                                       // 0xd4 (FUN_00472910): no snap
    sfx(DIR + "Boss_EE06.wav");
    this.state = 9; this.moving = false; this.frame = 0;
    this.form = 1 - this.form;
  }

  jump(c, d, loud) {                               // 0xd5 jump (FUN_00472970) / 0xd9 silent, facing nowhere (FUN_00472b00)
    if (loud) sfx(DIR + "Boss_EE01.wav");
    else this.dir = -1;
    this.moving = false; this.frame = 0; this.state = 27;
    this.setpos(c, d);
  }

  land(c, d) {                                     // 0xd6 (FUN_004729c0)
    this.moving = false; this.frame = 0; this.state = 28;
    this.setpos(c, d);
  }

  attack(e, c, d) {                                // 0xd7 (FUN_00472a10): animation only, the damage is the server's
    const a = ATTACK[e];
    if (a) { sfx(DIR + a[1] + ".wav"); this.state = a[0]; }
    this.frame = 0; this.moving = false;
    this.setpos(c, d);
  }

  damage(e, f) {                                   // 0xda (FUN_00472b50)
    sfx(DIR + "Boss_EE07.wav");
    if (this.state !== 22 && this.state !== 27 && this.state !== 28) {
      this.dir = e;
      if (e <= 3) this.state = DAM_STATE[e];
      this.moving = false; this.frame = 0; this.turn = 0;
    }
    this.hp = f;
    const { t1, t2, t3 } = this;
    this.width = f <= 0 ? 0 : f <= t1 ? T(f * BAR / t1) : f <= t2 ? T((f - t1) * BAR / (t2 - t1)) : T((f - t2) * BAR / (t3 - t2));
    if (f <= 0) this.dead = true;
    else if (f === 1) this.face = 2;
    else { this.blink = 0; this.t76 = 0; this.face = 1; this.faceT = 2000; }
  }

  spawn(e, f, c, d) {                              // 0xdc (FUN_00472cf0)
    this.dir = e; this.state = 0; this.form = 0; this.speed = 0; this.frame = 0;
    this.max = this.hp = Math.max(1, f);
    const third = Math.floor(this.max / 3);
    this.t3 = this.max; this.t1 = this.max - 2 * third; this.t2 = this.max - third;
    this.width = BAR;
    this.setpos(c, d);
    this.moving = false; this.active = true; this.appearances--; this.turn = 0;
  }

  // 0xdb (FUN_00472db0): types 1, 3..7 {s16 id, u8 x, u8 y} make earth bombs, type 2 {s16 id, u8, u8, u8 x, u8 y} moves one
  earthBombs(type, n, pkt) {
    const r = new Reader(pkt), w = this.world;
    if (type === 2) {
      for (let i = 0; i < n && 3 + 6 * i + 6 <= pkt.length; i++) w.moveEarthBomb(r.i16(3 + 6 * i), pkt[7 + 6 * i], pkt[8 + 6 * i]);
    } else if (type === 1 || (type >= 3 && type <= 7)) {
      for (let i = 0; i < n && 3 + 4 * i + 4 <= pkt.length; i++) {
        w.earthBomb(r.i16(3 + 4 * i), pkt[5 + 4 * i], pkt[6 + 4 * i], this.form === 0 ? 4 : 5);
      }
    }
  }

  roundEnd() {                                     // 0x81 / 0x82 with the boss beaten (FUN_00472ca0): lo2 at the last stage
    if (this.hp >= 1) return;
    this.state = this.appearances === 0 ? 8 : 7;
    this.frame = 0; this.dead = true;
    sfx(DIR + "Boss_EE08.wav");
  }

  // ------------------------------------------------------------------ per tick (FUN_004700a0 and the HUD timers)
  update(dt) {
    if (!this.s) return;
    if (this.active) this.animate(dt);
    this.walkStep(dt);
    for (const l of this.layers) {                 // set 47 (FUN_00470810): frame 0 for 900 ms, then 1.. at b6
      if (!l.spr) continue;
      l.t += dt;
      if (l.frame === 0 ? l.t > 899 : l.t >= l.spr.period) { l.t = 0; l.frame = (l.frame + 1) % l.spr.n; }
    }
    if (this.stage && this.stage.flow) {           // sets 48 / 49 (FUN_00470950): 0 1 2 3 2 1 0 ... every 100 ms
      this.flowT += dt;
      if (this.flowT >= 100) {
        this.flowT = 0;
        this.flowFrame += this.flowDown ? -1 : 1;
        if (this.flowFrame >= 3) { this.flowFrame = 3; this.flowDown = true; }
        else if (this.flowFrame <= 0) { this.flowFrame = 0; this.flowDown = false; }
      }
    }
    // HUD (FUN_004203e0 / FUN_00420760)
    this.disp = this.width < this.disp ? this.disp - 1 : this.width;
    this.flashT += dt;
    if (this.flashT > 120) { this.flashT = 0; this.hudFlash ^= 1; }
    this.sparkT += dt;
    if (this.sparkT > 100) { this.sparkT = 0; const sp = this.s.ui.spark; this.sparkFrame = (this.sparkFrame + 1) % (sp ? sp.n : 1); }
    const face = this.faceSprite();
    this.faceT2 += dt;
    if (face && this.faceT2 >= face.period) { this.faceT2 = 0; this.faceFrame = (this.faceFrame + 1) % face.n; }
  }

  faceSprite() { const u = this.s.ui; return [u.norm, u.dam, u.last][this.face] || u.norm; }

  animate(dt) {                                    // FUN_00471f30
    this.t72 += dt; this.t76 += dt;
    if (this.t76 > 119) { this.t76 = 0; this.blink = 1 - this.blink; }
    const cur = this.spr(this.form, this.state);
    const period = cur ? cur.period : 100, count = cur ? cur.n : 1;
    if (this.t72 >= period) {
      this.frame++; this.t72 = 0;                  // the remainder is dropped (80 ms for b6 = 70 at 20 ms ticks)
      if (this.turn < 1) {
        if (this.frame >= count) {
          if (this.state === 8) this.frame = count - 1;          // lo2: the last frame stays
          else if (this.state === 27) this.frame = 0;             // jump: loops
          else { this.animEnd(); this.frame = 0; }
        }
      } else {
        const tun = this.s.A[31];
        if (this.frame >= (tun ? tun.n : 7)) { this.turn = turnFrom(SEG_END[this.turn], this.dir); this.frame = 0; }   // FUN_00472070
      }
    }
    if (this.faceT > 0 && (this.faceT -= dt) < 1) { this.face = 0; this.faceT = 0; }
  }

  animEnd() {                                      // FUN_00472120
    const s = this.state;
    if (s === 5 || s === 8 || (s >= 10 && s <= 21)) return;      // rest, damage, walk: loop
    if (s === 7) { this.form = 1; this.state = 27; this.frame = 0; return; }   // lo1: the ball jumps out of the wreck
    if (this.dir >= 0 && this.dir <= 3) this.state = STOP_STATE[this.dir];
  }

  walkStep(dt) {                                   // FUN_00472520: runs while inactive too
    if (!this.moving || this.turn >= 1) return;
    const s = SPEED[this.speed], v = Math.min(dt * s, s * 1000);
    const tx = 40 * this.destC - 100, ty = 38 * this.destR - 217, x = this.x, y = this.y;
    let stop;
    switch (this.dir) {
      case 0: stop = tx < x + v; break;
      case 1: stop = ty < y + v; break;
      case 2: stop = x - v < tx; break;
      case 3: stop = y - v < ty; break;
      case 4: stop = y - v < ty || x - v < tx; break;
      case 5: stop = y - v < ty || tx < x + v; break;
      case 6: stop = tx < x + v || ty < y + v; break;
      case 7: stop = ty < y + v || x - v < tx; break;
      default: return;
    }
    if (stop) {                                    // short of the target; the next op snaps it
      this.moving = false; this.frame = 0;
      if (this.dir <= 3) this.state = STOP_STATE[this.dir];
      return;
    }
    const [dx, dy] = STEP[this.dir];
    this.moveBy(dx * v, dy * v);
  }

  // FUN_0041f300 (mode 3): the local player who touches the boss's body is stunned 1 s, then safe for 2 s
  contact(p, dt) {
    if (!p.stunned && p.bossImmune > 0) p.bossImmune -= dt;
    if (!p.active || p.out || p.state === 8 || p.bossImmune >= 1 || p.hasMount || p.reviveBlink
      || p.state === 4 || p.state === 5 || !this.touches(p)) return;
    p.state = 4; p.frame = 0; p.stunned = true; p.stunT = 0; p.bossImmune = 2000;
    sfx("Faint");
    this.world.send(new Writer(4).u8(0x94).i16(p.id).u8(0x63).done());
  }

  touches(p) {                                     // FUN_00470b70: a corner of the player in the body rectangle
    if (this.dead) return false;
    const inR = (x, y) => x >= this.hitL && x < this.hitR && y >= this.hitT && y < this.hitB;
    return inR(p.left, p.top) || inR(p.right, p.top) || inR(p.left, p.bottom) || inR(p.right, p.bottom);
  }

  earthSprites(kind) {                             // bombs of kind 4 (form A) and 5 (form B): idle, appearing
    const u = this.s ? this.s.ui : {};
    return kind === 4 ? [u.eb1, u.eb1d] : [u.eb2, u.eb2d];
  }

  // ------------------------------------------------------------------ drawing (FUN_0041b220, mode 3)
  drawBack(fb) {                                   // FUN_00470110(.., 1)
    fb.clear(0);
    const st = this.stage;
    if (!st) return;
    if (st.back01) fb.opaque(st.back01.r, 0, 0, 0);
    if (st.flow) fb.opaque(st.flow.r, this.flowFrame, 0, 0);
    for (const l of this.layers.slice(0, st.back.length)) if (l.spr) fb.opaque(l.spr.r, l.frame, l.x, l.y);
  }

  drawFront(fb) {                                  // FUN_00470110(.., 0): Back01 frame 1 and the front layers
    const st = this.stage;
    if (!st) return;
    if (st.back01) fb.opaque(st.back01.r, 1, 0, 0);
    for (const l of this.layers.slice(st.back.length)) if (l.spr) fb.opaque(l.spr.r, l.frame, l.x, l.y);
  }

  drawShadow(fb) {                                 // FUN_00471c60
    if (!this.active || !this.s) return;
    const sh = this.s.A[SHADOW];
    if (!sh) return;
    const sx = T(this.x) + 125, sy = T(this.y) + 260;
    if (this.state !== 9 && this.state !== 27 && this.state !== 28) fb.half(sh.r, 0, sx, sy);
    else fb.half(sh.r, 1, sx, sy + 20);
  }

  draw(fb) {                                       // FUN_00471790
    if (!this.active || !this.s) return;
    const X = T(this.x), Y = T(this.y), A = this.s.A, B = this.s.B;
    if (this.dead && this.state === 27 && B[7]) {  // the wreck lo1 leaves behind
      const lo = this.spr(this.form, 7);
      fb.opaque(B[7].r, (lo ? lo.n : B[7].n) - 1, X, Y);
    }
    let s;
    if (this.form === 0) {
      if (this.turn > 0) {                         // FUN_00471d80
        const t = A[SEG_SPRITE[this.turn]];
        if (t) { if (this.turn >= 9) fb.mirror(t.r, this.frame, X, Y, 400); else fb.opaque(t.r, this.frame, X, Y); }
        return;
      }
      s = A[this.state];
      if (!s) return;
      if (this.state === 9) s = B[9];              // the change is drawn from the other form's picture
    } else {
      s = B[this.state];
      if (!s) return;
      if (this.state === 9) s = A[9];
    }
    if (!s) return;
    if (this.state >= 10 && this.state <= 13) {    // hit: red, then 27/32 white, every 120 ms
      if (this.blink === 0) fb.alpha(s.r, this.frame, X, Y, 32, 0xf800);
      else fb.alpha(s.r, this.frame, X, Y, 27, 0xffff);
    } else fb.opaque(s.r, this.frame, X, Y);
  }

  // ------------------------------------------------------------------ result screens (FUN_00417860, mode 3)
  resultTick(dt) {                                 // FUN_00472030: BoA_sto_S at its own pace, frame +0x1c / clock +0x72
    const s = this.s && this.s.A[1];
    if (!s) return;
    this.resT = (this.resT || 0) + dt;
    if (this.resT >= s.period) { this.resT = 0; this.resFrame = ((this.resFrame || 0) + 1) % s.n; }
  }

  drawRoundResult(fb) {                            // a stage won: "Boss Lose" / "You Win!!" and the boss (FUN_00471f10)
    const u = this.s && this.s.ui;
    if (!u || !u.resMiddle) return false;
    fb.opaque(u.resMiddle.r, 0, 0, 0);
    if (u.resMiddleTxt) { fb.opaque(u.resMiddleTxt.r, 0, 0, 112); fb.opaque(u.resMiddleTxt.r, 1, 354, 112); }
    const s = this.s.A[1];
    if (s) fb.opaque(s.r, this.resFrame || 0, -66, 123);
    return true;
  }

  drawFinalResult(fb) {                            // the title, the board and the Earth Bomb, beaten (0) or not (1)
    const u = this.s && this.s.ui;
    if (!u || !u.resFinalTxt) return false;
    fb.opaque(u.resFinalTxt.r, 0, 0, 14);
    if (u.resBoard) fb.opaque(u.resBoard.r, 0, 8, 87);
    if (u.resEarth) fb.opaque(u.resEarth.r, this.hp < 1 ? 0 : 1, 29, 104);
    return true;
  }

  drawHud(fb) {                                    // FUN_004200e0 and the face (end of FUN_0041a540)
    const u = this.s && this.s.ui;
    if (!u || !u.board) return;
    const bb = u.board.r, H = u.board.r.h, d = this.disp, max = this.max, hp = this.hp;
    const t1 = max - 2 * Math.floor(max / 3), t2 = max - Math.floor(max / 3);
    const end = u.end && u.end.r;
    fb.half(bb, 5, 0, 450);
    fb.opaque(bb, 4, 0, 450);
    if (hp > t2) {
      fb.clip(bb, 2, 0, 450, 630, H); fb.clip(bb, 1, 0, 450, d + 60, H);
      if (d < BAR) fb.opaque(end, 0, d + 57, 566);
    } else if (hp > t1) {
      fb.clip(bb, 3, 0, 450, 630, H); fb.clip(bb, 2, 0, 450, d + 60, H);
      if (d < BAR) fb.opaque(end, 1, d + 57, 566);
    } else if (hp > 1) {
      fb.clip(bb, 3, 0, 450, d + 60, H);
      if (d < BAR) fb.opaque(end, 2, d + 57, 566);
    } else {                                       // the last hit point: the bar flashes red and white
      const [a, m] = this.hudFlash ? [32, 0xf800] : [27, 0xffff];
      fb.clip(bb, 3, 0, 450, d + 60, H, a, m);
      if (d < BAR) fb.alpha(end, 2, d + 57, 566, a, m);
    }
    fb.opaque(bb, 0, 0, 450);
    if (u.spark) fb.lighten(u.spark.r, this.sparkFrame, -10, 457);
    const face = this.faceSprite();
    if (face) fb.opaque(face.r, this.faceFrame, 5, 521);
  }
}

function turnFrom(oldDir, newDir) {
  return oldDir >= 0 && oldDir <= 3 && newDir >= 0 && newDir <= 3 ? TURN[oldDir][newDir] : 0;
}
