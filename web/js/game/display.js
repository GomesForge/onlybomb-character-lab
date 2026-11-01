// What the match shows (Options → Display), kept in this browser; the match reads it as it draws.
export const display = {
  classicFire: false,      // every bomb's fire as the game's own: bomb skins keep their bomb
  filter: "classic",       // how the frame is enlarged to the screen (screen.js: classic, sharp, smooth, crt)
  sideArt: true,           // a wide page: the map's scenery beside the screen where it has some (sideart.js)
  smooth: true,            // what moves drawn between the 20 ms steps at every screen refresh (smooth.js)
  fps: false,              // the frames drawn each second in a corner of the match (fpsmeter.js; F2 in a match)
  lite: false,             // Performance mode: for a slow computer or phone, the extras that cost the most stay off
};
const STORE = "bmo-display";
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || "null") || {};
  for (const k of ["classicFire", "sideArt", "smooth", "fps", "lite"]) if (typeof saved[k] === "boolean") display[k] = saved[k];
  if (["classic", "sharp", "smooth", "crt"].includes(saved.filter)) display.filter = saved.filter;
} catch (e) { /* none, or private mode */ }

// What the match uses: each setting, except what Performance mode keeps off whatever it says (and keeps, for when it
// is off again): the frames drawn between steps, a frame made wider for the side art, the page-wide blurred copy of
// the game beside it, and a screen filter drawn at the screen's own pixels.
export const active = {
  get filter() { return display.lite ? "classic" : display.filter; },
  get sideArt() { return display.sideArt && !display.lite; },
  get smooth() { return display.smooth && !display.lite; },
  get blur() { return !display.lite; },
};

export function saveDisplay() {
  try { localStorage.setItem(STORE, JSON.stringify(display)); } catch (e) { /* private mode: for this visit only */ }
}
