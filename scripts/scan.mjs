#!/usr/bin/env node
// Stavy scan — pre-renders the states the workspace shows, from the running
// prototype, into a gitignored cache the canvas reads.
//
// Collects states from pinned instances, scenario steps, notes and every board
// in <manifest dir>/stavy-content/boards/ (see scripts/lib/collect.mjs), then
// captures — incrementally by default — each at the prototype's own URL:
// settle, perform a board item's `do` actions, measure the targets it
// references, and write <out>/<stem>.webp plus an entry in <out>/index.json
// keyed by instanceKey / variantKey (scripts/lib/model.mjs).
//
//   node scripts/scan.mjs [stavy.json] [--url http://localhost:5173] [--app /base] [--out public/snapshots]
//                         [--keys a,b] [--all] [--only <pageId>] [--workers 4] [--strict]
//                         [--width 1920] [--height 1080] [--dpr 1] [--dark]
//
//   (default)  capture only states missing from the index, or whose file is gone / was
//              captured at another size
//   --keys     exactly those states, comma separated: "contacts" (a screen), "contacts/empty"
//              (a named state, with its crops/variants), or a full instanceKey / variantKey
//   --all      everything, and prune index entries nothing wants any more
//   --only     restrict to one page
//   --strict   a missing scenario-step target fails the scan (otherwise a warning)
//
// A rendered page identical to the cached one keeps its file and `at`, so the
// viewer does not reload images that did not change.
//
// Requires `playwright` + Chromium (`npx playwright install chromium`) and a
// running dev/preview server at --url. Exit code 1 only when a state fails to
// load (or, with --strict, when a scenario target is missing).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve, dirname } from "node:path"
import { chromium } from "playwright"
import { isOutsideViewport } from "./lib/viewport.mjs"
import { instanceKey, normalizeManifest, resolveDims, stateHref, variantStem } from "./lib/model.mjs"
import { collectStates, loadBoards, defaultSnapshotsDir } from "./lib/collect.mjs"
import { installGate } from "./lib/gate.mjs"

const argv = process.argv.slice(2)
const VALUE_OPTS = new Set(["--url", "--app", "--out", "--only", "--width", "--height", "--dpr", "--keys", "--workers"])
const opt = (name, def) => {
  const i = argv.lastIndexOf(name) // the last one wins, so `npm run stavy:scan -- --url …` overrides the script
  return i >= 0 ? argv[i + 1] : def
}
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUE_OPTS.has(argv[i - 1]))
const manifestPath = resolve(positional[0] ?? (existsSync("stavy.json") ? "stavy.json" : "public/stavy.json"))
const root = dirname(manifestPath)
const m = normalizeManifest(JSON.parse(readFileSync(manifestPath, "utf8")))
const url = opt("--url", "http://localhost:5173").replace(/\/$/, "")
const appBase = (opt("--app", m.viewer?.app && !/^https?:/.test(m.viewer.app) ? m.viewer.app : "") ?? "").replace(/\/+$/, "")
const out = resolve(opt("--out", defaultSnapshotsDir(root)))
const only = opt("--only", null)
const all = argv.includes("--all")
const strict = argv.includes("--strict")
const keysArg = opt("--keys", null)
const workers = Math.max(1, Number(opt("--workers", 4)) || 4)
// Manifest viewer.viewport is the default page viewport (SPEC §1.8); CLI flags override it.
const mViewport = m.viewer?.viewport ?? {}
const defaultW = Number(opt("--width", mViewport.width ?? 1920))
const defaultH = Number(opt("--height", mViewport.height ?? 1080))
const dpr = Number(opt("--dpr", mViewport.dpr ?? 1))
const dark = argv.includes("--dark")
const TARGET_ATTRS = m.viewer?.targetAttrs?.length ? m.viewer.targetAttrs : ["data-proto", "data-testid"]
const MARGIN = 16

const BARE = /^[A-Za-z][\w:.-]*$/
const selectorFor = (t) => (BARE.test(t) ? TARGET_ATTRS.map((a) => `[${a}="${t.replace(/["\\]/g, "\\$&")}"]`).join(", ") : t)
const hashOf = (buf) => createHash("sha1").update(buf).digest("base64url").slice(0, 22)

/* ---------------- which states ---------------- */
const { boards, problems } = loadBoards(root)
const warnings = [...problems]
const collected = collectStates(m, boards, { only })
warnings.push(...collected.warnings)
const states = collected.states

mkdirSync(out, { recursive: true })
const indexPath = resolve(out, "index.json")
const readIndex = () => (existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {})
const index = readIndex()

const sizeFor = (s) => ({ W: s.variant?.viewport?.width ?? s.page.frame?.width ?? defaultW, H: s.variant?.viewport?.height ?? s.page.frame?.height ?? defaultH })
// Keys in --keys may contain commas (a `type` action); a key always starts "<page-id>?",
// "<page-id>/" (shorthand) or is a bare page id.
const splitKeys = (s) => s.split(/,(?=\s*[A-Za-z0-9][\w-]*(?:[?/]|,|$))/).map((k) => k.trim()).filter(Boolean)
// Shorthand people and agents can type: "contacts" (every state of a screen,
// crops and board variants included) or "contacts/empty" (one named state and
// its variants). Full instance / variant keys still work as-is.
const expandShorthand = (key) => {
  const m2 = key.match(/^([A-Za-z0-9][\w-]*)(?:\/([\w.-]+))?$/)
  if (!m2 || states.has(key)) return null
  const [, pid, st] = m2
  return [...states.values()].filter((x) => x.page.id === pid && (!st || x.dims._state === st || Object.values(x.dims).includes(st)))
}

let selected
let cached = 0
if (keysArg != null) {
  selected = []
  for (const key of splitKeys(keysArg)) {
    const many = expandShorthand(key)
    if (many) {
      if (many.length) selected.push(...many)
      else warnings.push(`--keys: nothing registered for "${key}"`)
      continue
    }
    let s = states.get(key)
    if (!s && !key.includes("#")) {
      // A plain state nothing pins (e.g. the player visited it): "<page>?<dim>=<v>&…"
      const [pid, q = ""] = key.split("?")
      const page = m.pages.find((p) => p.id === pid)
      if (page) {
        const dims = Object.fromEntries(q.split("&").filter(Boolean).map((kv) => kv.split("=").map(decodeURIComponent)))
        const full = resolveDims(page, dims)
        s = { key: instanceKey(page.id, full), stem: variantStem(page, full), page, dims: full, required: new Set(), optional: new Set(), strict: new Set(), why: new Set(["requested"]) }
      }
    }
    if (s) selected.push(s)
    else warnings.push(`--keys: nothing to capture for "${key}"`)
  }
} else if (all) selected = [...states.values()]
else {
  selected = []
  for (const s of states.values()) {
    const e = index[s.key]
    const { W, H } = sizeFor(s)
    const stale = !e || !e.file || !existsSync(resolve(out, e.file)) || (!s.variant?.crop && (e.width !== W || e.height !== H)) || (e.dpr ?? 1) !== dpr
    if (stale) selected.push(s)
    else cached++
  }
}

/* ---------------- capture ---------------- */
const counts = { captured: 0, unchanged: 0, failed: 0 }
const results = new Map() // key → entry
const startedAt = Date.now()
const strictFailures = []

// "Settled" = fonts ready + the DOM quiet for a moment (a SPA that renders after `load`
// keeps mutating until it is done). Cheaper and truer than networkidle + a fixed wait.
async function settle(page, quiet = 150, max = 3000) {
  try {
    await page.evaluate(
      async ({ quiet, max }) => {
        try {
          await document.fonts.ready
        } catch {}
        await new Promise((res) => {
          let t
          const done = () => {
            obs.disconnect()
            clearTimeout(t)
            clearTimeout(cap)
            res()
          }
          const obs = new MutationObserver(() => {
            clearTimeout(t)
            t = setTimeout(done, quiet)
          })
          obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
          t = setTimeout(done, quiet)
          const cap = setTimeout(done, max)
        })
        await new Promise((r) => requestAnimationFrame(() => r()))
      },
      { quiet, max }
    )
  } catch {
    /* page navigated away mid-wait; the capture below will tell */
  }
}

let webpOk = true
async function shoot(page, clip) {
  if (webpOk) {
    try {
      const cdp = await page.context().newCDPSession(page)
      try {
        const r = await cdp.send("Page.captureScreenshot", { format: "webp", quality: 80, captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })
        return { buf: Buffer.from(r.data, "base64"), ext: "webp" }
      } finally {
        await cdp.detach().catch(() => {})
      }
    } catch {
      webpOk = false
    }
  }
  return { buf: await page.screenshot({ type: "png", fullPage: false, ...(clip ? { clip } : {}) }), ext: "png" }
}

async function locate(page, t) {
  const loc = page.locator(selectorFor(t)).first()
  if (await loc.count()) return loc
  // Fall back to visible text, so a `do` can say { click: "Filter" } for a plain button.
  const byText = page.getByText(t, { exact: true }).first()
  return (await byText.count()) ? byText : loc
}

async function perform(page, actions) {
  const failed = []
  for (const a of actions ?? []) {
    try {
      if ("click" in a) await (await locate(page, a.click)).click({ timeout: 5000 })
      else if ("hover" in a) await (await locate(page, a.hover)).hover({ timeout: 5000 })
      else if ("focus" in a) await (await locate(page, a.focus)).focus({ timeout: 5000 })
      else if ("press" in a) await page.keyboard.press(a.press)
      else if ("type" in a) await (await locate(page, a.into)).fill(String(a.type), { timeout: 5000 })
      else if ("wait" in a) await page.waitForTimeout(Math.min(Number(a.wait) || 0, 10_000))
      else if ("hold" in a) {
        // Hold the app where the next action leaves it: its timers wait, so a
        // spinner or a toast is still there when the capture is taken.
        await page.evaluate(installGate)
        await page.evaluate((on) => (on ? window.__stavyGate.close() : window.__stavyGate.open()), !!a.hold)
        continue
      }
      else continue
      if (!("wait" in a)) await settle(page, 100, 1500)
    } catch (e) {
      failed.push(`${JSON.stringify(a)} (${String(e.message ?? e).split("\n")[0].slice(0, 80)})`)
    }
  }
  return failed
}

async function capture(page, s, consoleErrors) {
  const { page: p, dims, variant } = s
  const { W, H } = sizeFor(s)
  await page.setViewportSize({ width: W, height: H })
  const path = stateHref(p, dims, appBase)
  if (path == null) {
    warnings.push(`${s.key}: no url for this state — skipped`)
    return
  }
  const href = /^[a-z]+:\/\//i.test(path) ? path : `${url}${path}`
  consoleErrors.length = 0
  let status = null
  try {
    const res = await page.goto(href, { waitUntil: "load", timeout: 30_000 })
    status = res?.status() ?? null
  } catch (e) {
    console.log(`  ✗ ${s.key}\n      ${href}\n      failed to load: ${String(e).split("\n")[0]}`)
    counts.failed++
    return
  }
  if (status && status >= 400) {
    console.log(`  ✗ ${s.key}\n      HTTP ${status} at ${href}`)
    counts.failed++
    return
  }
  await settle(page)
  const actionFailures = await perform(page, variant?.do)
  const required = [...s.required]
  const targets = [...new Set([...required, ...s.optional])]

  // Bring the state's focus target into view before measuring and capturing: the crop
  // target, else the first required one (a selected row deep in a list). The decision
  // runs in Node (isOutsideViewport, unit-tested); scrollIntoView copes with nested scrollers.
  let scrolled = false
  const focusTarget = variant?.crop ?? required[0]
  if (focusTarget) {
    const sel = selectorFor(focusTarget)
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
      // Taller than the viewport: show its top rather than its middle.
      const block = rect.bottom - rect.top > H ? "start" : "center"
      await page.evaluate(({ sel, block }) => document.querySelector(sel)?.scrollIntoView({ block, inline: "nearest" }), { sel, block })
      await page.waitForTimeout(100)
      scrolled = true
    }
  }

  // Crop: the target's box plus a margin, inside the viewport. Targets are then
  // measured relative to that image, so pins land right on the crop.
  let clip = null
  if (variant?.crop) {
    const box = await page.evaluate((sel) => {
      let el = null
      try {
        el = document.querySelector(sel)
      } catch {}
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height, sx: window.scrollX, sy: window.scrollY }
    }, selectorFor(variant.crop))
    if (box && box.w > 0 && box.h > 0) {
      const x0 = Math.max(0, Math.floor(box.x - MARGIN))
      const y0 = Math.max(0, Math.floor(box.y - MARGIN))
      const x1 = Math.min(W, Math.ceil(box.x + box.w + MARGIN))
      const y1 = Math.min(H, Math.ceil(box.y + box.h + MARGIN))
      // The clip is in page coordinates (the viewport may be scrolled), the boxes below in viewport ones.
      if (x1 > x0 && y1 > y0) clip = { x: x0 + box.sx, y: y0 + box.sy, width: x1 - x0, height: y1 - y0, vx: x0, vy: y0 }
    }
    if (!clip) warnings.push(`${s.key}: crop target "${variant.crop}" not found or not visible — captured the whole screen`)
  }
  const frame = clip ? { x: clip.vx, y: clip.vy, width: clip.width, height: clip.height } : { x: 0, y: 0, width: W, height: H }
  if (clip) {
    delete clip.vx
    delete clip.vy
  }
  const boxes = await page.evaluate(
    ({ targets, selectors, frame }) => {
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
        out[t] = {
          x: +((r.left - frame.x) / frame.width).toFixed(4),
          y: +((r.top - frame.y) / frame.height).toFixed(4),
          w: +(r.width / frame.width).toFixed(4),
          h: +(r.height / frame.height).toFixed(4),
        }
      })
      return { out, missing }
    },
    { targets, selectors: targets.map(selectorFor), frame }
  )

  const { buf, ext } = await shoot(page, clip)
  const file = `${s.stem}.${ext}`
  const hash = hashOf(buf)
  const prev = index[s.key]
  const same = prev && prev.hash === hash && prev.file === file && existsSync(resolve(out, file))
  if (!same) writeFileSync(resolve(out, file), buf)
  if (prev?.file && prev.file !== file && existsSync(resolve(out, prev.file))) rmSync(resolve(out, prev.file))

  const missing = boxes.missing.filter((t) => required.includes(t))
  const absent = boxes.missing.filter((t) => !required.includes(t))
  const entry = {
    file,
    width: frame.width,
    height: frame.height,
    dpr,
    targets: boxes.out,
    ...(missing.length ? { missing } : {}),
    ...(absent.length ? { absent } : {}),
    ...(scrolled ? { scrolled: true } : {}),
    ...(actionFailures.length ? { actionFailed: actionFailures } : {}),
    hash,
    at: same ? prev.at : new Date().toISOString(),
  }
  results.set(s.key, entry)
  same ? counts.unchanged++ : counts.captured++

  const why = [...s.why].join(", ")
  const bad = missing.length || actionFailures.length
  console.log(`  ${bad ? "!" : same ? "=" : "✓"} ${s.key}  (${why})${same ? "  unchanged" : ""}${absent.length ? `  · not on this state: ${absent.join(", ")}` : ""}`)
  for (const t of missing) {
    console.log(`      missing target "${t}"  ← ${selectorFor(t)}`)
    if (strict && s.strict.has(t)) strictFailures.push(`${s.key}: ${t}`)
  }
  for (const f of actionFailures) console.log(`      action failed: ${f}`)
  for (const e of consoleErrors.slice(0, 3)) console.log(`      console: ${e.slice(0, 160)}`)
}

if (selected.length) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ deviceScaleFactor: dpr, colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" })
  // Captures show each state's final frame: entrance animations and transitions
  // are skipped (reducedMotion alone only helps apps that honour it). The viewer
  // does the same while a requested state settles (frame.ts settleFrame).
  await ctx.addInitScript(() => {
    const css = "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}"
    const add = () => {
      const st = document.createElement("style")
      st.id = "stavy-freeze-motion"
      st.textContent = css
      ;(document.head ?? document.documentElement).appendChild(st)
    }
    if (document.documentElement) add()
    else document.addEventListener("DOMContentLoaded", add, { once: true })
  })
  // Scan navigates the same frame mid-fetch, which the browser reports as an
  // AbortError on that request — not a bug in the prototype.
  const isOwnNavigationAbort = (s) => /AbortError/.test(s) && /signal is aborted/i.test(s)
  const queue = [...selected]
  await Promise.all(
    Array.from({ length: Math.min(workers, queue.length) }, async () => {
      const page = await ctx.newPage()
      const consoleErrors = []
      page.on("pageerror", (e) => {
        const s = String(e)
        if (!isOwnNavigationAbort(s)) consoleErrors.push(s)
      })
      page.on("console", (msg) => {
        if (msg.type() !== "error") return
        const s = msg.text()
        if (!isOwnNavigationAbort(s)) consoleErrors.push(s)
      })
      for (let s; (s = queue.shift()); ) {
        try {
          await capture(page, s, consoleErrors)
        } catch (e) {
          console.log(`  ✗ ${s.key}\n      ${String(e.message ?? e).split("\n")[0]}`)
          counts.failed++
        }
      }
    })
  )
  await browser.close()
}

// Merge into a fresh read of the index (another scan may have written meanwhile).
const merged = readIndex()
for (const [key, entry] of results) merged[key] = entry
// A full scan owns the whole folder: states nothing wants any more (a dropped
// value, a removed board item) would otherwise linger. Partial scans never prune.
if (all && !only && keysArg == null) {
  for (const key of Object.keys(merged)) {
    if (states.has(key)) continue
    const stale = merged[key]?.file
    if (stale && existsSync(resolve(out, stale))) rmSync(resolve(out, stale))
    delete merged[key]
  }
}
writeFileSync(indexPath, JSON.stringify(merged, null, 1) + "\n")

for (const w of warnings) console.log(`  warn  ${w}`)
const missingN = [...results.values()].filter((e) => e.missing?.length).length
const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
console.log(
  `\nscan: ${counts.captured} captured · ${counts.unchanged} unchanged · ${cached} cached (skipped) · ${counts.failed} failed` +
    `${missingN ? ` · ${missingN} with missing targets` : ""}${warnings.length ? ` · ${warnings.length} warning(s)` : ""} — ${secs}s → ${out}`
)
if (strictFailures.length) console.log(`--strict: ${strictFailures.length} scenario target(s) missing:\n  ${strictFailures.join("\n  ")}`)
process.exit(counts.failed || strictFailures.length ? 1 : 0)
