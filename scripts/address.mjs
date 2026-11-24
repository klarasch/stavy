#!/usr/bin/env node
// Stavy address — mark review comments as addressed, without anyone editing JSON.
//
//   node scripts/stavy/address.mjs <id> "<one sentence>" [<id> "<one sentence>" ...] [--as "<name>"]
//   npm run stavy:address -- dadrvvycz9 "Permission checkboxes are left-aligned." --as Claude
//
// For each comment it records, in the caller's own round file
// (stavy-content/rounds/<date>-<name>.json), the status "addressed" with the
// sentence as the reply and the current commit, and appends a line to the log.
// Commit the fix first, so the commit recorded is the one that holds it. The
// comment's author is the one who closes it. Round files are never edited by
// hand, and this never touches another person's file.
//
//   --as <name>             who is addressing (default: git user.name)
//   --dir <stavy-content>   where the content folder is (default: found from the current folder)
//   --list                  print the open comments (id, place, text) and exit
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { localDate, newId } from "./lib/rounds.mjs"
import { applyOps, findContentDir, gitInfo, migrateLegacy, readThreads } from "./lib/rounds-fs.mjs"
import { appendLog } from "./log.mjs"

const whereOf = (c) => c.doc ?? c.board ?? ([c.page, ...Object.values(c.dims ?? {})].filter(Boolean).join(" ") || "?")

/** Address `pairs` ([id, sentence]…) as `author`. Returns { done, missing }. */
export function address(contentDir, pairs, { author, commit, now = new Date() }) {
  migrateLegacy(contentDir)
  const threads = new Map(readThreads(contentDir).map((c) => [c.id, c]))
  const done = []
  const missing = []
  const ops = []
  for (const [id, sentence] of pairs) {
    const c = threads.get(id)
    if (!c) {
      missing.push(id)
      continue
    }
    ops.push({ op: { op: "event", event: { id: newId(), thread: id, type: "status", status: "addressed", body: String(sentence).trim(), ...(commit ? { commit } : {}), at: now.toISOString() } } })
    done.push({ id, sentence, where: (c.dims && Object.values(c.dims).join(", ")) || whereOf(c) })
  }
  if (ops.length) applyOps(contentDir, ops, { author, commit, date: localDate(now) })
  for (const d of done) appendLog(contentDir, { what: d.sentence, why: `review comment ${d.id}`, states: d.where, commit, now })
  return { done, missing }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2)
  const take = (flag) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv.splice(i, 2)[1] : undefined
  }
  const dir = take("--dir") ?? findContentDir()
  let author = take("--as") ?? process.env.STAVY_AUTHOR
  if (argv.includes("--list")) {
    migrateLegacy(dir)
    for (const c of readThreads(dir).filter((c) => c.status === "open")) console.log(`${c.id}  ${whereOf(c)}  ${c.author}: ${String(c.body).replace(/\s+/g, " ")}`)
    process.exit(0)
  }
  if (!argv.length || argv.length % 2) {
    console.error('usage: stavy:address <id> "<one sentence>" [<id> "<one sentence>" ...] [--as "<name>"]')
    process.exit(2)
  }
  if (!author) {
    try {
      author = execFileSync("git", ["config", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    } catch {
      /* no git identity */
    }
  }
  if (!author) {
    console.error('address: no name to sign with. Pass --as "<name>" (or set git user.name).')
    process.exit(2)
  }
  const pairs = []
  for (let i = 0; i < argv.length; i += 2) pairs.push([argv[i], argv[i + 1]])
  const { done, missing } = address(dir, pairs, { author, commit: gitInfo().commit })
  for (const d of done) console.log(`addressed ${d.id}`)
  for (const id of missing) console.error(`no comment ${id}`)
  if (missing.length) process.exit(1)
}
