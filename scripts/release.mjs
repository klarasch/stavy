#!/usr/bin/env node
// Build a release: one tarball with everything an adopting repo needs, and
// nothing that needs npm to use it — the viewer prebuilt, the scripts, the
// schema, the skill, the docs. Unpack it anywhere and run its own init:
//
//   node scripts/release.mjs            → release/stavy.tgz + release/NOTES.md
//   node scripts/release.mjs --no-build (reuse dist-viewer/ as it is)
//
// CI runs this on a v* tag and attaches release/stavy.tgz to the GitHub
// Release under that fixed name, so
//   https://github.com/klarasch/stavy/releases/latest/download/stavy.tgz
// is always the newest one. The version lives inside, in RELEASE.json.
//
// Before packing, the staged release installs itself into a scratch repo and
// updates it again — a release that can't install is never written.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { changelogSection, copiedFiles, knownHashes } from "./lib/install.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const argv = process.argv.slice(2)
const die = (s) => {
  console.error(`release: ${s}`)
  process.exit(1)
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...opts })

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const version = pkg.version
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : null
if (tag && tag !== `v${version}`) die(`tag ${tag} doesn't match package.json version ${version}.`)

const commit = run("git", ["rev-parse", "HEAD"]).trim()
if (run("git", ["rev-parse", "--is-shallow-repository"]).trim() === "true") die("shallow clone — known-hashes.json needs full history (fetch-depth: 0).")
if (run("git", ["status", "--porcelain", "--untracked-files=no"]).trim() && !argv.includes("--allow-dirty")) {
  die("uncommitted changes — a release must be a commit. Commit first (or --allow-dirty for a local try).")
}
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8")
const notes = changelogSection(changelog, version)
if (!notes) die(`CHANGELOG.md has no "## ${version}" section — write one before releasing.`)

if (!argv.includes("--no-build")) {
  console.log("building the viewer…")
  run("npx", ["vite", "build", "-c", "vite.viewer.config.ts", "--logLevel", "error"], { stdio: "inherit" })
}
if (!existsSync(join(root, "dist-viewer/index.html"))) die("no dist-viewer/index.html.")

// ---- stage -----------------------------------------------------------------
const out = join(root, "release")
const stage = join(out, "stavy")
rmSync(out, { recursive: true, force: true })
const files = [
  "dist-viewer",
  "scripts/init.mjs",
  "scripts/validate.mjs",
  "scripts/scan.mjs",
  "scripts/gen-tests.mjs",
  "scripts/lib/install.mjs",
  "scripts/lib/viewport.mjs",
  "spec/stavy.schema.json",
  "skill/SKILL.md",
  "skill/RULES.md",
  "SPEC.md",
  "CHANGELOG.md",
  "LICENSE",
  "docs/UPDATING.md",
  "docs/ADOPTION.md",
  "docs/INSPECT-ADAPTERS.md",
  "docs/inspect-adapter.template.js",
]
for (const f of files) {
  if (!existsSync(join(root, f))) die(`missing ${f}`)
  mkdirSync(dirname(join(stage, f)), { recursive: true })
  cpSync(join(root, f), join(stage, f), { recursive: true })
}
// Every version each installed file has had since Stavy became an overlay, so a
// repo installed by any older init can be checked exactly without git.
const OVERLAY_ROOT = "0933a6d"
const known = knownHashes({ src: root, paths: [...new Set([...Object.values(copiedFiles()), "skill/SKILL.md", "skill/RULES.md"])], since: OVERLAY_ROOT })
writeFileSync(join(stage, "known-hashes.json"), JSON.stringify(known) + "\n")

const release = { name: "stavy", version, commit, date: new Date().toISOString().slice(0, 10) }
writeFileSync(join(stage, "RELEASE.json"), JSON.stringify(release, null, 2) + "\n")
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify({ name: "stavy-release", version, private: true, type: "module", description: "A Stavy release. No dependencies: run scripts/init.mjs against your prototype repo." }, null, 2) + "\n",
)
writeFileSync(
  join(stage, "README.md"),
  `# Stavy ${version}

A release of [Stavy](https://github.com/klarasch/stavy): the viewer prebuilt,
the checks, the schema, the agent skill and the docs. Nothing here needs
\`npm install\`.

From your prototype repo, with this folder unpacked at \`../stavy\`:

\`\`\`bash
node ../stavy/scripts/init.mjs .
\`\`\`

The same command installs and updates. See \`docs/UPDATING.md\` and \`docs/ADOPTION.md\`.
`,
)

// ---- self-test: install, then update, into a scratch repo --------------------
const scratch = mkdtempSync(join(tmpdir(), "stavy-release-"))
try {
  writeFileSync(join(scratch, "package.json"), '{"name":"release-selftest"}\n')
  const init = (...args) => execFileSync("node", [join(stage, "scripts/init.mjs"), scratch, ...args], { encoding: "utf8" })
  init()
  for (const f of ["public/stavy/index.html", "scripts/stavy/scan.mjs", "scripts/stavy/lib/viewport.mjs", "STAVY.md", ".stavy/lock.json"]) {
    if (!existsSync(join(scratch, f))) die(`self-test: install did not write ${f}`)
  }
  const lock = JSON.parse(readFileSync(join(scratch, ".stavy/lock.json"), "utf8"))
  if (lock.upstream.version !== version || lock.upstream.commit !== commit) die("self-test: lock does not record this release")
  if (!/nothing — already on this release/.test(init())) die("self-test: a second run was not a no-op")
  execFileSync("node", [join(scratch, "scripts/stavy/validate.mjs"), join(scratch, "public/stavy.json")], { encoding: "utf8", cwd: scratch })
} catch (e) {
  die(`self-test failed:\n${e.stdout ?? ""}${e.stderr ?? ""}${e.message}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

// ---- pack --------------------------------------------------------------------
run("tar", ["-czf", "stavy.tgz", "stavy"], { cwd: out })
writeFileSync(join(out, "NOTES.md"), notes.trim() + "\n")
const size = (readFileSync(join(out, "stavy.tgz")).length / 1024 / 1024).toFixed(1)
console.log(`release/stavy.tgz  Stavy ${version} @ ${commit.slice(0, 12)}  (${size} MB, self-test passed)`)
