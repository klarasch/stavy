#!/usr/bin/env node
// Handoff sheets: one Markdown file per page/component, generated from the manifest + source.
//
//   node scripts/handoff.mjs [--out docs/handoff]
//
// What an engineer needs to build it for real: template + source, organisms,
// dimensions and defaults, pinned states, scenarios that pass through, the
// semantic targets (data-proto ids) and what they do, design annotations, fidelity.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"

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
  const t = tpl.get(p.template)
  const entries = [t?.source, p.module ?? `src/demo/pages/${p.id}.tsx`].filter(Boolean)
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
  L.push(`| template | \`${p.template}\` — \`${t?.source ?? "?"}\` |`)
  if (t?.uiKit?.length) L.push(`| UI-kit components | ${t.uiKit.join(", ")} |`)
  if (t?.organisms?.length) L.push(`| organisms | ${t.organisms.map((o) => `[${page.get(o)?.label ?? o}](./${o}.md)`).join(", ")} |`)
  if (p.frame) L.push(`| frame | ${p.frame.width} × ${p.frame.height} |`)
  L.push(`| fidelity | ${p.fidelity ?? "static"} |`)
  L.push(`| module | \`${p.module ?? `src/demo/pages/${p.id}.tsx`}\` |`, "")
  L.push(`## Dimensions`, "")
  for (const [d, vs] of Object.entries(p.dimensions)) L.push(`- **${dimLabel(d)}** (\`${d}\`): ${vs.map((v) => (v === p.defaults?.[d] ? `**${valLabel(d, v)}** (default)` : valLabel(d, v))).join(" · ")}`)
  L.push("", `## Pinned states (${p.instances?.length ?? 0})`, "")
  for (const i of p.instances ?? []) L.push(`- ${Object.entries(i.dims).map(([d, v]) => `${dimLabel(d)}: ${valLabel(d, v)}`).join(", ") || "default"}${i.note ? ` — ${i.note}` : ""}`)
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
  const notes = (m.notes ?? []).filter((x) => x.page === p.id)
  if (notes.length) {
    L.push("", "## Canvas notes", "")
    notes.forEach((x) => L.push(`- ${x.text}`))
  }
  L.push("", `_Generated from stavy.json — do not edit by hand._`)
  writeFileSync(resolve(out, `${p.id}.md`), L.join("\n") + "\n")
  n++
}
const index = [`# Handoff — ${m.product.name}`, "", ...m.pages.map((p) => `- [${p.label}](./${p.id}.md)${p.kind === "component" ? " (component)" : ""} — ${p.fidelity ?? "static"}, ${p.instances?.length ?? 0} states`)]
writeFileSync(resolve(out, "README.md"), index.join("\n") + "\n")
console.log(`${n} handoff sheet(s) written to ${out}`)
