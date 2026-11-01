// The match's input, as actions (controls.js: up, down, left, right, bomb, special, item1..4, menu): the keyboard
// and the gamepads by the bindings set in Options, and the touch controls (touch.js). An action is held while
// anything holds it (a key, a gamepad, a finger), and "pressed" once when the first one takes it.

import { loadControls, padActions } from "./controls.js";

export class Input {
  constructor(target) {
    const c = loadControls();
    this.byCode = new Map();      // key code -> its actions
    for (const [a, codes] of Object.entries(c.keys)) {
      for (const k of codes) this.byCode.set(k, [...(this.byCode.get(k) || []), a]);
    }
    this.pad = c.pad;
    this.stick = c.stick;
    this.holders = new Map();     // action -> what holds it: "k:<code>", "pad", "touch"
    this.pressed = new Set();     // actions that went down since the last step
    this.padHeld = new Set();     // the actions the gamepads held at the last poll
    this.enabled = true;
    this.onKey = null;            // optional hook(ev) -> true to swallow (chat typing, dialogs)
    this.kd = (e) => {
      if (this.onKey && this.onKey(e)) return;
      if (!this.enabled) return;
      const acts = this.byCode.get(e.code);
      if (acts) for (const a of acts) this.hold(a, "k:" + e.code);
      if (acts || e.code.startsWith("Arrow") || e.code === "Space" || e.code === "Tab") e.preventDefault();
    };
    this.ku = (e) => { for (const a of this.byCode.get(e.code) || []) this.let(a, "k:" + e.code); };
    this.blur = () => { for (const s of this.holders.values()) s.clear(); };
    target.addEventListener("keydown", this.kd);
    target.addEventListener("keyup", this.ku);
    window.addEventListener("blur", this.blur);
    this.target = target;
  }

  hold(a, by) {
    let s = this.holders.get(a);
    if (!s) this.holders.set(a, s = new Set());
    if (!s.size) this.pressed.add(a);
    s.add(by);
  }

  let(a, by) {
    const s = this.holders.get(a);
    if (s) s.delete(by);
  }

  held(a) {
    if (Array.isArray(a)) return a.some((x) => this.held(x));
    const s = this.holders.get(a);
    return !!s && s.size > 0;
  }

  // True once per press.
  take(a) {
    const had = this.pressed.has(a);
    this.pressed.delete(a);
    return had;
  }

  takeAny(as) {
    let any = false;
    for (const a of as) if (this.take(a)) any = true;
    return any;
  }

  // A button of the touch controls (touch.js): as if it went down / up
  press(a) { if (this.enabled) this.hold(a, "touch"); }
  release(a) { this.let(a, "touch"); }

  // The gamepads, once a frame (Match.frame): what they hold now against the last poll
  poll() {
    const now = padActions(this.pad, this.stick);
    if (!now.size && !this.padHeld.size) return;
    for (const a of now) if (!this.padHeld.has(a)) this.hold(a, "pad");
    for (const a of this.padHeld) if (!now.has(a)) this.let(a, "pad");
    this.padHeld = now;
  }

  clear() { for (const s of this.holders.values()) s.clear(); this.pressed.clear(); }

  endFrame() { this.pressed.clear(); }

  dispose() {
    this.target.removeEventListener("keydown", this.kd);
    this.target.removeEventListener("keyup", this.ku);
    window.removeEventListener("blur", this.blur);
  }
}
