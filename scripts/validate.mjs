#!/usr/bin/env node
// Protoscope check — validates the manifest against the code (the SKILL.md
// invariants), optionally checks scenario refs against requirement documents,
// and prints a coverage summary.
//
//   node scripts/validate.mjs [protoscope.json] [--refs docs/PRD-118.md ...] [--coverage]
//
// Exit code 1 on errors; warnings never fail the run.
import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"

const argv = process.argv.slice(2)
const flags = { refs: [], coverage: false }
const positional = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--refs") {
    while (argv[i + 1] && !argv[i + 1].startsWith("--")) flags.refs.push(argv[++i])
  } else if (argv[i] === "--coverage") flags.coverage = true
  else positional.push(argv[i])
}
const manifestPath = resolve(positional[0] ?? "protoscope.json")
const root = dirname(manifestPath)
const m = JSON.parse(readFileSync(manifestPath, "utf8"))

const errors = []
const warnings = []
const err = (s) => errors.push(s)
const warn = (s) => warnings.push(s)

// ---- shape: JSON Schema (spec/protoscope.schema.json), if ajv is installed
try {
  const { default: Ajv } = await import("ajv/dist/2020.js")
  const { default: addFormats } = await import("ajv-formats")
  const schemaPath = [resolve(root, "spec/protoscope.schema.json"), resolve(import.meta.dirname, "../spec/protoscope.schema.json")].find(existsSync)
  if (schemaPath) {
    const ajv = new Ajv({ allErrors: true, strict: false })
    addFormats(ajv)
    const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")))
    if (!validate(m)) for (const e of validate.errors ?? []) err(`schema ${e.instancePath || "/"}: ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(" | ")})` : ""}`)
  }
} catch {
  /* ajv not installed — structural checks below still run */
}

const dimIndex = new Map(m.dimensions.map((d) => [d.id, new Set(d.values.map((v) => v.id))]))
const templateIndex = new Map(m.templates.map((t) => [t.id, t]))
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

// Source text for data-proto target lookup: the template, the page module, the
// template's declared organisms — and everything they import relatively (two
// levels deep), so targets living in an imported organism file are found.
const fileCache = new Map()
function readSource(abs) {
  if (fileCache.has(abs)) return fileCache.get(abs)
  const text = existsSync(abs) ? readFileSync(abs, "utf8") : ""
  fileCache.set(abs, text)
  return text
}
function resolveImport(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec)
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`])
    if (existsSync(cand) && !cand.endsWith("/")) return cand
  return null
}
function collectSources(entry, depth = 2, seen = new Set()) {
  const abs = resolve(root, entry)
  if (!existsSync(abs) || seen.has(abs)) return seen
  seen.add(abs)
  if (depth === 0) return seen
  const text = readSource(abs)
  for (const m of text.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
    const dep = resolveImport(abs, m[1])
    if (dep) collectSources(dep, depth - 1, seen)
  }
  return seen
}
function sourcesFor(page) {
  const t = templateIndex.get(page.template)
  const organismSources = (t?.organisms ?? [])
    .map((id) => pageIndex.get(id))
    .flatMap((c) => (c ? [templateIndex.get(c.template)?.source, c.module] : []))
  const entries = [t?.source, page.module ?? `src/demo/pages/${page.id}.tsx`, ...organismSources].filter(Boolean)
  const files = new Set()
  for (const e of entries) collectSources(e, 2, files)
  return [...files].map(readSource).join("\n")
}
// A target counts as present when its id appears as a string literal in the
// resolved sources (`proto("Id")`, `data-proto="Id"`, a lookup table entry),
// as a dynamic prefix (proto(`Id:${…}`)), or is declared in a comment:
//   // @proto-targets ApproveButton RejectButton
function hasTarget(src, target) {
  const base = target.split(":")[0]
  const q = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (new RegExp(`["'\`]${q(target)}["'\`]`).test(src)) return true
  if (new RegExp(`["'\`]${q(base)}:`).test(src)) return true
  for (const m of src.matchAll(/@proto-targets\s+([^\n*]+)/g)) if (m[1].split(/[\s,]+/).includes(target) || m[1].split(/[\s,]+/).includes(base)) return true
  return false
}

// ---- pages
for (const page of m.pages) {
  const w = `page "${page.id}"`
  if (!templateIndex.has(page.template)) err(`${w}: template "${page.template}" is not registered`)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(page.id)) err(`${w}: id must be kebab-case`)
  if (!page.fidelity) warn(`${w}: no fidelity rung declared (static | navigable | interactive)`)
  for (const [d, values] of Object.entries(page.dimensions)) {
    if (!dimIndex.has(d)) err(`${w}: unknown dimension "${d}"`)
    else for (const v of values) if (!dimIndex.get(d).has(v)) err(`${w}: "${d}=${v}" not declared`)
    if (!page.defaults?.[d]) warn(`${w}: no default for dimension "${d}" (first value will be used)`)
  }
  checkDims(`${w} defaults`, page, page.defaults)
  ;(page.instances ?? []).forEach((inst, i) => checkDims(`${w} instances[${i}]`, page, inst.dims))
  if (!page.instances?.length) warn(`${w}: no pinned instances — nothing will show on the canvas`)
  const src = sourcesFor(page)
  for (const a of page.annotations ?? []) {
    if (src && !hasTarget(src, a.target)) err(`${w} annotation target "${a.target}" not found in source`)
  }
}

// ---- scenarios
for (const sc of m.scenarios) {
  const w = `scenario "${sc.id}"`
  if (!sc.refs?.length) warn(`${w}: no refs — what requirement does it demonstrate?`)
  sc.steps.forEach((st, i) => {
    const page = pageIndex.get(st.page)
    if (!page) return err(`${w} step ${i + 1}: unknown page "${st.page}"`)
    checkDims(`${w} step ${i + 1}`, page, st.dims)
    if (st.target) {
      const src = sourcesFor(page)
      if (src && !hasTarget(src, st.target)) err(`${w} step ${i + 1}: target "${st.target}" not found in source of "${page.id}"`)
    }
    const inSlice = m.prototypes.some((p) => p.scenarios.includes(sc.id) && p.pages.includes(st.page))
    if (!inSlice) err(`${w} step ${i + 1}: page "${st.page}" is not in any prototype that includes this scenario`)
  })
}

// ---- templates
for (const t of m.templates) {
  for (const id of t.organisms ?? []) {
    const c = pageIndex.get(id)
    if (!c) err(`template "${t.id}": organism "${id}" is not a registered component`)
    else if (c.kind !== "component") warn(`template "${t.id}": organism "${id}" is a page, not a component`)
  }
}

// ---- prototypes
for (const p of m.prototypes) {
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
  if (n.target) {
    const src = sourcesFor(page)
    if (src && !hasTarget(src, n.target)) err(`note "${n.id}": target "${n.target}" not found in source of "${page.id}"`)
  }
}

// ---- copy catalog
if (m.strings && !existsSync(resolve(root, m.strings))) err(`strings catalog "${m.strings}" not found`)

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

// ---- report
for (const w of warnings) console.log(`  warn  ${w}`)
for (const e of errors) console.log(`  ERROR ${e}`)
console.log(
  `\nprotoscope: ${m.pages.length} pages · ${m.templates.length} templates · ${m.scenarios.length} scenarios · ${m.prototypes.length} prototypes · ${(m.notes ?? []).length} notes — ${errors.length} error(s), ${warnings.length} warning(s)`
)
process.exit(errors.length ? 1 : 0)
