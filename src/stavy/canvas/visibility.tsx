import { createContext, useContext, useEffect, useState } from "react"
import type { Transform } from "./PanZoom"

/**
 * Lazy canvas mounting (SPEC §3). Instance cards render real product pages,
 * and real product pages are heavy — grids, charts, context providers. An
 * adoption trial measured 32k DOM nodes and a 16 s settle with every card
 * mounted eagerly, 87% of them off-screen; gating on the viewport cut that
 * to 4.6k nodes and ~3 s. So cards stay placeholders until they come near
 * the viewport, and stick once mounted — panning back and forth never
 * re-runs a page's effects or loses its state.
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

/**
 * True once the element has come near the viewport at a legible zoom; sticky
 * thereafter. Outside a canvas (no provider) it is true immediately.
 */
export function useLiveWhenVisible(ref: React.RefObject<HTMLElement | null>): boolean {
  const ctx = useContext(CanvasViewportContext)
  const [live, setLive] = useState(!ctx)
  useEffect(() => {
    if (!ctx || live) return
    let raf: number | null = null
    const check = () => {
      raf = null
      const el = ref.current
      const root = ctx.contentEl()
      const vp = ctx.viewportEl()
      if (!el || !root || !vp) return
      const t = ctx.get()
      if (t.k < MIN_LIVE_K) return
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
      if (
        left < vp.clientWidth + NEAR_PX &&
        left + w > -NEAR_PX &&
        top < vp.clientHeight + NEAR_PX &&
        top + h > -NEAR_PX
      )
        setLive(true)
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
    window.addEventListener("resize", schedule)
    return () => {
      unsub()
      window.removeEventListener("resize", schedule)
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [ctx, live, ref])
  return live
}
