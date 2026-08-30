import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { Transform } from "./PanZoom"

/**
 * Lazy canvas mounting + eviction (SPEC §3). Instance cards render real
 * product pages, and real product pages are heavy — grids, charts, context
 * providers. An adoption trial measured 32k DOM nodes and a 16 s settle with
 * every card mounted eagerly, 87% of them off-screen; gating on the viewport
 * cut that to 4.6k nodes and ~3 s. So cards stay placeholders until they come
 * near the viewport — and since canvas cards are by decision *static previews*
 * (interaction happens in the opened page, never on the canvas), a mounted
 * card holds no state worth keeping and can be evicted back to a placeholder
 * once it has been far off-screen for a while. Long sessions over big
 * canvases then stop accumulating every card ever visited.
 *
 * Hysteresis keeps panning smooth: cards mount within NEAR_PX of the
 * viewport but evict only after sitting beyond EVICT_PX for EVICT_MS
 * continuously, so rocking back and forth over an area never thrashes.
 * Eviction pauses while inspect mode is on (the inspector reads mounted
 * DOM) and skips the card currently under the pointer.
 *
 * Visibility is computed arithmetically from PanZoom's transform, NOT with
 * IntersectionObserver: PanZoom writes the transform straight to the DOM
 * outside React, and an observer can evaluate before the initial transform
 * is painted — every card then reads as off-screen and the canvas comes up
 * blank.
 */
export interface CanvasViewport {
  get: () => Transform
  /** Called on every transform change (live, per paint) and on resize. */
  subscribe: (fn: () => void) => () => void
  viewportEl: () => HTMLElement | null
  contentEl: () => HTMLElement | null
}

export const CanvasViewportContext = createContext<CanvasViewport | null>(null)

/**
 * Canvas thumbnails are rendered `inert`: pages are real product code, and a
 * mounted modal's focus trap / autoFocus would otherwise steal focus from the
 * viewer (two of them would fight each other). `inert` makes the subtree
 * unfocusable regardless of what the page's kit does — defense that needs no
 * cooperation from page modules. Inspect mode lifts it so the inspector can
 * hover into thumbnails (CSS pointer-events can't override `inert`).
 */
export const CanvasInspectContext = createContext(false)

/** Screen-space margin (px) around the viewport that already counts as near. */
export const NEAR_PX = 400
/** Below this zoom a live page is illegible anyway; cards keep placeholders. */
export const MIN_LIVE_K = 0.15
/** A live card farther than this from the viewport is an eviction candidate. */
export const EVICT_PX = 1200
/** …but only after staying that far out for this long (pan-back never thrashes). */
export const EVICT_MS = 15_000
/** Idle heartbeat so eviction still happens when nobody pans. */
const SWEEP_MS = 5_000
/**
 * Hard ceiling on simultaneously live cards, whatever the canvas size —
 * enterprise pages run 1k+ DOM nodes each, and dwell-based eviction alone
 * still lets a broad pan or a mid-zoom overview accumulate dozens of live
 * pages. Over budget, off-screen cards evict immediately, farthest first.
 * Self-policing: each live card reports its distance into a shared registry
 * on every check and unmounts itself when it is the farthest one out.
 */
export const LIVE_BUDGET = 24
/**
 * Budget eviction may only target cards the mount test would NOT immediately
 * bring back. Mounting is `withinMargin(NEAR_PX)`; evicting anything merely
 * `dist > 0` overlaps that band (a card 200px off-screen is both), and because
 * the effect re-runs and re-checks synchronously whenever `live` flips, the
 * overlap is not a flicker but an unbounded mount→evict→mount cascade inside
 * one commit ("Maximum update depth exceeded"). Keeping the two conditions
 * disjoint makes the oscillation impossible by construction. The cost: when
 * more than LIVE_BUDGET cards are all genuinely near the viewport the budget
 * cannot be met — the dwell rule and the zoom floor still apply, and exceeding
 * a soft memory ceiling beats crashing the canvas.
 */
export function budgetEvictable(rect: ScreenRect, vp: ViewportSize): boolean {
  return !withinMargin(rect, vp, NEAR_PX)
}
const liveRegistry = new Map<Element, number>()

/* ------------------------------------------------------------------ */
/* Pure geometry — extracted out of the effect below so the viewport-   */
/* intersection and eviction-budget arithmetic can be unit tested       */
/* without a DOM. Behavior is unchanged: `useLiveWhenVisible` calls     */
/* these instead of inlining the same formulas.                        */
/* ------------------------------------------------------------------ */

/** A DOMRect-shaped bag of numbers — a real DOMRect satisfies this, and so does a plain object in a test. */
export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}
export interface ViewportSize {
  clientWidth: number
  clientHeight: number
}
export interface ScreenRect {
  left: number
  top: number
  w: number
  h: number
}

/**
 * Card rect in canvas coordinates: measure against the content root and
 * divide out whatever transform the DOM currently carries (it may lag `t` by
 * a frame on first load), then re-apply `t` arithmetically.
 */
export function computeScreenRect(elRect: RectLike, rootRect: RectLike, rootOffsetWidth: number, t: Transform): ScreenRect {
  const domK = rootOffsetWidth ? rootRect.width / rootOffsetWidth : 1
  const left = t.x + ((elRect.left - rootRect.left) / domK) * t.k
  const top = t.y + ((elRect.top - rootRect.top) / domK) * t.k
  const w = (elRect.width / domK) * t.k
  const h = (elRect.height / domK) * t.k
  return { left, top, w, h }
}

/** True when `rect` (viewport-relative screen space) comes within `margin` px of the viewport, in any direction. */
export function withinMargin(rect: ScreenRect, vp: ViewportSize, margin: number): boolean {
  return rect.left < vp.clientWidth + margin && rect.left + rect.w > -margin && rect.top < vp.clientHeight + margin && rect.top + rect.h > -margin
}

/** Distance (px) `rect` sits beyond the nearest viewport edge; 0 if it overlaps the viewport (or the margin) at all. */
export function distanceBeyondViewport(rect: ScreenRect, vp: ViewportSize): number {
  return Math.max(0, rect.left - vp.clientWidth, -(rect.left + rect.w), rect.top - vp.clientHeight, -(rect.top + rect.h))
}

/**
 * The registry entry with the largest recorded distance — the eviction
 * candidate once the registry is over LIVE_BUDGET. Ties keep the first entry
 * seen (`>` not `>=`), matching the incremental scan below. Null when empty.
 */
export function farthestBeyondBudget<K>(distances: Map<K, number>): K | null {
  let farthest: K | null = null
  let max = 0
  for (const [key, d] of distances) {
    if (d > max) {
      max = d
      farthest = key
    }
  }
  return farthest
}

/**
 * True while the element is near the viewport at a legible zoom. Mounts
 * eagerly (NEAR_PX), evicts lazily (EVICT_PX + EVICT_MS dwell). Outside a
 * canvas (no provider) it is true immediately and stays true.
 */
export function useLiveWhenVisible(ref: React.RefObject<HTMLElement | null>): boolean {
  const ctx = useContext(CanvasViewportContext)
  const inspecting = useContext(CanvasInspectContext)
  const [live, setLive] = useState(!ctx)
  const firstRun = useRef(true)
  useEffect(() => {
    if (!ctx) return
    let raf: number | null = null
    let farSince: number | null = null
    const check = () => {
      raf = null
      const el = ref.current
      const root = ctx.contentEl()
      const vp = ctx.viewportEl()
      if (!el || !root || !vp) return
      const t = ctx.get()
      const rr = root.getBoundingClientRect()
      const er = el.getBoundingClientRect()
      const rect = computeScreenRect(er, rr, root.offsetWidth, t)
      const viewport: ViewportSize = { clientWidth: vp.clientWidth, clientHeight: vp.clientHeight }
      if (!live) {
        if (t.k >= MIN_LIVE_K && withinMargin(rect, viewport, NEAR_PX)) setLive(true)
        return
      }
      const hover = el.matches(":hover")
      // Budget: distance beyond the viewport edge (0 = on screen), reported
      // every check; when over budget the farthest off-screen card evicts
      // itself immediately — no dwell, bounded memory beats smooth pan-back.
      const dist = distanceBeyondViewport(rect, viewport)
      liveRegistry.set(el, dist)
      if (liveRegistry.size > LIVE_BUDGET && budgetEvictable(rect, viewport) && !inspecting && !hover) {
        if (farthestBeyondBudget(liveRegistry) === el) {
          liveRegistry.delete(el)
          setLive(false)
          return
        }
      }
      // Dwell: evict after a continuous EVICT_MS beyond EVICT_PX — or below
      // the legibility zoom floor, where the placeholder stands in anyway.
      // Inspect mode holds everything; the hovered card is never evicted.
      if ((withinMargin(rect, viewport, EVICT_PX) && t.k >= MIN_LIVE_K) || inspecting || hover) {
        farSince = null
        return
      }
      farSince ??= Date.now()
      if (Date.now() - farSince >= EVICT_MS) {
        farSince = null
        liveRegistry.delete(el)
        setLive(false)
      }
    }
    const schedule = () => {
      if (raf == null) raf = requestAnimationFrame(check)
    }
    // The first check runs synchronously: rAF is paused in hidden/background
    // tabs, and a canvas opened in one would otherwise stay all-placeholders
    // until fronted. Transform reads are safe pre-paint (check divides out the
    // DOM transform), so there is nothing to wait a frame for. Re-runs caused
    // by a `live` flip schedule instead — a synchronous re-check there is what
    // turns any residual mount/evict disagreement into a cascade.
    if (firstRun.current) {
      firstRun.current = false
      check()
    } else {
      schedule()
    }
    const unsub = ctx.subscribe(schedule)
    const sweep = setInterval(schedule, SWEEP_MS)
    window.addEventListener("resize", schedule)
    return () => {
      unsub()
      clearInterval(sweep)
      window.removeEventListener("resize", schedule)
      if (raf != null) cancelAnimationFrame(raf)
      if (ref.current) liveRegistry.delete(ref.current)
    }
  }, [ctx, live, inspecting, ref])
  return live
}
