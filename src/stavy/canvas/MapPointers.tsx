import { useEffect, useRef, useState } from "react"
import { getPage, instanceKey, resolveDims, snapshotEntry, STATE_DIM } from "../manifest"
import type { BoardItem } from "../types"

/** What a map sticky points at: a screen's state, and optionally an element in it. */
type Pointing = { id: string; screen: string; state?: string; dims?: Record<string, string>; target?: string }

interface Line {
  id: string
  ax: number
  ay: number
  px: number
  py: number
}

/** Stickies on the map that point at something (`screen`, with `state`/`dims` and `target`). */
export function pointingItems(items: BoardItem[] | undefined): Pointing[] {
  const out: Pointing[] = []
  for (const it of items ?? []) {
    const p = it as BoardItem & Partial<Pointing>
    if (it.type === "note" && typeof p.screen === "string") out.push({ id: it.id, screen: p.screen, state: p.state, dims: p.dims, target: p.target })
  }
  return out
}

/**
 * Leader lines from map stickies to what they point at: the state's card on
 * the map, or an element inside it (its box comes from the snapshot index,
 * measured at scan time). Drawn in canvas content coordinates, re-measured
 * when the canvas or the sticky moves, so the line follows a drag.
 */
export function MapPointers({ items, root, getScale }: { items: Pointing[]; root: HTMLElement; getScale: () => number }) {
  const [lines, setLines] = useState<Line[]>([])
  const raf = useRef<number | null>(null)

  useEffect(() => {
    if (!items.length) {
      setLines([])
      return
    }
    const measure = () => {
      raf.current = null
      const k = getScale() || 1
      const rr = root.getBoundingClientRect()
      const local = (x: number, y: number) => ({ x: (x - rr.left) / k, y: (y - rr.top) / k })
      const out: Line[] = []
      for (const it of items) {
        const page = getPage(it.screen)
        const note = root.querySelector<HTMLElement>(`[data-map-layer] [data-item-id="${CSS.escape(it.id)}"]`)
        if (!page || !note) continue
        const raw = { ...(it.dims ?? {}), ...(it.state ? { [STATE_DIM]: it.state } : {}) }
        const dims = resolveDims(page, Object.keys(raw).length ? raw : page.instances?.[0]?.dims ?? {})
        const area = root.querySelector<HTMLElement>(`[data-toc="page:${CSS.escape(page.id)}"]`)
        const card =
          area?.querySelector<HTMLElement>(`[data-instance="${CSS.escape(instanceKey(page.id, dims))}"]`) ??
          area?.querySelector<HTMLElement>("[data-instance]") // folded: the screen's one card
        if (!card) continue
        const frame = (card.querySelector<HTMLElement>(".ps-card-frame") ?? card).getBoundingClientRect()
        const box = it.target ? snapshotEntry(page, dims)?.targets[it.target] : undefined
        const t = box
          ? local(frame.left + frame.width * (box.x + box.w / 2), frame.top + frame.height * (box.y + box.h / 2))
          : local(frame.left + frame.width / 2, frame.top + frame.height / 2)
        const n = note.getBoundingClientRect()
        const tl = local(n.left, n.top)
        const br = local(n.right, n.bottom)
        // Leave the sticky from the side facing the target.
        const cx = (tl.x + br.x) / 2
        const cy = (tl.y + br.y) / 2
        const dx = t.x - cx
        const dy = t.y - cy
        const sx = (br.x - tl.x) / 2
        const sy = (br.y - tl.y) / 2
        const s = Math.min(sx / Math.abs(dx || 1e-6), sy / Math.abs(dy || 1e-6))
        out.push({ id: it.id, ax: cx + dx * s, ay: cy + dy * s, px: t.x, py: t.y })
      }
      setLines((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out))
    }
    const soon = () => {
      if (raf.current == null) raf.current = requestAnimationFrame(measure)
    }
    measure()
    // A background tab never runs rAF: a couple of timed passes catch late layout.
    const timers = [300, 900, 2000].map((ms) => setTimeout(measure, ms))
    const ro = new ResizeObserver(soon)
    ro.observe(root)
    const layer = root.querySelector("[data-map-layer]")
    const mo = new MutationObserver(soon)
    if (layer) mo.observe(layer, { attributes: true, attributeFilter: ["style"], subtree: true, childList: true })
    return () => {
      timers.forEach(clearTimeout)
      ro.disconnect()
      mo.disconnect()
      if (raf.current != null) cancelAnimationFrame(raf.current)
    }
  }, [items, root, getScale])

  if (!lines.length) return null
  return (
    <svg className="absolute inset-0 overflow-visible pointer-events-none" width="100%" height="100%" style={{ zIndex: 4 }} data-ps-ui data-map-pointers>
      <defs>
        <marker id="ps-pointer-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ps-note-line)" />
        </marker>
      </defs>
      {lines.map((p) => {
        const mx = (p.ax + p.px) / 2
        const my = (p.ay + p.py) / 2
        const horizontal = Math.abs(p.px - p.ax) > Math.abs(p.py - p.ay)
        const c1 = horizontal ? `${mx} ${p.ay}` : `${p.ax} ${my}`
        const c2 = horizontal ? `${mx} ${p.py}` : `${p.px} ${my}`
        return (
          <g key={p.id} data-pointer={p.id}>
            <path d={`M ${p.ax} ${p.ay} C ${c1}, ${c2}, ${p.px} ${p.py}`} fill="none" stroke="var(--ps-note-line)" strokeWidth={1.5} strokeLinecap="round" markerEnd="url(#ps-pointer-arrow)" />
            <circle cx={p.ax} cy={p.ay} r={2.5} fill="var(--ps-note-line)" />
          </g>
        )
      })}
    </svg>
  )
}
