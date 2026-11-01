// The match's controls: which keys and gamepad buttons do what. Set in Options (lobby and room, options.js), kept
// in this browser (localStorage), read by the match (input.js) when it starts. A key is its KeyboardEvent.code (the
// key's place, whatever the layout); a gamepad button "b<n>", a stick direction "a<n>+" / "a<n>-" (the Gamepad API's
// indices; the names below are the "standard" layout's).

import { t, N_ } from "../i18n.js";

export const ACTIONS = [                       // [action, its name in Options, a short name] (English: i18n.js)
  ["up", N_("Up")], ["down", N_("Down")], ["left", N_("Left")], ["right", N_("Right")],
  ["bomb", N_("Bomb")], ["special", N_("Special (punch, line bomb, Louie's jump)"), N_("Special")],
  ["item1", N_("Boss Battle item 1"), N_("Item 1")], ["item2", N_("Boss Battle item 2"), N_("Item 2")],
  ["item3", N_("Boss Battle item 3"), N_("Item 3")], ["item4", N_("Boss Battle item 4"), N_("Item 4")],
  ["menu", N_("Leave the match (the Esc dialog)"), N_("Leave the match")],
];

// The exe's keys (FUN_00459320): the arrows, Left Shift = bomb (Space too), Z = special; Q W A S = Boss Battle's items
export const DEFAULT_KEYS = { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
  bomb: ["ShiftLeft", "Space"], special: ["KeyZ"], item1: ["KeyQ"], item2: ["KeyW"], item3: ["KeyA"],
  item4: ["KeyS"], menu: ["Escape"] };
export const DEFAULT_PAD = { up: "b12", down: "b13", left: "b14", right: "b15", bomb: "b0", special: "b1",
  item1: "b2", item2: "b3", item3: "b4", item4: "b5", menu: "b9" };
export const KEY_SLOTS = 2;                   // keys per action
export const FIXED_KEYS = new Set(["menu"]);  // Esc stays the menu key (the dialog closes with it too)

// Keys the page keeps: Esc (the menu, cancels), Enter (chat), Tab, the F keys (F2: FPS, F3 / F4: music, sound on / off)
export const RESERVED = new Set(["Escape", "Enter", "NumpadEnter", "Tab", "MetaLeft", "MetaRight", "ContextMenu",
  ...Array.from({ length: 12 }, (_, i) => "F" + (i + 1))]);

export const STICK_DEAD = 0.5;                // the left stick moves past half way
const STORE = "bmo-controls";

export function loadControls() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { /* none, or private mode */ }
  const c = { keys: {}, pad: {}, stick: saved && typeof saved.stick === "boolean" ? saved.stick : true };
  for (const [a] of ACTIONS) {
    const k = saved && saved.keys && saved.keys[a];
    c.keys[a] = FIXED_KEYS.has(a) ? [...DEFAULT_KEYS[a]]
      : Array.isArray(k) ? k.filter((x) => typeof x === "string" && !RESERVED.has(x)).slice(0, KEY_SLOTS)
        : [...DEFAULT_KEYS[a]];
    const p = saved && saved.pad ? saved.pad[a] : undefined;
    c.pad[a] = p === null || (typeof p === "string" && /^(b\d+|a\d+[+-])$/.test(p)) ? p : DEFAULT_PAD[a];
  }
  return c;
}

export function saveControls(c) {
  try { localStorage.setItem(STORE, JSON.stringify(c)); } catch (e) { /* private mode: for this visit only */ }
}

export function defaultControls() {
  const c = { keys: {}, pad: { ...DEFAULT_PAD }, stick: true };
  for (const [a, k] of Object.entries(DEFAULT_KEYS)) c.keys[a] = [...k];
  return c;
}

// ------------------------------------------------------------------ names
const KEY_NAMES = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: N_("key|Space"),
  ShiftLeft: N_("Left Shift"), ShiftRight: N_("Right Shift"), ControlLeft: N_("Left Ctrl"), ControlRight: N_("Right Ctrl"),
  AltLeft: N_("Left Alt"), AltRight: N_("Right Alt"), Backspace: "Backspace", Escape: "Esc", CapsLock: "Caps Lock",
  Insert: "Insert", Delete: "Delete", Home: "Home", End: "End", PageUp: "Page Up", PageDown: "Page Down" };

// The key's name; `layout` (navigator.keyboard.getLayoutMap(), where the browser has it) gives the letter this
// keyboard prints on it (an AZERTY KeyQ is "A").
export function keyName(code, layout) {
  if (KEY_NAMES[code]) return t(KEY_NAMES[code]);
  const printed = layout && layout.get(code);
  if (printed && printed.trim()) return printed.toUpperCase();
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return "Num " + code.slice(6).replace("Add", "+").replace("Subtract", "-")
    .replace("Multiply", "*").replace("Divide", "/").replace("Decimal", ".");
  return code;
}

const PAD_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", N_("Left stick press"),
  N_("Right stick press"), "D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →", "Home"];
const AXIS_NAMES = [[N_("Left stick ←"), N_("Left stick →")], [N_("Left stick ↑"), N_("Left stick ↓")],
  [N_("Right stick ←"), N_("Right stick →")], [N_("Right stick ↑"), N_("Right stick ↓")]];

export function padName(b) {
  if (!b) return "";
  const n = parseInt(b.slice(1), 10);
  if (b[0] === "b") return PAD_NAMES[n] ? t(PAD_NAMES[n]) : t("Button {n}", { n });
  const plus = b.endsWith("+");
  return AXIS_NAMES[n] ? t(AXIS_NAMES[n][plus ? 1 : 0]) : t("Axis {n}", { n }) + (plus ? " +" : " -");
}

// ------------------------------------------------------------------ gamepads
export const AXIS_ON = 0.6;                   // a stick direction counts past 60 %

export function gamepads() {
  try { return navigator.getGamepads ? [...navigator.getGamepads()].filter((g) => g && g.connected) : []; }
  catch (e) { return []; }                     // blocked by the page's permissions policy
}

export const gamepadsAvailable = () => typeof navigator.getGamepads === "function";

export function padDown(b, gp) {
  const n = parseInt(b.slice(1), 10);
  if (b[0] === "b") { const btn = gp.buttons[n]; return !!btn && (btn.pressed || btn.value > 0.5); }
  const v = gp.axes[n] || 0;
  return b.endsWith("+") ? v > AXIS_ON : v < -AXIS_ON;
}

// The actions the gamepads hold now: the buttons bound to them, and (stick on) the left stick's main direction
export function padActions(pad, stick) {
  const on = new Set();
  for (const gp of gamepads()) {
    for (const [a, b] of Object.entries(pad)) if (b && padDown(b, gp)) on.add(a);
    if (!stick) continue;
    const x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    if (Math.max(Math.abs(x), Math.abs(y)) < STICK_DEAD) continue;
    on.add(Math.abs(x) > Math.abs(y) ? (x < 0 ? "left" : "right") : (y < 0 ? "up" : "down"));
  }
  return on;
}
