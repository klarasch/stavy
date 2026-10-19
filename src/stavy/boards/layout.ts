import type { BoardItem, SectionItem } from "../types"

/**
 * Board auto-layout — a pure function from items (+ their measured sizes) to
 * positions, so an agent can write a board with zero coordinates and get a
 * calm, balanced result, and the result is the same on every load.
 *
 * Rules, per level (the board, or a section's children):
 *  - Items with both `x` and `y` stay where they are (board pixels,
 *    relative to their parent's content box).
 *  - The rest flow in the order written, starting under the placed ones:
 *    rows that wrap (default), a single column, or a grid.
 *  - A section's size is its children's bounding box plus its frame, unless
 *    it carries its own `w` / `h`; a collapsed section is just its title bar.
 * Arrows take no space and are ignored here (see `arrowPath`).
 */

export interface Size {
  w: number
  h: number
}
export interface Box extends Size {
  x: number
  y: number
}
export type Sizes = Record<string, Size>

export interface LayoutOptions {
  direction?: "row" | "column"
  gap?: number
  maxWidth?: number
}

export interface BoardLayout {
  /** Each item's box relative to its parent's content box (what x/y mean). */
  local: Record<string, Box>
  /** Each item's box in board coordinates (for arrows, fitting, hit-testing). */
  abs: Record<string, Box>
  /** Bounding box of the whole board (board coordinates). */
  bbox: Box
}

/** A section's frame around its children (its title sits above the frame, like a Figma section). */
export const SECTION_PAD = { top: 32, side: 28, bottom: 28 }
/** Height of a collapsed section (a one-line summary). */
export const SECTION_COLLAPSED_H = 48
export const BOARD_GAP = 72
export const SECTION_GAP = 28
/** A balanced board reads like a page from orbit: aim the wrap width at this aspect ratio. */
const TARGET_ASPECT = 16 / 10
const MAX_AUTO_WIDTH = 4200

export const isPlaced = (it: BoardItem) => it.type !== "arrow" && it.x != null && it.y != null

/**
 * A first guess at an item's rendered size, used before the DOM has been
 * measured (and in tests). Close enough that the first paint does not jump.
 */
export function estimateSize(item: BoardItem): Size {
  switch (item.type) {
    case "screen": {
      const w = item.w ?? (item.crop ? 420 : 360)
      return { w, h: Math.round(w * (item.crop ? 0.45 : 9 / 16)) + (item.title ? 26 : 0) + (item.note ? 36 : 0) }
    }
    case "states": {
      const n = item.states?.length ?? 4
      const cols = item.layout === "grid" ? item.columns ?? Math.min(n, 3) : n
      const rows = Math.ceil(n / cols)
      return { w: item.w ?? cols * 280 + (cols - 1) * 20, h: rows * 200 + (item.title ? 26 : 0) }
    }
    case "flow":
      return { w: item.w ?? 5 * 200 + 4 * 28, h: item.collapsed ? 120 : 260 }
    case "markdown":
      return { w: item.w ?? 520, h: item.h ?? 320 }
    case "note":
      return { w: item.w ?? 240, h: item.h ?? 150 }
    case "image":
      return { w: item.w ?? 480, h: item.h ?? 320 }
    case "mermaid":
      return { w: item.w ?? 560, h: item.h ?? 360 }
    case "section":
      return { w: item.w ?? 600, h: item.h ?? 400 }
    default:
      return { w: 0, h: 0 }
  }
}

/** Wrap width that makes a set of boxes come out at roughly TARGET_ASPECT. */
export function balancedWidth(sizes: Size[], gap: number): number {
  if (!sizes.length) return 0
  const widest = Math.max(...sizes.map((s) => s.w))
  const area = sizes.reduce((a, s) => a + (s.w + gap) * (s.h + gap), 0)
  return Math.round(Math.min(MAX_AUTO_WIDTH, Math.max(widest, Math.sqrt(area * TARGET_ASPECT))))
}

interface Level {
  local: Record<string, Box>
  /** Content size of this level (from 0,0 to the far edges of its items). */
  w: number
  h: number
}

function flow(
  entries: { id: string; size: Size }[],
  mode: "row" | "column" | "grid" | "wrap",
  gap: number,
  maxWidth: number,
  columns: number | undefined,
  originY: number,
  out: Record<string, Box>
) {
  if (mode === "column") {
    let y = originY
    for (const e of entries) {
      out[e.id] = { x: 0, y, ...e.size }
      y += e.size.h + gap
    }
    return
  }
  if (mode === "grid") {
    const cols = Math.max(1, columns ?? Math.ceil(Math.sqrt(entries.length)))
    const colW: number[] = []
    const rowH: number[] = []
    entries.forEach((e, i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      colW[c] = Math.max(colW[c] ?? 0, e.size.w)
      rowH[r] = Math.max(rowH[r] ?? 0, e.size.h)
    })
    const colX = colW.map((_, c) => colW.slice(0, c).reduce((a, w) => a + w + gap, 0))
    const rowY = rowH.map((_, r) => originY + rowH.slice(0, r).reduce((a, h) => a + h + gap, 0))
    entries.forEach((e, i) => {
      out[e.id] = { x: colX[i % cols], y: rowY[Math.floor(i / cols)], ...e.size }
    })
    return
  }
  // row (wraps only at maxWidth) and wrap (balanced) are the same walk.
  let x = 0
  let y = originY
  let rowH = 0
  for (const e of entries) {
    if (x > 0 && x + e.size.w > maxWidth) {
      x = 0
      y += rowH + gap
      rowH = 0
    }
    out[e.id] = { x, y, ...e.size }
    x += e.size.w + gap
    rowH = Math.max(rowH, e.size.h)
  }
}

function sizeOf(item: BoardItem, sizes: Sizes, nested: Map<string, Level>): Size {
  if (item.type === "section") {
    const inner = nested.get(item.id)!
    if (item.collapsed) return { w: item.w ?? Math.max(320, inner.w + SECTION_PAD.side * 2), h: SECTION_COLLAPSED_H }
    return {
      w: item.w ?? Math.max(320, inner.w + SECTION_PAD.side * 2),
      h: item.h ?? Math.max(160, inner.h + SECTION_PAD.top + SECTION_PAD.bottom),
    }
  }
  const s = sizes[item.id] ?? estimateSize(item)
  return { w: s.w, h: s.h }
}

function layoutLevel(
  items: BoardItem[],
  sizes: Sizes,
  mode: "row" | "column" | "grid" | "wrap",
  gap: number,
  maxWidth: number | undefined,
  columns: number | undefined,
  nested: Map<string, Level>,
  local: Record<string, Box>
): Level {
  // Children first: a section's size depends on its content.
  for (const it of items) {
    if (it.type !== "section") continue
    const inner = it.w != null ? it.w - SECTION_PAD.side * 2 : undefined
    const childMode = it.layout ?? "wrap"
    nested.set(it.id, layoutLevel(it.items ?? [], sizes, childMode, SECTION_GAP, inner, it.columns, nested, local))
  }
  const visible = items.filter((it) => it.type !== "arrow")
  const placed = visible.filter(isPlaced)
  const auto = visible.filter((it) => !isPlaced(it))
  for (const it of placed) local[it.id] = { x: it.x!, y: it.y!, ...sizeOf(it, sizes, nested) }
  const placedBottom = placed.length ? Math.max(...placed.map((it) => local[it.id].y + local[it.id].h)) : null
  const entries = auto.map((it) => ({ id: it.id, size: sizeOf(it, sizes, nested) }))
  const wrapAt =
    maxWidth ?? (mode === "row" ? Infinity : balancedWidth(entries.map((e) => e.size), gap))
  flow(entries, mode, gap, wrapAt, columns, placedBottom == null ? 0 : placedBottom + gap, local)
  let w = 0
  let h = 0
  for (const it of visible) {
    const b = local[it.id]
    w = Math.max(w, b.x + b.w)
    h = Math.max(h, b.y + b.h)
  }
  return { local, w, h }
}

/**
 * Lay out a whole board. `sizes` holds measured sizes by item id (sections
 * are always computed from their children, never measured); anything not
 * measured yet uses `estimateSize`.
 */
export function layoutBoard(items: BoardItem[], sizes: Sizes = {}, opts: LayoutOptions = {}): BoardLayout {
  const gap = opts.gap ?? BOARD_GAP
  const local: Record<string, Box> = {}
  const nested = new Map<string, Level>()
  const mode = opts.direction === "column" ? "column" : "wrap"
  layoutLevel(items, sizes, mode, gap, opts.maxWidth, undefined, nested, local)

  const abs: Record<string, Box> = {}
  const walk = (list: BoardItem[], ox: number, oy: number, hidden: boolean) => {
    for (const it of list) {
      if (it.type === "arrow" || hidden) continue
      const b = local[it.id]
      abs[it.id] = { ...b, x: b.x + ox, y: b.y + oy }
      if (it.type === "section") walk(it.items ?? [], ox + b.x + SECTION_PAD.side, oy + b.y + SECTION_PAD.top, !!it.collapsed)
    }
  }
  walk(items, 0, 0, false)

  const top = items.filter((it) => it.type !== "arrow").map((it) => local[it.id])
  const bbox = top.length
    ? (() => {
        const x = Math.min(...top.map((b) => b.x))
        const y = Math.min(...top.map((b) => b.y))
        return { x, y, w: Math.max(...top.map((b) => b.x + b.w)) - x, h: Math.max(...top.map((b) => b.y + b.h)) - y }
      })()
    : { x: 0, y: 0, w: 0, h: 0 }
  return { local, abs, bbox }
}

/* ------------------------------------------------------------------ */
/* Arrows                                                              */
/* ------------------------------------------------------------------ */

/**
 * An elbow connector between two boxes, leaving and entering through the
 * nearest edges: side to side when the boxes are more apart horizontally,
 * top/bottom otherwise. Returns the SVG path and the label's anchor point.
 */
export function arrowPath(a: Box, b: Box): { d: string; mid: { x: number; y: number }; end: { x: number; y: number; dir: "l" | "r" | "u" | "d" } } {
  const acx = a.x + a.w / 2
  const acy = a.y + a.h / 2
  const bcx = b.x + b.w / 2
  const bcy = b.y + b.h / 2
  // Gaps between the boxes on each axis (negative when they overlap on it).
  const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
  const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
  if (gx >= gy) {
    const right = bcx >= acx
    const x1 = right ? a.x + a.w : a.x
    const x2 = right ? b.x : b.x + b.w
    const y1 = acy
    const y2 = bcy
    if (Math.abs(y1 - y2) < 2) return { d: `M${x1},${y1} L${x2},${y2}`, mid: { x: (x1 + x2) / 2, y: y1 }, end: { x: x2, y: y2, dir: right ? "r" : "l" } }
    const mx = (x1 + x2) / 2
    return { d: `M${x1},${y1} H${mx} V${y2} H${x2}`, mid: { x: mx, y: (y1 + y2) / 2 }, end: { x: x2, y: y2, dir: right ? "r" : "l" } }
  }
  const down = bcy >= acy
  const y1 = down ? a.y + a.h : a.y
  const y2 = down ? b.y : b.y + b.h
  const x1 = acx
  const x2 = bcx
  if (Math.abs(x1 - x2) < 2) return { d: `M${x1},${y1} L${x2},${y2}`, mid: { x: x1, y: (y1 + y2) / 2 }, end: { x: x2, y: y2, dir: down ? "d" : "u" } }
  const my = (y1 + y2) / 2
  return { d: `M${x1},${y1} V${my} H${x2} V${y2}`, mid: { x: (x1 + x2) / 2, y: my }, end: { x: x2, y: y2, dir: down ? "d" : "u" } }
}

/* ------------------------------------------------------------------ */
/* Tree helpers (pure; the editor builds on these)                     */
/* ------------------------------------------------------------------ */

/** Depth-first visit of every item, with its parent section (null at the top). */
export function walkItems(items: BoardItem[], fn: (it: BoardItem, parent: SectionItem | null) => void, parent: SectionItem | null = null) {
  for (const it of items) {
    fn(it, parent)
    if (it.type === "section") walkItems(it.items ?? [], fn, it)
  }
}

export function findItem(items: BoardItem[], id: string): BoardItem | undefined {
  let hit: BoardItem | undefined
  walkItems(items, (it) => {
    if (!hit && it.id === id) hit = it
  })
  return hit
}

/** The list (top level or a section's `items`) that holds `id`. */
export function siblingsOf(items: BoardItem[], id: string): BoardItem[] | undefined {
  if (items.some((it) => it.id === id)) return items
  for (const it of items) {
    if (it.type !== "section") continue
    const s = siblingsOf(it.items ?? [], id)
    if (s) return s
  }
  return undefined
}

/** Map every item (deep), returning a new tree; return `null` to drop an item. Unknown fields survive. */
export function mapItems(items: BoardItem[], fn: (it: BoardItem) => BoardItem | null): BoardItem[] {
  const out: BoardItem[] = []
  for (const it of items) {
    const next = fn(it)
    if (!next) continue
    out.push(next.type === "section" && next.items ? { ...next, items: mapItems(next.items, fn) } : next)
  }
  return out
}

/** Every id in use, deep. */
export function allIds(items: BoardItem[]): Set<string> {
  const ids = new Set<string>()
  walkItems(items, (it) => ids.add(it.id))
  return ids
}

/** A fresh id like `note-3` that is not taken yet. */
export function freshId(prefix: string, taken: Set<string>): string {
  let i = 1
  while (taken.has(`${prefix}-${i}`)) i++
  const id = `${prefix}-${i}`
  taken.add(id)
  return id
}

/** Give every item without an id one (agents forget), in place on a copy. */
export function ensureIds(items: BoardItem[]): BoardItem[] {
  const taken = allIds(items)
  return mapItems(items, (it) => (it.id ? it : ({ ...it, id: freshId(it.type, taken) } as BoardItem)))
}

export function snap(v: number, grid = 8) {
  return Math.round(v / grid) * grid
}
