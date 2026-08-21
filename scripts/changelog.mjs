#!/usr/bin/env node
// Human-readable changelog between two versions of stavy.json.
//
//   node scripts/changelog.mjs [base-ref] [head-ref|--working]   (defaults: origin/main…working tree, falls back to HEAD)
//   node scripts/changelog.mjs HEAD~1
//
// Prints Markdown — paste into the PR description or let CI post it as a comment.
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"

const [baseArg, headArg] = process.argv.slice(2)
function gitShow(ref) {
  try {
    return JSON.parse(execSync(`git show ${ref}:stavy.json`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
  } catch {
    return null
  }
}
const base = gitShow(baseArg ?? "origin/main") ?? gitShow("HEAD") ?? { dimensions: [], templates: [], pages: [], scenarios: [], prototypes: [], notes: [], boards: [], requirements: [] }
const head = headArg && headArg !== "--working" ? gitShow(headArg) : JSON.parse(readFileSync("stavy.json", "utf8"))
const baseLabel = baseArg ?? "origin/main"
const headLabel = headArg && headArg !== "--working" ? headArg : "working tree"

const lines = []
const h = (s) => lines.push(`\n### ${s}`)
const li = (s) => lines.push(`- ${s}`)
const byId = (arr = []) => new Map(arr.map((x) => [x.id, x]))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const dimsStr = (d) => Object.entries(d ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")

function section(name, baseArr, headArr, describe, label = (x) => x.label ?? x.title ?? x.id) {
  const b = byId(baseArr)
  const hd = byId(headArr)
  const out = []
  for (const [id, x] of hd) if (!b.has(id)) out.push(`**added** ${label(x)} \`${id}\``)
  for (const [id, x] of b) if (!hd.has(id)) out.push(`**removed** ${label(x)} \`${id}\``)
  for (const [id, x] of hd) if (b.has(id) && !same(b.get(id), x)) {
    const d = describe(b.get(id), x)
    if (d.length) out.push(`**changed** ${label(x)} \`${id}\`: ${d.join("; ")}`)
  }
  if (out.length) {
    h(name)
    out.forEach(li)
  }
  return out.length
}

let total = 0
total += section("Dimensions", base.dimensions, head.dimensions, (a, b) => {
  const av = new Set(a.values.map((v) => v.id)), bv = new Set(b.values.map((v) => v.id))
  const d = []
  const added = [...bv].filter((v) => !av.has(v)), removed = [...av].filter((v) => !bv.has(v))
  if (added.length) d.push(`+ values ${added.join(", ")}`)
  if (removed.length) d.push(`− values ${removed.join(", ")}`)
  return d
})
total += section("Templates", base.templates, head.templates, (a, b) => {
  const d = []
  if (a.source !== b.source) d.push(`source ${a.source} → ${b.source}`)
  if (!same(a.organisms, b.organisms)) d.push(`organisms ${(a.organisms ?? []).join(",") || "—"} → ${(b.organisms ?? []).join(",") || "—"}`)
  return d
})
total += section("Pages & components", base.pages, head.pages, (a, b) => {
  const d = []
  if (a.template !== b.template) d.push(`template ${a.template} → ${b.template}`)
  if (a.fidelity !== b.fidelity) d.push(`fidelity ${a.fidelity ?? "—"} → ${b.fidelity ?? "—"}`)
  for (const k of new Set([...Object.keys(a.dimensions), ...Object.keys(b.dimensions)])) {
    if (!a.dimensions[k]) d.push(`+ dimension ${k}`)
    else if (!b.dimensions[k]) d.push(`− dimension ${k}`)
    else if (!same(a.dimensions[k], b.dimensions[k])) d.push(`dimension ${k}: ${a.dimensions[k].length} → ${b.dimensions[k].length} values`)
  }
  const ai = new Set((a.instances ?? []).map((i) => dimsStr(i.dims))), bi = new Set((b.instances ?? []).map((i) => dimsStr(i.dims)))
  const addedI = [...bi].filter((x) => !ai.has(x)), removedI = [...ai].filter((x) => !bi.has(x))
  if (addedI.length) d.push(`+ ${addedI.length} pinned state(s): ${addedI.join(" | ")}`)
  if (removedI.length) d.push(`− ${removedI.length} pinned state(s): ${removedI.join(" | ")}`)
  const aa = (a.annotations ?? []).length, ba = (b.annotations ?? []).length
  if (aa !== ba) d.push(`annotations ${aa} → ${ba}`)
  else if (!same(a.annotations, b.annotations)) d.push("annotation text edited")
  return d
}, (x) => `${x.label}${x.kind === "component" ? " (component)" : ""}`)
total += section("Scenarios", base.scenarios, head.scenarios, (a, b) => {
  const d = []
  if (a.steps.length !== b.steps.length) d.push(`${a.steps.length} → ${b.steps.length} steps`)
  else {
    const changed = b.steps.map((s, i) => (same(a.steps[i], s) ? null : i + 1)).filter(Boolean)
    if (changed.length) d.push(`step(s) ${changed.join(", ")} changed`)
  }
  if (!same(a.refs, b.refs)) d.push(`refs ${(a.refs ?? []).join(", ") || "—"} → ${(b.refs ?? []).join(", ") || "—"}`)
  return d
})
total += section("Prototypes (slices)", base.prototypes, head.prototypes, (a, b) => {
  const d = []
  if (!same(a.pages, b.pages)) d.push(`pages ${a.pages.length} → ${b.pages.length}`)
  if (!same(a.scenarios, b.scenarios)) d.push(`scenarios ${a.scenarios.length} → ${b.scenarios.length}`)
  return d
})
total += section("Requirements", base.requirements, head.requirements, (a, b) => (a.title !== b.title ? ["title edited"] : []))
total += section("Notes", base.notes, head.notes, (a, b) => (a.text !== b.text ? ["text edited"] : []), (x) => x.text.slice(0, 50) + (x.text.length > 50 ? "…" : ""))
total += section("Boards", base.boards, head.boards, (a, b) => (a.source !== b.source ? ["content edited"] : []))

const coverage = (m) => m.pages.reduce((n, p) => n + (p.instances?.length ?? 0), 0)
const header = `## Stavy changes — ${baseLabel} → ${headLabel}\n\n${total === 0 ? "No manifest changes." : `${total} change(s). Pinned states: ${coverage(base)} → ${coverage(head)} · scenarios: ${base.scenarios.length} → ${head.scenarios.length} · pages: ${base.pages.length} → ${head.pages.length}`}`
console.log([header, ...lines].join("\n"))
