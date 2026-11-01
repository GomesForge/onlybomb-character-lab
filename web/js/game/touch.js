// On-screen controls for touch screens (phones, tablets): a D-pad on the left; BOMB and the special key (punch,
// line bomb, a Louie's jump: Z) on the right, with Boss Battle's Q W A S items above them; a menu button for the
// quit dialog (Esc), and one for the full screen where the browser has it. They press the same actions as the keys
// and the gamepad (input.js). Config touch_controls switches them on, and only touch-first devices (no hover, coarse
// pointer) show them. They hide outside the play (loading, results). While they are on, the page does not zoom (a
// double tap, two fingers): app.css keeps the game out from under them.

import { KEYS } from "./player.js";
import { SC_INTRO, SC_PLAY } from "./scenes.js";
import { t } from "../i18n.js";

export const touchDevice = () => matchMedia("(hover: none) and (pointer: coarse)").matches;

const FOLLOW = 0.4;            // the D-pad's centre trails the thumb this far (of the pad's radius)
const ITEMS = [["item1", "Q"], ["item2", "W"], ["item3", "A"], ["item4", "S"]];   // Boss Battle's slots (bossitems.js)
const BOSS = 4;

function make(tag, cls, text = "") {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export class TouchControls {
  constructor(screen) {
    this.screen = screen;              // #screen-game: the controls lie over it
    this.el = null;
    this.raf = 0;
  }

  attach(match) {
    this.detach();
    const input = match.input, keys = new Set();
    const press = (code) => { keys.add(code); input.press(code); };
    const release = (code) => { keys.delete(code); input.release(code); };
    this.releaseAll = () => { for (const k of [...keys]) release(k); };
    const el = this.el = make("div", "touch-pad");
    el.setAttribute("aria-hidden", "true");

    // The D-pad. Its zone is all of its side (.tp-zone): a thumb on the pad steers from the pad's centre at once, one
    // anywhere else in the zone brings the pad under it. The side the thumb is on from the centre is the direction (a
    // little stickiness near the diagonals); the centre trails the thumb at FOLLOW of the pad's radius, so turning
    // back is always a short move (about half a thumb). Let go: the pad goes home.
    const zone = make("div", "tp-zone"), pad = make("div", "tp-dpad"), knob = make("i", "tp-knob");
    const arms = {};
    for (const d of ["up", "left", "right", "down"]) pad.append(arms[d] = make("i", "tp-arm " + d));
    pad.append(knob);
    let pid = null, held = null, cx = 0, cy = 0, home = null;
    const hold = (d) => {
      if (d === held) return;
      if (held) { release(KEYS[held]); arms[held].classList.remove("on"); }
      held = d;
      if (d) { press(KEYS[d]); arms[d].classList.add("on"); }
    };
    const aim = (e) => {
      const far = home.r * FOLLOW;
      let dx = e.clientX - cx, dy = e.clientY - cy, dist = Math.hypot(dx, dy);
      if (dist > far) {
        cx = e.clientX - dx * far / dist; cy = e.clientY - dy * far / dist;
        dx = e.clientX - cx; dy = e.clientY - cy; dist = far;
        pad.style.transform = `translate(${cx - home.x}px, ${cy - home.y}px)`;
      }
      const k = home.r * 0.45 / far;                      // the knob: the thumb's pull, out to near the arms
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      if (dist < Math.max(10, home.r * 0.16)) return hold(null);
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const wasX = held === "left" || held === "right", wasY = held === "up" || held === "down";
      const horizontal = wasX ? ax * 1.3 > ay : wasY ? ax > ay * 1.3 : ax > ay;
      hold(horizontal ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down"));
    };
    zone.addEventListener("pointerdown", (e) => {
      if (pid !== null) return;
      pid = e.pointerId;
      zone.setPointerCapture(pid);
      const box = el.getBoundingClientRect(), r = pad.offsetWidth / 2;      // (home: its place, not where it is going)
      home = { x: box.left + pad.offsetLeft + r, y: box.top + pad.offsetTop + r, r };
      const onPad = Math.hypot(e.clientX - home.x, e.clientY - home.y) <= r;
      cx = onPad ? home.x : e.clientX; cy = onPad ? home.y : e.clientY;
      pad.classList.add("held");
      pad.style.transform = `translate(${cx - home.x}px, ${cy - home.y}px)`;
      aim(e);
      e.preventDefault();
    });
    zone.addEventListener("pointermove", (e) => { if (e.pointerId === pid) aim(e); });
    const goHome = () => {
      pid = null;
      hold(null);
      pad.classList.remove("held");
      pad.style.transform = knob.style.transform = "";
    };
    const lift = (e) => { if (e.pointerId === pid) goHome(); };
    zone.addEventListener("pointerup", lift);
    zone.addEventListener("pointercancel", lift);
    this.dropDpad = goHome;

    // a button holds its key while touched
    const button = (cls, text, code) => {
      const b = make("div", "tp-btn " + cls, text);
      let id = null;
      b.addEventListener("pointerdown", (e) => {
        if (id !== null) return;
        id = e.pointerId;
        b.setPointerCapture(id);
        b.classList.add("on");
        press(code);
        if (code === KEYS.bomb && navigator.vibrate) navigator.vibrate(12);   // (a phone that can: a little tap)
        e.preventDefault();
      });
      const up = (e) => { if (e.pointerId === id) { id = null; b.classList.remove("on"); release(code); } };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      return b;
    };
    const bomb = button("tp-bomb", t("BOMB"), KEYS.bomb);
    const act = button("tp-act", t("Special"), KEYS.special);
    el.append(zone, pad, bomb, act);
    if (match.mode === BOSS) {
      const items = make("div", "tp-items");
      items.append(...ITEMS.map(([a, label]) => button("tp-item", label, a)));
      el.append(items);
    }
    const menu = make("div", "tp-btn tp-menu", "☰");   // the quit dialog, as Esc
    menu.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (match.scene === SC_PLAY && match.phase === 0) match.hud.toggleQuit();
    });
    el.append(menu);
    if (document.fullscreenEnabled && !matchMedia("(display-mode: fullscreen)").matches) {   // (not an iPhone's
      // browser, nor the installed game already full screen): the browser's bars away
      const full = make("div", "tp-btn tp-full");
      full.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 6V1h5v2H3v3zm9-5h5v5h-2V3h-3zM1 10h2v3h3v2H1zm12 0h2v5h-5v-2h3z"/></svg>';
      full.addEventListener("pointerup", () => {         // (a touch's activation comes with its pointerup)
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
      });
      el.append(full);
    }

    // no zoom while it plays: no double tap, no two fingers (Safari's gestures too); the quit dialog's buttons keep
    // their clicks. The page's own zoom comes back after the match
    const still = (e) => { if (!e.target.closest(".quit-dlg")) e.preventDefault(); };
    const gesture = (e) => e.preventDefault();
    this.unblock = () => {
      for (const t of ["touchstart", "touchmove", "dblclick"]) this.screen.removeEventListener(t, still);
      document.removeEventListener("gesturestart", gesture);
      if (this.viewport) this.viewport.content = this.viewportWas;
    };
    for (const t of ["touchstart", "touchmove", "dblclick"]) this.screen.addEventListener(t, still, { passive: false });
    document.addEventListener("gesturestart", gesture);
    this.viewport = document.querySelector('meta[name="viewport"]');
    if (this.viewport) {
      this.viewportWas = this.viewport.content;
      this.viewport.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
    }

    this.screen.append(el);
    this.screen.classList.add("touch");
    const tick = () => {               // shown while the round plays (and its READY / GO)
      const show = match.scene === SC_PLAY || match.scene === SC_INTRO;
      if (el.hidden === show) {
        el.hidden = !show;
        if (!show) { this.dropDpad(); this.releaseAll(); }
      }
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  detach() {
    cancelAnimationFrame(this.raf);
    if (!this.el) return;
    this.releaseAll();
    this.unblock();
    this.el.remove();
    this.el = null;
    this.screen.classList.remove("touch");
  }
}
