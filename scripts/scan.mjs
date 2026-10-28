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
// viewer does not reload images that did not change; `checkedAt` says when it
// was last looked at. The index is written after every capture (merged into a
// fresh read, replaced atomically), so a viewer watching it updates card by
// card. With --keys, states are captured in the order given.
//
// Requires `playwright` + Chromium (`npx playwright install chromium`) and a
// running dev/preview server at --url. Exit code 1 only when a state fails to
// load (or, with --strict, when a scenario target is missing).
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { chromium } from "playwright"
import { runScan } from "./lib/capture.mjs"

const argv = process.argv.slice(2)
const VALUE_OPTS = new Set(["--url", "--app", "--out", "--only", "--width", "--height", "--dpr", "--keys", "--workers"])
const opt = (name, def) => {
  const i = argv.lastIndexOf(name) // the last one wins, so `npm run stavy:scan -- --url …` overrides the script
  return i >= 0 ? argv[i + 1] : def
}
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUE_OPTS.has(argv[i - 1]))
const manifestPath = resolve(positional[0] ?? (existsSync("stavy.json") ? "stavy.json" : "public/stavy.json"))

let browser
const { code } = await runScan(
  {
    manifestPath,
    url: opt("--url", "http://localhost:5173"),
    app: opt("--app", undefined),
    out: opt("--out", undefined),
    only: opt("--only", null),
    all: argv.includes("--all"),
    strict: argv.includes("--strict"),
    keys: opt("--keys", null),
    workers: opt("--workers", 4),
    width: opt("--width", undefined),
    height: opt("--height", undefined),
    dpr: opt("--dpr", undefined),
    dark: argv.includes("--dark"),
  },
  { getBrowser: async () => (browser = await chromium.launch()) },
)
await browser?.close()
process.exit(code)
