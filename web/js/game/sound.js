// Sound table of the match (H_objects §9). DirectSound played every file from one buffer, so
// re-triggering a sound restarts it instead of overlapping.

import { loadSound } from "./audio.js";

export const SOUNDS = ["BKSND0", "BKSND1", "BKSND2", "CLK3", "CLK4", "CLK5", "CLK6", "BGM0", "BGM1", "BGM2",
  "BGM3", "BGM4", "Ready", "Start", "TakeDown", "Bomb", "GetItem", "HurryUp", "Revive", "Throw", "Kick", "Faint",
  "Corpse", "SetSkull", "FreeSkull", "InfectSkull", "Win", "Draw", "Lose", "Block", "Death"];

const NORMAL = 1.0;                 // volume option 4 = 0 dB
const REMOTE = Math.pow(10, -900 / 2000);   // fixed -900 (1/100 dB) for other players' events

let ctx = null;
const playing = new Map();          // name -> source node (one "buffer" per sound)
const gains = new Map();            // name -> its gain node (the music's volume changes while it plays)

// On / off (F3 / F4 in a match, or Options) and the volumes, 0..1 (Options, in the lobby and the room), kept in
// this browser. 1 is the exe's level (volume option 4, 0 dB); the sliders' loudness grows with the square.
export const settings = { sfx: true, bgm: true, sfxVolume: 1, bgmVolume: 1 };
const STORE = "bmo-sound";
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || "null") || {};
  for (const k of ["sfx", "bgm"]) if (typeof saved[k] === "boolean") settings[k] = saved[k];
  for (const k of ["sfxVolume", "bgmVolume"]) {
    if (typeof saved[k] === "number" && saved[k] >= 0 && saved[k] <= 1) settings[k] = saved[k];
  }
} catch (e) { /* none, or private mode */ }

export function saveSound() {
  try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* private mode: for this visit only */ }
}

const level = (v) => v * v;

function context() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// A browser lets a page make sound only after a click, a tap or a key: what was asked for before (the sign-in
// screen's music) starts then
for (const ev of ["pointerdown", "pointerup", "touchend", "click", "keydown"]) {
  addEventListener(ev, () => { if (ctx && ctx.state !== "running") ctx.resume().catch(() => {}); },
    { capture: true, passive: true });
}

export function preloadSounds() {
  return Promise.all(SOUNDS.map((n) => loadSound(n + ".wav")));
}

async function play(name, volume, loop = false, tune = false) {
  let c;
  try { c = context(); } catch (e) { return; }
  const buf = await loadSound(/\.\w+$/.test(name) ? name : name + ".wav");   // a table name, or a path with its extension
  if (!buf || tune && (bgm !== name || !settings.bgm)) return;    // (music: another asked for while this one loaded)
  stop(name);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  const g = c.createGain();
  g.gain.value = volume;
  src.connect(g).connect(c.destination);
  src.start();
  playing.set(name, src);
  gains.set(name, g);
  src.onended = () => { if (playing.get(name) === src) { playing.delete(name); gains.delete(name); } };
}

export function stop(name) {
  const s = playing.get(name);
  if (s) { try { s.stop(); } catch (e) { /* stopped */ } playing.delete(name); gains.delete(name); }
}

// hush(true): no new sound effects for now (a match catching up on seconds it could not play, match.js)
let hushed = false;
export function hush(on) { hushed = on; }

export function sfx(name) { if (settings.sfx && !hushed) play(name, NORMAL * level(settings.sfxVolume)); }
export function sfxRemote(name) { if (settings.sfx && !hushed) play(name, REMOTE * level(settings.sfxVolume)); }
export function sfxLoop(name) {
  if (settings.sfx && !hushed && !playing.has(name)) play(name, NORMAL * level(settings.sfxVolume), true);
}

// The music: a match's (BGM0..4), or the lobby's and the room's as BomberMan.exe plays them (H_objects §9.2):
// BKSND0 from the sign-in screen on, BKSND1 back in the lobby from a room or a match (0x3f9), BKSND2 back in the room
// after a match (0x401); none of them changes on entering a room
let bgm = null;
export function music(name) {
  if (bgm) stop(bgm);
  bgm = name;
  if (settings.bgm && name) play(name, NORMAL * level(settings.bgmVolume), true, true);
}
export const currentMusic = () => bgm;

// The music on / off (Options): what was asked for plays again, or stops and is kept for later
export function musicOn(on) {
  settings.bgm = on;
  if (!bgm) return;
  if (!on) stop(bgm);
  else if (!playing.has(bgm)) play(bgm, NORMAL * level(settings.bgmVolume), true, true);
}

export function setMusicVolume(v) {   // the Options slider: the music playing follows it
  settings.bgmVolume = v;
  const g = bgm && gains.get(bgm);
  if (g) g.gain.value = NORMAL * level(v);
}
export function stopAll() {
  for (const n of [...playing.keys()]) stop(n);
  bgm = null;
}
