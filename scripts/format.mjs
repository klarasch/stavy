#!/usr/bin/env node
// Stavy format — rewrites board files in the layout the viewer writes
// (scripts/lib/format.mjs): one item per line or one key per line, so a later
// edit in the viewer shows up as a small diff. Run it after editing a board by hand.
//
//   node scripts/format.mjs [stavy.json] [--check]
//
// Formats <manifest dir>/stavy-content/boards/*.json and map.json in place.
// --check  change nothing; list files that would change and exit 1 if any.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { formatBoard } from "./lib/format.mjs"
import { CONTENT_DIR } from "./lib/model.mjs"

const argv = process.argv.slice(2)
const check = argv.includes("--check")
const positional = argv.filter((a) => !a.startsWith("--"))
const manifestPath = resolve(positional[0] ?? (existsSync("stavy.json") ? "stavy.json" : "public/stavy.json"))
const content = join(dirname(manifestPath), CONTENT_DIR)

const files = []
const boardsDir = join(content, "boards")
if (existsSync(boardsDir)) for (const f of readdirSync(boardsDir).sort()) if (f.endsWith(".json")) files.push(join(boardsDir, f))
if (existsSync(join(content, "map.json"))) files.push(join(content, "map.json"))

let changed = 0
let bad = 0
for (const file of files) {
  const rel = relative(process.cwd(), file)
  const text = readFileSync(file, "utf8")
  let next
  try {
    next = formatBoard(JSON.parse(text))
  } catch (e) {
    console.log(`  ✗ ${rel}: not valid JSON (${String(e.message ?? e).split("\n")[0]})`)
    bad++
    continue
  }
  if (next === text) continue
  changed++
  if (check) console.log(`  would format ${rel}`)
  else {
    writeFileSync(file, next)
    console.log(`  formatted ${rel}`)
  }
}
console.log(`format: ${files.length} file(s), ${changed} ${check ? "to format" : "formatted"}${bad ? `, ${bad} invalid` : ""}`)
process.exit(bad || (check && changed) ? 1 : 0)
