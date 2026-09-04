import type { Dimension, Manifest, PageDef, Scenario, SnapshotEntry, SnapshotIndex } from "./types"

/* ------------------------------------------------------------------ */
/* Where things are                                                    */
/*                                                                     */
/* The viewer is a static page served *next to* the prototype, e.g.     */
/*   https://host/          → the prototype                             */
/*   https://host/stavy/    → this viewer                               */
/*   https://host/stavy.json                                            */
/*   https://host/snapshots/…png + index.json                           */
/* Both bases are derived from the viewer's own location, so the same   */
/* build works at the root, under a sub-path, or on GitHub Pages.       */
/* ------------------------------------------------------------------ */

const path = typeof location !== "undefined" ? location.pathname : "/"
const isFile = /\.html$/.test(path)
/** Directory the viewer is served from, without trailing slash ("" at root). */
const viewerDir = (isFile ? path.replace(/\/[^/]*$/, "") : path).replace(/\/+$/, "")
/**
 * Prefix every viewer link starts with. When the viewer was opened as
 * `/stavy/index.html` (static hosts without a directory index, Vite's
 * `public/` in dev) links keep the file name so they keep working.
 */
export const viewerBase: string = isFile ? path : viewerDir
/** Path prefix the prototype is served under: the parent of the viewer (override: manifest `viewer.app`). */
export let appBase: string = viewerDir.replace(/\/[^/]*$/, "")
/** viewerBase + the separator before a query string. */
const viewerHref = isFile ? viewerBase : `${viewerBase}/`

export let manifest: Manifest = {
  version: "0.2",
  product: { name: "" },
  dimensions: [],
  pages: [],
  scenarios: [],
}

/** instanceKey → snapshot entry, written by scripts/scan.mjs. Empty until loaded / when absent. */
export let snapshotIndex: SnapshotIndex = {}

export const DEFAULT_TARGET_ATTRS = ["data-proto", "data-testid"]

/** Load the manifest (and the optional snapshot index). Call once before rendering. */
export async function loadManifest(url?: string): Promise<Manifest> {
  const src = url ?? `${appBase}/stavy.json`
  const res = await fetch(src, { cache: "no-store" })
  if (!res.ok) throw new Error(`${src} → ${res.status}`)
  setManifest((await res.json()) as Manifest)
  try {
    const ir = await fetch(`${appBase}/snapshots/index.json`, { cache: "no-store" })
    if (ir.ok) snapshotIndex = (await ir.json()) as SnapshotIndex
  } catch {
    /* no snapshots yet — cards show labels */
  }
  return manifest
}

/** Install a manifest object directly (tests, embedding). */
export function setManifest(m: Manifest) {
  manifest = m
  if (m.viewer?.app !== undefined) appBase = m.viewer.app.replace(/\/+$/, "")
  workspaceDimensions = m.dimensions.filter((d) => d.scope === "workspace")
  workspaceDimIds = new Set(workspaceDimensions.map((d) => d.id))
}

/* ------------------------------------------------------------------ */
/* URLs                                                                */
/* ------------------------------------------------------------------ */

/** URL of the canvas (the viewer home), optionally carrying mode flags (e.g. `w=1`). */
export function canvasUrl(extra?: Record<string, string>): string {
  const qs = extra ? new URLSearchParams(extra).toString() : ""
  return `${viewerHref}${qs ? `?${qs}` : ""}`
}

/**
 * Viewer URL of the player for a page + dimension assignment (+ extra query
 * params). The viewer routes purely by query string (`?p=<page>`) so it works
 * from any static host without rewrite rules.
 */
export function pageUrl(pageId: string, dims?: Record<string, string>, extra?: Record<string, string>): string {
  const sp = new URLSearchParams()
  sp.set("p", pageId)
  for (const [k, v] of Object.entries(dims ?? {})) sp.set(`d_${k}`, v)
  for (const [k, v] of Object.entries(extra ?? {})) sp.set(k, v)
  return `${viewerHref}?${sp.toString()}`
}

/**
 * THE contract, resolved: the prototype's own URL for a page at a dimension
 * assignment — the page's `url` template with `{dim}` placeholders filled.
 * Relative templates are served from the app base; absolute ones are used as-is.
 */
export function appUrl(page: PageDef, dims: Record<string, string>): string {
  const full = resolveDims(page, dims)
  const filled = page.url.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, d: string) => encodeURIComponent(full[d] ?? ""))
  if (/^[a-z]+:\/\//i.test(filled)) return filled
  return `${appBase}${filled.startsWith("/") ? "" : "/"}${filled}`
}

/** Dimension ids a url template references. */
export function urlDims(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z0-9_-]+)\}/g)].map((m) => m[1])
}

/* ------------------------------------------------------------------ */
/* Targets                                                             */
/* ------------------------------------------------------------------ */

const BARE_ID = /^[A-Za-z][\w:.-]*$/

/**
 * Selector for a target reference. A bare id (`ApproveButton`,
 * `ExpenseRow:exp-2101`) is looked up in `viewer.targetAttrs`
 * (default data-proto, then data-testid); anything else is a CSS selector.
 */
export function targetSelector(target: string): string {
  if (!BARE_ID.test(target)) return target
  const attrs = manifest.viewer?.targetAttrs?.length ? manifest.viewer.targetAttrs : DEFAULT_TARGET_ATTRS
  const v = target.replace(/["\\]/g, "\\$&")
  return attrs.map((a) => `[${a}="${v}"]`).join(", ")
}

/** Find a target inside a document or element (the prototype's, usually). */
export function findTarget(root: ParentNode | null | undefined, target: string): HTMLElement | null {
  if (!root) return null
  try {
    return root.querySelector<HTMLElement>(targetSelector(target))
  } catch {
    return null
  }
}

/** The target id an element (or its nearest ancestor) carries, if any. */
export function targetIdOf(el: Element | null): string | null {
  const attrs = manifest.viewer?.targetAttrs?.length ? manifest.viewer.targetAttrs : DEFAULT_TARGET_ATTRS
  let cur: Element | null = el
  while (cur) {
    for (const a of attrs) {
      const v = cur.getAttribute(a)
      if (v) return v
    }
    cur = cur.parentElement
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export function getPage(pageId: string): PageDef | undefined {
  return manifest.pages.find((p) => p.id === pageId)
}

export function getScenario(id: string): Scenario | undefined {
  return manifest.scenarios.find((s) => s.id === id)
}

export function getTemplate(id: string | undefined) {
  return id ? manifest.templates?.find((t) => t.id === id) : undefined
}

export function dimensionLabel(dimId: string): string {
  return manifest.dimensions.find((d) => d.id === dimId)?.label ?? dimId
}

export function valueLabel(dimId: string, valueId: string): string {
  return manifest.dimensions.find((d) => d.id === dimId)?.values.find((v) => v.id === valueId)?.label ?? valueId
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
export let workspaceDimensions: Dimension[] = []
let workspaceDimIds = new Set<string>()

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

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

/** Stable key identifying a page instance (page + full dimension assignment). */
export function instanceKey(pageId: string, dims: Record<string, string>): string {
  const q = Object.entries(dims)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  return `${pageId}?${q}`
}

/** Conventional snapshot file name for an instance (what scripts/scan.mjs writes). */
export function snapshotFile(page: PageDef, dims: Record<string, string>): string {
  const full = resolveDims(page, dims)
  return `${page.id}__${Object.keys(page.dimensions)
    .map((d) => `${d}=${full[d]}`)
    .join("__")}.png`
}

/** The scan entry for an instance, if the index has one. */
export function snapshotEntry(page: PageDef, dims: Record<string, string>): SnapshotEntry | undefined {
  return snapshotIndex[instanceKey(page.id, resolveDims(page, dims))]
}

/**
 * URL of the instance's pre-rendered snapshot. Cards use it as their
 * far-view image and fall back to a label when the file doesn't exist.
 */
export function snapshotUrl(page: PageDef, dims: Record<string, string>): string {
  const entry = snapshotEntry(page, dims)
  return `${appBase}/snapshots/${entry?.file ?? snapshotFile(page, dims)}`
}

/** The target id this element itself carries (no ancestor walk), if any. */
export function ownTargetId(el: Element): string | null {
  const attrs = manifest.viewer?.targetAttrs?.length ? manifest.viewer.targetAttrs : DEFAULT_TARGET_ATTRS
  for (const a of attrs) {
    const v = el.getAttribute(a)
    if (v) return v
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Reverse matching: which (page, dims) is the prototype showing?       */
/* The player follows in-frame navigation with this; anything that does */
/* not match a registered page is reported as drift.                    */
/* ------------------------------------------------------------------ */

function templateParts(page: PageDef): { pathRe: RegExp; pathDims: string[]; query: URLSearchParams } {
  const [pathT, queryT = ""] = page.url.split("?")
  const abs = /^[a-z]+:\/\//i.test(pathT)
  const pathT2 = abs ? new URL(pathT).pathname : `${appBase}${pathT.startsWith("/") ? "" : "/"}${pathT}`
  const pathDims: string[] = []
  const src = pathT2
    .split(/(\{[a-zA-Z0-9_-]+\})/)
    .map((part) => {
      const m = part.match(/^\{([a-zA-Z0-9_-]+)\}$/)
      if (m) {
        pathDims.push(m[1])
        return "([^/?#]+)"
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    })
    .join("")
  return { pathRe: new RegExp(`^${src}/?$`), pathDims, query: new URLSearchParams(queryT) }
}

export function matchAppUrl(href: string): { page: PageDef; dims: Record<string, string> } | null {
  let u: URL
  try {
    u = new URL(href, location.origin)
  } catch {
    return null
  }
  for (const page of manifest.pages) {
    const { pathRe, pathDims, query } = templateParts(page)
    const m = u.pathname.match(pathRe)
    if (!m) continue
    const dims: Record<string, string> = {}
    pathDims.forEach((d, i) => (dims[d] = decodeURIComponent(m[i + 1])))
    let ok = true
    for (const [k, v] of query) {
      const dm = v.match(/^\{([a-zA-Z0-9_-]+)\}$/)
      if (dm) {
        const pv = u.searchParams.get(k)
        if (pv != null) dims[dm[1]] = pv
      } else if (u.searchParams.get(k) !== v) {
        ok = false
        break
      }
    }
    if (!ok) continue
    // Values the page does not declare are not this page (e.g. a role it doesn't render).
    if (Object.entries(dims).some(([d, v]) => page.dimensions[d] && !page.dimensions[d].includes(v))) continue
    return { page, dims: resolveDims(page, dims) }
  }
  return null
}

export function dimsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}
