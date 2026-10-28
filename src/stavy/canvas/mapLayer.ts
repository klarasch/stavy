// The map's own layer (stavy-content/map.json): notes, Markdown, images and
// arrows placed among the screens. The map lays its areas out automatically,
// so a free item can't keep absolute coordinates: it is anchored to the area
// it sits on (`anchor: "page:dashboard"`, x/y relative to that area's
// top-left) and travels with it when screens are added or grow.
import { useEffect, useState, type RefObject } from "react"
import type { BoardItem } from "../types"
import type { Box } from "../boards/layout"
import type { BoardSpace } from "../boards/editor"
import type { PanZoomHandle } from "./PanZoom"

/** Area boxes in canvas coordinates, keyed by their `data-toc` ("page:x", "area:map", …). */
export type Areas = Record<string, Box>

/** Key prefix of a screen's sticky slot in `Areas` (not an area itself). */
export const SLOT = "slot:"

/** The real areas only (no sticky slots): what notes anchor to and arrows end at. */
export function realAreas(areas: Areas): Areas {
  return Object.fromEntries(Object.entries(areas).filter(([k]) => !k.startsWith(SLOT)))
}

/** Gap between an area and an anchored item written without x/y. */
const BESIDE = 48
const STACK = 260
/** Must match CanvasPage's NOTE_SLOT_H. */
const SLOT_STEP = 150

/** Measure every map area, again whenever the canvas content resizes. */
export function useMapAreas(contentEl: HTMLDivElement | null, pz: RefObject<PanZoomHandle | null>, rev: unknown): Areas {
  const [areas, setAreas] = useState<Areas>({})
  useEffect(() => {
    const root = contentEl?.querySelector<HTMLElement>("[data-canvas-root]")
    if (!contentEl || !root) return
    // A timer, not rAF: a background tab never runs rAF and would never measure.
    let timer: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const c = contentEl.getBoundingClientRect()
        // The scale actually on screen (mid-animation too), not the one the view is heading to.
        const k = contentEl.offsetWidth ? c.width / contentEl.offsetWidth : pz.current?.get().k || 1
        const next: Areas = {}
        const box = (r: DOMRect) => ({
          x: Math.round((r.left - c.left) / k),
          y: Math.round((r.top - c.top) / k),
          w: Math.round(r.width / k),
          h: Math.round(r.height / k),
        })
        for (const el of root.querySelectorAll<HTMLElement>("section.ps-area[data-toc]")) {
          next[el.dataset.toc!] = box(el.getBoundingClientRect())
          // The room a screen keeps for its unplaced stickies (see CanvasPage noteSlots).
          const slot = el.querySelector<HTMLElement>(":scope > * [data-note-slot], :scope [data-note-slot]")
          if (slot) next[`${SLOT}${el.dataset.toc}`] = box(slot.getBoundingClientRect())
        }
        setAreas((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      }, 16)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    for (const el of root.querySelectorAll<HTMLElement>("section.ps-area[data-toc]")) ro.observe(el)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [contentEl, pz, rev])
  return areas
}

type Anchored = BoardItem & { anchor?: string; x?: number; y?: number }

/** The area an item at (x, y) belongs to: the one containing that point, else the nearest. */
export function nearestArea(areas: Areas, x: number, y: number): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const [id, b] of Object.entries(areas)) {
    const dx = x < b.x ? b.x - x : x > b.x + b.w ? x - (b.x + b.w) : 0
    const dy = y < b.y ? b.y - y : y > b.y + b.h ? y - (b.y + b.h) : 0
    const d = Math.hypot(dx, dy)
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  return best
}

/**
 * File ↔ canvas for the map layer. Top-level items carry `anchor` + x/y
 * relative to it; children of sections stay relative to their section.
 * Items whose area isn't on the map right now (a workspace axis hides it) are
 * kept aside and written back untouched.
 */
export function mapSpace(areas: Areas): BoardSpace {
  let aside: BoardItem[] = []
  // Where unplaced items were put for display: saved back without x/y unless moved.
  let auto = new Map<string, { x: number; y: number; anchor: string; w?: number }>()
  const ready = Object.keys(areas).length > 0
  return {
    toView(items) {
      aside = []
      if (!ready) {
        // Not measured yet: show nothing rather than everything at the origin.
        aside = items
        return []
      }
      auto = new Map()
      const stacked: Record<string, number> = {}
      const out: BoardItem[] = []
      for (const raw of items) {
        const it = raw as Anchored
        if (it.type === "arrow" || !it.anchor) {
          out.push(raw)
          continue
        }
        const a = areas[it.anchor]
        if (!a) {
          aside.push(raw)
          continue
        }
        const { anchor: _a, ...rest } = it
        if (it.x == null || it.y == null) {
          const n = (stacked[it.anchor] = (stacked[it.anchor] ?? -1) + 1)
          const slot = areas[`${SLOT}${it.anchor}`]
          // In the screen's own slot when it keeps one, else beside the area.
          const pos = slot ? { x: slot.x, y: slot.y + n * SLOT_STEP } : { x: a.x + a.w + BESIDE, y: a.y + n * STACK }
          const w = slot && rest.w == null ? Math.min(240, slot.w) : undefined
          auto.set(it.id, { ...pos, anchor: it.anchor, w })
          out.push({ ...rest, ...pos, ...(w != null ? { w } : {}) } as BoardItem)
        } else out.push({ ...rest, x: a.x + it.x, y: a.y + it.y } as BoardItem)
      }
      return out
    },
    fromView(items) {
      const out = items.map((raw) => {
        const it = raw as Anchored
        if (it.type === "arrow" || it.x == null || it.y == null) return raw
        const placed = auto.get(it.id)
        if (placed && Math.abs(placed.x - it.x) < 1 && Math.abs(placed.y - it.y) < 1) {
          // Never moved: keep it unplaced (it follows its screen's slot).
          const { x: _x, y: _y, w, ...rest } = it as Anchored & { w?: number }
          void _x
          void _y
          return { ...rest, ...(w != null && w !== placed.w ? { w } : {}), anchor: placed.anchor } as BoardItem
        }
        const id = nearestArea(realAreas(areas), it.x, it.y)
        if (!id) return raw
        const a = areas[id]
        return { ...it, anchor: id, x: Math.round(it.x - a.x), y: Math.round(it.y - a.y) } as BoardItem
      })
      return [...out, ...aside]
    },
  }
}

