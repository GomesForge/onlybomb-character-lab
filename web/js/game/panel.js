// Panel Attack (game mode 1, map sets 28..35): the floor panels that fire paints in the bomb owner's colour,
// the recoloured bombs with their 3-2-1 countdown, the count tiles of Factory (0xca / 0xcb), the ranking at the
// left and over the players, and the theme graphics. docs/client/F_render.md §5.4; FUN_00460090 & co.,
// FUN_00410330 (panels), FUN_00461500 / FUN_00461660 (paint, flip), FUN_00460ff0 / FUN_00460c50 / FUN_00460ea0
// (ranking), FUN_0045fe80 (count tiles), FUN_00461370 (Boxing / Airport overlays).

import { loadSprite } from "../assets/spr.js";
import { Runs, EFT_STD, rgb565 } from "./fb565.js";
import { A } from "./assets.js";
import { SET_FACE } from "./characters.js";
import { W, H } from "./mapdata.js";
import { T_FLOOR, T_SOFT, T_BOMB, Bomb } from "./objects.js";

const T = Math.trunc;
export const MODE_PANEL = 1;
export const COUNT_KIND = 100;                     // a count tile's bomb: invisible, not one of the owner's
export const isPanelMap = (m) => m >= 28 && m <= 35;

// app2+0x414: neutral, then the 6 paint colours (bombs use the 6 without the neutral one, +0x418)
export const PAINT = [[128, 128, 128], [255, 50, 50], [0, 100, 255], [80, 255, 30], [255, 130, 50], [150, 30, 150],
  [255, 220, 0]];
export const PAINT565 = PAINT.map(([r, g, b]) => rgb565(r, g, b));
const THEME_DIR = { 28: "01_Circus", 29: "02_Space", 30: "03_Factory", 31: "04_Stadium", 32: "05_BeadPark",
  33: "06_Quiz", 34: "07_Boxing", 35: "08_Airport" };
const TWO_TILES = new Set([31, 32]);               // Stadium, BeadPark: tile01 / tile02 on odd / even columns
const ARROW_FILES = ["arrow_s.gra", "arrow_w.gra", "arrow_n.gra", "arrow_e.gra"];   // dir 0 down .. 3 right
const FLIP_MS = 40;                                // panel flip: one frame per 40 ms (+0x4a = 0x28)
const COUNT_MS = 150;                              // bomb countdown frame (+0x36a = 0x96)

const load = (path) => loadSprite(path).then((s) => Runs.fromSprite(s)).catch(() => null);
const copies = (r, from = 0) => (r ? PAINT.slice(from).map(([R, G, B]) => r.tinted(R, G, B)) : []);

let shared = null;
function loadShared() {                            // FUN_004150f0 (PanelPaint part) + FUN_004609a0
  if (!shared) {
    shared = (async () => {
      const [bomb, bombD, count, warp, rank, rankBack, ...arrows] = await Promise.all([
        load("PanelPaint/bomb.gra"), load("PanelPaint/BOMB_D.GRA"), load("PanelPaint/COUNTTILE.SPR"),
        load("PanelPaint/WARPTILE.SPR"), load("PanelPaint/rank.spr"), load("PanelPaint/RANK_BACK.SPR"),
        ...ARROW_FILES.map((f) => load("PanelPaint/" + f))]);
      return { bomb: copies(bomb, 1), bombD: copies(bombD, 1), count, warp, rank, rankBack,
        arrows: arrows.map((r) => copies(r)) };
    })();
  }
  return shared;
}

const themes = new Map();
function loadTheme(mapSet) {                       // FUN_00460590 / FUN_00460240 / FUN_00460200 / FUN_00460090
  if (!themes.has(mapSet)) {
    const dir = "PanelPaint/" + THEME_DIR[mapSet] + "/";
    themes.set(mapSet, (async () => {
      const two = TWO_TILES.has(mapSet);
      const [back, tile, tile2, hard, soft, hard_s, soft_s, etc] = await Promise.all([
        load(dir + "Back01.spr"), load(dir + (two ? "tile01.gra" : "Tile.gra")), two ? load(dir + "tile02.gra") : null,
        load(dir + "Hard01.spr"), load(dir + "Soft01.spr"), load(dir + "Hard01_S.spr"), load(dir + "Soft01_S.spr"),
        mapSet === 34 || mapSet === 35 ? load(dir + "Etc01.spr") : null]);
      return { back, tile: copies(tile), tile2: two ? copies(tile2) : null, hard, soft, hard_s, soft_s, etc };
    })());
  }
  return themes.get(mapSet);
}

export class Panel {
  constructor(world) {
    this.world = world;
    this.theme = null; this.themeSet = -1; this.shared = null;
    this.panels = new Map();                       // cell index -> panel (DAT_005190d8)
    this.counts = [0, 0, 0, 0, 0, 0];              // app2+0x430: panels per player slot
    this.ranks = [0, 0, 0, 0, 0, 0];               // app2+0x448
    this.maxRank = 0;                              // app2+0x460
    this.etcFrame = 0; this.etcT = 0;              // app2+0x464 (Airport planes)
    // FUN_004173e0: in Panel Attack a player without a team paints with its slot; any such player makes the
    // ranking per player (app+0x1e7 = 0), otherwise it is per team
    this.teamRanking = world.players.every((p) => p.team >= 0);
    for (const p of world.players) if (p.team < 0) p.team = p.slot;
  }

  async load(mapSet) {
    this.themeSet = mapSet;
    [this.shared, this.theme] = await Promise.all([loadShared(), loadTheme(mapSet)]);
  }

  // ------------------------------------------------------------------ panels (FUN_00410330)
  reset() {
    const w = this.world, g = w.gimmicks;
    this.panels.clear();
    for (let i = 0; i < W * H; i++) {
      const t = w.grid[i], x = i % W, y = Math.floor(i / W);
      if (t !== T_FLOOR && t !== T_SOFT) continue;
      if (g.warpIndexAt(x, y) >= 0 || g.countTiles.some((c) => c.x === x && c.y === y)) continue;
      const arrow = g.arrows.find((a) => a.x === x && a.y === y) || null;
      const kind = arrow ? "arrow" : TWO_TILES.has(w.mapSet) && (x & 1) === 0 ? "tile2" : "tile";
      this.panels.set(i, { x, y, owner: -1, slot: 0, colour: 0, frame: 0, t: 0, flip: false, kind, arrow });
    }
    this.etcFrame = 0; this.etcT = 0;
    this.rank();
  }

  paint(x, y, owner) {                             // FUN_00461500(panel, owner, 1)
    const pn = this.panels.get(y * W + x);
    if (!pn) return;
    pn.owner = owner;
    const p = owner === -1 ? null : this.world.players.find((q) => q.id === owner);
    if (p) { pn.slot = p.slot + 1; pn.colour = p.team + 1; } else { pn.slot = 0; pn.colour = 0; }
    pn.flip = true;
  }

  wipe(id) {                                       // 0x6c in mode 1: the victim's panels turn neutral
    for (const pn of this.panels.values()) if (pn.owner === id) this.paint(pn.x, pn.y, -1);
  }

  update(dt) {
    for (const pn of this.panels.values()) {       // FUN_00461660
      if (!pn.flip) { pn.frame = 0; pn.t = 0; continue; }
      const n = this.sprite(pn)?.n || 12;
      pn.t += dt;
      if (pn.t >= FLIP_MS) {
        pn.t -= FLIP_MS; pn.frame++;
        if (pn.t >= FLIP_MS) { pn.t -= FLIP_MS; pn.frame++; }
        if (pn.frame >= n) { pn.frame = 0; pn.t = 0; pn.flip = false; }
      }
    }
    if (this.world.mapSet === 35) {                // FUN_00461320: Airport planes, 100 ms
      this.etcT += dt;
      if (this.etcT > 100) {
        this.etcT -= 100;
        if (++this.etcFrame >= (this.theme?.etc?.n || 1)) this.etcFrame = 0;
      }
    }
    this.rank();
  }

  rank() {                                         // FUN_00460ff0
    const ps = this.world.players;
    this.counts.fill(0);
    for (const pn of this.panels.values()) if (pn.slot) this.counts[pn.slot - 1]++;
    this.ranks.fill(0);
    const live = (i) => ps[i] && ps[i].active;
    if (!this.teamRanking) {
      for (let i = 0; i < 6; i++) for (let j = i; j < 6; j++) {
        if (!live(i) || !live(j)) continue;
        if (this.counts[j] < this.counts[i]) this.ranks[j]++;
        else if (this.counts[i] < this.counts[j]) this.ranks[i]++;
      }
    } else {
      const tot = [0, 0, 0], tr = [0, 0, 0];
      for (let i = 0; i < 6; i++) if (live(i) && ps[i].team >= 0 && ps[i].team < 3) tot[ps[i].team] += this.counts[i];
      for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) {
        if (tot[j] < tot[i]) tr[j]++; else if (tot[i] < tot[j]) tr[i]++;
      }
      for (let i = 0; i < 6; i++) if (live(i)) this.ranks[i] = tr[ps[i].team] ?? 0;
    }
    this.maxRank = Math.max(...this.ranks);
  }

  // ------------------------------------------------------------------ count tiles (0xca / 0xcb)
  event(op, pkt) {
    const v = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
    const s = (k) => (pkt.length >= 2 * k + 2 ? v.getInt16(2 * k, true) : 0);
    if (pkt[1] !== 0) return true;                 // the client compares the whole first u16 with the opcode
    const c = this.world.gimmicks.countTiles.find((q) => q.x === s(3) && q.y === s(4));
    if (!c) return true;
    if (op === 0xca) { c.state = s(5) & 0xff; c.owner = s(6); return true; }
    if (op === 0xcb) this.countBomb(s(1), s(2), c.x, c.y);   // FUN_00461260 -> FUN_0040e5c0(.., 15, x, y, 100)
    return true;
  }

  countBomb(id, owner, x, y) {                     // like 0x68, but kind 100: nobody's bomb count goes up
    const w = this.world;
    if (w.tile(x, y) !== T_FLOOR || w.gimmicks.padAt(x, y) >= 0) return;
    for (const p of w.playersOn(x, y)) { p.bombOK = true; p.bombX = x; p.bombY = y; }
    w.bombs.push(new Bomb(w, id, owner, x, y, 15, COUNT_KIND));
    w.setTile(x, y, T_BOMB);
  }

  // ------------------------------------------------------------------ drawing
  sprite(pn) {
    const th = this.theme, sh = this.shared;
    if (!th) return null;
    if (pn.kind === "arrow" && sh) return sh.arrows[pn.arrow.dir]?.[pn.colour] || null;
    return (pn.kind === "tile2" ? th.tile2 : th.tile)?.[pn.colour] || null;
  }

  // The background (mode 1 of FUN_0041d050 step 1) in two parts: Back01 and the neutral floor tile, still (drawn once
  // and copied in after that: render.js still, while stillKey and the border cells are the same) ...
  drawStill(fb) {
    const th = this.theme, w = this.world;
    if (!th) return;
    fb.opaque(th.back, 0, 0, 0);
    const floor = th.tile && th.tile[0];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (w.grid[r * W + c] !== 5) fb.opaque(floor, 0, 40 + 40 * c - 20, 28 + 38 * r - 43);
    }
  }

  stillKey() { const th = this.theme; return [th, th && th.back, th && th.tile && th.tile[0]]; }

  // ... and the count tiles over it
  drawCounts(fb) {
    const w = this.world;
    if (!this.theme) return;
    const cs = this.shared && this.shared.count;
    for (const ct of w.gimmicks.countTiles) {      // FUN_0045fe80: 1, 2, 3, or the skull
      const f = ct.state === 0 || ct.state - 1 > 3 ? 3 : ct.state - 1;
      fb.opaque(cs, f, 40 + 40 * ct.x - 20, 28 + 38 * ct.y - 42);
    }
  }

  warpSprite() { return this.shared ? this.shared.warp : null; }

  drawPanel(fb, pn) {                              // FUN_004615b0, pass 1, then the flames of that cell again
    fb.opaque(this.sprite(pn), pn.frame, 40 * pn.x + 20, 38 * pn.y - 14);
  }

  drawBomb(fb, b, height) {                        // FUN_00407080, mode 1
    if (b.kind === COUNT_KIND) return;
    const sx = T(b.px), sy = T(b.py), sh = this.shared;
    fb.half(A.bomb_s, 0, sx, b.state === 2 ? sy - 25 : sy - 7);
    const o = this.world.players.find((p) => p.active && p.id === b.owner);
    const k = o ? (o.team >= 0 ? o.team : o.slot) : 0;
    if (!sh) return;
    if (b.state === 4) { fb.opaque(sh.bombD[k], b.frame, sx, sy - 7); return; }
    fb.opaque(sh.bomb[k], b.countFrame, sx, sy - 7 - height);
    fb.eft(A.bomb_f, Math.min(b.frame, 3), sx, sy - 7 - height, EFT_STD);
  }

  drawForeground(fb) {
    const th = this.theme;
    if (th && th.back && th.back.n > 1) fb.opaque(th.back, 1, 0, 0);
  }

  drawBoxingRope(fb, blk) {                        // pass 3: after the blocks at (7..9, 8) of Boxing
    if (this.world.mapSet === 34 && blk.y === 8 && blk.x >= 7 && blk.x <= 9 && this.theme) fb.opaque(this.theme.etc, 0, 252, 115);
  }

  drawOverlay(fb) {                                // FUN_00461370
    const w = this.world, e = this.theme && this.theme.etc;
    if (!e) return;
    if (w.mapSet === 34) fb.opaque(e, 1, 252, 115);
    else if (w.mapSet === 35) {
      const k = this.etcFrame, n = e.n;
      fb.opaque(e, k, 30, -110); fb.opaque(e, n - k, 530, -110);
      fb.opaque(e, k, -55, 440); fb.opaque(e, n - k, 615, 440);
    }
  }

  drawRanking(fb, hud) {                           // FUN_00460c50 + FUN_00460ea0, with the HUD top bar
    const ps = this.world.players;
    for (let i = 0, y = 0x80; i < 6 && y <= 0x241; i++, y += 0x4b) {
      const p = ps[i];
      if (!p || !p.active) continue;
      if (p.set) fb.opaque(p.set[SET_FACE], p.char >= 6 ? p.char - 5 : 0, 10, y - 0x26);
      hud.nameText(fb, p, 0x11, y - 0x30, p.nick);
      const d = String(this.counts[i]);
      const xs = d.length === 1 ? [0x2d] : d.length === 2 ? [0x1e, 0x2c] : [0x0f, 0x1e, 0x2c];
      for (let k = 0; k < xs.length; k++) fb.opaque(A.num_s, Number(d[k]), xs[k], y);
    }
    const sec = Math.max(0, hud.timer) % 60 % 10;
    if (sec < 7 || sec > 8 || !this.shared) return;
    for (let i = 0; i < 6; i++) {                  // 2 s out of every 10: "1st".."last" over every player
      const p = ps[i];
      if (!p || !p.active) continue;
      const r = this.ranks[i];
      fb.half(this.shared.rankBack, 0, p.cx - 30, p.cy);
      fb.opaque(this.shared.rank, r < this.maxRank || r < 1 ? r : 5, p.cx - 30, p.cy);
    }
  }
}
