// Page controller: shows the screen the session is in and wires the simple lobby UI.

import { t, N_, num, locale, language, setLanguage, onLanguage, LANGUAGES } from "./i18n.js";
import { Session, pictureUrl, MAP_NAMES, MAP_PAGES, TIME_LIMITS, HYPER_MAPS, HYPER_FIRST_MAP, GROUP_HYPER, PANEL_MAPS, SPACE_MAP,
  PANEL_FIRST_MAP, GROUP_PANEL, GROUP_DROP, DROP_NO_ITEMS, DROP_STAGES, GROUP_BOSS, BOSS_MAPS, BOSS_FIRST_MAP, mapName, ITEM_LABELS,
  ALL_ITEMS, MODE_ORDER, GROUP_GUILD, modeName, GALAXY_MAP, isCustomMap, customMaps, customMap, customPicture,
  loadCustomMaps, CUSTOM_SURVIVAL, CUSTOM_DROP } from "./session.js";
import { characterRecolor, characterPreview, characterSet, CHARACTERS, characterName, addCharacters,
  onUnknownCharacter, passHeaders, passUrl } from "./game/characters.js";
import { ITEM_SPRITES } from "./game/assets.js";
import { outfitPreview, outfitSets, drawRunsFit } from "./game/outfits.js";
import { loadSprite, Sprite } from "./assets/spr.js";
import { INFO as BOSS_ITEMS } from "./game/bossitems.js";
import { missionIcon } from "./game/missionicon.js";
import { bombSkin, classicSkin, setSkinList, onUnknownSkin, drawBombPreview } from "./game/bombskins.js";
import { openOptions, closeOptions } from "./options.js";
import { initGuild, guildTeams, guildLine } from "./guild.js";
import { initRanking } from "./ranking.js";
import { initAccount } from "./account.js";
import { initCash, openCash } from "./cash.js";
import { initReport, openReport } from "./report.js";
import { initDevtools } from "./devtools.js";
import { initSuperBroadcast } from "./superbroadcast.js";
import { installTip } from "./install.js";
import { flag, countryOptions } from "./country.js";
import { ask } from "./ask.js";
import { initClicks } from "./clicks.js";
import { music, currentMusic } from "./game/sound.js";
import { comeBack } from "./rejoin.js";

const $ = (id) => document.getElementById(id);
const session = new Session();
window.bmo = session;   // handy for debugging from the console

// ------------------------------------------------------------------ helpers
let userMenu = null;                             // a player's menu on the Online list (openUserMenu)
function show(screen) {
  closeUserMenu();
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== "screen-" + screen;
}

let toastTimer = 0;
// a message at the bottom: an error (red), done (`ok` true, green) or a game master's announcement (`ok` "gm")
// how long a message stays: longer ones (a ban's, with until when and why) long enough to read
const readMs = (msg) => Math.max(4000, String(msg).length * 70);

function toast(msg, ok = false, ms = 4000) {
  const box = $("toast"), host = [...document.querySelectorAll("dialog[open]")].pop() || $("app");   // above an open dialog
  if (box.parentElement !== host) host.append(box);
  box.textContent = msg;
  box.classList.toggle("ok", ok === true);
  box.classList.toggle("gm", ok === "gm");
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, ms);
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null && k !== false) e.append(k);      // (null: nothing, e.g. no picture)
  return e;
}

function remember(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  return null;
}

// Character portrait: the standing-south frame, recoloured like the game.
async function drawCharacter(canvas, char) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  try {
    const spr = await characterPreview(char);
    const f = spr.frame(0, characterRecolor(char), "c" + char);
    const b = spr.bbox(0);
    const s = Math.min(canvas.width / b.w, canvas.height / b.h) * 0.9;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f, b.x, b.y, b.w, b.h, (canvas.width - b.w * s) / 2, (canvas.height - b.h * s) / 2, b.w * s, b.h * s);
  } catch (e) {
    ctx.fillStyle = "#555";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// Item icon: frame 0 of the item's sprite (the button keeps its name as a tooltip if the file is missing).
async function drawItemIcon(canvas, path) {
  try {
    const spr = await loadSprite(path), b = spr.bbox(0);
    const s = Math.min(canvas.width / b.w, canvas.height / b.h);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr.frame(0), b.x, b.y, b.w, b.h, (canvas.width - b.w * s) / 2, (canvas.height - b.h * s) / 2, b.w * s, b.h * s);
  } catch (e) { /* missing game file */ }
}

// ------------------------------------------------------------------ login
$("login-user").value = remember("bmo.user") || "";
async function signIn(user, pass) {
  const chans = await session.signIn(user, pass);
  remember("bmo.user", user);
  if (chans.length === 1) await session.joinChannel(chans[0]);
  else showChannels(chans);
}
$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const user = $("login-user").value.trim(), pass = $("login-pass").value;
  if (!user) return;
  $("login-btn").disabled = true;
  try {
    await signIn(user, pass);
  } catch (e) {
    toast(e.message, false, readMs(e.message));
  } finally {
    $("login-btn").disabled = false;
  }
});

// ------------------------------------------------------------------ create an account (the server's register.py)
// Email (to sign in), nickname, sex, year of birth, a picture if the player wants one, password. The picture is cut
// to its middle square and scaled to 128 x 128 here, so only a few KB go to the server.
const PIC = 128;
let regPicture = null;                               // the picture as a data: URL, or null
let regCountries = [];                               // the countries the server takes (config.json)
{
  const y = new Date().getFullYear();
  $("reg-year").append(el("option", { value: "" }, t("Choose…")),
    ...Array.from({ length: 98 }, (_, i) => el("option", { value: String(y - 3 - i) }, String(y - 3 - i))));
}
$("to-register").onclick = async () => {
  show("register");
  $("reg-email").focus();
  if ($("reg-country").options.length > 1) return;
  try {                                              // the countries the server takes (config.json)
    const cfg = await (await fetch("config.json")).json();
    regCountries = cfg.countries || [];
    $("reg-country").replaceChildren(...countryOptions(regCountries));
  } catch (e) { regError(t("The server does not answer. Try again in a moment.")); }
};
$("reg-back").onclick = () => show("login");

function regError(msg, field) {
  for (const x of document.querySelectorAll("#register-form .bad-field")) x.classList.remove("bad-field");
  $("reg-error").textContent = msg || "";
  $("reg-error").hidden = !msg;
  const input = { email: "reg-email", nick: "reg-nick", country: "reg-country", sex: "reg-sex", birth_year: "reg-year", password: "reg-pass",
    password2: "reg-pass2", picture: "reg-file" }[field];
  if (input) { $(input).classList.add("bad-field"); if ($(input).focus) $(input).focus(); }
}

function clearPicture() {
  regPicture = null;
  const cv = $("reg-pic");
  cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  $("reg-file").value = "";
  $("reg-pic-clear").hidden = true;
}
$("reg-pic-clear").onclick = clearPicture;
$("reg-file").addEventListener("change", async () => {
  const file = $("reg-file").files[0];
  if (!file) return;
  regError("");
  if (file.size > 20 * 1024 * 1024) { clearPicture(); regError(t("That picture is too big."), "picture"); return; }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(t("That is not a picture this browser can read.")));
      i.src = url;
    });
    const cv = $("reg-pic"), ctx = cv.getContext("2d"), s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.fillStyle = "#fff";                            // (a transparent picture saved as JPEG: on white)
    ctx.fillRect(0, 0, PIC, PIC);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, PIC, PIC);
    let data = cv.toDataURL("image/webp", 0.85);
    if (!data.startsWith("data:image/webp")) data = cv.toDataURL("image/jpeg", 0.88);   // (no WebP: Safari)
    regPicture = data;
    $("reg-pic-clear").hidden = false;
  } catch (e) {
    clearPicture();
    regError(e.message, "picture");
  } finally {
    URL.revokeObjectURL(url);
  }
});

$("register-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = $("reg-email").value.trim(), nick = $("reg-nick").value.trim(), country = $("reg-country").value;
  const sex = (document.querySelector("input[name=reg-sex]:checked") || {}).value;
  const year = +$("reg-year").value, pass = $("reg-pass").value;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return regError(t("Your email address."), "email");
  if (!nick) return regError(t("A nickname: the name other players see."), "nick");
  if (!/^[A-Za-z0-9._-]{3,16}$/.test(nick)) {             // (the server's gm_ops.nick_problem: names all can write)
    return regError(t("3 to 16 letters without accents (A to Z), numbers and - _ . in the nickname, no spaces."), "nick");
  }
  if (!country) return regError(t("Your country."), "country");
  if (!sex) return regError(t("Female or male?"), "sex");
  if (!year) return regError(t("The year you were born."), "birth_year");
  if (pass.length < 6) return regError(t("A password of 6 characters or more."), "password");
  if (pass !== $("reg-pass2").value) return regError(t("The two passwords are not the same."), "password2");
  regError("");
  $("reg-btn").disabled = true;
  try {
    const res = await fetch("api/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, nick, country, sex, birth_year: year, password: pass, picture: regPicture }) });
    let out = {};
    try { out = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) { regError(out.error ? t(out.error) : t("The server refused it ({code}).", { code: res.status }), out.field); return; }
    $("login-user").value = email;
    toast(t("Account created. Welcome!"), true);
    await signIn(email, pass);
    $("register-form").reset();
    clearPicture();
  } catch (e) {
    regError(e.message);
  } finally {
    $("reg-btn").disabled = false;
  }
});

function showChannels(chans) {
  const ul = $("channel-list");
  ul.replaceChildren(...chans.map((c) => el("li", {
    onclick: async () => {
      try { await session.joinChannel(c); } catch (e) { toast(e.message); show("login"); }
    },
  }, el("span", {}, c.name), el("span", { class: "muted" }, t("load {n}", { n: c.load })))));
  show("channels");
}
$("channels-back").onclick = () => show("login");

// ------------------------------------------------------------------ lobby
// A channel of every mode: each room shows its mode, and the lobby can show the rooms of one mode only (the server
// pages them so, 0x40c); the choice is remembered in this browser
const savedFilter = remember("room-mode");
session.roomFilter = savedFilter === null ? -1 : Number(savedFilter);
function renderModeFilter() {
  const box = $("room-modes");
  box.hidden = !session.allModes();
  if (box.hidden) return;
  box.replaceChildren(...[-1, ...MODE_ORDER].map((m) => el("button", { type: "button", class: "small",
    "aria-pressed": String(session.roomFilter === m), onclick: () => {
      session.roomFilter = m;
      remember("room-mode", String(m));
      lobbyPages.rooms = 0;
      session.pageRooms(2);
      renderLobby();
    } }, m < 0 ? t("All") : modeName(m))));
}

function renderLobby() {
  $("lobby-title").textContent = session.channel ? session.channel.name : t("Lobby");
  renderModeFilter();
  const all = session.allModes(), shown = (r) => !all || session.roomFilter < 0 || r.mode === session.roomFilter;
  const rows = [...session.rooms.values()].filter(shown).sort((a, b) => a.number - b.number).map((r) => {
    const seats = r.open.filter(Boolean).length || r.max;      // the seats the host has not closed
    const state = r.playing ? el("span", { class: "tag play" }, t("Playing"))
      : r.count >= seats ? el("span", { class: "tag" }, t("Full")) : el("span", { class: "tag ok" }, t("Waiting"));
    const line = r.line > 0 && el("span", { class: "tag line", title: t("Players waiting in line for this room") },
      t("{n} in line", { n: r.line }));
    const name = el("td", {}, (r.password ? "🔒 " : "") + r.name);
    if (all && modeName(r.mode)) name.append(" ", el("span", { class: "tag mode m" + r.mode }, modeName(r.mode)));
    if (r.team && r.mode !== GROUP_GUILD) name.append(" ", el("span", { class: "tag" }, t("Teams")));
    const mine = session.line && session.line.room === r.number;
    return el("tr", { onclick: () => joinRoom(r), title: r.members.map((m) => m.nick).join(", "), class: mine ? "in-line" : "" },
      el("td", {}, String(r.number + 1)),
      name,
      el("td", {}, `${r.count} / ${seats}`),
      el("td", {}, state, line ? " " : null, line || null));
  });
  renderLine();
  const tbody = $("room-rows"), list = $("user-list");
  tbody.replaceChildren(...lobbyPage("rooms", rows, $("rooms-box"), tbody.parentElement.tHead.offsetHeight));
  $("rooms-empty").hidden = rows.length > 0;
  list.replaceChildren(...lobbyPage("users", [...session.users.values()].map(userRow), list, 0));
  if (lobbyMeasure("rooms", tbody) | lobbyMeasure("users", list)) renderLobby();     // (a row's real height, once)
}

// The lobby's lists page themselves (the server sends web clients all the rooms and players): when the lobby fills a
// wide window (CSS --lists-fill) as many rows as their box holds, else 8 rooms and 10 players a page
const lobbyPages = { rooms: 0, users: 0 };
const PER_PAGE = { rooms: 8, users: 10 };
const rowHeight = { rooms: 37, users: 28 };                    // (measured on the rows shown: the tallest)
const measured = new Set();
const lobbyFills = () => getComputedStyle($("screen-lobby")).getPropertyValue("--lists-fill").trim() === "1";
function lobbyPage(kind, rows, box, head) {
  const n = lobbyFills() ? Math.max(1, Math.floor((box.clientHeight - head) / rowHeight[kind])) : PER_PAGE[kind];
  const last = Math.max(0, Math.ceil(rows.length / n) - 1);
  lobbyPages[kind] = Math.min(lobbyPages[kind], last);
  $(kind + "-prev").disabled = lobbyPages[kind] === 0;
  $(kind + "-next").disabled = lobbyPages[kind] >= last;
  return rows.slice(lobbyPages[kind] * n, (lobbyPages[kind] + 1) * n);
}
function lobbyMeasure(kind, parent) {                         // true: it changed (show the page again)
  let h = 0;
  for (const row of parent.children) h = Math.max(h, row.getBoundingClientRect().height);
  if (!h) return false;
  const first = !measured.has(kind);                         // (then only taller: a page never swings back)
  measured.add(kind);
  if (first ? Math.abs(h - rowHeight[kind]) < 0.5 : h <= rowHeight[kind] + 0.5) return false;
  rowHeight[kind] = h;
  return lobbyFills();
}
function turnPage(kind, by) {
  lobbyPages[kind] = Math.max(0, lobbyPages[kind] + by);
  renderLobby();
}
// a box taller or shorter (the window resized): its page again
const boxHeights = new Map();
const boxWatch = new ResizeObserver((entries) => {
  let again = false;
  for (const e of entries) {
    const h = Math.round(e.contentRect.height);
    if (boxHeights.get(e.target) !== h) { again = again || boxHeights.has(e.target); boxHeights.set(e.target, h); }
  }
  if (again && session.screen === "lobby") { measured.clear(); renderLobby(); }
});
boxWatch.observe($("rooms-box"));
boxWatch.observe($("user-list"));

// Online: everyone in the channel, in the lobby or a room. A click on another player opens a menu: their profile, a
// message to them, or a report to the game masters (my own name: my profile); one waiting in a room has a button to
// follow them there
function userRow(u) {
  const followText = u.state === 2 ? t("Wait in line for room {n}", { n: u.room + 1 })
    : t("Follow {nick} to room {n}", { nick: u.nick, n: u.room + 1 });
  const follow = canFollow(u) && el("button", { type: "button", class: "small u-follow", title: followText,
    "aria-label": followText, onclick: (e) => { e.stopPropagation(); followPlayer(u); } }, "→");
  const me = u.id === session.myId;
  return el("li", { role: "button", tabindex: "0", "aria-haspopup": me ? "dialog" : "menu", "aria-label": me
    ? t("{nick}: profile", { nick: u.nick }) : u.nick,
    onclick: (e) => openUserMenu(u, e),
    onkeydown: (e) => {
      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openUserMenu(u, e); }
    } },
  beltIcon(u.cls, beltTitle(session.belts.findIndex(([, f]) => f === u.cls))), el("span", { class: "u-nick" }, u.nick),
  whereTag(u), follow || null);
}
const canFollow = (u) => (u.state === 1 || u.state === 2) && u.id !== session.myId;
// The menu of a player in the Online list or of a seat card (ev: the click or the key on it); see: opens the profile
function openUserMenu(u, ev, see = () => openUserProfile(u)) {
  const row = ev.currentTarget;
  closeUserMenu();
  if (u.id === session.myId) return see();
  const item = (text, fn, cls = "") => el("button", { type: "button", role: "menuitem", class: cls,
    onclick: () => { closeUserMenu(); fn(); } }, text);
  userMenu = el("div", { class: "user-menu", role: "menu", "aria-label": u.nick,
    onkeydown: (e) => { if (e.key === "Escape") { closeUserMenu(); row.focus(); } } },
  item(t("See profile"), see), item(t("Send a message"), () => messageTo(u.nick)),
  el("hr", { role: "separator" }), item(t("Report"), () => openReport(u), "bad"));
  document.body.append(userMenu);
  // under the name, or over it: a click's point (a seat card is tall), a key's row
  const r = row.getBoundingClientRect(), m = userMenu.getBoundingClientRect(), click = ev.type === "click" && ev.detail > 0;
  const x = click ? ev.clientX : r.left + 24, below = click ? ev.clientY : r.bottom, above = click ? ev.clientY : r.top;
  userMenu.style.left = Math.max(8, Math.min(x, innerWidth - m.width - 8)) + "px";
  userMenu.style.top = (below + m.height + 8 > innerHeight ? Math.max(8, above - m.height - 2) : below + 2) + "px";
  userMenu.firstChild.focus();
  document.addEventListener("pointerdown", outsideUserMenu, true);
  window.addEventListener("resize", closeUserMenu);
}
function outsideUserMenu(e) { if (userMenu && !userMenu.contains(e.target)) closeUserMenu(); }
function closeUserMenu() {
  if (!userMenu) return;
  userMenu.remove();
  userMenu = null;
  document.removeEventListener("pointerdown", outsideUserMenu, true);
  window.removeEventListener("resize", closeUserMenu);
}
// A private message: "/to name " in the chat's box, the rest typed there as a whisper written by hand
function messageTo(nick) {
  if (session.room && roomNarrow.matches) roomTab("chat");
  const inp = (session.room ? $("room-chat") : $("lobby-chat")).parentNode.querySelector("[data-chat] input");
  inp.value = `/to ${nick} `;
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
}
function whereTag(u) {
  if (u.state === 2) return el("span", { class: "tag play", title: t("Playing in room {n}", { n: u.room + 1 }) }, t("Playing"));
  if (u.state === 1) return el("span", { class: "tag ok", title: t("In room {n}", { n: u.room + 1 }) }, t("Room {n}", { n: u.room + 1 }));
  return el("span", { class: "tag" }, t("Lobby"));
}
function followPlayer(u) {                      // (a room playing: its line)
  const r = session.rooms.get(u.room) || { number: u.room, name: "", password: u.locked, playing: false, count: 0, open: [], max: 6 };
  joinRoom(u.state === 2 && !r.playing ? { ...r, playing: true } : r);
}
// The profile of a player of the list: their card comes from the server first (0x8c4)
let wantCard = null;
function openUserProfile(u) {
  wantCard = u.id;
  session.cardQuery(u.id);
}
session.addEventListener("card", (ev) => {
  if (ev.detail.id !== wantCard) return;
  wantCard = null;
  const u = session.users.get(ev.detail.id);
  if (!ev.detail.player || !u) return toast(t("{nick} is no longer online.", { nick: (u || ev.detail.player || {}).nick || "?" }));
  openProfile(ev.detail.player, u);
});

// A player's picture (register.py), round; null if they have none. Only the profile shows it (a click on a seat card)
function picture(p, cls) {
  const url = pictureUrl(p);
  return url ? el("img", { class: cls, src: url, alt: "", loading: "lazy", decoding: "async" }) : null;
}

// Seat card: the player's card background (shop.json "cards", picked in Inventory; silver by default) in a metal
// frame. The character on the left; the belt; the points and the win rate (every mode but Boss Battle) beside the
// host's KICK; the guild and the name. On the top-left corner, half outside the card: the host's crown, or a check
// once the player is ready. A click anywhere else on the card opens the Online list's menu: the player's profile, a
// message to them or a report (my own card: my profile).
function seatCard(p, room, team, host) {
  const me = p.id === session.myId, isHost = p.id === room.hostId, belt = session.beltOf(p.score);
  const cv = el("canvas", { width: "108", height: "200" });
  if (!p.outfit) characterSet(shownLook(p)).catch(() => {});    // the match's sprites, before the match starts
  drawAvatar(cv, p);
  const kickText = t("Kick");
  const kick = host && !me && el("button", { type: "button", class: "sc-btn sc-kick" + (kickText.length > 5 ? " long" : ""),
    title: t("Remove {nick} from the room", { nick: p.nick }), onclick: (e) => { e.stopPropagation(); kickPlayer(p); } },
  icon("x"), el("span", {}, kickText));
  const name = seatField("user", [flag(p.country), p.nick], "sc-name", p.nick);       // (the country's flag first)
  if (team >= 0) name.append(el("b", { class: `sc-team t${team}`, title: t("Team {name}", { name: TEAM_NAMES[team] }) }, TEAM_NAMES[team]));
  const card = el("div", { class: "seat" + (me ? " me" : "") + (team >= 0 ? " t" + team : "") + (kick ? "" : " no-kick"),
    style: cardStyle(p.card), role: "button", tabindex: "0", "aria-haspopup": me ? "dialog" : "menu",
    "aria-label": me ? t("{nick}: profile", { nick: p.nick }) : p.nick,
    onclick: (e) => openUserMenu(p, e, () => openProfile(p)),
    onkeydown: (e) => {                              // (Enter on KICK is KICK's)
      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openUserMenu(p, e, () => openProfile(p)); }
    } },
    el("div", { class: "sc-char" }, cv),
    el("div", { class: "sc-belt" }, beltIcon(p.cls, beltTitle(belt))),
    seatField("crown", [el("b", { class: "v" }, fmt(p.score)), el("small", {}, " " + t("Pt"))], "sc-pts", t("{n} points", { n: fmt(p.score) })),
    seatField("swords", [el("small", {}, t("Wins") + " "), el("b", { class: "v" }, winRate(p))], "sc-rec", recordText(p)),
    seatField("sword", p.guild || t("No guild"), "sc-guild" + (p.guild ? "" : " none")),
    name);
  if (kick) card.append(kick);
  const badge = isHost ? ["crown", t("Room host")] : p.ready ? ["ready", t("Ready")] : null;
  if (badge) card.prepend(el("span", { class: "sc-badge " + badge[0], title: badge[1], role: "img", "aria-label": badge[1] }, art(badge[0])));
  return card;
}
// An empty seat: "Empty", or "Closed" with a lock (nobody can take it, bots neither). The host's lift like the cards
// and close or open again on a click (0x40e, like BomberMan.exe's slot panels).
function emptySeat(slot, open, host) {
  const label = el("span", { class: "se-label" }, ...(open ? [] : [icon("lock")]), open ? t("Empty") : t("Closed"));
  if (!host) return el("div", { class: "seat empty" + (open ? "" : " closed") }, label);
  const act = open ? t("Close this seat") : t("Open this seat");
  return el("div", { class: "seat empty" + (open ? "" : " closed"), role: "button", tabindex: "0", title: act,
    "aria-label": t("Seat {n}: {what}", { n: slot + 1, what: act.toLocaleLowerCase(locale()) }), onclick: () => session.toggleSlot(slot),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); session.toggleSlot(slot); } } },
  label, el("span", { class: "se-act" }, open ? t("Close seat") : t("Open seat")));
}
// A card background (the catalogue's "cards"): a colour or a picture; none = the default silver
const cardLook = (id) => (id && shopCat && shopCat.cards ? shopCat.cards.find((c) => c.id === id) : null) || null;
function cardStyle(id) {
  const c = cardLook(id);
  // (a full URL: one inside a CSS variable would be read relative to the stylesheet's folder)
  if (c && c.image && /^[\w./-]+$/.test(c.image)) return `--card-img: url("${new URL(c.image, document.baseURI).href}")`;
  if (c && c.color && /^#[0-9a-f]{3,8}$/i.test(c.color)) return `--card: ${c.color}`;
  return "";
}
// a hidden card's picture where its owner sees it (the shop's Inventory): with the pass (bmoserver/hidden.py)
function hiddenCard(node, c) {
  if (c && c.image && hiddenIds.has(c.id)) {
    passUrl(c.image).then((u) => node.style.setProperty("--card-img", `url("${u}")`)).catch(() => {});
  }
  return node;
}
// Matches won, as a share of those played in every mode but Boss Battle
function winRate(p) {
  const games = p.recWins + p.recLosses;
  return games ? (100 * p.recWins / games).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%" : "–";
}
function recordText(p) {
  return p.recWins + p.recLosses ? t("{wins} wins, {losses} losses (every mode but Boss Battle)",
    { wins: fmt(p.recWins), losses: fmt(p.recLosses) }) : t("No matches yet");
}
// A field: its picture in a small box, then the text (a string, or nodes with their own title)
function seatField(pic, content, cls, title = content) {
  return el("div", { class: "sc-f " + cls, title }, el("i", { class: "sc-ico" }, art(pic)), el("span", {}, ...[].concat(content)));
}
// The buttons' white icons (16 x 16)
const ICONS = {
  x: '<path d="M3.6 1.4 8 5.8l4.4-4.4 2.2 2.2L10.2 8l4.4 4.4-2.2 2.2L8 10.2l-4.4 4.4-2.2-2.2L5.8 8 1.4 3.6z"/>',
  lock: '<path fill-rule="evenodd" d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h1v8h-9V7zm2 0h3V5a1.5 1.5 0 0 0-3 0z"/>',
};
function icon(name) {
  const tpl = document.createElement("template");
  tpl.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;
  return tpl.content.firstChild;
}
// The cards' coloured pictures: crown (points, host), crossed swords (wins), sword (guild), person (name), ready
const SWORD = '<rect x="8.9" y="1" width="2.2" height="11.6" rx="1" fill="#e9f0fa"/><rect x="6" y="12.2" width="8" '
  + 'height="2.2" rx="1.1" fill="#4f8ff7"/><rect x="9" y="14.3" width="2" height="4.2" rx="1" fill="#a0652e"/>';
const ART = {
  crown: '<svg viewBox="0 0 28 24"><path d="M3 9l5.5 4.5L14 4l5.5 9.5L25 9l-2.4 11H5.4z" fill="#f8c537"/>'
    + '<path d="M5.4 17h17.2l-.6 3H6z" fill="#dc8f16"/><path d="M3 9l5.5 4.5L14 4l5.5 9.5L25 9l-2.4 11H5.4z" fill="none" '
    + 'stroke="#1c0629" stroke-width="1.8" stroke-linejoin="round"/><circle cx="14" cy="3.4" r="2.2" fill="#e5534b" '
    + 'stroke="#1c0629" stroke-width="1.3"/><circle cx="3" cy="8.6" r="1.9" fill="#f8c537" stroke="#1c0629" stroke-width="1.3"/>'
    + '<circle cx="25" cy="8.6" r="1.9" fill="#f8c537" stroke="#1c0629" stroke-width="1.3"/>'
    + '<path d="M9 11.8l1.6 1.4M14 7.6v2.4M19 11.8l-1.6 1.4" stroke="#fff6d0" stroke-width="1.2" stroke-linecap="round"/></svg>',
  swords: `<svg viewBox="0 0 20 20"><g stroke="#1c0629" stroke-width="1.1"><g transform="rotate(45 10 10)">${SWORD}</g>`
    + `<g transform="rotate(-45 10 10)">${SWORD}</g></g></svg>`,
  sword: `<svg viewBox="0 0 20 20"><g stroke="#1c0629" stroke-width="1.1" transform="rotate(45 10 10)">${SWORD}</g></svg>`,
  user: '<svg viewBox="0 0 20 20"><g fill="#ff8ad8" stroke="#1c0629" stroke-width="1.3"><circle cx="10" cy="6.5" r="3.8"/>'
    + '<path d="M3 18c0-4 3.1-6.6 7-6.6s7 2.6 7 6.6z"/></g></svg>',
  ready: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.6" fill="#2e9b53" stroke="#1c0629" stroke-width="1.8"/>'
    + '<path d="M5.6 10.4l3 3 5.9-6.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" '
    + 'stroke-linejoin="round"/></svg>',
};
function art(name) {
  const tpl = document.createElement("template");
  tpl.innerHTML = ART[name];
  const svg = tpl.content.firstChild;
  svg.setAttribute("aria-hidden", "true");
  return svg;
}
async function kickPlayer(p) {
  if (await ask({ title: t("Kick player"), text: t("Remove {nick} from the room?", { nick: p.nick }), yes: t("Kick"), danger: true })) {
    session.kick(p.id);
  }
}

// Profile (a click on a seat card, or on a player of the lobby's Online list: `where`, their list entry, says where they
// are, with a button to follow them to their room): the character bigger, the player's picture (if they have one)
// beside the name, the belt and how far to the next one, points, the win rate and record, and each mode's wins/losses
function openProfile(p, where = null) {
  const b = session.belts, i = session.beltOf(p.score), last = i === b.length - 1;
  const from = i ? b[i - 1][0] + 1 : 0, to = b[i] ? b[i][0] : 0;
  const part = last ? 1 : Math.max(0, Math.min(1, (p.score - from) / Math.max(1, to - from)));
  const cv = el("canvas", { width: "120", height: "160" });
  drawAvatar(cv, p);
  const bar = el("div", { class: "pf-bar" }, el("i"));
  bar.firstChild.style.width = (100 * part).toFixed(1) + "%";
  const stat = (k, v) => [el("dt", {}, k), el("dd", {}, v)];
  const cells = new Map(MODE_ORDER.map((g) => [g, el("dd", {}, "…")]));
  $("profile-body").replaceChildren(
    el("div", { class: "pf-char" }, cv),
    el("div", { class: "pf-info" },
      el("div", { class: "pf-name" }, picture(p, "pf-pic"), el("span", {}, flag(p.country), " ", p.nick)), guildLine(p.guild),
      where && whereLine(where),
      p.id !== session.myId && el("div", { class: "pf-where" }, el("button", { type: "button", class: "small",
        onclick: () => { $("dlg-profile").close(); messageTo(p.nick); } }, t("Send a message")),
      el("button", { type: "button", class: "small danger",
        onclick: () => { $("dlg-profile").close(); openReport(p); } }, t("Report"))),
      el("div", { class: "pf-belt" }, beltIcon(p.cls, beltTitle(i)),
        el("div", {}, el("b", {}, t("Belt {n}", { n: i + 1 })), " ", t("of {total}", { total: b.length }), el("br"),
          el("small", { class: "muted" }, beltRange(i)))),
      bar,
      el("small", { class: "muted" }, last ? t("The highest belt") : t("{n} points to belt {belt}", { n: fmt(to + 1 - p.score), belt: i + 2 })),
      el("dl", {}, ...stat(t("Points"), fmt(p.score)),
        ...stat(t("Win rate"), winRate(p)),
        ...stat(t("Record"), t("{wins} W · {losses} L", { wins: fmt(p.recWins), losses: fmt(p.recLosses) }))),
      el("small", { class: "muted" }, t("Win rate and record: every mode but Boss Battle.")),
      el("div", { class: "pf-head" }, t("Wins/losses by mode")),
      el("dl", { class: "pf-modes" }, ...MODE_ORDER.flatMap((g) => [el("dt", {}, modeName(g)), cells.get(g)]))));
  shownProfile = { id: p.id, cells };
  session.profileQuery(p.id);
  $("dlg-profile").showModal();
}
function whereLine(u) {
  const text = u.state === 2 ? t("Playing in room {n}", { n: u.room + 1 }) : u.state === 1 ? t("In room {n}", { n: u.room + 1 })
    : t("In the lobby");
  return el("div", { class: "pf-where" }, el("span", { class: "tag" + (u.state === 2 ? " play" : u.state === 1 ? " ok" : "") }, text),
    canFollow(u) ? el("button", { type: "button", class: "primary small",
      onclick: () => { $("dlg-profile").close(); followPlayer(u); } }, t("Follow")) : null);
}
// Each mode's wins/losses (0x8b9, asked for when the window opens); "-" for a mode not played yet
let shownProfile = null;
session.addEventListener("profile", (ev) => {
  if (!shownProfile || ev.detail.id !== shownProfile.id) return;
  for (const [g, cell] of shownProfile.cells) {
    const r = ev.detail.modes[g];
    cell.textContent = r ? `${fmt(r[0])}/${fmt(r[1])}` : "-";
  }
});

// Belts (the server's ranks.py): for web clients the class field of the lobby and room entries is the player's belt,
// a frame of UI_class.spr; session.belts ([most points, frame], from config.json) gives its number and points.
function beltTitle(i) {
  const b = session.belts;
  if (i < 0 || i >= b.length) return "";
  return t("Belt {n}: {points}", { n: i + 1, points: beltRange(i) });
}
function beltRange(i) {                      // its points
  const b = session.belts;
  if (i < 0 || i >= b.length) return "";
  const from = i ? b[i - 1][0] + 1 : 0;
  return i === b.length - 1 ? t("{from} points and up", { from: fmt(from) }) : t("{from}–{to} points", { from: fmt(from), to: fmt(b[i][0]) });
}
function beltIcon(frame, title) {
  const cv = el("canvas", { class: "belt", width: "32", height: "16", title });
  loadSprite("UI/UI_class.spr").then((s) => cv.getContext("2d").drawImage(s.frame(frame), 0, 0))
    .catch(() => { cv.hidden = true; });              // a missing game file
  return cv;
}

const roomFull = (r) => !r.playing && r.count >= (r.open.filter(Boolean).length || r.max);
async function joinRoom(r) {
  if (r.playing || roomFull(r)) return offerLine(r);
  const pw = r.password && !session.gm ? await roomPassword() : "";       // (a game master goes in without it)
  if (pw !== null) session.joinRoom(r.number, pw);
}
// a locked room's password (#dlg-password), or null (Cancel)
function roomPassword() {
  $("join-pass").value = "";
  const dlg = $("dlg-password");
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((done) => dlg.addEventListener("close", () => done(dlg.returnValue === "ok" ? $("join-pass").value : null),
    { once: true }));
}

// The line for a room that is playing or full (the server's, C_room §5.11): who waits goes in by themselves when its
// match ends or a seat frees, first come first; the bar over the rooms says the place and leaves the line
async function offerLine(r) {
  const n = r.number + 1, other = session.line && session.line.room !== r.number ? session.line.room + 1 : 0;
  if (session.line && !other) return toast(t("You are in this room's line already."));
  const text = [r.playing ? t("Room {n} is playing. Wait in line: you go in when its match ends.", { n })
    : t("Room {n} is full. Wait in line: you go in when a seat frees.", { n })];
  if (other) text.push(t("You leave the line of room {n}.", { n: other }));
  if (!await ask({ title: t("Wait in line?"), text: text.join(" "), yes: t("Wait in line") })) return;
  const pw = r.password && !session.gm ? await roomPassword() : "";
  if (pw !== null) session.waitInLine(r.number, pw);
}
function renderLine() {
  const l = session.line;
  $("line-bar").hidden = !l;
  if (!l) return;
  const r = session.rooms.get(l.room), room = t("Room {n}", { n: l.room + 1 }) + (r ? " · " + r.name : "");
  $("line-text").textContent = l.place <= 1 ? t("Waiting in line for {room}: you are next.", { room })
    : t("Waiting in line for {room}: you are number {place} of {of}.", { room, place: l.place, of: l.of });
}
$("line-leave").onclick = () => session.leaveLine();

$("create-room").onclick = () => {
  const dlg = $("dlg-create"), mode = $("create-mode");
  dlg.returnValue = "";
  $("create-mode-row").hidden = !session.allModes();          // a channel of every mode: the room's is picked here
  if (!mode.options.length) mode.append(...MODE_ORDER.map((m) => el("option", { value: String(m) }, modeName(m))));
  const guild = mode.querySelector(`option[value="${GROUP_GUILD}"]`), inGuild = !!(session.guild && session.guild.guild);
  guild.disabled = !inGuild;                                   // a guild battle: its members only (the server checks)
  guild.textContent = `${modeName(GROUP_GUILD)} (${inGuild ? t("2 vs 2 or 3 vs 3") : t("join a guild first")})`;
  mode.value = String(session.roomFilter >= 0 ? session.roomFilter : remember("create-mode") ?? 0);
  if (!mode.selectedOptions.length || mode.selectedOptions[0].disabled) mode.value = "0";
  dlg.showModal();
  dlg.addEventListener("close", () => {
    if (dlg.returnValue === "ok") {
      remember("create-mode", mode.value);
      session.createRoom($("create-name").value.trim() || "Only Bomb Online!", $("create-pass").value, Number(mode.value));
    }
  }, { once: true });
};
$("rooms-prev").onclick = () => turnPage("rooms", -1);
$("rooms-next").onclick = () => turnPage("rooms", 1);
$("rooms-refresh").onclick = () => session.pageRooms(2);
$("users-prev").onclick = () => turnPage("users", -1);
$("users-next").onclick = () => turnPage("users", 1);
$("lobby-logout").onclick = () => session.logout();

// ------------------------------------------------------------------ chat (lobby and room)
function renderChat() {
  const box = session.room ? $("room-chat") : $("lobby-chat");
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  box.replaceChildren(...session.chat.map((l) => el("div", { class: "k" + l.kind },
    ...(l.kind === 1 ? [el("b", {}, "[GM] "), l.text] : [l.text]))));
  if (atBottom) box.scrollTop = box.scrollHeight;
  if (session.room) markChatRead();
}
for (const f of document.querySelectorAll("[data-chat]")) {
  f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const inp = f.querySelector("input");
    const text = inp.value.trim();
    if (text) session.sendChat(text);
    inp.value = "";
  });
}

// ------------------------------------------------------------------ room
// A narrow or short window (phones, tablets upright) shows the seats, the settings or the chat, picked with tabs;
// the Chat tab counts the lines that came while it was not shown (app.css)
const roomScreen = $("screen-room"), roomNarrow = matchMedia("(max-width: 899px), (max-height: 560px)");
let chatRead = null;                                 // the last room chat line seen
function roomTab(tab) {
  roomScreen.dataset.tab = tab;
  for (const b of roomScreen.querySelectorAll(".room-tabs [data-tab]")) b.setAttribute("aria-selected", b.dataset.tab === tab);
  if (tab === "chat") $("room-chat").scrollTop = $("room-chat").scrollHeight;
  markChatRead();
}
function markChatRead() {
  const lines = session.chat, shown = !roomNarrow.matches || roomScreen.dataset.tab === "chat";
  if (shown) chatRead = lines[lines.length - 1] || null;
  const unread = lines.length - 1 - (chatRead ? lines.lastIndexOf(chatRead) : -1);
  $("chat-unread").hidden = shown || unread <= 0;
  $("chat-unread").textContent = unread > 9 ? "9+" : unread;
}
for (const b of roomScreen.querySelectorAll(".room-tabs [data-tab]")) b.onclick = () => roomTab(b.dataset.tab);
// the room chat's height follows the window: keep its last line in sight
new ResizeObserver(() => { $("room-chat").scrollTop = $("room-chat").scrollHeight; }).observe($("room-chat"));
roomNarrow.addEventListener("change", () => roomTab(roomScreen.dataset.tab || "players"));
const mapSel = $("map-select");
let mapGroup = -1, mapPage = -1, mapRatesShown = null, mapCustomShown = null;
// Survival and Drop Bomb play the 27 maps: 3 pages (Basic, Normal, Advanced) of 9, picked with the buttons
const paged = (group) => group !== GROUP_HYPER && group !== GROUP_PANEL && group !== GROUP_BOSS;
const pageOf = (m) => (m >= 0 && m <= 26 ? Math.floor(m / 9) : -1);
function fillMaps(group, page = 0) {       // the maps of the channel's game type (C_room.md §1.5)
  if (group === mapGroup && (page === mapPage || !paged(group)) && mapRatesShown === session.mapRates
    && mapCustomShown === customMaps()) return;
  mapGroup = group;
  mapPage = page;
  mapRatesShown = session.mapRates;
  mapCustomShown = customMaps();
  fillMapList(group, page);
  for (const o of mapSel.options) {        // the maps that pay more (or less) than usual (the database's map_rates)
    const r = mapRateText(group, Number(o.value));
    if (r) o.textContent += ` (${r})`;
  }
}

function mapRateText(group, m) {
  const r = (session.mapRates || {})[`${group}:${m}`];
  if (!r) return "";
  return [r[0] !== 1 ? t("coins ×{n}", { n: r[0] }) : "", r[1] !== 1 ? t("points ×{n}", { n: r[1] }) : ""].filter(Boolean).join(", ");
}

function fillMapList(group, page) {
  if (group === GROUP_HYPER || group === GROUP_PANEL) {
    const [names, first] = group === GROUP_HYPER ? [HYPER_MAPS, HYPER_FIRST_MAP] : [PANEL_MAPS, PANEL_FIRST_MAP];
    mapSel.replaceChildren(...names.map((n, i) => el("option", { value: String(first + i) }, t(n))));
    return;
  }
  if (group === GROUP_BOSS) {              // a boss match always starts in Cave 1 (the Korean room offers only 47)
    mapSel.replaceChildren(el("option", { value: String(BOSS_FIRST_MAP) }, t(BOSS_MAPS[0])));
    return;
  }
  mapSel.replaceChildren(...MAP_NAMES.map((n, i) => el("option", { value: String(page * 9 + i) }, t(n))));
  // the game masters' own maps (the GM panel's Custom maps) shown and made for this mode, with the game's maps (on
  // every page): browser players only
  const bit = group === 0 ? CUSTOM_SURVIVAL : group === GROUP_DROP ? CUSTOM_DROP : 0;
  for (const c of customMaps().filter((x) => x.on && x.modes & bit)) mapSel.append(el("option", { value: String(c.map) }, c.name));
  if (group === 0) {                       // Survival only: the server's extra maps
    const g = el("optgroup", { label: t("Special") });
    g.append(el("option", { value: String(SPACE_MAP) }, t("Space (full power)")));
    g.append(el("option", { value: String(GALAXY_MAP) }, t("Galaxy (full power)")));
    mapSel.append(g);
  }
  if (group === GROUP_DROP) {              // Drop Bomb's own arenas (rooms of 6)
    const g = el("optgroup", { label: t("Drop Bomb stages") });
    for (const [m, name] of Object.entries(DROP_STAGES)) g.append(el("option", { value: m }, t("{name} (up to 6)", { name })));
    mapSel.append(g);
  }
}
fillMaps(0);
// the page buttons keep the map and change its level (a special map goes to the page's Random)
for (const b of $("map-pages").querySelectorAll("button")) {
  b.onclick = () => {
    const m = session.room.map, page = Number(b.dataset.page);
    session.setInfo({ map: page * 9 + (pageOf(m) >= 0 ? m % 9 : 0) });
  };
}
// the arrows go through the list's maps (this level's, then the specials) and round again
function stepMap(d) {
  const maps = [...mapSel.options].map((o) => Number(o.value));
  const i = maps.indexOf(session.room.map);
  session.setInfo({ map: maps[i < 0 ? 0 : (i + d + maps.length) % maps.length] });
}
$("map-prev").onclick = () => stepMap(-1);
$("map-next").onclick = () => stepMap(1);

// The room's map as the exe's room shows it: lobby/ready/minimap*.spr, 120 x 100 (Drop Bomb's stages and the boss
// cave from the Korean data); Space and Galaxy have none, so their pictures are scaled down, and a custom map's too
function minimapOf(m) {
  if (m >= 0 && m <= 26) return ["lobby/ready/minimap.spr", m];
  if (m >= PANEL_FIRST_MAP && m < PANEL_FIRST_MAP + PANEL_MAPS.length) return ["lobby/ready/minimap_pannel.spr", m - PANEL_FIRST_MAP];
  if (m >= HYPER_FIRST_MAP && m < HYPER_FIRST_MAP + HYPER_MAPS.length) return ["lobby/ready/minimap_hyper.spr", m - HYPER_FIRST_MAP];
  if (DROP_STAGES[m]) return ["lobby/ready/minimap_drop.spr", m - 44];
  if (m >= BOSS_FIRST_MAP && m < BOSS_FIRST_MAP + BOSS_MAPS.length) return ["BattleBoss/Map/minimap_boss.spr", 0];
  if (m === SPACE_MAP) return ["map/MAP_09.spr", 0];
  if (m === GALAXY_MAP) return ["kr/map/MAP_09.spr", 0];
  const c = isCustomMap(m) && customMap(m);       // a custom map without its own picture: its blocks' map's
  if (c && !c.pics[0]) return ["lobby/ready/minimap.spr", 9 + c.theme];
  return null;
}
// The battle maps' previews (minimap.spr: a design's picture for each page) have their page's English word painted in
// the top right corner. The Japanese client of July 2003 has the same pictures without it (/data/jp/: the server's
// jp_game_dir), so the room shows those with the page's word in the player's language over them, as the game paints
// it; on a server without that file a dark tag covers the old word.
const CLEAN_FRAMES = [0, 1, 2, 3, 4, 5, 6, 17, 7];   // design -> its frame there (ToyBox and Soccer are elsewhere)
const PAGE_INK = [["#fff7a8", "#ffa400"], ["#d2fcff", "#0aa2ea"], ["#ffb27a", "#e40000"]];   // top, bottom of the word
const WORD_EDGE = "#121646";
let cleanMinimaps = null;
function cleanMinimap(design) {
  if (!cleanMinimaps) {
    cleanMinimaps = loadSprite("jp/lobby/ready/minimap.spr").then((s) => (s.count === 19 ? s : null), () => null);
  }
  return cleanMinimaps.then((s) => (s ? s.frame(CLEAN_FRAMES[design]) : null));
}
// the page's word on a 120 x 100 preview drawn k times bigger; `tag`: on a dark tag that hides the picture's own
function drawPageWord(ctx, page, k, tag) {
  const text = t(MAP_PAGES[page]), right = 117, base = 13;
  const font = (n) => `800 ${n}px "Arial Rounded MT Bold", "Arial Black", system-ui, sans-serif`;
  ctx.save();
  ctx.scale(k, k);
  let size = 13;
  ctx.font = font(size);
  while (size > 7 && ctx.measureText(text).width > 108) ctx.font = font(--size);   // (a long word: smaller)
  const left = right - ctx.measureText(text).width;
  if (tag) {
    ctx.fillStyle = WORD_EDGE;
    ctx.beginPath();
    const x = Math.min(49, left - 4);                        // (over the old word, wherever it was)
    if (ctx.roundRect) ctx.roundRect(x, -6, 130, 26, 6);
    else ctx.rect(x, -6, 130, 26);
    ctx.fill();
  }
  const ink = ctx.createLinearGradient(0, base - size * 0.75, 0, base);
  ink.addColorStop(0, PAGE_INK[page][0]);
  ink.addColorStop(1, PAGE_INK[page][1]);
  ctx.textAlign = "right";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = WORD_EDGE;
  ctx.strokeText(text, right, base);
  ctx.fillStyle = ink;
  ctx.fillText(text, right, base);
  ctx.restore();
}
// a custom map's picture (the list must have it)
function customImage(m) {
  const c = customMap(m);
  if (!c) return Promise.reject(new Error("not listed"));
  const img = new Image();
  img.src = customPicture(c, 0);
  return img.decode().then(() => img);
}
let previewMap = null;
// The custom maps' list again (session.js loadCustomMaps): the room shown again if it changed
function refreshCustomMaps(force = false) {
  loadCustomMaps(force).then((changed) => {
    if (!changed) return;
    previewMap = null;
    if (session.screen === "room") renderRoom();
  });
}
async function drawMapPreview(m) {
  if (m === previewMap) return;
  previewMap = m;
  const cv = $("map-preview"), src = minimapOf(m);
  const paged = src && src[0] === "lobby/ready/minimap.spr" ? Math.floor(src[1] / 9) : -1;   // (its page's word)
  try {
    if (!src && !isCustomMap(m)) throw new Error("no preview");
    let f = src ? (await loadSprite(src[0])).frame(src[1]) : await customImage(m);
    const clean = paged >= 0 ? await cleanMinimap(src[1] % 9) : null;
    if (previewMap !== m) return;            // the host picked another one meanwhile
    if (clean) f = clean;
    const k = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));   // (sharp words on any screen)
    cv.width = 120 * k;
    cv.height = 100 * k;
    const ctx = cv.getContext("2d"), s = Math.max(cv.width / f.width, cv.height / f.height);
    ctx.imageSmoothingEnabled = !(Number.isInteger(s) && s >= 1);   // the game's small pictures: their pixels
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(f, (cv.width - f.width * s) / 2, (cv.height - f.height * s) / 2, f.width * s, f.height * s);
    if (paged >= 0) drawPageWord(ctx, paged, k, !clean);
    cv.title = mapName(m);
    cv.hidden = false;
  } catch (e) {
    if (previewMap === m) cv.hidden = true;  // no picture (a missing game file)
  }
}
TIME_LIMITS.forEach((lim, i) => $("rule-time").append(el("option", { value: String(i) }, lim)));

const TEAM_NAMES = ["A", "B", "C"];

// Team sizes as the server checks them at start: at least two teams, all the same size.
function teamBalance(room) {
  const counts = new Map();
  for (const p of room.players.values()) counts.set(p.team, (counts.get(p.team) || 0) + 1);
  const sizes = [...counts.values()];
  const text = [...counts.keys()].sort().map((k) => `${TEAM_NAMES[k] ?? "?"} ${counts.get(k)}`).join(" · ");
  return { ok: counts.size >= 2 && sizes.every((n) => n === sizes[0]), text };
}
// A guild battle as the server checks it at start (guilds.battle_problem): two guilds, 2 against 2 or 3 against 3
function guildBalance([a, b]) {
  if (!a.n || !b.n) return { ok: false, why: t("Waiting for another guild's players.") };
  if (a.n !== b.n) return { ok: false, why: t("Teams must be the same size ({sizes}).", { sizes: `A ${a.n} · B ${b.n}` }) };
  if (a.n < 2) return { ok: false, why: t("A guild battle starts at 2 against 2.") };
  return { ok: true };
}

function renderRoom() {
  const room = session.room;
  if (!room) return;
  const info = room.info || { name: "", open: [1, 1, 1, 1, 1, 1] };
  // a guild battle (guilds.py): its guilds, team A's against team B's ("?" while one has nobody yet)
  const gTeams = session.guildRoom() ? guildTeams(room.players.values()) : null;
  $("room-title").replaceChildren(`${t("Room {n}", { n: room.number + 1 })} — ${info.name}`,
    ...(session.allModes() ? [" ", el("span", { class: "tag mode m" + session.roomMode() }, modeName(session.roomMode()))] : []),
    ...(gTeams ? [" ", el("span", { class: "tag gb", title: t("The winning guild gets a win and guild points") },
      gTeams.map((gt) => gt.name || "?").join(" vs "))] : []),
    ...(room.watch ? [" ", el("span", { class: "tag watch", title: t("Nobody sees you here. Leave: back to the lobby.") },
      t("Watching"))] : []));
  const host = session.isHost();
  const teams = session.teamMode();
  const bySlot = new Map([...room.players.values()].map((p) => [p.slot, p]));
  const seats = [], size = info.max || 6;
  for (let s = 0; s < size; s++) {
    const p = bySlot.get(s);
    if (!p) {
      seats.push(emptySeat(s, !!info.open[s], host));
      continue;
    }
    const team = teams && p.team >= 0 && p.team <= 2 ? p.team : -1;
    seats.push(seatCard(p, room, team, host));
  }
  $("seats").replaceChildren(...seats);
  $("seats").classList.toggle("big", size > 6);

  const me = session.me();
  $("team-mode").value = teams ? "1" : "0";
  $("team-mode").disabled = !host;
  $("team-row").hidden = !teams;
  for (const b of $("team-row").querySelectorAll("button")) b.classList.toggle("on", !!me && me.team === Number(b.dataset.team));
  const hyper = session.gameType() === GROUP_HYPER, panel = session.gameType() === GROUP_PANEL;
  const drop = session.gameType() === GROUP_DROP, boss = session.gameType() === GROUP_BOSS;
  const group = session.gameType(), page = pageOf(room.map);
  fillMaps(group, page >= 0 ? page : Math.max(0, mapPage));
  if (isCustomMap(room.map)) {             // a custom map: the list asked for again if it lacks it; off the list, its own entry
    if (!customMap(room.map)) refreshCustomMaps();
    if (![...mapSel.options].some((o) => Number(o.value) === room.map)) {
      mapSel.append(el("option", { value: String(room.map) }, mapName(room.map)));
    }
  }
  mapSel.value = String(room.map);
  mapSel.disabled = !host;
  $("map-prev").disabled = $("map-next").disabled = !host;
  $("map-prev").hidden = $("map-next").hidden = mapSel.options.length < 2;     // Boss Battle: one cave
  $("map-pages").hidden = !paged(group);
  $("map-row").classList.toggle("solo", !paged(group));
  for (const b of $("map-pages").querySelectorAll("button")) {
    b.classList.toggle("on", Number(b.dataset.page) === page);
    b.disabled = !host;
  }
  drawMapPreview(room.map);
  const rate = mapRateText(group, room.map);   // the picked map pays more (or less): the database's map_rates
  $("map-rate").hidden = !rate;
  $("map-rate").textContent = rate ? t("This map pays {rate}", { rate }) : "";
  $("revenge-rule").hidden = hyper || panel || drop || boss;   // Drop Bomb: nobody throws bombs (the server keeps it off)
  $("walls-rule").hidden = group !== 0;                  // HURRY UP blocks fall in Survival only
  $("wins-rule").hidden = hyper || panel || boss;              // Boss Battle: stages
  $("spawns-rule").hidden = boss;                              // Boss Battle: fixed starts (the time limit: every mode)
  $("stages-rule").hidden = !boss;
  $("mode-rule").hidden = boss || !!gTeams;              // everyone against the boss; a guild battle: always teams
  if (boss || gTeams) $("team-row").hidden = true;      // (the server seats a guild battle's players by guild)
  $("guild-rule").hidden = !gTeams;
  if (gTeams) {
    $("guild-rule").replaceChildren(el("b", {}, t("Guild battle")),
      ...gTeams.map((gt, i) => el("span", { class: "gb-team" }, el("span", { class: "tag t" + i }, t("Team {name}", { name: TEAM_NAMES[i] })),
        gt.name ? el("span", { class: "gb-name" }, gt.name) : el("span", { class: "muted" }, t("another guild")),
        el("span", { class: "muted" }, `${gt.n}/3`))),
      el("small", { class: "muted" }, t("Each team is one guild. It starts at 2 against 2 or 3 against 3.")));
  }
  $("hyper-rules").hidden = !hyper;
  $("panel-rules").hidden = !panel;
  $("drop-rules").hidden = !drop;
  $("boss-rules").hidden = !boss;
  $("rule-stages").value = room.rules[0] === 3 ? "3" : "1";
  $("rule-stages").disabled = !host;
  $("rule-wins").value = String(room.rules[0] || 2);
  $("rule-time").value = String(room.rules[1] || 0);
  $("rule-spawns").value = room.rules[2] ? "1" : "0";
  $("rule-wins").disabled = $("rule-time").disabled = $("rule-spawns").disabled = !host;
  const soccer = room.map === 8 || room.map === 17 || room.map === 26;
  $("rule-revenge").value = room.rules[4] && !soccer ? "1" : "0";
  $("rule-revenge").disabled = !host || soccer;
  $("rule-revenge").title = soccer ? t("No revenge cart on the Soccer maps") : t("Players who die ride the border and throw bombs");
  // rule +6 WALLS: 0 off, 1 full, 2 middle (h_room.WALLS_*); the blocks fall from 1:00, Middle stops them early
  const until = Math.max(0, 60 - session.walls.middle_s), mid = `${Math.floor(session.walls.middle_s / 60)}:${String(session.walls.middle_s % 60).padStart(2, "0")}`;
  $("walls-middle").textContent = t("On/Middle");
  $("rule-walls").value = String(session.walls.on ? Math.min(2, Math.max(0, room.rules[3])) : 0);
  $("rule-walls").disabled = !host || !session.walls.on;
  $("rule-walls").title = !session.walls.on ? t("This server never drops the HURRY UP blocks")
    : t("After HURRY UP, blocks fall from 1:00 and close in from the edges. Full: until the arena is full. Middle: for {s} s, until {mid}. Off: none",
      { s: until, mid });
  renderItems(host, hyper, drop);
  $("boss-items").hidden = !boss;
  if (boss) renderBossItems();
  const others = [...room.players.values()].filter((p) => p.id !== room.hostId);
  const solo = boss && others.length === 0;                // Boss Battle: the host may take the boss on alone
  const allReady = (others.length > 0 || solo) && others.every((p) => p.ready);
  const balance = gTeams ? guildBalance(gTeams) : teams ? teamBalance(room) : { ok: true };
  $("ready-btn").hidden = !!room.watch;                     // a game master watching (watch.py): no seat
  if (room.watch) {
    $("room-hint").textContent = t("You are watching this room: nobody sees you. Leave: back to the lobby.");
  } else if (host) {
    $("ready-btn").textContent = t("Start");
    $("ready-btn").disabled = !allReady || !balance.ok;
    $("room-hint").textContent = solo ? t("Start to take on the boss alone, or wait for players.")
      : others.length === 0 ? t("Waiting for players.")
      : !balance.ok ? balance.why || t("Teams must be the same size ({sizes}).", { sizes: balance.text })
      : allReady ? t("Everyone is ready.") : t("Waiting for everyone to be ready.");
  } else {
    $("ready-btn").textContent = me && me.ready ? t("Not ready") : t("Ready");
    $("ready-btn").disabled = false;
    $("room-hint").textContent = t("The host starts the match.");
  }
}

// Boss Battle: the player's own items (0x8b6): which goes on Q W A S, and how many; they are bought in the shop
let bossKey = "";
function renderBossItems() {
  const shop = session.bossShop;
  $("boss-coins").replaceChildren(...(shop ? [priceTag("mission", shop.mission)] : []));
  const key = JSON.stringify(shop);
  if (!shop || key === bossKey) return;
  bossKey = key;
  const owned = new Map(shop.items.map((it) => [it.id, it.owned]));
  const name = (id) => (BOSS_ITEMS[id] ? t(BOSS_ITEMS[id].name) : t("Item {id}", { id }));
  $("boss-slots").replaceChildren(...["Q", "W", "A", "S"].map((k, i) => {
    const sel = el("select", { "aria-label": t("Item on {key}", { key: k }) }, el("option", { value: "0" }, "—"));
    for (const it of shop.items) {
      if (it.owned > 0 || shop.slots[i] === it.id) sel.append(el("option", { value: String(it.id) }, `${name(it.id)} ×${it.owned}`));
    }
    sel.value = String(shop.slots[i] || 0);
    sel.onchange = () => {                     // one kind per key: the key that had it gets the old one
      const slots = shop.slots.slice(), v = Number(sel.value), j = slots.indexOf(v);
      if (v && j >= 0 && j !== i) slots[j] = slots[i];
      slots[i] = v;
      session.setBossSlots(slots);
    };
    return el("label", {}, k, sel);
  }));
  $("boss-shop").replaceChildren(...shop.items.flatMap((it) => {
    const cv = el("canvas", { width: "32", height: "32" });
    if (BOSS_ITEMS[it.id]) drawItemIcon(cv, `BattleBoss/Item/${BOSS_ITEMS[it.id].spr}_i.spr`);
    return [cv, el("span", {}, name(it.id), " ", el("span", { class: "owned" }, `×${owned.get(it.id)}`))];
  }));
}
$("boss-buy").onclick = () => openShop("shop", "boss");

// The room's item toggles show the 80x80 tiles of web/img/ui/powerups.spr, a frame per item type (ITEM_LABELS order).
// It has no Fire: the game draws Fire on blue and Full fire on yellow, so Fire is Full fire's flame with the yellow
// around it painted the blue of the other tiles (a 13th frame in the file is used instead, if it gets one). Without
// the file, the game's own icons.
const POWERUPS = "img/ui/powerups.spr";
const POWERUP_FRAMES = [12, 6, 0, 1, 3, 10, 8, 5, 2, 7, 4, 9, 11];   // Fire, Speed, Bomb, Kick, Glove, Skull, Vest, ...
const FULL_FIRE = 5;
let powerups = null;
async function drawPowerup(canvas, type) {
  try {
    powerups ||= fetch(POWERUPS).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(POWERUPS))))
      .then((buf) => new Sprite(POWERUPS, buf));
    const spr = await powerups, f = POWERUP_FRAMES[type];
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(f < spr.count ? spr.frame(f) : blueTile(spr.frame(FULL_FIRE)), 0, 0, canvas.width, canvas.height);
  } catch (e) { drawItemIcon(canvas, ITEM_SPRITES[type]); }
}

// Full fire's tile on blue: a fill from just inside the frame over the flat yellow ground (the flame's black outline
// stops it), then the outline's blended pixels next to it; each takes the blue by how much yellow it held
function blueTile(src) {
  const c = document.createElement("canvas"), w = c.width = src.width, h = c.height = src.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h), d = img.data, done = new Uint8Array(w * h);
  const ground = (o) => d[o + 3] && d[o] > 200 && d[o + 1] > 150 && d[o + 1] < 225 && d[o + 2] < 90;
  const blended = (o) => d[o + 3] && d[o] > 60 && d[o] >= d[o + 1] && d[o + 2] < 90;
  const stack = [];
  for (let i = 0; i < w; i++) for (const k of [2, 3, h - 4, h - 3]) stack.push(i, k);
  for (let i = 0; i < h; i++) for (const k of [2, 3, w - 4, w - 3]) stack.push(k, i);
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h || done[y * w + x] || !ground((y * w + x) * 4)) continue;
    done[y * w + x] = 1;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  const next = (x, y) => x >= 0 && y >= 0 && x < w && y < h && done[y * w + x];
  for (let pass = 0; pass < 2; pass++) {
    const edge = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!done[y * w + x] && blended((y * w + x) * 4)
        && (next(x + 1, y) || next(x - 1, y) || next(x, y + 1) || next(x, y - 1))) edge.push(y * w + x);
    }
    for (const i of edge) done[i] = 1;
  }
  for (let i = 0; i < w * h; i++) {
    if (!done[i]) continue;
    const o = i * 4, k = Math.min(1, d[o + 1] / 198);
    d[o] = 0; d[o + 1] = Math.round(89 * k); d[o + 2] = Math.round(189 * k);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Items the host lets drop: one toggle per item type (bit t of room.items)
let itemButtons = null;
function renderItems(host, hyper, drop) {
  if (!itemButtons) {
    itemButtons = ITEM_LABELS.map((name, type) => {
      const cv = el("canvas", { width: "80", height: "80" });
      drawPowerup(cv, type);
      return el("button", { type: "button", "aria-label": t(name), onclick: () => session.setItems(session.room.items ^ (1 << type)) }, cv);
    });
    $("item-grid").replaceChildren(...itemButtons);
  }
  const items = session.room.items;
  itemButtons.forEach((b, type) => {
    const never = drop && DROP_NO_ITEMS.includes(type);       // bomb items: nobody places bombs in Drop Bomb
    const on = !!(items >> type & 1) && !never;
    b.classList.toggle("off", !on);
    b.setAttribute("aria-pressed", String(on));
    b.title = `${t(ITEM_LABELS[type])}: ${never ? t("never in Drop Bomb") : on ? t("on") : t("off")}`;
    b.disabled = !host || never;
  });
  $("items-all").hidden = !host || items === ALL_ITEMS;
  $("items-note").textContent = [items === ALL_ITEMS ? t("Each map's own items.") : items === 0 ? t("No items drop.")
    : t("Items that are off never drop; their blocks get one of the items left on."),
  items === ALL_ITEMS && host ? t("Click one to switch it off.") : "", items === 0 && hyper ? t("The parts still do.") : "",
  drop ? t("Bomb items never drop in Drop Bomb.") : ""].filter(Boolean).join(" ");
}
$("items-all").onclick = () => session.setItems(ALL_ITEMS);

// A player's character is the one in their avatar; a 3D avatar is drawn like the exe draws it (outfits.js). In team
// battle too: the teams show by the card's team chip (and in the match by rings and name colours).
const shownLook = (p) => (p.look >= 0 ? p.look : 0);
function drawAvatar(canvas, p) {
  if (p.outfit) {
    outfitPreview(p.outfit).then((runs) => drawRunsFit(canvas, runs)).catch(() => drawCharacter(canvas, 0));
    outfitSets(p.outfit).catch(() => {});            // the match sprites, built before the match starts
  } else drawCharacter(canvas, shownLook(p));
}
mapSel.onchange = () => session.setInfo({ map: Number(mapSel.value) });
// the host's own team switches the room between free for all (-1) and team battle (C_room.md §5)
$("team-mode").onchange = () => {
  const me = session.me();
  session.setInfo({ team: $("team-mode").value === "1" ? (me && me.team >= 0 ? me.team : 0) : -1 });
};
for (const b of $("team-row").querySelectorAll("button")) b.onclick = () => session.setInfo({ team: Number(b.dataset.team) });
$("rule-wins").onchange = $("rule-time").onchange = $("rule-spawns").onchange = $("rule-revenge").onchange =
  $("rule-walls").onchange = $("rule-stages").onchange = () => {
  const r = session.room.rules.slice();
  r[0] = Number($(session.gameType() === GROUP_BOSS ? "rule-stages" : "rule-wins").value);
  r[1] = Number($("rule-time").value);
  r[2] = Number($("rule-spawns").value);
  if (session.walls.on) r[3] = Number($("rule-walls").value);
  r[4] = Number($("rule-revenge").value);
  session.setRules(session.legalRules(r));        // (Hyper Bomb, Panel Attack: the hidden ones stay 0)
};
$("ready-btn").onclick = () => session.readyOrStart();
$("room-leave").onclick = () => session.leaveRoom();

// ------------------------------------------------------------------ shop and inventory (server's economy.py)
// The catalogue lists what the server's cache folders hold and every price; the wallet (0x8b7) the player's Bomber
// Coins, Cash, Mission Coins and items; 0x8b6 the Boss Battle items owned. Anything can be tried on in the preview;
// only what is owned can be worn or used. "Inventory" shows only what is owned. Opens from the lobby and from a room.
const SHOP_TABS = [["chars", N_("Characters")], ["cards", N_("Card backgrounds")], ["bombs", N_("Bombs")], ["boss", N_("Boss items")],
  ["face", N_("Face")], ["hair", N_("Hair")], ["head", N_("Hats & ears")], ["glasses", N_("Glasses & masks")],
  ["outer", N_("Jackets & costumes")], ["top", N_("Shirts")], ["bottom", N_("Trousers & skirts")], ["shoes", N_("Shoes")],
  ["other", N_("Other")]];
const GIRL_BODY = 1210001, BOY_BODY = 210001, DEFAULT_FACES = { [BOY_BODY]: 40001, [GIRL_BODY]: 1040001 };
const CURRENCY = { coins: N_("Bomber Coins"), cash: N_("Cash"), mission: N_("Mission Coins") };
const SHOP_RESULTS = { 1: N_("Bought! It stays in Inventory."), 2: N_("You own that already."), 3: N_("That is not for sale."),
  4: N_("Not enough Bomber Coins."), 5: N_("Not enough Cash."), 6: N_("Not enough Mission Coins."),
  7: N_("You have 99 of that already."), 8: N_("Not while your room is playing.") };
let shopCat = null, shopLoad = null, shopMode = "shop", shopTab = "chars", draft = null, charPick = -1, previewToken = 0;
let bossPick = 0;                                    // the Boss items tab's picked item
let cardPick = 0;                                    // the Card backgrounds tab's picked background
let bombPick = -1;                                   // the Bombs tab's picked skin (0: the game's bomb, -1: none)
let shopPage = 0;                                    // the grid's page (SHOP_PAGE cards each)
const SHOP_PAGE = 48;
const pictures = new Set();
// what the shop hides (the GM panel's "Hidden"): not in the Shop, still in the Inventory of who has it
let hiddenIds = new Set(), bossHidden = new Set(), shopLoadedAt = 0;
// what a GM marked New (the panel's "New"): first in its tab of the Shop, with a NEW tag
let newIds = new Set(), bossNew = new Set();
const SHOP_FRESH_MS = 30000;                         // opening the shop later fetches the catalogue again

// Mission Coins' icon is Boss Battle's own coin, from the game data (missionicon.js); a plain coin until then
missionIcon().then((c) => { if (c) document.documentElement.style.setProperty("--mission-icon", `url(${c.toDataURL()})`); });

// (with the pass: the hidden items this page's account may see, bmoserver/hidden.py)
function loadShop() {
  if (!shopLoad) {
    shopLoad = fetch("shop/catalogue.json", { headers: passHeaders(), cache: "no-store" }).then((r) => r.json()).then((cat) => {
      shopCat = cat;
      shopLoadedAt = Date.now();
      hiddenIds = new Set(cat.hidden || []);
      bossHidden = new Set(cat.boss_hidden || []);
      newIds = new Set(cat.new || []);
      bossNew = new Set(cat.boss_new || []);
      if (newIds.size || bossNew.size) newBadge();
      setSkinList(cat.bombs);
      for (const id of cat.pictures) pictures.add(id);
      if (addCharacters(cat.characters)) session.relook();     // (hidden ones: not in /config.json)
      if (session.screen === "room") renderRoom();
      return true;
    }).catch(() => { shopLoad = null; return !!shopCat; });    // (the one from before, if any)
  }
  return shopLoad;
}
// A hidden item a player online wears that this page's catalogue lacks (they show it only while one wears it,
// bmoserver/hidden.py): the catalogue again, not sooner than SHOP_AGAIN_MS after the last
const SHOP_AGAIN_MS = 10000;
let shopAgain = 0, ownedBefore = null;
function catalogueAgain() {
  if (shopAgain) return;
  const wait = shopCat ? Math.max(500, SHOP_AGAIN_MS - (Date.now() - shopLoadedAt)) : 500;
  shopAgain = setTimeout(() => {
    shopAgain = 0;
    shopLoad = null;
    loadShop().then(() => { if (session.screen === "lobby") renderLobby(); renderShop(); });
  }, wait);
}
onUnknownCharacter(catalogueAgain);
onUnknownSkin(catalogueAgain);
const priceOf = (id) => (shopCat && shopCat.prices[id]) || null;     // [currency, amount, note]
// an item's rarity (the GM panel's list: Common ... Mythic): {id, name, color, about} or null; the Boss Battle items
// by their own ids
function rarityOf(id, boss = false) {
  const by = shopCat && ((boss ? shopCat.boss_rarity : shopCat.rarity) || {})[id];
  return by ? (shopCat.rarities || []).find((r) => r.id === by) || null : null;
}
const RAINBOW = "linear-gradient(90deg, #ff4d4d, #ffa64d, #ffe14d, #5ee06b, #4dd2ff, #6b7cff, #c45cff)";
// the NEW badge: the Korean client's own (Data/event/server_new.spr, red letters outlined in yellow, its two frames
// blinking) as --new-a / --new-b; without that file the page draws one in its colours (app.css .new-badge)
let newBadgeLoad = null;
function newBadge() {
  newBadgeLoad = newBadgeLoad || loadSprite("kr/event/server_new.spr").then((spr) => {
    const boxes = [0, 1].map((i) => spr.bbox(Math.min(i, spr.count - 1)));
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const w = Math.max(...boxes.map((b) => b.x + b.w)) - x0, h = Math.max(...boxes.map((b) => b.y + b.h)) - y0;
    if (w <= 0 || h <= 0) return;
    const root = document.documentElement;
    ["--new-a", "--new-b"].forEach((name, i) => {
      const cv = el("canvas", { width: String(w), height: String(h) });
      cv.getContext("2d").drawImage(spr.frame(Math.min(i, spr.count - 1)), -x0, -y0);
      root.style.setProperty(name, `url(${cv.toDataURL()})`);
    });
    root.classList.add("new-sprite");
  }).catch(() => {});
}
const isNew = (id, boss = false) => shopMode === "shop" && (boss ? bossNew : newIds).has(id);
// the Shop's tab: the items marked New first (in their order), then the rest
const newFirst = (ids, boss = false) => [...ids.filter((id) => isNew(id, boss)), ...ids.filter((id) => !isNew(id, boss))];
// a shop card's flags: NEW (in the Shop) out over its top left corner, and the rarity over the picture's top left
// (under NEW), its name on its colour (a bar of it along the top too, and what it means in the card's tooltip)
function withFlags(card, id, boss = false) {
  const flags = [];
  const r = rarityOf(id, boss), hex = r && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : null;
  if (r && (hex || r.color === "rainbow")) {
    const lum = hex ? [1, 3, 5].reduce((a, k, i) => a + [0.299, 0.587, 0.114][i] * parseInt(hex.substr(k, 2), 16), 0) : 200;
    card.classList.add("rarity");
    card.style.setProperty("--rarity", hex || RAINBOW);
    card.style.setProperty("--rarity-ink", lum > 150 ? "#14161a" : "#fff");
    flags.push(el("span", { class: "rarity-tag" }, t(r.name)));
    card.title = [t(r.name) + (r.about ? ": " + t(r.about) : ""), card.title].filter(Boolean).join(" · ");
  }
  if (isNew(id, boss)) {
    card.classList.add("is-new");
    card.append(el("span", { class: "new-badge", "aria-hidden": "true" }, "NEW"));
    card.title = [t("New"), card.title].filter(Boolean).join(" · ");
  }
  if (flags.length) card.prepend(el("span", { class: "card-flags" }, ...flags));
  if (flags.length || isNew(id, boss)) card.classList.add("flagged");
  return card;
}
const isFree = (id) => { const p = priceOf(id); return !!p && p[1] === 0; };
function owns(id) { return isFree(id) || !!(session.wallet && session.wallet.owned.has(id)); }
const fmt = num;                                     // (as the page's language writes numbers)
function priceTag(cur, amount) { return el("span", { class: "price " + cur, title: t(CURRENCY[cur]) }, fmt(amount)); }
function costOf(ids) {
  const c = { coins: 0, cash: 0 };
  for (const id of ids) { const p = priceOf(id); if (p) c[p[0]] += p[1]; }
  return c;
}

// the balances in the lobby's and the room's bar and in the shop; Mission Coins in the shop and on the Boss Battle
// channel
function renderWallet() {
  const w = session.wallet;
  for (const box of document.querySelectorAll("[data-wallet]")) {
    const mission = !!box.closest("dialog") || session.gameType() === GROUP_BOSS;
    box.replaceChildren(...(w ? [
      el("span", { class: "price coins", title: t("Bomber Coins: earned by playing") }, fmt(w.coins)),
      el("span", { class: "price cash", title: t("Cash: bought to support the server") }, fmt(w.cash)),
      ...(mission ? [el("span", { class: "price mission", title: t("Mission Coins: picked up in Boss Battle") },
        fmt(w.mission))] : [])] : []));
  }
}

async function openShop(mode, tab) {
  if (shopCat && Date.now() - shopLoadedAt > SHOP_FRESH_MS) shopLoad = null;      // prices or hidden items changed?
  if (!(await loadShop())) { toast(t("The shop is not available on this server.")); return; }
  shopMode = mode;
  if (tab) shopTab = tab;
  shopPage = 0;
  draft = null;
  charPick = -1;
  bossPick = 0;
  cardPick = 0;
  bombPick = -1;
  session.getOutfit();                               // -> 0x8b2 -> draft
  session.walletQuery();
  session.bossShopQuery();                           // the Boss Battle items owned (0x8b6)
  $("shop-cash").hidden = !session.payments && !session.cashUrl;
  if (!$("dlg-shop").open) $("dlg-shop").showModal();
}
// Get Cash: bought here, on Stripe's page (cash.js), or the server's own page for it (config cash_url)
$("shop-cash").onclick = () => (session.payments ? openCash() : window.open(session.cashUrl, "_blank", "noopener"));
$("lobby-shop").onclick = $("room-shop").onclick = () => openShop("shop");
$("lobby-options").onclick = $("room-options").onclick = () => openOptions();   // controls and sound (options.js)
$("lobby-items").onclick = $("room-items").onclick = () => openShop("mine");
for (const b of $("shop-mode").querySelectorAll("button")) b.onclick = () => { shopMode = b.dataset.mode; shopPage = 0; renderShop(); };

// the character the account shows now (-1: its 3D outfit), and the one picked in the Characters tab
function currentLook() {
  if (session.outfit && session.outfit.look !== undefined) return session.outfit.wearing ? -1 : session.outfit.look;
  const me = session.me();
  return me ? me.look : -1;
}
const pickedLook = () => (charPick >= 0 ? charPick : currentLook());
// the card background used now (0: the default silver) and the one picked in the Card backgrounds tab
const currentCard = () => (session.wallet ? session.wallet.card : (session.me() || {}).card || 0);
const pickedCard = () => cardPick || currentCard();
// the bomb skin used now (0: the game's bomb, "Classic") and the one picked in the Bombs tab
const currentBomb = () => (session.wallet ? session.wallet.bomb || 0 : 0);
const pickedBomb = () => (bombPick >= 0 ? bombPick : currentBomb());
const bombName = (id) => (id ? ((shopCat.bombs || []).find((b) => b.id === id) || {}).name || "#" + id : t("Classic"));

// The shop's pictures are drawn as they come into view (each may fetch its files), not a whole page at once; a new
// grid (renderShop) forgets the ones of the one before
let shopView = null;
const unseen = new WeakMap();                        // a picture not drawn yet -> how to draw it
function newShopView() {
  if (shopView) shopView.disconnect();
  shopView = "IntersectionObserver" in window ? new IntersectionObserver((seen) => {
    for (const e of seen) {
      if (!e.isIntersecting) continue;
      shopView.unobserve(e.target);
      const draw = unseen.get(e.target);
      unseen.delete(e.target);
      if (draw) draw();
    }
  }, { rootMargin: "150px" }) : null;
}
function whenSeen(node, draw) {
  if (!shopView) draw();
  else { unseen.set(node, draw); shopView.observe(node); }
  return node;
}

// An item's items.dat picture; an item without one (some from other_files/models): the default boy or girl wearing
// just it, drawn like the preview; a face without one: their head with it, close up like the faces' pictures
const FACE_TOP = 0.36;                               // the head's share of the preview's height
function shopThumb(id) {
  if (pictures.has(id) && hiddenIds.has(id)) {         // a hidden one's (its owner's): with the pass (hidden.py)
    const img = el("img", { alt: String(id) });
    passUrl(`shop/${id}.bmp`).then((u) => { img.onload = () => URL.revokeObjectURL(u); img.src = u; }).catch(() => {});
    return img;
  }
  if (pictures.has(id)) return el("img", { alt: String(id), loading: "lazy", src: `shop/${id}.bmp` });
  const box = el("span", { class: "noimg" }, "#" + id);
  const face = !!shopCat && shopCat.faces.some((f) => f.id === id);
  if (face || (shopCat && shopCat.items.some((i) => i.id === id))) {
    const body = id >= 1000000 ? GIRL_BODY : BOY_BODY, cv = el("canvas", { width: "100", height: "160", "aria-label": String(id) });
    whenSeen(box, () => outfitPreview(face ? { body, face: id, items: [] } : { body, face: DEFAULT_FACES[body], items: [id] })
      .then((runs) => { drawRunsFit(cv, runs, 0.9, face ? FACE_TOP : 1); box.replaceChildren(cv); }).catch(() => {}));
  }
  return box;
}
// a character's card: the character itself, standing like in the room (not the items.dat card picture)
function charThumb(n) {
  const cv = el("canvas", { width: "64", height: "100", "aria-label": characterName(n) });
  return whenSeen(cv, () => drawCharacter(cv, n));
}
function tabIds(tab) {
  let ids;
  if (tab === "boss") {
    const items = session.bossShop ? session.bossShop.items : [];
    return newFirst(items.filter((it) => (shopMode === "shop" ? !bossHidden.has(it.id) : it.owned > 0)).map((it) => it.id), true);
  }
  if (tab === "bombs") {                             // "Classic" (0) first: everyone has it
    ids = [0, ...(shopCat.bombs || []).map((b) => b.id)];
    return shopMode === "mine" ? ids.filter((id) => !id || owns(id)) : newFirst(ids.filter((id) => !hiddenIds.has(id)));
  }
  if (tab === "cards") ids = (shopCat.cards || []).map((c) => c.id);
  else if (tab === "chars") ids = CHARACTERS.map((c) => c[3]);
  else {
    const girl = draft.body === GIRL_BODY;
    ids = tab === "face" ? shopCat.faces.filter((f) => f.girl === girl).map((f) => f.id)
      : shopCat.items.filter((i) => i.cat === tab && i.girl === girl).map((i) => i.id);
  }
  return shopMode === "mine" ? ids.filter(owns) : newFirst(ids.filter((id) => !hiddenIds.has(id)));
}
function itemCat(id) { const i = shopCat.items.find((x) => x.id === id); return i ? i.cat : null; }

// a Boss Battle item: its icon, name, how many are owned and (in the shop) its price in Mission Coins
const bossItem = (id) => session.bossShop.items.find((x) => x.id === id);
const bossNote = (id) => (shopCat.boss && shopCat.boss[id] && shopCat.boss[id][2]) || t((BOSS_ITEMS[id] || {}).name || "");
function bossCard(id) {
  const it = bossItem(id), info = BOSS_ITEMS[id], cv = el("canvas", { width: "48", height: "48" });
  if (info) drawItemIcon(cv, `BattleBoss/Item/${info.spr}_i.spr`);
  const cap = el("span", { class: "cap" }, el("span", { class: "owned" }, `×${it.owned}`));
  if (shopMode === "shop") cap.append(priceTag("mission", it.price));
  return withFlags(el("button", { type: "button", class: "boss" + (bossPick === id ? " on" : ""), title: bossNote(id),
    onclick: () => { bossPick = id; renderShop(); } }, cv, el("span", { class: "bname" }, info ? t(info.name) : "#" + id), cap), id, true);
}

// a card background: a small card in its colour or picture, with its name
function cardSwatch(id) {
  const c = cardLook(id), p = priceOf(id), mine = owns(id);
  const cap = el("span", { class: "cap" }, c ? c.name : "#" + id);
  if (shopMode === "shop") cap.append(mine ? el("span", { class: "tag ok" }, isFree(id) ? t("Free") : t("Owned")) : p ? priceTag(p[0], p[1]) : "—");
  return withFlags(el("button", { type: "button", class: "card-pick" + (id === pickedCard() ? " on" : "") + (mine ? "" : " locked"),
    title: c ? c.name : "", onclick: () => { cardPick = id; renderShop(); } },
    hiddenCard(el("span", { class: "card-swatch", style: cardStyle(id) }), c), cap), id);
}
// the picked background on the preview canvas, a card's metal frame around it
function drawCardPreview(cv, id) {
  const ctx = cv.getContext("2d"), c = cardLook(id), w = cv.width, h = cv.height, token = ++previewToken;
  const frame = () => {
    ctx.lineWidth = 6; ctx.strokeStyle = "#101217"; ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255, 255, 255, .7)"; ctx.strokeRect(7, 7, w - 14, h - 14);
  };
  const g = ctx.createLinearGradient(0, 0, 0, h), base = c && c.color ? c.color : "#c3c8ce";
  g.addColorStop(0, "#fff"); g.addColorStop(0.02, base); g.addColorStop(1, "#000");
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.35; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
  frame();
  if (c && c.image) {
    const img = new Image();
    img.onload = () => {
      if (token !== previewToken) return;
      const s = Math.max(w / img.width, h / img.height);
      ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
      frame();
    };
    if (hiddenIds.has(c.id)) passUrl(c.image).then((u) => { img.src = u; }).catch(() => {});   // (hidden.py)
    else img.src = c.image;
  }
}

// a bomb skin: its bomb, with its name and price
function bombSwatch(id) {
  const p = priceOf(id), mine = !id || owns(id), cv = el("canvas", { width: "52", height: "54" });
  whenSeen(cv, () => Promise.all([bombSkin(id), classicSkin()]).then(([s, base]) => {
    const spr = (s && s.sprites.idle) || base.sprites.idle;
    if (spr) cv.getContext("2d").drawImage(spr.frame(0), 14, 20, 52, 54, 0, 0, 52, 54);
  }));
  const cap = el("span", { class: "cap" }, bombName(id));
  if (shopMode === "shop") cap.append(mine ? el("span", { class: "tag ok" }, !id || isFree(id) ? t("Free") : t("Owned")) : p ? priceTag(p[0], p[1]) : "—");
  return withFlags(el("button", { type: "button", class: "bomb-pick" + (id === pickedBomb() ? " on" : "") + (mine ? "" : " locked"),
    title: bombName(id), onclick: () => { bombPick = id; renderShop(); } }, cv, cap), id);
}
// the picked skin, animated: its bomb with the fuse spark and a row of its fire
function animateBombPreview(cv, id, token) {
  Promise.all([bombSkin(id), classicSkin()]).then(([s, base]) => {
    const ctx = cv.getContext("2d"), t0 = performance.now();
    const step = (now) => {
      if (token !== previewToken || !$("dlg-shop").open) return;
      drawBombPreview(ctx, s, base, now - t0);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function shopCard(id) {
  if (shopTab === "boss") return bossCard(id);
  if (shopTab === "cards") return cardSwatch(id);
  if (shopTab === "bombs") return bombSwatch(id);
  const chars = shopTab === "chars", n = chars ? CHARACTERS.findIndex((c) => c[3] === id) : -1;
  const on = chars ? n === pickedLook() : shopTab === "face" ? draft.face === id : draft.items[shopTab] === id;
  const p = priceOf(id), mine = owns(id);
  const cap = el("span", { class: "cap" });
  if (chars) cap.append(String(n + 1));
  if (shopMode === "shop") cap.append(mine ? el("span", { class: "tag ok" }, isFree(id) ? t("Free") : t("Owned")) : p ? priceTag(p[0], p[1]) : "—");
  const title = [chars ? characterName(n) : p && p[2] ? p[2] : "#" + id, !mine && p ? `${fmt(p[1])} ${t(CURRENCY[p[0]])}` : ""];
  return withFlags(el("button", { type: "button", class: (on ? "on" : "") + (mine ? "" : " locked"), title: title.filter(Boolean).join(" · "),
    onclick: () => {
      if (chars) charPick = n;
      else if (shopTab === "face") draft.face = id;
      else if (draft.items[shopTab] === id) delete draft.items[shopTab];
      else draft.items[shopTab] = id;
      renderShop();
    } }, chars ? charThumb(n) : shopThumb(id), cap), id);
}

function renderShop() {
  if (!shopCat || !draft || !$("dlg-shop").open) return;
  if (!tabIds(shopTab).length) shopTab = "chars";
  const chars = shopTab === "chars", boss = shopTab === "boss", cards = shopTab === "cards", bombs = shopTab === "bombs";
  if (boss && !tabIds("boss").includes(bossPick)) bossPick = tabIds("boss")[0] || 0;
  for (const b of $("shop-mode").querySelectorAll("button")) b.classList.toggle("on", b.dataset.mode === shopMode);
  for (const b of document.querySelectorAll(".shop-body button")) b.classList.toggle("on", Number(b.dataset.body) === draft.body);
  newShopView();
  $("shop-bodies").hidden = $("shop-wearing").hidden = chars || boss || cards || bombs;
  const o = session.outfit, look = currentLook();
  // $("shop-status").textContent = boss ? (bossPick ? bossNote(bossPick) : "")
  //   : !o ? "" : o.wearing ? "You wear your saved outfit."
  //   : look >= 0 ? `You show character ${look + 1} (${characterName(look)}).` : "";
  // what the draft wears: the face, then one item per category (click an item to take it off)
  const worn = [el("button", { type: "button", class: owns(draft.face) ? "" : "locked", title: t("Face {id}", { id: draft.face }),
    onclick: () => { shopTab = "face"; shopPage = 0; renderShop(); } }, shopThumb(draft.face))];
  for (const [cat, id] of Object.entries(draft.items)) {
    worn.push(el("button", { type: "button", class: owns(id) ? "" : "locked", title: t("Take off {id}", { id }),
      onclick: () => { delete draft.items[cat]; renderShop(); } }, shopThumb(id)));
  }
  $("shop-wearing").replaceChildren(...worn);
  const token = ++previewToken, cv = $("shop-preview");
  if (cards) drawCardPreview(cv, pickedCard());
  else if (bombs) animateBombPreview(cv, pickedBomb(), token);
  else if (boss) {
    cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
    if (BOSS_ITEMS[bossPick]) drawItemIcon(cv, `BattleBoss/Item/${BOSS_ITEMS[bossPick].spr}_i.spr`);
  } else if (chars) {
    const n = Math.max(0, pickedLook());
    characterPreview(n).then(() => { if (token === previewToken) drawCharacter(cv, n); }).catch(() => {});
  } else {
    outfitPreview({ body: draft.body, face: draft.face, items: Object.values(draft.items) })
      .then((runs) => { if (token === previewToken) drawRunsFit(cv, runs); })
      .catch(() => { if (token === previewToken) cv.getContext("2d").clearRect(0, 0, 999, 999); });
  }
  $("shop-tabs").replaceChildren(...SHOP_TABS.filter(([k]) => tabIds(k).length).map(([k, name]) =>
    el("button", { type: "button", class: k === shopTab ? "on" : "", onclick: () => { shopTab = k; shopPage = 0; renderShop(); } }, t(name))));
  const ids = tabIds(shopTab), pages = Math.max(1, Math.ceil(ids.length / SHOP_PAGE));
  shopPage = Math.min(shopPage, pages - 1);
  $("shop-grid").replaceChildren(...ids.slice(shopPage * SHOP_PAGE, (shopPage + 1) * SHOP_PAGE).map(shopCard));
  const step = (page, text) => {                     // (el() would write disabled="false": still disabled)
    const b = el("button", { type: "button", class: "small", onclick: () => { shopPage = page; renderShop(); $("shop-grid").scrollTop = 0; } }, text);
    b.disabled = page < 0 || page >= pages;
    return b;
  };
  $("shop-pages").replaceChildren(...(pages > 1 ? [step(shopPage - 1, "<"),
    el("span", { class: "muted small" }, t("Page {n} of {pages}", { n: shopPage + 1, pages })), step(shopPage + 1, ">")] : []));
  $("shop-pages").hidden = pages <= 1;
  renderShopActions();
}

// what the Buy button buys: the picked character, or the parts of the draft not owned yet
function shopToBuy() {
  if (shopTab === "cards") return pickedCard() && !owns(pickedCard()) ? [pickedCard()] : [];
  if (shopTab === "bombs") return pickedBomb() && !owns(pickedBomb()) ? [pickedBomb()] : [];
  if (shopTab !== "chars") return [draft.face, ...Object.values(draft.items)].filter((id) => !owns(id));
  const n = pickedLook();
  return n >= 0 && !owns(CHARACTERS[n][3]) ? [CHARACTERS[n][3]] : [];
}
function renderShopActions() {
  if (shopTab === "boss") return renderBossActions();
  const chars = shopTab === "chars", cards = shopTab === "cards", bombs = shopTab === "bombs";
  const toBuy = shopToBuy(), cost = costOf(toBuy);
  const w = session.wallet || { coins: 0, cash: 0 };
  const short = ["coins", "cash"].filter((k) => cost[k] > w[k]);
  const buy = $("shop-buy"), wear = $("shop-wear");
  wear.hidden = false;
  buy.hidden = !toBuy.length;
  buy.replaceChildren(chars ? t("Buy character") : cards ? t("Buy background") : bombs ? t("Buy bomb")
    : toBuy.length === 1 ? t("Buy item") : t("Buy {n} items", { n: toBuy.length }),
    ...["coins", "cash"].filter((k) => cost[k]).map((k) => priceTag(k, cost[k])));
  buy.disabled = !session.wallet || short.length > 0;
  wear.textContent = chars ? t("Use character") : cards ? t("Use background") : bombs ? t("Use bomb") : t("Wear outfit");
  wear.disabled = toBuy.length > 0 || (chars && (pickedLook() < 0 || pickedLook() === currentLook()))
    || (cards && pickedCard() === currentCard()) || (bombs && pickedBomb() === currentBomb());
  buy.classList.toggle("primary", toBuy.length > 0);
  wear.classList.toggle("primary", !toBuy.length);
  $("shop-note").textContent = short.length
    ? t("You need {what}.", { what: short.map((k) => t("{n} more {currency}", { n: fmt(cost[k] - w[k]), currency: t(CURRENCY[k]) }))
      .join(` ${t("and")} `) }) + " " +
      (short.includes("cash") ? t("Cash is bought to support the server.") : t("Play matches to earn Bomber Coins."))
    : cards ? t("Your card's background in rooms: everyone in the room sees it.")
    : bombs ? t("Your bombs and their fire in matches, for every web player (from the next match). Pierce and water bombs keep their look.")
    : toBuy.length ? (chars ? t("Buy it to play with it; it stays in Inventory.") : t("You are trying on items that are not yours yet: buy them to wear the outfit."))
    : shopMode === "mine" ? t("Everything you bought. Put an outfit together or pick a character, then wear or use it.")
    : t("All cash its all to supports the server costs.");
}
// Boss items: bought one at a time with Mission Coins (no confirmation: they are the game's own coins)
function renderBossActions() {
  const buy = $("shop-buy"), wear = $("shop-wear"), it = bossPick ? bossItem(bossPick) : null;
  const have = session.bossShop ? session.bossShop.mission : 0;
  wear.hidden = true;
  buy.hidden = shopMode !== "shop" || !it;
  if (it) buy.replaceChildren(t("Buy 1"), priceTag("mission", it.price));
  buy.disabled = !it || have < it.price || it.owned >= 99;
  buy.classList.add("primary");
  $("shop-note").textContent = it && shopMode === "shop" && have < it.price
    ? t("You need {n} more Mission Coins. Pick up the coins the boss drops in Boss Battle.", { n: fmt(it.price - have) })
    : t("Put them on Q W A S in a Boss Battle room. Mission Coins are the coins you pick up in Boss Battle.");
}

// a purchase asks first: what it is (as the preview shows it), its price and what is left after
$("shop-buy").onclick = async () => {
  if (shopTab === "boss") { if (bossPick) session.buyBossItem(bossPick); return; }
  const toBuy = shopToBuy();
  if (!toBuy.length) return;
  const what = shopTab === "chars" ? t("Character {n}: {name}", { n: pickedLook() + 1, name: characterName(pickedLook()) })
    : shopTab === "cards" ? t("Background \"{name}\"", { name: (cardLook(pickedCard()) || {}).name })
    : shopTab === "bombs" ? t("Bomb \"{name}\"", { name: bombName(pickedBomb()) })
    : toBuy.length === 1 ? t("1 item") : t("{n} items", { n: toBuy.length });
  const cost = costOf(toBuy), w = session.wallet || { coins: 0, cash: 0 }, kinds = ["coins", "cash"].filter((k) => cost[k]);
  const from = $("shop-preview"), pic = el("canvas", { width: from.width, height: from.height, "aria-hidden": "true" });
  pic.getContext("2d").drawImage(from, 0, 0);
  const yes = await ask({ title: t("Confirm purchase"), yes: t("Buy"), text: t("It stays in your Inventory."),
    body: el("div", { class: "ask-buy" }, pic, el("div", {}, el("div", { class: "ask-name" }, what),
      el("dl", {}, el("dt", {}, t("Price")), el("dd", {}, ...kinds.map((k) => priceTag(k, cost[k]))),
        el("dt", {}, t("Left after")), el("dd", {}, ...kinds.map((k) => priceTag(k, w[k] - cost[k])))))) });
  if (yes) session.buyItems(toBuy);
};
$("shop-wear").onclick = () => {
  if (shopTab === "bombs") {
    session.setBomb(pickedBomb());
    toast(t("Your bombs are \"{name}\" now.", { name: bombName(pickedBomb()) }), true);
    bombPick = -1;
  } else if (shopTab === "cards") {
    session.setCard(pickedCard());
    toast(t("Your card uses \"{name}\" now.", { name: (cardLook(pickedCard()) || {}).name }), true);
    cardPick = 0;
  } else if (shopTab === "chars") {
    if (pickedLook() >= 0) session.setLook(pickedLook());
    charPick = -1;
  } else if (draft) session.wearOutfit({ body: draft.body, face: draft.face, items: Object.values(draft.items) });
};
session.addEventListener("shop", (ev) => {
  const r = ev.detail.result;
  toast(SHOP_RESULTS[r] ? t(SHOP_RESULTS[r]) : t("The shop refused that."), r === 1);
});

function draftFrom(o) {
  const d = { body: o.body, face: o.face, items: {} };
  for (const id of o.items) { const c = itemCat(id); if (c) d.items[c] = id; }
  return d;
}
for (const b of document.querySelectorAll(".shop-body button")) b.onclick = () => {
  const body = Number(b.dataset.body);
  if (!draft || draft.body === body) return;
  const saved = session.outfit;
  draft = saved && saved.body === body ? draftFrom(saved)
    : { body, face: shopCat.faces.find((f) => f.girl === (body === GIRL_BODY)).id, items: {} };
  shopPage = 0;
  renderShop();
};

// ------------------------------------------------------------------ match
// Touch screens get on-screen controls in the match (game/touch.js), when the server's touch_controls is on
let touchPad = null;
session.addEventListener("gamestart", async (ev) => {
  endTraining();
  closeOptions();                                          // a match reads the options when it starts
  show("game");
  const { Match } = await import("./game/match.js");
  session.match = new Match(session, $("game-canvas"), ev.detail);
  session.match.start();
  $("game-canvas").focus();
  const { TouchControls, touchDevice } = await import("./game/touch.js");
  if (session.touchControls && touchDevice()) (touchPad ||= new TouchControls($("screen-game"))).attach(session.match);
});

// ------------------------------------------------------------------ training (game/training.js)
// The lobby's Training: a match in this page alone, with bots or not, no clock, nothing counted. The window keeps
// the last choices.
let trainingItems = null, trainingMask = ALL_ITEMS;
function openTraining() {
  const dlg = $("dlg-training"), sel = $("training-map");
  if (!trainingItems) {
    sel.replaceChildren(...MAP_PAGES.map((page, k) => el("optgroup", { label: t(page) },
      ...MAP_NAMES.map((n, i) => el("option", { value: String(k * 9 + i) }, t(n))))));
    trainingItems = ITEM_LABELS.map((name, type) => {
      const cv = el("canvas", { width: "80", height: "80" });
      drawPowerup(cv, type);
      return el("button", { type: "button", "aria-label": t(name),
        onclick: () => { trainingMask ^= 1 << type; renderTrainingItems(); } }, cv);
    });
    $("training-items").replaceChildren(...trainingItems);
  }
  sel.value = remember("training-map") ?? "1";
  if (!sel.selectedOptions.length) sel.value = "1";
  $("training-bots").value = remember("training-bots") ?? "1";
  if (!$("training-bots").selectedOptions.length) $("training-bots").value = "1";
  $("training-blocks").checked = remember("training-blocks") !== "0";
  $("training-full").checked = remember("training-full") === "1";
  const mask = Number(remember("training-items") ?? ALL_ITEMS);
  trainingMask = Number.isInteger(mask) && mask >= 0 && mask <= ALL_ITEMS ? mask : ALL_ITEMS;
  renderTrainingItems();
  dlg.returnValue = "";
  dlg.showModal();
  dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "ok") return;
    const opts = { map: Number(sel.value), bots: Number($("training-bots").value), blocks: $("training-blocks").checked,
      full: $("training-full").checked, items: trainingMask };
    remember("training-map", sel.value);
    remember("training-bots", String(opts.bots));
    remember("training-blocks", opts.blocks ? "1" : "0");
    remember("training-full", opts.full ? "1" : "0");
    remember("training-items", String(opts.items));
    startTraining(opts);
  }, { once: true });
}
function renderTrainingItems() {
  trainingItems.forEach((b, type) => {
    const on = !!(trainingMask >> type & 1);
    b.classList.toggle("off", !on);
    b.setAttribute("aria-pressed", String(on));
    b.title = `${t(ITEM_LABELS[type])}: ${on ? t("on") : t("off")}`;
  });
  $("training-items-all").hidden = trainingMask === ALL_ITEMS;
  $("training-items-note").textContent = trainingMask === ALL_ITEMS ? t("Each map's own items.")
    : trainingMask === 0 ? t("No items drop.") : t("Items that are off never drop; their blocks get one of the items left on.");
}
$("training-items-all").onclick = () => { trainingMask = ALL_ITEMS; renderTrainingItems(); };
$("lobby-training").onclick = () => openTraining();

async function startTraining(opts) {
  if (session.training || session.match) return;
  if (session.line) session.leaveLine();          // (its turn would take the player into that room meanwhile)
  closeOptions();
  show("game");
  const [{ Match }, { Training }] = await Promise.all([import("./game/match.js"), import("./game/training.js")]);
  const tr = new Training(session, opts, session.trainingTiming);
  tr.onEnd = endTraining;
  session.training = tr;                           // (superbroadcast.js: the match draws a /superbroadcast itself)
  new Match(tr.sessionFor(), $("game-canvas"), null).start();
  $("game-canvas").focus();
  const { TouchControls, touchDevice } = await import("./game/touch.js");
  if (session.touchControls && touchDevice() && tr.match) (touchPad ||= new TouchControls($("screen-game"))).attach(tr.match);
}

// The training is over (its player left it, or the session moved on: another screen, a match): back to the lobby
function endTraining() {
  const tr = session.training;
  if (!tr) return;
  session.training = null;
  if (tr.match && !tr.match.stopped) tr.match.stop();
  if (touchPad) touchPad.detach();
  show(session.screen);
  if (session.screen === "lobby") { music("BKSND1"); renderLobby(); }
}

// ------------------------------------------------------------------ session events
session.addEventListener("change", (ev) => {
  const what = ev.detail;
  if (what === "screen") {
    endTraining();
    if (session.screen !== "game") { show(session.screen); if (touchPad) touchPad.detach(); }
    if (session.screen === "login" && !currentMusic()) music("BKSND0");     // (a match's end by a lost connection)
    installTip(session.screen === "lobby");
    if (session.screen === "lobby") { renderLobby(); loadShop(); }
    if (session.screen === "room") { roomTab("players"); renderRoom(); refreshCustomMaps(); }
    renderChat();
  } else if ((what === "lobby" || what === "line") && session.screen === "lobby") renderLobby();
  else if (what === "room" && session.screen === "room") renderRoom();
  else if (what === "chat") renderChat();
  else if (what === "outfit" && shopCat) {
    if (!draft || $("dlg-shop").open && session.outfit.wearing) draft = draftFrom(session.outfit);
    renderShop();
  } else if (what === "wallet") {
    // an item just given that the catalogue does not list (a hidden one: only its owner's, bmoserver/hidden.py)
    const owned = session.wallet ? session.wallet.owned : new Set();
    if (shopCat && ownedBefore && [...owned].some((id) => !ownedBefore.has(id) && !shopCat.prices[id])) catalogueAgain();
    ownedBefore = owned;
    renderWallet();
    renderShop();
    if (session.screen === "room") renderRoom();
  }
});
session.addEventListener("error", (ev) => toast(ev.detail, false, readMs(ev.detail)));
// The connection dropped in a match: a note over the game while the page tries to come back to it (session.js)
session.addEventListener("reconnecting", (ev) => {
  let note = $("reconnect-note");
  if (!ev.detail) { if (note) note.remove(); return; }
  if (note) return;
  note = el("div", { id: "reconnect-note", class: "rejoin-note", role: "status" },
    el("p", { class: "rn-msg" }, t("Connection lost")), el("p", { class: "rn-note" }, t("Going back to your match…")));
  $("screen-game").append(note);
});
session.addEventListener("announce", (ev) => toast("[GM] " + ev.detail, "gm", 10000));   // /broadcast (a match: hud.js)
initGuild(session, toast);                           // the lobby's Guild window (guild.js)
initAccount(session, toast);                         // the lobby's Account window (account.js)
initCash(session, toast);                            // the shop's Get Cash window (cash.js)
initReport(session, toast);                          // a player's Report window (report.js)
initDevtools(session, toast);                        // the browser's inspect tools open: told, the lobby's warning
initSuperBroadcast(session);                         // a game master's /superbroadcast band (superbroadcast.js)
initClicks();                                        // the buttons' sounds (clicks.js)
initRanking(session, (points) => {                   // the lobby's rankings (ranking.js), with each player's belt
  const i = session.beltOf(points);
  return session.belts[i] ? beltIcon(session.belts[i][1], beltTitle(i)) : null;
});

// ------------------------------------------------------------------ language (i18n.js)
// Picked on the sign-in screen or in Options (Display); each language by its own name. A change shows at once: index.html's
// texts change where they are, and what this page made is made again.
const langPicks = [$("login-lang"), $("opt-lang")];
for (const sel of langPicks) {
  sel.replaceChildren(...LANGUAGES.map(([code, name]) => el("option", { value: code, lang: code }, name)));
  sel.value = language();
  sel.onchange = async () => {
    for (const x of langPicks) x.disabled = true;
    try { await setLanguage(sel.value); } finally { for (const x of langPicks) x.disabled = false; }
  };
}
onLanguage(() => {
  for (const sel of langPicks) sel.value = language();
  $("reg-year").options[0].textContent = t("Choose…");
  if (regCountries.length) $("reg-country").replaceChildren(...countryOptions(regCountries, $("reg-country").value));
  $("create-mode").replaceChildren();                    // (made again when the window opens)
  mapGroup = -1;                                         // the map list, the items' names, the boss items: made again
  previewMap = null;
  itemButtons = null;
  bossKey = "";
  renderWallet();
  if (session.screen === "lobby") renderLobby();
  if (session.screen === "room") renderRoom();
  renderShop();
});
show("login");
music("BKSND0");

// A page loaded in a tab whose match is still on (a reload, the browser's own after a crash): back into the match
// without signing in, while the server keeps the place (rejoin.js)
{
  const back = comeBack();
  if (back) {
    $("login-btn").disabled = true;
    toast(t("Going back to your match…"), true, 8000);
    import("./game/match.js")                      // (the match's code first: the server sends it all at once)
      .then(() => session.resume(back))
      .then(() => { $("toast").hidden = true; })
      .catch((e) => toast(e.message || t("Disconnected from the server.")))
      .finally(() => { $("login-btn").disabled = false; });
  }
}             // BomberMan.exe's music from the sign-in screen on (game/sound.js: from the first click or key)
