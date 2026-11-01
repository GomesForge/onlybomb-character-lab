// A game master's /superbroadcast (the server's h_lobby.broadcast_command, 0x8c3): the message scrolls in yellow along
// a band at the bottom of the screen, for the seconds the server says. Outside a match it is this band, over the
// windows too (a popover: the top layer) and never in the way of a click or a tap; in a match the game draws it
// itself, over the arena's bottom wall (game/hud.js drawSuper), so this band hides then and comes back after.

const $ = (id) => document.getElementById(id);
const band = $("super-band"), text = $("super-text");
const SPEED = 110;                       // pixels a second
const CHECK_MS = 400;                    // while one lasts: over yet? a match? a window opened over it?
const POPOVER = typeof band.showPopover === "function";

let session = null, run = null, watch = null, current = null, dialogs = 0;

export function initSuperBroadcast(s) {
  session = s;
  if (POPOVER) band.hidden = false;      // (then the popover alone shows or hides it)
  session.addEventListener("superbroadcast", () => {
    current = null;                      // (a new message: the band starts over)
    tick();
    if (!watch) watch = setInterval(tick, CHECK_MS);
  });
}

function tick() {
  const sb = session.superBroadcast, on = sb && performance.now() < sb.until;
  if (!on || session.match || session.training) {   // over, or a match (a training too) draws it itself
    hide();
    if (!on) { clearInterval(watch); watch = null; }
    return;
  }
  if (current !== sb) show(sb);
  raise();
}

function show(sb) {
  current = sb;
  text.textContent = sb.text;
  if (POPOVER) {
    if (!band.matches(":popover-open")) band.showPopover();
  } else {
    band.hidden = false;
  }
  if (run) run.cancel();
  run = null;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;     // (still: the start of it, CSS)
  const track = text.parentElement.clientWidth, w = text.scrollWidth;
  run = text.animate([{ transform: `translate(${track}px, -50%)` }, { transform: `translate(${-w}px, -50%)` }],
    { duration: ((track + w) / SPEED) * 1000, iterations: Infinity });
}

function hide() {
  current = null;
  if (POPOVER) {
    if (band.matches(":popover-open")) band.hidePopover();
  } else {
    band.hidden = true;
  }
  if (run) run.cancel();
  run = null;
}

// a window opened after the band would cover it (its backdrop): shown again, it is on top once more
function raise() {
  const n = document.querySelectorAll("dialog[open]").length;
  if (n !== dialogs && POPOVER && band.matches(":popover-open")) {
    band.hidePopover();
    band.showPopover();
  }
  dialogs = n;
}
