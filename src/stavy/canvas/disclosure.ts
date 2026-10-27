// Progressive disclosure on the map. The map is an overview: one card per
// screen, flows folded to a line, boards as chips. Every state is one click
// away, and what is open lives in the URL like all viewer state:
//   x=dashboard,expenses   screens shown with all their states
//   fl=employee-submits    flows shown step by step
//   bx=ia,coverage         boards shown in full
//   states=all             everything open
import type { PageDef } from "../types"
import { resolveDims, workspaceOverridesFor } from "../manifest"

export type DisclosureKind = "screens" | "lanes" | "boards"
export const LIST_PARAM: Record<DisclosureKind, string> = { screens: "x", lanes: "fl", boards: "bx" }
const KINDS = Object.keys(LIST_PARAM) as DisclosureKind[]

export interface Disclosure {
  all: boolean
  screens: Set<string>
  lanes: Set<string>
  boards: Set<string>
}

export function parseList(v: string | null): string[] {
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []
}

export function readDisclosure(sp: URLSearchParams): Disclosure {
  return {
    all: sp.get("states") === "all",
    screens: new Set(parseList(sp.get(LIST_PARAM.screens))),
    lanes: new Set(parseList(sp.get(LIST_PARAM.lanes))),
    boards: new Set(parseList(sp.get(LIST_PARAM.boards))),
  }
}

export function isOpen(d: Disclosure, kind: DisclosureKind, id: string): boolean {
  return d.all || d[kind].has(id)
}

/** Every id of each kind currently on the map, in map order. */
export type Universe = Record<DisclosureKind, string[]>

/**
 * Open or close some ids. Closing one thing while everything is open turns
 * `states=all` into explicit lists of everything else, so the link still
 * says exactly what is shown. Lists are written in map order.
 */
export function setOpen(sp: URLSearchParams, kind: DisclosureKind, ids: string[], open: boolean, universe: Universe): URLSearchParams {
  const next = new URLSearchParams(sp)
  const d = readDisclosure(sp)
  if (d.all) {
    if (open) return next
    next.delete("states")
    for (const k of KINDS) d[k] = new Set(universe[k])
  }
  for (const id of ids) {
    if (open) d[kind].add(id)
    else d[kind].delete(id)
  }
  for (const k of KINDS) {
    const order = universe[k]
    const list = [...d[k]].sort((a, b) => rank(order, a) - rank(order, b))
    if (list.length) next.set(LIST_PARAM[k], list.join(","))
    else next.delete(LIST_PARAM[k])
  }
  return next
}

const rank = (order: string[], id: string) => {
  const i = order.indexOf(id)
  return i < 0 ? order.length : i
}

/** "All states" on or off; either way the per-item lists are dropped. */
export function setAll(sp: URLSearchParams, on: boolean): URLSearchParams {
  const next = new URLSearchParams(sp)
  for (const k of KINDS) next.delete(LIST_PARAM[k])
  if (on) next.set("states", "all")
  else next.delete("states")
  return next
}

/**
 * The card a folded screen shows: its first pinned instance the active
 * workspace allows (the same one the site map uses), else its defaults.
 */
export function overviewDims(page: PageDef, wdims: Record<string, string>): Record<string, string> {
  const wOver = workspaceOverridesFor(page, wdims)
  const inst = (page.instances ?? []).find((i) => Object.entries(wOver).every(([d, v]) => !i.dims[d] || i.dims[d] === v))
  return resolveDims(page, { ...inst?.dims, ...wOver })
}

/** How many cards a screen has in the active workspace (instances pinned to another world drop out). */
export function stateCount(page: PageDef, wdims: Record<string, string>): number {
  const wOver = workspaceOverridesFor(page, wdims)
  return (page.instances ?? [{ dims: {} }]).filter((i) => Object.entries(wOver).every(([d, v]) => !i.dims[d] || i.dims[d] === v)).length
}

/* ------------------------------------------------------------------ */
/* Packing. Folded screens are tiles of one size: they sit in a grid.  */
/* An open screen breaks the grid and takes the full width, wrapping   */
/* with open neighbours. Order is always kept, so opening one screen   */
/* moves the ones after it, never the ones before.                     */
/* ------------------------------------------------------------------ */

export interface ShelfItem {
  id: string
  open: boolean
  /** Estimated size in canvas px; only used to pick the width. */
  w: number
  h: number
}

export interface Run {
  open: boolean
  ids: string[]
}

/** Consecutive items with the same open flag. */
export function runsOf(items: ShelfItem[]): Run[] {
  const out: Run[] = []
  for (const it of items) {
    const last = out[out.length - 1]
    if (last && last.open === it.open) last.ids.push(it.id)
    else out.push({ open: it.open, ids: [it.id] })
  }
  return out
}

/** Overall shape the map aims for when zoomed out. */
export const TARGET_ASPECT = 16 / 10
export const MAX_WIDTH = 4200

/**
 * Width the screens are laid out in: about 16:10 for their total area, at
 * least three tiles wide (or as many as there are), never narrower than the
 * widest open screen, and capped.
 */
export function shelfWidth(items: ShelfItem[], tileW: number, gap: number): number {
  if (!items.length) return tileW
  const area = items.reduce((s, it) => s + (it.w + gap) * (it.h + gap), 0)
  const minTiles = Math.min(3, items.length)
  const min = minTiles * tileW + (minTiles - 1) * gap
  const widest = Math.max(0, ...items.filter((it) => it.open).map((it) => it.w))
  const w = Math.sqrt(area * TARGET_ASPECT)
  return Math.round(Math.max(min, widest, Math.min(MAX_WIDTH, w)))
}

/** Tiles per grid row for a given width. */
export function shelfColumns(width: number, tileW: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (tileW + gap)))
}
