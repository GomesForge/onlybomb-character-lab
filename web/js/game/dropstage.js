// Drop Bomb's own stages (server extension, web only): map sets 44 Grand Blue and 45 Matrix, the open 13x9 arena with
// 24 pillars that every client's block.spr / map.spr has, and Drop Bomb's red skull bomb with its landing mark.
// The graphics are only in the Korean client's Data/DropBomb, and none of the clients we have draws them. Their
// files follow the Hyper Bomb themes (a background, the frame round the field and its front strip; Tile01 = floor +
// grid; Hard01 = the pillars), so they are drawn like those; where the props go and how they move is ours
// (docs/client/L_dropbomb.md).

import { loadSprite } from "../assets/spr.js";
import { Runs } from "./fb565.js";
import { T_HARD } from "./objects.js";

export const isDropStage = (m) => m === 44 || m === 45;

const THEMES = {
  44: { dir: "DropBomb/01_GrandBlue/", files: { back: "Back01", frame: "Back02", tile: "Tile01", hard: "Hard01",
    fish: "Fish", paddle: "Paddle", screw: "Screw" } },
  45: { dir: "DropBomb/02_Matrix/", files: { back: "Back01", frame: "Etc01", tile: "Tile01", hard: "Hard01",
    ring: "Etc02" } },
};
// Grand Blue: Paddle.spr = 4 flippers x 12 frames, one per corner of the frame, drawn behind it; Screw.spr = the
// propeller under the frame's bottom box (its box matches Back02's to the pixel)
const PADDLES = [[628, 106], [636, 462], [28, 462], [36, 106]];   // top right, bottom right, bottom left, top left
const SCREW = [322, 478];
const FISH = 4;                                    // Fish.spr: 3 kinds x 4 headings (NE, SE, SW, NW)
const FISH_V = [0.03, 0.05];                       // px per ms
// Matrix: Etc02.spr = 4 energy rings x 8 frames round the frame's thrusters, added onto it (a glow on black);
// Back01.spr = the left half of the code tunnel, 8 frames, the right half is its mirror
const RINGS = [[-22, 73], [-3, 455], [642, 455], [661, 75]];      // top left, bottom left, bottom right, top right
// Grand Blue's pillars are clams, Hard01 frames 0..5 pink opening, 6..11 blue opening
const CLAM_SHUT = [3000, 8000], CLAM_OPEN = [1500, 3500];         // ms closed / open, at random
const rnd = ([a, b]) => a + Math.random() * (b - a);

const runs = (path) => loadSprite(path).then((s) => ({ r: Runs.fromSprite(s), n: s.count, period: s.b6 || 100 }));

const themes = new Map();
function loadTheme(mapSet) {
  if (!themes.has(mapSet)) {
    const { dir, files } = THEMES[mapSet], t = {};
    themes.set(mapSet, Promise.all(Object.entries(files).map(([k, f]) => runs(dir + f + ".spr")
      .then((s) => { t[k] = s; }).catch(() => {}))).then(() => t));
  }
  return themes.get(mapSet);
}

// Drop Bomb's sky bomb on every map: redbomb.spr (idle), redbomb_d.spr (the fall, as dbomb_d.spr) and trace.spr
// (6 frames, the mark on the tile where it lands). null without the Korean data: the black skull bomb then.
let red = null;
export function loadRedBombs() {
  if (!red) {
    red = Promise.all(["redbomb", "redbomb_d", "trace"].map((f) => loadSprite("DropBomb/" + f + ".spr")
      .then((s) => Runs.fromSprite(s)))).then(([bomb, fall, trace]) => ({ bomb, fall, trace })).catch(() => null);
  }
  return red;
}

export class DropStage {
  constructor(world) {
    this.world = world;
    this.theme = null;
    this.t = 0;                                    // ms, drives every looping animation
    this.clams = new Map();                        // block -> { f, step, wait }
    this.fish = [];
  }

  async load(mapSet) {
    this.themeSet = mapSet;
    this.theme = isDropStage(mapSet) ? await loadTheme(mapSet) : null;
  }

  reset() {                                        // every round, after the blocks
    this.clams.clear();
    for (const blk of this.world.blocks.values()) this.clams.set(blk, { f: 0, step: 0, wait: rnd(CLAM_SHUT) });
    this.fish = Array.from({ length: FISH }, () => ({
      x: Math.random() * 760 - 20, y: 40 + Math.random() * 500, d: Math.floor(Math.random() * 4),
      kind: Math.floor(Math.random() * 3), v: rnd(FISH_V),
    }));
  }

  update(dt) {
    this.t += dt;
    if (this.world.mapSet !== 44) return;
    const period = this.theme && this.theme.hard ? this.theme.hard.period : 100;
    for (const c of this.clams.values()) {       // shut, opening, open, closing
      c.wait -= dt;
      if (c.wait > 0) continue;
      if (c.step === 0 || c.step === 2) { c.step++; c.wait = period; continue; }
      c.f += c.step === 1 ? 1 : -1;
      c.wait = period;
      if (c.f >= 5) { c.f = 5; c.step = 2; c.wait = rnd(CLAM_OPEN); }
      else if (c.f <= 0) { c.f = 0; c.step = 0; c.wait = rnd(CLAM_SHUT); }
    }
    for (const f of this.fish) {                 // swim on a diagonal, turning back at the screen's edges
      let sx = f.d === 0 || f.d === 1 ? 1 : -1, sy = f.d === 1 || f.d === 2 ? 1 : -1;
      f.x += sx * f.v * dt; f.y += sy * f.v * dt;
      if (f.x < -20 || f.x > 750) sx = f.x < -20 ? 1 : -1;
      if (f.y < 30 || f.y > 550) sy = f.y < 30 ? 1 : -1;
      f.d = sx > 0 ? (sy < 0 ? 0 : 1) : (sy > 0 ? 2 : 3);
    }
  }

  frameOf(s, k = 0) { return s ? Math.floor(this.t / s.period + k) % s.n : 0; }

  // ------------------------------------------------------------------ drawing
  drawBack(fb) {                                   // under the field: background, floor, grid, frame
    const t = this.theme;
    if (!t) return;
    if (this.world.mapSet === 44) {
      if (t.back) fb.opaque(t.back.r, 0, 0, 0);
      if (t.fish) for (const f of this.fish) fb.opaque(t.fish.r, 4 * f.kind + f.d, Math.trunc(f.x), Math.trunc(f.y));
      this.drawTiles(fb);
      if (t.paddle) {
        const f = this.frameOf(t.paddle) % 12;
        PADDLES.forEach(([x, y], g) => fb.opaque(t.paddle.r, 12 * g + f, x, y));
      }
      if (t.frame) fb.opaque(t.frame.r, 0, 0, 0);
    } else {
      fb.clear(0);
      if (t.back) {
        const f = this.frameOf(t.back);
        fb.opaque(t.back.r, f, 0, 0);
        fb.mirror(t.back.r, f, 400, 0, 400);
      }
      this.drawTiles(fb);
      if (t.frame) fb.opaque(t.frame.r, 0, 0, 0);
      if (t.ring) {
        const f = this.frameOf(t.ring) % 8;
        RINGS.forEach(([x, y], g) => fb.add(t.ring.r, 8 * g + (f + 2 * g) % 8, x, y));
      }
    }
  }

  drawTiles(fb) {
    const t = this.theme.tile;
    if (!t) return;
    fb.opaque(t.r, 0, 0, 0);                      // the floor
    fb.opaque(t.r, 1, 0, 0);                      // the grid
  }

  drawFront(fb) {                                  // over the field: the frame's front strip (and the propeller)
    const t = this.theme;
    if (!t) return;
    if (t.frame) fb.opaque(t.frame.r, 1, 0, 0);
    if (this.world.mapSet === 44 && t.screw) fb.opaque(t.screw.r, this.frameOf(t.screw), SCREW[0], SCREW[1]);
  }

  // A pillar: Grand Blue's clams take turns opening (pink and blue in a checker), Matrix's spell SYSTEM / FAILED
  // row after row (blk.vHard: its place among the pillars, world.loadRound)
  drawBlock(fb, blk) {
    const t = this.theme;
    if (!t || !t.hard || this.world.tile(blk.x, blk.y) !== T_HARD) return;
    let f = blk.vHard % 12;
    if (this.world.mapSet === 44) {
      const c = this.clams.get(blk);
      f = (((blk.x >> 1) + (blk.y >> 1)) & 1 ? 6 : 0) + (c ? c.f : 0);
    }
    fb.opaque(t.hard.r, f, 40 * blk.x + 20, 38 * blk.y - 13);
  }
}
