// Review rounds on disk (see rounds.mjs for the format). Used by the dev
// plugin, stavy:address and migrate. Every write here is: read the rounds as
// they are now, apply operations, write only the round files that changed.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { ROUNDS_DIR, ROUNDS_INDEX, LEGACY_FILE, applyOp, asRound, legacyToRounds, localDate, mergeRounds, serializeRound } from "./rounds.mjs"

const roundFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json") && f !== ROUNDS_INDEX && !f.startsWith("."))
        .sort()
    : []

/** Every round file. `bad` are files that could not be read as a round: they are left alone and never overwritten. */
export function readRounds(contentDir) {
  const dir = join(contentDir, ROUNDS_DIR)
  const rounds = []
  const bad = []
  for (const f of roundFiles(dir)) {
    let r = null
    try {
      r = asRound(JSON.parse(readFileSync(join(dir, f), "utf8")))
    } catch {
      /* not JSON */
    }
    // The file name is the id: a copied or renamed file must not shadow another.
    if (r && r.id === f.slice(0, -5)) rounds.push(r)
    else bad.push(f.slice(0, -5))
  }
  return { rounds, bad }
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

/** rounds/index.json: the round files that exist, so a static host (no directory listing) can load them. */
export function writeIndex(contentDir) {
  const dir = join(contentDir, ROUNDS_DIR)
  if (!existsSync(dir)) return
  const text = JSON.stringify({ rounds: roundFiles(dir) }, null, 2) + "\n"
  const file = join(dir, ROUNDS_INDEX)
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) writeAtomic(file, text)
}

/**
 * Apply operations to the rounds on disk. `items` are `{ author, date?, op }`
 * (or pass one `ctx` for all). Returns the rounds after, and the ids written.
 */
export function applyOps(contentDir, items, ctx = {}) {
  const dir = join(contentDir, ROUNDS_DIR)
  const { rounds: before, bad } = readRounds(contentDir)
  let rounds = before
  const written = new Set()
  for (const it of items) {
    const c = { ...ctx, ...(it.author != null ? { author: it.author } : {}), ...(it.date ? { date: it.date } : {}) }
    const r = applyOp(rounds, { ...c, date: c.date ?? localDate(), avoid: bad }, it.op)
    rounds = r.rounds
    r.changed.forEach((id) => written.add(id))
  }
  if (written.size) {
    mkdirSync(dir, { recursive: true })
    for (const r of rounds) if (written.has(r.id)) writeAtomic(join(dir, `${r.id}.json`), serializeRound(r))
    writeIndex(contentDir)
  }
  return { rounds, written: [...written] }
}

/**
 * Move an old stavy-content/comments.json into rounds. The old file is removed
 * only after every one of its comments and replies is found in the rounds on
 * disk. Returns null when there is nothing to migrate.
 */
export function migrateLegacy(contentDir) {
  const file = join(contentDir, LEGACY_FILE)
  if (!existsSync(file)) return null
  let list
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"))
    list = Array.isArray(raw) ? raw : raw?.comments
  } catch {
    return { ok: false, error: `${LEGACY_FILE} is not valid JSON; left as it is` }
  }
  if (!Array.isArray(list)) return { ok: false, error: `${LEGACY_FILE} has no comments list; left as it is` }
  const incoming = legacyToRounds(list)
  const { written } = applyOps(contentDir, incoming.map((round) => ({ op: { op: "import", round } })))
  const { rounds } = readRounds(contentDir)
  const comments = new Set(rounds.flatMap((r) => r.comments.map((c) => c.id)))
  const events = new Set(rounds.flatMap((r) => r.events.map((e) => e.id)))
  const missing = incoming.flatMap((r) => [...r.comments.filter((c) => !comments.has(c.id)), ...r.events.filter((e) => !events.has(e.id))].map((x) => x.id))
  if (missing.length) return { ok: false, error: `${missing.length} item(s) of ${LEGACY_FILE} did not reach the rounds (${missing.slice(0, 5).join(", ")}); the file is kept` }
  rmSync(file)
  return { ok: true, comments: list.length, rounds: written }
}

/** The threads as the viewer shows them. */
export const readThreads = (contentDir) => mergeRounds(readRounds(contentDir).rounds)

/** The short commit and branch of the repo at `cwd` ({} outside a repo). */
export function gitInfo(cwd = process.cwd()) {
  const git = (...args) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    } catch {
      return ""
    }
  }
  const commit = git("rev-parse", "--short", "HEAD")
  const branch = git("rev-parse", "--abbrev-ref", "HEAD")
  return { ...(commit ? { commit } : {}), ...(branch && branch !== "HEAD" ? { branch } : {}) }
}

/** Where stavy-content/ is, from the folder a script runs in. */
export function findContentDir(cwd = process.cwd()) {
  for (const base of ["public", "."]) if (existsSync(join(cwd, base, "stavy.json"))) return join(cwd, base, "stavy-content")
  return join(cwd, existsSync(join(cwd, "public/stavy-content")) ? "public" : ".", "stavy-content")
}
