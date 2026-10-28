#!/usr/bin/env node
// Stavy capture worker — one long-lived Chromium for the dev plugin, so a save
// doesn't pay a browser launch. Started by vite-plugin.mjs; reads one JSON job
// per stdin line:
//   { id, manifestPath, url, out, keys?: string, all?: boolean, workers? }
// runs it (same code as scan.mjs, scripts/lib/capture.mjs), echoes the scan's
// log to stdout, and ends each job with a line "@@done <id> <exit code>".
// Exits when stdin closes (the dev server went away) or after IDLE_MS idle.
// Without Playwright/Chromium it prints "@@unavailable" and exits.
import { createInterface } from "node:readline"
import { runScan } from "./lib/capture.mjs"

const IDLE_MS = Number(process.env.STAVY_WORKER_IDLE_MS) || 5 * 60_000

let chromium
try {
  ;({ chromium } = await import("playwright"))
} catch {
  console.log("@@unavailable Cannot find package 'playwright'")
  process.exit(2)
}

let browser = null
const getBrowser = async () => {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch()
    console.log("@@launch")
    browser.on("disconnected", () => (browser = null))
  }
  return browser
}
const quit = async (code = 0) => {
  await browser?.close().catch(() => {})
  process.exit(code)
}

let idle = setTimeout(() => quit(0), IDLE_MS)
let chain = Promise.resolve()
const rl = createInterface({ input: process.stdin })
rl.on("line", (line) => {
  let job
  try {
    job = JSON.parse(line)
  } catch {
    return
  }
  clearTimeout(idle)
  chain = chain.then(async () => {
    let code = 1
    try {
      ;({ code } = await runScan(job, { getBrowser, log: (...a) => console.log(...a) }))
    } catch (e) {
      const msg = String(e?.message ?? e)
      console.log(`  ✗ ${msg.split("\n")[0]}`)
      if (/Executable doesn't exist/.test(msg)) {
        console.log("@@unavailable Executable doesn't exist (npx playwright install chromium)")
        return quit(2)
      }
    }
    console.log(`@@done ${job.id} ${code}`)
    idle = setTimeout(() => quit(0), IDLE_MS)
  })
})
rl.on("close", () => chain.then(() => quit(0)))
