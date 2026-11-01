// Show FPS (Options → Display, F2 in a match): the frames drawn each second and the time one takes to draw (the world
// and the screen filter), twice a second in the page's top left corner. Not part of the game's picture.

import { display } from "./display.js";

const EVERY_MS = 500;

export class FpsMeter {
  constructor(parent) {
    this.el = document.createElement("div");
    this.el.className = "fps-meter";
    this.el.setAttribute("aria-hidden", "true");
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.restart(performance.now());
  }

  restart(now) { this.from = now; this.frames = 0; this.ms = 0; }

  drawn(ms) { this.frames++; this.ms += ms; }

  // each animation frame
  tick(now) {
    if (this.el.hidden === display.fps) {
      this.el.hidden = !display.fps;
      this.el.textContent = "… fps";
      this.restart(now);
    }
    if (!display.fps || now - this.from < EVERY_MS) return;
    const fps = (this.frames * 1000) / (now - this.from), ms = this.frames ? this.ms / this.frames : 0;
    this.el.textContent = `${Math.round(fps)} fps · ${ms.toFixed(1)} ms`;
    this.restart(now);
  }

  dispose() { this.el.remove(); }
}
