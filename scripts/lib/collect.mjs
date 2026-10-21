// Which states does the workspace want a snapshot of? Pure (no browser): the
// scan runs it, tests exercise it. Sources: pinned instances, scenario steps,
// notes, and every board in stavy-content/boards/ (screen / states / flow
// items, recursively through sections). A board item with `crop` / `do` /
// `viewport` wants a *variant* capture, keyed by variantKey.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { CONTENT_DIR, STATE_DIM, normalizeManifest, resolveDims, variantKey, variantStem } from "./model.mjs"

/** Read every board file next to the manifest. Unparsable files become `problems`, never exceptions. */
export function loadBoards(root) {
  const dir = join(root, CONTENT_DIR, "boards")
  const boards = []
  const problems = []
  if (!existsSync(dir)) return { boards, problems }
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      boards.push({ id: name.replace(/\.json$/, ""), file: name, board: JSON.parse(readFileSync(join(dir, name), "utf8")) })
    } catch (e) {
      problems.push(`${CONTENT_DIR}/boards/${name}: not valid JSON (${String(e.message ?? e).split("\n")[0]})`)
    }
  }
  return { boards, problems }
}

/** Every item of a board, depth first (sections included). */
export function* walkItems(items = []) {
  for (const it of items ?? []) {
    if (!it || typeof it !== "object") continue
    yield it
    if (Array.isArray(it.items)) yield* walkItems(it.items)
  }
}

const annotTargets = (p) => (p.annotations ?? []).map((a) => a.target)

/**
 * @param manifest  a manifest (normalised here; normalising twice is harmless)
 * @param boards    [{ id, board }] from loadBoards
 * @param opts      { only?: pageId }
 * @returns { states: Map<key, State>, warnings: string[] }
 *   State = { key, stem, page, dims, variant?, required:Set, optional:Set, strict:Set, why:Set }
 *   `strict` = targets from scenario steps (missing ones fail a --strict scan).
 */
export function collectStates(manifest, boards = [], opts = {}) {
  const m = normalizeManifest(manifest)
  const states = new Map()
  const warnings = []
  const pageIndex = new Map(m.pages.map((p) => [p.id, p]))
  const scenarioIndex = new Map(m.scenarios.map((s) => [s.id, s]))

  const want = (page, rawDims, why, { required = [], strict = [], variant } = {}) => {
    if (opts.only && page.id !== opts.only) return
    const dims = resolveDims(page, rawDims)
    const v = variant && (variant.crop || variant.do?.length || variant.viewport) ? variant : undefined
    const key = variantKey(page.id, dims, v ?? {})
    const s = states.get(key) ?? { key, stem: variantStem(page, dims, v ?? {}), page, dims, variant: v, required: new Set(), optional: new Set(), strict: new Set(), why: new Set() }
    for (const t of required) if (t) s.required.add(t)
    for (const t of strict) if (t) s.strict.add(t)
    // The page's annotations are measured wherever they exist (pins, anatomy); not required.
    for (const t of annotTargets(page)) s.optional.add(t)
    if (v?.crop) s.required.add(v.crop)
    s.why.add(why)
    states.set(key, s)
  }

  for (const p of m.pages) for (const inst of p.instances ?? [{ dims: {} }]) want(p, inst.dims, "instance")
  for (const sc of m.scenarios)
    for (const st of sc.steps ?? []) {
      const p = pageIndex.get(st.page)
      // A `via: "click"` step's target only exists after the previous click (a
      // menu, a spinner): it can't be on the state's own page, so don't ask for it.
      const t = st.via === "click" ? undefined : st.target
      if (p) want(p, st.dims, `scenario ${sc.id}`, { required: [t], strict: [t] })
    }
  for (const n of m.notes ?? []) {
    const p = pageIndex.get(n.page)
    if (p) want(p, n.dims ?? p.instances?.[0]?.dims, `note ${n.id}`, { required: [n.target] })
  }

  for (const { id: boardId, board } of boards) {
    for (const it of walkItems(board?.items)) {
      const where = `board ${boardId}/${it.id ?? it.type}`
      if (it.type === "screen") {
        const p = pageIndex.get(it.screen)
        if (!p) {
          warnings.push(`${where}: unknown screen "${it.screen}"`)
          continue
        }
        const dims = { ...(it.dims ?? {}), ...(it.state ? { [STATE_DIM]: it.state } : {}) }
        want(p, dims, where, { variant: { crop: it.crop, do: it.do, viewport: it.viewport } })
      } else if (it.type === "states") {
        const p = pageIndex.get(it.screen)
        if (!p) {
          warnings.push(`${where}: unknown screen "${it.screen}"`)
          continue
        }
        const insts = p.instances ?? [{ dims: {} }]
        const wanted = it.states?.length ? it.states.map(String) : insts.map((_, i) => String(i))
        for (const ref of wanted) {
          const byId = p.states?.find((s) => s.id === ref)
          const inst = !byId && /^\d+$/.test(ref) ? insts[Number(ref)] : null
          if (!byId && !inst) {
            warnings.push(`${where}: unknown state "${ref}" on "${p.id}"`)
            continue
          }
          want(p, byId ? { [STATE_DIM]: byId.id } : inst.dims, where, { variant: { crop: it.crop } })
        }
      } else if (it.type === "flow") {
        const sc = scenarioIndex.get(it.flow)
        if (!sc) {
          warnings.push(`${where}: unknown flow "${it.flow}"`)
          continue
        }
        for (const st of sc.steps ?? []) {
          const p = pageIndex.get(st.page)
          if (p) want(p, st.dims, where)
        }
      }
    }
  }
  return { states, warnings }
}

/**
 * Where snapshots live when no --out/--snapshots is given: `.stavy/snapshots`
 * once it exists (the default since 0.3.1: outside public/, so a build never
 * copies the cache into dist/), else next to the manifest as before.
 * @param {string} root folder holding stavy.json
 */
export function defaultSnapshotsDir(root, cwd = process.cwd()) {
  const modern = resolve(cwd, ".stavy/snapshots")
  if (existsSync(modern)) return modern
  return resolve(root, root === cwd ? "public/snapshots" : "snapshots")
}
