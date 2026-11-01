// Coming back to a match (the server's rejoin.py). When a player's connection drops in a match, the server keeps their
// place for a while (0x8c7 says how long) and gives the page a secret to come back with. Kept in this tab
// (sessionStorage), it outlives a reload: a page reloaded in a match (F5, a phone's pull-to-refresh, the browser's own
// reload after a crash) goes back to it without signing in, and a page whose connection drops goes back by itself
// while it can (session.js).
// And what the page knows of how a match of its ended before its end (the server cannot see why a page closed): kept
// in localStorage until the next channel join, which sends it to the server's log (0x4c6).

const KEY = "bmo.rejoin";        // sessionStorage: {u, login, ch, token (hex), s, inMatch, seen (ms)}
const LOG = "bmo.matchlog";      // localStorage: this page's match {page, at, seen, hidden, pagehide, persisted}
const REPORT = "bmo.report";     // localStorage: what the next channel join tells the server
const MARGIN_MS = 1500;          // a record this close to the end of the server's wait is not tried
export const PAGE = Math.random().toString(36).slice(2, 10);   // this page (a reload is another one)

function read(store, key) {
  try { return JSON.parse(store.getItem(key) || "null"); } catch (e) { return null; }
}
function write(store, key, value) {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch (e) { /* private mode, storage full: no coming back after a reload, no report */ }
}
const session = () => { try { return window.sessionStorage; } catch (e) { return null; } };
const local = () => { try { return window.localStorage; } catch (e) { return null; } };
const get = (store, key) => (store ? read(store, key) : null);
const put = (store, key, value) => { if (store) write(store, key, value); };

export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));

// ------------------------------------------------------------------ the secret
// 0x8c7: the secret of this page's player (a new one each join), how long the server waits for it, and the channel
export function setToken(rec) {
  const old = get(session(), KEY) || {};
  put(session(), KEY, { ...old, ...rec, seen: Date.now() });
}

// The match this tab may go back to: its record, if a match was on and the server still waits for it; else null
export function comeBack() {
  const r = get(session(), KEY);
  if (!r || !r.inMatch || !r.token || !r.ch || !r.s) return null;
  return Date.now() - (r.seen || 0) < r.s * 1000 - MARGIN_MS ? r : null;
}

export function forget() { put(session(), KEY, null); }

// ------------------------------------------------------------------ the match's life
let beatTimer = 0;

export function matchStarted() {
  const r = get(session(), KEY);
  if (r) put(session(), KEY, { ...r, inMatch: true, seen: Date.now() });
  const now = Date.now();
  put(local(), LOG, { page: PAGE, at: now, seen: now, hidden: document.hidden, pagehide: 0, persisted: false });
  clearInterval(beatTimer);
  beatTimer = setInterval(beat, 2000);
}

// The match is still on (and the page with it): when the page dies, the last beat says when
function beat() {
  const now = Date.now();
  const r = get(session(), KEY);
  if (r && r.inMatch) put(session(), KEY, { ...r, seen: now });
  const l = get(local(), LOG);
  if (l && l.page === PAGE) put(local(), LOG, { ...l, seen: now, hidden: document.hidden });
}

// The match ended as it should (its end, quitting, leaving the room, Logout): nothing to come back to or report
export function matchEnded() {
  clearInterval(beatTimer);
  beatTimer = 0;
  const r = get(session(), KEY);
  if (r && r.inMatch) put(session(), KEY, { ...r, inMatch: false });
  const l = get(local(), LOG);
  if (l && l.page === PAGE) put(local(), LOG, null);
}

window.addEventListener("pagehide", (ev) => {        // a reload, a page closed or left: the page's own end
  if (!beatTimer) return;
  beat();
  const l = get(local(), LOG);
  if (l && l.page === PAGE) put(local(), LOG, { ...l, pagehide: Date.now(), persisted: !!ev.persisted });
});
document.addEventListener("visibilitychange", () => { if (beatTimer) beat(); });

// ------------------------------------------------------------------ the report
function device() {
  const ua = navigator.userAgent || "";
  const os = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "ios"
    : /Android/.test(ua) ? "android" : /Win/.test(ua) ? "win" : /Mac/.test(ua) ? "mac" : /Linux|X11|CrOS/.test(ua) ? "linux" : "other";
  const browser = (ua.match(/(Edg|OPR|SamsungBrowser|CriOS|FxiOS|Firefox|Chrome)\/[\d.]+/) ||
    ua.match(/Version\/[\d.]+(?=.*Safari)/) || [""])[0];
  let standalone = false;
  try { standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) { /* none */ }
  let touch = false;
  try { touch = matchMedia("(pointer: coarse)").matches; } catch (e) { /* none */ }
  return { os, browser: browser.slice(0, 40), app: standalone, touch, mem: navigator.deviceMemory || null };
}

function navigation() {
  try { return (performance.getEntriesByType("navigation")[0] || {}).type || ""; } catch (e) { return ""; }
}

// At load: a match log of another page means that page ended in a match. pagehide seen: it was reloaded, closed or
// left (the reload this page may be); not seen: killed (a crash, the system, a frozen tab dropped)
{
  const l = get(local(), LOG);
  if (l && l.page !== PAGE) {
    put(local(), LOG, null);
    put(local(), REPORT, {
      what: l.pagehide ? "page left in a match" : "page died in a match (no pagehide)",
      nav: navigation(), hidden: !!l.hidden, bfcache: !!l.persisted,
      in_match_s: Math.round((l.seen - l.at) / 1000), gone_s: Math.round((Date.now() - l.seen) / 1000), ...device(),
    });
  }
}

// The connection dropped in a match while the page lived on (session.js onClosed): how it ended. The match's beat
// stops: the server's wait counts from now, and so does comeBack's
export function socketLost(info) {
  clearInterval(beatTimer);
  beatTimer = 0;
  const l = get(local(), LOG);
  put(local(), REPORT, {
    what: "connection lost in a match", code: info && info.code, clean: !!(info && info.clean),
    reason: (info && info.reason) || "", hidden: document.hidden,
    in_match_s: l ? Math.round((Date.now() - l.at) / 1000) : null, at: Date.now(), ...device(),
  });
}

// What the next channel join sends (once), with how it went: back in the match or not
export function takeReport(extra) {
  const r = get(local(), REPORT);
  if (!r) return null;
  put(local(), REPORT, null);
  if (r.at) { r.back_after_s = Math.round((Date.now() - r.at) / 1000); delete r.at; }
  return JSON.stringify({ ...r, ...extra }).slice(0, 1900);
}
