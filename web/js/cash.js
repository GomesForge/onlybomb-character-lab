// The shop's Get Cash window (the server's payments.py): packs of Cash paid on Stripe's own page. The order is made
// here, Stripe's page opens in a new tab, and the Cash arrives as soon as Stripe tells the server it is paid (this
// window asks the server meanwhile too, in case Stripe's word is late).

import { ask } from "./ask.js";
import { t, N_, num, locale, onLanguage } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const dlg = $("dlg-cash");
const POLL_MS = 5000;                  // while an order waits: ask the server this often ...
const POLL_FOR_MS = 30 * 60 * 1000;    // ... for this long at most

const STATUS = {
  open: N_("Waiting for the payment"), paid: N_("Paid"), expired: N_("Expired"), failed: N_("Failed"),
  refunded: N_("Refunded"), disputed: N_("Disputed"),
};
const status = (s) => (STATUS[s] ? t(STATUS[s]) : s);

let session = null, toast = null;
let state = null;                      // the server's {on, packs, orders}
let waiting = null;                    // the order just made: {order, url, since}
let timer = null;

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

// a price in the currency's smallest unit (as Stripe has it: centavos), written for the player's language
export function money(amount, currency) {
  const code = String(currency || "").toUpperCase();
  try {
    const f = new Intl.NumberFormat(locale(), { style: "currency", currency: code });
    return f.format(amount / 10 ** f.resolvedOptions().maximumFractionDigits);
  } catch (e) {
    return `${(amount / 100).toFixed(2)} ${code}`;
  }
}

export function initCash(s, toastFn) {
  session = s;
  toast = toastFn;
  session.addEventListener("cashpaid", (ev) => paid(ev.detail));
  dlg.addEventListener("close", stop);
  onLanguage(() => { if (dlg.open && state) render(); });
}

export async function openCash() {
  state = null;
  waiting = null;
  $("cash-body").replaceChildren(el("p", { class: "muted" }, t("Loading…")));
  if (!dlg.open) dlg.showModal();
  const r = await session.cashAsk("packs");
  if (r.error) { $("cash-body").replaceChildren(el("p", { class: "form-error" }, t(r.error))); return; }
  state = r;
  render();
}

function render() {
  if (!state.on) {
    $("cash-body").replaceChildren(el("p", {}, t("Buying Cash is not available on this server.")));
    return;
  }
  const packs = el("div", { class: "cash-packs" }, state.packs.map((p) => el("div", { class: "cash-pack" },
    el("span", { class: "price cash" }, num(p.cash)),
    el("b", {}, money(p.price, p.currency)),
    el("button", { type: "button", class: "primary", disabled: !!(waiting && waiting.order.status === "open"),
      onclick: () => buy(p) }, t("Buy")))));
  const parts = [state.packs.length ? packs : el("p", { class: "muted" }, t("No Cash is for sale right now."))];
  if (waiting) parts.push(waitBox());
  if (state.orders.length) {
    parts.push(el("h4", {}, t("Your orders")), el("table", { class: "cash-orders" }, el("tbody", {},
      state.orders.map((o) => el("tr", {},
        el("td", { class: "muted" }, new Date(o.t).toLocaleDateString(locale())),
        el("td", {}, el("span", { class: "price cash" }, num(o.cash))),
        el("td", {}, money(o.price, o.currency)),
        el("td", { class: "cash-st " + o.status }, status(o.status)))))));
  }
  $("cash-body").replaceChildren(...parts);
}

function waitBox() {
  const o = waiting.order;
  if (o.status === "paid") {
    return el("div", { class: "cash-wait done" }, el("b", {}, t("Payment received!")),
      el("span", {}, t("{cash} Cash is in your wallet. Thank you for supporting the server!", { cash: num(o.cash) })));
  }
  if (o.status !== "open") {
    return el("div", { class: "cash-wait" }, el("b", {}, status(o.status)),
      el("span", {}, t("Nothing was charged for this order.")));
  }
  return el("div", { class: "cash-wait" },
    el("b", {}, t("Waiting for the payment…")),
    el("span", {}, t("Pay on Stripe's page, in the other tab. With Pix it can take a minute after you pay.")),
    el("a", { href: waiting.url, target: "_blank", rel: "noopener", class: "btn" }, t("Open the payment page")));
}

async function buy(pack) {
  const ok = await ask({ title: t("Buy Cash"), yes: t("Continue to payment"),
    text: t("{cash} Cash for {price}. You pay on Stripe's page, in a new tab.",
      { cash: num(pack.cash), price: money(pack.price, pack.currency) }) });
  if (!ok) return;
  const tab = window.open("", "_blank");        // now, while the click still counts: a popup blocker lets it through
  if (tab) { try { tab.opener = null; } catch (e) { /* (cross-origin already) */ } }
  const r = await session.cashAsk("buy", { pack: pack.id, cash: pack.cash, price: pack.price, origin: location.origin });
  if (r.error) {
    if (tab) tab.close();
    toast(t(r.error));
    if (r.error === "The packs changed: look at them again.") openCash();
    return;
  }
  if (tab) tab.location.href = r.url;
  waiting = { order: r.order, url: r.url, since: Date.now() };
  state.orders = [r.order, ...state.orders.filter((o) => o.id !== r.order.id)].slice(0, 5);
  render();
  stop();
  timer = setInterval(check, POLL_MS);
}

async function check() {
  if (!waiting || waiting.order.status !== "open" || Date.now() - waiting.since > POLL_FOR_MS) { stop(); return; }
  const r = await session.cashAsk("check", { order: waiting.order.id });
  if (r.order && waiting && r.order.id === waiting.order.id) update(r.order);
}

function paid(order) {
  if (dlg.open) toast(t("You received {cash} Cash. Thank you!", { cash: num(order.cash) }), true);
  update(order);
}

function update(order) {
  if (!state) return;
  if (waiting && waiting.order.id === order.id) waiting.order = order;
  state.orders = state.orders.map((o) => (o.id === order.id ? order : o));
  if (order.status !== "open" && waiting && waiting.order.id === order.id) stop();
  if (dlg.open) render();
}

function stop() {
  clearInterval(timer);
  timer = null;
}
