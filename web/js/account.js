// The lobby's Account window (the server's myaccount.py): the player's own account. The email, the nickname and the
// country stay as they are (an account of before without a country picks it once); the sex, the year of birth, the
// picture and the password can change.

import { pictureUrl } from "./session.js";
import { flag, countryName, countryOptions } from "./country.js";
import { ask } from "./ask.js";
import { t, locale, onLanguage } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const dlg = $("dlg-account");
const PIC = 128;                      // a picture is cut to its middle square and scaled to this, here

let session = null, toast = null;
let account = null;

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

export function initAccount(s, toastFn) {
  session = s;
  toast = toastFn;
  $("lobby-account").onclick = open;
  onLanguage(() => { if (dlg.open && account) render(); });
}

async function open() {
  account = null;
  $("account-body").replaceChildren(el("p", { class: "muted" }, t("Loading…")));
  if (!dlg.open) dlg.showModal();
  const r = await session.accountAsk("get");
  if (r.error) { $("account-body").replaceChildren(el("p", { class: "form-error" }, t(r.error))); return; }
  account = r.account;
  render();
}

// a request; its error in `box` (and the field it is about lit), else `done` as a toast
async function act(op, args, box, done) {
  box.textContent = "";
  box.hidden = true;
  for (const x of dlg.querySelectorAll(".bad-field")) x.classList.remove("bad-field");
  const r = await session.accountAsk(op, args);
  if (r.error) {
    box.textContent = t(r.error);
    box.hidden = false;
    const f = r.field && dlg.querySelector(`[data-field="${r.field}"]`);
    if (f) { f.classList.add("bad-field"); if (f.focus) f.focus(); }
    return null;
  }
  if (r.account) account = r.account;
  if (done) toast(done, true);
  return r;
}

function render() {
  const a = account;
  const fixed = (label, value, why = t("Can't be changed")) => [el("dt", {}, label),
    el("dd", {}, value, el("small", { class: "muted lock" }, why))];

  // picture
  const url = pictureUrl({ userId: a.user_id, picture: a.picture });
  const pic = url ? el("img", { class: "acc-pic", src: url, alt: t("Your picture") })
    : el("div", { class: "acc-pic none", "aria-label": t("No picture") }, (a.nick || "?").slice(0, 1).toUpperCase());
  const picError = el("p", { class: "form-error", role: "alert", hidden: true });
  const file = el("input", { type: "file", accept: "image/*", hidden: true, onchange: async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    let data;
    try { data = await squarePicture(f); } catch (e) { picError.textContent = e.message; picError.hidden = false; return; }
    if (await act("picture", { picture: data }, picError, t("Picture saved. Players see it from the next room."))) render();
  } });

  // country: for good; an account of before without one picks it once
  let country;
  if (a.country) country = fixed(t("Country"), [flag(a.country), " ", countryName(a.country)]);
  else {
    country = [el("dt", {}, t("Country")), el("dd", {},
      el("select", { id: "acc-country", "data-field": "country" }, countryOptions(session.countries)),
      el("small", { class: "muted" }, t("Choose it once: it can't be changed after.")))];
  }

  // sex and year of birth
  const y = new Date().getFullYear();
  const years = el("select", { id: "acc-year", "data-field": "birth_year" }, el("option", { value: "" }, t("Choose…")),
    Array.from({ length: 98 }, (_, i) => el("option", { value: String(y - 3 - i), selected: a.birth_year === y - 3 - i }, String(y - 3 - i))));
  const sex = el("fieldset", { class: "choice", "data-field": "sex" }, el("legend", {}, t("Sex")),
    ["female", "male"].map((v) => el("label", {}, el("input", { type: "radio", name: "acc-sex", value: v, checked: a.sex === v }),
      " ", v === "female" ? t("Female") : t("Male"))));
  const saveError = el("p", { class: "form-error", role: "alert", hidden: true });
  const save = el("button", { type: "button", class: "primary", onclick: async () => {
    const s = dlg.querySelector("input[name=acc-sex]:checked");
    const c = $("acc-country");
    if (c && c.value && !await ask({ title: t("Your country"), yes: t("Save"), text: t("Your country can't be changed after. Is it right?"),
      body: el("div", { class: "ask-big" }, flag(c.value), " ", countryName(c.value)) })) return;
    save.disabled = true;
    if (await act("save", { sex: s ? s.value : null, birth_year: +years.value || null, country: c ? c.value : "" },
      saveError, t("Saved."))) render();
    save.disabled = false;
  } }, t("Save changes"));

  // password
  const pw = (id, field, auto) => el("input", { id, type: "password", maxlength: 64, autocomplete: auto, "data-field": field });
  const old = pw("acc-pw-old", "old", "current-password"), neu = pw("acc-pw-new", "new", "new-password");
  const again = pw("acc-pw-again", "again", "new-password");
  const pwError = el("p", { class: "form-error", role: "alert", hidden: true });
  const change = el("button", { type: "button", onclick: async () => {
    if (neu.value !== again.value) {
      pwError.textContent = t("The two new passwords are not the same.");
      pwError.hidden = false;
      again.classList.add("bad-field");
      return;
    }
    change.disabled = true;
    if (await act("password", { old: old.value, new: neu.value }, pwError, t("Password changed."))) {
      old.value = neu.value = again.value = "";
    }
    change.disabled = false;
  } }, t("Change password"));

  $("account-body").replaceChildren(
    el("div", { class: "acc-head" }, pic,
      el("div", {},
        el("div", { class: "acc-name" }, flag(a.country), " ", a.nick),
        el("div", { class: "row acc-pic-btns" }, file,
          el("button", { type: "button", class: "small", onclick: () => file.click() }, a.picture ? t("Change picture") : t("Add a picture")),
          a.picture ? el("button", { type: "button", class: "small", onclick: async () => {
            if (await act("picture", { picture: null }, picError, t("Picture removed."))) render();
          } }, t("Remove")) : null),
        el("small", { class: "muted" }, t("A square of it is kept (128 × 128). Players see it in your profile in rooms.")))),
    picError,
    el("dl", { class: "acc-fixed" },
      fixed(a.email ? t("Email") : t("Login"), a.email || a.login, a.email ? t("Can't be changed · you sign in with it") : t("Can't be changed")),
      fixed(t("Nickname"), a.nick),
      country,
      a.created ? [el("dt", {}, t("Member since")), el("dd", {}, new Date(a.created).toLocaleDateString(locale()))] : null),
    el("div", { class: "acc-edit" }, sex, el("label", {}, t("Year of birth"), years)),
    saveError,
    el("div", { class: "row acc-actions" }, save),
    el("h4", {}, t("Password")),
    el("div", { class: "acc-pw" }, el("label", {}, t("Current password"), old), el("label", {}, t("New password"), neu,
      el("small", {}, t("6 to 64 characters."))), el("label", {}, t("New password again"), again)),
    pwError,
    el("div", { class: "row acc-actions" }, change));
}

// A canvas as a picture to send: WebP (JPEG where the browser has none, Safari), as good as fits one message (the
// game's messages hold at most 32 KB, myaccount.py and guilds.py REQUEST_MAX); null if it never fits
const DATA_MAX = 26000;               // characters of the data: URL
export function pictureData(cv) {
  for (const [type, q] of [["image/webp", 0.85], ["image/webp", 0.7], ["image/webp", 0.5], ["image/jpeg", 0.85],
    ["image/jpeg", 0.65], ["image/jpeg", 0.45]]) {
    const data = cv.toDataURL(type, q);
    if (data.startsWith("data:" + type) && data.length <= DATA_MAX) return data;
  }
  throw new Error(t("That picture is too detailed to send: try another."));
}

// a picture file: its middle square at 128 x 128, as a data: URL
async function squarePicture(f) {
  if (f.size > 20 * 1024 * 1024) throw new Error(t("That picture is too big."));
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(t("That is not a picture this browser can read.")));
      i.src = url;
    });
    const cv = document.createElement("canvas");
    cv.width = cv.height = PIC;
    const ctx = cv.getContext("2d"), s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.fillStyle = "#fff";                            // (a transparent picture saved as JPEG: on white)
    ctx.fillRect(0, 0, PIC, PIC);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, PIC, PIC);
    return pictureData(cv);
  } finally {
    URL.revokeObjectURL(url);
  }
}
