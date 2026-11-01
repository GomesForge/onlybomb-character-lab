// The browser's inspect tools (DevTools) open on this page (the server's devtools.py): the server is told once (a
// warning in its log, a report on the GM panel's Suspects page), and with config devtools "kick" a player who keeps
// them open in the lobby or the shop is signed out after a warning; never in a room or a match. A game master's page
// never looks. The sign: console.table of a big table takes some 10 ms with an inspector attached (it previews every
// cell) and 0.1 ms without, and console.log of it (a preview of the first few) stays short: nothing else makes it slow
// twice in a row (a zoomed page or a side panel change nothing; a slow computer makes console.log as slow).

import { t } from "./i18n.js";

const EVERY_MS = 2000;
const ROWS = 50, KEYS = 100;           // the table: ~11 ms with Chrome's DevTools open, ~0.1 ms closed
const SLOW_MS = 5, RATIO = 10;         // open: the table this slow, and this many times console.log's time ...
const TIMES = 2;                       // ... this many looks in a row
const GRACE_MS = 15000;                // open in the lobby ("kick"): signed out after this long

let session = null, toast = null, table = null, hits = 0, open = false, warned = 0;

export function initDevtools(s, toastFn) {
  session = s;
  toast = toastFn;
  setInterval(tick, EVERY_MS);
}

function looksOpen() {
  table ||= Array.from({ length: ROWS }, (_, i) => Object.fromEntries(Array.from({ length: KEYS }, (_, k) => ["k" + k, i * k])));
  const a = performance.now();
  console.table(table);
  const slow = performance.now() - a;
  const b = performance.now();
  console.log(table);
  const plain = performance.now() - b;
  console.clear();                     // (none kept: the console would preview them all when it opens)
  return slow >= SLOW_MS && slow >= RATIO * plain;
}

function tick() {
  const mode = session.devtools;
  if (!session.conn || session.screen === "login" || session.gm || !mode || mode === "off") {
    hits = 0;
    open = false;
    warned = 0;
    return;
  }
  const lobby = mode === "kick" && session.screen === "lobby" && !session.match && !session.training;
  if (open && !lobby) return;          // (told already; a room or a match: nothing to do there, no stall to make)
  hits = looksOpen() ? hits + 1 : 0;
  if (hits >= TIMES && !open) session.devtoolsOpen();
  open = hits >= TIMES;
  if (!open || !lobby) { warned = 0; return; }
  const now = performance.now();
  if (!warned) warned = now;
  const n = Math.ceil((GRACE_MS - (now - warned)) / 1000);
  if (n > 0) {
    toast(t("The browser's inspect tools are open. Close them, or you will be signed out in {n} s.", { n }), false,
      EVERY_MS + 500);
    return;
  }
  hits = 0;
  open = false;
  warned = 0;
  for (const d of document.querySelectorAll("dialog[open]")) d.close();   // (the shop, the Account window...)
  session.logout();
  toast(t("You were signed out: the browser's inspect tools were open."), false, 10000);
}
