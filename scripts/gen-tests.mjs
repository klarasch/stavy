#!/usr/bin/env node
// Generate Playwright specs from scenarios: one test per scenario, one step per
// scenario step. Each step opens the prototype's own URL for that state (the
// page's url template, filled), asserts the semantic target is visible, clicks
// it, and — where the prototype is wired (fidelity ≠ static) — asserts the
// next step's state is reached (the app URL must match the next step's template).
//
//   node scripts/gen-tests.mjs [--out tests/scenarios]
//
// Run with `npx playwright test` (playwright.config.ts starts the dev server).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

const args = process.argv.slice(2)
const out = resolve(args[args.indexOf("--out") + 1] || "tests/scenarios")
const m = JSON.parse(readFileSync("stavy.json", "utf8"))
mkdirSync(out, { recursive: true })
const page = new Map(m.pages.map((p) => [p.id, p]))
const resolveDims = (p, o = {}) => Object.fromEntries(Object.keys(p.dimensions).map((d) => [d, o[d] ?? p.defaults?.[d] ?? p.dimensions[d][0]]))
const appBase = (m.viewer?.app && !/^https?:/.test(m.viewer.app) ? m.viewer.app : "").replace(/\/+$/, "")
const url = (pid, dims) => {
  const p = page.get(pid)
  const filled = p.url.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, d) => encodeURIComponent(dims[d] ?? ""))
  return /^[a-z]+:\/\//i.test(filled) ? filled : `${appBase}${filled.startsWith("/") ? "" : "/"}${filled}`
}
const TARGET_ATTRS = m.viewer?.targetAttrs?.length ? m.viewer.targetAttrs : ["data-proto", "data-testid"]
const BARE = /^[A-Za-z][\w:.-]*$/
const selectorFor = (t) => (BARE.test(t) ? TARGET_ATTRS.map((a) => `[${a}="${t.replace(/["\\]/g, "\\$&")}"]`).join(", ") : t)
// Regex a URL must match to be "at" a page state: the path literal with {dim} → value, then the query in
// any order. A param whose value is the page default may be absent (prototypes routinely omit defaults),
// but if present it must match; a param at a non-default value must be present.
const stateRegex = (pid, dims) => {
  const p = page.get(pid)
  const [pathT, queryT = ""] = p.url.split("?")
  const q = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const path = q(`${appBase}${pathT.startsWith("/") ? "" : "/"}${pathT}`).replace(/\\\{([a-zA-Z0-9_-]+)\\\}/g, (_, d) => q(encodeURIComponent(dims[d] ?? "")))
  const defaultOf = (d) => p.defaults?.[d] ?? p.dimensions[d]?.[0]
  const params = [...new URLSearchParams(queryT)].map(([k, v]) => {
    const dm = v.match(/^\{([a-zA-Z0-9_-]+)\}$/)
    const val = q(encodeURIComponent(dm ? dims[dm[1]] ?? "" : v))
    const atDefault = dm && dims[dm[1]] === defaultOf(dm[1])
    // present-and-equal: k=val at the start of the query or after an &
    const present = `(?:(?:[^#]*&)?${q(k)}=${val}(?:&|#|$))`
    // absent: no "k=" anywhere in the query
    const absent = `(?![^#]*(?:^|&)${q(k)}=)`
    return atDefault ? `(?=${present}|${absent})` : `(?=${present})`
  })
  const anyAtNonDefault = [...new URLSearchParams(queryT)].some(([, v]) => {
    const dm = v.match(/^\{([a-zA-Z0-9_-]+)\}$/)
    return dm ? dims[dm[1]] !== defaultOf(dm[1]) : true
  })
  const query = `\\?${params.join("")}[^#]*`
  return `${path}\\/?(?:${query})${anyAtNonDefault ? "" : "?"}(?:#.*)?$`
}
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

let n = 0
for (const sc of m.scenarios) {
  const L = [
    `// Generated from stavy.json — scenario "${sc.id}". Regenerate with \`npm run gen:tests\`.`,
    `import { test, expect } from "@playwright/test"`,
    "",
    ...(sc.refs?.length ? [`// refs: ${sc.refs.join(", ")}`] : []),
    `test.describe("${esc(sc.label)}", () => {`,
  ]
  sc.steps.forEach((st, i) => {
    const p = page.get(st.page)
    if (!p) return
    const dims = resolveDims(p, st.dims)
    const next = sc.steps[i + 1]
    const nextPage = next && page.get(next.page)
    const fidelity = p.fidelity ?? "static"
    L.push(`  test("${i + 1}. ${esc(st.title)}", async ({ page }) => {`)
    L.push(`    await page.goto("${url(p.id, dims)}")`)
    if (st.target) {
      L.push(`    const target = page.locator(${JSON.stringify(selectorFor(st.target))}).first()`)
      L.push(`    await expect(target, "${esc(st.note ?? st.title)}").toBeVisible()`)
      if (nextPage && fidelity !== "static") {
        const nd = resolveDims(nextPage, next.dims)
        const samePage = nextPage.id === p.id
        // interactive pages wire real state machines → hard assertions; navigable pages → soft
        // assertions, so a target that isn't wired yet is a finding, not a red build.
        const ex = fidelity === "interactive" ? "expect" : "expect.soft"
        L.push(`    await target.click()`)
        L.push(`    // fidelity: ${fidelity} — next state: "${esc(next.title)}"`)
        void samePage
        L.push(`    await ${ex}(page).toHaveURL(new RegExp(${JSON.stringify(stateRegex(nextPage.id, nd))}))`)
      } else if (nextPage) {
        L.push(`    // TODO(fidelity: static): clicking is not wired in the prototype; the next state is "${esc(next.title)}" at ${url(nextPage.id, resolveDims(nextPage, next.dims))}`)
      }
    } else {
      L.push(`    await expect(page.locator("body")).toBeVisible() // observe step`)
    }
    L.push(`  })`, "")
  })
  L.push(`})`, "")
  writeFileSync(resolve(out, `${sc.id}.spec.ts`), L.join("\n"))
  n++
}
console.log(`${n} spec(s) written to ${out}`)
