// Countries (the server's register.COUNTRIES: ISO 3166 codes such as "BR"): their names and their flags. A flag is its
// pair of regional indicator letters, drawn with the "Twemoji Country Flags" font (web/fonts, app.css .flag) so that
// every browser shows the same flag (Windows has no flag emoji of its own).

import { t, locale } from "./i18n.js";

const named = new Map();                   // the page's language -> its country names (Intl.DisplayNames)
function names() {
  const l = locale();
  if (!named.has(l)) {
    let n = null;
    try { n = new Intl.DisplayNames([l, "en"], { type: "region" }); } catch (e) { /* an old browser: the codes */ }
    named.set(l, n);
  }
  return named.get(l);
}

// a country's name, in the page's language
export function countryName(code) {
  try { return (names() && names().of(code)) || code; } catch (e) { return code; }
}

export function flagText(code) {
  return /^[A-Z]{2}$/.test(code || "") ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
}

// a small flag (a span), or null without a country
export function flag(code) {
  const text = flagText(code);
  if (!text) return null;
  const s = document.createElement("span");
  s.className = "flag";
  s.textContent = text;
  s.title = countryName(code);
  s.setAttribute("role", "img");
  s.setAttribute("aria-label", s.title);
  return s;
}

// <option>s of the codes, by name: a first one asking to choose, then each with its flag
export function countryOptions(codes, chosen = "") {
  const first = document.createElement("option");
  first.value = "";
  first.textContent = t("Choose…");
  return [first, ...codes.map((c) => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1], locale())).map(([c, n]) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = `${flagText(c)} ${n}`;
    o.selected = c === chosen;
    return o;
  })];
}
