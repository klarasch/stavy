import { appBase, getPage, humanize, manifest, snapshotIndex, stateLabel, valueLabel, varyingDims, workspaceBase, STATE_DIM } from "../manifest"
import { resolveDims, variantKey, type Variant } from "../../../scripts/lib/model.mjs"
import type { BoardAction, PageDef, SnapshotEntry } from "../types"
import type { StavyRef } from "./markdown"

/**
 * Board items name states the same way scan does (scripts/lib/collect.mjs),
 * so the card a board shows is exactly the capture scan made:
 *   dims = resolveDims(page, { ...item.dims, _state: item.state })
 *   key  = variantKey(page, dims, { crop, do, viewport })   (instanceKey when plain)
 */

export interface ResolvedShot {
  page: PageDef
  dims: Record<string, string>
  key: string
  variant?: Variant
  entry?: SnapshotEntry
  /** Snapshot URL when the index has one. */
  url: string | null
  label: string
}

export function shotDims(page: PageDef, state?: string, dims?: Record<string, string>): Record<string, string> {
  const raw: Record<string, string> = { ...(dims ?? {}) }
  if (state) {
    if (page.states) raw[STATE_DIM] = state
    else {
      // A dimension page: `state` names a value — of the dimension called
      // "state" if it has one, else of the first dimension that has it.
      const d = "state" in page.dimensions && page.dimensions.state.includes(state) ? "state" : Object.keys(page.dimensions).find((k) => page.dimensions[k].includes(state))
      if (d) raw[d] = state
    }
  }
  return resolveDims(page, raw)
}

export function snapshotHref(entry: SnapshotEntry | undefined): string | null {
  if (!entry?.file) return null
  const v = entry.at ? `?v=${encodeURIComponent(entry.at)}` : ""
  return `${workspaceBase || appBase}/snapshots/${entry.file}${v}`
}

export function resolveShot(
  pageId: string,
  opts: { state?: string; dims?: Record<string, string>; crop?: string; do?: BoardAction[]; viewport?: { width: number; height: number } } = {}
): ResolvedShot | null {
  const page = getPage(pageId)
  if (!page) return null
  const dims = shotDims(page, opts.state, opts.dims)
  const variant: Variant | undefined =
    opts.crop || opts.do?.length || opts.viewport
      ? { ...(opts.crop ? { crop: opts.crop } : {}), ...(opts.do?.length ? { do: opts.do as Variant["do"] } : {}), ...(opts.viewport ? { viewport: opts.viewport } : {}) }
      : undefined
  const key = variantKey(page.id, dims, variant ?? {})
  const entry = snapshotIndex[key]
  return { page, dims, key, variant, entry, url: snapshotHref(entry), label: shotLabel(page, dims) }
}

/** A state's human name: its named-state label, or the values that make it this state. */
export function shotLabel(page: PageDef, dims: Record<string, string>, among?: Record<string, string>[]): string {
  if (page.states) return stateLabel(page, dims[STATE_DIM])
  const varying = among ? varyingDims(page, among) : Object.keys(page.dimensions).filter((d) => page.dimensions[d].length > 1 && dims[d] !== (page.defaults?.[d] ?? page.dimensions[d][0]))
  if (!varying.length) return page.label
  return varying.map((d) => valueLabel(d, dims[d])).join(" · ")
}

/** Resolve a Markdown `stavy:` reference to a shot. */
export function resolveRef(ref: StavyRef): ResolvedShot | null {
  return resolveShot(ref.page, { state: ref.state, dims: ref.dims })
}

/**
 * The states a `states` item shows: its `states` list (state ids, instance
 * indexes as strings, or `dim=value,dim=value`), default every pinned
 * instance of the page — the same set scan captures.
 */
export function statesOf(page: PageDef, refs?: string[]): Array<{ ref: string; dims: Record<string, string>; note?: string }> {
  const insts = page.instances ?? [{ dims: {} }]
  const wanted = refs?.length ? refs.map(String) : insts.map((_, i) => String(i))
  const out: Array<{ ref: string; dims: Record<string, string>; note?: string }> = []
  for (const ref of wanted) {
    const named = page.states?.find((s) => s.id === ref)
    if (named) {
      out.push({ ref, dims: resolveDims(page, { [STATE_DIM]: named.id }), note: named.note })
      continue
    }
    if (/^\d+$/.test(ref) && insts[Number(ref)]) {
      const inst = insts[Number(ref)]
      out.push({ ref, dims: resolveDims(page, inst.dims), note: inst.note })
      continue
    }
    if (ref.includes("=")) {
      const dims = Object.fromEntries(ref.split(/[,&]/).map((kv) => kv.split("=").map((s) => s.trim())))
      out.push({ ref, dims: resolveDims(page, dims) })
    }
  }
  return out
}

/** Pages and their states, flattened for the "add screen" picker. */
export function pickableStates(): Array<{ page: PageDef; label: string; state?: string; dims?: Record<string, string>; search: string }> {
  const out: Array<{ page: PageDef; label: string; state?: string; dims?: Record<string, string>; search: string }> = []
  for (const page of manifest.pages) {
    const all = (page.instances ?? [{ dims: {} }]).map((i) => resolveDims(page, i.dims))
    for (const dims of all) {
      const state = page.states ? dims[STATE_DIM] : undefined
      const label = shotLabel(page, dims, all)
      // Only the dims that differ from the defaults are worth writing into the board.
      const explicit = page.states ? undefined : Object.fromEntries(Object.entries(dims).filter(([d, v]) => v !== (page.defaults?.[d] ?? page.dimensions[d][0])))
      out.push({ page, label, state, dims: explicit && Object.keys(explicit).length ? explicit : undefined, search: `${page.label} ${page.id} ${label}`.toLowerCase() })
    }
  }
  return out
}

export { humanize }
