import raw from "../../stavy.json"
import type { Manifest, PageDef, Scenario } from "./types"

const full = raw as unknown as Manifest

export const sliceId: string | null = typeof __PROTO_SLICE__ === "undefined" ? null : __PROTO_SLICE__

const slice = sliceId ? full.prototypes.find((p) => p.id === sliceId) ?? null : null

/** The manifest, filtered down to the active prototype slice (if any). */
export const manifest: Manifest = slice
  ? {
      ...full,
      pages: full.pages.filter((p) => slice.pages.includes(p.id)),
      scenarios: full.scenarios.filter((s) => slice.scenarios.includes(s.id)),
    }
  : full

export const activeSlice = slice

export function getPage(pageId: string): PageDef | undefined {
  return manifest.pages.find((p) => p.id === pageId)
}

export function getScenario(id: string): Scenario | undefined {
  return manifest.scenarios.find((s) => s.id === id)
}

export function dimensionLabel(dimId: string): string {
  return manifest.dimensions.find((d) => d.id === dimId)?.label ?? dimId
}

export function valueLabel(dimId: string, valueId: string): string {
  return (
    manifest.dimensions.find((d) => d.id === dimId)?.values.find((v) => v.id === valueId)?.label ??
    valueId
  )
}

/** Resolve the full dimension assignment for a page: overrides > defaults > first value. */
export function resolveDims(page: PageDef, overrides?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [dimId, values] of Object.entries(page.dimensions)) {
    out[dimId] = overrides?.[dimId] ?? page.defaults?.[dimId] ?? values[0]
  }
  return out
}

/** Build a viewer URL for a page + dimension assignment (+ extra query params). */
export function pageUrl(
  pageId: string,
  dims?: Record<string, string>,
  extra?: Record<string, string>
): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(dims ?? {})) sp.set(`d_${k}`, v)
  for (const [k, v] of Object.entries(extra ?? {})) sp.set(k, v)
  const qs = sp.toString()
  return `/p/${pageId}${qs ? `?${qs}` : ""}`
}

/** Parse dimension overrides for a page out of URLSearchParams. */
export function dimsFromParams(page: PageDef, sp: URLSearchParams): Record<string, string> {
  const overrides: Record<string, string> = {}
  for (const dimId of Object.keys(page.dimensions)) {
    const v = sp.get(`d_${dimId}`)
    if (v && page.dimensions[dimId].includes(v)) overrides[dimId] = v
  }
  return resolveDims(page, overrides)
}

/** Stable key identifying a page instance (page + full dimension assignment). */
export function instanceKey(pageId: string, dims: Record<string, string>): string {
  const q = Object.entries(dims)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  return `${pageId}?${q}`
}
