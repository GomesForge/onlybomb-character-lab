// The Report window (index.html #dlg-report): a player tells the game masters about another (the server's reports.py)
// with what happened and a few words; the GM panel's Reports page gets it, with the two players' last chat lines. The
// reported player is not told. Opened from a player's menu (the Online list, a room's seat card) and their profile.

import { t } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const dlg = $("dlg-report");
const TEXT_MIN = 5;                    // letters (reports.TEXT_MIN)

let session = null, toast = null;
let who = null;                        // {id, nick}: the player being reported

export function initReport(s, toastFn) {
  session = s;
  toast = toastFn;
  $("report-text").addEventListener("input", () => { count(); problem(null); });
  for (const r of dlg.querySelectorAll("[name=report-reason]")) r.addEventListener("change", () => problem(null));
  $("report-cancel").onclick = () => dlg.close();
  $("report-form").addEventListener("submit", (e) => { e.preventDefault(); send(); });
}

export function openReport(u) {
  who = { id: u.id, nick: u.nick };
  $("report-form").reset();
  $("report-who").textContent = u.nick;
  $("report-note").textContent = t("Only the game masters read it, with the last chat lines of you two. {nick} is not told who sent it.",
    { nick: u.nick });
  $("report-send").disabled = false;
  $("report-send").textContent = t("Send report");
  problem(null);
  count();
  dlg.showModal();
  dlg.querySelector("[name=report-reason]").focus();
}

function count() {
  const n = $("report-text").value.length;
  $("report-count").textContent = n;
  $("report-count").parentElement.classList.toggle("full", n >= 200);
}

// a problem under the message (field: "reason" or "text" outlined), or none
function problem(text, field = null) {
  $("report-error").textContent = text || "";
  $("report-error").hidden = !text;
  dlg.querySelector(".report-reasons").classList.toggle("bad-field", field === "reason");
  $("report-text").classList.toggle("bad-field", field === "text");
}

async function send() {
  const picked = dlg.querySelector("[name=report-reason]:checked");
  const text = $("report-text").value.trim();
  if (!picked) return problem(t("Pick what happened."), "reason");
  if (text.length < TEXT_MIN) {
    $("report-text").focus();
    return problem(t("Tell the game masters what happened, in a few words."), "text");
  }
  problem(null);
  const btn = $("report-send");
  btn.disabled = true;
  btn.textContent = t("Sending…");
  const res = await session.reportAsk({ player: who.id, nick: who.nick, reason: picked.value, text });
  btn.disabled = false;
  btn.textContent = t("Send report");
  if (res.error) return problem(t(res.error), res.field);
  dlg.close();
  toast(t("Thanks. Your report about {nick} went to the game masters.", { nick: who.nick }), true);
}
