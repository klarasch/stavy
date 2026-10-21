// Timer gate: hold an app in a transient state (a spinner, a toast, a
// "running…" row) until someone says to go on.
//
// Mock apps fake latency with setTimeout. While the gate is closed, timer
// callbacks with a delay of at least MIN_DELAY ms wait in a queue instead of
// running, and setInterval ticks are skipped; short timers (React, focus
// handling, 0 ms defers), animation frames and real network requests are left
// alone. Opening the gate runs the queue in order.
//
// `installGate(win)` must stay self-contained (no closures over this module):
// the scanner serialises it into the page with Playwright's evaluate.

/**
 * Install the gate in a window (idempotent) and return its controller.
 * @param {Window & { __stavyGate?: any }} win
 * @returns {{ closed: boolean, close(): void, open(): void }}
 */
export function installGate(win) {
  if (win.__stavyGate) return win.__stavyGate
  const MIN_DELAY = 50
  const nativeSet = win.setTimeout.bind(win)
  const nativeClear = win.clearTimeout.bind(win)
  const nativeInterval = win.setInterval.bind(win)
  /** Callbacks whose timer fired while the gate was closed, by timer id. */
  const queue = new Map()
  const gate = {
    closed: false,
    close() {
      gate.closed = true
    },
    open() {
      gate.closed = false
      const due = [...queue.values()]
      queue.clear()
      for (const run of due) {
        try {
          run()
        } catch (e) {
          win.console?.error?.(e)
        }
      }
    },
  }
  const call = (fn, args) => (typeof fn === "function" ? fn(...args) : win.eval(String(fn)))
  win.setTimeout = function (fn, delay, ...args) {
    if (!(Number(delay) >= MIN_DELAY)) return nativeSet(fn, delay, ...args)
    const id = nativeSet(() => {
      if (gate.closed) queue.set(id, () => call(fn, args))
      else call(fn, args)
    }, delay)
    return id
  }
  win.clearTimeout = function (id) {
    queue.delete(id)
    return nativeClear(id)
  }
  win.setInterval = function (fn, delay, ...args) {
    if (!(Number(delay) >= MIN_DELAY)) return nativeInterval(fn, delay, ...args)
    return nativeInterval(() => {
      if (!gate.closed) call(fn, args)
    }, delay)
  }
  win.__stavyGate = gate
  return gate
}

/**
 * The tag the dev plugin puts first in the app's <head>: inside a Stavy frame
 * it hands the new window to the viewer before any app script runs, so a
 * state loaded fresh can be held from its first timer. Inert anywhere else.
 */
export const FRAME_HOOK = `<script>try{if(window.parent!==window&&window.parent.__stavyFrame)window.parent.__stavyFrame(window)}catch(e){}</script>`
