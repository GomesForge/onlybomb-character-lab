// An HD sheet's picture (characters.js, tools/hd_sheets.py) as the GPU takes it: its RGBA, each colour times its alpha
// (the GPU blends its pixels' edges without dark fringes), read back straight from a canvas, the same in every
// browser. In hd_worker.js, off the page's thread; here too for a browser whose workers have no OffscreenCanvas.

export async function hdPixels(bytes, type) {
  const pic = await createImageBitmap(new Blob([bytes], { type }));
  try {
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(pic.width, pic.height)
      : Object.assign(document.createElement("canvas"), { width: pic.width, height: pic.height });
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(pic, 0, 0);
    const d = new Uint8Array(g.getImageData(0, 0, pic.width, pic.height).data.buffer);
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 255) continue;
      d[i] = (d[i] * a + 127) / 255; d[i + 1] = (d[i + 1] * a + 127) / 255; d[i + 2] = (d[i + 2] * a + 127) / 255;
    }
    return d;
  } finally {
    pic.close();
  }
}
