#!/usr/bin/env node
// Stavy scan — the coverage contract, checked against the running prototype.
//
// Visits every state the manifest cares about (pinned instances, scenario
// steps, note anchors) at the prototype's own URL, asserts that every target
// referenced for that state exists, scrolls the state's first required target
// into view if it's below the fold, measures where it is, and takes the
// snapshot the canvas shows. Writes:
//   <out>/<page>__<dim=value>__….png       one per state
//   <out>/index.json                         instanceKey → { file, width, height, targets, missing, scrolled }
//
//   node scripts/scan.mjs [stavy.json] [--url http://localhost:5173] [--app /base] [--out public/snapshots]
//                         [--only <pageId>] [--width 1920] [--height 1080] [--dpr 1] [--dark]
//
// The page viewport (every kind:"page" state) is manifest `viewer.viewport`,
// else 1920x1080 @ dpr 1 — the same default the viewer assumes (SPEC §1.8).
// --width/--height/--dpr override the manifest; a page's own `frame` always
// wins over both (components, mainly).
//
// Requires `playwright` + Chromium (`npx playwright install chromium`) and a
// running dev/preview server at --url. Exit code 1 when a referenced target is
// missing or a state fails to load — that is the contract breaking.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { chromium } from "playwright"
import { isOutsideViewport } from "./lib/viewport.mjs"

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : def
}
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["--dark"].includes(argv[i - 1])))
const manifestPath = resolve(positional[0] ?? (existsSync("stavy.json") ? "stavy.json" : "public/stavy.json"))
const root = dirname(manifestPath)
const m = JSON.parse(readFileSync(manifestPath, "utf8"))
const url = opt("--url", "http://localhost:5173").replace(/\/$/, "")
const appBase = (opt("--app", m.viewer?.app && !/^https?:/.test(m.viewer.app) ? m.viewer.app : "") ?? "").replace(/\/+$/, "")
const out = resolve(opt("--out", root === process.cwd() ? "public/snapshots" : resolve(root, "snapshots")))
const only = opt("--only", null)
// Manifest viewer.viewport is the default page viewport (SPEC §1.8); CLI flags override it.
const mViewport = m.viewer?.viewport ?? {}
const defaultW = Number(opt("--width", mViewport.width ?? 1920))
const defaultH = Number(opt("--height", mViewport.height ?? 1080))
const dpr = Number(opt("--dpr", mViewport.dpr ?? 1))
const dark = argv.includes("--dark")
const TARGET_ATTRS = m.viewer?.targetAttrs?.length ? m.viewer.targetAttrs : ["data-proto", "data-testid"]

/* ---------------- the same resolution rules as the viewer ---------------- */
// A page may omit `dimensions` entirely (SPEC §1.3: one screen, one card) — read it as {}.
const dimsOf = (p) => p.dimensions ?? {}
const resolveDims = (p, o = {}) => Object.fromEntries(Object.keys(dimsOf(p)).map((d) => [d, o[d] ?? p.defaults?.[d] ?? dimsOf(p)[d][0]]))
const instanceKey = (pid, dims) =>
  `${pid}?${Object.entries(dims)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")}`
const fileFor = (p, dims) => `${p.id}__${Object.keys(dimsOf(p)).map((d) => `${d}=${dims[d]}`).join("__")}.png`
const appUrl = (p, dims) => {
  const filled = p.url.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, d) => encodeURIComponent(dims[d] ?? ""))
  if (/^[a-z]+:\/\//i.test(filled)) return filled
  return `${url}${appBase}${filled.startsWith("/") ? "" : "/"}${filled}`
}
const BARE = /^[A-Za-z][\w:.-]*$/
const selectorFor = (t) => (BARE.test(t) ? TARGET_ATTRS.map((a) => `[${a}="${t.replace(/["\\]/g, "\\$&")}"]`).join(", ") : t)
const dimsEq = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k])

/* ---------------- which states, and which targets each must show ---------------- */
// Two kinds of target reference:
//   required — a scenario step or a pointing note points at it in *this* state;
//              missing = the contract is broken (exit 1).
//   optional — the page's annotations; they are measured wherever they exist so
//              pins and anatomy can be drawn, but a state where a part is not
//              rendered (a closed modal, an empty list) is not a failure.
const states = new Map() // key → { page, dims, required:Set, optional:Set, why:Set }
const want = (page, dims, why, required = [], optional = []) => {
  const key = instanceKey(page.id, dims)
  const s = states.get(key) ?? { page, dims, required: new Set(), optional: new Set(), why: new Set() }
  for (const t of required) if (t) s.required.add(t)
  for (const t of optional) if (t) s.optional.add(t)
  s.why.add(why)
  states.set(key, s)
}
const pageIndex = new Map(m.pages.map((p) => [p.id, p]))
for (const p of m.pages) {
  if (only && p.id !== only) continue
  const annots = (p.annotations ?? []).map((a) => a.target)
  for (const inst of p.instances ?? [{ dims: {} }]) want(p, resolveDims(p, inst.dims), "instance", [], annots)
}
for (const sc of m.scenarios) {
  for (const st of sc.steps) {
    const p = pageIndex.get(st.page)
    if (!p || (only && p.id !== only)) continue
    want(p, resolveDims(p, st.dims), `scenario ${sc.id}`, [st.target], (p.annotations ?? []).map((a) => a.target))
  }
}
for (const n of m.notes ?? []) {
  const p = pageIndex.get(n.page)
  if (!p || (only && p.id !== only)) continue
  want(p, resolveDims(p, n.dims ?? p.instances?.[0]?.dims), `note ${n.id}`, [n.target], (p.annotations ?? []).map((a) => a.target))
}

/* ---------------- run ---------------- */
mkdirSync(out, { recursive: true })
const indexPath = resolve(out, "index.json")
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {}
const browser = await chromium.launch()
const ctx = await browser.newContext({ deviceScaleFactor: dpr, colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" })
const page = await ctx.newPage()
const consoleErrors = []
// Scan navigates the same frame mid-fetch (a new state's page.goto while a
// previous state's request is still in flight), which the browser reports as
// an AbortError on that request — not a bug in the prototype. Drop it here so
// it doesn't drown out real console errors in the log.
const isOwnNavigationAbort = (s) => /AbortError/.test(s) && /signal is aborted/i.test(s)
page.on("pageerror", (e) => {
  const s = String(e)
  if (!isOwnNavigationAbort(s)) consoleErrors.push(s)
})
page.on("console", (msg) => {
  if (msg.type() !== "error") return
  const s = msg.text()
  if (isOwnNavigationAbort(s)) return
  consoleErrors.push(s)
})

let failures = 0
let n = 0
const startedAt = Date.now()
for (const [key, s] of states) {
  const { page: p, dims } = s
  const W = p.frame?.width ?? defaultW
  const H = p.frame?.height ?? defaultH
  await page.setViewportSize({ width: W, height: H })
  const href = appUrl(p, dims)
  consoleErrors.length = 0
  let status = null
  try {
    const res = await page.goto(href, { waitUntil: "networkidle", timeout: 30_000 })
    status = res?.status() ?? null
  } catch (e) {
    console.log(`  ✗ ${key}\n      ${href}\n      failed to load: ${String(e).split("\n")[0]}`)
    failures++
    continue
  }
  await page.waitForTimeout(300)
  const required = [...s.required]
  const targets = [...new Set([...required, ...s.optional])]
  // Scroll the state's first required target (a scenario step or a note, whichever
  // this state exists for) into view before measuring and screenshotting — otherwise
  // a target below the fold (a selected row deep in a list) renders a thumbnail that
  // shows nothing selected. The "is it outside the viewport" decision runs in Node
  // (isOutsideViewport, unit-tested in tests/unit/viewport.unit.ts) against a rect
  // fetched from the page; only the query + the actual scroll run in the browser.
  // scrollIntoView handles nested scrollers natively. Boxes are measured after the
  // scroll, so they stay consistent with what the screenshot shows.
  let scrolled = false
  if (required[0]) {
    const sel = selectorFor(required[0])
    const rect = await page.evaluate((sel) => {
      let el = null
      try {
        el = document.querySelector(sel)
      } catch {}
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
    }, sel)
    if (rect && isOutsideViewport(rect, W, H)) {
      await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center", inline: "nearest" }), sel)
      await page.waitForTimeout(150) // let the scroll/layout settle before measuring
      scrolled = true
    }
  }
  const boxes = await page.evaluate(
    ({ targets, selectors, W, H }) => {
      const out = {}
      const missing = []
      targets.forEach((t, i) => {
        let el = null
        try {
          el = document.querySelector(selectors[i])
        } catch {}
        if (!el) {
          missing.push(t)
          return
        }
        const r = el.getBoundingClientRect()
        out[t] = { x: +(r.left / W).toFixed(4), y: +(r.top / H).toFixed(4), w: +(r.width / W).toFixed(4), h: +(r.height / H).toFixed(4) }
      })
      return { out, missing, title: document.title }
    },
    { targets, selectors: targets.map(selectorFor), W, H }
  )
  const file = fileFor(p, dims)
  await page.screenshot({ path: resolve(out, file), fullPage: false })
  n++
  const missing = boxes.missing.filter((t) => required.includes(t))
  const absent = boxes.missing.filter((t) => !required.includes(t))
  index[key] = { file, width: W, height: H, dpr, targets: boxes.out, ...(missing.length ? { missing } : {}), ...(absent.length ? { absent } : {}), ...(scrolled ? { scrolled: true } : {}), at: new Date().toISOString() }
  const bad = missing.length > 0 || (status && status >= 400)
  if (bad) failures++
  const mark = bad ? "✗" : "✓"
  const why = [...s.why].join(", ")
  console.log(`  ${mark} ${key}  (${why})${absent.length ? `  · not on this state: ${absent.join(", ")}` : ""}`)
  if (status && status >= 400) console.log(`      HTTP ${status} at ${href}`)
  for (const t of missing) console.log(`      missing target "${t}"  ← ${selectorFor(t)}`)
  for (const e of consoleErrors.slice(0, 3)) console.log(`      console: ${e.slice(0, 160)}`)
}
await browser.close()
// A full scan owns the whole folder: states the manifest no longer wants
// (a dropped dimension value, a removed instance) would otherwise linger in
// the index with their old size and trip validate's mismatch check forever.
// `--only` scans a slice, so it must not prune what it did not visit.
if (!only) {
  for (const key of Object.keys(index)) {
    if (states.has(key)) continue
    const stale = index[key]?.file
    if (stale && existsSync(resolve(out, stale))) rmSync(resolve(out, stale))
    delete index[key]
  }
}
writeFileSync(indexPath, JSON.stringify(index, null, 1) + "\n")
console.log(`\n${n} state(s) scanned in ${((Date.now() - startedAt) / 1000).toFixed(1)}s → ${out}${failures ? `\n${failures} state(s) FAILED the contract` : ""}`)
process.exit(failures ? 1 : 0)
