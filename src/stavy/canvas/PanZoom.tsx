import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"

export interface Transform {
  x: number
  y: number
  k: number
}

export const MIN_K = 0.05
/** High enough to inspect details inside a 0.2-scale thumbnail at >2× real size. */
export const MAX_K = 12

export function clampK(k: number) {
  return Math.min(MAX_K, Math.max(MIN_K, k))
}

export interface PanZoomHandle {
  get: () => Transform
  set: (t: Transform, smooth?: boolean) => void
  zoomBy: (factor: number, smooth?: boolean) => void
  fitTo: (el: Element, smooth?: boolean) => void
  fitAll: (smooth?: boolean) => void
}

/**
 * Figma-style pan/zoom surface, driven imperatively for performance:
 * gestures write the transform straight to the DOM (no React re-render per
 * frame); React state only learns about it when a gesture ends (`onCommit`).
 *  - trackpad scroll / wheel pans; pinch (ctrl+wheel) zooms toward the cursor
 *  - dragging the background pans; double-clicking an area fits it
 */
export const PanZoom = forwardRef<PanZoomHandle, {
  initial: Transform
  onCommit: (t: Transform) => void
  onLive?: (t: Transform) => void
  children: React.ReactNode
  contentRef?: (el: HTMLDivElement | null) => void
}>(function PanZoom({ initial, onCommit, onLive, children, contentRef }, ref) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const live = useRef<Transform>(initial)
  const raf = useRef<number | null>(null)
  const idle = useRef<number | null>(null)
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)

  const paint = useCallback(() => {
    raf.current = null
    const t = live.current
    const el = content.current
    if (!el) return
    el.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`
    const inv = Math.min(4, Math.max(1, 1 / t.k))
    const invBig = Math.min(7, Math.max(1, 1 / t.k))
    el.style.setProperty("--ps-inv", inv.toFixed(2))
    el.style.setProperty("--ps-inv-big", invBig.toFixed(2))
    if (grid.current) grid.current.style.opacity = String(Math.max(0, Math.min(1, (t.k - 0.3) * 3)))
    onLive?.(t)
  }, [onLive])

  const schedule = useCallback(() => {
    if (raf.current == null) raf.current = requestAnimationFrame(paint)
  }, [paint])

  const beginGesture = () => document.documentElement.classList.add("is-panning")
  const endGesture = useCallback(() => {
    document.documentElement.classList.remove("is-panning")
    onCommit({ ...live.current })
  }, [onCommit])

  const setSmooth = (on: boolean) => {
    const el = content.current
    if (!el) return
    el.style.transition = on ? "transform .4s cubic-bezier(.2,.8,.2,1)" : ""
  }

  const apply = useCallback(
    (t: Transform, smooth = false) => {
      live.current = { x: t.x, y: t.y, k: clampK(t.k) }
      setSmooth(smooth)
      paint()
      if (smooth) window.setTimeout(() => setSmooth(false), 420)
      onCommit({ ...live.current })
    },
    [paint, onCommit]
  )

  const fitRect = useCallback(
    (lx: number, ly: number, w: number, h: number, smooth: boolean) => {
      const vp = viewport.current
      if (!vp) return
      const vw = vp.clientWidth
      const vh = vp.clientHeight
      const k = clampK(Math.min((vw - 120) / w, (vh - 200) / h, 2))
      apply({ k, x: (vw - w * k) / 2 - lx * k, y: 140 + (vh - 140 - h * k) / 2 - ly * k }, smooth)
    },
    [apply]
  )

  useImperativeHandle(
    ref,
    () => ({
      get: () => ({ ...live.current }),
      set: (t, smooth) => apply(t, smooth),
      zoomBy: (f, smooth) => {
        const vp = viewport.current
        const t = live.current
        const k2 = clampK(t.k * f)
        const cx = (vp?.clientWidth ?? 0) / 2
        const cy = (vp?.clientHeight ?? 0) / 2
        apply({ k: k2, x: cx - ((cx - t.x) * k2) / t.k, y: cy - ((cy - t.y) * k2) / t.k }, smooth)
      },
      fitTo: (el, smooth) => {
        const root = content.current
        if (!root) return
        const k = live.current.k
        const rr = root.getBoundingClientRect()
        const er = el.getBoundingClientRect()
        fitRect((er.left - rr.left) / k, (er.top - rr.top) / k, er.width / k, er.height / k, !!smooth)
      },
      fitAll: (smooth) => {
        const inner = content.current?.querySelector<HTMLElement>("[data-canvas-root]")
        if (inner) fitRect(0, 0, inner.offsetWidth, inner.offsetHeight, !!smooth)
      },
    }),
    [apply, fitRect]
  )

  // Initial paint + wheel handling (non-passive so we can preventDefault).
  useEffect(() => {
    paint()
    const el = viewport.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      beginGesture()
      const t = live.current
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        const k2 = clampK(t.k * Math.exp(-e.deltaY * 0.014))
        live.current = { k: k2, x: px - ((px - t.x) * k2) / t.k, y: py - ((py - t.y) * k2) / t.k }
      } else {
        live.current = { ...t, x: t.x - e.deltaX, y: t.y - e.deltaY }
      }
      schedule()
      if (idle.current) window.clearTimeout(idle.current)
      idle.current = window.setTimeout(endGesture, 160)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      el.removeEventListener("wheel", onWheel)
      if (raf.current) cancelAnimationFrame(raf.current)
      if (idle.current) window.clearTimeout(idle.current)
    }
  }, [paint, schedule, endGesture])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    drag.current = { px: e.clientX, py: e.clientY, moved: false }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.px
    const dy = e.clientY - drag.current.py
    if (!drag.current.moved) {
      if (Math.hypot(dx, dy) < 3) return
      drag.current.moved = true
      beginGesture()
    }
    drag.current.px = e.clientX
    drag.current.py = e.clientY
    live.current = { ...live.current, x: live.current.x + dx, y: live.current.y + dy }
    schedule()
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current?.moved) {
      const stop = (ev: Event) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      e.currentTarget.addEventListener("click", stop, { capture: true, once: true })
      endGesture()
    }
    drag.current = null
    setDragging(false)
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    const area = (e.target as HTMLElement).closest("[data-toc]")
    if (!area || (e.target as HTMLElement).closest("[data-instance]")) return
    const root = content.current
    if (!root) return
    const k = live.current.k
    const rr = root.getBoundingClientRect()
    const er = area.getBoundingClientRect()
    fitRect((er.left - rr.left) / k, (er.top - rr.top) / k, er.width / k, er.height / k, true)
  }

  return (
    <div
      ref={viewport}
      className="absolute inset-0 overflow-hidden select-none"
      style={{ cursor: dragging ? "grabbing" : "grab", backgroundColor: "var(--ps-canvas-bg)" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <div
        ref={(el) => {
          content.current = el
          contentRef?.(el)
        }}
        className="ps-canvas-content relative"
        style={{ transformOrigin: "0 0", width: "max-content" }}
      >
        <div ref={grid} className="ps-grid" aria-hidden />
        {children}
      </div>
    </div>
  )
})
