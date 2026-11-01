// The buttons' sounds, as BomberMan.exe plays them on its screens (H_objects §9.2; re/bm_decomp.c: the lobby's buttons
// FUN_0044f5c0, its page arrows FUN_0044f7c0, the room's FUN_0044a0b0, its teams and rules FUN_0044a260 / FUN_0044a3d0):
// CLK4 for a button that does something (create a room, join one, ready, buy ...); CLK5 for one that goes back (close,
// cancel, leave, sign out); CLK3 for a small choice (a list's page, a tab, a team, a rule, an item to try on). The
// sound effects' switch and volume (Options) count. None in a match (its quit dialog had none), nor for a chat's Send
// (Enter sends it), nor for the Options' sound tests (they play their own).

import { sfx } from "./game/sound.js";

const BACK = '[value="cancel"], [value="close"], [value="no"], #reg-back, #channels-back, #lobby-logout, #room-leave, ' +
  "#line-leave, .it-close";
const CHOICE = '[role="tab"], [aria-pressed], [data-tab], [data-page], [data-team], [data-mode], [data-body], ' +
  "#rooms-prev, #rooms-next, #users-prev, #users-next, #map-prev, #map-next, #item-grid button, #shop-grid button, " +
  "#shop-tabs button, #shop-wearing button, #room-modes button";
const SILENT = "#screen-game, form[data-chat], #opt-music-test, #opt-sfx-test";
const ARROW = /^[<>‹›]$/;              // a list's page arrows made in code (guild.js)

function kind(e) {
  if (e.matches(BACK)) return "CLK5";
  if (e.matches(CHOICE) || ARROW.test(e.textContent.trim())) return "CLK3";
  return "CLK4";
}

export function initClicks() {
  document.addEventListener("click", (ev) => {
    const e = ev.target.closest('button, [role="button"], #channel-list li, table.rooms tbody tr');
    if (!e || e.closest(SILENT) || e.disabled) return;
    sfx(kind(e));
  }, true);
  // a choice in a list or a switch: the rules, the map, the language, the options
  document.addEventListener("change", (ev) => {
    const e = ev.target;
    if (e.matches("select, input[type=checkbox], input[type=radio]") && !e.closest(SILENT)) sfx("CLK3");
  }, true);
}
