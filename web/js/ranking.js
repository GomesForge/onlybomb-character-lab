// The lobby's rankings: the guilds (the server's guilds.py, by points; All opens the Guild window's Ranking) and the
// players (ranks.leaders), a tab each: by points first, then Survival, Hyper Bomb, Panel Attack and Drop Bomb by wins.
// Asked again whenever the lobby shows, and every minute while it does. My guild's row and mine are lit, and come last
// when they are not among the first.

import { MODE_NAMES, GROUP_HYPER, GROUP_PANEL, GROUP_DROP, modeName } from "./session.js";
import { emblem, openGuild } from "./guild.js";
import { t, N_, num, onLanguage } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const fmt = num;
const REFRESH_MS = 60000;
const POINTS = 255;                   // the ranking by points (ranks.POINTS); the others are modes (game types)
const TABS = [[POINTS, N_("Points"), N_("Total points")], [0, N_("Survival"), MODE_NAMES[0]],   // [tab, its name, title]
  [GROUP_HYPER, N_("Hyper"), MODE_NAMES[GROUP_HYPER]], [GROUP_PANEL, N_("Panel"), MODE_NAMES[GROUP_PANEL]],
  [GROUP_DROP, N_("Drop"), MODE_NAMES[GROUP_DROP]]];
const TAB_KEY = "rank-tab";

let session = null, belt = null;
let mode = POINTS;                    // the tab shown (remembered in this browser)
let guilds = null;                    // the guild ranking's first page ({guilds, total}, or {error})
let guildToken = 0;
const boards = new Map();             // game type -> its ranking ({rows, total, me}), the last one the server sent

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

// `beltFn(points)`: the belt icon of a total of points (main.js)
export function initRanking(s, beltFn) {
  session = s;
  belt = beltFn;
  try {
    const m = Number(localStorage.getItem(TAB_KEY) ?? POINTS);
    if (TABS.some(([g]) => g === m)) mode = m;
  } catch (e) { /* private mode */ }
  session.addEventListener("change", (ev) => {
    if (session.screen !== "lobby") return;
    if (ev.detail === "screen") refresh();
    else if (ev.detail === "guild") renderGuilds();           // mine changed: the lit row
  });
  session.addEventListener("ranking", (ev) => {
    boards.set(ev.detail.mode, ev.detail);
    if (ev.detail.mode === mode) renderModes();
  });
  $("guild-rank-all").onclick = () => openGuild("ranking");
  $("dlg-guild").addEventListener("close", () => { if (session.screen === "lobby") loadGuilds(); });   // (joined, created...)
  setInterval(() => { if (session.screen === "lobby" && session.conn && !document.hidden) refresh(); }, REFRESH_MS);
  onLanguage(() => { renderGuilds(); renderModes(); });
  let tabsWidth = -1;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (w !== tabsWidth) { tabsWidth = w; fitTabs(); }
  }).observe($("rank-modes"));
  renderGuilds();
  renderModes();
}

function refresh() {
  session.rankingQuery(mode);
  loadGuilds();
}

async function loadGuilds() {
  const token = ++guildToken;
  const r = await session.guildAsk("ranking", { page: 0 });
  if (token !== guildToken || (r.error && guilds && !guilds.error)) return;     // (an error: keep the last ones)
  guilds = r;
  renderGuilds();
}

function table(heads, rows, foot) {
  return el("table", { class: "rk" },
    el("thead", {}, el("tr", {}, heads.map(([text, cls, title]) => el("th", { class: cls, title }, text)))),
    el("tbody", {}, rows), foot ? el("tfoot", {}, foot) : null);
}

const note = (text) => el("p", { class: "muted small rk-note" }, text);

// ------------------------------------------------------------------ the guilds (left)
function renderGuilds() {
  const box = $("guild-rank");
  if (!guilds) return box.replaceChildren(note(t("Loading…")));
  if (guilds.error) return box.replaceChildren(note(t(guilds.error)));
  if (!guilds.guilds.length) return box.replaceChildren(note(t("No guilds yet. Create the first one in Guild.")));
  const mine = session.guild && session.guild.guild;
  const row = (g, me) => el("tr", { class: me ? "me" : "" },
    el("td", { class: "num muted" }, String(g.rank)),
    el("td", {}, el("span", { class: "rk-who" }, emblem(g, 24),
      el("span", { class: "rk-name" }, el("span", { title: g.name }, g.name),
        el("small", {}, g.members === 1 ? t("1 member") : t("{n} members", { n: g.members }))))),
    el("td", { class: "num" }, fmt(g.points)));
  const rows = guilds.guilds.map((g) => row(g, mine && g.id === mine.id));
  const foot = mine && !guilds.guilds.some((g) => g.id === mine.id) ? row(mine, true) : null;
  box.replaceChildren(table([["#", "rk-pos"], [t("Guild")], [t("Points"), "num rk-pts"]], rows, foot));
}

// ------------------------------------------------------------------ the players (right): by points, or a mode's
function pick(g) {
  mode = g;
  try { localStorage.setItem(TAB_KEY, String(g)); } catch (e) { /* private mode */ }
  renderModes();
  session.rankingQuery(g);
}

// the tabs in one row, or two when a name does not fit
function fitTabs() {
  const box = $("rank-modes");
  box.classList.remove("two");
  box.classList.toggle("two", [...box.children].some((b) => b.scrollWidth > b.clientWidth + 1));
}

function renderModes() {
  $("rank-modes").replaceChildren(...TABS.map(([g, label, title]) => el("button", { type: "button", role: "tab",
    class: "small", "aria-selected": String(g === mode), title: t(title), onclick: () => pick(g) }, t(label))));
  fitTabs();
  const box = $("mode-rank"), b = boards.get(mode), byPoints = mode === POINTS;
  if (!b) return box.replaceChildren(note(t("Loading…")));
  if (!b.rows.length) return box.replaceChildren(note(byPoints ? t("Nobody has points yet.") : t("Nobody has played {mode} yet.", { mode: modeName(mode) })));
  const row = (r, me) => el("tr", { class: me ? "me" : "" },
    el("td", { class: "num muted" }, String(r.rank)),
    el("td", {}, el("span", { class: "rk-who" }, belt(r.score),
      el("span", { class: "rk-name" }, el("span", { title: r.nick }, r.nick), r.guild ? el("small", {}, r.guild) : null))),
    ...(byPoints ? [el("td", { class: "num" }, fmt(r.score))]
      : [el("td", { class: "num" }, fmt(r.wins)), el("td", { class: "num muted" }, fmt(r.losses))]));
  const myRank = b.me && b.me.rank;
  const rows = b.rows.map((r) => row(r, r.rank === myRank));
  const foot = b.me && myRank > b.rows.length ? row(b.me, true) : null;
  const heads = byPoints ? [[t("Points"), "num rk-pts"]] : [[t("W"), "num rk-wl", t("Wins")], [t("L"), "num rk-wl", t("Losses")]];
  box.replaceChildren(table([["#", "rk-pos"], [t("Player")], ...heads], rows, foot),
    note((b.total === 1 ? t("1 player") : t("{n} players", { n: fmt(b.total) })) + " · "
      + (byPoints ? t("most points first") : t("most wins first"))));
}
