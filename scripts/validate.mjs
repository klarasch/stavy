#!/usr/bin/env node
// Stavy check — validates the manifest (shape, cross-references, the URL
// contract), reads the last scan's results (public/snapshots/index.json) to
// report targets that were missing in the rendered prototype, optionally
// checks scenario refs against requirement documents, and prints a coverage
// summary. Whether targets *exist* is the scan's job (scripts/scan.mjs) —
// the viewer never reads the prototype's source.
//
//   node scripts/validate.mjs [stavy.json] [--refs docs/PRD-118.md ...] [--coverage] [--snapshots <dir>] [--require-schema] [--strict]
//
// Exit code 1 on errors; warnings never fail the run. Loose by design (SPEC §0): the
// errors are what would break the viewer (an unparsable file, a page that cannot be
// rendered, a reference the manifest itself cannot resolve); everything about shape,
// naming, boards and content is a warning. --strict promotes scan misses to errors. Schema checking (spec/stavy.schema.json)
// needs ajv + ajv-formats — when either is missing it is skipped with a loud warning instead of
// silently passing; --require-schema (use this in CI) turns that into an error.
import { readFileSync, existsSync, statSync } from "node:fs"
import { resolve, dirname, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { CONTENT_DIR, STATE_DIM, instanceKey, normalizeManifest, resolveDims } from "./lib/model.mjs"
import { loadBoards, walkItems } from "./lib/collect.mjs"

// Core checking logic, importable so it can be unit tested without spawning a
// process: takes the parsed manifest object and the directory it lives in
// (paths inside the manifest are resolved relative to that), returns the
// errors/warnings that the CLI otherwise prints and exits on. Any console
// output the original script produced inline (the --refs summary line) is
// still produced here, in the same place, so CLI output stays byte-identical.
// Versions that install cleanly through locked-down/corporate registries: a
// newer ajv pulls in `fast-uri`, which some artifactories refuse (see
// docs/ADOPTION.md, "Locked-down registries").
export const AJV_PIN = "ajv@8.12.0 ajv-formats@2.1.1"

const BOARD_TYPES = ["screen", "states", "flow", "markdown", "note", "section", "image", "mermaid", "arrow"]
const ACTION_KEYS = ["click", "hover", "focus", "press", "type", "wait"]
// A URL or a site path ("/figures/x.png"): not a file inside stavy-content/.
const isUrl = (s) => /^([a-z]+:|\/)/i.test(s)

/** stavy-content/index.json and boards/*.json: references resolve, ids are unique, shapes are plausible. */
function validateContent(m, root, { err, warn, validateBoard }) {
  const dir = resolve(root, CONTENT_DIR)
  if (!existsSync(dir)) return
  const pageIndex = new Map(m.pages.map((p) => [p.id, p]))
  const flows = new Set(m.scenarios.map((sc) => sc.id))
  const rel = (p) => relative(root, p)

  let index = null
  const indexFile = resolve(dir, "index.json")
  if (existsSync(indexFile)) {
    try {
      index = JSON.parse(readFileSync(indexFile, "utf8"))
      if (!index || typeof index !== "object" || Array.isArray(index)) {
        warn(`${rel(indexFile)}: expected an object { boards, docs }`)
        index = null
      }
    } catch (e) {
      err(`${rel(indexFile)}: not valid JSON (${String(e.message ?? e).split("\n")[0]})`)
    }
  }
  const { boards, problems } = loadBoards(root)
  for (const p of problems) err(p)
  const onDisk = new Set(boards.map((b) => b.id))
  if (index) {
    const seen = new Set()
    for (const [i, b] of (Array.isArray(index.boards) ? index.boards : []).entries()) {
      if (!b?.id) {
        warn(`${rel(indexFile)} boards[${i}]: no id`)
        continue
      }
      if (seen.has(b.id)) warn(`${rel(indexFile)}: board "${b.id}" is listed twice`)
      seen.add(b.id)
      if (!onDisk.has(b.id)) warn(`${rel(indexFile)}: board "${b.id}" has no ${CONTENT_DIR}/boards/${b.id}.json`)
      if (!b.title) warn(`${rel(indexFile)}: board "${b.id}" has no title`)
    }
    for (const id of onDisk) if (!seen.has(id)) warn(`${CONTENT_DIR}/boards/${id}.json is not listed in ${CONTENT_DIR}/index.json`)
    for (const [i, d] of (Array.isArray(index.docs) ? index.docs : []).entries()) {
      if (!d?.id) warn(`${rel(indexFile)} docs[${i}]: no id`)
      else if (!existsSync(resolve(dir, "docs", `${d.id}.md`))) warn(`${rel(indexFile)}: doc "${d.id}" has no ${CONTENT_DIR}/docs/${d.id}.md`)
    }
  }

  for (const { id: boardId, board } of boards) {
    const w = `board "${boardId}"`
    if (!board || typeof board !== "object" || !Array.isArray(board.items)) {
      warn(`${w}: expected { title, items: [...] }`)
      continue
    }
    if (validateBoard && !validateBoard(board)) for (const e of validateBoard.errors ?? []) if (e.keyword !== "if") warn(`${w}: schema ${e.instancePath || "/"}: ${e.message}`)
    const all = [...walkItems(board.items)]
    const ids = new Set(all.map((it) => it.id).filter(Boolean))
    const seen = new Set()
    for (const it of all) {
      const iw = `${w} item "${it.id ?? "?"}"`
      if (it.id) {
        if (seen.has(it.id)) warn(`${w}: duplicate item id "${it.id}"`)
        seen.add(it.id)
      }
      if (!BOARD_TYPES.includes(it.type)) {
        warn(`${iw}: unknown type "${it.type}" (${BOARD_TYPES.join(" | ")})`)
        continue
      }
      if (it.type === "screen" || it.type === "states") {
        const page = pageIndex.get(it.screen)
        if (!page) {
          warn(`${iw}: unknown screen "${it.screen}"`)
          continue
        }
        const stateIds = new Set((page.states ?? []).map((s) => s.id))
        const checkState = (ref) => {
          if (page.states ? stateIds.has(ref) : false) return
          if (/^\d+$/.test(ref) && Number(ref) < (page.instances?.length ?? 1)) return
          warn(`${iw}: screen "${page.id}" has no state "${ref}"`)
        }
        if (it.type === "screen") {
          if (it.state) checkState(it.state)
          for (const [d, v] of Object.entries(it.dims ?? {})) if (!(d in (page.urlDims ?? page.dimensions)) || !(page.urlDims ?? page.dimensions)[d].includes(v)) warn(`${iw}: page "${page.id}" has no "${d}=${v}"`)
          for (const a of it.do ?? []) if (!ACTION_KEYS.some((k) => k in a)) warn(`${iw}: unknown action ${JSON.stringify(a)} (${ACTION_KEYS.join(" | ")})`)
          if (it.viewport && !(it.viewport.width > 0 && it.viewport.height > 0)) warn(`${iw}: viewport needs a positive width and height`)
        } else for (const ref of (it.states ?? []).map(String)) checkState(ref)
      } else if (it.type === "flow") {
        if (!flows.has(it.flow)) warn(`${iw}: unknown flow "${it.flow}"`)
      } else if (it.type === "arrow") {
        for (const end of ["from", "to"]) if (!ids.has(it[end])) warn(`${iw}: ${end} "${it[end]}" is not an item on this board`)
      } else if (it.type === "markdown" && it.src) {
        const file = it.src.split("#")[0]
        if (!isUrl(file) && !existsSync(resolve(dir, file)) && !existsSync(resolve(dir, "docs", file.endsWith(".md") ? file : `${file}.md`))) warn(`${iw}: markdown src "${it.src}" not found in ${CONTENT_DIR}/`)
      } else if (it.type === "image" && it.src && !isUrl(it.src) && !existsSync(resolve(dir, it.src))) warn(`${iw}: image "${it.src}" not found in ${CONTENT_DIR}/`)
    }
  }
}

export async function validate(m, root, flags = { refs: [], coverage: false }) {
  const errors = []
  const warnings = []
  const err = (s) => errors.push(s)
  const warn = (s) => warnings.push(s)

  // ---- shape: JSON Schema (spec/stavy.schema.json), if ajv is installed
  // `simulateNoAjv` is a test-only hook (tests/unit/validate.unit.ts) so the
  // "ajv absent" path can be exercised without actually uninstalling ajv.
  let ajvAvailable = false
  let Ajv, addFormats
  if (!flags.simulateNoAjv) {
    try {
      ;({ default: Ajv } = await import("ajv/dist/2020.js"))
      ;({ default: addFormats } = await import("ajv-formats"))
      ajvAvailable = true
    } catch {
      /* ajv not installed — structural checks below still run */
    }
  }
  let schemaChecked = false
  let validateBoard = null
  const findSchema = (name) => [resolve(root, "spec", name), resolve(import.meta.dirname, name), resolve(import.meta.dirname, "../spec", name)].find(existsSync)
  if (ajvAvailable) {
    const schemaPath = findSchema("stavy.schema.json")
    const boardSchemaPath = findSchema("stavy-board.schema.json")
    if (schemaPath) {
      const ajv = new Ajv({ allErrors: true, strict: false })
      addFormats(ajv)
      if (boardSchemaPath) validateBoard = ajv.compile(JSON.parse(readFileSync(boardSchemaPath, "utf8")))
      const validateSchema = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")))
      if (!validateSchema(m)) for (const e of validateSchema.errors ?? []) err(`schema ${e.instancePath || "/"}: ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(" | ")})` : ""}`)
      schemaChecked = true
    }
  }
  // Silently skipping the schema check is how an invalid manifest "passes"
  // with 0 errors — loud on purpose, and --require-schema (CI) makes it fatal.
  if (!schemaChecked) {
    if (flags.requireSchema) err(`schema validation required (--require-schema) but ${ajvAvailable ? "spec/stavy.schema.json was not found" : "ajv/ajv-formats is not installed"} — npm i -D ${AJV_PIN}`)
    else warn(`SCHEMA NOT CHECKED — install ${AJV_PIN} (npm i -D ${AJV_PIN})`)
  }

  // Everything below reads the manifest the way the viewer does: normalised (named
  // states become the hidden `_state` axis, defaults filled in). The schema check
  // above saw the file as written. Work on a copy, so the caller's object is untouched.
  m = normalizeManifest(structuredClone(m))

  const dimIndex = new Map(m.dimensions.map((d) => [d.id, new Set(d.values.map((v) => v.id))]))
  // Workspace-scoped axes (SPEC §1.1): one value for the whole workspace, so a
  // page's own default never applies and a scenario cannot straddle two values.
  const workspaceDims = m.dimensions.filter((d) => d.scope === "workspace")
  const isWorkspaceDim = (id) => workspaceDims.some((d) => d.id === id)
  const templateIndex = new Map((m.templates ?? []).map((t) => [t.id, t]))
  const pageIndex = new Map(m.pages.map((p) => [p.id, p]))
  const scenarioIndex = new Map(m.scenarios.map((s) => [s.id, s]))

  function checkDims(where, page, dims) {
    for (const [d, v] of Object.entries(dims ?? {})) {
      if (d === STATE_DIM) {
        if (page && !page.states?.some((s) => s.id === v)) warn(`${where}: page "${page.id}" has no state "${v}"`)
        continue
      }
      // A named-states page keeps its template dimensions in urlDims.
      const pageDims = page ? page.urlDims ?? page.dimensions : null
      if (page && page.urlDims && d in page.urlDims) {
        if (!dimIndex.has(d)) err(`${where}: unknown dimension "${d}"`)
        else if (!pageDims[d].includes(v)) err(`${where}: page "${page.id}" does not allow "${d}=${v}"`)
        continue
      }
      if (!dimIndex.has(d)) err(`${where}: unknown dimension "${d}"`)
      else if (!dimIndex.get(d).has(v)) err(`${where}: "${v}" is not a declared value of dimension "${d}"`)
      if (page && !(d in page.dimensions)) err(`${where}: page "${page.id}" does not support dimension "${d}"`)
      else if (page && !page.dimensions[d].includes(v)) err(`${where}: page "${page.id}" does not allow "${d}=${v}"`)
    }
  }

  // ---- pages
  for (const page of m.pages) {
    const w = `page "${page.id}"`
    if (page.template && !templateIndex.has(page.template)) err(`${w}: template "${page.template}" is not registered`)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(page.id)) err(`${w}: id must be kebab-case`)
    // ---- the URL contract. A page needs somewhere to render: its own url, or a url on every state.
    // Whether placeholders and dimensions line up is the prototype's business: a warning here.
    const allStatesHaveUrl = !!page.states?.length && page.states.every((st) => typeof st.url === "string" && st.url)
    const urlDims = page.urlDims ?? (page.states ? {} : page.dimensions)
    if (typeof page.url !== "string" || !page.url) {
      if (!allStatesHaveUrl) err(`${w}: no url — where does the prototype render this page? (a page url, or a url on every state)`)
    } else {
      if (!/^(\/|[a-z]+:\/\/)/i.test(page.url)) warn(`${w}: url should start with "/" (or be absolute): "${page.url}"`)
      const placeholders = [...page.url.matchAll(/\{([a-zA-Z0-9_-]+)\}/g)].map((mm) => mm[1])
      for (const d of placeholders) if (!(d in urlDims)) warn(`${w}: url placeholder {${d}} is not a dimension this page declares`)
      for (const d of Object.keys(urlDims)) if (!placeholders.includes(d)) warn(`${w}: dimension "${d}" does not appear in url "${page.url}" — the prototype cannot render that axis`)
    }
    const seenStates = new Set()
    for (const st of page.states ?? []) {
      if (!st.id) {
        warn(`${w}: a state has no id`)
        continue
      }
      if (seenStates.has(st.id)) warn(`${w}: duplicate state id "${st.id}"`)
      seenStates.add(st.id)
      if (!st.url && !page.url) warn(`${w} state "${st.id}": no url, and the page has none to fill`)
      else if (st.url && !/^(\/|[a-z]+:\/\/)/i.test(st.url)) warn(`${w} state "${st.id}": url should start with "/" (or be absolute): "${st.url}"`)
      checkDims(`${w} state "${st.id}"`, { ...page, states: undefined, dimensions: page.urlDims ?? {} }, st.dims)
    }
    if (page.layout && !["row", "matrix"].includes(page.layout)) warn(`${w}: unknown layout "${page.layout}" (row | matrix)`)
    if (!page.fidelity) warn(`${w}: no fidelity rung declared (static | navigable | interactive)`)
    for (const [d, values] of Object.entries(page.urlDims ?? page.dimensions)) {
      if (!dimIndex.has(d)) err(`${w}: unknown dimension "${d}"`)
      else for (const v of values) if (!dimIndex.get(d).has(v)) err(`${w}: "${d}=${v}" not declared`)
      if (isWorkspaceDim(d)) {
        if (page.defaults?.[d])
          warn(`${w}: default for workspace-scoped dimension "${d}" is ignored — the workspace value wins (SPEC §1.1)`)
      } else if (!page.defaults?.[d] && !page.urlDefaults?.[d] && !page.states) {
        warn(`${w}: no default for dimension "${d}" (first value will be used)`)
      }
    }
    checkDims(`${w} defaults`, page, page.defaults)
    checkDims(`${w} defaults`, page, page.urlDefaults)
    ;(page.instances ?? []).forEach((inst, i) => checkDims(`${w} instances[${i}]`, page, inst.dims))
    // No warning for a page without dimensions or instances: one screen at its
    // defaults is a page, and asking for more is what produced matrices nobody
    // reviews (SPEC §1.3).
  }

  // ---- scenarios
  for (const sc of m.scenarios) {
    const w = `scenario "${sc.id}"`
    if (!sc.refs?.length) warn(`${w}: no refs — what requirement does it demonstrate?`)
    sc.steps.forEach((st, i) => {
      const page = pageIndex.get(st.page)
      if (!page) return err(`${w} step ${i + 1}: unknown page "${st.page}"`)
      checkDims(`${w} step ${i + 1}`, page, st.dims)
      const inSlice = !m.prototypes?.length || m.prototypes.some((p) => p.scenarios.includes(sc.id) && p.pages.includes(st.page))
      if (!inSlice) warn(`${w} step ${i + 1}: page "${st.page}" is not in any prototype that includes this scenario`)
    })
    // End to end (SPEC §1.4): a walkthrough runs from the entry point to the
    // outcome as the user would next see it. Steps that never leave one page
    // are usually a flow that stopped at the last form step. A single-step
    // scenario is a pointer at one state, not a walkthrough that stopped early.
    const visited = new Set(sc.steps.map((st) => st.page))
    if (sc.steps.length > 1 && visited.size === 1)
      warn(`${w}: stays on page "${sc.steps[0].page}" for all ${sc.steps.length} steps: is it end to end (the success state plus the thing that changed)?`)
    // A scenario belongs to one world: if its steps pin two values of a
    // workspace axis, or a step's page excludes a value another step pins, the
    // walkthrough can never be shown whole.
    for (const d of workspaceDims) {
      const pinned = new Set()
      for (const st of sc.steps) if (st.dims?.[d.id]) pinned.add(st.dims[d.id])
      if (pinned.size > 1)
        err(`${w}: steps pin ${pinned.size} values of workspace-scoped "${d.id}" (${[...pinned].join(", ")}) — a scenario lives in one`)
      const [value] = pinned
      if (value)
        for (const [i, st] of sc.steps.entries()) {
          const page = pageIndex.get(st.page)
          if (page && d.id in page.dimensions && !page.dimensions[d.id].includes(value))
            err(`${w} step ${i + 1}: page "${st.page}" does not exist at "${d.id}=${value}", which this scenario pins`)
        }
    }
  }

  // ---- workspace-scoped dimensions
  for (const d of workspaceDims) {
    if (!m.pages.some((p) => d.id in p.dimensions))
      warn(`dimension "${d.id}": declared workspace-scoped but no page varies by it — it will do nothing`)
    for (const v of d.values)
      if (m.pages.some((p) => d.id in p.dimensions) && !m.pages.some((p) => p.dimensions[d.id]?.includes(v.id)))
        warn(`dimension "${d.id}": no page exists at "${v.id}" — that workspace value shows an empty canvas`)
  }

  // ---- templates
  for (const t of m.templates ?? []) {
    for (const id of t.organisms ?? []) {
      const c = pageIndex.get(id)
      if (!c) err(`template "${t.id}": organism "${id}" is not a registered component`)
      else if (c.kind !== "component") warn(`template "${t.id}": organism "${id}" is a page, not a component`)
    }
  }

  // ---- prototypes
  for (const p of m.prototypes ?? []) {
    for (const id of p.pages) if (!pageIndex.has(id)) err(`prototype "${p.id}": unknown page "${id}"`)
    for (const id of p.scenarios) if (!scenarioIndex.has(id)) err(`prototype "${p.id}": unknown scenario "${id}"`)
  }

  // ---- canvas notes
  for (const n of m.notes ?? []) {
    const page = pageIndex.get(n.page)
    if (!page) {
      err(`note "${n.id}": unknown page "${n.page}"`)
      continue
    }
    checkDims(`note "${n.id}"`, page, n.dims)
    if (n.dims) {
      const resolved = Object.fromEntries(Object.keys(page.dimensions).map((d) => [d, n.dims[d] ?? page.defaults?.[d] ?? page.dimensions[d][0]]))
      const pinned = (page.instances ?? []).some((inst) => {
        const r = Object.fromEntries(Object.keys(page.dimensions).map((d) => [d, inst.dims[d] ?? page.defaults?.[d] ?? page.dimensions[d][0]]))
        return Object.entries(resolved).every(([k, v]) => r[k] === v)
      })
      if (!pinned) warn(`note "${n.id}": points at an instance that is not pinned on the canvas`)
    }
  }

  // ---- copy catalog: a URL the prototype serves (checked at runtime by the viewer)
  if (m.strings && !/^(\/|[a-z]+:\/\/)/i.test(m.strings)) warn(`strings: "${m.strings}" should be a URL path the prototype serves (e.g. "/strings.json")`)

  // ---- last scan: targets the rendered prototype did not have (scripts/scan.mjs)
  const snapDir = flags.snapshots ?? resolve(root, root === process.cwd() ? "public/snapshots" : "snapshots")
  const indexPath = resolve(snapDir, "index.json")
  if (existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, "utf8"))
    // The page viewport a fresh scan would use right now (SPEC §1.8): a
    // page's own frame, else manifest viewer.viewport, else the 1920x1080
    // default the viewer itself falls back to.
    const mViewport = m.viewer?.viewport ?? {}
    const currentViewport = (page) => ({ width: page?.frame?.width ?? mViewport.width ?? 1920, height: page?.frame?.height ?? mViewport.height ?? 1080 })
    let scanned = 0
    for (const [key, entry] of Object.entries(index)) {
      scanned++
      // A target missing from a rendered state is worth knowing, not a reason to fail: --strict makes it one.
      for (const t of entry.missing ?? []) (flags.strict ? err : warn)(`scan: ${key}: target "${t}" was not found in the rendered prototype`)
      // The adopter changed the viewport knob (or a page's frame) without
      // rescanning: the canvas still shows the old capture, scaled to fit.
      const page = pageIndex.get(key.split("?")[0])
      const cur = currentViewport(page)
      // A cropped or other-viewport variant has a size of its own.
      if (!key.includes("#") && entry.width != null && entry.height != null && (entry.width !== cur.width || entry.height !== cur.height))
        warn(`scan: snapshot for ${key} was captured at ${entry.width}×${entry.height}, page viewport is ${cur.width}×${cur.height} — run scan`)
    }
    const pinned = m.pages.flatMap((p) => (p.instances ?? [{ dims: {} }]).map((inst) => instanceKey(p.id, resolveDims(p, inst.dims))))
    const unscanned = pinned.filter((k) => !index[k])
    if (unscanned.length) warn(`scan: ${unscanned.length} pinned state(s) have no snapshot yet — the viewer asks for them in dev; or run \`npm run scan\` (e.g. ${unscanned[0]})`)
    console.log(`scan: ${scanned} state(s) in ${relative(root, indexPath)}`)
  } else {
    warn(`scan: no ${relative(root, indexPath)} yet — snapshots are a cache: the dev viewer fills it on demand, or run \`npm run scan\` against the dev server`)
  }

  // ---- stavy-content: the index and every board file (warnings; only unparsable JSON is an error)
  validateContent(m, root, { err, warn, validateBoard })

  // ---- legacy boards (and figures: boards anchored to a page, SPEC §1.7)
  const boardIds = new Set()
  const pageIds = new Set(m.pages.map((p) => p.id))
  for (const b of m.boards ?? []) {
    if (boardIds.has(b.id)) err(`board "${b.id}": duplicate id`)
    boardIds.add(b.id)
    if (!["mermaid", "image", "text"].includes(b.kind)) err(`board "${b.id}": unknown kind "${b.kind}"`)
    if (!b.source) err(`board "${b.id}": empty source`)
    if (b.page !== undefined && !pageIds.has(b.page)) err(`board "${b.id}": page "${b.page}" is not a registered page`)
    if (b.callouts !== undefined && b.kind !== "image") err(`board "${b.id}": callouts are only for kind "image" (this one is "${b.kind}")`)
    // Coordinates are fractions of the image, like the scan's target boxes —
    // pixel values would silently place every callout in the top-left corner.
    ;(b.callouts ?? []).forEach((c, i) => {
      for (const k of ["x", "y", "w", "h"]) {
        const v = c[k]
        if (v === undefined) continue
        if (typeof v !== "number" || !(v >= 0 && v <= 1)) err(`board "${b.id}" callout ${i + 1}: ${k} must be a fraction of the image between 0 and 1 (got ${JSON.stringify(v)})`)
      }
      if (!c.title) err(`board "${b.id}" callout ${i + 1}: missing title`)
    })
  }

  // ---- requirements ↔ scenario refs (the in-manifest contract)
  if (m.requirements?.length) {
    const cited = new Set(m.scenarios.flatMap((s) => s.refs ?? []))
    for (const r of m.requirements) if (!cited.has(r.id)) warn(`requirement "${r.id}" (${r.title}) is not demonstrated by any scenario`)
    const known = new Set(m.requirements.map((r) => r.id))
    for (const sc of m.scenarios) for (const ref of sc.refs ?? []) if (!known.has(ref)) warn(`scenario "${sc.id}" cites "${ref}", which is not in requirements[]`)
  }

  // ---- refs against requirement documents (the PM ↔ design ↔ eng contract)
  if (flags.refs.length) {
    const docs = flags.refs.map((f) => ({ f, text: readFileSync(resolve(f), "utf8") }))
    const allRefs = new Map() // ref -> scenarios
    for (const sc of m.scenarios) for (const r of sc.refs ?? []) allRefs.set(r, [...(allRefs.get(r) ?? []), sc.id])
    for (const [ref, scs] of allRefs) {
      const id = ref.split(/\s+/)[0]
      const section = ref.match(/§[\d.]+/)?.[0]
      const hit = docs.find((d) => d.text.includes(id) && (!section || d.text.includes(section)))
      if (!hit) err(`ref "${ref}" (scenarios: ${scs.join(", ")}) not found in ${flags.refs.join(", ")}`)
    }
    // sections in the docs that no scenario demonstrates
    for (const d of docs) {
      for (const mm of d.text.matchAll(/^##+\s+(§[\d.]+)\s+(.+)$/gm)) {
        const sec = mm[1]
        const covered = [...allRefs.keys()].some((r) => r.includes(sec))
        if (!covered) warn(`${d.f}: section ${sec} "${mm[2].trim()}" is not demonstrated by any scenario`)
      }
    }
    console.log(`refs: ${allRefs.size} reference(s) checked against ${docs.length} document(s)`)
  }

  // ---- coverage summary
  if (flags.coverage) {
    console.log("\ncoverage (pinned instances / declared variant space):")
    for (const page of m.pages) {
      const space = Object.values(page.dimensions).reduce((n, vs) => n * vs.length, 1)
      const pinned = page.instances?.length ?? 0
      const inScenarios = m.scenarios.filter((s) => s.steps.some((st) => st.page === page.id)).length
      const bar = "█".repeat(Math.round((pinned / space) * 20)).padEnd(20, "░")
      console.log(`  ${page.id.padEnd(18)} ${bar} ${String(pinned).padStart(3)} / ${String(space).padEnd(4)} ${page.kind === "component" ? "component" : "page"}, in ${inScenarios} scenario(s)${page.fidelity ? `, ${page.fidelity}` : ""}`)
    }
  }

  return { errors, warnings, schemaChecked }
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = { refs: [], coverage: false, snapshots: null, requireSchema: false, strict: false }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--refs") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) flags.refs.push(argv[++i])
    } else if (argv[i] === "--coverage") flags.coverage = true
    else if (argv[i] === "--require-schema") flags.requireSchema = true
    else if (argv[i] === "--strict") flags.strict = true
    else if (argv[i] === "--snapshots") flags.snapshots = resolve(argv[++i])
    else positional.push(argv[i])
  }
  const manifestPath = resolve(positional[0] ?? (existsSync("stavy.json") ? "stavy.json" : "public/stavy.json"))
  const root = dirname(manifestPath)
  const m = JSON.parse(readFileSync(manifestPath, "utf8"))

  const { errors, warnings, schemaChecked } = await validate(m, root, flags)

  // ---- report (the schema-not-checked warning, when present, is pushed
  // first in validate() so it prints as the very first line here — loud on
  // purpose, per README feedback item 4)
  for (const w of warnings) console.log(`  warn  ${w}`)
  for (const e of errors) console.log(`  ERROR ${e}`)
  console.log(
    `\nstavy: ${m.pages.length} pages · ${m.scenarios.length} scenarios · ${(m.notes ?? []).length} notes — ${errors.length} error(s), ${warnings.length} warning(s)${schemaChecked ? "" : " · SCHEMA NOT CHECKED"}`
  )
  process.exit(errors.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
