// Guilds (the server's guilds.py): the lobby's Guild window. Without a guild: find one (and ask to join, or join an
// open one), create one (for Bomber Coins), the invitations, the ranking. In a guild: its page (notice, emblem, open or
// not, leave or disband), the members (the leader and officers manage them), the requests and invitations (leader
// and officers), the ranking. The server sends the guild's state again whenever it changes (session.guild).
// Also: a Guild Battle room's guilds and the profile's guild line with its emblem.

import { pictureData } from "./account.js";
import { ask } from "./ask.js";
import { t, N_, num, onLanguage } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const dlg = $("dlg-guild");
const PIC = 128;                      // an emblem is cut to its middle square and scaled to this, here
const ROLE_NAMES = { leader: N_("Leader"), officer: N_("Officer"), member: N_("Member") };
const fmt = num;

let session = null, toast = null;
let tab = null;                       // the tab shown
let list = null;                      // the Find / Ranking tab's guilds: {for: "find" | "ranking", q, page, ...}
let listToken = 0;

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

export function initGuild(s, toastFn) {
  session = s;
  toast = toastFn;
  session.addEventListener("change", (ev) => {
    if (ev.detail !== "guild") return;
    badge();
    if (dlg.open && document.activeElement?.tagName !== "TEXTAREA") render();
  });
  $("lobby-guild").onclick = () => openGuild();
  onLanguage(() => { if (dlg.open) render(); });
}

export function openGuild(which) {
  tab = which || tab;
  list = null;
  render();
  if (!dlg.open) dlg.showModal();
  session.guildAsk("state");
}

// the lobby button's count: invitations (without a guild), requests to answer (leader and officers)
function badge() {
  const st = session.guild, g = st && st.guild;
  const n = !st ? 0 : g ? (g.pending || []).filter((p) => p.kind === "request").length : st.invites.length;
  const b = $("guild-badge");
  b.textContent = n;
  b.hidden = !n;
}

// ------------------------------------------------------------------ the window
function render() {
  const st = session.guild || { guild: null, invites: [], requests: [], cost: 0, max: 30 };
  const g = st.guild, staff = g && g.role !== "member";
  const count = (n) => (n ? el("span", { class: "unread" }, String(n)) : null);
  const tabs = g
    ? [["home", t("Guild")], ["members", t("Members {n}/{max}", { n: g.members, max: g.max })],
      ...(staff ? [["requests", [t("Requests"), count(g.pending.filter((p) => p.kind === "request").length)]]] : []),
      ["ranking", t("Ranking")]]
    : [["find", t("Find a guild")], ["create", t("Create")], ["invites", [t("Invitations"), count(st.invites.length)]],
      ["ranking", t("Ranking")]];
  if (!tabs.some(([k]) => k === tab)) tab = tabs[0][0];
  $("guild-title").textContent = g ? g.name : t("Guilds");
  $("guild-tabs").replaceChildren(...tabs.map(([k, label]) => el("button", { type: "button", role: "tab",
    "aria-selected": String(k === tab), class: k === tab ? "on" : "", onclick: () => { tab = k; list = null; render(); } },
  label)));
  const pane = { home, members, requests, find, create, invites, ranking }[tab](st);
  $("guild-body").replaceChildren(pane);
}

// ask the server; its answer's error as a toast; the state comes again by itself
async function act(op, args, done) {
  const r = await session.guildAsk(op, args);
  if (r.error) toast(t(r.error));
  else if (done) toast(typeof done === "function" ? done(r) : done, true);
  return r;
}

export function emblem(g, size = 40) {
  if (g && g.emblem) return el("img", { class: "g-emblem", src: g.emblem, alt: "", width: size, height: size });
  return el("span", { class: "g-emblem none", style: `width:${size}px;height:${size}px;font-size:${size / 2}px`,
    "aria-hidden": "true" }, ((g && g.name) || "?").slice(0, 1).toUpperCase());
}

const record = (g) => t("{wins} W · {losses} L", { wins: fmt(g.wins), losses: fmt(g.losses) });

// ------------------------------------------------------------------ in a guild: its page
function home(st) {
  const g = st.guild, staff = g.role !== "member", leader = g.role === "leader";
  const notice = staff
    ? el("div", { class: "g-notice" },
      el("textarea", { id: "guild-notice", maxlength: 200, rows: 3, placeholder: t("A message to the members") }),
      el("div", { class: "row" }, el("small", { class: "muted spacer" }, t("Members read it in the chat when they come in.")),
        el("button", { type: "button", class: "small", onclick: () => act("notice", { text: $("guild-notice").value },
          t("Notice saved.")) }, t("Save notice"))))
    : el("p", { class: "g-notice" + (g.notice ? "" : " muted") }, g.notice || t("No notice."));
  if (staff) notice.querySelector("textarea").value = g.notice;
  const file = el("input", { type: "file", accept: "image/*", hidden: true, onchange: () => setEmblem(file) });
  const leave = leader
    ? [el("button", { type: "button", class: "danger", onclick: async () => {
      if (await ask({ title: t("Disband the guild"), text: t("Disband {guild}? It is gone for good, for all its members.", { guild: g.name }),
        yes: t("Disband"), danger: true })) act("disband", {}, t("The guild is no more."));
    } }, t("Disband the guild")),
    g.members > 1 ? el("small", { class: "muted" }, t("To leave it, hand it to another member first (Members).")) : null]
    : [el("button", { type: "button", onclick: async () => {
      if (await ask({ title: t("Leave the guild"), text: t("Leave {guild}?", { guild: g.name }), yes: t("Leave"), danger: true })) {
        act("leave", {}, t("You left the guild."));
      }
    } }, t("Leave the guild"))];
  const you = { leader: t("you lead it"), officer: t("you are an officer"), member: t("you are a member") }[g.role];
  return el("div", { class: "g-home" },
    el("div", { class: "g-head" }, emblem(g, 72),
      el("div", {},
        el("div", { class: "g-name" }, g.name, g.open ? el("span", { class: "tag ok" }, t("Open")) : null),
        el("div", { class: "muted" }, t("Rank #{rank} · {points} points · Guild battles {record}",
          { rank: g.rank, points: fmt(g.points), record: record(g) })),
        el("div", { class: "muted small" }, t("Leader {leader} · {you} · since {date}", { leader: g.leader, you, date: g.created })))),
    el("h4", {}, t("Notice")), notice,
    staff ? el("div", { class: "row g-tools" }, file,
      el("button", { type: "button", class: "small", onclick: () => file.click() }, g.emblem ? t("Change emblem") : t("Add an emblem")),
      g.emblem ? el("button", { type: "button", class: "small", onclick: () => act("emblem", { picture: null }, t("Emblem removed.")) },
        t("Remove emblem")) : null,
      el("span", { class: "spacer" })) : null,
    leader ? el("label", { class: "opt-check" }, el("input", { type: "checkbox", checked: g.open,
      onchange: (e) => act("open", { open: e.target.checked }, e.target.checked ? t("Anyone who asks joins now.") :
        t("Requests wait for you or an officer now.")) }), t("Open: anyone who asks joins at once")) : null,
    el("p", { class: "muted small" }, t("Talk to the guild: /g and your message, in any chat. Guild battles: create a room of the mode Guild Battle, your guild against another, 2 against 2 or 3 against 3.")),
    el("div", { class: "row g-leave" }, leave));
}

// an emblem: the picture's middle square at 128 x 128, WebP (JPEG where the browser has none)
async function setEmblem(input) {
  const f = input.files[0];
  input.value = "";
  if (!f) return;
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(t("That is not a picture this browser can read.")));
      i.src = url;
    });
    const cv = el("canvas", { width: PIC, height: PIC }), ctx = cv.getContext("2d");
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, PIC, PIC);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, PIC, PIC);
    await act("emblem", { picture: pictureData(cv) }, t("Emblem saved."));    // (as good as fits one message)
  } catch (e) {
    toast(e.message);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function members(st) {
  const g = st.guild, me = g.role, rows = g.members_list.map((m) => {
    const self = m.id === session.userId;
    const actions = [];
    if (!self && me === "leader" && m.role !== "leader") {
      actions.push(m.role === "member"
        ? el("button", { type: "button", class: "small", onclick: () => act("promote", { user: m.id }) }, t("Make officer"))
        : el("button", { type: "button", class: "small", onclick: () => act("demote", { user: m.id }) }, t("Make member")),
      el("button", { type: "button", class: "small", onclick: async () => {
        if (await ask({ title: t("Hand over the guild"), text: t("Hand {guild} to {nick}? You become an officer.", { guild: g.name, nick: m.nick }),
          yes: t("Hand over"), danger: true })) act("transfer", { user: m.id }, t("{nick} leads the guild now.", { nick: m.nick }));
      } }, t("Hand over")));
    }
    if (!self && (me === "leader" && m.role !== "leader" || me === "officer" && m.role === "member")) {
      actions.push(el("button", { type: "button", class: "small danger", onclick: async () => {
        if (await ask({ title: t("Remove member"), text: t("Remove {nick} from the guild?", { nick: m.nick }), yes: t("Remove"), danger: true })) {
          act("kick", { user: m.id }, t("{nick} is out of the guild.", { nick: m.nick }));
        }
      } }, t("Remove")));
    }
    return el("tr", { class: self ? "me" : "" },
      el("td", {}, el("span", { class: "dot" + (m.online ? " on" : ""), title: m.online ? t("Online") : t("Offline") }), m.nick),
      el("td", {}, el("span", { class: "tag role " + m.role }, t(ROLE_NAMES[m.role] || m.role))),
      el("td", { class: "num" }, fmt(m.points)),
      el("td", { class: "muted small" }, m.joined),
      el("td", { class: "actions" }, ...actions));
  });
  return el("div", {},
    el("p", { class: "muted small" }, t("Points: what each member earned in matches for the guild.")),
    el("div", { class: "g-table" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, t("Name")), el("th", {}, t("Role")), el("th", { class: "num" }, t("Points")),
        el("th", {}, t("Joined")), el("th", {}))),
      el("tbody", {}, rows))));
}

function requests(st) {
  const g = st.guild, asked = g.pending.filter((p) => p.kind === "request"), invited = g.pending.filter((p) => p.kind === "invite");
  const nick = el("input", { maxlength: 16, placeholder: t("Nickname"), "aria-label": t("Nickname to invite") });
  const invite = el("form", { class: "row g-invite", onsubmit: async (ev) => {
    ev.preventDefault();
    const name = nick.value.trim();
    if (!name) return;
    const r = await act("invite", { nick: name }, (x) => (x.done === "joined" ? t("{nick} joined the guild.", { nick: name })
      : t("{nick} is invited.", { nick: name })));
    if (!r.error) nick.value = "";
  } }, nick, el("button", { class: "primary" }, t("Invite")));
  const row = (p, buttons) => el("li", {}, el("span", {}, el("b", {}, p.nick),
    el("span", { class: "muted small" }, " ", p.by ? t("invited by {nick} · {date}", { nick: p.by, date: p.t }) : `· ${p.t}`)),
  el("span", { class: "row" }, buttons));
  return el("div", {},
    el("h4", {}, t("Invite a player")), invite,
    el("h4", {}, t("Asking to join ({n})", { n: asked.length })),
    asked.length ? el("ul", { class: "list compact g-list" }, asked.map((p) => row(p, [
      el("button", { type: "button", class: "small primary", onclick: () => act("accept", { user: p.id }, t("{nick} joined the guild.", { nick: p.nick })) }, t("Accept")),
      el("button", { type: "button", class: "small", onclick: () => act("decline", { user: p.id }) }, t("Decline"))]))) :
      el("p", { class: "muted" }, t("Nobody is asking now.")),
    el("h4", {}, t("Invited ({n})", { n: invited.length })),
    invited.length ? el("ul", { class: "list compact g-list" }, invited.map((p) => row(p, [
      el("button", { type: "button", class: "small", onclick: () => act("cancel_invite", { user: p.id }) }, t("Cancel"))]))) :
      el("p", { class: "muted" }, t("No invitations waiting.")));
}

// ------------------------------------------------------------------ without a guild
function find(st) {
  const q = el("input", { type: "search", placeholder: t("A guild's name"), value: list && list.for === "find" ? list.q : "",
    "aria-label": t("Search guilds") });
  const form = el("form", { class: "row", onsubmit: (ev) => { ev.preventDefault(); load("find", q.value.trim(), 0); } },
    q, el("button", {}, t("Search")));
  if (!list || list.for !== "find") load("find", "", 0);
  return el("div", {}, form, guildRows(st, true));
}

function ranking(st) {
  if (!list || list.for !== "ranking") load("ranking", "", 0);
  return el("div", {}, guildRows(st, false));
}

async function load(what, q, page) {
  const token = ++listToken;
  list = { for: what, q, page, guilds: null };
  const r = await session.guildAsk(what === "find" ? "search" : "ranking", { q, page });
  if (token !== listToken) return;
  list = { for: what, q, page, guilds: r.guilds || [], pages: r.pages || 1, total: r.total || 0 };
  if (dlg.open) render();
}

function guildRows(st, joinable) {
  if (!list || !list.guilds) return el("p", { class: "muted" }, t("Loading…"));
  if (!list.guilds.length) return el("p", { class: "muted" }, list.q ? t("No guild has that in its name.") : t("No guilds yet. Create the first one."));
  const mine = st.guild && st.guild.id, asked = new Set(st.requests.map((x) => x.id)), invitedBy = new Set(st.invites.map((x) => x.id));
  const rows = list.guilds.map((g) => {
    let button = null;
    if (joinable && !st.guild) {
      if (invitedBy.has(g.id)) button = el("button", { type: "button", class: "small primary", onclick: () => act("accept_invite", { guild: g.id }, t("You joined {guild}.", { guild: g.name })) }, t("Accept invitation"));
      else if (asked.has(g.id)) button = el("button", { type: "button", class: "small", onclick: () => act("cancel", { guild: g.id }, t("Request cancelled.")) }, t("Asked · cancel"));
      else if (g.members >= g.max) button = el("button", { type: "button", class: "small", disabled: true }, t("Full"));
      else {
        button = el("button", { type: "button", class: "small primary", onclick: () => act("join", { guild: g.id },
          (r) => (r.done === "joined" ? t("You joined {guild}.", { guild: g.name }) : t("You asked to join {guild}.", { guild: g.name }))) },
        g.open ? t("Join") : t("Ask to join"));
      }
    }
    return el("tr", { class: g.id === mine ? "me" : "" },
      el("td", { class: "num muted" }, String(g.rank)),
      el("td", {}, el("span", { class: "g-cell" }, emblem(g, 28), el("span", {}, el("b", {}, g.name),
        g.open ? el("span", { class: "tag ok" }, t("Open")) : null, el("br"), el("small", { class: "muted" }, t("Leader {nick}", { nick: g.leader }))))),
      el("td", { class: "num" }, `${g.members}/${g.max}`),
      el("td", { class: "num" }, fmt(g.points)),
      el("td", { class: "num muted small battles" }, record(g)),
      joinable ? el("td", { class: "actions" }, button) : null);
  });
  const pager = list.pages > 1 ? el("div", { class: "row g-pager" },
    el("button", { type: "button", class: "small", disabled: list.page <= 0, onclick: () => load(list.for, list.q, list.page - 1) }, "<"),
    el("span", { class: "muted small" }, t("Page {n} of {pages}", { n: list.page + 1, pages: list.pages })),
    el("button", { type: "button", class: "small", disabled: list.page >= list.pages - 1, onclick: () => load(list.for, list.q, list.page + 1) }, ">")) : null;
  return el("div", {}, el("div", { class: "g-table" }, el("table", {},
    el("thead", {}, el("tr", {}, el("th", { class: "num" }, "#"), el("th", {}, t("Guild")), el("th", { class: "num" }, t("Members")),
      el("th", { class: "num" }, t("Points")), el("th", { class: "num battles" }, t("Battles")), joinable ? el("th", {}) : null)),
    el("tbody", {}, rows))), pager);
}

function create(st) {
  const name = el("input", { maxlength: 16, placeholder: t("The guild's name"), "aria-label": t("The guild's name") });
  const coins = session.wallet ? session.wallet.coins : 0;
  return el("form", { class: "g-create", onsubmit: async (ev) => {
    ev.preventDefault();
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    const have = session.wallet ? session.wallet.coins : 0;      // (now)
    if (!await ask({ title: t("Create a guild"), text: t("Create the guild {guild}? You lead it.", { guild: n }), yes: t("Create"),
      body: el("dl", {}, el("dt", {}, t("Price")), el("dd", {}, el("span", { class: "price coins" }, fmt(st.cost))),
        el("dt", {}, t("Left after")), el("dd", {}, el("span", { class: "price coins" }, fmt(have - st.cost)))) })) return;
    const r = await act("create", { name: n }, t("{guild} is yours. Invite players from the Requests tab.", { guild: n }));
    if (!r.error) tab = "home";
  } },
  el("label", {}, t("Name"), name, el("small", {}, t("16 letters at most (8 Japanese), without accents. Everyone sees it under your name."))),
  el("p", {}, t("Creating a guild costs {cost} Bomber Coins (you have {coins}). You lead it; up to {max} members.",
    { cost: fmt(st.cost), coins: fmt(coins), max: st.max })),
  el("div", { class: "row" }, el("button", { class: "primary", disabled: coins < st.cost }, t("Create"))));
}

function invites(st) {
  if (!st.invites.length) return el("p", { class: "muted" }, t("No invitations. A guild's leader or officers can invite you."));
  return el("ul", { class: "list compact g-list" }, st.invites.map((g) => el("li", {},
    el("span", { class: "g-cell" }, emblem(g, 28), el("span", {}, el("b", {}, g.name), el("br"),
      el("small", { class: "muted" }, (g.by ? t("Invited by {nick}", { nick: g.by }) + " · " : "")
        + t("{n}/{max} members · {points} points", { n: g.members, max: g.max, points: fmt(g.points) })))),
    el("span", { class: "row" },
      el("button", { type: "button", class: "small primary", onclick: () => act("accept_invite", { guild: g.id }, t("You joined {guild}.", { guild: g.name })) }, t("Accept")),
      el("button", { type: "button", class: "small", onclick: () => act("decline_invite", { guild: g.id }) }, t("Decline"))))));
}

// ------------------------------------------------------------------ elsewhere
// A Guild Battle room's guilds (the server's guilds.room_guilds): team A's and team B's, each its first player's
// guild, with how many play for it ({name: null} while nobody is there)
export function guildTeams(players) {
  const out = [{ name: null, n: 0 }, { name: null, n: 0 }];
  for (const p of [...players].sort((a, b) => a.slot - b.slot)) {
    const team = out[p.team];
    if (!team) continue;
    team.n++;
    if (!team.name && p.guild) team.name = p.guild;
  }
  return out;
}

// The profile's guild line: the name, then the emblem, the rank and the members once the server says
export function guildLine(name) {
  const line = el("div", { class: "muted pf-guild" }, name || t("No guild"));
  if (name) {
    session.guildAsk("info", { name }).then((r) => {
      const g = r.guild;
      if (!g) return;
      line.replaceChildren(emblem(g, 24), el("span", {}, g.name, el("small", {}, " · " + t("rank #{rank} · {n} members", { rank: g.rank, n: g.members }))));
    });
  }
  return line;
}
