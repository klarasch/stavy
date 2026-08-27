import { createContext, useContext, useEffect, useState } from "react"
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
const NEAR_PX = 400
/** Below this zoom a live page is illegible anyway; cards keep placeholders. */
const MIN_LIVE_K = 0.15
/** A live card farther than this from the viewport is an eviction candidate. */
const EVICT_PX = 1200
/** …but only after staying that far out for this long (pan-back never thrashes). */
const EVICT_MS = 15_000
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
const LIVE_BUDGET = 24
const liveRegistry = new Map<Element, number>()

/**
 * True while the element is near the viewport at a legible zoom. Mounts
 * eagerly (NEAR_PX), evicts lazily (EVICT_PX + EVICT_MS dwell). Outside a
 * canvas (no provider) it is true immediately and stays true.
 */
export function useLiveWhenVisible(ref: React.RefObject<HTMLElement | null>): boolean {
  const ctx = useContext(CanvasViewportContext)
  const inspecting = useContext(CanvasInspectContext)
  const [live, setLive] = useState(!ctx)
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
      // Card rect in canvas coordinates: measure against the content root and
      // divide out whatever transform the DOM currently carries (it may lag
      // `t` by a frame on first load), then re-apply `t` arithmetically.
      const rr = root.getBoundingClientRect()
      const domK = root.offsetWidth ? rr.width / root.offsetWidth : 1
      const er = el.getBoundingClientRect()
      const left = t.x + ((er.left - rr.left) / domK) * t.k
      const top = t.y + ((er.top - rr.top) / domK) * t.k
      const w = (er.width / domK) * t.k
      const h = (er.height / domK) * t.k
      const within = (m: number) =>
        left < vp.clientWidth + m && left + w > -m && top < vp.clientHeight + m && top + h > -m
      if (!live) {
        if (t.k >= MIN_LIVE_K && within(NEAR_PX)) setLive(true)
        return
      }
      const hover = el.matches(":hover")
      // Budget: distance beyond the viewport edge (0 = on screen), reported
      // every check; when over budget the farthest off-screen card evicts
      // itself immediately — no dwell, bounded memory beats smooth pan-back.
      const dist = Math.max(
        0,
        left - vp.clientWidth,
        -(left + w),
        top - vp.clientHeight,
        -(top + h)
      )
      liveRegistry.set(el, dist)
      if (liveRegistry.size > LIVE_BUDGET && dist > 0 && !inspecting && !hover) {
        let farthest: Element | null = null
        let max = 0
        for (const [e, d] of liveRegistry) if (d > max) { max = d; farthest = e }
        if (farthest === el) {
          liveRegistry.delete(el)
          setLive(false)
          return
        }
      }
      // Dwell: evict after a continuous EVICT_MS beyond EVICT_PX — or below
      // the legibility zoom floor, where the placeholder stands in anyway.
      // Inspect mode holds everything; the hovered card is never evicted.
      if ((within(EVICT_PX) && t.k >= MIN_LIVE_K) || inspecting || hover) {
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
    // First check runs synchronously: rAF is paused in hidden/background tabs,
    // and a canvas opened in one would otherwise stay all-placeholders until
    // fronted. Transform reads are safe pre-paint (check divides out the DOM
    // transform), so there is nothing to wait a frame for.
    check()
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
