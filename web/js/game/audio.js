// Sound effects and music from Data/sound/*.wav (and other Data paths) through WebAudio.

let ctx = null;
const buffers = new Map();
let music = null;

function context() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function unlockAudio() { try { context(); } catch (e) { /* no audio */ } }

// `name`: a file of Data/sound, or a path under Data (the boss's sounds and music, BattleBoss/...)
export function loadSound(name) {
  const key = name.toLowerCase();
  let p = buffers.get(key);
  if (!p) {
    p = fetch((name.includes("/") ? "data/" : "data/sound/") + name).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(name))))
      .then((buf) => context().decodeAudioData(buf)).catch(() => null);
    buffers.set(key, p);
  }
  return p;
}

export async function playSound(name, { volume = 1, loop = false } = {}) {
  let c;
  try { c = context(); } catch (e) { return null; }
  const buf = await loadSound(name);
  if (!buf) return null;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  const g = c.createGain();
  g.gain.value = volume;
  src.connect(g).connect(c.destination);
  src.start();
  return { stop: () => { try { src.stop(); } catch (e) { /* already stopped */ } } };
}

export async function playMusic(name, volume = 0.6) {
  stopMusic();
  const token = {};
  music = token;
  const h = await playSound(name, { volume, loop: true });
  if (music !== token) { if (h) h.stop(); return; }
  music = h;
}

export function stopMusic() {
  if (music && music.stop) music.stop();
  music = null;
}
