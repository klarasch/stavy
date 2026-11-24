// Review rounds: the pure part, shared by the viewer, the dev plugin and the
// scripts (no node imports here; the file IO is in rounds-fs.mjs).
//
// A round is one file, stavy-content/rounds/<date>-<author>.json:
//
//   { "version": 1, "id": "2026-11-14-dana", "author": "Dana", "date": "2026-11-14",
//     "commit": "3061a96", "branch": "rbac",
//     "comments": [ { "id", "body", "createdAt", ...where it is anchored } ],
//     "events":   [ { "id", "thread": "<comment id>", "type": "reply" | "status" | "edit" | "remove", "at", ... } ] }
//
// One file per author per round, so nobody edits another person's file. A
// reply or a status change by someone else is an event in that person's own
// round and names the thread. What the viewer shows is the merge of every
// round. Nothing here ever rewrites a set of comments from memory: a change is
// one operation (a comment, an event, an imported round) applied to the rounds
// as they are, so a comment can only leave through its own "remove" event.

export const ROUNDS_DIR = "rounds"
export const ROUNDS_INDEX = "index.json"
export const LEGACY_FILE = "comments.json"
export const STATUSES = ["open", "addressed", "closed"]

const pad = (n) => String(n).padStart(2, "0")
/** YYYY-MM-DD in local time. */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** HH:MM in local time. */
export const localTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export const slugAuthor = (author) =>
  String(author ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "anonymous"

export const roundId = (author, date) => `${date}-${slugAuthor(author)}`

export const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)

const iso = (t) => (typeof t === "number" ? new Date(t).toISOString() : typeof t === "string" && !Number.isNaN(Date.parse(t)) ? t : new Date().toISOString())
const ms = (t) => (typeof t === "number" ? t : Date.parse(String(t)) || 0)

/** What a comment carries in a round file: everything but the derived conversation state. */
const DERIVED = ["resolved", "replies", "status", "addressedIn", "addressedBy", "round"]
function storedComment(c, author) {
  const out = {}
  for (const [k, v] of Object.entries(c)) if (!DERIVED.includes(k) && v !== undefined) out[k] = v
  out.createdAt = iso(c.createdAt)
  if (out.author == null || out.author === "") out.author = author
  return out
}

/** A round in its canonical key order (stable diffs). */
export function tidyRound(r) {
  const out = { version: 1, id: r.id, author: r.author ?? "", date: r.date }
  if (r.commit) out.commit = r.commit
  if (r.branch) out.branch = r.branch
  out.comments = r.comments ?? []
  out.events = r.events ?? []
  return out
}
export const serializeRound = (r) => JSON.stringify(tidyRound(r), null, 2) + "\n"

/** Accept only what looks like a round; anything else is null. */
export function asRound(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  if (typeof raw.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(raw.id)) return null
  if (!Array.isArray(raw.comments) && !Array.isArray(raw.events)) return null
  return tidyRound({
    ...raw,
    author: String(raw.author ?? ""),
    date: typeof raw.date === "string" ? raw.date : raw.id.slice(0, 10),
    comments: (raw.comments ?? []).filter((c) => c && typeof c === "object" && typeof c.id === "string"),
    events: (raw.events ?? []).filter((e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.thread === "string"),
  })
}

/* ---------------------------------------------------------------- merge */

/**
 * Every round merged into the threads the viewer shows: each comment with its
 * replies, its status (open, addressed, closed) and `resolved` (= closed).
 * Events apply in time order; a removed thread is left out.
 */
export function mergeRounds(rounds) {
  const threads = new Map()
  for (const r of rounds)
    for (const c of r.comments ?? []) {
      if (threads.has(c.id)) continue
      threads.set(c.id, { ...c, author: c.author || r.author || "", createdAt: ms(c.createdAt) || Date.now(), status: "open", resolved: false, replies: [], round: r.id })
    }
  const events = []
  for (const r of rounds) for (const e of r.events ?? []) events.push({ ...e, author: e.author || r.author || "", t: ms(e.at) })
  events.sort((a, b) => a.t - b.t)
  const seen = new Set()
  for (const e of events) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    const c = threads.get(e.thread)
    if (!c) continue
    if (e.type === "remove") threads.delete(e.thread)
    else if (e.type === "reply") c.replies.push({ id: e.id, author: e.author, body: String(e.body ?? ""), createdAt: e.t })
    else if (e.type === "edit" && e.patch && typeof e.patch === "object") {
      const { id: _id, ...patch } = e.patch
      Object.assign(c, patch)
    } else if (e.type === "status" && STATUSES.includes(e.status)) {
      c.status = e.status
      if (e.status === "addressed") {
        c.addressedIn = e.commit
        c.addressedBy = e.author
      } else if (e.status === "open") {
        delete c.addressedIn
        delete c.addressedBy
      }
      if (e.body) c.replies.push({ id: e.id, author: e.author, body: String(e.body), createdAt: e.t, status: e.status, ...(e.commit ? { commit: e.commit } : {}) })
    }
  }
  const out = [...threads.values()]
  for (const c of out) c.resolved = c.status === "closed"
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

/* ---------------------------------------------------------------- operations */

/**
 * The round a person's change goes into: theirs for that day. `avoid` are
 * round ids that must not be written to (rounds shipped with a published
 * build, files that could not be read).
 */
function targetRound(rounds, ctx) {
  const author = ctx.author || "anonymous"
  const avoid = new Set(ctx.avoid ?? [])
  const mine = rounds.findIndex((r) => r.author === author && r.date === ctx.date && !avoid.has(r.id))
  if (mine !== -1) return mine
  const taken = new Set([...rounds.map((r) => r.id), ...avoid])
  let id = roundId(author, ctx.date)
  for (let n = 2; taken.has(id); n++) id = `${roundId(author, ctx.date)}-${n}`
  rounds.push(tidyRound({ id, author, date: ctx.date, commit: ctx.commit, branch: ctx.branch, comments: [], events: [] }))
  return rounds.length - 1
}

/**
 * Apply one operation; returns the new rounds and the ids of the rounds that
 * changed. `rounds` is not modified. Operations are idempotent (ids decide).
 *
 *   { op: "comment", comment }                 a new thread, in ctx.author's round
 *   { op: "event", event: { id?, thread, type, ... } }   reply / status / edit / remove, in ctx.author's round
 *   { op: "import", round }                    someone's whole round (a reviewer's export, a migration)
 *
 * ctx: { author, date, commit?, branch?, avoid? }
 */
export function applyOp(rounds, ctx, op) {
  const next = rounds.map((r) => r)
  const changed = new Set()
  const edit = (i) => {
    if (next[i] === rounds[i] || !changed.has(next[i].id)) next[i] = { ...next[i], comments: [...(next[i].comments ?? [])], events: [...(next[i].events ?? [])] }
    changed.add(next[i].id)
    return next[i]
  }
  const hasComment = (id) => next.some((r) => (r.comments ?? []).some((c) => c.id === id))
  const hasEvent = (id) => next.some((r) => (r.events ?? []).some((e) => e.id === id))

  if (op?.op === "comment" && op.comment && typeof op.comment.id === "string") {
    if (hasComment(op.comment.id)) return { rounds, changed }
    const r = edit(targetRound(next, ctx))
    r.comments.push(storedComment(op.comment, r.author))
  } else if (op?.op === "event" && op.event && typeof op.event.thread === "string") {
    const e = { ...op.event, id: op.event.id ?? newId(), at: iso(op.event.at) }
    if (hasEvent(e.id)) return { rounds, changed }
    const author = ctx.author || "anonymous"
    const own = next.findIndex((r) => r.author === author && (r.comments ?? []).some((c) => c.id === e.thread) && !(ctx.avoid ?? []).includes(r.id))
    const others = next.some((r, i) => i !== own && r.author !== author && (r.events ?? []).some((x) => x.thread === e.thread))
    if (e.type === "remove" && own !== -1 && !others) {
      // My own comment nobody else has answered: take it out for real, with my events on it.
      for (let i = 0; i < next.length; i++) {
        if (next[i].author !== author) continue
        if (!(next[i].comments ?? []).some((c) => c.id === e.thread) && !(next[i].events ?? []).some((x) => x.thread === e.thread)) continue
        const r = edit(i)
        r.comments = r.comments.filter((c) => c.id !== e.thread)
        r.events = r.events.filter((x) => x.thread !== e.thread)
      }
    } else {
      const r = edit(targetRound(next, ctx))
      r.events.push(e)
    }
  } else if (op?.op === "import") {
    const incoming = asRound(op.round)
    if (!incoming) return { rounds, changed }
    let i = next.findIndex((r) => r.id === incoming.id && r.author === incoming.author && !(ctx.avoid ?? []).includes(r.id))
    const comments = incoming.comments.filter((c) => !hasComment(c.id))
    const events = incoming.events.filter((e) => !hasEvent(e.id))
    if (i === -1) {
      if (!comments.length && !events.length) return { rounds, changed }
      const taken = new Set([...next.map((r) => r.id), ...(ctx.avoid ?? [])])
      let id = incoming.id
      for (let n = 2; taken.has(id); n++) id = `${incoming.id}-${n}`
      next.push(tidyRound({ ...incoming, id, comments: [], events: [] }))
      i = next.length - 1
    } else if (!comments.length && !events.length) return { rounds, changed }
    const r = edit(i)
    r.comments.push(...comments.map((c) => storedComment(c, r.author)))
    r.events.push(...events)
  } else return { rounds, changed }
  return { rounds: next, changed }
}

/* ---------------------------------------------------------------- the old single file */

/**
 * comments.json (one list, replies and `resolved` inside each comment) as
 * rounds: each comment in its author's round for the day it was made, each
 * reply as an event in the replier's round, `resolved` as a "closed" event and
 * a trial-era `status: "addressed"` as an "addressed" event. Ids are derived
 * from the comment's, so converting twice gives the same rounds.
 */
export function legacyToRounds(list) {
  const rounds = new Map()
  const round = (author, at) => {
    const a = author || "anonymous"
    const date = iso(at).slice(0, 10)
    const key = `${a}\n${date}`
    if (!rounds.has(key)) rounds.set(key, { id: "", author: a, date, comments: [], events: [] })
    return rounds.get(key)
  }
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || typeof c !== "object" || typeof c.id !== "string") continue
    const createdAt = iso(c.createdAt)
    round(c.author, createdAt).comments.push(storedComment({ ...c, createdAt }, c.author || "anonymous"))
    let last = { author: c.author, at: createdAt }
    ;(Array.isArray(c.replies) ? c.replies : []).forEach((r, i) => {
      if (!r || typeof r !== "object") return
      const at = iso(r.createdAt)
      round(r.author, at).events.push({ id: r.id ?? `${c.id}-r${i}`, thread: c.id, type: "reply", body: String(r.body ?? ""), at })
      last = { author: r.author, at }
    })
    if (c.status === "addressed")
      round(last.author, last.at).events.push({ id: `${c.id}-addressed`, thread: c.id, type: "status", status: "addressed", ...(c.addressedIn ? { commit: c.addressedIn } : {}), at: last.at })
    if (c.resolved) round(c.author, createdAt).events.push({ id: `${c.id}-closed`, thread: c.id, type: "status", status: "closed", at: last.at })
  }
  const taken = new Set()
  return [...rounds.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.author.localeCompare(b.author))
    .map((r) => {
      let id = roundId(r.author, r.date)
      for (let n = 2; taken.has(id); n++) id = `${roundId(r.author, r.date)}-${n}`
      taken.add(id)
      return tidyRound({ ...r, id })
    })
}

/** How many threads and other events a set of rounds holds, and by whom (for "Import round: 5 comments from Dana"). */
export function describeRounds(rounds) {
  const authors = [...new Set(rounds.map((r) => r.author || "anonymous"))]
  const comments = rounds.reduce((n, r) => n + (r.comments?.length ?? 0), 0)
  const events = rounds.reduce((n, r) => n + (r.events?.length ?? 0), 0)
  return { authors, comments, events }
}
