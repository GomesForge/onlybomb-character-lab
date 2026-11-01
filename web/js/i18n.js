// The page's language: English (what the code and index.html are written in) or a translation of it, picked on the
// sign-in screen or in Options and kept in this browser. A translation (web/i18n/<code>.json) gives each text by its
// English; a text it lacks stays English, so a missing or broken one never stops a screen. Only the page's own words
// change: what players write (nicknames, chat, room and guild names), what the server sends and the game's own
// pictures (the .spr texts of a match) stay as they are, and nothing the game sends or compares is translated.
//
// t("Create room"); t("Remove {nick} from the room?", { nick }): the values go in after the translation, as they are.
// A word that means two things in English has a context before a "|": t("item|Kick") is the item, "Kick" without a
// translation of its own.
// index.html's texts (and its placeholder, title and aria-label attributes) are translated where they are, keeping their
// English to switch again; what the code makes is made again when the language changes (onLanguage).

export const LANGUAGES = [["en", "English"], ["pt", "Português (Brasil)"], ["es", "Español"]];
const LOCALES = { en: "en-US", pt: "pt-BR", es: "es-ES" };
const KEY = "bmo.lang";
const ATTRS = ["placeholder", "title", "aria-label"];
const LOAD_MS = 5000;

let lang = "en";
let dict = null;                          // the translation: English -> text
const listeners = [];
let statics = null;                       // index.html's texts and attributes, with their English

export const language = () => lang;
export const locale = () => LOCALES[lang];

const has = (k) => !!dict && typeof dict[k] === "string" && dict[k] !== "";

export function t(text, vars) {
  let s = String(text);
  if (has(s)) s = dict[s];
  else {
    const c = /^[a-z]+\|/.exec(s);                // a context: the word alone
    if (c) s = has(s.slice(c[0].length)) ? dict[s.slice(c[0].length)] : s.slice(c[0].length);
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// a number as this language writes it (1,500 / 1.500)
export const num = (n) => Number(n || 0).toLocaleString(locale());

// a constant's text, as it is: t() translates it where it shows (and tests/test_i18n.py finds it here)
export const N_ = (text) => text;

export function onLanguage(f) { listeners.push(f); }

// index.html's own texts, once: [text node, English, space before, space after], [element, attribute, English]
function collect() {
  statics = { texts: [], attrs: [] };
  const skip = (e) => !e || e.closest("script, style, [translate=no]");
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const v = n.nodeValue, en = v.replace(/\s+/g, " ").trim();
    if (/\p{L}/u.test(en) && !skip(n.parentElement)) statics.texts.push([n, en, /^\s/.test(v) ? " " : "", /\s$/.test(v) ? " " : ""]);
  }
  for (const e of document.body.querySelectorAll("[placeholder], [title], [aria-label]")) {
    if (skip(e)) continue;
    for (const a of ATTRS) if (e.hasAttribute(a)) statics.attrs.push([e, a, e.getAttribute(a)]);
  }
}

function applyStatic() {
  for (const [n, en, before, after] of statics.texts) n.nodeValue = before + t(en) + after;
  for (const [e, a, en] of statics.attrs) e.setAttribute(a, t(en));
}

async function load(code) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), LOAD_MS);
  try {
    const r = await fetch(`i18n/${code}.json`, { cache: "no-cache", signal: stop.signal });
    const d = r.ok ? await r.json() : null;
    return d && typeof d === "object" && !Array.isArray(d) ? d : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// the language to show (one of LANGUAGES); English if its translation does not load. Resolves to the one shown.
export async function setLanguage(code, keep = true) {
  if (!LANGUAGES.some(([c]) => c === code)) code = "en";
  const next = code === "en" ? null : await load(code);
  if (!next) code = "en";
  lang = code;
  dict = next;
  if (keep) try { localStorage.setItem(KEY, code); } catch (e) { /* private mode */ }
  document.documentElement.lang = locale().replace("-US", "").replace("-ES", "");
  applyStatic();
  for (const f of listeners) {
    try { f(code); } catch (e) { console.error(e); }
  }
  return code;
}

// at the start: the language this browser had (before the other modules make their texts)
collect();
let saved = null;
try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
if (saved && saved !== "en") await setLanguage(saved, false);
