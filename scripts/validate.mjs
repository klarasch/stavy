#!/usr/bin/env node
// Stavy check — validates the manifest (shape, cross-references, the URL
// contract), reads the last scan's results (public/snapshots/index.json) to
// report targets that were missing in the rendered prototype, optionally
// checks scenario refs against requirement documents, and prints a coverage
// summary. Whether targets *exist* is the scan's job (scripts/scan.mjs) —
// the viewer never reads the prototype's source.
//
//   node scripts/validate.mjs [stavy.json] [--refs docs/PRD-118.md ...] [--coverage] [--snapshots <dir>]
//
// Exit code 1 on errors; warnings never fail the run.
import { readFileSync, existsSync, statSync } from "node:fs"
import { resolve, dirname, relative } from "node:path"
import { pathToFileURL } from "node:url"

// Core checking logic, importable so it can be unit tested without spawning a
// process: takes the parsed manifest object and the directory it lives in
// (paths inside the manifest are resolved relative to that), returns the
// errors/warnings that the CLI otherwise prints and exits on. Any console
// output the original script produced inline (the --refs summary line) is
// still produced here, in the same place, so CLI output stays byte-identical.
export async function validate(m, root, flags = { refs: [], coverage: false }) {
  const errors = []
  const warnings = []
  const err = (s) => errors.push(s)
  const warn = (s) => warnings.push(s)

  // ---- shape: JSON Schema (spec/stavy.schema.json), if ajv is installed
  try {
    const { default: Ajv } = await import("ajv/dist/2020.js")
    const { default: addFormats } = await import("ajv-formats")
    const schemaPath = [resolve(root, "spec/stavy.schema.json"), resolve(import.meta.dirname, "stavy.schema.json"), resolve(import.meta.dirname, "../spec/stavy.schema.json")].find(existsSync)
    if (schemaPath) {
      const ajv = new Ajv({ allErrors: true, strict: false })
      addFormats(ajv)
      const validateSchema = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")))
      if (!validateSchema(m)) for (const e of validateSchema.errors ?? []) err(`schema ${e.instancePath || "/"}: ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(" | ")})` : ""}`)
    }
  } catch {
    /* ajv not installed — structural checks below still run */
  }

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
    // ---- the URL contract: every declared dimension reaches the prototype through the url template
    if (typeof page.url !== "string" || !page.url) err(`${w}: no url — where does the prototype render this page?`)
    else {
      if (!/^(\/|[a-z]+:\/\/)/i.test(page.url)) err(`${w}: url must start with "/" (or be absolute): "${page.url}"`)
      const placeholders = [...page.url.matchAll(/\{([a-zA-Z0-9_-]+)\}/g)].map((mm) => mm[1])
      for (const d of placeholders) if (!(d in page.dimensions)) err(`${w}: url placeholder {${d}} is not a dimension this page declares`)
      for (const d of Object.keys(page.dimensions)) if (!placeholders.includes(d)) err(`${w}: dimension "${d}" does not appear in url "${page.url}" — the prototype cannot render that axis`)
    }
    if (!page.fidelity) warn(`${w}: no fidelity rung declared (static | navigable | interactive)`)
    for (const [d, values] of Object.entries(page.dimensions)) {
      if (!dimIndex.has(d)) err(`${w}: unknown dimension "${d}"`)
      else for (const v of values) if (!dimIndex.get(d).has(v)) err(`${w}: "${d}=${v}" not declared`)
      if (isWorkspaceDim(d)) {
        if (page.defaults?.[d])
          warn(`${w}: default for workspace-scoped dimension "${d}" is ignored — the workspace value wins (SPEC §1.1)`)
      } else if (!page.defaults?.[d]) {
        warn(`${w}: no default for dimension "${d}" (first value will be used)`)
      }
    }
    checkDims(`${w} defaults`, page, page.defaults)
    ;(page.instances ?? []).forEach((inst, i) => checkDims(`${w} instances[${i}]`, page, inst.dims))
    if (!page.instances?.length) warn(`${w}: no pinned instances — nothing will show on the canvas`)
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
    let scanned = 0
    for (const [key, entry] of Object.entries(index)) {
      scanned++
      for (const t of entry.missing ?? []) err(`scan: ${key}: target "${t}" was not found in the rendered prototype`)
    }
    const pinned = m.pages.flatMap((p) => (p.instances ?? [{ dims: {} }]).map((inst) => {
      const dims = Object.fromEntries(Object.keys(p.dimensions).map((d) => [d, inst.dims[d] ?? p.defaults?.[d] ?? p.dimensions[d][0]]))
      return `${p.id}?${Object.entries(dims).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&")}`
    }))
    const unscanned = pinned.filter((k) => !index[k])
    if (unscanned.length) warn(`scan: ${unscanned.length} pinned instance(s) have no snapshot yet — run \`npm run scan\` (e.g. ${unscanned[0]})`)
    console.log(`scan: ${scanned} state(s) in ${relative(root, indexPath)}`)
  } else {
    warn(`scan: no ${relative(root, indexPath)} yet — run \`npm run scan\` against the dev server to check targets and render the canvas`)
  }

  // ---- boards
  const boardIds = new Set()
  for (const b of m.boards ?? []) {
    if (boardIds.has(b.id)) err(`board "${b.id}": duplicate id`)
    boardIds.add(b.id)
    if (!["mermaid", "image", "text"].includes(b.kind)) err(`board "${b.id}": unknown kind "${b.kind}"`)
    if (!b.source) err(`board "${b.id}": empty source`)
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

  return { errors, warnings }
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = { refs: [], coverage: false, snapshots: null }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--refs") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) flags.refs.push(argv[++i])
    } else if (argv[i] === "--coverage") flags.coverage = true
    else if (argv[i] === "--snapshots") flags.snapshots = resolve(argv[++i])
    else positional.push(argv[i])
  }
  const manifestPath = resolve(positional[0] ?? (existsSync("stavy.json") ? "stavy.json" : "public/stavy.json"))
  const root = dirname(manifestPath)
  const m = JSON.parse(readFileSync(manifestPath, "utf8"))

  const { errors, warnings } = await validate(m, root, flags)

  // ---- report
  for (const w of warnings) console.log(`  warn  ${w}`)
  for (const e of errors) console.log(`  ERROR ${e}`)
  console.log(
    `\nstavy: ${m.pages.length} pages · ${m.scenarios.length} scenarios · ${(m.notes ?? []).length} notes — ${errors.length} error(s), ${warnings.length} warning(s)`
  )
  process.exit(errors.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
