#!/usr/bin/env node
// Install Stavy into another repo — as an overlay — and update it later with
// the same command. Nothing under the target's src/ is touched: the viewer is
// a static folder in public/, the manifest a JSON file next to it, and the
// checks are a few scripts.
//
//   node /path/to/stavy/scripts/init.mjs ../my-prototype-repo [options]
//
//   --dir <name>   viewer folder under public/ (default: stavy, or what the lock says)
//   --rebuild      rebuild the viewer even if dist-viewer/ matches this commit
//   --dry-run      report what would change, write nothing
//   --check        only report owned files the repo has edited (exit 1 if any);
//                  cheap enough for CI or a pre-commit hook
//   --force        take upstream's copy of edited files too
//   --allow-dirty  install from a Stavy checkout with uncommitted changes
//
// Stavy owns (replaced on every update, listed in .stavy/lock.json):
//   public/<dir>/                  the built viewer
//   scripts/stavy/                 validate, scan, gen-tests, the schema
//   .claude/skills/<name>/SKILL.md the agent skill, composed with .stavy/SKILL.local.md
//   STAVY.md                       the rules, composed with .stavy/RULES.local.md
//   docs/STAVY-SPEC.md, docs/STAVY-UPDATING.md
// The repo owns everything else — public/stavy.json and .stavy/*.local.md
// included. See docs/UPDATING.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, relative, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { apply, detectEdits, git, gitShow, LOCK, plan, readLock, RULES_LOCAL, SKILL_LOCAL, walk } from "./lib/install.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, "..")
const argv = process.argv.slice(2)
const opt = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const flag = (name) => argv.includes(name)
const known = new Set(["--dir", "--rebuild", "--dry-run", "--check", "--force", "--allow-dirty"])
for (const a of argv) {
  if (a.startsWith("--") && !known.has(a)) {
    console.error(`init: unknown option ${a}`)
    process.exit(2)
  }
}
const check = flag("--check")
const dryRun = flag("--dry-run") || check
const force = flag("--force")
const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--dir")
const target = resolve(positional[0] ?? ".")
const say = (s = "") => console.log(s)
const die = (s) => {
  console.error(`\ninit: ${s}`)
  process.exit(1)
}

if (target === src) die("run this against the prototype repo, not the Stavy repo itself.")
if (!existsSync(join(target, "package.json"))) die(`no package.json in ${target} — point init at the prototype repo.`)

const lock = readLock(target)
const dir = (opt("--dir") ?? lock?.dir ?? "stavy").replace(/^\/+|\/+$/g, "")
const legacy = !lock && existsSync(join(target, `public/${dir}/VERSION`))

// ---- which Stavy is this ---------------------------------------------------
const pkgVersion = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).version
const commit = git(src, "rev-parse", "HEAD")
const upDirty = commit ? !!git(src, "status", "--porcelain", "--untracked-files=no") : false
if (upDirty && !flag("--allow-dirty") && !check) {
  die(`the Stavy checkout at ${src} has uncommitted changes. There is no commit to record,
so the next update couldn't show what changed. Commit first, or pass --allow-dirty.`)
}
const short = commit ? commit.slice(0, 12) + (upDirty ? "-dirty" : "") : `v${pkgVersion}`
const upstream = { version: pkgVersion, commit: commit ? commit + (upDirty ? "-dirty" : "") : null }

say(`${lock || legacy ? "Updating" : "Installing"} Stavy in ${target}`)
say(`  from ${src} @ ${short}${lock?.upstream?.commit ? ` (last taken: ${lock.upstream.commit.slice(0, 12)})` : ""}`)

if (!check && git(target, "status", "--porcelain", "--untracked-files=no")) {
  say("\n  Note: this repo has uncommitted changes. Commit first and the update is reviewable on its own.")
}

const last = lock?.upstream?.commit?.replace(/-dirty$/, "")
if (!check && last && commit && last !== commit) {
  const log = git(src, "log", "--oneline", "--no-merges", `${last}..HEAD`)
  say(`\n  Stavy changes since ${last.slice(0, 12)}:`)
  if (log == null) say("    (can't reach that commit from this checkout — was it rewritten?)")
  else {
    const lines = log.split("\n").filter(Boolean)
    for (const l of lines.slice(0, 40)) say(`    ${l}`)
    if (lines.length > 40) say(`    … and ${lines.length - 40} more`)
    say("  Some of these may let you delete something local: a workaround Stavy has since absorbed.")
  }
}

// ---- the viewer: built from this commit ------------------------------------
const dist = join(src, "dist-viewer")
const stamp = join(src, "dist-viewer.commit")
const built = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : null
if (!check && (flag("--rebuild") || !existsSync(join(dist, "index.html")) || !commit || upDirty || built !== commit)) {
  if (existsSync(join(src, "node_modules"))) {
    say("\n  building the viewer (vite build -c vite.viewer.config.ts)…")
    execFileSync("npx", ["vite", "build", "-c", "vite.viewer.config.ts", "--logLevel", "error"], { cwd: src, stdio: "inherit" })
    if (commit && !upDirty) writeFileSync(stamp, commit + "\n")
  } else if (existsSync(join(dist, "index.html"))) {
    say(`\n  Note: no node_modules in ${src}, so dist-viewer/ can't be rebuilt; using it as is.`)
  } else die(`no dist-viewer/ and no node_modules in ${src} to build one — run npm install there first.`)
}
if (!check && !existsSync(join(dist, "index.html"))) die(`no built viewer at ${dist} — run npm run build:viewer in ${src}.`)

// ---- what this release owns, and what the repo has changed -----------------
const p = plan({ src, target, dist, dir, version: short })
const edits = detectEdits({
  target,
  lock,
  want: p.files,
  dir,
  legacyShow: commit ? (c, path) => gitShow(src, c, path) : null,
})

const whereItGoes = () => {
  say("  Where an edit belongs instead (docs/STAVY-UPDATING.md):")
  say(`    .claude/skills/*/SKILL.md → ${SKILL_LOCAL}   name, description, standing orders`)
  say(`    STAVY.md                  → ${RULES_LOCAL}   rules for this repo`)
  say("    public/<dir>/             → public/stavy.json (viewer.inspect, viewer.*) or a viewer.inspect.module")
  say("    scripts/stavy/*           → a script of your own that calls them")
  say("  If none of those can express it, that's a gap to report to Stavy, not to edit around.")
}

if (check) {
  const all = [...edits.edited, ...edits.unknown]
  if (!lock) say(`\n  No ${LOCK} yet — this repo was installed by an older init.`)
  if (!all.length) {
    say("\ninit --check: clean — no file Stavy owns is edited in this repo.")
    process.exit(0)
  }
  say("\ninit --check: this repo has edited files that Stavy owns:")
  for (const f of edits.edited) say(`    ${f}`)
  for (const f of edits.unknown) say(`    ${f}   (can't tell whether this is your edit or an older release)`)
  say()
  whereItGoes()
  process.exit(1)
}

if (edits.unknown.length && !force) {
  say(`\n  These files differ from this release, and without a record of what an earlier`)
  say(`  install wrote, I can't tell your edits from Stavy's changes:`)
  for (const f of edits.unknown) say(`    ${f}`)
  die(`nothing was written. Review them (move any local change into the local layer), then
re-run with --force to take this release's copies. From then on ${LOCK} makes this check exact.`)
}

const result = apply({
  target,
  lock,
  want: p.files,
  groups: p.groups,
  edits,
  force,
  dryRun,
  upstream,
  meta: { dir, skill: p.skill },
})

say(`\n${dryRun ? "Would change" : "Changed"}:`)
const viewerPrefix = `public/${dir}/`
const viewerWritten = result.written.filter((f) => f.startsWith(viewerPrefix))
if (viewerWritten.length) say(`  ~ ${viewerPrefix}  (${viewerWritten.length} files)`)
for (const f of result.written.filter((f) => !f.startsWith(viewerPrefix))) say(`  ~ ${f}`)
const viewerPruned = result.pruned.filter((f) => f.startsWith(viewerPrefix))
if (viewerPruned.length) say(`  - ${viewerPrefix}  (${viewerPruned.length} stale files)`)
for (const f of result.pruned.filter((f) => !f.startsWith(viewerPrefix))) say(`  - ${f}`)
if (!result.written.length && !result.pruned.length) say("  nothing — already on this release")
if (p.local.skill || p.local.rules) {
  say(`  (composed with ${[p.local.skill && SKILL_LOCAL, p.local.rules && RULES_LOCAL].filter(Boolean).join(" and ")})`)
}

// ---- the repo's own files: created once, never updated ---------------------
const created = []
const manifestPath = join(target, "public/stavy.json")
if (!existsSync(manifestPath)) {
  const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"))
  const starter = {
    $schema: "../scripts/stavy/stavy.schema.json",
    version: "0.2",
    product: { name: pkg.name ?? "Prototype", description: "" },
    viewer: { toolbar: "bottom", targetAttrs: ["data-testid", "data-proto"] },
    dimensions: [],
    pages: [
      {
        id: "home",
        label: "Home",
        description: "Replace me: the first screen of the prototype, at the URL it already has.",
        url: "/",
        fidelity: "navigable",
        instances: [{ dims: {} }],
      },
    ],
    scenarios: [],
  }
  if (!dryRun) {
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(manifestPath, JSON.stringify(starter, null, 2) + "\n")
  }
  created.push("public/stavy.json (starter)")
}

const pkgPath = join(target, "package.json")
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
pkg.scripts ??= {}
// Relative when the checkout sits near the repo (../stavy), so the script works for teammates too.
const initRel = relative(target, join(src, "scripts/init.mjs")).split("\\").join("/")
const initPath = initRel.split("/").filter((s) => s === "..").length <= 3 ? initRel : join(src, "scripts/init.mjs")
const want = {
  "stavy:validate": "node scripts/stavy/validate.mjs public/stavy.json --coverage",
  "stavy:scan": "node scripts/stavy/scan.mjs public/stavy.json --url http://localhost:5173",
  "stavy:tests": "node scripts/stavy/gen-tests.mjs public/stavy.json --out tests/stavy",
  "stavy:update": `node ${initPath} .`,
}
const added = Object.keys(want).filter((k) => !pkg.scripts[k])
for (const k of added) pkg.scripts[k] = want[k]
if (added.length) {
  if (!dryRun) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
  created.push(`package.json scripts: ${added.join(", ")}`)
}
if (created.length) {
  say(`\n${dryRun ? "Would create" : "Created"} (yours from now on — updates never touch these):`)
  for (const c of created) say(`  + ${c}`)
}

// A repo installed before the lock: nothing records which files in the viewer folder
// an older release wrote, so leftovers are listed rather than deleted.
const leftovers = legacy ? walk(join(target, viewerPrefix)).map((f) => viewerPrefix + f).filter((f) => !p.files.has(f)) : []
if (leftovers.length) {
  say(`\nIn ${viewerPrefix} but not part of this release (probably left by an older one; delete them if they aren't yours):`)
  for (const f of leftovers.slice(0, 20)) say(`    ${f}`)
  if (leftovers.length > 20) say(`    … and ${leftovers.length - 20} more`)
}

if (result.skipped.length || result.kept.length) {
  say("\nNOT taken — edited in this repo:")
  const vs = result.skipped.filter((f) => f.startsWith(viewerPrefix))
  if (vs.length) say(`    ${viewerPrefix}  (the whole viewer is skipped: one of its files was edited)`)
  for (const f of result.skipped.filter((f) => !f.startsWith(viewerPrefix))) say(`    ${f}`)
  for (const f of result.kept) say(`    ${f}   (no longer shipped; kept because you edited it)`)
  say("  Move the edit out, then re-run (or pass --force to take Stavy's copy).")
  whereItGoes()
}

if (dryRun) {
  say("\nDry run — nothing written.")
} else if (lock || legacy) {
  say(`\nDone (Stavy ${short}). Commit the update together with ${LOCK}, then check it:`)
  say("  npm run stavy:validate && npm run stavy:scan")
} else {
  say(`
Done (Stavy ${short}). Nothing under src/ was touched. Next:
  1. npm i -D playwright ajv@8.12.0 ajv-formats@2.1.1 && npx playwright install chromium   (scan needs a browser;
     these ajv versions install cleanly on locked-down registries — a newer ajv pulls in fast-uri)
  2. npm run dev, then open  http://localhost:5173/${dir}/index.html          (the viewer, next to your app)
  3. Register your first real screens in public/stavy.json: one entry per page with its existing URL.
     Every dimension a page declares must appear in its url as {dim} — the app reads them as it likes.
  4. npm run stavy:scan     → snapshots + a target report (the coverage contract, checked against the running app)
     npm run stavy:validate → schema, cross-references, the URL contract, last scan's misses
  5. Add "@STAVY.md" to your CLAUDE.md so agents follow the rules (additive only — never gut a page for Stavy).
  6. Commit, ${LOCK} included. To update later: pull Stavy, then npm run stavy:update.
Docs: docs/STAVY-SPEC.md · docs/STAVY-UPDATING.md · skill: .claude/skills/${p.skill}/SKILL.md`)
}
process.exit(result.skipped.length || result.kept.length ? 1 : 0)
