// The manifest model, shared by the viewer (src/stavy/manifest.ts imports it)
// and the Node tools (scan, validate). One normalisation, one URL rule, one key
// rule — so a state the viewer shows is exactly the state the scan captured.
//
// Plain ES module, no dependencies: it's copied into adopters' repos as-is.

/**
 * Reserved dimension id for named states (SPEC §1.3a). A page that lists
 * `states` gets one hidden axis with that id whose values are the state ids,
 * so everything keyed by (page, dims) — cards, snapshots, links, the player —
 * works for named states with no special case.
 */
export const STATE_DIM = "_state"

/**
 * Normalise a manifest in place and return it:
 *  - `dimensions` defaults to {} and the top-level `dimensions` list to [].
 *  - a page with `states` gets the hidden `_state` axis; its own `dimensions`
 *    move to `urlDims` (they still fill the url template, but stop being axes).
 *  - a page with `states` and no `instances` shows every state.
 */
export function normalizeManifest(m) {
  m.dimensions = m.dimensions ?? []
  m.pages = m.pages ?? []
  m.scenarios = m.scenarios ?? []
  for (const p of m.pages) {
    p.dimensions = p.dimensions ?? {}
    if (!Array.isArray(p.states) || p.states.length === 0 || p.dimensions[STATE_DIM]) continue
    p.urlDims = p.dimensions
    p.urlDefaults = p.defaults ?? {}
    p.dimensions = { [STATE_DIM]: p.states.map((s) => s.id) }
    p.defaults = { [STATE_DIM]: p.states[0].id }
    if (!p.instances?.length) {
      p.instances = p.states
        .filter((s) => !s.hidden)
        .map((s) => ({ dims: { [STATE_DIM]: s.id }, ...(s.note ? { note: s.note } : {}) }))
    } else {
      // Instances may name a state by id: { "state": "loading" } is shorthand.
      p.instances = p.instances.map((i) => (i.state ? { ...i, dims: { ...(i.dims ?? {}), [STATE_DIM]: i.state } } : i))
    }
  }
  for (const sc of m.scenarios) {
    for (const st of sc.steps ?? []) {
      const p = m.pages.find((x) => x.id === st.page)
      if (st.state && p?.states) st.dims = { ...(st.dims ?? {}), [STATE_DIM]: st.state }
    }
  }
  return m
}

/** The page's named state for a dims assignment, if it uses named states. */
export function stateOf(page, dims) {
  if (!page.states) return undefined
  const id = dims?.[STATE_DIM] ?? page.defaults?.[STATE_DIM]
  return page.states.find((s) => s.id === id)
}

/** Every declared dimension resolved: overrides, then the page default, then the first value. */
export function resolveDims(page, overrides = {}) {
  const out = {}
  for (const [d, values] of Object.entries(page.dimensions ?? {})) out[d] = overrides[d] ?? page.defaults?.[d] ?? values[0]
  return out
}

/**
 * The prototype's own URL for a page state, relative to the app base (or
 * absolute when the template / state url is). Named states use their `url`,
 * else the page template filled with the state's `dims` over the page's
 * url defaults.
 */
export function statePath(page, dims) {
  const st = stateOf(page, dims)
  let filled
  if (st?.url) filled = st.url
  else {
    const values = st ? { ...firstValues(page.urlDims), ...(page.urlDefaults ?? {}), ...(st.dims ?? {}) } : resolveDims(page, dims)
    if (!page.url) return null
    filled = page.url.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, d) => encodeURIComponent(values[d] ?? ""))
  }
  return filled
}

function firstValues(dims) {
  const out = {}
  for (const [d, v] of Object.entries(dims ?? {})) out[d] = v[0]
  return out
}

/** statePath joined to an app base ("" or "/base"); absolute URLs pass through. */
export function stateHref(page, dims, appBase = "") {
  const p = statePath(page, dims)
  if (p == null) return null
  if (/^[a-z]+:\/\//i.test(p)) return p
  return `${appBase}${p.startsWith("/") ? "" : "/"}${p}`
}

/** Stable key identifying a page state (page + full dimension assignment). */
export function instanceKey(pageId, dims) {
  const q = Object.entries(dims)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  return `${pageId}?${q}`
}

/** Conventional snapshot file stem for a state (scan adds the extension). */
export function snapshotStem(page, dims) {
  const full = resolveDims(page, dims)
  const parts = Object.keys(page.dimensions).map((d) => `${d === STATE_DIM ? "state" : d}=${full[d]}`)
  return [page.id, ...parts].join("__").replace(/[^\w=.-]+/g, "-")
}

/** Where a workspace keeps its authored content (boards, docs, assets, comments), relative to stavy.json. */
export const CONTENT_DIR = "stavy-content"

/**
 * Key of a *variant* capture: a state plus what a board item does to it
 * before capturing (crop to a target, actions such as opening a menu, another
 * viewport). Plain states keep their instanceKey; variants append a stable
 * suffix, so scan and viewer agree without coordination.
 *   variantKey("contacts", {_state:"loaded"}, { crop: "FilterMenu", do: [{ click: "Filter" }] })
 *   → "contacts?_state=loaded#crop=FilterMenu&do=click:Filter"
 */
export function variantKey(pageId, dims, v = {}) {
  const base = instanceKey(pageId, dims)
  const parts = []
  if (v.crop) parts.push(`crop=${v.crop}`)
  if (v.do?.length) parts.push(`do=${v.do.map((a) => Object.entries(a).map(([k, x]) => `${k}:${x}`).join(",")).join(";")}`)
  if (v.viewport) parts.push(`vp=${v.viewport.width}x${v.viewport.height}`)
  return parts.length ? `${base}#${parts.join("&")}` : base
}

/** File stem for a variant capture: the state's stem plus a short hash of the variant. */
export function variantStem(page, dims, v = {}) {
  const key = variantKey(page.id, resolveDims(page, dims), v)
  const hash = key.includes("#") ? `__v${fnv(key.slice(key.indexOf("#")))}` : ""
  return `${snapshotStem(page, dims)}${hash}`
}

function fnv(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(36)
}
