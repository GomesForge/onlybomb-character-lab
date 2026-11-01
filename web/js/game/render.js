// Match screen drawing in the original order (docs/client/F_render.md §5-§6, H_objects.md §2-§6).

import { A, loadAssets } from "./assets.js";
import { FB, Runs, EFT_STD, EFT_ITEM, SW, SH, SIDE } from "./fb565.js";
import { W, H } from "./mapdata.js";
import { T_SOFT, T_HARD, T_BORDER, PIECE_NONE, K_SOFT, K_BURNING } from "./objects.js";
import { SC_LOADING, SC_INTRO, SC_PLAY, SC_RESULT } from "./scenes.js";
import { loadRedBombs } from "./dropstage.js";
import { display, active } from "./display.js";
import { sideArt, sideFor, arenaSideFor, overlayFor, arenaSize, slotOf, GALAXY_SLOT } from "./sideart.js";
import { arenaBackground } from "./arenabg.js";
import { loadSprite } from "../assets/spr.js";
import { customPicture, customSideSlot } from "../session.js";

const T = Math.trunc;
const TX = (c) => 40 + 40 * c, TY = (r) => 28 + 38 * r;

// Village floor (DAT_004782f0): tile.spr frame per cell, 0 = not drawn
const VILLAGE = [];
{
  const road = [0, 10, 10, 10, 10, 7, 10, 10, 10, 10, 10, 7, 10, 10, 10, 10, 0];
  const cross = [0, 5, 5, 6, 5, 9, 5, 5, 6, 5, 5, 9, 5, 6, 5, 5, 0];
  const r7 = [0, 10, 10, 10, 10, 8, 10, 10, 10, 10, 10, 8, 10, 10, 10, 10, 0];
  for (let r = 0; r < 15; r++) {
    VILLAGE.push(r === 0 || r === 14 ? new Array(17).fill(0) : r === 5 || r === 9 ? cross : r === 7 ? r7 : road);
  }
}

// Block frames per design (FUN_00405190 / FUN_00405f60): soft body, hard body(v), soft shadow, hard shadow(v)
const BLOCKS = [
  { s: 15, h: () => 15, ss: 9, hs: () => 9, anim: true },
  { s: 0, h: () => 0, ss: 0, hs: () => 0 },
  { s: 1, h: () => 1, ss: 1, hs: () => 1 },
  { s: 5, h: () => 9, ss: 4, hs: () => 0 },
  { s: 2, h: (v) => 2 + v, ss: 2, hs: (v) => 2 + v },
  { s: 3, h: () => 7, ss: 3, hs: () => 5 },
  { s: 4, h: () => 8, ss: 4, hs: () => 6 },
  { s: 15, h: (v) => 19 + v, ss: 7, hs: () => 8 },
  { s: 13, h: () => 18, ss: 8, hs: () => 12 },
];
const SHADOW_COL15 = new Set([5, 11, 14, 15]);

function soccerPost(c, r) {                  // FUN_004108e0
  return (c === 1 || c === 15) && ((r >= 1 && r <= 4) || (r >= 10 && r <= 13));
}

// In-place Hoare quicksort of the original (FUN_0040e310): unstable, ties as the original.
function qsort(a, l, r) {
  for (;;) {
    const p = a[(l + r) >> 1].key;
    let i = l, j = r;
    while (i <= j) {
      while (a[i].key < p) i++;
      while (p < a[j].key) j--;
      if (j < i) break;
      const t = a[i]; a[i] = a[j]; a[j] = t;
      i++; j--;
    }
    if (l < j) qsort(a, l, j);
    l = i;
    if (r <= i) return;
  }
}

// A custom map's picture (the GM panel's PNG, the whole screen of its field) as the screen's RGB565 pixels, or null
// if it would not load
async function customPixels(c) {
  try {
    const d = await rgbaOf(customPicture(c, arenaSize(W, H)), SW, SH), px = new Uint16Array(SW * SH);
    for (let i = 0; i < px.length; i++) px[i] = ((d[4 * i] >> 3) << 11) | ((d[4 * i + 1] >> 2) << 5) | (d[4 * i + 2] >> 3);
    return px;
  } catch (e) {
    return null;
  }
}

async function rgbaOf(src, w, h) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const g = Object.assign(document.createElement("canvas"), { width: w || img.width, height: h || img.height })
    .getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, g.canvas.width, g.canvas.height);
  return g.getImageData(0, 0, g.canvas.width, g.canvas.height).data;
}

// A custom map's own block picture (40 px wide, standing on the cell's bottom edge) as the game's block sprites are
// drawn, at (40 x + 20, 38 y - 13): frame 0 its body (its pixels at least half opaque), frame 1 its shadow (all
// zero: drawn at 50 %, it halves what is under it) where the body moved 10 px right and 7 down would be and the body
// is not, down to the cell's bottom, as the game's shadows fall; null if it would not load.
const SHADOW_DX = 10, SHADOW_DY = 7;
async function customBlock(c, kind) {
  try {
    const d = await rgbaOf(customPicture(c, kind)), w = 40, h = d.length / 4 / w, top = 80 - h;
    const solid = (x, y) => x >= 0 && x < w && y >= 0 && y < h && d[4 * (y * w + x) + 3] >= 128;
    const body = [], shadow = [], px = [];
    const runs = (out, y, on, colour) => {
      for (let x = 0; x < w + SHADOW_DX; x++) {
        if (!on(x)) continue;
        const from = x, o = px.length;
        for (; x < w + SHADOW_DX && on(x); x++) px.push(colour(x));
        out.push(20 + from, top + y, x - from, o);
      }
    };
    for (let y = 0; y < h; y++) {
      runs(body, y, (x) => solid(x, y), (x) => { const i = 4 * (y * w + x); return ((d[i] >> 3) << 11) | ((d[i + 1] >> 2) << 5) | (d[i + 2] >> 3); });
      runs(shadow, y, (x) => !solid(x, y) && solid(x - SHADOW_DX, y - SHADOW_DY), () => 0);
    }
    return new Runs([Int32Array.from(body), Int32Array.from(shadow)], Uint16Array.from(px), 80, 80);
  } catch (e) {
    return null;
  }
}

export class Renderer {
  constructor(match) {
    this.match = match;
    this.fb = new FB();
  }

  async load() {
    await loadAssets();
    const w = this.match.world, mode = w.hyper || w.panel || w.boss || w.stage;
    if (mode) await mode.load(this.match.mapSet);
    if (w.drop) this.red = await loadRedBombs();   // Drop Bomb's red skull bomb and its landing mark
    if (w.bossItems) await w.bossItems.load();       // Boss Battle: item slots, special bombs, coins
    if (this.match.galaxy) {                         // Galaxy: the Korean MAP_09.spr and its pillars (rockets, 3
      const kr = (f) => loadSprite("kr/map/" + f).then((s) => Runs.fromSprite(s)).catch(() => null);   // frames)
      [this.galaxyBg, this.galaxyNon, this.galaxyNonSh] = await Promise.all([kr("MAP_09.spr"), kr("non.spr"), kr("non_sh.spr")]);
    }
    const c = this.match.custom;                  // (a picture that would not load: the theme's)
    if (c && !c.missing) {                        // (its screen without a picture: its blocks' map's, as that map's)
      [this.customPx, this.customSoft, this.customHard] = await Promise.all([c.pics[arenaSize(W, H)] && customPixels(c),
        c.soft ? customBlock(c, "soft") : null, c.hard ? customBlock(c, "hard") : null]);
    }
    await this.loadSideArt();
    if (w.arena) this.arenaBg();                     // (its scenery's seam insertion: while the match loads)
  }

  // The side art of the map's picture (sideart.js) for a battle: the exe field's (art), and in an arena its size's
  // own (own) if the map has one, else the field's grown (arenaSideFor); Galaxy's its own slots; none in the other
  // modes. A custom map: its own for the screen played, made for its own picture; without one, as its blocks' map's
  // (its own art first). Match.fitFrame decides whether the frame shows it (the page's shape, Options → Display).
  async loadSideArt() {
    const m = this.match, w = m.world, c = m.custom;
    const plain = !(w.hyper || w.panel || w.boss || w.stage);
    const size = arenaSize(W, H), slot = (z) => (m.galaxy ? GALAXY_SLOT + z : slotOf(w.design, z));
    const mine = c && !c.missing ? await sideArt(customSideSlot(c.map, size), size) : null;
    if (c && this.customPx) [this.art, this.own] = [mine, null];
    else if (c && !size) [this.art, this.own] = [mine || await sideArt(slot(0)), null];
    else if (plain) {
      [this.art, this.own] = await Promise.all([sideArt(slot(0)), size ? mine || sideArt(slot(size), size) : null]);
    } else [this.art, this.own] = [null, null];
  }

  get sideArt() { return active.sideArt ? this.own || this.art : null; }

  onMapChanged() {                          // later rounds keep their map set; reload the theme if it changes
    const w = this.match.world, mode = w.hyper || w.panel || w.boss || w.stage;   // (a boss match: the next cave)
    if (mode && mode.themeSet !== this.match.mapSet) { mode.themeSet = this.match.mapSet; mode.load(this.match.mapSet); }
    this.loadSideArt().then(() => {                          // another picture, other side art (or none)
      if (this.match.world.arena) this.arenaBg();
      this.match.fitFrame();
    });
  }

  // again: the same world drawn once more, between two steps (Smooth motion, match.js step)
  draw(screen, again = false) {
    const m = this.match, hud = m.hud;
    this.again = again;
    if (this.fb.sw !== SW || this.fb.sh !== SH || this.fb.side !== SIDE) this.newFrame();
    const fb = this.fb;
    fb.hdBlits.length = 0;                                   // (the HD characters this frame draws: screen.js)
    if (m.scene === SC_RESULT) {
      hud.drawResult(fb);
    } else {
      this.drawSides(fb);
      this.drawWorld(fb, m.scene);
      if (m.scene === SC_INTRO) hud.drawIntro(fb);
    }
    screen.present(fb);
  }

  // The frame changed size (fb565 SIDE: the page resized or turned, the side art on or off): a new buffer. On the
  // result screen, the world drawn once more and darkened again under it (Hud.snap).
  newFrame() {
    this.fb = new FB();
    if (this.match.scene !== SC_RESULT) return;
    this.drawSides(this.fb);
    this.drawWorld(this.fb, SC_PLAY);
    this.match.hud.snap(this.fb);
  }

  drawSides(fb) {
    const art = fb.side && this.sideArt;
    if (art) fb.sideArt(this.sideArtNow(art, fb.side), 0);
  }

  // The side art as wide as the frame's sides: in an arena without its own, the field's grown as its background is.
  sideArtNow(art, side) {
    return this.match.world.arena && art !== this.own ? arenaSideFor(art, side, this.arenaBg(), SW, SH) : sideFor(art, side);
  }

  // A web-only arena's background (arenaBackground), made again for another design, size or side art: with the
  // field's art to grow, unless the arena has its own (made for the plain background).
  arenaBg() {
    const design = this.match.world.design, key = `${design}:${W}x${H}`, grow = this.own ? null : this.art;
    if (this.arenaKey !== key || this.arenaGrown !== grow) {
      this.arenaKey = key;
      this.arenaGrown = grow;
      this.arenaBack = arenaBackground(this.bgFor(design), design, grow, W, H);
    }
    return this.arenaBack;
  }

  // the design's picture: Galaxy's for the "Random" slot's set on that map
  bgFor(design) { return design === 0 && this.galaxyBg ? this.galaxyBg : A.bgs[design]; }

  drawWorld(fb, scene) {
    const m = this.match, w = m.world, hud = m.hud;
    if (w.hyper) return this.drawHyperWorld(fb, scene);
    if (w.panel) return this.drawPanelWorld(fb, scene);
    if (w.boss) return this.drawBossWorld(fb, scene);
    if (w.stage) return this.drawStageWorld(fb, scene);
    const design = w.design, art = this.sideArt, own = this.customPx;
    // the map's picture, and its layers drawn again later (over the floor, the players): with side art, the art's
    // colours wherever it takes the picture's place (sideart.js overlayFor)
    const bg = this.bgFor(design), fg = art && !w.arena ? overlayFor(art, bg) : bg;
    // 1. background + floor (§5.3); the side art over the screen, on any page (with no room beside it too): still.
    // A custom map: its picture is the whole screen, the floor too
    const back = w.arena ? this.arenaBg() : null;
    this.still(fb, [design, back, bg, fg, art, own], () => {
      if (own) {
        fb.paste(own);
        if (art) fb.sideArt(sideFor(art, fb.side), 1);
        return;
      }
      if (back) {
        fb.paste(back.px);
        if (art) fb.sideArt(this.sideArtNow(art, fb.side), 1);
      } else {
        fb.opaque(bg, 0, 0, 0);
        if (art) fb.sideArt(sideFor(art, fb.side), 1);
      }
      // (side art with the map's floor too, made for this screen: its own floor, no tiles over it; grown onto an
      // arena, the field is the arena's: its tiles)
      if (!(art && art.floor && (!w.arena || art === this.own))) this.drawFloor(fb, design);
      if (design === 1 && !back) fb.opaque(fg, 2, 0, 0);
    });
    // (the crater's frames: before its floor in the exe, which has none)
    if (design === 0 && !back) {             // (Galaxy's lit pipes as they are, over side art too: they flash)
      const lit = m.galaxy ? bg : fg;
      if (w.animB === 1) fb.opaque(lit, 1, 0, 0); else if (w.animB === 3) fb.opaque(lit, 2, 0, 0);
    }
    if (design === 0) this.drawStars(fb);
    // 2. floor gimmicks — 3. Soccer goal nets
    w.gimmicks.drawFloor(fb);
    if (design === 8 && !w.arena) fb.opaque(fg, 2, 0, 0);
    // 4. explosions
    if (scene !== SC_LOADING) for (const E of w.explosions) this.drawExplosion(fb, E);
    // 5. y-sorted objects
    this.drawList(fb, scene);
    // 6. HUD top bar, 7. foreground
    hud.drawTopBar(fb);
    if ((design === 1 || design === 8) && !w.arena && !own) fb.opaque(fg, 1, 0, 0);
    // 8b. revenge carts, over the border and the foreground
    if (scene !== SC_LOADING) for (const p of w.players) if (p.active && p.inCart) p.drawCart(fb);
    // 9. flying bombs
    if (scene !== SC_LOADING) {
      for (const b of w.bombs) if (b.alive && b.state === 2) this.drawBomb(fb, b);
    }
    // 10.-12. HURRY, revive banner, chat
    hud.drawOverlays(fb, scene);
  }

  // The frame's still part (a map's picture with its floor tiles, the side art over it) is drawn once and copied in
  // after that, while what it is drawn from is the same (key: the same objects and values) and so are the border
  // cells, which the floors skip; another frame size (a new FB) draws it again. The same picture at the cost of one
  // copy: on a slow computer redrawing it every frame was a third of the drawing time. The screen's pixels it leaves
  // alone (the top bar's strip on most maps, ToyBox's odd pixel) keep what the frame had, as when it was redrawn:
  // found by drawing it once more over the opposite colours, kept as runs [start, end) of the frame's pixels.
  still(fb, key, draw) {
    const grid = this.match.world.grid, s = fb.still, px = fb.px;
    if (s && s.key.length === key.length && s.key.every((v, i) => v === key[i]) && s.border.length === grid.length
      && s.border.every((b, i) => b === (grid[i] === T_BORDER ? 1 : 0))) {
      const { holes, kept } = s;
      for (let k = 0, o = 0; k < holes.length; k += 2) {
        kept.set(px.subarray(holes[k], holes[k + 1]), o);
        o += holes[k + 1] - holes[k];
      }
      px.set(s.px);
      for (let k = 0, o = 0; k < holes.length; k += 2) {
        const n = holes[k + 1] - holes[k];
        px.set(kept.subarray(o, o + n), holes[k]);
        o += n;
      }
      return;
    }
    draw();
    const done = px.slice(), holes = [];
    for (let i = 0; i < px.length; i++) px[i] = ~done[i];
    draw();
    let n = 0;
    for (let y = 0; y < fb.sh; y++) {
      let run = -1;
      for (let i = y * fb.fw + fb.x0, e = y * fb.fw + fb.x1; i <= e; i++) {
        const hole = i < e && px[i] !== done[i];
        if (hole && run < 0) run = i;
        else if (!hole && run >= 0) { holes.push(run, i); n += i - run; run = -1; }
      }
    }
    px.set(done);
    fb.still = { key, px: done, holes: Int32Array.from(holes), kept: new Uint16Array(n),
      border: grid.map((t) => (t === T_BORDER ? 1 : 0)) };
  }

  drawHyperWorld(fb, scene) {               // FUN_0041d050, mode 2
    const m = this.match, w = m.world, hud = m.hud, hy = w.hyper;
    if (hy.theme) this.still(fb, hy.stillKey(), () => hy.drawStill(fb));   // 1. Back01, Tile01 checker (still) ...
    hy.drawGate(fb);                        //    ... and the Spaceship gate
    w.gimmicks.drawFloor(fb);               // 2. warps, the goal zone
    if (scene !== SC_LOADING) for (const E of w.explosions) this.drawExplosion(fb, E);
    this.drawList(fb, scene);               // 5. y-sorted objects (with the drills)
    hy.drawBoom(fb);                        // 7. map boom after a goal
    hy.drawForeground(fb);                  // 8. Back01 frame 1 + theme animations
    if (scene !== SC_LOADING) {             // 10. flying bombs
      for (const b of w.bombs) if (b.alive && b.state === 2) this.drawBomb(fb, b);
    }
    hud.drawTopBar(fb);                     // 11. modes 1/2 draw the top bar here
    hud.drawOverlays(fb, scene);
  }

  drawPanelWorld(fb, scene) {               // FUN_0041d050, mode 1
    const m = this.match, w = m.world, hud = m.hud, pa = w.panel;
    if (pa.theme) this.still(fb, pa.stillKey(), () => pa.drawStill(fb));   // 1. Back01, the neutral floor (still) ...
    pa.drawCounts(fb);                      //    ... and the count tiles
    w.gimmicks.drawFloor(fb);               // 2. warps (WarpTile), arrows
    if (scene !== SC_LOADING) for (const E of w.explosions) this.drawExplosion(fb, E);
    this.drawList(fb, scene);               // 5. panels, shadows, bodies
    pa.drawForeground(fb);                  // 8. Back01 frame 1
    if (scene !== SC_LOADING) {             // 10. flying bombs
      for (const b of w.bombs) if (b.alive && b.state === 2) this.drawBomb(fb, b);
    }
    pa.drawOverlay(fb);                     // 11. Boxing ropes / Airport planes, then the top bar + ranking
    hud.drawTopBar(fb);
    hud.drawOverlays(fb, scene);
  }

  drawBossWorld(fb, scene) {                // KR FUN_0041b220, mode 3 (K_boss.md §4.1)
    const m = this.match, w = m.world, hud = m.hud, bo = w.boss;
    bo.drawBack(fb);                        // 1. Back01 frame 0 + the cave's layers
    w.gimmicks.drawFloor(fb);               // 2. (the caves have no map objects)
    if (scene !== SC_LOADING) for (const E of w.explosions) this.drawExplosion(fb, E);   // 3. fire under everything
    this.drawList(fb, scene);               // 4. y-sorted objects, the boss among them
    bo.drawFront(fb);                       // 5. Back01 frame 1 + the front layers
    if (w.bossItems) w.bossItems.drawPopups(fb);   //    the "+N" of picked coins
    if (scene !== SC_LOADING) {             // 6. flying bombs
      for (const b of w.bombs) if (b.alive && b.state === 2) this.drawBomb(fb, b);
    }
    hud.drawTopBar(fb);                     // 7. HUD, the boss's HP board and face at its end
    bo.drawHud(fb);
    hud.drawOverlays(fb, scene);
  }

  drawStageWorld(fb, scene) {               // Drop Bomb stages (dropstage.js), in the order of the Hyper Bomb themes
    const m = this.match, w = m.world, hud = m.hud, st = w.stage;
    st.drawBack(fb);                        // 1. background, floor and grid, the frame round the field
    if (scene !== SC_LOADING) for (const E of w.explosions) this.drawExplosion(fb, E);
    this.drawList(fb, scene);               // 2. y-sorted objects: the pillars among them
    st.drawFront(fb);                       // 3. the frame's front strip
    if (scene !== SC_LOADING) {             // 4. flying bombs
      for (const b of w.bombs) if (b.alive && b.state === 2) this.drawBomb(fb, b);
    }
    hud.drawTopBar(fb);
    hud.drawOverlays(fb, scene);
  }

  // The "Random" slot's sets 0/9/18 (Space): 100 stars flying out of the screen centre over the crater, moved once per
  // drawn frame, not per ms (F_render §9.3, FUN_0041ade0 / FUN_0041ad40 / FUN_0041af50); a frame drawn again between
  // two steps (Smooth motion) does not move them, so they keep the exe's speed.
  drawStars(fb) {
    const pm = (n) => (Math.random() < 0.5 ? -1 : 1) * Math.floor(Math.random() * n);
    const star = (s = {}) => Object.assign(s, { x: pm(140), y: pm(140), z: pm(40) });
    if (!this.stars) this.stars = Array.from({ length: 100 }, () => star());
    const cx = SW >> 1, cy = SH >> 1;
    for (const s of this.stars) {
      fb.pset(T(cx + 100 * s.x / (s.z + 100)), T(cy + 100 * s.y / (s.z + 100)), 0xffff);
      if (this.again) continue;
      s.z -= 2;
      if (s.z <= -100) star(s);
    }
  }

  drawFloor(fb, design) {                   // FUN_0041b950 / FUN_0041b8d0
    const w = this.match.world, tile = A.tile;
    if (design === 0 || design === 8) return;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (design === 4) {                  // (an arena: the plain road tile inside the border)
          const f = w.arena ? (w.grid[r * W + c] === T_BORDER ? 0 : 10) : VILLAGE[r][c];
          if (f) fb.opaque(tile, f, TX(c), TY(r));
          continue;
        }
        if (w.grid[r * W + c] === T_BORDER) continue;
        const same = (r & 1) === (c & 1);
        const f = design === 1 ? (same ? 0 : 1) : design === 2 ? (same ? 2 : 3) : design === 3 ? 4
          : design === 5 ? (same ? 12 : 13) : design === 6 ? 14 : (same ? 18 : 19);
        fb.opaque(tile, f, TX(c), TY(r));
      }
    }
  }

  drawExplosion(fb, E) {                     // FUN_0040c950
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) this.drawFlameCell(fb, E, c, r);
  }

  drawFlameCell(fb, E, c, r) {
    if (c < 0 || c >= W || r < 0 || r >= H) return;
    if (!this.match.world.gimmicks.cellVisible(c, r)) return;
    const i = r * W + c, p = E.piece[i];
    // the fire of a player's bomb skin, unless this player chose the game's own for every bomb (Options → Display)
    const skin = !display.classicFire && E.by && E.by[i] >= 0 ? this.match.skinOf(E.by[i]) : null;
    if (p !== PIECE_NONE) fb.eft((skin && skin.flames[p]) || A.flames[p], E.frame, TX(c), TY(r), EFT_STD);
    const k = E.kind[i];
    if ((k === K_SOFT || k === K_BURNING) && E.frame < 9) {
      fb.eft((skin && skin.boom) || A.boom_block, E.frame, TX(c) - 50, TY(r) - 114, EFT_STD);
    }
  }

  drawList(fb, scene) {                     // FUN_0040df10 + FUN_00422140
    const w = this.match.world, list = [];
    const showActors = scene !== SC_LOADING;
    if (w.panel) for (const pn of w.panel.panels.values()) list.push({ key: pn.y * 6, type: 0x15, o: pn });
    if (showActors) {
      for (const mk of w.markers) list.push({ key: mk.y * 6 + 1, type: 5, o: mk });
      for (const b of w.bombs) if (b.alive && b.state !== 2) list.push({ key: b.y * 6 + 1, type: 1, o: b });
    }
    for (const blk of w.blocks.values()) list.push({ key: blk.y * 6 + 2, type: 2, o: blk });
    for (const d of w.gimmicks.drills) list.push({ key: d.y * 6 + 2, type: 0x17, o: d });
    if (showActors) for (const p of w.players) if (p.active && !p.out && p.state !== 8) list.push({ key: p.ty * 6 + 3, type: 0, o: p });
    for (const it of w.items.values()) list.push({ key: it.y * 6 + 4, type: 3, o: it });
    if (w.hyper) for (const it of w.hyper.flying) list.push({ key: it.y * 6 + 4, type: 3, o: it });
    for (const t of w.gimmicks.tunnels) list.push({ key: t.y * 6 + 11, type: 9, o: t });
    if (w.boss) list.push({ key: w.boss.row * 6 + 11, type: 0x18, o: w.boss });   // KR FUN_00409fd0, mode 3
    if (list.length > 1) qsort(list, 0, list.length - 1);
    const design = w.design;
    // pass 1: PanelPaint panels, each followed by the flames of its cell (FUN_0040d0b0)
    if (w.panel) {
      for (const e of list) {
        if (e.type !== 0x15) continue;
        w.panel.drawPanel(fb, e.o);
        if (scene !== SC_LOADING) for (const E of w.explosions) this.drawFlameCell(fb, E, e.o.x, e.o.y);
      }
    }
    // pass 2: shadows
    for (const e of list) {
      if (e.type === 0) e.o.drawShadow(fb);
      else if (e.type === 2) this.drawBlockShadow(fb, e.o, design);
      else if (e.type === 9) w.gimmicks.drawTunnelShadow(fb, e.o);
      else if (e.type === 0x17) w.hyper.drawDrillShadow(fb, e.o);
      else if (e.type === 0x18) e.o.drawShadow(fb);
    }
    // pass 3: bodies
    for (const e of list) {
      switch (e.type) {
        case 0:
          e.o.drawBody(fb);
          if (w.bossItems) w.bossItems.drawEffect(fb, e.o);   // an item's effect over its user (KR FUN_0042c410)
          e.o.drawName(fb); this.match.hud.drawYouArrow(fb, e.o);
          break;
        case 1: this.drawBomb(fb, e.o); break;
        case 2: this.drawBlock(fb, e.o, design); if (w.panel) w.panel.drawBoxingRope(fb, e.o); break;
        case 3: this.drawItem(fb, e.o); break;
        case 5: this.drawMarker(fb, e.o); break;
        case 9: w.gimmicks.drawTunnel(fb, e.o); break;
        case 0x17: w.hyper.drawDrill(fb, e.o); break;
        case 0x18: e.o.draw(fb); break;
      }
    }
  }

  blockVisible(blk, design) {
    const t = this.match.world.tile(blk.x, blk.y);
    if (t !== T_SOFT && t !== T_HARD) return false;
    if (design === 8 && blk.type === 1 && soccerPost(blk.x, blk.y)) return false;
    return this.match.world.gimmicks.cellVisible(blk.x, blk.y);
  }

  drawBlockShadow(fb, blk, design) {        // FUN_00405f60 (battle: opaque dark sprites)
    if (this.match.world.stage) return;     // the Drop Bomb stages' pillars have none
    if (!this.blockVisible(blk, design) || blk.falling) return;
    const th = this.hyperTheme();
    if (th) {                                // Hyper: Soft01_S / Hard01_S at 50 %
      const soft = blk.type === 0;
      fb.half(soft ? th.soft_s : th.hard_s, soft ? blk.vSoft : blk.vHard, 40 * blk.x + 20, 38 * blk.y - 13);
      for (const E of this.match.world.explosions) {
        this.drawFlameCell(fb, E, blk.x + 1, blk.y);
        this.drawFlameCell(fb, E, blk.x + 1, blk.y - 1);
      }
      return;
    }
    // none over the border ring at the right (but on four maps); a custom map's: none over a wall at the right
    if (this.match.custom ? this.match.world.tile(blk.x + 1, blk.y) === T_BORDER
      : blk.x === W - 2 && !SHADOW_COL15.has(this.match.world.mapSet)) return;
    const d = BLOCKS[design], a = this.match.world.animA;
    const soft = blk.type === 0, own = soft ? this.customSoft : this.customHard;
    if (own) fb.half(own, 1, 40 * blk.x + 20, 38 * blk.y - 13);
    else {
      const f = d.anim ? d.ss + a : soft ? d.ss : d.hs(blk.vHard);
      fb.opaque(soft && !d.anim ? A.pp_sh : (d.anim && this.galaxyNonSh) || A.non_sh, f, 40 * blk.x + 20, 38 * blk.y - 13);
    }
    for (const E of this.match.world.explosions) {   // flames right of the block are redrawn over the shadow
      this.drawFlameCell(fb, E, blk.x + 1, blk.y);
      this.drawFlameCell(fb, E, blk.x + 1, blk.y - 1);
    }
  }

  hyperTheme() {                            // Hyper and PanelPaint blocks: Soft01 / Hard01 (+ _S at 50 %)
    const w = this.match.world, mode = w.hyper || w.panel;
    return mode ? mode.theme : null;
  }

  drawBlock(fb, blk, design) {              // FUN_00405190
    if (this.match.world.stage) return this.match.world.stage.drawBlock(fb, blk);
    if (!this.blockVisible(blk, design)) return;
    const th = this.hyperTheme();
    if (th) {                                // Hyper: Soft01 / Hard01, opaque
      const soft = blk.type === 0;
      fb.opaque(soft ? th.soft : th.hard, soft ? blk.vSoft : blk.vHard, 40 * blk.x + 20, 38 * blk.y - 13 - T(blk.fallH));
      return;
    }
    const d = BLOCKS[design], a = this.match.world.animA;
    const soft = blk.type === 0, own = soft ? this.customSoft : this.customHard;   // a custom map's own block
    if (own) return fb.opaque(own, 0, 40 * blk.x + 20, 38 * blk.y - 13 - T(blk.fallH));
    const f = d.anim ? d.s + a : soft ? d.s : d.h(blk.vHard);
    fb.opaque(soft && !d.anim ? A.pp : (d.anim && this.galaxyNon) || A.non, f, 40 * blk.x + 20, 38 * blk.y - 13 - T(blk.fallH));
  }

  drawBomb(fb, b) {                         // FUN_00407080 / FUN_00407820
    if (this.match.world.panel) return this.match.world.panel.drawBomb(fb, b, b.state === 2 ? b.height : 0);
    const sx = T(b.px), sy = T(b.py);
    const eb = (b.kind === 4 || b.kind === 5) && this.match.world.boss ? this.match.world.boss.earthSprites(b.kind) : null;   // earth bombs
    const red = b.kind === 3 && this.match.world.drop ? this.red : null;   // Drop Bomb: the red skull bomb
    const it = b.kind >= 6 && this.match.world.bossItems ? this.match.world.bossItems.bombSprites(b.kind) : null;
    const skin = b.kind === 0 && !eb && !it ? this.match.skinOf(b.owner) : null;   // the owner's bomb skin
    const idle = eb ? eb[0] && eb[0].r : red ? red.bomb : it ? it[0] && it[0].r
      : (skin && skin.idle) || [A.bomb, A.pbomb, A.bbomb, A.dbomb][b.kind] || A.bomb;
    const shadow = (skin && skin.shadow) || A.bomb_s, spark = (skin && skin.fuse) || A.bomb_f;
    // ... and where it is going to land, while it falls (trace.spr: 6 frames over the 1.2 s fall, ours)
    if (red && b.state === 4 && b.skyH > 0) fb.add(red.trace, Math.min(5, Math.trunc((300 - b.skyH) / 50)), sx, sy - 7);
    if (b.state === 2) fb.half(shadow, 0, sx, sy - 25);
    else fb.half(shadow, 0, sx, sy - 7);
    const fuse = b.kind === 0 || b.kind === 3;
    switch (b.state) {
      case 0: case 1:
        fb.opaque(idle, b.frame, sx, sy - 7);
        if (fuse) fb.eft(spark, Math.min(b.frame, 3), sx, sy - 7, EFT_STD);
        break;
      case 2:
        fb.opaque(idle, b.frame, sx, sy - 7 - b.height);
        if (fuse) fb.eft(spark, Math.min(b.frame, 3), sx, sy - 7 - b.height, EFT_STD);
        break;
      case 4:
        if (eb) fb.opaque(eb[1] && eb[1].r, b.frame, sx, sy - 7);
        else if (it) fb.opaque(it[1] && it[1].r, b.frame, sx, sy - 7);   // Boss Battle item bombs appearing
        else if (b.kind === 0) fb.opaque((skin && skin.idle) || A.bomb, b.frame, sx, sy - 7);
        else if (b.kind < 3) fb.opaque([null, A.pbomb_d, A.bbomb_d][b.kind], b.frame, sx, sy - 7);
        else fb.opaque(red ? red.fall : A.dbomb_d, b.frame + 3, sx, sy - 7 - b.skyH);
        break;
    }
  }

  drawMarker(fb, mk) {                      // FUN_0040b020
    const sx = T(mk.px), sy = T(mk.py);
    const pa = this.match.world.panel, me = this.match.world.me;
    const skin = mk.kind === 0 && me && !pa ? this.match.skinOf(me.id) : null;      // a marker is always my bomb
    fb.half((skin && skin.shadow) || A.bomb_s, 0, sx, sy - 7);
    if (pa && pa.shared && me) { fb.opaque(pa.shared.bombD[me.team] || pa.shared.bombD[0], mk.frame, sx, sy - 7); return; }
    fb.opaque((skin && skin.marker) || [A.bomb_d, A.pbomb_d, A.bbomb_d][mk.kind] || A.bomb_d, mk.frame, sx, sy - 7);
  }

  drawItem(fb, it) {                        // FUN_00412660 (a part thrown by 0xaa is drawn where it flies)
    if (it.hidden) return;
    const x = it.x, y = it.y;
    const px = it.flying ? T(it.px) : 40 * x + 20, py = it.flying ? T(it.py) : 38 * y - 7;
    if (it.state === 0 && it.effOn && !it.wait) fb.eft(A.createitem, it.effFrame, 40 * x + 20, 38 * y - 14, EFT_ITEM);
    if (it.state === 1 || it.visible) {
      fb.half(A.item_sh, 0, px + 20, py + 35);
      fb.half(A.item_sh, 0, TX(x), TY(y));
      if (it.spr !== undefined) fb.opaque(it.spr, it.frame, px + 24, py + 17);   // a Boss Battle coin or bag
      else if (it.type === 8) fb.opaque(A.items[8], 0, TX(x), TY(y));
      else fb.opaque(A.items[it.type], it.frame, px + 24, py + 17);
    }
  }
}
