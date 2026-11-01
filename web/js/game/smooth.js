// Smooth motion (Options → Display, web client only). The world steps every 20 ms like the exe's frame gate
// (F_render §1), so drawn after each step the screen shows at most 50 different frames a second: unevenly on a 60 Hz
// screen (one refresh in six shows the last frame again), and no more on a 120 / 144 Hz one. With it, every refresh
// draws what moves part of the way from where the last step found it to where it left it, as far as the time since
// that step: the players (their carts and jumps too), the bombs, Hyper Bomb's flying parts, the falling blocks and the
// boss. The picture is then one step (20 ms) behind the world, instead of 0 to 20 ms.
//
// Only the drawing sees it: the drawn values go in for the draw and the world's own come back right after it, so what
// the game does (collisions, what it sends, what the server is told) is the steps' own, as without it. Something that
// moves more than a tile in one step (a warp, a respawn, a bomb flying round the edge) is drawn there at once.

const SNAP2 = 40 * 40;

// What moves: its drawn values (of), the field each one is drawn from (keys) and how a drawn value goes in there (set),
// and the pairs of values that are a position (drawn at once after a jump of more than a tile).
const PLAYER = {             // (a remote player's drawn offsets, player.js: X / Y stay the world's)
  of: (p) => [p.X + p.ox, p.Y + p.oy, p.jumpH, p.cartX + p.cox, p.cartY + p.coy],
  keys: ["ox", "oy", "jumpH", "cox", "coy"],
  set(p, i, v) {
    if (i === 0) p.ox = v - p.X; else if (i === 1) p.oy = v - p.Y; else if (i === 2) p.jumpH = Math.round(v);
    else if (i === 3) p.cox = v - p.cartX; else p.coy = v - p.cartY;
  },
  pairs: [[0, 1], [3, 4]],
};
const BOMB = {
  of: (b) => [b.px, b.py, b.height, b.skyH],
  keys: ["px", "py", "height", "skyH"],
  set(b, i, v) { b[BOMB.keys[i]] = i < 2 ? v : Math.round(v); },      // (heights are whole pixels)
  pairs: [[0, 1]],
};
const PART = {               // a part thrown by 0xaa (hyper.js flying)
  of: (it) => [it.px, it.py],
  keys: ["px", "py"],
  set(it, i, v) { it[PART.keys[i]] = v; },
  pairs: [[0, 1]],
};
const BLOCK = {              // a block falling in Hyper Bomb's pressure
  of: (b) => [b.fallH],
  keys: ["fallH"],
  set(b, i, v) { b.fallH = v; },
  pairs: [],
};
const BOSS = {
  of: (b) => [b.x, b.y],
  keys: ["x", "y"],
  set(b, i, v) { b[BOSS.keys[i]] = v; },
  pairs: [[0, 1]],
};

export class Smooth {
  constructor() {
    this.prev = new Map();          // what moves -> [its kind, its drawn values before the last step]
  }

  // Before a step: where everything that moves is drawn now.
  record(world) {
    const prev = this.prev;
    prev.clear();
    for (const p of world.players) prev.set(p, [PLAYER, PLAYER.of(p)]);
    for (const b of world.bombs) prev.set(b, [BOMB, BOMB.of(b)]);
    if (world.hyper) for (const it of world.hyper.flying) prev.set(it, [PART, PART.of(it)]);
    for (const b of world.blocks.values()) if (b.falling) prev.set(b, [BLOCK, BLOCK.of(b)]);
    if (world.boss) prev.set(world.boss, [BOSS, BOSS.of(world.boss)]);
  }

  forget() { this.prev.clear(); }

  // Each value that is drawn elsewhere than the step left it, part of the way (k: 0 where the step found it, 1 where it
  // left it): f(index, value). None for what did not move, or jumped.
  each(kind, o, was, k, f) {
    const now = kind.of(o);
    let jumped = 0;
    for (const [a, b] of kind.pairs) {
      const dx = now[a] - was[a], dy = now[b] - was[b];
      if (dx * dx + dy * dy > SNAP2) jumped |= (1 << a) | (1 << b);
    }
    for (let i = 0; i < now.length; i++) {
      if (jumped & (1 << i) || now[i] === was[i] || !Number.isFinite(was[i]) || !Number.isFinite(now[i])) continue;
      f(i, was[i] + (now[i] - was[i]) * k);
    }
  }

  // Whether a draw between two steps would show anything else than the last one.
  moving() {
    let yes = false;
    for (const [o, [kind, was]] of this.prev) {
      this.each(kind, o, was, 0.5, () => { yes = true; });
      if (yes) return true;
    }
    return false;
  }

  // draw() with everything that moves part of the way (0 <= k < 1); the world's own values back after it, whatever
  // happens in it.
  draw(k, draw) {
    const undo = [];                          // object, field, the world's value
    try {
      for (const [o, [kind, was]] of this.prev) {
        this.each(kind, o, was, k, (i, v) => {
          undo.push(o, kind.keys[i], o[kind.keys[i]]);
          kind.set(o, i, v);
        });
      }
      draw();
    } finally {
      for (let i = undo.length - 3; i >= 0; i -= 3) undo[i][undo[i + 1]] = undo[i + 2];
    }
  }
}
