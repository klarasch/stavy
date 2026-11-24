#!/usr/bin/env node
// Stavy log — one line per change, with the real time and the current commit.
//
//   node scripts/stavy/log.mjs "<what>" "<why>" [states]
//   npm run stavy:log -- "Roles list replaces the read-only table" "v2 outline agreed" roles-default,roles-with-custom
//
// Appends
//   - HH:MM · <states> · <what> · why: <why> · <short commit>
// to stavy-content/log/<YYYY-MM-DD>.md. Append-only, one file per day. Use it
// for every change, every decision made alone ("decided: …") and everything
// faked ("faked: …"). Never write the log by hand: the time must be the real one.
//
//   --dir <stavy-content>   where the content folder is (default: found from the current folder)
import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { localDate, localTime } from "./lib/rounds.mjs"
import { findContentDir, gitInfo } from "./lib/rounds-fs.mjs"

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim()

/** The line, without the leading "- ". */
export function logLine({ what, why, states, commit, time }) {
  return [time, oneLine(states) || "all", oneLine(what), ...(oneLine(why) ? [`why: ${oneLine(why)}`] : []), ...(commit ? [commit] : [])].join(" · ")
}

/** Append one line to today's log; returns the file and the line. */
export function appendLog(contentDir, { what, why, states, commit, now = new Date() }) {
  const dir = join(contentDir, "log")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${localDate(now)}.md`)
  const line = logLine({ what, why, states, commit, time: localTime(now) })
  appendFileSync(file, `${existsSync(file) ? "" : `# Log ${localDate(now)}\n\n`}- ${line}\n`)
  return { file, line }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2)
  const di = argv.indexOf("--dir")
  const dir = di >= 0 ? argv.splice(di, 2)[1] : findContentDir()
  const [what, why, ...states] = argv
  if (!oneLine(what)) {
    console.error('usage: stavy:log "<what>" "<why>" [states]')
    process.exit(2)
  }
  const { file, line } = appendLog(dir, { what, why, states: states.join(", "), commit: gitInfo().commit })
  console.log(`${file}: ${line}`)
}
