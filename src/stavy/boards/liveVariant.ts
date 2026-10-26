import { findTarget } from "../manifest"
import { frameDoc, frameWin, settleFrame } from "../frame"

/**
 * A board variant (crop / `do` / viewport) brought to life in a frame, so the
 * inspector can read the real DOM instead of a screenshot. Mirrors what
 * `scripts/scan.mjs` does in Playwright, in the browser and best-effort:
 * synthetic events can't fake `:hover` or a real key press, so a variant that
 * depends on those may look slightly different live than in its snapshot.
 *
 * Safety: a live frame replays its actions on every hover, against whatever
 * app the workspace points at (possibly a staging build). Only actions that
 * open or point at things replay live; a variant that types or presses keys
 * stays a snapshot (`replaysLive`).
 */

/** Actions safe to repeat on every hover. */
const LIVE_SAFE = ["click", "hover", "focus", "wait", "hold"]

/** Whether a variant's actions may run in a live frame (else the card keeps its snapshot). */
export function replaysLive(actions: ReadonlyArray<Record<string, unknown>> | undefined): boolean {
  return (actions ?? []).every((a) => Object.keys(a).some((k) => LIVE_SAFE.includes(k)) && !("into" in a) && !("press" in a))
}

/** Same margin scan puts around a crop, so the live frame lines up with the capture. */
export const CROP_MARGIN = 16

/** A target id / selector, else an element whose visible text is exactly `t` (deepest match). */
function locate(doc: Document, t: string): HTMLElement | null {
  const byId = findTarget(doc, t)
  if (byId) return byId
  let best: HTMLElement | null = null
  for (const el of doc.body?.querySelectorAll<HTMLElement>("*") ?? []) {
    if (el.textContent?.trim() === t) best = el // later in document order = deeper
  }
  return best
}

/** Replay a variant's actions inside the frame. Unknown or failing actions are skipped. */
export async function replayActions(iframe: HTMLIFrameElement, actions: ReadonlyArray<Record<string, unknown>> | undefined): Promise<void> {
  for (const a of actions ?? []) {
    const doc = frameDoc(iframe)
    const win = frameWin(iframe) as (Window & typeof globalThis) | null
    if (!doc || !win) return
    const act = a as Record<string, unknown>
    try {
      if (typeof act.click === "string") {
        // The whole sequence a real click makes: menus and selects often open on pointerdown.
        const target = locate(doc, act.click)
        if (target) {
          // Like Playwright: the event goes to what is on top at the target's centre (a trigger inside a wrapper).
          const r = target.getBoundingClientRect()
          const top = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          const el = (top && target.contains(top) ? top : target) as HTMLElement
          const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }
          el.dispatchEvent(new win.PointerEvent("pointerdown", { ...at, buttons: 1 }))
          el.dispatchEvent(new win.MouseEvent("mousedown", { ...at, buttons: 1 }))
          el.focus?.()
          el.dispatchEvent(new win.PointerEvent("pointerup", at))
          el.dispatchEvent(new win.MouseEvent("mouseup", at))
          el.dispatchEvent(new win.MouseEvent("click", at))
        }
      }
      else if (typeof act.focus === "string") locate(doc, act.focus)?.focus()
      else if (typeof act.hover === "string") {
        const el = locate(doc, act.hover)
        for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"])
          el?.dispatchEvent(new (type.startsWith("pointer") ? win.PointerEvent : win.MouseEvent)(type, { bubbles: !type.endsWith("enter") }))
      } else if ("wait" in act) {
        await new Promise((r) => setTimeout(r, Math.min(Number(act.wait) || 0, 2000)))
        continue
      } else continue // `hold` only matters for a capture; `type`/`press` never replay live (see replaysLive)
    } catch {
      /* best-effort: the snapshot stays the reference */
    }
    await settleFrame(iframe, { quiet: 100, max: 1500 })
  }
}

export interface CropBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The crop target's box plus a margin, in the frame's viewport, after
 * scrolling it into view the way scan does. Null when the target is missing.
 */
export function cropBox(iframe: HTMLIFrameElement, target: string, viewport: { width: number; height: number }): CropBox | null {
  const doc = frameDoc(iframe)
  const el = doc && locate(doc, target)
  if (!el) return null
  let r = el.getBoundingClientRect()
  if (r.bottom < 0 || r.right < 0 || r.top > viewport.height || r.left > viewport.width) {
    scrollWithinFrame(iframe, el, r.height > viewport.height ? "start" : "center")
    r = el.getBoundingClientRect()
  }
  if (!r.width || !r.height) return null
  const x0 = Math.max(0, Math.floor(r.left - CROP_MARGIN))
  const y0 = Math.max(0, Math.floor(r.top - CROP_MARGIN))
  const x1 = Math.min(viewport.width, Math.ceil(r.right + CROP_MARGIN))
  const y1 = Math.min(viewport.height, Math.ceil(r.bottom + CROP_MARGIN))
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null
}

/**
 * scrollIntoView inside a same-origin frame also scrolls every scrollable
 * ancestor in the host page (the doc, the board), so hovering a card would
 * jump the page. Scroll, then put the host's scroll positions back.
 */
function scrollWithinFrame(iframe: HTMLIFrameElement, el: Element, block: ScrollLogicalPosition) {
  const host = iframe.ownerDocument
  const saved: Array<[Element, number, number]> = []
  for (let n: Element | null = iframe.parentElement; n; n = n.parentElement) saved.push([n, n.scrollLeft, n.scrollTop])
  const win = host.defaultView
  const [wx, wy] = [win?.scrollX ?? 0, win?.scrollY ?? 0]
  el.scrollIntoView({ block, inline: "nearest" })
  for (const [n, l, t] of saved) if (n.scrollLeft !== l || n.scrollTop !== t) {
    n.scrollLeft = l
    n.scrollTop = t
  }
  if (win && (win.scrollX !== wx || win.scrollY !== wy)) win.scrollTo(wx, wy)
}
