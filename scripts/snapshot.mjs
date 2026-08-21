#!/usr/bin/env node
// Snapshot every pinned page instance as a PNG — for visual diffs in CI.
//
//   node scripts/snapshot.mjs [--url http://localhost:5173] [--out snapshots] [--slice <id>]
//
// Requires `playwright` and a Chromium (`npx playwright install chromium`), and a
// running dev/preview server at --url. Files: snapshots/<page>__<dim=value>__….png
import { readFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "playwright"

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const url = opt("--url", "http://localhost:5173").replace(/\/$/, "")
const out = resolve(opt("--out", "snapshots"))
const sliceId = opt("--slice", null)
const m = JSON.parse(readFileSync(resolve("protopact.json"), "utf8"))
const slice = sliceId ? m.prototypes.find((p) => p.id === sliceId) : null
const pages = m.pages.filter((p) => !slice || slice.pages.includes(p.id))
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ deviceScaleFactor: 1, colorScheme: "light" })
const page = await ctx.newPage()
let n = 0
for (const p of pages) {
  const W = p.frame?.width ?? 1280
  const H = p.frame?.height ?? 832
  await page.setViewportSize({ width: W, height: H })
  for (const inst of p.instances ?? [{ dims: {} }]) {
    const dims = Object.fromEntries(Object.keys(p.dimensions).map((d) => [d, inst.dims[d] ?? p.defaults?.[d] ?? p.dimensions[d][0]]))
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(dims).map(([k, v]) => [`d_${k}`, v])))
    qs.set("ui", "0") // hide the viewer chrome
    const href = `${url}/p/${p.id}?${qs}`
    await page.goto(href, { waitUntil: "networkidle" })
    await page.waitForTimeout(250)
    const name = `${p.id}__${Object.entries(dims).map(([k, v]) => `${k}=${v}`).join("__")}.png`
    await page.screenshot({ path: resolve(out, name), fullPage: p.kind !== "component" })
    n++
    process.stdout.write(`  ${name}\n`)
  }
}
await browser.close()
console.log(`\n${n} snapshot(s) written to ${out}`)
