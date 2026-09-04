#!/usr/bin/env node
// Install Stavy into another repo — as an overlay. Nothing under the target's
// src/ is touched: the viewer is a static folder in public/, the manifest a
// JSON file next to it, and the checks are two scripts.
//
//   node /path/to/stavy/scripts/init.mjs ../my-prototype-repo [--dir stavy] [--rebuild]
//
// Copies:
//   public/<dir>/                 the built viewer (dist-viewer/, built here if missing)
//   public/stavy.json             a starter manifest (only if absent)
//   scripts/stavy/{validate,scan}.mjs + stavy.schema.json
//   .claude/skills/stavy/SKILL.md the agent skill
//   STAVY.md                      the rules for agents working in the prototype repo
// Adds npm scripts stavy:validate / stavy:scan when absent. Then prints what is left.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, "..")
const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : def
}
const dir = opt("--dir", "stavy").replace(/^\/+|\/+$/g, "")
const rebuild = argv.includes("--rebuild")
const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--dir")
const target = resolve(positional[0] ?? ".")
if (!existsSync(join(target, "package.json"))) {
  console.error(`No package.json in ${target} — point init at the prototype repo.`)
  process.exit(1)
}

const copy = (from, to) => {
  mkdirSync(dirname(join(target, to)), { recursive: true })
  cpSync(from, join(target, to), { recursive: true })
  console.log(`  + ${to}`)
}

console.log(`Installing Stavy into ${target}`)

// 1. the viewer: a self-contained static folder
const dist = join(src, "dist-viewer")
if (rebuild || !existsSync(join(dist, "index.html"))) {
  console.log("  building the viewer (vite build -c vite.viewer.config.ts)…")
  execFileSync("npx", ["vite", "build", "-c", "vite.viewer.config.ts"], { cwd: src, stdio: "inherit" })
}
let version = "unknown"
try {
  version = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: src, encoding: "utf8" }).trim()
  if (execFileSync("git", ["status", "--porcelain"], { cwd: src, encoding: "utf8" }).trim()) version += "-dirty"
} catch {}
copy(dist, `public/${dir}`)
writeFileSync(join(target, `public/${dir}/VERSION`), version + "\n")

// 2. the checks
copy(join(src, "scripts/validate.mjs"), "scripts/stavy/validate.mjs")
copy(join(src, "scripts/scan.mjs"), "scripts/stavy/scan.mjs")
copy(join(src, "scripts/gen-tests.mjs"), "scripts/stavy/gen-tests.mjs")
copy(join(src, "spec/stavy.schema.json"), "scripts/stavy/stavy.schema.json")

// 3. the skill + the rules
copy(join(src, "skill/SKILL.md"), ".claude/skills/stavy/SKILL.md")
if (existsSync(join(src, "skill/RULES.md"))) copy(join(src, "skill/RULES.md"), "STAVY.md")
copy(join(src, "SPEC.md"), "docs/STAVY-SPEC.md")

// 4. a starter manifest, served from public/ next to the viewer
const manifestPath = join(target, "public/stavy.json")
if (!existsSync(manifestPath)) {
  const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"))
  const starter = {
    $schema: "../scripts/stavy/stavy.schema.json",
    version: "0.2",
    product: { name: pkg.name ?? "Prototype", description: "" },
    viewer: { toolbar: "bottom", targetAttrs: ["data-testid", "data-proto"] },
    dimensions: [
      {
        id: "state",
        label: "Data state",
        kind: "state",
        values: [
          { id: "loaded", label: "Loaded" },
          { id: "empty", label: "Empty" },
        ],
      },
    ],
    pages: [
      {
        id: "home",
        label: "Home",
        description: "Replace me: the first screen of the prototype, at the URL it already has.",
        url: "/?state={state}",
        fidelity: "navigable",
        dimensions: { state: ["loaded", "empty"] },
        defaults: { state: "loaded" },
        instances: [{ dims: { state: "loaded" } }],
      },
    ],
    scenarios: [],
  }
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(starter, null, 2) + "\n")
  console.log("  + public/stavy.json (starter)")
} else console.log("  = public/stavy.json (kept)")

// 5. npm scripts (only when absent)
const pkgPath = join(target, "package.json")
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
pkg.scripts ??= {}
const added = []
const want = {
  "stavy:validate": "node scripts/stavy/validate.mjs public/stavy.json --coverage",
  "stavy:scan": "node scripts/stavy/scan.mjs public/stavy.json --url http://localhost:5173",
  "stavy:tests": "node scripts/stavy/gen-tests.mjs public/stavy.json --out tests/stavy",
}
for (const [k, v] of Object.entries(want)) {
  if (!pkg.scripts[k]) {
    pkg.scripts[k] = v
    added.push(k)
  }
}
if (added.length) {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
  console.log(`  + package.json scripts: ${added.join(", ")}`)
}

console.log(`
Done (viewer ${version}). Nothing under src/ was touched. Next:
  1. npm i -D playwright ajv ajv-formats && npx playwright install chromium   (scan needs a browser)
  2. npm run dev, then open  http://localhost:5173/${dir}/index.html          (the viewer, next to your app)
  3. Register your first real screens in public/stavy.json: one entry per page with its existing URL.
     Every dimension a page declares must appear in its url as {dim} — the app reads them as it likes.
  4. npm run stavy:scan     → snapshots + a target report (the coverage contract, checked against the running app)
     npm run stavy:validate → schema, cross-references, the URL contract, last scan's misses
  5. Add "@STAVY.md" to your CLAUDE.md so agents follow the rules (additive only — never gut a page for Stavy).
Docs: docs/STAVY-SPEC.md · skill: .claude/skills/stavy/SKILL.md · upgrade later by re-running init (--rebuild).`)
