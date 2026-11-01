// Installing the game on a phone or tablet (manifest.webmanifest): opened from the home screen it has no browser bars,
// all of the screen for the game. A tip in the lobby says how, once a visit until closed for good (×): where the
// browser can install it from the page (Android's: beforeinstallprompt), an Install button; on an iPhone or iPad,
// Share and then Add to Home Screen. Never once installed, nor on a computer.

import { t } from "./i18n.js";

const KEY = "install-tip";              // localStorage: "no" = closed for good
let offer = null;                       // the browser's install prompt, kept for the button
let box = null, shown = false, inLobby = false;

const installed = () => matchMedia("(display-mode: standalone)").matches ||
  matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true;
const touch = () => matchMedia("(hover: none) and (pointer: coarse)").matches;
const apple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);     // (an iPad says it is a Mac)

function closed() {
  try { return localStorage.getItem(KEY) === "no"; } catch (e) { return false; }
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();                   // (the tip offers it, not the browser's own bar)
  offer = e;
  if (inLobby) installTip(true);
});
window.addEventListener("appinstalled", () => { offer = null; hide(); });

// The lobby is shown (true) or left (false)
export function installTip(lobby) {
  inLobby = lobby;
  if (!lobby) return hide();
  if (shown || installed() || !touch() || closed() || !(offer || apple())) return;
  shown = true;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "it-close";
  close.textContent = "×";
  close.setAttribute("aria-label", t("Close"));
  close.onclick = () => {
    try { localStorage.setItem(KEY, "no"); } catch (e) { /* private mode: just for now */ }
    hide();
  };
  const icon = document.createElement("img");
  icon.src = "img/app/icon-192.png";
  icon.alt = "";
  const text = document.createElement("p");
  text.textContent = offer ? t("Play without the browser's bars: install Only Bomb on this device.")
    : t("Play without the browser's bars: tap Share, then Add to Home Screen.");
  box = document.createElement("div");
  box.className = "install-tip";
  box.setAttribute("role", "status");
  box.append(icon, text);
  if (offer) {
    const install = document.createElement("button");
    install.type = "button";
    install.className = "primary";
    install.textContent = t("Install");
    install.onclick = async () => {
      const prompt = offer;
      offer = null;
      hide();
      prompt.prompt();
      await prompt.userChoice.catch(() => null);
    };
    box.append(install);
  }
  box.append(close);
  document.body.append(box);
}

function hide() {
  if (box) box.remove();
  box = null;
}
