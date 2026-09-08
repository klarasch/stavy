#!/usr/bin/env node
// Handoff sheets: one Markdown file per page/component, generated from the manifest + source.
//
//   node scripts/handoff.mjs [--out docs/handoff]
//
// What an engineer needs to build it for real: template + source, organisms,
// dimensions and defaults, pinned states, scenarios that pass through, the
// semantic targets (data-proto ids) and what they do, design annotations, fidelity.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { resolve, dirname, relative } from "node:path"

const args = process.argv.slice(2)
const out = resolve(args[args.indexOf("--out") + 1] || "docs/handoff")
const m = JSON.parse(readFileSync("stavy.json", "utf8"))
mkdirSync(out, { recursive: true })
const tpl = new Map(m.templates.map((t) => [t.id, t]))
const page = new Map(m.pages.map((p) => [p.id, p]))
const dimLabel = (d) => m.dimensions.find((x) => x.id === d)?.label ?? d
const valLabel = (d, v) => m.dimensions.find((x) => x.id === d)?.values.find((x) => x.id === v)?.label ?? v

function readAll(entry, depth = 2, seen = new Set()) {
  const abs = resolve(entry)
  if (!existsSync(abs) || seen.has(abs)) return seen
  seen.add(abs)
  if (depth === 0) return seen
  const text = readFileSync(abs, "utf8")
  for (const mm of text.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
    const base = resolve(dirname(abs), mm[1])
    const dep = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`].find((c) => existsSync(c) && !c.endsWith("/"))
    if (dep) readAll(dep, depth - 1, seen)
  }
  return seen
}
function targetsIn(p) {
  // The template's `source` is the only file the manifest points at: v0.2 has
  // no per-page module (SPEC "Changes from v0.1").
  const t = tpl.get(p.template)
  const entries = [t?.source].filter(Boolean)
  const files = new Set()
  entries.forEach((e) => readAll(e, 2, files))
  const found = new Map()
  for (const f of files) {
    const text = readFileSync(f, "utf8")
    for (const mm of text.matchAll(/proto\(\s*[`"']([A-Z][A-Za-z0-9]*)(?::[^`"']*)?[`"']\s*(?:,\s*(\{[^)]*\}))?/g)) {
      if (!found.has(mm[1])) found.set(mm[1], mm[2] ? mm[2].replace(/\s+/g, " ").slice(0, 140) : "")
    }
  }
  return found
}

// A figure's `source` is a URL the app serves ("/figures/x.png"). These sheets
// are read in the repo, so point at the file that URL is served from when we
// can find it; otherwise leave the URL alone (it may be remote).
function figureSrc(source) {
  const local = source.startsWith("/") ? resolve(`public${source}`) : null
  return local && existsSync(local) ? relative(out, local) : source
}

let n = 0
for (const p of m.pages) {
  const t = tpl.get(p.template)
  const scs = m.scenarios.filter((s) => s.steps.some((st) => st.page === p.id))
  const targets = targetsIn(p)
  const L = []
  L.push(`# ${p.label}${p.kind === "component" ? " (component)" : ""}`, "")
  if (p.description) L.push(p.description, "")
  L.push(`| | |`, `|---|---|`)
  L.push(`| id | \`${p.id}\` |`)
  if (p.group) L.push(`| section | ${p.group} |`)
  if (p.template) L.push(`| template | \`${p.template}\` — \`${t?.source ?? "?"}\` |`)
  if (t?.uiKit?.length) L.push(`| UI-kit components | ${t.uiKit.join(", ")} |`)
  if (t?.organisms?.length) L.push(`| organisms | ${t.organisms.map((o) => `[${page.get(o)?.label ?? o}](./${o}.md)`).join(", ")} |`)
  if (p.frame) L.push(`| frame | ${p.frame.width} × ${p.frame.height} |`)
  L.push(`| fidelity | ${p.fidelity ?? "static"} |`, "")
  L.push(`## Dimensions`, "")
  const dimEntries = Object.entries(p.dimensions ?? {})
  // A page with no axes is a normal page (SPEC §1.3), not an unfinished one.
  if (!dimEntries.length) L.push("_None — one screen, at one URL._")
  for (const [d, vs] of dimEntries) L.push(`- **${dimLabel(d)}** (\`${d}\`): ${vs.map((v) => (v === p.defaults?.[d] ? `**${valLabel(d, v)}** (default)` : valLabel(d, v))).join(" · ")}`)
  if (p.instances?.length || dimEntries.length) {
    L.push("", `## Pinned states (${p.instances?.length ?? 0})`, "")
    for (const i of p.instances ?? []) L.push(`- ${Object.entries(i.dims).map(([d, v]) => `${dimLabel(d)}: ${valLabel(d, v)}`).join(", ") || "default"}${i.note ? ` — ${i.note}` : ""}`)
  }
  L.push("", `## Semantic targets (\`data-proto\`)`, "")
  if (targets.size === 0) L.push("_none found in source_")
  else for (const [id, meta] of targets) L.push(`- \`${id}\`${meta ? ` — ${meta}` : ""}`)
  if (p.annotations?.length) {
    L.push("", `## Design annotations`, "")
    p.annotations.forEach((a, i) => L.push(`${i + 1}. **${a.title}** (\`${a.target}\`) — ${a.note}`))
  }
  L.push("", `## Scenarios that pass through (${scs.length})`, "")
  for (const s of scs) {
    L.push(`- **${s.label}**${s.refs?.length ? ` — ${s.refs.join(", ")}` : ""}`)
    s.steps.forEach((st, i) => { if (st.page === p.id) L.push(`  ${i + 1}. ${st.title}${st.target ? ` → \`${st.target}\`` : ""}${st.dims ? ` (${Object.entries(st.dims).map(([d, v]) => `${d}=${v}`).join(", ")})` : ""}`) })
  }
  // Figures: boards anchored to this page (SPEC §1.7) — the menus, hover
  // states and comparisons that never became a URL, with their callouts.
  const figures = (m.boards ?? []).filter((b) => b.page === p.id)
  if (figures.length) {
    L.push("", `## Figures (${figures.length})`, "")
    for (const f of figures) {
      L.push(`### ${f.title}`, "")
      if (f.description) L.push(f.description, "")
      if (f.kind === "image") L.push(`![${f.title}](${figureSrc(f.source)})`, "")
      f.callouts?.forEach((c, i) => L.push(`${i + 1}. **${c.title}**${c.note ? ` — ${c.note}` : ""}`))
    }
  }
  const notes = (m.notes ?? []).filter((x) => x.page === p.id)
  if (notes.length) {
    L.push("", "## Canvas notes", "")
    notes.forEach((x) => L.push(`- ${x.text}`))
  }
  L.push("", `_Generated from stavy.json — do not edit by hand._`)
  writeFileSync(resolve(out, `${p.id}.md`), L.join("\n") + "\n")
  n++
}
const index = [`# Handoff — ${m.product.name}`, "", ...m.pages.map((p) => `- [${p.label}](./${p.id}.md)${p.kind === "component" ? " (component)" : ""} — ${p.fidelity ?? "static"}, ${p.instances?.length ? `${p.instances.length} states` : "one state"}`)]
writeFileSync(resolve(out, "README.md"), index.join("\n") + "\n")
console.log(`${n} handoff sheet(s) written to ${out}`)
