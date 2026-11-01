// The Mission Coins icon: Boss Battle's own coin (the Korean client's Bomey_10, frame 4: full size, facing front),
// drawn from the game data when the page needs it, so the Korean data stays out of the repository. Null without it.

import { loadSprite } from "../assets/spr.js";

let icon = null;
export function missionIcon() {
  if (!icon) {
    icon = loadSprite("BattleBoss/Item/Bomey_10.spr").then((spr) => {
      const b = spr.bbox(4), c = document.createElement("canvas");
      c.width = c.height = 32;
      const s = 32 / Math.max(b.w, b.h);
      c.getContext("2d").drawImage(spr.frame(4), b.x, b.y, b.w, b.h, (32 - b.w * s) / 2, (32 - b.h * s) / 2, b.w * s,
        b.h * s);
      return c;
    }).catch(() => null);
  }
  return icon;
}
