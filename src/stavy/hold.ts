// Holding the player frame in a transient state (see scripts/lib/gate.mjs).
// A tour step with `hold: true` keeps its spinner / toast / "running" row on
// screen until the reviewer presses Next.
import { installGate } from "../../scripts/lib/gate.mjs"
import { frameWin } from "./frame"

const HOLD_ATTR = "data-stavy-hold"

declare global {
  interface Window {
    __stavyFrame?: (w: Window) => void
  }
}

// The dev plugin's hook calls this from the head of every frame document,
// before the app's own scripts run, so a state loaded fresh starts held.
if (typeof window !== "undefined") {
  window.__stavyFrame = (w: Window) => {
    try {
      const gate = installGate(w)
      if ((w.frameElement as HTMLElement | null)?.hasAttribute(HOLD_ATTR)) gate.close()
    } catch {
      /* not ours to hold */
    }
  }
}

/** Make sure the frame's current window has a gate (no-op when the hook already put one there). */
export function gateFrame(iframe: HTMLIFrameElement | null | undefined) {
  const w = frameWin(iframe)
  if (!w) return null
  try {
    return installGate(w)
  } catch {
    return null
  }
}

/** Hold (or release) the app in the frame. Releasing runs the timers that came due meanwhile. */
export function holdFrame(iframe: HTMLIFrameElement | null | undefined, on: boolean) {
  if (!iframe) return
  if (on) iframe.setAttribute(HOLD_ATTR, "")
  else iframe.removeAttribute(HOLD_ATTR)
  const gate = gateFrame(iframe)
  if (!gate || gate.closed === on) return
  if (on) gate.close()
  else gate.open()
}
