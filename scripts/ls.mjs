#!/usr/bin/env node
// Stavy ls — what the manifest registers, without reading the whole file.
//
//   npm run stavy:ls                  one line per screen: id, fidelity, states, group, url
//   npm run stavy:ls -- <screen>      that screen's states, their URLs and scan keys, and the flows using it
//   npm run stavy:ls -- --json [...]  the same as JSON
//
//   --manifest <path>   default: ./stavy.json if present, else ./public/stavy.json
//
// Read-only. Agents use it instead of opening a large stavy.json or writing a parser.
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { STATE_DIM, instanceKey, normalizeManifest, resolveDims, statePath } from "./lib/model.mjs"

/** The instances a screen shows: its pinned ones, or its default state when none are pinned. */
const instancesOf = (p) => (p.instances?.length ? p.instances : [{ dims: {} }])

/** One row per screen. Takes a raw manifest (not normalised). */
export function listPages(raw) {
  const m = normalizeManifest(structuredClone(raw))
  return m.pages.map((p) => ({
    id: p.id,
    ...(p.label ? { label: p.label } : {}),
    ...(p.group ? { group: p.group } : {}),
    fidelity: p.fidelity ?? null,
    states: instancesOf(p).length,
    url: p.url ?? p.states?.[0]?.url ?? null,
  }))
}

/** One screen in detail, or null when no screen has that id. Takes a raw manifest. */
export function showPage(raw, id) {
  const m = normalizeManifest(structuredClone(raw))
  const p = m.pages.find((x) => x.id === id)
  if (!p) return null
  const named = Array.isArray(p.states) && p.states.length > 0
  const states = instancesOf(p).map((i) => {
    const dims = resolveDims(p, i.dims ?? {})
    const stateId = dims[STATE_DIM]
    const visible = Object.fromEntries(Object.entries(dims).filter(([d]) => d !== STATE_DIM))
    return {
      ...(stateId ? { id: stateId } : {}),
      ...(Object.keys(visible).length ? { dims: visible } : {}),
      url: statePath(p, dims),
      key: stateId ? `${p.id}/${stateId}` : Object.keys(dims).length ? instanceKey(p.id, dims) : p.id,
      ...(i.note ? { note: i.note } : {}),
    }
  })
  const hidden = named ? p.states.filter((s) => s.hidden).map((s) => s.id) : []
  const flows = m.scenarios.filter((s) => (s.steps ?? []).some((st) => st.page === p.id)).map((s) => s.id)
  return {
    id: p.id,
    ...(p.label ? { label: p.label } : {}),
    ...(p.group ? { group: p.group } : {}),
    fidelity: p.fidelity ?? null,
    url: p.url ?? null,
    ...(named ? {} : { dimensions: p.dimensions, defaults: p.defaults ?? {} }),
    states,
    ...(hidden.length ? { hidden } : {}),
    flows,
  }
}

/** Text for `ls` with no screen. */
export function formatList(rows) {
  if (!rows.length) return "No screens registered."
  const w = Math.max(...rows.map((r) => r.id.length), 6)
  const lines = rows.map((r) =>
    [r.id.padEnd(w), (r.fidelity ?? "-").padEnd(11), `${r.states} state${r.states === 1 ? "" : "s"}`.padEnd(10), (r.group ?? "").padEnd(14), r.url ?? ""]
      .join("  ")
      .trimEnd()
  )
  return [...lines, "", `${rows.length} screen${rows.length === 1 ? "" : "s"}. Details: npm run stavy:ls -- <screen>`].join("\n")
}

/** Text for `ls <screen>`. */
export function formatPage(d) {
  const out = [`${d.id}${d.label ? ` — ${d.label}` : ""}${d.group ? `  (${d.group})` : ""}`, `fidelity: ${d.fidelity ?? "not set"}`]
  if (d.url) out.push(`url: ${d.url}`)
  if (d.dimensions && Object.keys(d.dimensions).length) out.push(`dimensions: ${Object.entries(d.dimensions).map(([k, v]) => `${k} = ${v.join(" | ")}`).join("; ")}`)
  out.push("", `states (${d.states.length}):`)
  for (const s of d.states) {
    const name = s.id ?? (Object.entries(s.dims ?? {}).map(([k, v]) => `${k}=${v}`).join(" ") || "default")
    out.push(`  ${name}  ${s.url ?? "(no url)"}${s.note ? `  — ${s.note}` : ""}`)
    out.push(`    scan key: ${s.key}`)
  }
  if (d.hidden) out.push(`hidden states: ${d.hidden.join(", ")}`)
  out.push(`flows: ${d.flows.length ? d.flows.join(", ") : "none"}`)
  return out.join("\n")
}

export function findManifest(explicit) {
  if (explicit) return resolve(explicit)
  return resolve(existsSync("stavy.json") ? "stavy.json" : "public/stavy.json")
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2)
  const json = argv.includes("--json")
  const mi = argv.indexOf("--manifest")
  const manifestPath = findManifest(mi >= 0 ? argv[mi + 1] : null)
  const rest = argv.filter((a, i) => a !== "--json" && (mi < 0 || (i !== mi && i !== mi + 1)))
  if (!existsSync(manifestPath)) {
    console.error(`stavy:ls: no manifest at ${manifestPath} (pass --manifest <path>)`)
    process.exit(2)
  }
  const raw = JSON.parse(readFileSync(manifestPath, "utf8"))
  const id = rest[0]
  if (!id) {
    const rows = listPages(raw)
    console.log(json ? JSON.stringify(rows, null, 2) : formatList(rows))
  } else {
    const d = showPage(raw, id)
    if (!d) {
      console.error(`stavy:ls: no screen "${id}". Screens: ${listPages(raw).map((r) => r.id).join(", ")}`)
      process.exit(1)
    }
    console.log(json ? JSON.stringify(d, null, 2) : formatPage(d))
  }
}
