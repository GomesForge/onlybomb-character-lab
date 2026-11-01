// A question in the game's own window (index.html #dlg-ask) instead of the browser's confirm(): a title, what it is
// about (text, and nodes such as a picture or a price), and two buttons. ask() resolves true on the yes button, false on
// Cancel or Esc. A danger question (the yes button red) starts on Cancel, so Enter does not do it by mistake.

import { t } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const dlg = $("dlg-ask");
let answer = null;                        // the open question's resolve

dlg.addEventListener("close", () => {
  const done = answer;
  answer = null;
  $("ask-body").replaceChildren();
  if (done) done(dlg.returnValue === "yes");
});

export function ask({ title, text = "", body = null, yes = t("OK"), no = t("Cancel"), danger = false }) {
  if (answer) { answer(false); answer = null; }   // (one question at a time: the one before is a no)
  $("ask-title").textContent = title;
  $("ask-text").textContent = text;
  $("ask-text").hidden = !text;
  $("ask-body").replaceChildren(...[body].flat().filter((k) => k != null && k !== false));
  $("ask-body").hidden = !body;
  const ok = $("ask-yes"), cancel = $("ask-no");
  ok.textContent = yes;
  cancel.textContent = no;
  ok.className = danger ? "danger" : "primary";
  dlg.returnValue = "";
  return new Promise((resolve) => {
    answer = resolve;
    if (!dlg.open) dlg.showModal();
    (danger ? cancel : ok).focus();
  });
}
