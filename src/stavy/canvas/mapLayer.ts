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

/** Gap between an area and an anchored item written without x/y. */
const BESIDE = 48
const STACK = 260

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
        for (const el of root.querySelectorAll<HTMLElement>("section.ps-area[data-toc]")) {
          const r = el.getBoundingClientRect()
          next[el.dataset.toc!] = {
            x: Math.round((r.left - c.left) / k),
            y: Math.round((r.top - c.top) / k),
            w: Math.round(r.width / k),
            h: Math.round(r.height / k),
          }
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
  const ready = Object.keys(areas).length > 0
  return {
    toView(items) {
      aside = []
      if (!ready) {
        // Not measured yet: show nothing rather than everything at the origin.
        aside = items
        return []
      }
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
          out.push({ ...rest, x: a.x + a.w + BESIDE, y: a.y + n * STACK } as BoardItem)
        } else out.push({ ...rest, x: a.x + it.x, y: a.y + it.y } as BoardItem)
      }
      return out
    },
    fromView(items) {
      const out = items.map((raw) => {
        const it = raw as Anchored
        if (it.type === "arrow" || it.x == null || it.y == null) return raw
        const id = nearestArea(areas, it.x, it.y)
        if (!id) return raw
        const a = areas[id]
        return { ...it, anchor: id, x: Math.round(it.x - a.x), y: Math.round(it.y - a.y) } as BoardItem
      })
      return [...out, ...aside]
    },
  }
}

