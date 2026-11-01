// A match from 0x7dc until 0x401 (docs/protocol/D_ingame.md): network flow and scenes.
// The play field (world.js), drawing (render.js) and HUD (hud.js) follow docs/client/*.md.

import { Reader, Writer } from "../net/codec.js";
import { Input } from "./input.js";
import { loadMapData, setArena, W, H } from "./mapdata.js";
import { setScreen, SIDE } from "./fb565.js";
import { active } from "./display.js";
import { World } from "./world.js";
import { Renderer } from "./render.js";
import { arenaSize } from "./sideart.js";
import { Screen } from "./screen.js";
import { dropHd } from "./characters.js";
import { Hud } from "./hud.js";
import { unlockAudio } from "./audio.js";
import { music, stopAll, preloadSounds, hush, SOUNDS } from "./sound.js";
import { backgroundTicker } from "./ticker.js";
import { Smooth } from "./smooth.js";
import { FpsMeter } from "./fpsmeter.js";

import { SC_LOADING, SC_INTRO, SC_PLAY, SC_RESULT } from "./scenes.js";
import { bombSkin, SKIN_BASE } from "./bombskins.js";
import { isSpaceMap, SPACE_SET, GALAXY_MAP, isCustomMap, CUSTOM_SET, customMap, loadCustomMaps } from "../session.js";
import { t, N_ } from "../i18n.js";

const HIDDEN_TICK_MS = 50;          // the world's steps in a hidden tab (backgroundTicker)
const CATCH_UP_MS = 15000;          // at most this much is caught up at once (a tab the browser froze for longer)
const QUIET_MS = 500;               // a catch-up longer than this plays no sound effects
const BLUR_MS = 120;                // the blurred copy beside the game: at most this often (6 frames of 20 ms),
const BLUR_W = 80, BLUR = [0.45, 1.1, 3];   // this many pixels wide; darkened, saturated, softened (FB.small)
const SMOOTH_SHARE = 0.4;           // Smooth motion draws between steps only while drawing takes at most this share
                                    // of the time (a slow device keeps the 50 frames a second)
const MAX_SIDE = 1000;              // side art at most this wide at each side: a page up to 4.67:1 is full
// 0x8cb (the server's rejoin.py): another player's connection, by news: lost (their place kept n s), back, gone
const NEWS = { 1: N_("{nick} lost the connection: waiting up to {n} s for them."), 2: N_("{nick} is back."),
  3: N_("{nick} did not come back.") };

// The screen the game draws on: the exe's 800x600 for its 17 x 15 field, or a bigger field's (an arena's, a custom
// map's: 40 x 38 px a tile, a 40 px margin at the left, 80 px for the clock and the item panel at the right) with the
// player panels along the top and the bottom.
const exeField = () => W === 17 && H === 15;
const screenSize = () => (exeField() ? [800, 600] : [40 * W + 120, 38 * H + 48]);

export class Match {
  constructor(session, canvas, startData) {
    this.session = session;
    this.conn = session.conn;
    this.canvas = canvas;
    this.screen = new Screen(canvas);       // the frame onto the page, through the screen filter (Options → Display)
    this.blur = document.getElementById("game-blur");     // beside the game: a dark, blurred copy of it (app.css)
    this.blurCtx = this.blur && this.blur.getContext("2d");
    this.blurOn = active.blur;   // (not in Performance mode: the page's black instead)
    if (this.blur) this.blur.hidden = !this.blurOn;
    this.myId = session.myId;
    // the room list as the client knew it at 0x7dc: player slot = order in the list
    this.entries = [...session.room.players.values()].sort((a, b) => a.slot - b.slot);
    const roomMap = this.entries[0].map;
    this.mapSet = isSpaceMap(roomMap) ? SPACE_SET : isCustomMap(roomMap) ? CUSTOM_SET : roomMap;
    this.galaxy = roomMap === GALAXY_MAP;      // Space's set in the Korean picture (render.js)
    this.customOf = isCustomMap(roomMap) ? roomMap : 0;
    this.custom = null;                        // a custom map (session.js customMap): its picture and blocks, at start()
    this.variant = this.entries[0].variant;
    // back in a match after a lost connection (0x8c9, before this 0x7dc): its map now, the rounds won, who is in the
    // round; late: a round is being played, watched until it ends (the next one is played)
    this.rejoin = session.rejoinState || null;
    session.rejoinState = null;
    if (this.rejoin) { this.mapSet = this.rejoin.map; this.variant = this.rejoin.variant; }
    this.late = !!(this.rejoin && this.rejoin.late);
    // a game master watching the room (the server's watch.py): no player of its own, sends nothing, nobody sees it
    this.watching = !!session.room.watch;
    // a training (training.js): in this page alone, its connection and its server stand-in are the training's
    this.training = session.training || null;
    if (this.training) this.training.attach(this);
    this.rules = session.room.rules.slice();
    this.mode = session.gameType();         // DAT_0050ebf4: 0 Battle, 2 Hyper Bomb, 4 Boss (the room's, or the channel's)
    this.teamMode = !!(session.room.info && session.room.info.team && this.entries.some((e) => e.team >= 0));
    this.scene = SC_LOADING;
    this.sceneAt = performance.now();
    this.phase = 0;              // gamenet+0xfb: 0 playing, 1 round over, 2 match over
    this.results = [];           // 0x80 rows of the last round
    this.coinsWon = null;        // player id -> {coins, mission} won in the match (0x8b8)
    this.draw = false;
    this.over = false;
    this.readySent = false;
    this.gotConnectivity = false;
    this.loaded = false;
    this.queue = [];             // packets that arrive while the match is still loading
    this.stopped = false;
    this.perf = { draws: 0, ms: 0 };
    this.smooth = new Smooth();  // Options → Display → Smooth motion
    this.drawnAt = -Infinity;    // the last draw (a frame's time) and what a draw takes lately, ms
    this.drawMs = 4;
    this.blurAt = -Infinity;
    this.input = new Input(window);
    this.onGameEvent = (ev) => this.onGame(ev.detail.type, ev.detail.pkt);
    // every player's bomb skin (room entry +0x29); until it has loaded, the game's bomb
    this.skins = new Map();
    for (const e of this.entries) {
      if (e.bomb > 0) bombSkin(SKIN_BASE + e.bomb).then((s) => { if (s) this.skins.set(e.id, s); });
    }
  }

  skinOf(playerId) { return this.skins.get(playerId) || null; }

  // ------------------------------------------------------------------ life cycle
  async start() {
    const c = this.conn;
    c.gameMode = true;
    c.addEventListener("game", this.onGameEvent);
    c.release();                       // what came after 0x7dc (session.js held it until now)
    this.guard(true);
    unlockAudio();
    this.bgm = SOUNDS[7 + Math.floor(Math.random() * 5)];   // BGM0..4, chosen once at 0x7dc
    music(this.mode !== 4 ? this.bgm : null);   // (the room's ends) Boss Battle: each cave has its own (boss.js, KR FUN_00446470)
    // my UDP endpoint (irrelevant for relayed play but the server expects it) and "loaded" after 3 s
    c.send(0x42b, new Writer(16).u16(2).bytes([0x22, 0xa0]).bytes([127, 0, 0, 1]).zeros(8).done());
    this.loadedTimer = setTimeout(() => c.send(0x42d), 3000);
    if (this.customOf) {                 // (not listed: the list again; still not: Standard's blocks, no picture)
      if (!customMap(this.customOf)) await loadCustomMaps(true);
      this.custom = customMap(this.customOf) || { map: this.customOf, theme: 1, v: 0, missing: true };
    }
    await loadMapData();
    // a room of 12's arena (0x8b5), or a custom map's own field and starts on the screen for this many players (its
    // picture, or its blocks' map's grown round a big field as an arena's)
    const lay = this.session.layout, arena = lay && lay.w ? lay : null;
    const size = arena ? arenaSize(arena.w, arena.h) : 0;
    const pic = !!(this.custom && this.custom.pics && this.custom.pics[size]);
    setArena(arena && { w: arena.w, h: arena.h, spawns: arena.spawns, grown: size > 0 && !pic });
    if (arena) { this.mapSet = arena.map; this.variant = arena.variant; }
    this.sizeScreen();
    this.world = new World(this, this.entries);
    this.world.loadRound(this.mapSet, this.variant, this.session.layoutFor(this.mapSet, this.variant));
    if (this.training) this.training.roundLoaded(this.world);
    if (this.rejoin) {                 // the rounds each one won; who is not in the round is not shown
      for (const p of this.world.players) {
        const x = this.rejoin.players.get(p.id);
        if (!x) continue;
        p.roundsWon = x.won;
        if (!x.here) p.active = false;
      }
      if (this.late && !(this.watching && this.rejoin.snapshot)) this.showLateNote(!!this.rejoin.snapshot);
    }
    this.renderer = new Renderer(this);
    this.hud = new Hud(this);
    await Promise.all([this.renderer.load(), this.hud.load(), this.world.load(), preloadSounds()]);
    if (this.stopped) return;
    this.fitFrame();
    this.roomWatch = new ResizeObserver(() => this.fitFrame());   // the page resized, a phone turned
    this.roomWatch.observe(this.canvas.parentElement);
    if (this.watching) this.showWatchTag();
    this.loaded = true;
    if (this.late && this.rejoin.snapshot) this.watch(this.rejoin.snapshot);
    for (const q of this.queue) q();
    this.queue = [];
    this.maybeReady();
    this.last = performance.now();
    this.acc = 0;
    this.fps = new FpsMeter(this.canvas.parentElement);   // Options → Display → Show FPS, F2
    this.frame = (t) => this.tick(t);
    requestAnimationFrame(this.frame);
    // a hidden tab gets no frames: the world goes on with the server on a worker's ticks, and catches up at once
    // with whatever is left when the tab is back
    this.stopTicker = backgroundTicker(HIDDEN_TICK_MS, () => { if (document.hidden) this.step(performance.now(), false); });
    this.onVisible = () => { if (!document.hidden && !this.stopped) this.step(performance.now(), false); };
    document.addEventListener("visibilitychange", this.onVisible);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.guard(false);
    this.hideLateNote();
    if (this.watchTag) this.watchTag.remove();
    clearTimeout(this.loadedTimer);
    clearTimeout(this.readyTimer);
    if (this.stopTicker) this.stopTicker();
    if (this.onVisible) document.removeEventListener("visibilitychange", this.onVisible);
    hush(false);
    this.conn.removeEventListener("game", this.onGameEvent);
    this.input.onKey = null;
    this.input.dispose();
    if (this.hud) this.hud.dispose();
    if (this.fps) this.fps.dispose();
    this.smooth.forget();
    stopAll();
    setArena(null);
    if (this.roomWatch) this.roomWatch.disconnect();
    this.sizeScreen();
    this.screen.dispose();
    if (this.blurCtx) this.blurCtx.clearRect(0, 0, this.blur.width, this.blur.height);
  }

  // The screen (screenSize), which the page scales to fit. With `side` pixels of side art at each side (fitFrame)
  // the frame is that much wider than the screen.
  sizeScreen(side = 0) {
    const big = !exeField(), [w, h] = screenSize(), fw = w + 2 * side;
    setScreen(w, h, side);
    this.screen.resize(fw, h);
    const room = this.canvas.parentElement.style;            // (app.css: the page fits it, and the touch controls)
    if (big) room.setProperty("--ratio", (w / h).toFixed(5));
    else room.removeProperty("--ratio");
    if (side) room.setProperty("--wide", (fw / w).toFixed(5));
    else room.removeProperty("--wide");
    if (this.blur) {                 // a few pixels are enough: the page enlarges them
      this.blur.width = BLUR_W;
      this.blur.height = Math.round(BLUR_W * h / fw);
      this.blurImage = this.blurCtx.createImageData(this.blur.width, this.blur.height);
    }
  }

  // Side art beside the screen (sideart.js) on a page wider than the screen (the exe's 4:3, an arena's own shape):
  // all the page shows round the screen (past what the map's art has, the art mirrored on). None on a narrower page,
  // in a mode without art, or with Options → Display → Side scenery off: the blurred copy shows there, as before.
  fitFrame() {
    if (this.stopped || !this.renderer) return;
    this.sideOn = active.sideArt;
    const art = this.renderer.sideArt;
    let side = 0;
    if (art) {
      const [sw, sh] = screenSize(), ratio = sw / sh;
      const el = this.canvas.parentElement, cs = getComputedStyle(el);
      const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;   // the touch controls' strips
      const roomW = el.clientWidth - pl - pr, h = Math.min(roomW / ratio, el.clientHeight);   // the screen's height there
      if (h > 0) {
        // the screen stays centred between the strips; the frame, as wide at both sides, covers the wider one
        const spare = Math.max(pl, pr) + (roomW - h * ratio) / 2;
        side = Math.min(MAX_SIDE, Math.ceil(spare * sh / h));
        if (side < 4) side = 0;
      }
    }
    if (side !== SIDE) this.sizeScreen(side);
  }

  onDisconnect() { this.stop(); }

  // While the match is on, the page asks before it closes or reloads (a closed tab is a lost match, a reload loses
  // the round), and F5 / Ctrl+R / Cmd+R do not reload it (F5 is next to the music and sound keys F3 / F4). Not in a
  // training: nothing is lost there.
  guard(on) {
    if (on && !this.leaveGuard && !this.training) {
      this.leaveGuard = (e) => { if (!this.over && !this.stopped) { e.preventDefault(); e.returnValue = ""; } };
      this.reloadKeys = (e) => {
        if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.code === "KeyR")) e.preventDefault();
      };
      window.addEventListener("beforeunload", this.leaveGuard);
      window.addEventListener("keydown", this.reloadKeys, true);
    } else if (!on && this.leaveGuard) {
      window.removeEventListener("beforeunload", this.leaveGuard);
      window.removeEventListener("keydown", this.reloadKeys, true);
      this.leaveGuard = this.reloadKeys = null;
    }
  }

  // Back in the middle of a round (late): a note over the field until the round ends
  // (watch: a band at the bottom, the round shows; else over the whole field)
  showLateNote(watch = false) {
    this.hideLateNote();
    const el = document.createElement("div");
    el.className = "rejoin-note" + (watch ? " watch" : "");
    el.setAttribute("role", "status");
    const a = document.createElement("p"), b = document.createElement("p");
    a.className = "rn-msg";
    b.className = "rn-note";
    a.textContent = this.watching ? t("Watching room {n}", { n: this.session.room.number + 1 }) : t("You are back in the match.");
    b.textContent = this.watching ? t("The match shows from the next round.") : t("You play again from the next round.");
    el.append(a, b);
    this.canvas.after(el);
    this.lateNote = el;
  }

  // A game master watching: a tag at the bottom left all match long (Esc: back to the lobby)
  showWatchTag() {
    const el = document.createElement("div");
    el.className = "watch-tag";
    el.setAttribute("role", "status");
    el.textContent = t("Watching room {n} · nobody sees you · Esc: leave", { n: this.session.room.number + 1 });
    this.canvas.after(el);
    this.watchTag = el;
  }

  // Back in the middle of a round in Survival or Drop Bomb (0x8c9's snapshot): the round as it is now, then on with
  // everyone's events, the page's own player out of it as a dead one is, until the next round (0x83 brings it in)
  watch(snap) {
    if (!this.world.applySnapshot(snap)) { this.showLateNote(false); return; }   // (not this field: the note)
    this.late = false;
    const me = this.world.me;
    if (me) { me.out = true; me.state = 8; me.active = false; }   // (state 8: it picks nothing up)
    this.hud.roundStart(snap.left);
    if (snap.hurry) this.hud.hurryPhase = 4;           // (its banner has been and gone)
    this.setScene(SC_PLAY);
  }

  hideLateNote() {
    if (this.lateNote) this.lateNote.remove();
    this.lateNote = null;
  }

  setScene(s) {
    this.scene = s;
    this.sceneAt = performance.now();
    if (this.hud) this.hud.onScene(s);
  }

  tick(now) {
    if (this.stopped) return;
    if (this.sideOn !== active.sideArt) this.fitFrame();      // Options → Display → Side scenery, during the match
    this.step(now, true);
    this.screen.watchSize(now, this.drawMs);                  // a device that misses frames: the canvas smaller
    if (this.screen.watchHd(now, this.drawMs)) {             // a device too slow for HD characters: none from now on
      dropHd();
      this.screen.dropHd();
      console.info("HD characters off: this device draws the game too slowly with them");
    }
    this.fps.tick(now);
    requestAnimationFrame(this.frame);
  }

  // Fixed 20 ms logic steps (the original's frame gate, F_render §1), drawn after each batch (draw: a frame). On
  // screen a long frame counts as 250 ms at most; out of sight (no frames) all the time since the last step counts,
  // up to CATCH_UP_MS, so the world keeps up with the server, quietly when it is more than a moment. With Smooth
  // motion, a frame with no step draws too, if something moves and drawing has time (SMOOTH_SHARE): the same world,
  // part of the way into the next step.
  step(now, draw) {
    if (this.stopped) return;
    const step = this.world.stepMs, smooth = active.smooth;
    if (draw) this.input.poll();       // the gamepads
    if (now > this.last) {             // (a frame's time can be a little before a worker tick's)
      this.acc += Math.min(draw ? 250 : CATCH_UP_MS, now - this.last);
      this.last = now;
    }
    const quiet = this.acc > QUIET_MS;
    if (quiet) hush(true);
    let stepped = false;
    while (this.acc >= step && !this.stopped) {
      if (smooth && this.acc < 2 * step) this.smooth.record(this.world);   // (before the batch's last step)
      this.update(step);
      this.acc -= step;
      this.input.endFrame();
      stepped = true;
    }
    if (quiet) hush(false);
    if (!draw || this.stopped) return;
    if (!stepped && !(smooth && now - this.drawnAt >= this.drawMs / SMOOTH_SHARE && this.smooth.moving())) return;
    this.drawnAt = now;
    const t0 = performance.now();
    if (smooth) this.smooth.draw(Math.min(1, this.acc / step), () => this.renderer.draw(this.screen, !stepped));
    else this.renderer.draw(this.screen);
    if (this.blurOn && this.blurCtx && t0 - this.blurAt >= BLUR_MS) {
      this.blurAt = t0;
      this.renderer.fb.small(this.blurImage, ...BLUR);
      this.blurCtx.putImageData(this.blurImage, 0, 0);
    }
    const ms = performance.now() - t0;
    this.drawMs += (ms - this.drawMs) * 0.1;
    this.perf.draws++;
    this.perf.ms += ms;
    this.fps.drawn(ms);
  }

  update(dt) {
    if (this.training) this.training.update(dt);
    this.world.update(dt, this.scene === SC_PLAY);
    this.hud.update(dt);
  }

  maybeReady() {
    if (this.loaded && this.gotConnectivity && !this.readySent) {
      this.readySent = true;
      this.sendReady();
    }
  }

  // ------------------------------------------------------------------ requests
  sendReady() {
    if (this.watching) return;         // (nobody waits for a watcher)
    // compact 0x7e {op, id, 0xFFFF} as frame type 3
    this.conn.sendGame(new Writer(5).u8(0x7e).i16(this.myId).u16(0xffff).done());
  }

  quit() {
    this.conn.sendGame(new Uint8Array([0x8b]));
    this.conn.send(0x3f8);
    this.conn.gameMode = false;
    this.stop();
  }

  // 0x400; the automatic one is repeated every 5 s until 0x401 arrives.
  leaveResults(auto = false) {
    if (this.leftResults && !auto) return;
    this.leftResults = true;
    this.conn.send(0x400);
  }

  // ------------------------------------------------------------------ incoming MESSAGEs (session forwards them first)
  onMessage(id, d) {
    const r = new Reader(d);
    switch (id) {
      case 0x7f2:          // connectivity table: we are always relayed through the server
        this.gotConnectivity = true;
        this.maybeReady();
        return true;
      case 0x7f1: return true;
      case 0x432: return true;
      case 0x7da:
        if (!this.loaded) this.queue.push(() => this.world.playerLeft(r.i32(0)));
        else this.world.playerLeft(r.i32(0));
        return true;
      case 0x7e6: if (this.hud) this.hud.notice(r.i16(0), r.chat(2, d.length - 2)); return true;
      case 0x8ba: if (this.hud) this.hud.killed(r.i16(0), r.i16(2), d[4]); return true;   // the kill feed
      case 0x8cb: {        // another player's connection (rejoin.py): lost, back, gone
        const p = this.world && this.world.playerAny(r.i16(1));
        if (this.hud && p && NEWS[d[0]]) this.hud.addLine(7, t(NEWS[d[0]], { nick: p.nick, n: d[3] }));
        return true;
      }
      case 0x8b8:          // the Bomber Coins and Mission Coins each player won in this match (before 0x80 / 0x82)
        this.coinsWon = new Map();
        for (let i = 0; i < d[0]; i++) {
          this.coinsWon.set(r.i16(1 + 10 * i), { coins: r.u32(3 + 10 * i), mission: r.u32(7 + 10 * i) });
        }
        return true;
      case 0x437: return true;
      case 0x401:
        this.stop();
        return false;       // session switches back to the room screen
      case 0x3f9:
        this.stop();
        return false;
      case 0x43a:
        this.stop();
        return false;
    }
    return false;
  }

  // ------------------------------------------------------------------ incoming compact packets
  onGame(type, pkt) {
    if (pkt.length === 0) return;
    if (!this.loaded) { this.queue.push(() => this.onGame(type, pkt)); return; }
    const op = pkt[0];
    if (this.late) {                         // back in the middle of a round: its end (and the chat), nothing else
      if ((type === 4 || type === 6) && op === 0x65) return this.hud.chatPacket(pkt);
      if (type === 4 || type === 6 || (op !== 0x80 && op !== 0x81 && op !== 0x82)) return;
      if (op !== 0x80) {                     // the round's end: its results, then the next round as everyone
        this.late = false;
        this.hideLateNote();
        this.onGame(type, pkt);
        if (this.scene !== SC_RESULT) this.hud.enterResults();
        return;
      }
    }
    if (type === 4 || type === 6) {          // relayed from another player (arrives as 0x7f0)
      if (op === 0x65) return this.hud.chatPacket(pkt);
      return this.world.relayed(op, pkt);
    }
    switch (op) {
      case 0x7f: {                           // round start
        const secs = new Reader(pkt).u16(3);
        this.phase = 0;
        this.world.roundStart(secs);
        this.hud.roundStart(secs);
        this.setScene(SC_INTRO);
        return;
      }
      case 0x83: return this.world.spawn(pkt);
      case 0x80: this.results.push(pkt.slice(0, 30)); return;
      case 0x81: {                           // round over, another round follows
        this.hideLateNote();
        this.phase = 1;
        this.draw = pkt[3] === 1;
        this.nextMap = [pkt[4], pkt[5]];
        this.world.roundOver();
        this.hud.roundOver(this.results, this.draw, false);
        this.results = [];
        return;
      }
      case 0x82: {
        this.hideLateNote();
        this.phase = 2;
        this.over = true;
        this.world.roundOver();
        this.hud.roundOver(this.results, false, true);
        this.results = [];
        return;
      }
      case 0x84: this.world.hurryUp(); this.hud.hurryUp(); return;
    }
    this.world.event(op, pkt);
  }

  // Called by the HUD when the round result screen finished: load the next map and say ready.
  nextRound() {
    if (!this.nextMap) return;
    [this.mapSet, this.variant] = this.nextMap;
    this.nextMap = null;
    this.world.loadRound(this.mapSet, this.variant, this.session.layoutFor(this.mapSet, this.variant));
    this.renderer.onMapChanged();
    this.setScene(SC_LOADING);
    this.readyTimer = setTimeout(() => this.sendReady(), 300);   // Sleep(300) then 0x7e (FUN_004310a0)
  }
}
