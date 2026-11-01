// A clock that keeps going in a hidden tab (another tab in front, the window minimised). requestAnimationFrame stops
// there and the page's own timers slow down to once a second, later once a minute; a worker's timers do not, and its
// messages reach the page at once. The match steps its world on these ticks while it cannot draw (match.js).
const SOURCE = "let t = 0; onmessage = (e) => { clearInterval(t); if (e.data > 0) t = setInterval(() => postMessage(0), e.data); };";

// fn() every `ms`; returns the function that stops it
export function backgroundTicker(ms, fn) {
  try {
    const url = URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => fn();
    worker.postMessage(ms);
    return () => worker.terminate();
  } catch (e) {                      // no workers here: the page's timer, slowed down but still going
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}
