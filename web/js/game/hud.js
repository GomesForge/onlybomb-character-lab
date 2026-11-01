// Everything around and over the play field (docs/client/I_hud.md): top bar, clock, item panel,
// READY/START intro, HURRY UP, chat, quit dialog, round-end pose and the result screens.

import { A, msg } from "./assets.js";
import { rgb565, SW, SH, canvasRgba, textWidth } from "./fb565.js";
import { Writer, Reader, encodeChat } from "../net/codec.js";
import { SC_LOADING, SC_INTRO, SC_PLAY, SC_RESULT } from "./scenes.js";
import { SET_ST, SET_WI, SET_FACE } from "./characters.js";
import { labelColour } from "./player.js";
import { missionIcon } from "./missionicon.js";
import { sfx, settings, music, stopAll, saveSound } from "./sound.js";
import { display, saveDisplay } from "./display.js";
import { t as tr, N_ } from "../i18n.js";

const T = Math.trunc;
const WHITE = 0xffff, BLACK = 0;
// chat colours by kind (FUN_00422f10): [text, outline]
const KIND = [[BLACK, WHITE], [WHITE, BLACK], [rgb565(255, 0, 0), BLACK], [rgb565(0, 255, 0), BLACK],
  [rgb565(0, 0, 255), BLACK], [rgb565(128, 128, 128), BLACK], [rgb565(255, 255, 0), BLACK],
  [rgb565(0, 255, 255), BLACK], [rgb565(255, 0, 255), BLACK], [rgb565(10, 255, 10), BLACK]];

// The kill feed (0x8ba, web only): how each player died, newest on top, left of the item panel. The cause from the
// server (h_game.py blame): 0 blown up by a rival, 1 by their own bomb, 2 by a teammate, 3 crushed by HURRY UP,
// 4 a skull bomb from the sky (Drop Bomb), 5 the boss, 6 anything else
const FEED = [
  (k, v) => k && [k, " blew up ", v], (k, v) => [v, " blew themselves up"], (k, v) => k && [k, " blew up teammate ", v],
  (k, v) => [v, " was crushed"], (k, v) => [v, " was hit by a skull bomb"], (k, v) => [v, " was beaten by the boss"],
];
const FEED_TEXT = rgb565(200, 200, 200), FEED_MINE = rgb565(255, 220, 0), FEED_SHOWN = 6000, FEED_LINES = 5;
const SUPER_SPEED = 70, SUPER_H = 18;       // a game master's /superbroadcast: pixels a second, the strip's height

// The match's end (drawFinal): the players' middles 120 px apart (a guild's 16 letters fit), the lines under them
const FINAL_STEP = 120, GUILD_TEXT = rgb565(150, 210, 255), POINTS_TEXT = rgb565(255, 220, 0);
const NO_POINTS = rgb565(170, 170, 170);

// A web-only arena draws on a bigger screen: the exe's 800x600 overlays are centred (CX, CY), the clock and the item
// panel follow the right edge, and players 7..12 get panels along the bottom.
const CX = () => (SW - 800) >> 1, CY = () => (SH - 600) >> 1;

// persistent across rounds, like the globals of the original intro code
const intro = { rHold: false, rDown: false, rCycles: 0, gHold: false };

// The quit dialog (Esc during a round), in the page over the game instead of the exe's UI_win_back.spr panel: the
// game a little blurred behind the question in white and Yes / No (css .quit-dlg). The exe's warning line, "Leaving
// early takes 300points" (0x7d0), is left out: this server takes no points; the match counts as lost.
function quitDialog(onYes, onNo) {
  const el = document.createElement("div");
  el.className = "quit-dlg";
  el.hidden = true;
  el.setAttribute("role", "alertdialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML = '<p class="qd-msg" id="qd-msg"></p><p class="qd-note"></p>'
    + '<div class="qd-btns"><button type="button" class="qd-yes primary big"></button>'
    + '<button type="button" class="qd-no big"></button></div>';
  el.querySelector(".qd-note").textContent = tr("Leaving counts as a loss.");
  el.querySelector(".qd-yes").textContent = tr("Yes");
  el.querySelector(".qd-no").textContent = tr("No");
  el.setAttribute("aria-labelledby", "qd-msg");
  el.querySelector(".qd-yes").onclick = onYes;
  el.querySelector(".qd-no").onclick = onNo;
  return el;
}

// The match chat is typed into a hidden text box, so a keyboard's accents (´ then a: á), a Japanese input method or a
// paste work as anywhere else; the game draws what it holds (drawChat)
const CHAT_MAX = 71;
function chatTyper(onText) {
  const el = document.createElement("input");
  el.className = "chat-typer";
  el.maxLength = CHAT_MAX;
  el.autocomplete = "off";
  el.spellcheck = false;
  el.tabIndex = -1;
  el.addEventListener("input", () => onText(el.value));
  return el;
}
// keys the box keeps while the chat is open (the rest it does not get: the caret stays at the end, as drawn)
const TYPING = new Set(["Backspace", "Delete", "Dead", "Process", "Compose", "Unidentified", "Shift", "Control", "Alt",
  "AltGraph", "Meta", "CapsLock"]);

export class Hud {
  constructor(match) {
    this.match = match;
    this.timer = 0;                 // DAT_00478298 (seconds)
    this.clockAcc = 0;
    this.clockOn = false;
    this.chat = [];                 // newest first: {kind, text, age}
    this.chatOpen = false;
    this.chatText = "";
    this.feed = [];                 // the kill feed, newest first: {victim, killer, cause, age}
    this.quitOpen = false;
    this.hurryAcc = 0; this.hurryPhase = 0; this.hurryAlpha = 0; this.hurryBlink = 0;
    this.resetRound();
    this.bindInput();
  }

  async load() {
    const img = new Image();
    img.src = "img/coins.png";                    // the Bomber Coins icon (web/img)
    this.coinImg = await img.decode().then(() => img, () => null);
    this.missionImg = await missionIcon();        // Boss Battle's coin (missionicon.js)
  }

  resetRound() {                    // FUN_0041a830
    this.introState = 0; this.rAcc = 0; this.rFrame = 0; this.gAcc = 0; this.gFrame = 0;
    this.readySound = false;
    this.hurryPhase = 0; this.hurryAlpha = 0; this.hurryBlink = 0; this.hurrySound = false;
    this.chat = [];
    this.closeChat();
    this.feed = [];
    this.blinkOn = true; this.blinkAcc = 0; this.blinkFrame = 0; this.blinkCycles = 0; this.blinkVisible = true;
    this.reviveKind = -1;
    this.poseAcc = 0; this.poseTotal = 0;
    this.resultState = 0;
  }

  // ------------------------------------------------------------------ input (keys + the quit dialog)
  bindInput() {
    this.match.input.onKey = (e) => this.onKey(e);
    this.quitEl = quitDialog(() => this.leave(), () => this.setQuit(false));
    this.match.canvas.after(this.quitEl);
    this.typer = chatTyper((text) => { this.chatText = text; });
    this.match.canvas.after(this.typer);
  }

  dispose() { this.quitEl.remove(); this.typer.remove(); }

  openChat() {
    this.chatOpen = true;
    this.setChat("");
    this.typer.focus({ preventScroll: true });
  }

  closeChat() {
    this.chatOpen = false;
    if (this.typer && document.activeElement === this.typer) {
      this.typer.blur();
      this.match.canvas.focus({ preventScroll: true });
    }
  }

  setChat(text) { this.chatText = text; this.typer.value = text; }

  inputBlocked() { return this.chatOpen || this.quitOpen; }

  onKey(e) {
    const m = this.match;
    if (this.quitOpen) {            // the dialog has the keys: Esc closes it, the arrows and Tab go from Yes to No
      if (e.key === "Escape") { this.setQuit(false); e.preventDefault(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Tab") {
        const [yes, no] = this.quitEl.querySelectorAll("button");
        (document.activeElement === yes ? no : yes).focus();
        e.preventDefault();
      }
      return true;                  // (Enter and Space press the button that has the focus)
    }
    if (this.chatOpen) {           // the box types the rest (chatTyper)
      if (document.activeElement !== this.typer) this.typer.focus({ preventScroll: true });   // (a click took it)
      if (e.isComposing) return true;                   // (an input method's own Enter, arrows ...)
      if (e.key === "Enter") { this.sendChat(); this.closeChat(); m.input.clear(); }
      else if (e.key === "Tab") this.setChat("/to ");
      else if (e.key === "F8") this.setChat("/gto ");
      else if (e.key.length === 1 || TYPING.has(e.key)) return true;
      e.preventDefault();
      return true;
    }
    if (e.key === "Enter" && [SC_LOADING, SC_INTRO, SC_PLAY].includes(m.scene) && !this.quitOpen) {
      this.openChat(); m.input.clear();
      e.preventDefault();
      return true;
    }
    if (e.key === "Escape") {
      if ((m.scene === SC_PLAY && m.phase === 0) || m.watching) this.toggleQuit();   // (a watcher leaves any time)
      e.preventDefault();
      return true;
    }
    if (e.key === "F3") { settings.bgm = !settings.bgm; saveSound(); this.addLine(6, settings.bgm ? "BGM On" : "BGM Off"); if (settings.bgm) music(m.bgm); else music(null); e.preventDefault(); return true; }
    if (e.key === "F4") { settings.sfx = !settings.sfx; saveSound(); this.addLine(6, settings.sfx ? "Sound On" : "Sound Off"); e.preventDefault(); return true; }
    if (e.key === "F2") { display.fps = !display.fps; saveDisplay(); this.addLine(6, display.fps ? "FPS On" : "FPS Off"); e.preventDefault(); return true; }
    return false;
  }

  toggleQuit() { if (!this.chatOpen) this.setQuit(!this.quitOpen); }   // Esc, or the touch controls' menu

  setQuit(open) {                   // the quit dialog shows over the game; No has the focus
    this.quitOpen = open;
    this.quitEl.hidden = !open;
    if (open) {
      this.quitEl.querySelector(".qd-msg").textContent = tr(msg(0x7d1, N_("Are you sure you want to leave?")));
      this.quitEl.querySelector(".qd-note").textContent = this.match.watching       // (a game master watching)
        ? tr("You stop watching and go back to the lobby.") : this.match.training
          ? tr("The training ends and you go back to the lobby.") : tr("Leaving counts as a loss.");
      this.quitEl.querySelector(".qd-no").focus({ preventScroll: true });
    }
    else if (this.quitEl.contains(document.activeElement)) this.match.canvas.focus({ preventScroll: true });
  }

  leave() {                         // Yes: the others read "Left the Game."
    this.setQuit(false);
    if (!this.match.watching && !this.match.training) this.sendChatText(msg(0x7d5, "Left the Game."));
    stopAll();
    this.match.quit();
  }

  // ------------------------------------------------------------------ chat
  addLine(kind, text) {             // FUN_00423000
    this.chat.unshift({ kind, text, age: 0 });
    if (this.chat.length > 4) this.chat.length = 4;
  }

  killed(victim, killer, cause) {   // 0x8ba
    this.feed.unshift({ victim, killer, cause, age: 0 });
    if (this.feed.length > FEED_LINES) this.feed.length = FEED_LINES;
  }

  notice(kind, text) {              // 0x7e6
    const k = { 1: 6, 2: 7, 3: 7, 7: 2, 9: 3 }[kind];
    if (k === undefined) return;
    if (kind === 1) text = text;
    if (kind === 3) text = text + " " + (this.match.world.me ? this.match.world.me.nick : "");
    this.addLine(k, text);
  }

  chatPacket(pkt) {                 // received 0x65 (FUN_00431ce0)
    const r = new Reader(pkt);
    const id = r.u16(1), n = Math.min(300, r.u16(3));        // (the server's h_game CHAT_WEB)
    const text = r.chat(5, n);
    const p = this.match.world.playerAny(id);
    if (!p) return;
    const kind = text === msg(0x7d5, "Left the Game.") ? 3 : id === this.match.myId ? 7 : 1;
    this.addLine(kind, `[${p.nick}] ${text}`);
  }

  sendChat() {
    const text = this.chatText;
    this.setChat("");
    if (!text.trim()) return;
    if (text.startsWith("/")) {     // whisper etc.: MESSAGE 0x439 {u16 2, text[100]}
      this.match.conn.send(0x439, new Writer(0x66).u16(2).chat(text, 100).done());
      return;
    }
    if (this.match.watching) { this.addLine(6, tr("You are watching: nobody sees what you write here.")); return; }
    this.sendChatText(text);
  }

  sendChatText(text) {              // compact 0x65 as frame type 6
    const bytes = encodeChat(text, 296);
    const w = new Writer(6 + bytes.length).u8(0x65).u16(this.match.myId).u16(bytes.length + 1).bytes(bytes).u8(0);
    this.match.conn.sendChat(w.done());
  }

  // ------------------------------------------------------------------ events from the match
  onScene(s) {
    if (s === SC_INTRO) { this.blinkOn = true; this.blinkAcc = 0; this.blinkFrame = 0; this.blinkCycles = 0; }
  }

  roundStart(secs) {                // 0x7f
    this.timer = secs;
    this.clockAcc = 0;
    this.clockOn = true;
    this.introState = 0; this.rAcc = 0; this.rFrame = 0; this.gAcc = 0; this.gFrame = 0;
    this.readySound = false;
  }

  revived(kind) {                   // FUN_00420f20: app+0x124 = 1, app+0x122 = local player index
    this.blinkOn = true; this.blinkAcc = 0; this.blinkFrame = 0; this.blinkCycles = 0;
    this.reviveKind = kind;
  }

  hurryUp() {                       // 0x84 (FUN_00434990)
    this.timer = 65;
    this.hurryPhase = 1;
  }

  roundOver(rows, draw, final) {    // 0x80 rows + 0x81 / 0x82
    const w = this.match.world;
    for (const row of rows) {
      const r = new Reader(row);
      const p = w.playerAny(r.i16(1));
      if (!p) continue;
      p.wonThisRound = row[5];
      p.roundsWon = row[6];
      p.pointsDelta = r.i16(7);
      p.totalPoints = r.i32(9);
      p.title = r.cstr(13, 17);
      const belts = this.match.session.belts;            // a belt won in this match shows on the final table
      if (belts.length) p.cls = belts[this.match.session.beltOf(p.totalPoints)][1];
    }
    this.drawFlag = draw;
    this.final = final;
    this.setQuit(false);
    this.poseAcc = 0; this.poseTotal = 0;
  }

  // ------------------------------------------------------------------ per tick
  update(dt) {
    const m = this.match;
    this.padMenu();
    for (const l of this.chat) l.age += dt;
    this.chat = this.chat.filter((l) => l.age < 15000);
    for (const l of this.feed) l.age += dt;
    this.feed = this.feed.filter((l) => l.age < FEED_SHOWN);
    if (this.clockOn && (m.scene === SC_INTRO || m.scene === SC_PLAY)) {
      this.clockAcc += dt;
      while (this.clockAcc >= 1000) { this.clockAcc -= 1000; if (this.timer > 0) this.timer--; }
    }
    if (m.scene === SC_INTRO || m.scene === SC_PLAY) this.blinkUpdate(dt);
    if (m.scene === SC_INTRO) this.introUpdate(dt);
    else if (m.scene === SC_PLAY) {
      this.hurryUpdate(dt);
      if (m.phase === 1 || m.phase === 2) this.roundEndUpdate(dt);
    } else if (m.scene === SC_RESULT) this.resultUpdate(dt);
  }

  // The gamepad and the quit dialog (the keyboard's keys are in onKey): its menu button (Start) opens and closes it;
  // left / right go from Yes to No, bomb presses the one that has the focus, special goes back to the game
  padMenu() {
    const m = this.match, input = m.input;
    if (!this.quitOpen) {
      if (input.take("menu") && m.scene === SC_PLAY && m.phase === 0) this.toggleQuit();
      return;
    }
    if (input.take("menu") || input.take("special")) return this.setQuit(false);
    if (input.take("left") || input.take("right")) {
      const [yes, no] = this.quitEl.querySelectorAll("button");
      (document.activeElement === yes ? no : yes).focus();
    }
    if (input.take("bomb") && this.quitEl.contains(document.activeElement)) document.activeElement.click();
  }

  blinkUpdate(dt) {                 // FUN_0041a210
    if (!this.blinkOn) return;
    this.blinkAcc += dt;
    if (this.blinkAcc > 199) {
      this.blinkFrame++; this.blinkAcc = 0;
      if (this.blinkFrame > 3) { this.blinkFrame = 0; this.blinkCycles++; }
    }
    if (this.blinkCycles < 6) this.blinkVisible = this.blinkFrame <= 1;
    else { this.blinkOn = false; this.blinkVisible = true; this.blinkFrame = this.blinkCycles = 0; this.reviveKind = -1; }
  }

  introUpdate(dt) {                 // FUN_004199b0
    if (!this.readySound) { this.readySound = true; sfx("Ready"); }
    if (this.introState === 0) {    // FUN_00421d90
      this.rAcc += dt;
      if (this.rAcc > 99) {
        this.rAcc -= 100;
        if (!intro.rDown) {
          if (this.rAcc > 99) this.rFrame++;
          if (this.rFrame === 0 && !intro.rHold) intro.rHold = true;
          else if (this.rFrame === 0 && intro.rHold) { intro.rHold = false; this.rFrame++; }
          else this.rFrame++;
          if (this.rFrame > 2) { intro.rDown = true; this.rFrame = 2; }
        } else {
          if (this.rAcc > 99) this.rFrame--;
          if (this.rFrame === 2 && !intro.rHold) intro.rHold = true;
          else if (this.rFrame === 2 && intro.rHold) { intro.rHold = false; this.rFrame--; }
          else this.rFrame--;
          if (this.rFrame < 1) {
            intro.rDown = false; this.rFrame = 0;
            if (++intro.rCycles === 2) { sfx("Start"); this.introState = 1; intro.rCycles = 0; }
          }
        }
      }
    } else if (this.introState === 1) {   // FUN_00421aa0
      this.gAcc += dt;
      if (this.gAcc > 99) {
        this.gAcc -= 100;
        if (this.gFrame === 0 && !intro.gHold) intro.gHold = true;
        else if (this.gFrame === 0 && intro.gHold) { intro.gHold = false; this.gFrame++; }
        else this.gFrame++;
        if (this.gFrame > 1) { this.gFrame = 0; this.introState = 2; }
      }
    } else {                        // FUN_004219c0
      this.gAcc += dt;
      if (this.gAcc > 59) {
        this.gAcc -= 60;
        this.gFrame = (A.go ? A.go.n : 2) - 1;
        if (++this.introState > 6) {
          this.gFrame = 0;
          this.match.world.introDone();
          this.match.input.clear();
          this.match.setScene(SC_PLAY);
        }
      }
    }
  }

  hurryUpdate(dt) {                 // FUN_00420f20 hurry part
    this.hurryAcc += dt;
    switch (this.hurryPhase) {
      case 1:
        if (!this.hurrySound) { this.hurrySound = true; sfx("HurryUp"); }
        if (this.hurryAcc > 150) {
          this.hurryAcc -= 150; this.hurryAlpha += 3;
          if (this.hurryAlpha >= 24) { this.hurryAlpha = 24; this.hurryPhase = 2; this.hurryAcc = 0; }
        }
        break;
      case 2:
        if (this.hurryAcc >= 150) {
          this.hurryAcc -= 150;
          if (++this.hurryBlink > 4) { this.hurryPhase = 3; this.hurryAcc = 0; this.hurryBlink = 0; }
        }
        break;
      case 3:
        if (this.hurryAcc > 150) {
          this.hurryAcc -= 150; this.hurryAlpha -= 3;
          if (this.hurryAlpha <= 0) { this.hurryAlpha = 0; this.hurryPhase = 4; this.hurryAcc = 0; }
        }
        break;
    }
  }

  roundEndUpdate(dt) {              // §5.7
    const w = this.match.world;
    let winner = false;
    for (const p of w.players) {
      if (!p.active) continue;
      if (p.wonThisRound && p.state !== 5 && !p.out) {
        if (p.state !== 6) { p.state = 6; p.frame = 0; }
        winner = true;
      }
    }
    if (winner) {
      this.poseAcc += dt; this.poseTotal += dt;
      if (this.poseAcc >= 70) {
        this.poseAcc = 0;
        for (const p of w.players) if (p.active && p.state === 6) p.frame = (p.frame + 1) % p.frames(SET_WI);
      }
      if (this.poseTotal > 2999) this.enterResults();
    } else if (!w.players.some((p) => p.active && !p.out && p.state === 5)) this.enterResults();
  }

  enterResults() {                  // scene 7, first frame (FUN_00419d60)
    const m = this.match;
    this.snap(m.renderer.fb);
    this.resTimer = 0;
    this.cupAcc = 0; this.cupFrame = 0; this.cupCycles = 0; this.textVisible = true;
    this.resSound = false;
    this.animT = 0;
    for (const p of m.world.players) { if (!p.active) continue; p.state = p.wonThisRound ? 6 : 1; p.frame = 0; }
    if (!this.final) this.resultState = 3;
    else {
      this.resultState = 4;
      this.rows = m.world.players.map((p, i) => ({ x: i % 2 === 0 ? 805 : -470 }));   // Boss Battle's board
    }
    m.setScene(SC_RESULT);
  }

  resultUpdate(dt) {
    const m = this.match;
    this.resTimer += dt;
    this.animT += dt;
    if (m.world.boss) m.world.boss.resultTick(dt);
    if (this.resultState === 3 || this.resultState === 4) {   // the cups turn, the text blinks, the winners pose
      this.cupAcc += dt;
      if (this.cupAcc > 79) { this.cupAcc = 0; if (++this.cupFrame >= 4) { this.cupFrame = 0; this.cupCycles++; } }
      this.textVisible = !((this.cupFrame === 2 || this.cupFrame === 3) && this.cupCycles < 3);
      while (this.animT >= 70) {
        this.animT -= 70;
        for (const p of m.world.players) if (p.active && p.state === 6) p.frame = (p.frame + 1) % p.frames(SET_WI);
      }
    }
    if (this.resultState === 3) {                 // round result, 3000 ms
      if (this.resTimer > 3000) {
        this.resultState = 0;
        this.resetRound();
        m.nextRound();
      }
    } else if (this.resultState === 4) {          // the match's end, 5000 ms, then back to the room (no exit button)
      m.world.players.forEach((p, i) => {
        const row = this.rows[i];
        if (i % 2 === 0) row.x = Math.max(150, row.x - dt * 50 * 0.05);
        else row.x = Math.min(150, row.x + dt * 50 * 0.05);
      });
      if (this.resTimer > 5000) { this.resTimer = 0; stopAll(); m.leaveResults(true); }
    }
  }

  // ------------------------------------------------------------------ drawing
  nameText(fb, p, x, y, text) {
    const colour = labelColour(p);
    fb.text(x + (11 - text.length) * 3, y, text, colour, BLACK);
  }

  drawTopBar(fb) {                  // FUN_0041c340
    const w = this.match.world, n = w.players.length;
    const top = n > 6 ? Math.ceil(n / 2) : 6;     // an arena of more than 6: the rest along the bottom
    for (let i = 0; i < n && i < 12; i++) {
      const p = w.players[i];
      if (!p || !p.active) continue;
      const x = 20 + 128 * (i < top ? i : i - top), y = i < top ? 0 : SH - 44;
      fb.half(A.ui_back, 0, x, y);
      fb.opaque(A.ui_back, 1, x, y);
      if (p.set) fb.opaque(p.set[SET_FACE], p.char >= 6 ? p.char - 5 : 0, x, y + 2);
      if (p.roundsWon >= 1) fb.opaque(A.ui_trophy, 0, x + 37, y + 17);
      if (p.roundsWon >= 2) fb.opaque(A.ui_trophy, 0, x + 57, y + 17);
      fb.opaque(A.ui_class, p.cls, x + 87, y + 19);
      this.nameText(fb, p, x + 45, y + 5, p.nick);
      if (w.bossItems) w.bossItems.drawRecent(fb, p, x, y);   // Boss Battle: the items it used lately (FUN_00420000)
    }
    this.drawClock(fb);
    this.drawItemPanel(fb);
    if (w.panel) w.panel.drawRanking(fb, this);   // mode 1: the ranking at the left, "1st".."last" over the players
  }

  drawClock(fb) {                   // FUN_0040e460 (none in a training: it has no time limit)
    if (this.match.training) return;
    fb.at(SW - 800, 0, () => {
      const t = Math.max(0, this.timer);
      fb.opaque(A.num_s, Math.min(9, Math.floor(t / 60)), 736, 48);
      fb.opaque(A.colon, 0, 748, 48);
      const s = t % 60;
      fb.opaque(A.num_s, Math.floor(s / 10), 764, 48);
      fb.opaque(A.num_s, s % 10, 778, 48);
    });
  }

  drawItemPanel(fb) {
    const bi = this.match.world.bossItems;          // Boss Battle: the Korean board, with the item slots and the purse
    fb.at(SW - 800, 0, () => { if (!bi || !bi.drawBoard(fb, this.match.world.me)) this.drawItems(fb); });
  }

  drawItems(fb) {                   // FUN_0041bcc0
    const me = this.match.world.me;
    fb.opaque(A.p_panel, 0, 716, 71);
    if (!me) return;
    const icon = (s, x, y) => { if (s) fb.opaque(s, s.n - 1, x, y); };
    const it = A.items;
    icon(me.fullFire ? it[7] : it[0], 725, 96);
    icon(it[1], 725, 130);
    icon([it[2], it[11], it[12]][me.bombKind] || it[2], 725, 164);
    if (!me.vulnerable) icon(it[6], 725, 198); else fb.opaque(A.item_gray, 2, 725, 198);
    if (me.kick) icon(it[3], 761, 96); else fb.opaque(A.item_gray, 0, 761, 96);
    if (me.glove) icon(it[4], 761, 130); else fb.opaque(A.item_gray, 1, 761, 130);
    if (me.punch) { if (me.special === 9) icon(it[9], 761, 164); else fb.half(it[9], it[9] ? it[9].n - 1 : 0, 761, 164); }
    else fb.opaque(A.item_gray, 3, 761, 164);
    if (me.line) { if (me.special === 10) icon(it[10], 761, 198); else fb.half(it[10], it[10] ? it[10].n - 1 : 0, 761, 198); }
    else fb.opaque(A.item_gray, 4, 761, 198);
    if (!me.fullFire) fb.opaque(A.num_s, Math.min(9, me.fire), 746, 112);
    fb.opaque(A.num_s, Math.min(9, me.speedBase), 746, 146);
    fb.opaque(A.num_s, Math.min(9, me.bombs), 746, 180);
  }

  drawYouArrow(fb, p) {
    if (p === this.match.world.me && this.blinkOn && this.blinkVisible && this.reviveKind === -1) {
      fb.opaque(A.p_arrow, 0, T(p.X + p.ox) + 65, T(p.Y + p.oy) + 30);   // (over the body as it is drawn: Smooth motion)
    }
  }

  drawOverlays(fb, scene) {
    fb.at(CX(), CY(), () => this.drawMiddle(fb, scene));
    this.drawChat(fb);
    this.drawFeed(fb);
    this.drawSuper(fb);
  }

  // a game master's /superbroadcast (session.superBroadcast, 0x8c3): it scrolls in yellow along a darkened strip at
  // the very bottom, over the arena's bottom wall (above the bottom row of panels, if any); not while the player types
  drawSuper(fb) {
    const sb = this.match.session.superBroadcast, now = performance.now();
    if (!sb || now >= sb.until || this.chatOpen) return;
    const y1 = SH - (this.match.world.players.length > 6 ? 44 : 0), y0 = y1 - SUPER_H;
    const line = "[GM] " + sb.text, w = line.length * 6;
    fb.darken(0, y0, SW, y1);
    fb.text(SW - Math.floor((((now - sb.since) / 1000) * SUPER_SPEED) % (SW + w)), y0 + 3, line, KIND[6][0], BLACK);
  }

  drawMiddle(fb, scene) {
    if (scene !== SC_LOADING) {     // HURRY UP at (150, 250)
      if (this.hurryPhase === 1) fb.alpha(A.hurry, 0, 150, 250, this.hurryAlpha, 0xffff);
      else if (this.hurryPhase === 2 && this.hurryBlink % 2 === 0) fb.alpha(A.hurry, 0, 150, 250, this.hurryAlpha);
      else if (this.hurryPhase === 3) fb.alpha(A.hurry, 0, 150, 250, this.hurryAlpha);
    }
    if (this.blinkOn && this.blinkVisible && this.reviveKind >= 0 && this.match.world.mode === 0) {   // Battle only
      fb.opaque(A.p_revive, [3, 0, 1][this.reviveKind] ?? 3, 260, 276);
    }
  }

  drawChat(fb) {                    // bottom left, above the bottom row of panels if there is one
    fb.at(0, SH - 600 - (this.match.world.players.length > 6 ? 44 : 0), () => {
      if (this.chatOpen) {
        fb.darken(85, 573, 675, 590);
        fb.text(95, 576, this.chatText, WHITE, BLACK);
        fb.opaque(A.caret, 0, 95 + this.chatText.length * 6 + 1, 576);
      }
      this.chat.forEach((l, i) => {
        const [fg, ol] = KIND[l.kind] || KIND[1];
        fb.text(88, 544 - 18 * i, l.text, fg, ol);
      });
    });
  }

  drawFeed(fb) {                    // right-aligned left of the item panel; names in their label colours
    const w = this.match.world, me = w.me, who = (id) => w.players.find((p) => p && p.id === id);
    fb.at(SW - 800, 0, () => {
      this.feed.forEach((l, i) => {
        const v = who(l.victim), k = who(l.killer);
        if (!v) return;
        const parts = (FEED[l.cause] && FEED[l.cause](k, v)) || [v, l.cause < 3 ? " was blown up" : " is out"];
        const mine = me && (me === k || me === v);      // the lines about me: the words in yellow
        let x = 704 - parts.reduce((n, s) => n + textWidth(typeof s === "string" ? s : s.nick), 0);
        const y = 54 + 18 * i;
        fb.darken(x - 4, y - 3, 708, y + 14);
        for (const s of parts) {
          const text = typeof s === "string" ? s : s.nick;
          fb.text(x, y, text, typeof s === "string" ? (mine ? FEED_MINE : FEED_TEXT) : labelColour(s), BLACK);
          x += textWidth(text);
        }
      });
    });
  }

  drawIntro(fb) {                   // FUN_00418d20
    fb.at(CX(), CY(), () => {
      if (this.introState === 0) fb.opaque(A.ready, this.rFrame, 170, 256);
      else if (this.introState === 3 || this.introState === 5) fb.white(A.go, this.gFrame, 170, 256);
      else fb.opaque(A.go, this.gFrame, 170, 256);
    });
  }

  // The last frame darkened, under the result screen (the side art too); again for a frame of another size (render.js).
  snap(fb) {
    this.snapshot = new Uint16Array(fb.px.length);
    for (let i = 0; i < fb.px.length; i++) this.snapshot[i] = (fb.px[i] & 0xf7de) >> 1;
  }

  drawResult(fb) {                  // FUN_00418e70
    if (this.snapshot && this.snapshot.length === fb.px.length) fb.px.set(this.snapshot);
    const w = this.match.world, me = w.me;
    if (this.resultState === 3) fb.at(CX(), CY(), () => this.drawRound(fb, w, me));
    else if (this.resultState === 4) {
      const board = w.boss && w.boss.drawFinalResult(fb);        // Boss Battle keeps its Korean board
      if (board) this.drawBossFinal(fb, w);
      else this.drawFinal(fb, w, me);
      this.drawCoinsWon(fb, me, !board);
    }
  }

  // What this player won in the match (0x8b8, web only), at the top of the match's end: the coin and "+N Bomber
  // Coins", then the Mission Coins picked up (Boss Battle), in the browser's font, bigger than the game's 12 px one.
  // Centred over the players' row; right of the title on Boss Battle's board.
  drawCoinsWon(fb, me, centred) {
    const won = me && this.match.coinsWon ? this.match.coinsWon.get(me.id) : undefined;
    if (!won) return;
    const key = won.coins + ":" + won.mission;
    if (!this.coinBanner || this.coinBanner.key !== key) {
      this.coinBanner = { key, imgs: [this.makeCoinBanner(won.coins, "Bomber Coins", this.coinImg, "#ffd447")] };
      if (won.mission) {
        this.coinBanner.imgs.push(this.makeCoinBanner(won.mission, "Mission Coins", this.missionImg, "#ffa94d"));
      }
    }
    const imgs = this.coinBanner.imgs, wide = imgs.reduce((n, img) => n + img.w + 8, -8);
    let x = centred ? (SW - wide) >> 1 : 300;     // (the board: after its title, clear of the item panel at 710)
    for (const img of imgs) { fb.rgba(img, x, 44); x += img.w + 8; }
  }

  makeCoinBanner(won, label, icon, colour) {
    const c = document.createElement("canvas"), ctx = c.getContext("2d");
    const num = "+" + won.toLocaleString("en-US");
    const big = "bold 22px system-ui, sans-serif", small = "bold 13px system-ui, sans-serif";
    ctx.font = big;
    const wn = ctx.measureText(num).width;
    ctx.font = small;
    const wl = ctx.measureText(label).width;
    c.width = Math.ceil(40 + wn + 6 + wl + 12);
    c.height = 38;
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";                 // a dark pill behind it, so it reads over any stage
    ctx.beginPath();
    ctx.arc(19, 19, 19, Math.PI / 2, Math.PI * 1.5);
    ctx.arc(c.width - 19, 19, 19, Math.PI * 1.5, Math.PI / 2);
    ctx.fill();
    if (icon) ctx.drawImage(icon, 5, 4, 30, 30);
    ctx.lineJoin = "round";
    ctx.font = big;
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#3a2400";
    ctx.fillStyle = colour;
    ctx.strokeText(num, 40, 27);
    ctx.fillText(num, 40, 27);
    ctx.font = small;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#fff";
    ctx.strokeText(label, 40 + wn + 6, 26);
    ctx.fillText(label, 40 + wn + 6, 26);
    return canvasRgba(c);
  }

  drawRound(fb, w, me) {            // round result: the players in a row, closer together when there are more than 6
    if (w.boss && w.boss.drawRoundResult(fb)) return this.drawBossRound(fb, w);
    // (the exe frames it with round_back.spr, the blue "BOMBERMAN-ONLINE" border; left out here, the stage shows)
    this.drawResultText(fb, me, 120);
    const n = w.players.length, step = n > 6 ? Math.min(80, Math.floor(560 / (n - 1))) : 80;
    w.players.forEach((p, i) => {
      if (!p.active || !p.set) return;
      const cx = 170 + step * i;
      this.drawPosed(fb, p, cx, 0);
      this.nameText(fb, p, cx, n > 6 ? 450 + 15 * (i % 3) : i % 2 === 0 ? 450 : 465, p.nick);
    });
  }

  // Boss Battle, a stage won (KR FUN_00417860, mode 3): no WIN / LOSE text; the players two columns further right
  drawBossRound(fb, w) {
    w.players.forEach((p, i) => {
      if (!p.active || !p.set) return;
      const cx = 250 + 80 * i;
      this.drawPosed(fb, p, cx, 0);
      this.nameText(fb, p, cx, i % 2 === 0 ? 450 : 465, p.nick);
    });
  }

  drawResultText(fb, me, y) {       // "YOU WIN!!" / "YOU LOSE!" / "DRAW", blinking with the cups, and its sound once
    if (!this.textVisible || this.match.watching) return;     // (a game master watching neither wins nor loses)
    let spr = A.txt_win, snd = "Win";
    if (this.drawFlag) { spr = A.txt_draw; snd = "Draw"; }
    else if (!me || !me.wonThisRound) { spr = A.txt_lose; snd = "Lose"; }
    fb.opaque(spr, 0, 170, y);
    if (!this.resSound) { this.resSound = true; sfx(snd); }
  }

  // A player on a result screen, cx = its cups' x (its middle is cx + 33), dy below the exe's place: the bomb's
  // shadow, the player standing or in its victory pose, and a cup per round won stacked above, this round's one
  // turning. The exe stacks 2 at most (a third win ends the match); the match's end shows a third.
  drawPosed(fb, p, cx, dy) {
    const px = cx - 36, py = 10 * 38 - 26 + dy, cups = Math.min(3, p.roundsWon);
    fb.opaque(A.bomb_s, 0, px + 23, py + 10);
    fb.opaque(p.wonThisRound ? p.set[SET_WI] : p.set[SET_ST], p.frame, px - 62, py - 108);
    for (let j = 0; j < cups; j++) {
      fb.opaque(A.round_cup, p.wonThisRound && j === cups - 1 ? this.cupFrame : 0, cx, 300 + dy - 76 * j);
    }
  }

  // The match's end, like a round's (the exe's table and its exit button are gone): YOU WIN / YOU LOSE, the players
  // in a row in their poses with their cups, and under each one the name, the guild (if any) and the points the match
  // gave; back to the room after 5 s. Centred and further apart than a round's row, for the guilds; 30 px lower and
  // the text 34 px higher, for a third cup. When the players cannot be that far apart (a big arena), their lines take
  // turns at two heights.
  drawFinal(fb, w, me) {
    fb.at(CX(), CY(), () => this.drawResultText(fb, me, 86));
    const n = w.players.length, step = n > 1 ? Math.min(FINAL_STEP, Math.floor((SW - 160) / (n - 1))) : 0;
    const mid0 = (SW >> 1) - ((step * (n - 1)) >> 1), staggered = step < FINAL_STEP - 16;
    const centred = (text, x, y, colour) => fb.text(x - (textWidth(text) >> 1), y, text, colour, BLACK);
    fb.at(0, CY(), () => w.players.forEach((p, i) => {
      if (!p.active) return;
      const mid = mid0 + step * i, y = 480 + (staggered && i % 2 ? 48 : 0);
      if (p.set) this.drawPosed(fb, p, mid - 33, 30);
      centred(p.nick, mid, y, labelColour(p));
      if (p.guild) centred(p.guild, mid, y + 15, GUILD_TEXT);
      const pts = p.pointsDelta;
      centred(pts > 0 ? `+${pts} points` : `${pts} points`, mid, y + 30, pts > 0 ? POINTS_TEXT : NO_POINTS);
    }));
  }

  // Boss Battle, the end (KR FUN_00417ea0, mode 3): the Korean rows, 145 px further right and 70 apart
  drawBossFinal(fb, w) {
    const back = w.boss.s.ui.resBack;
    w.players.forEach((p, i) => {
      if (!p.active) return;
      const x = T(this.rows[i].x) + 145, y = 94 + 70 * i;
      if (back) fb.opaque(back.r, 0, x, y);
      if (p.set) fb.opaque(p.set[SET_FACE], 0, x + 78, y + 18);
      this.nameText(fb, p, x + 200, y + 47, p.nick);
      fb.opaque(A.ui_class, p.cls, x + 292, y + 44);
      fb.text(x + 348, y + 47, p.pointsDelta > 0 ? "+" + p.pointsDelta : String(p.pointsDelta), WHITE, BLACK);
      fb.text(x + 392, y + 47, String(p.totalPoints), WHITE, BLACK);
      if (p.wonThisRound) fb.opaque(A.res_win, 0, x + 433, y);
    });
  }
}
