// Options (the lobby's and the room's button; not in a match): the controls, the keys and the gamepad button for each
// action (game/controls.js), the sound, music and effects on / off and their volumes (game/sound.js), and the display
// (game/display.js: the screen filter, the game's own fire for every bomb, smooth motion, the FPS, Performance mode).
// All are kept in this browser; a match reads them.

import { ACTIONS, KEY_SLOTS, FIXED_KEYS, RESERVED, AXIS_ON, loadControls, saveControls, defaultControls, keyName,
  padName, gamepads, gamepadsAvailable, padActions } from "./game/controls.js";
import { settings, saveSound, music, musicOn, currentMusic, sfx, setMusicVolume } from "./game/sound.js";
import { display, saveDisplay } from "./game/display.js";
import { t, onLanguage } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const dlg = $("dlg-options");
const MUSIC_SAMPLE = "BGM0", SFX_SAMPLE = "GetItem";

let ctl = loadControls();
let layout = null;              // the letters this keyboard prints on its keys (Chrome), for the key names
let listening = null;           // { action, kind: "key" | "pad", slot, base: the gamepads when it began }
let raf = 0;
let previewing = false;         // the music sample plays
let tuneBefore = null;          // ... instead of this one (the lobby's or the room's), back when it stops
let padText = null;
const keysDown = new Set();     // keys held while the window is open: their rows light up

const actionName = (a) => { const r = ACTIONS.find(([id]) => id === a); return t(r[2] || r[1]); };

export function openOptions(tab = "controls") {
  ctl = loadControls();
  listening = null;
  showTab(tab);
  renderBinds();
  renderSound();
  $("opt-classic-fire").checked = display.classicFire;
  $("opt-side-art").checked = display.sideArt;
  $("opt-smooth").checked = display.smooth;
  $("opt-fps").checked = display.fps;
  $("opt-lite").checked = display.lite;
  showLite();
  for (const r of document.getElementsByName("opt-filter")) r.checked = r.value === display.filter;
  status("");
  if (!dlg.open) dlg.showModal();
  if (!layout && navigator.keyboard && navigator.keyboard.getLayoutMap) {
    navigator.keyboard.getLayoutMap().then((m) => { layout = m; renderBinds(); }).catch(() => {});
  }
  cancelAnimationFrame(raf);
  tick();
}

function showTab(tab) {
  for (const b of $("opt-tabs").querySelectorAll("button")) {
    b.classList.toggle("on", b.dataset.tab === tab);
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  }
  $("opt-controls").hidden = tab !== "controls";
  $("opt-sound").hidden = tab !== "sound";
  $("opt-display").hidden = tab !== "display";
}
for (const b of $("opt-tabs").querySelectorAll("button")) b.onclick = () => { stopListening(); showTab(b.dataset.tab); };

function status(text, warn = false) {
  $("opt-status").textContent = text;
  $("opt-status").classList.toggle("warn", warn);
}

// ------------------------------------------------------------------ the controls
function make(tag, cls, text = "") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function renderBinds() {
  const head = make("div", "bind bind-head");
  head.append(make("span", "", t("Action")), make("span", "bh-keys", t("Keyboard")), make("span", "", t("Gamepad")));
  $("opt-binds").replaceChildren(head, ...ACTIONS.map(([a, en]) => {
    const row = make("div", "bind"), name = t(en);
    row.dataset.action = a;
    row.append(make("span", "bind-name", name));
    for (let i = 0; i < KEY_SLOTS; i++) row.append(slot(a, name, "key", i));
    row.append(slot(a, name, "pad", 0));
    return row;
  }));
  $("opt-stick").checked = ctl.stick;
}

function slot(a, name, kind, i) {
  if (kind === "key" && FIXED_KEYS.has(a) && i > 0) return make("span", "bind-slot blank");
  const code = kind === "key" ? ctl.keys[a][i] : ctl.pad[a];
  const now = listening && listening.action === a && listening.kind === kind && listening.slot === i;
  const b = make("button", "bind-slot " + kind, now ? (kind === "key" ? t("Press a key…") : t("Press a button…"))
    : !code ? "—" : kind === "key" ? keyName(code, layout) : padName(code));
  b.type = "button";
  b.dataset.kind = kind;
  b.dataset.slot = i;
  b.classList.toggle("empty", !code && !now);
  b.classList.toggle("listening", !!now);
  b.disabled = kind === "key" && FIXED_KEYS.has(a);
  b.setAttribute("aria-label", `${name}, ${kind === "key" ? t("key {n}", { n: i + 1 }) : t("gamepad")}: ${b.textContent}`);
  b.onclick = () => listen(a, kind, i);
  return b;
}

function focusSlot(a, kind, i) {
  const b = $("opt-binds").querySelector(`.bind[data-action="${a}"] .bind-slot[data-kind="${kind}"][data-slot="${i}"]`);
  if (b) b.focus();
}

function listen(a, kind, i) {
  if (listening && listening.action === a && listening.kind === kind && listening.slot === i) return stopListening();
  listening = { action: a, kind, slot: i, base: kind === "pad" ? padSnapshot() : null };
  const name = actionName(a);
  status(kind === "key" ? t("Press the key for {action}.", { action: name })
    : gamepads().length ? t("Press a button or move a stick for {action}.", { action: name })
      : t("Connect a gamepad, then press the button for {action}.", { action: name }));
  renderBinds();
  focusSlot(a, kind, i);
}

function stopListening() {
  if (!listening) return;
  const { action, kind, slot: i } = listening;
  listening = null;
  status("");
  renderBinds();
  focusSlot(action, kind, i);
}

function assignKey(code) {
  const { action: a, slot: i } = listening;
  let from = null;
  if (code) {
    for (const [b] of ACTIONS) {
      if (FIXED_KEYS.has(b)) continue;
      const at = ctl.keys[b].indexOf(code);
      if (at >= 0 && !(b === a && at === i)) { ctl.keys[b].splice(at, 1); if (b !== a) from = b; }
    }
  }
  const keys = ctl.keys[a];
  if (code) { if (i < keys.length) keys[i] = code; else keys.push(code); }
  else if (i < keys.length) keys.splice(i, 1);
  listening = null;
  saveControls(ctl);
  const name = actionName(a);
  let text = code ? `${name}: ${keyName(code, layout)}.` : t("{action}: key cleared.", { action: name });
  if (from) text = t("{key} moved from {from} to {action}.", { key: keyName(code, layout), from: actionName(from), action: name });
  const bare = from && !ctl.keys[from].length ? from : !code && !keys.length ? a : null;
  if (bare) text += " " + t("{action} has no key now.", { action: actionName(bare) });
  status(text, !!bare);
  renderBinds();
  focusSlot(a, "key", Math.min(i, keys.length));
}

function assignPad(b) {
  const a = listening.action;
  let from = null;
  if (b) for (const [x] of ACTIONS) if (x !== a && ctl.pad[x] === b) { ctl.pad[x] = null; from = x; }
  ctl.pad[a] = b;
  listening = null;
  saveControls(ctl);
  const name = actionName(a);
  let text = b ? `${name}: ${padName(b)}.` : t("{action}: gamepad button cleared.", { action: name });
  if (from) {
    text = t("{key} moved from {from} to {action}.", { key: padName(b), from: actionName(from), action: name }) + " "
      + t("{action} has no gamepad button now.", { action: actionName(from) });
  }
  status(text, !!from);
  renderBinds();
  focusSlot(a, "pad", 0);
}

// The keys: a new binding while listening (Esc cancels, Backspace / Delete clears), else the rows of the keys held
document.addEventListener("keydown", (e) => {
  if (!dlg.open) return;
  if (!listening) { keysDown.add(e.code); return; }
  e.preventDefault();
  e.stopPropagation();
  if (e.code === "Escape") return stopListening();
  if (e.code === "Backspace" || e.code === "Delete") return listening.kind === "key" ? assignKey(null) : assignPad(null);
  if (listening.kind !== "key") return;
  if (RESERVED.has(e.code)) return status(t("Esc, Enter, Tab and the F keys stay with the game (menu, chat, sound)."), true);
  assignKey(e.code);
}, true);
document.addEventListener("keyup", (e) => { keysDown.delete(e.code); }, true);
dlg.addEventListener("cancel", (e) => { if (listening) { e.preventDefault(); stopListening(); } });

// The gamepads: what is new since listening began (a button down, a stick pushed past AXIS_ON)
function padSnapshot() {
  const base = new Map();
  for (const gp of gamepads()) {
    base.set(gp.index, { buttons: gp.buttons.map((b) => b.pressed || b.value > 0.5), axes: [...gp.axes] });
  }
  return base;
}

function padInput(base) {
  for (const gp of gamepads()) {
    let was = base.get(gp.index);
    if (!was) base.set(gp.index, was = { buttons: [], axes: [] });
    for (let i = 0; i < gp.buttons.length; i++) {
      const down = gp.buttons[i].pressed || gp.buttons[i].value > 0.5;
      if (down && !was.buttons[i]) return "b" + i;
      if (!down) was.buttons[i] = false;      // held when it began, let go since: it counts next time
    }
    for (let i = 0; i < gp.axes.length; i++) {
      const v = gp.axes[i], rest = Math.abs(was.axes[i] || 0) < 0.3;
      if (Math.abs(v) > AXIS_ON && rest) return "a" + i + (v > 0 ? "+" : "-");
      if (Math.abs(v) < 0.3) was.axes[i] = 0;
    }
  }
  return null;
}

function padStatus() {
  let text;
  if (!gamepadsAvailable()) {
    text = window.isSecureContext ? t("This browser does not let the page use a gamepad.")
      : t("This browser does not let the page use a gamepad at an http:// address; open the game at https:// to use one.");
  } else {
    const pads = gamepads();
    text = !pads.length ? t("No gamepad found. Connect one and press any of its buttons.")
      : t("Gamepad: {name}", { name: pads[0].id.replace(/\s*\(.*\)\s*$/, "").slice(0, 60) || t("connected") })
        + (pads.length > 1 ? " " + t("(and {n} more)", { n: pads.length - 1 }) : "") + ".";
  }
  if (text !== padText) $("opt-pad").textContent = padText = text;
}

// Each frame while the window is open: the gamepad line, a gamepad binding, the rows of what is held
function tick() {
  if (!dlg.open) return;
  padStatus();
  if (listening && listening.kind === "pad") {
    const b = padInput(listening.base);
    if (b) assignPad(b);
  }
  const on = listening ? new Set() : padActions(ctl.pad, ctl.stick);
  for (const code of keysDown) for (const [a] of ACTIONS) if (ctl.keys[a].includes(code)) on.add(a);
  for (const row of $("opt-binds").querySelectorAll(".bind[data-action]")) row.classList.toggle("on", on.has(row.dataset.action));
  raf = requestAnimationFrame(tick);
}

$("opt-stick").onchange = () => { ctl.stick = $("opt-stick").checked; saveControls(ctl); };
$("opt-reset").onclick = () => {
  listening = null;
  ctl = defaultControls();
  saveControls(ctl);
  renderBinds();
  status(t("The keys and gamepad buttons are back to the defaults."));
};

// ------------------------------------------------------------------ the sound
function renderSound() {
  const pct = (v) => Math.round(v * 100);
  $("opt-music-on").checked = settings.bgm;
  $("opt-sfx-on").checked = settings.sfx;
  $("opt-music").value = pct(settings.bgmVolume);
  $("opt-sfx").value = pct(settings.sfxVolume);
  $("opt-music-val").textContent = pct(settings.bgmVolume) + "%";
  $("opt-sfx-val").textContent = pct(settings.sfxVolume) + "%";
  $("opt-music").disabled = $("opt-music-test").disabled = !settings.bgm;
  $("opt-sfx").disabled = $("opt-sfx-test").disabled = !settings.sfx;
  $("opt-music-test").textContent = previewing ? t("Stop") : t("Play");
  $("opt-music-test").setAttribute("aria-pressed", String(previewing));
}

function preview(on) {
  if (on && !previewing) tuneBefore = currentMusic();
  previewing = on;
  music(on ? MUSIC_SAMPLE : tuneBefore);
  renderSound();
}

$("opt-music-on").onchange = () => {
  musicOn($("opt-music-on").checked);
  saveSound();
  if (!settings.bgm && previewing) preview(false);
  renderSound();
};
$("opt-music").oninput = () => {
  setMusicVolume($("opt-music").value / 100);
  $("opt-music-val").textContent = $("opt-music").value + "%";
};
$("opt-music").onchange = () => saveSound();
$("opt-music-test").onclick = () => preview(!previewing);

$("opt-sfx-on").onchange = () => {
  settings.sfx = $("opt-sfx-on").checked;
  saveSound();
  renderSound();
};
$("opt-sfx").oninput = () => {
  settings.sfxVolume = $("opt-sfx").value / 100;
  $("opt-sfx-val").textContent = $("opt-sfx").value + "%";
};
$("opt-sfx").onchange = () => { saveSound(); sfx(SFX_SAMPLE); };
$("opt-sfx-test").onclick = () => sfx(SFX_SAMPLE);

// another language: what this window made, made again
onLanguage(() => {
  padText = null;
  if (!dlg.open) return;
  listening = null;
  status("");
  renderBinds();
  renderSound();
});

// A match begins (main.js): the window closes, and the music sample stops now, not after the match's music began
export function closeOptions() {
  if (previewing) preview(false);
  if (dlg.open) dlg.close();
}

dlg.addEventListener("close", () => {
  listening = null;
  cancelAnimationFrame(raf);
  keysDown.clear();
  if (previewing) preview(false);
});

// ------------------------------------------------------------------ the display
$("opt-classic-fire").onchange = () => {
  display.classicFire = $("opt-classic-fire").checked;
  saveDisplay();
};
$("opt-side-art").onchange = () => {          // a match in progress follows at once (match.js fitFrame)
  display.sideArt = $("opt-side-art").checked;
  saveDisplay();
};
$("opt-smooth").onchange = () => {
  display.smooth = $("opt-smooth").checked;
  saveDisplay();
};
// Performance mode: what it keeps off shows greyed out, with the player's own choice kept for when it is off again
$("opt-lite").onchange = () => {
  display.lite = $("opt-lite").checked;
  saveDisplay();
  showLite();
};
function showLite() {
  const pane = $("opt-display");
  pane.classList.toggle("lite", display.lite);
  pane.querySelector(".opt-filters").disabled = display.lite;
  $("opt-side-art").disabled = $("opt-smooth").disabled = display.lite;
}
$("opt-fps").onchange = () => {
  display.fps = $("opt-fps").checked;
  saveDisplay();
};
for (const r of document.getElementsByName("opt-filter")) {
  r.onchange = () => { if (r.checked) { display.filter = r.value; saveDisplay(); } };
}
