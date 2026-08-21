#!/usr/bin/env node
// Generate Playwright specs from scenarios: one test per scenario, one step per
// scenario step. Each step opens the state URL (viewer chrome hidden), asserts
// the semantic target is visible, clicks it, and — where the prototype is wired
// (fidelity ≠ static) — asserts the next step's state is reached.
//
//   node scripts/gen-tests.mjs [--out tests/scenarios]
//
// Run with `npx playwright test` (playwright.config.ts starts the dev server).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

const args = process.argv.slice(2)
const out = resolve(args[args.indexOf("--out") + 1] || "tests/scenarios")
const m = JSON.parse(readFileSync("protoscope.json", "utf8"))
mkdirSync(out, { recursive: true })
const page = new Map(m.pages.map((p) => [p.id, p]))
const resolveDims = (p, o = {}) => Object.fromEntries(Object.keys(p.dimensions).map((d) => [d, o[d] ?? p.defaults?.[d] ?? p.dimensions[d][0]]))
const url = (pid, dims) => `/p/${pid}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(dims).map(([k, v]) => [`d_${k}`, v])), ui: "0" })}`
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

let n = 0
for (const sc of m.scenarios) {
  const L = [
    `// Generated from protoscope.json — scenario "${sc.id}". Regenerate with \`npm run gen:tests\`.`,
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
      L.push(`    const target = page.locator('[data-proto="${esc(st.target)}"]').first()`)
      L.push(`    await expect(target, "${esc(st.note ?? st.title)}").toBeVisible()`)
      if (nextPage && fidelity !== "static") {
        const nd = resolveDims(nextPage, next.dims)
        const samePage = nextPage.id === p.id
        // interactive pages wire real state machines → hard assertions; navigable pages → soft
        // assertions, so a target that isn't wired yet is a finding, not a red build.
        const ex = fidelity === "interactive" ? "expect" : "expect.soft"
        L.push(`    await target.click()`)
        L.push(`    // fidelity: ${fidelity} — next state: "${esc(next.title)}"`)
        L.push(`    await ${ex}(page).toHaveURL(/\\/p\\/${nextPage.id}\\b/)`)
        for (const [d, v] of Object.entries(nd)) if (!samePage || dims[d] !== v) L.push(`    await ${ex}(page).toHaveURL(new RegExp("d_${d}=${esc(v)}"))`)
      } else if (nextPage) {
        L.push(`    // TODO(fidelity: static): clicking is not wired in the prototype; the next state is "${esc(next.title)}" at ${url(nextPage.id, resolveDims(nextPage, next.dims))}`)
      }
    } else {
      L.push(`    await expect(page.locator("[data-proto]").first()).toBeVisible() // observe step`)
    }
    L.push(`  })`, "")
  })
  L.push(`})`, "")
  writeFileSync(resolve(out, `${sc.id}.spec.ts`), L.join("\n"))
  n++
}
console.log(`${n} spec(s) written to ${out}`)
