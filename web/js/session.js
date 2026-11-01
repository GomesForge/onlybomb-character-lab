// Client side of the login / lobby / room protocol (docs/protocol/A_login.md, B_lobby.md, C_room.md).
// Keeps the state the UI shows and emits "change" events; the match itself lives in game/.

import { Connection } from "./net/conn.js";
import { Reader, Writer, PROTOCOL_VERSION, hex, encodeChat } from "./net/codec.js";
import { CHARACTERS, lookOfAvatar, addCharacters, expectFilesPass, setFilesPass, setHdPacks }
  from "./game/characters.js";
import { outfitOfAvatar } from "./game/outfits.js";
import { setStartSpeed } from "./game/player.js";
import { t, N_, locale } from "./i18n.js";
import { music } from "./game/sound.js";
import * as rejoin from "./rejoin.js";

// (the names, as every text the page shows, are English: i18n.js translates them where they show)
export const MAP_NAMES = [N_("Random"), N_("Standard"), N_("Pyramid"), N_("Laboratory"), N_("Village"), N_("Iceberg"),
  N_("Road"), N_("ToyBox"), N_("Soccer")];
export const MAP_PAGES = [N_("Beginner"), N_("Normal"), N_("Advanced")];
export const TIME_LIMITS = ["1:30", "2:00", "2:30", "3:00"];
// Items the host lets drop, by item type (server extension 0x4b0 / 0x4b1 / 0x8b0, not in the .exe protocol)
export const ITEM_LABELS = [N_("Fire"), N_("Speed"), N_("Bomb"), N_("item|Kick"), N_("Glove"), N_("Skull"), N_("Vest"),
  N_("Full fire"), N_("Louie"), N_("Punch"), N_("Line bomb"), N_("Pierce bomb"), N_("Water bomb")];
export const ALL_ITEMS = (1 << ITEM_LABELS.length) - 1;
// Hyper Bomb (channel group 2): maps 36..43 (C_room.md §1.5)
export const HYPER_MAPS = [N_("Random"), N_("High Tech"), N_("Catacomb"), N_("Circuit"), N_("Military"), N_("Pirate Ship"),
  N_("Snow Land"), N_("Spaceship")];
export const HYPER_FIRST_MAP = 36;
export const GROUP_HYPER = 2;
// Panel Attack (channel group 1): maps 27..35
export const PANEL_MAPS = [N_("Random"), N_("Circus"), N_("Space"), N_("Factory"), N_("Stadium"), N_("Bead Park"), N_("Quiz"),
  N_("Boxing"), N_("Airport")];
export const PANEL_FIRST_MAP = 27;
export const GROUP_PANEL = 1;
// Drop Bomb (channel group 3, a server extension): the Survival maps; nobody places bombs, they fall from the sky
export const GROUP_DROP = 3;
export const DROP_NO_ITEMS = [0, 2, 7, 10, 11, 12];   // fire, bomb, full fire, line, pierce, water: never drop there
// ... and its own stages, map sets 44 and 45 (the Korean client's Data/DropBomb graphics; up to 6 players)
export const DROP_STAGES = { 44: "Grand Blue", 45: "Matrix" };
// Boss Battle (channel group 4, a server extension with the Korean client's boss): Cave 1 (map 47); with 3 stages the
// match goes on in Cave 2 and Cave 3 (48, 49). Rule +0 = stages (1 or 3), fixed starts, no revenge carts.
export const GROUP_BOSS = 4;
export const BOSS_FIRST_MAP = 47;
export const BOSS_MAPS = [N_("Cave"), N_("River Cave"), N_("Lava Cave")];
// Every mode in one lobby (channel group 5, web only): each room has its own, picked when it is created
export const GROUP_ALL = 5;
// Guild Battle (a room mode there, the server's h_room.GUILD): Survival's game, two teams of one guild each, 2 against
// 2 or 3 against 3; the server seats each player in their guild's team
export const GROUP_GUILD = 6;
export const MODE_NAMES = { 0: N_("Survival"), [GROUP_HYPER]: N_("Hyper Bomb"), [GROUP_PANEL]: N_("Panel Attack"),
  [GROUP_DROP]: N_("Drop Bomb"), [GROUP_GUILD]: N_("Guild Battle"), [GROUP_BOSS]: N_("Boss Battle") };
export const MODE_ORDER = [0, GROUP_HYPER, GROUP_PANEL, GROUP_DROP, GROUP_GUILD, GROUP_BOSS];

// Space (server extension, Survival): the "Random" slot's lava crater under the stars (map set 9), full power
export const SPACE_MAP = 50, SPACE_SET = 9;
// Galaxy (server extension, Survival): Space's set in the Korean client's picture (kr/map/MAP_09.spr, its glass pipes
// flashing: render.js)
export const GALAXY_MAP = 51;
export const isSpaceMap = (m) => m === SPACE_MAP || m === GALAXY_MAP;

// Custom maps (server extension, web only: the GM panel's own maps, bmoserver/custom_maps.py): map CUSTOM_BASE + id,
// played as map set CUSTOM_SET (Standard of the Normal page, no gimmick), rooms of up to 12, on a screen for that many
// players as the other maps (17 x 15 up to 6, the big rooms' fields: CUSTOM_SIZES). /custommaps.json lists them:
// {map, name, theme (the blocks' look: a design, 1..7), modes (bits: CUSTOM_SURVIVAL, CUSTOM_DROP), on (in the
// rooms' lists), v (its pictures' version), soft, hard (its own pictures of the breakable block, of the pillar), pics
// (of each screen, whether it has its own picture: else the game draws its blocks' map picture)}
export const CUSTOM_BASE = 1000, CUSTOM_SET = 10, CUSTOM_SURVIVAL = 1, CUSTOM_DROP = 2;
export const isCustomMap = (m) => m > CUSTOM_BASE;
let customList = [], customAsked = -Infinity, customLoading = null;
export const customMaps = () => customList;
export const customMap = (m) => customList.find((c) => c.map === m) || null;
export const CUSTOM_SIZES = [[17, 15], [21, 17], [25, 19]];
// its picture of screen `kind` (0, 1, 2), or its own picture of block `kind` ("soft", "hard")
export const customPicture = (c, kind) => `custommap/${c.map - CUSTOM_BASE}-${kind}.png?v=${c.v}`;
export const customSideSlot = (m, screen) => m + 100000 * screen;     // its side scenery's (custom_maps.side_slot)
// The list from the server again (not within 30 s of the last time, unless forced): resolves true if it changed
export function loadCustomMaps(force = false) {
  if (customLoading) return customLoading;
  if (!force && performance.now() - customAsked < 30000) return Promise.resolve(false);
  customAsked = performance.now();
  customLoading = fetch("custommaps.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
    .catch(() => null).then((list) => {
      customLoading = null;
      if (!Array.isArray(list) || JSON.stringify(list) === JSON.stringify(customList)) return false;
      customList = list;
      return true;
    });
  return customLoading;
}

// one account a computer (h_login.same_computer): a sign-in refused with -10
const SAME_COMPUTER = -10;
const ONE_A_COMPUTER = N_("Another account is already playing on this computer. Sign out of it first (one account a computer).");
// coming back to a match (the server's rejoin.py): 0x55ea's extensions after the pass, and 0x3eb's "nothing to come
// back to"
const WEB_RESUME = 0xe4, WEB_CAN_RESUME = 0xe5, GONE = -3;
// a ban of the GM panel (the server's bans.py): a sign-in refused with -109, then u8 0xE6 and why; or 0x8cd, why alone,
// putting the player out of the game. Why: u8 kind (0 the account, 1 the address), u32 until (Unix time, 0: for good),
// u8 n, n bytes the reason (UTF-8)
const BANNED = -109, WEB_BAN = 0xe6;

function banText(d, o) {
  if (d.length < o + 6) return t("This account is banned.");
  const kind = d[o], until = new Reader(d).u32(o + 1);
  const reason = new TextDecoder().decode(d.slice(o + 6, o + 6 + d[o + 5])).trim();
  const date = until ? new Date(until * 1000).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }) : "";
  const text = kind === 2 ? t("A game master disconnected you.")      // (no ban: /disconnect, bans.PUT_OUT)
    : kind === 1 ? t("Your connection is banned until {date}.", { date })
      : until ? t("This account is banned until {date}.", { date }) : t("This account is banned.");
  return reason ? text + " " + t("Reason: {reason}", { reason }) : text;
}
const RETRY_MS = 2000;                   // a dropped connection tries to come back to its match this often

// a map's name, in the page's language
export function mapName(m) {
  if (m === SPACE_MAP) return t("Space");
  if (m === GALAXY_MAP) return t("Galaxy");
  if (isCustomMap(m)) { const c = customMap(m); return c ? c.name : t("Custom map {n}", { n: m - CUSTOM_BASE }); }
  if (DROP_STAGES[m]) return DROP_STAGES[m];
  if (m >= 0 && m <= 26) return `${t(MAP_NAMES[m % 9])} (${t(MAP_PAGES[Math.floor(m / 9)])})`;
  if (m >= HYPER_FIRST_MAP && m < HYPER_FIRST_MAP + HYPER_MAPS.length) return t(HYPER_MAPS[m - HYPER_FIRST_MAP]);
  if (m >= PANEL_FIRST_MAP && m < PANEL_FIRST_MAP + PANEL_MAPS.length) return t(PANEL_MAPS[m - PANEL_FIRST_MAP]);
  if (m >= BOSS_FIRST_MAP && m < BOSS_FIRST_MAP + BOSS_MAPS.length) return t(BOSS_MAPS[m - BOSS_FIRST_MAP]);
  return t("Map {n}", { n: m });
}
// a mode's name, in the page's language
export const modeName = (m) => t(MODE_NAMES[m] || "");

// What every browser on one computer has alike, and two computers on one network seldom: the system, the time zone,
// the processor's threads and the screen's size. The server keeps it only while the account plays, to refuse a second
// account on the same computer (h_login.same_computer); it names nobody.
function deviceSignature() {
  const p = `${navigator.platform || ""} ${navigator.userAgent || ""}`;
  const os = /iPhone|iPad|iPod/.test(p) ? "ios" : /Android/.test(p) ? "android" : /Win/.test(p) ? "win"
    : /Mac/.test(p) ? "mac" : /Linux|X11|CrOS/.test(p) ? "linux" : "other";
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* none */ }
  const w = screen.width || 0, h = screen.height || 0;
  return [os, tz, navigator.hardwareConcurrency || 0, `${Math.max(w, h)}x${Math.min(w, h)}`].join("|").slice(0, 100);
}

// A lobby user entry; for web clients also where the player is (the server's Player.user_entry): state 0 the lobby,
// 1 the room `room`, 2 a match there; locked: that room has a password
function parseUser(d) {
  const r = new Reader(d);
  return { id: r.i16(0), nick: r.cstr(2, 17), cls: r.i16(0x13), room: r.i16(0x15), state: d[0x17] || 0, locked: !!d[0x18] };
}

// Where a player's picture is (register.py; the version makes a new picture a new address), or null
export function pictureUrl(p) { return p && p.picture && p.userId ? `picture/${p.userId}?v=${p.picture}` : null; }

function parseRoom(d) {
  const r = new Reader(d);
  const max = r.i16(0x2b) || 6, open = [];
  // seats 7..12 of a room of 12 (server extension): their open flags follow the 51 bytes; then the room's mode (-1:
  // the channel's; the lobby's entries always have it), and in the lobby's how many wait in its line (C_room §5.11)
  for (let i = 0; i < max; i++) open.push(i < 6 ? d[0x2d + i] || 0 : d[0x33 + i - 6] ?? 1);
  const at = 0x33 + Math.max(0, max - 6);
  return {
    number: r.i16(0), count: r.i16(2), playing: d[4] !== 0, name: r.cstr(5, 23) || "Only Bomb Online!",
    password: r.cstr(0x1c, 13), team: r.i16(0x29), max, open, members: [], mode: d.length > at ? d[at] : -1,
    line: d.length > at + 1 ? d[at + 1] : 0,
  };
}

export function parseEntry(d) {
  const r = new Reader(d);
  return {
    id: r.i16(0), slot: r.i16(2), nick: r.cstr(4, 17), guest: r.i16(0x17), room: r.i16(0x19),
    ready: r.i16(0x1b), cls: r.i16(0x1d), card: r.u32(0x21), score: r.i32(0x25), char: r.i16(0x2b), map: r.i16(0x2d),
    bomb: r.i16(0x29),           // the bomb skin: id - 8000000 (game/bombskins.js), 0 = the game's bomb
    team: r.i16(0x2f), variant: r.i16(0x31), guild: r.cstr(0x43, 17),
    // wins and losses in every mode; the server puts the record of every mode but Boss Battle (the room card's win
    // rate) in +0x58 (the .exe's draws) and +0x60
    wins: r.i32(0x54), losses: r.i32(0x5c), recWins: r.i32(0x58), recLosses: r.i32(0x60),
    raw: d.slice(0, 100),
    // 0x7d8 carries the 52-byte avatar after the entry: the character this player shows (-1: a 3D avatar)
    ...(d.length >= 152 ? avatarFields(d.slice(100, 152)) : { look: undefined }),
    // then (server extension, for web clients) u32 user id, u32 the version of the player's picture (0: none),
    // char[2] the player's country (ISO 3166; none: "")
    ...(d.length >= 160 ? { userId: r.u32(152), picture: r.u32(156) } : {}),
    ...(d.length >= 162 ? { country: String.fromCharCode(d[160], d[161]).replace(/\0/g, "") } : {}),
  };
}

// look: one of the 45 characters (-1: a 3D avatar); outfit: the 3D avatar's body, face and items, or null
function avatarFields(desc) {
  const look = lookOfAvatar(desc);
  return { avatar: desc, look, outfit: outfitOfAvatar(desc, look) };
}

// The round being played as it is now, after 0x8c9's rows (the server's h_game Match.snapshot: Survival and Drop
// Bomb), for a player back in the middle of it to watch; null when there is none
function parseSnapshot(d, o) {
  if (d.length <= o || d[o] !== 1) return null;
  const r = new Reader(d);
  const s = { left: r.u16(o + 1), hurry: !!d[o + 3], arrows: d[o + 4], switches: d[o + 5], sand: d[o + 6],
    w: d[o + 7], h: d[o + 8], items: [], bombs: [], players: [], ice: [] };
  let k = o + 9;
  s.cells = new Uint8Array(s.w * s.h);
  for (let i = 0; i < s.w * s.h; i++) s.cells[i] = (d[k + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15;   // (high nibble first)
  k += (s.w * s.h + 1) >> 1;
  for (let n = d[k++]; n > 0; n--, k += 3) s.items.push({ x: d[k], y: d[k + 1], type: d[k + 2] });
  for (let n = d[k++]; n > 0; n--, k += 10) {
    s.bombs.push({ id: r.i16(k), owner: r.i16(k + 2), x: d[k + 4], y: d[k + 5], power: d[k + 6], kind: d[k + 7], air: r.u16(k + 8) });
  }
  for (let n = d[k++]; n > 0; n--) {
    const q = { id: r.i16(k), alive: !!d[k + 2], mount: (d[k + 3] << 24) >> 24, x: d[k + 4], y: d[k + 5] };
    k += 6;
    const m = d[k++];
    q.move = m ? d.slice(k, k + m) : null;
    k += m;
    const c = d[k++];
    q.cart = c ? d.slice(k, k + c) : null;
    k += c;
    s.players.push(q);
  }
  for (let n = d[k++]; n > 0; n--, k += 3) s.ice.push({ x: d[k], y: d[k + 1], broken: !!d[k + 2] });
  return k <= d.length ? s : null;                   // (cut short: none)
}

function roomRequest(number, name = "", password = "", team = 0) {
  return new Writer(51).i16(number).i16(0).u8(0).cstr(name, 23).cstr(password, 13)
    .i16(team).i16(6).zeros(6).done();
}

export class Session extends EventTarget {
  constructor() {
    super();
    expectFilesPass();                     // the web-only characters' files wait for the channel's pass (0x8d3)
    this.screen = "login";
    this.conn = null;
    this.login = "";
    this.userId = 0;
    this.pass = null;                      // the sign-in's secret for joining a channel (signIn -> joinChannel)
    this.myId = 0;
    this.channels = [];
    this.channel = null;
    this.users = new Map();
    this.rooms = new Map();
    this.roomFilter = -1;                  // a channel of every mode: the lobby shows rooms of this one (-1 all)
    this.belts = [];
    this.chat = [];
    this.room = null;
    this.line = null;                      // the line I wait in for a room: {room, place (1 = next), of} (0x8c5)
    this.lineWas = -1;                     // (the room whose line I just left: its turn came if 0x3f7 takes me there)
    this.match = null;
    this.training = null;                  // a training being played (game/training.js): this page's alone
    this.keepalive = null;
    // guilds (the server's guilds.py): my guild's state ({guild, invites, requests, cost, max}), and the requests
    // waiting for their answer (0x4ba -> 0x8bb)
    this.guild = null;
    this.guildSeq = 0;
    this.guildWait = new Map();
    this.accountWait = new Map();          // the Account window's requests waiting (0x4be -> 0x8bf, myaccount.py)
    this.cashWait = new Map();             // the Get Cash window's requests waiting (0x4c0 -> 0x8c1, payments.py)
    this.reportWait = new Map();           // the Report window's requests waiting (0x4c8 -> 0x8d1, reports.py)
    this.superBroadcast = null;            // a game master's /superbroadcast scrolling now: {text, since, until} (0x8c3)
    this.banned = null;                    // a ban put me out (0x8cd): what the sign-in screen says when the connection ends
    this.gm = false;                       // a game master (0x3eb code 9): rooms' passwords are not asked
    this.countries = [];                   // the countries a player may be from (config.json, ISO 3166 codes)
  }

  changed(what) { this.dispatchEvent(new CustomEvent("change", { detail: what })); }

  setScreen(s) { this.screen = s; this.changed("screen"); }

  addChat(text, kind = 0, quiet = false) {
    if (kind === 1 && !quiet) this.dispatchEvent(new CustomEvent("announce", { detail: text }));   // a GM's /broadcast
    this.chat.push({ text, kind });
    if (this.chat.length > 200) this.chat.shift();
    this.changed("chat");
  }

  error(msg) { this.dispatchEvent(new CustomEvent("error", { detail: msg })); }

  // Belt for a total of points (the server's ranks.py): an index into this.belts, past the last number the last one
  beltOf(points) {
    const i = this.belts.findIndex(([top]) => points <= top);
    return i < 0 ? this.belts.length - 1 : i;
  }

  // ------------------------------------------------------------------ login server
  // The server's settings the page needs (config.json): before a sign-in, or before coming back to a match
  async loadConfig() {
    const cfg = await (await fetch("config.json")).json();
    this.cashUrl = cfg.cash_url || "";              // where players get Cash (the shop's "Get Cash"), if set
    this.payments = !!cfg.payments;                  // ... or Cash bought here, on Stripe's page (cash.js)
    this.belts = cfg.belts || [];                   // [[most points, UI_class.spr frame], ...] lowest first
    this.countries = cfg.countries || [];
    this.touchControls = !!cfg.touch_controls;       // on-screen controls in the match on touch screens (touch.js)
    setStartSpeed(cfg.start_speed);                   // the battle maps' speed at a round's start, by page
    this.walls = { on: true, middle_s: 30, ...cfg.walls };   // the HURRY UP blocks (room rule Walls)
    this.mapRates = cfg.map_rates || {};             // {"<game type>:<map>": [coins, points]}: maps that pay more
    this.trainingTiming = cfg.training || {};        // the server's match timings, for a training (training.js)
    this.devtools = cfg.devtools || "off";           // the inspect tools open: "kick", "report" or "off" (devtools.js)
    addCharacters(cfg.characters);                   // the web-only characters, before any avatar is read
    setHdPacks(cfg.hd_packs);                        // the game's characters with HD sheets
    return cfg;
  }

  async signIn(login, password) {
    const cfg = await this.loadConfig();
    const c = new Connection(cfg.login_port);
    await c.opened;
    await c.expect(0x426);
    // file checksums (the server only logs them)
    c.send(0x443, new Writer(45).u32(0x3380f7a4).zeros(33).u32(0x199267c0).u32(0xac934865).done());
    // BomberMan.exe's 80 bytes (login[32], password[28]: too short for an email), then the web client's own
    // (h_login.web_credentials): u8 0xE1, u8 n, the email or login, u8 m, the password, in UTF-8; then u8 0xE2, u8 k,
    // the device (h_login.web_device)
    const enc = new TextEncoder(), id = enc.encode(login).slice(0, 255), pw = enc.encode(password).slice(0, 255);
    const dev = enc.encode(deviceSignature()).slice(0, 100);
    const session = new Writer(92 + id.length + pw.length + dev.length).cstr(login, 32).cstr(password, 28)
      .bytes([0, 0, 0, 0x30]).zeros(16).u16(PROTOCOL_VERSION).u8(0xe1).u8(id.length).bytes(id).u8(pw.length).bytes(pw)
      .u8(0xe2).u8(dev.length).bytes(dev).done();
    c.send(0x456, session);
    const answer = await c.expect(0x405);
    const res = new Reader(answer);
    const code = res.i32(0);
    if (code !== 0) {
      c.close();
      if (code === BANNED) throw new Error(banText(answer, answer[145] === WEB_BAN ? 146 : answer.length));
      throw new Error(code === -1 ? t("Wrong email or password.") : code === -9
        ? t("Too many wrong passwords: wait 15 minutes and try again.") : code === SAME_COMPUTER ? t(ONE_A_COMPUTER)
          : t("Login refused (code {code}).", { code }));
    }
    this.login = login;
    this.userId = res.u32(4);
    // after the 145 bytes: u8 0xE3, u8 n, a secret the channel wants back in 0x55ea, once (h_login.ChannelPass)
    this.pass = answer[145] === 0xe3 ? answer.slice(147, 147 + answer[146]) : null;
    const lst = await c.expect(0x7e1);
    const r = new Reader(lst);
    const n = r.i16(0);
    const all = [];
    for (let i = 0; i < n; i++) {
      const o = 2 + i * 29;
      all.push({ id: lst[o], group: lst[o + 2] >> 2, name: r.cstr(o + 3, 15), port: r.i16(o + 0x16), load: r.i16(o + 0x1a) });
    }
    // a channel the .exe has no tab for (Drop Bomb) is listed twice: skip its Survival-tab twin on the same port
    this.channels = all.filter((c) => !all.some((o) => o.port === c.port && o.group > c.group));
    c.close();
    this.changed("channels");
    return this.channels;
  }

  // ------------------------------------------------------------------ game server (channel)
  // Join channel `ch` with the sign-in's pass, or (`back`: 0x8c7's secret) come back to the match this page's player
  // was in. Either way, a match of the account that is on takes this page (0x8c7 resumed): the server sends the room
  // and the match, there is no lobby.
  async joinChannel(ch, back = null) {
    const c = new Connection(ch.port);
    this.conn = c;
    this.channel = ch;
    c.addEventListener("message", (ev) => this.onMessage(ev.detail.id, ev.detail.data));
    c.addEventListener("close", (ev) => this.onClosed(c, ev.detail));
    try {
      await c.opened;
      await c.expect(0x426);
    } catch (e) {
      if (this.conn === c) this.conn = null;
      c.close();
      throw e;
    }
    // user id, version, "local address" (irrelevant for relayed play), then the sign-in's secret (another channel
    // needs another sign-in) or the secret to come back with, and: this page can come back to a match
    const join = new Writer(48).u32(this.userId).u16(PROTOCOL_VERSION)
      .u16(2).bytes([0x22, 0xa0]).bytes([127, 0, 0, 1]).zeros(8);
    if (back) join.u8(WEB_RESUME).u8(back.length).bytes(back);
    else if (this.pass) join.u8(0xe3).u8(this.pass.length).bytes(this.pass);
    join.u8(WEB_CAN_RESUME).u8(0);
    this.pass = null;
    c.send(0x55ea, join.done());
    let res;
    try {
      res = new Reader(await c.expect(0x3eb));
    } catch (e) {
      if (this.conn === c) this.conn = null;
      c.close();
      throw e;
    }
    this.myId = res.i32(2);
    this.gm = res.u16(0) === 9;                      // a game master (h_lobby.GM_LOGIN): rooms' passwords are not asked
    const keepMs = res.i32(6);
    if (this.myId <= 0) {                            // refused: -2, two sign-ins at once on one computer
      this.conn = null;
      c.close();
      const err = new Error(back ? t("Your match is over: sign in again.") : this.myId === -2 ? t(ONE_A_COMPUTER)
        : t("The channel refused the login. Sign in again."));
      err.gone = back && this.myId === GONE;
      throw err;
    }
    const tok = await c.expect(0x8c7, 3000).catch(() => null);   // (0x8c7: onMessage keeps the secret)
    const resumed = !!(tok && tok[tok[0] + 3]);
    clearInterval(this.keepalive);
    if (keepMs > 0) this.keepalive = setInterval(() => c.send(0x431), keepMs);
    if (resumed) {                                   // back in the match: the room and the match are on their way
      this.report({ back: true, via: back ? "secret" : "sign-in" });
      this.wallet = null;
      this.walletQuery();
      this.guildAsk("state");
      return;
    }
    this.report({ back: false });
    c.send(0x3ee);
    await c.expect(0x3ef);
    c.send(0x4b1);                 // hello: a web client (rooms without .exe players have 12 seats)
    this.wallet = null;
    this.walletQuery();
    this.guildAsk("state");
    this.enterLobby();
  }

  enterLobby() {
    rejoin.matchEnded();
    this.room = null;
    this.users.clear();
    this.rooms.clear();
    this.conn.send(0x40c, new Writer(4).u16(0).u16(2).done());
    this.pageRooms(2);
    this.setScreen("lobby");
  }

  // The channel's connection ended. In a match, the page tries to come back to it while the server keeps its place
  // (rejoin.js); else, or when that fails, it is back on the sign-in screen.
  onClosed(c, info) {
    if (c !== this.conn || this.reconnecting) return;
    clearInterval(this.keepalive);
    this.conn = null;
    const inMatch = !!this.match;
    if (this.match) this.match.onDisconnect();
    this.match = null;
    this.line = null;
    const banned = this.banned;                      // (put out by a ban: no coming back to the match)
    this.banned = null;
    if (banned) { this.disconnected(banned); return; }
    if (inMatch) rejoin.socketLost(info);
    const back = inMatch && rejoin.comeBack();
    if (back) { this.reconnect(back); return; }
    this.disconnected();
  }

  disconnected(msg = t("Disconnected from the server.")) {
    rejoin.matchEnded();
    this.error(msg);
    this.setScreen("login");
  }

  // Come back to the match of record `rec` (rejoin.comeBack) on a new connection, again every RETRY_MS while the
  // server waits; event "reconnecting" true while it tries
  async reconnect(rec) {
    this.reconnecting = true;
    this.dispatchEvent(new CustomEvent("reconnecting", { detail: true }));
    let gone = false, cur = rec;
    try {
      while (!gone && cur) {
        try {
          await this.joinChannel(cur.ch, rejoin.fromHex(cur.token));
          return;
        } catch (e) {
          gone = !!e.gone;
          if (!gone) await new Promise((r) => setTimeout(r, RETRY_MS));
          cur = rejoin.comeBack();                   // (the latest secret, while the server still waits)
        }
      }
    } finally {
      this.reconnecting = false;
      this.dispatchEvent(new CustomEvent("reconnecting", { detail: false }));
    }
    this.disconnected(gone ? t("Your match is over: sign in again.") : t("Disconnected from the server."));
  }

  // A page loaded in a tab whose match is still on (rejoin.comeBack: a reload): back into it without a sign-in
  async resume(rec) {
    await this.loadConfig();
    this.login = rec.login || "";
    this.userId = rec.u;
    this.channels = [rec.ch];
    this.reconnecting = true;                        // (a failed try is not "Disconnected")
    try {
      await this.joinChannel(rec.ch, rejoin.fromHex(rec.token));
    } catch (e) {
      rejoin.matchEnded();
      throw e;
    } finally {
      this.reconnecting = false;
    }
  }

  // What the page knows of how its last match ended (rejoin.js), once, for the server's log (0x4c6)
  report(extra) {
    const rep = rejoin.takeReport(extra);
    if (rep && this.conn) this.conn.send(0x4c6, new TextEncoder().encode(rep));
  }
  // The browser's inspect tools are open on this page (devtools.js), for the server's log and Suspects (0x4ca)
  devtoolsOpen() { if (this.conn) this.conn.send(0x4ca, new Uint8Array([1])); }

  // Characters this page learnt of late (the shop's catalogue: hidden ones it may see, bmoserver/hidden.py): the
  // players' looks again from their avatars
  relook() {
    for (const e of [...this.users.values(), ...(this.room ? this.room.players.values() : [])]) {
      if (e.avatar) Object.assign(e, avatarFields(e.avatar));
    }
    if (this.outfit && this.outfit.char) this.outfit.look = CHARACTERS.findIndex((c) => c[3] === this.outfit.char);
    this.changed("lobby");
    if (this.room) this.changed("room");
    if (this.outfit) this.changed("outfit");
  }

  logout() {
    if (this.conn) { const c = this.conn; this.conn = null; c.close(); }
    this.line = null;
    clearInterval(this.keepalive);
    rejoin.matchEnded();
    rejoin.forget();
    this.setScreen("login");
  }

  // ------------------------------------------------------------------ requests
  pageUsers(dir) { this.conn.send(0x40c, new Writer(4).u16(0).u16(dir).done()); }
  pageRooms(dir) {                       // (a channel of every mode: then the mode shown + 1, 0 = all of them)
    const w = this.allModes() ? new Writer(5).u16(4).u16(dir).u8(this.roomFilter + 1) : new Writer(4).u16(4).u16(dir);
    this.conn.send(0x40c, w.done());
  }
  sendChat(text) {
    const b = encodeChat(text.slice(0, 70));
    this.conn.send(this.room ? 0x3fe : 0x3f0, new Writer(b.length + 1).bytes(b).u8(0).done());
  }
  createRoom(name, password, mode = 0) {   // (team battle: the room's Mode setting)
    const req = roomRequest(0, name, password, 1);
    if (!this.allModes()) return this.conn.send(0x3f4, req);
    const withMode = new Uint8Array(req.length + 1);       // a channel of every mode: the room's after the 51 bytes
    withMode.set(req);
    withMode[req.length] = mode;
    this.conn.send(0x3f4, withMode);
  }
  joinRoom(number, password = "") { this.conn.send(0x3f6, roomRequest(number, "", password)); }
  // the line for a room that is playing or full (0x4c4 -> 0x8c5; at once into it if it has a seat now)
  waitInLine(number, password = "") { this.conn.send(0x4c4, new Writer(15).i16(number).cstr(password, 13).done()); }
  leaveLine() { this.conn.send(0x4c4, new Writer(2).i16(-1).done()); }
  leaveRoom() { this.conn.send(0x3f8); }

  kick(id) { this.conn.send(0x408, new Writer(4).i32(id).done()); }   // the host removes a player or bot
  toggleSlot(slot) { this.conn.send(0x40e, new Writer(4).i32(slot).done()); } // the host closes / opens an empty seat
  setCard(id) { this.conn.send(0x4b5, new Writer(4).u32(id).done()); } // the room card's background -> 0x8b7
  setBomb(id) { this.conn.send(0x4b9, new Writer(4).u32(id).done()); } // my bomb skin (0: the game's) -> 0x8b7
  profileQuery(id) { this.conn.send(0x4b8, new Writer(4).i32(id).done()); } // a player's results by mode -> 0x8b9
  cardQuery(id) { this.conn.send(0x4c2, new Writer(4).i32(id).done()); }    // a player's card (the lobby's profile) -> 0x8c4
  rankingQuery(mode) { this.conn.send(0x4bc, new Uint8Array([mode])); }      // a mode's ranking (ranks.py) -> 0x8bd

  me() { return this.room && this.room.players.get(this.myId); }
  teamMode() { return !!(this.room && this.room.info && this.room.info.team); }
  isHost() { return this.room && this.room.hostId === this.myId; }

  setInfo({ char, map, team } = {}) {
    const e = this.me();
    if (!e) return;
    const w = new Writer(8).i16(this.myId).i16(char ?? e.char).i16(map ?? this.room.map).i16(team ?? e.team).done();
    this.conn.send(0x402, w);
  }

  // the room's mode: its own in a channel of every mode, else the channel's
  roomMode() {
    const own = this.room && this.room.info ? this.room.info.mode : -1;
    return own >= 0 ? own : this.channel && this.channel.group !== GROUP_ALL ? this.channel.group : 0;
  }
  // the game played here (a guild battle plays Survival's)
  gameType() { const m = this.roomMode(); return m === GROUP_GUILD ? 0 : m; }
  guildRoom() { return this.roomMode() === GROUP_GUILD; }
  allModes() { return !!this.channel && this.channel.group === GROUP_ALL; }

  // FUN_0043e690: the host client keeps the rules legal (after 0x7df and every 0x7e0, and on the host's own change).
  // BomberMan.exe forces Panel Attack rooms to {0, 0, 0, 0, 0} and Hyper Bomb rooms to {0, 2, 0, 0, 0}; here their
  // host picks the time limit and the start points (one round, no walls, no carts). Boss Battle: stages 1 or 3, fixed
  // starts, no carts (the server keeps it so). Survival: no revenge carts on the Soccer maps. (The exe also keeps
  // rule +6, Walls, off on the Basic and Soccer maps; here it is up to the host on every map.)
  legalRules(rules) {
    const r = rules.slice(), m = this.room.map, game = this.gameType();
    if (game === GROUP_HYPER || game === GROUP_PANEL) r[0] = r[3] = r[4] = 0;
    else if (game === GROUP_BOSS) { r[0] = r[0] === 3 ? 3 : 1; r[2] = 1; r[4] = 0; }
    else if (m === 8 || m === 17 || m === 26) r[4] = 0;
    return r;
  }

  hostRules() {
    if (!this.isHost()) return;
    const r = this.room.rules, ok = this.legalRules(r);
    if (ok.some((v, i) => r[i] !== v)) this.setRules(ok);
  }

  setRules(rules) { this.conn.send(0x41f, new Writer(10).i16(rules[0]).i16(rules[1]).i16(rules[2]).i16(rules[3]).i16(rules[4]).done()); }

  setItems(mask) { this.conn.send(0x4b0, new Writer(2).u16(mask).done()); }

  // The 0x8b5 arena of this round (a room of more than 6), if the server sent one for this map and variant
  layoutFor(mapSet, variant) {
    const l = this.layout;
    return l && l.map === mapSet && l.variant === variant ? l.record : null;
  }

  // show character `look` (refused unless owned); 0x8b2 then tells which one the account shows
  setLook(look) {
    this.conn.send(0x4b2, new Writer(4).u32(CHARACTERS[look][3]).done());
    this.getOutfit();
  }

  // Shop and wallet (server extension 0x4b7 / 0x8b7, economy.py): Bomber Coins, Cash and the items owned
  walletQuery() { this.conn.send(0x4b7, new Uint8Array([0])); }

  // A guild request (guilds.py: {op, ...}) -> its answer ({done, ...} or {error}); the server sends my guild's state
  // again by itself when it changes
  // The player's own account (myaccount.py): {op, ...} -> its answer ({account}, {done}, or {error, field})
  accountAsk(op, args = {}) {
    const id = ++this.guildSeq;
    this.conn.send(0x4be, new TextEncoder().encode(JSON.stringify({ ...args, op, id })));
    return new Promise((resolve) => {
      this.accountWait.set(id, resolve);
      setTimeout(() => { if (this.accountWait.delete(id)) resolve({ error: t("The server did not answer.") }); }, 10000);
    });
  }

  // A report of a player for the game masters (reports.py): {player, nick, reason, text} -> {done} or {error, field}
  reportAsk(args) {
    const id = ++this.guildSeq;
    this.conn.send(0x4c8, new TextEncoder().encode(JSON.stringify({ ...args, op: "report", id })));
    return new Promise((resolve) => {
      this.reportWait.set(id, resolve);
      setTimeout(() => { if (this.reportWait.delete(id)) resolve({ error: t("The server did not answer.") }); }, 10000);
    });
  }

  // Cash bought with real money (payments.py): {op, ...} -> its answer ({packs}, {order, url}, {order} or {error});
  // the server tells by itself when an order is paid (event "cashpaid")
  cashAsk(op, args = {}) {
    const id = ++this.guildSeq;
    this.conn.send(0x4c0, new TextEncoder().encode(JSON.stringify({ ...args, op, id })));
    return new Promise((resolve) => {
      this.cashWait.set(id, resolve);
      setTimeout(() => { if (this.cashWait.delete(id)) resolve({ error: t("The server did not answer.") }); }, 30000);
    });
  }

  guildAsk(op, args = {}) {
    const id = ++this.guildSeq;
    this.conn.send(0x4ba, new TextEncoder().encode(JSON.stringify({ ...args, op, id })));
    return new Promise((resolve) => {
      this.guildWait.set(id, resolve);
      setTimeout(() => { if (this.guildWait.delete(id)) resolve({ error: t("The server did not answer.") }); }, 10000);
    });
  }
  buyItems(ids) {                                  // all of them or none
    const w = new Writer(2 + 4 * ids.length).u8(1).u8(ids.length);
    for (const id of ids) w.u32(id);
    this.conn.send(0x4b7, w.done());
  }

  // Boss Battle items (server extension 0x4b6 / 0x8b6, boss_items.py): Mission Coins, buying (the shop), the slots
  bossShopQuery() { this.conn.send(0x4b6, new Uint8Array([0])); }
  buyBossItem(id, n = 1) { this.conn.send(0x4b6, new Writer(4).u8(1).u16(id).u8(n).done()); }
  setBossSlots(slots) {
    const w = new Writer(9).u8(2);
    for (let k = 0; k < 4; k++) w.u16(slots[k] || 0);
    this.conn.send(0x4b6, w.done());
  }

  // 3D outfit (the lobby's shop): body, face, up to 8 items; the answer is 0x8b2
  getOutfit() { this.conn.send(0x4b4); }
  wearOutfit(o) {
    const w = new Writer(40).u32(o.body).u32(o.face);
    for (let i = 0; i < 8; i++) w.u32(o.items[i] || 0);
    this.conn.send(0x4b3, w.done());
  }

  readyOrStart() {
    const e = this.me();
    if (!e) return;
    this.conn.send(0x3fa, new Writer(8).i16(this.myId).i16(e.char).i16(this.room.map).i16(e.team).done());
  }

  // ------------------------------------------------------------------ incoming
  onMessage(id, d) {
    const r = new Reader(d);
    if (this.match && !this.match.stopped && this.match.onMessage(id, d)) return;   // (a match left: none)
    switch (id) {
      // lobby lists
      case 0x40d: {
        const kind = r.i32(0);
        if (kind === 0) this.users.clear();
        else if (kind > 0) this.rooms.clear();
        this.changed("lobby");
        break;
      }
      case 0x7d1: case 0x7d2: {
        const u = parseUser(d);
        for (const [k, v] of this.users) if (v.nick === u.nick && k !== u.id) this.users.delete(k);
        this.users.set(u.id, u);                     // (an update keeps its place: the pages do not shuffle)
        this.changed("lobby");
        break;
      }
      case 0x7d3: this.users.delete(r.i32(0)); this.changed("lobby"); break;
      case 0x7d4: case 0x7d5: case 0x7dd: {
        const room = parseRoom(d);
        if (id === 0x7dd && !this.rooms.has(room.number)) break;
        this.rooms.set(room.number, room);
        this.changed("lobby");
        break;
      }
      case 0x7e7: {
        const room = this.rooms.get(r.i16(0));
        if (room && room.members.length < room.count) room.members.push({ cls: r.i16(2), nick: r.cstr(6, 17) });
        this.changed("lobby");
        break;
      }
      case 0x7d6: this.rooms.delete(r.i32(0)); this.changed("lobby"); break;
      case 0x7ed: {
        const room = this.rooms.get(r.i16(0));
        if (room) room.name = r.cstr(2, 23);
        if (this.room && this.room.number === r.i16(0)) this.room.info.name = r.cstr(2, 23);
        this.changed(this.room ? "room" : "lobby");
        break;
      }
      // chat
      case 0x3f1: case 0x3ff: this.addChat(r.chat(0, d.length)); break;
      case 0x7e6: this.addChat(r.chat(2, d.length - 2), r.i16(0)); break;
      case 0x437: this.addChat(t("You are muted for {n} minutes.", { n: r.i16(0) }), 4); break;
      // rooms
      case 0x3f5: case 0x3f7: {
        const code = r.i32(0);
        if (code < 0) {
          this.lineWas = -1;
          this.error({ [-1]: t("That room no longer exists."), [-2]: t("That room is already playing."),
            [-3]: t("That room is full."), [-4]: t("Wrong room password."),
            [-5]: id === 0x3f5 ? t("Join a guild first: guild battles are between guilds.")      // (the chat says more)
              : t("That guild battle has no seat for your guild."),
            [-6]: t("The room's name has a word that is not allowed here: pick another.") }[code] ||   // (the chat: which)
            t("Could not enter the room ({code}).", { code }));
          break;
        }
        this.room = { number: code, info: null, rules: [2, 1, 0, 0, 0], players: new Map(), hostId: 0, map: 0,
          items: ALL_ITEMS };
        this.chat = [];
        if (code === this.lineWas) this.addChat(t("Your turn in the line: you are in room {n}.", { n: code + 1 }), 4);
        this.lineWas = -1;
        this.layout = null;
        this.conn.send(0x4b1);                       // which items drop here (answered by 0x8b0)
        break;
      }
      case 0x8b0: if (this.room) { this.room.items = r.u16(0); this.changed("room"); } break;
      case 0x8c5: {                                  // my place in a room's line, or none (C_room §5.11)
        const n = r.i16(0);
        this.lineWas = n < 0 && this.line ? this.line.room : -1;
        this.line = n < 0 ? null : { room: n, place: d[2], of: d[3] };
        this.changed("line");
        break;
      }
      case 0x8b6: {     // Boss Battle items: u32 Mission Coins, n x {u16 id, u16 price, u16 owned}, 4 slots, u8 result, u16 id
        const n = d[4], items = [];
        for (let i = 0; i < n; i++) items.push({ id: r.u16(5 + 6 * i), price: r.u16(7 + 6 * i), owned: r.u16(9 + 6 * i) });
        const slots = [], o = 5 + 6 * n;
        for (let k = 0; k < 4; k++) slots.push(r.u16(o + 2 * k));
        this.bossShop = { mission: r.u32(0), items, slots };
        if (this.wallet) this.wallet.mission = this.bossShop.mission;
        this.changed("wallet");
        this.changed("room");
        if (d[o + 8]) this.dispatchEvent(new CustomEvent("shop", { detail: { result: d[o + 8], item: r.u16(o + 9) } }));
        break;
      }
      case 0x8b7: {         // my wallet: u8 result, u32 item, u32 coins, u32 cash, u32 mission, u16 n, n x u32 owned
        const owned = new Set(), n = r.u16(17);
        for (let i = 0; i < n; i++) owned.add(r.u32(19 + 4 * i));
        // then the card background and the bomb skin used (economy.cards / economy.bombs, 0: the default)
        this.wallet = { coins: r.u32(5), cash: r.u32(9), mission: r.u32(13), owned, card: r.u32(19 + 4 * n),
          bomb: d.length >= 27 + 4 * n ? r.u32(23 + 4 * n) : 0 };
        if (this.bossShop) this.bossShop.mission = this.wallet.mission;
        this.changed("wallet");
        if (d[0]) this.dispatchEvent(new CustomEvent("shop", { detail: { result: d[0], item: r.u32(1) } }));
        break;
      }
      case 0x8bb: {         // guilds (guilds.py): JSON, an answer ({t: "reply", id}) or my guild's state ({t: "state"})
        let msg;
        try { msg = JSON.parse(new TextDecoder().decode(d)); } catch (e) { break; }
        if (msg.t === "state" || (msg.t === "reply" && msg.op === "state" && !msg.error)) {
          this.guild = msg;
          this.changed("guild");
        }
        const done = msg.t === "reply" && this.guildWait.get(msg.id);
        if (done) { this.guildWait.delete(msg.id); done(msg); }
        break;
      }
      case 0x8bf: {         // my account (myaccount.py): JSON, the answer to a request
        let msg;
        try { msg = JSON.parse(new TextDecoder().decode(d)); } catch (e) { break; }
        const done = this.accountWait.get(msg.id);
        if (done) { this.accountWait.delete(msg.id); done(msg); }
        break;
      }
      case 0x8d1: {         // a report of a player (reports.py): JSON, the answer to a request
        let msg;
        try { msg = JSON.parse(new TextDecoder().decode(d)); } catch (e) { break; }
        const done = this.reportWait.get(msg.id);
        if (done) { this.reportWait.delete(msg.id); done(msg); }
        break;
      }
      case 0x8c3: {         // a game master's /superbroadcast (h_lobby.broadcast_command): JSON {text, s}
        let msg;
        try { msg = JSON.parse(new TextDecoder().decode(d)); } catch (e) { break; }
        const now = performance.now();
        this.superBroadcast = { text: String(msg.text || ""), since: now, until: now + (Number(msg.s) || 30) * 1000 };
        this.addChat(this.superBroadcast.text, 1, true);  // (kept in the chat too; the band is the notice)
        this.dispatchEvent(new CustomEvent("superbroadcast", { detail: this.superBroadcast }));
        break;
      }
      case 0x8c1: {         // Cash bought (payments.py): JSON, the answer to a request, or {t "paid", order}
        let msg;
        try { msg = JSON.parse(new TextDecoder().decode(d)); } catch (e) { break; }
        if (msg.t === "paid") { this.dispatchEvent(new CustomEvent("cashpaid", { detail: msg.order })); break; }
        const done = this.cashWait.get(msg.id);
        if (done) { this.cashWait.delete(msg.id); done(msg); }
        break;
      }
      case 0x8bd: {         // a mode's ranking (ranks.leaders): JSON {mode, rows, total, me}
        let msg;
        try { msg = JSON.parse(new TextDecoder().decode(d)); } catch (e) { break; }
        this.dispatchEvent(new CustomEvent("ranking", { detail: msg }));
        break;
      }
      case 0x8c4: {         // a player's card: i32 id, then their entry, avatar and picture as in 0x7d8 (none: gone)
        const player = d.length >= 104 ? parseEntry(d.slice(4)) : null;
        this.dispatchEvent(new CustomEvent("card", { detail: { id: r.i32(0), player } }));
        break;
      }
      case 0x8b9: {         // a player's results by mode: i32 id, u8 n, n x {u8 game type, u32 wins, u32 losses}
        const modes = {};
        for (let i = 0, o = 5; i < d[4]; i++, o += 9) modes[d[o]] = [r.u32(o + 1), r.u32(o + 5)];
        this.dispatchEvent(new CustomEvent("profile", { detail: { id: r.i32(0), modes } }));
        break;
      }
      case 0x8b5: {                                  // the next round's arena (a room of 12): size, starts, layout
        const n = d[4], spawns = [];
        for (let i = 0; i < n; i++) spawns.push([d[5 + 2 * i], d[6 + 2 * i]]);
        this.layout = { map: d[0], variant: d[1], w: d[2], h: d[3], spawns, record: d.slice(5 + 2 * n) };
        break;
      }
      case 0x8b2: {                                  // my saved 3D outfit, whether I wear it now, else my character
        const items = [];
        for (let i = 0; i < 8; i++) if (r.u32(9 + 4 * i)) items.push(r.u32(9 + 4 * i));
        const char = d.length >= 45 ? r.u32(41) : 0, look = char ? CHARACTERS.findIndex((c) => c[3] === char) : -1;
        this.outfit = { wearing: d[0] === 1, body: r.u32(1), face: r.u32(5), items, look, char };
        this.changed("outfit");
        break;
      }
      case 0x8b1: {                                  // a player picked another character (server extension)
        const e = this.room && this.room.players.get(r.i32(0));
        if (e) { Object.assign(e, avatarFields(d.slice(4, 56))); this.changed("room"); }
        break;
      }
      case 0x7e5:
        if (this.room) {
          const first = !this.room.info;
          this.room.info = parseRoom(d);
          if (first && this.gameType() === GROUP_BOSS) this.bossShopQuery();   // the purse and the item slots (0x8b6)
          this.changed("room");
        }
        break;
      case 0x7ee:
        if (this.room) {
          this.room.rules = [0, 2, 4, 6, 8].map((o) => r.i16(o));
          this.changed("room");
        }
        break;
      case 0x7d8: case 0x7db: case 0x7de: case 0x7e0: {
        if (!this.room) break;
        const e = parseEntry(d), old = this.room.players.get(e.id);
        if (e.look === undefined) Object.assign(e, old ? { look: old.look, avatar: old.avatar, outfit: old.outfit } : { look: -1, outfit: null });
        if (e.picture === undefined && old) Object.assign(e, { userId: old.userId, picture: old.picture, country: old.country });
        this.room.players.set(e.id, e);
        if (e.id === this.room.hostId) this.room.map = e.map;
        if (id === 0x7d8 && e.id === this.myId) this.setScreen("room");
        if (id === 0x7e0) this.hostRules();
        this.changed("room");
        break;
      }
      case 0x7d9: case 0x7e2: {
        if (!this.room) break;
        const pid = r.i32(0);
        if (pid === this.myId && id === 0x7e2) {
          this.addChat(t("You were kicked from the room."), 4);
          this.room = null;
          this.enterLobby();
          break;
        }
        this.room.players.delete(pid);
        this.changed("room");
        break;
      }
      case 0x7df: {
        if (!this.room) break;
        this.room.hostId = r.i32(0);
        const host = this.room.players.get(this.room.hostId);
        if (host) this.room.map = host.map;
        if (this.isHost()) {
          this.setInfo({});
          this.hostRules();
        }
        this.changed("room");
        break;
      }
      case 0x3f9:                                    // back in the lobby (a room or a match left): its music
        music("BKSND1");
        this.match = null;                           // (its system lines are the lobby's now)
        this.room = null;
        this.chat = [];
        this.layout = null;
        this.enterLobby();
        break;
      case 0x7e4: this.error(r.i32(0) === -2 ? t("Teams must have the same number of players.") : t("Cannot start the match yet.")); break;
      case 0x403: this.changed("room"); break;
      case 0x7dc:                                    // a match: what follows waits for it (Match.start releases)
        this.conn.hold();
        rejoin.matchStarted();
        this.dispatchEvent(new CustomEvent("gamestart", { detail: d }));
        break;
      case 0x8d3: setFilesPass(d.slice(1, 1 + d[0])); break;   // the pass to the players' files (filepass.py)
      case 0x8c7: {                                  // the secret to come back to a match with (rejoin.py)
        const n = d[0];
        rejoin.setToken({ u: this.userId, login: this.login, ch: this.channel, token: rejoin.toHex(d.slice(1, 1 + n)),
          s: r.u16(1 + n) });
        break;
      }
      case 0x8c9: {                                  // back in a match: where it is (before its 0x7dc)
        const players = new Map();
        for (let i = 0; i < d[3]; i++) players.set(r.i16(4 + 4 * i), { won: d[6 + 4 * i], here: !!d[7 + 4 * i] });
        this.rejoinState = { late: d[0] === 1, map: d[1], variant: d[2], players, snapshot: parseSnapshot(d, 4 + 4 * d[3]) };
        break;
      }
      case 0x401:                                    // back in the room after a match: its music
        rejoin.matchEnded();
        music("BKSND2");
        this.conn.gameMode = false;
        this.match = null;
        this.layout = null;
        this.setScreen("room");
        if (this.gameType() === GROUP_BOSS) this.bossShopQuery();   // the coins found are in the purse now
        this.walletQuery();                          // ... and the match's coins
        break;
      case 0x436: this.error(t("The server closed your session.")); break;
      case 0x8cd: this.banned = banText(d, 0); break;    // a ban puts me out (bans.py): the connection ends next
      case 0x8cf:                                    // watching this room (a game master, watch.py): no seat
        if (this.room && this.room.number === r.i16(0)) {
          this.room.watch = true;
          this.setScreen("room");
        }
        break;
      default:
        if (![0x420, 0x40f, 0x3eb, 0x3ef, 0x426, 0x7ef, 0x405].includes(id)) console.debug("unhandled", hex(id), d);
    }
  }
}
