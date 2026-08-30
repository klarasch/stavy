import raw from "../../stavy.json"
import type { Dimension, Manifest, PageDef, Scenario } from "./types"

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

/** Path prefix the viewer is mounted under (manifest `viewer.base`), without trailing slash. "" at root. */
export const viewerBase: string = (full.viewer?.base ?? "").replace(/\/+$/, "")

/** URL of the canvas (the viewer home), optionally carrying mode flags (e.g. `w=1`). */
export function canvasUrl(extra?: Record<string, string>): string {
  const base = viewerBase || "/"
  const qs = extra ? new URLSearchParams(extra).toString() : ""
  return qs ? `${base}?${qs}` : base
}

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

/* ------------------------------------------------------------------ */
/* Workspace-scoped dimensions (SPEC §1.1)                             */
/*                                                                     */
/* A page-scoped axis answers "where in this screen am I" and resets    */
/* when another page opens. A workspace-scoped axis answers "which      */
/* world am I looking at" — release phase, role, locale — so it is      */
/* chosen once in the chrome and survives every navigation.             */
/* ------------------------------------------------------------------ */

/** Dimensions declared `scope: "workspace"`, in manifest order. */
export const workspaceDimensions: Dimension[] = manifest.dimensions.filter((d) => d.scope === "workspace")

const workspaceDimIds = new Set(workspaceDimensions.map((d) => d.id))

export function isWorkspaceDim(dimId: string): boolean {
  return workspaceDimIds.has(dimId)
}

/** The active workspace assignment: `d_<dim>` when it names a declared value, else the first value. */
export function workspaceDimsFromParams(sp: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of workspaceDimensions) {
    const v = sp.get(`d_${d.id}`)
    out[d.id] = v && d.values.some((x) => x.id === v) ? v : d.values[0].id
  }
  return out
}

/**
 * The `d_<dim>` params a workspace assignment must keep alive across every
 * in-viewer navigation. Default values are omitted so links stay clean.
 */
export function workspaceCarry(sp: URLSearchParams): Record<string, string> {
  const active = workspaceDimsFromParams(sp)
  const out: Record<string, string> = {}
  for (const d of workspaceDimensions) if (active[d.id] !== d.values[0].id) out[`d_${d.id}`] = active[d.id]
  return out
}

/**
 * Stable key for the active workspace assignment. `useSearchParams` hands out a
 * fresh object on every URL write (the canvas writes its viewport constantly),
 * so memoise on this string — memoising on `sp` re-renders every card on every
 * pan and zoom.
 */
export function workspaceKey(sp: URLSearchParams): string {
  return workspaceDimensions.map((d) => sp.get(`d_${d.id}`) ?? "").join("|")
}

/** The subset of a workspace assignment a page actually supports — seeds its dims. */
export function workspaceOverridesFor(page: PageDef, wdims: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [d, v] of Object.entries(wdims)) if (page.dimensions[d]?.includes(v)) out[d] = v
  return out
}

/**
 * Does this page exist in this workspace assignment? A page that does not
 * declare the axis at all is unaffected by it — only a page that declares it
 * and excludes the active value is out of scope.
 */
export function pageInWorkspace(page: PageDef, wdims: Record<string, string>): boolean {
  return Object.entries(wdims).every(([d, v]) => !(d in page.dimensions) || page.dimensions[d].includes(v))
}

/** A scenario is in scope when every step's page is, and no step pins a different workspace value. */
export function scenarioInWorkspace(sc: Scenario, wdims: Record<string, string>): boolean {
  return sc.steps.every((st) => {
    const page = getPage(st.page)
    if (!page) return true
    if (!pageInWorkspace(page, wdims)) return false
    return Object.entries(wdims).every(([d, v]) => !st.dims?.[d] || st.dims[d] === v)
  })
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
  return `${viewerBase}/p/${pageId}${qs ? `?${qs}` : ""}`
}

/** Parse dimension overrides for a page out of URLSearchParams. */
export function dimsFromParams(page: PageDef, sp: URLSearchParams): Record<string, string> {
  const wdims = workspaceDimsFromParams(sp)
  const overrides: Record<string, string> = {}
  for (const dimId of Object.keys(page.dimensions)) {
    // A workspace axis is decided for the whole workspace: the active value wins
    // over this page's own default (which would otherwise differ page to page).
    if (isWorkspaceDim(dimId) && page.dimensions[dimId].includes(wdims[dimId])) {
      overrides[dimId] = wdims[dimId]
      continue
    }
    const v = sp.get(`d_${dimId}`)
    if (v && page.dimensions[dimId].includes(v)) overrides[dimId] = v
  }
  return resolveDims(page, overrides)
}

/**
 * URL of the instance's pre-rendered snapshot (scripts/snapshot.mjs writes
 * `public/snapshots/<page>__<dim=value>__….png`, dims in declaration order).
 * Purely optional raster fallback: cards try it as their placeholder and fall
 * back to a label when the file doesn't exist (404s are expected and cheap).
 */
export function snapshotUrl(page: PageDef, dims: Record<string, string>): string {
  const full = resolveDims(page, dims)
  const name = `${page.id}__${Object.keys(page.dimensions)
    .map((d) => `${d}=${full[d]}`)
    .join("__")}.png`
  return `${import.meta.env.BASE_URL}snapshots/${name}`
}

/** Stable key identifying a page instance (page + full dimension assignment). */
export function instanceKey(pageId: string, dims: Record<string, string>): string {
  const q = Object.entries(dims)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  return `${pageId}?${q}`
}
