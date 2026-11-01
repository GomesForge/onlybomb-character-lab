// Decodes HD sheets off the main thread (characters.js decodeHd): {id, bytes, type} -> {id, pixels} (hdpixels.js:
// premultiplied RGBA, its buffer handed over) or {id, error} (no OffscreenCanvas here: the page does them itself).
import { hdPixels } from "./hdpixels.js";

onmessage = async ({ data: { id, bytes, type } }) => {
  try {
    if (typeof OffscreenCanvas === "undefined") throw new Error("no OffscreenCanvas");
    const pixels = await hdPixels(bytes, type);
    postMessage({ id, pixels }, [pixels.buffer]);
  } catch (e) {
    postMessage({ id, error: String((e && e.message) || e) });
  }
};
