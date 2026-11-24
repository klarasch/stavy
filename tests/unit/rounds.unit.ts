import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// @ts-expect-error plain ES modules shipped to adopters as-is
import { applyOp, legacyToRounds, mergeRounds, roundId, slugAuthor } from "../../scripts/lib/rounds.mjs"
// @ts-expect-error plain ES modules shipped to adopters as-is
import { applyOps, migrateLegacy, readRounds, readThreads } from "../../scripts/lib/rounds-fs.mjs"
// @ts-expect-error plain ES modules shipped to adopters as-is
import { address } from "../../scripts/address.mjs"
// @ts-expect-error plain ES modules shipped to adopters as-is
import { appendLog, logLine } from "../../scripts/log.mjs"

const ctx = (author: string, date = "2026-11-14") => ({ author, date, commit: "abc1234" })
const comment = (id: string, extra: Record<string, unknown> = {}) => ({ id, page: "members", dims: { _state: "members-default" }, x: 1, y: 2, body: `body ${id}`, createdAt: "2026-11-14T10:00:00.000Z", ...extra })

/** The October comments of the trial sandbox, as they were in comments.json. */
const LEGACY = {
  version: 2,
  comments: [
    { id: "old1", page: "roles", dims: { _state: "role-viewer" }, x: 72.4, y: 21.2, body: "First", author: "Klara", createdAt: "2026-10-19T20:57:22.650Z", resolved: false, replies: [{ id: "r1", author: "Klara", body: "Will something appear here?", createdAt: "2026-10-19T20:58:50.067Z" }] },
    { id: "old2", page: "import", dims: { _state: "review" }, x: 1, y: 1, body: "Second", author: "Klara", createdAt: "2026-10-20T10:48:38.565Z", resolved: true, replies: [] },
    { id: "old3", board: "bulk", x: 1, y: 1, body: "Third", author: "Klára", createdAt: "2026-11-14T17:12:17.973Z", resolved: false, status: "addressed", addressedIn: "3061a96", replies: [{ id: "r3", author: "Claude", body: "Addressed in 3061a96: done", createdAt: "2026-11-14T17:13:00.000Z" }] },
  ],
}

describe("rounds: one file per author per day", () => {
  it("names a round by date and author, without accents", () => {
    expect(slugAuthor("Klára Š.")).toBe("klara-s")
    expect(roundId("Dana", "2026-11-14")).toBe("2026-11-14-dana")
    expect(slugAuthor("")).toBe("anonymous")
  })

  it("puts a comment in its author's round, and a reply by someone else in that person's own round", () => {
    let rounds = applyOp([], ctx("Dana"), { op: "comment", comment: comment("c1") }).rounds
    rounds = applyOp(rounds, ctx("Klara"), { op: "event", event: { id: "e1", thread: "c1", type: "reply", body: "On it", at: "2026-11-14T11:00:00.000Z" } }).rounds
    expect(rounds.map((r: any) => r.id)).toEqual(["2026-11-14-dana", "2026-11-14-klara"])
    expect(rounds[0].comments).toHaveLength(1)
    expect(rounds[0].events).toHaveLength(0)
    expect(rounds[1].comments).toHaveLength(0)
    expect(rounds[1].events[0]).toMatchObject({ thread: "c1", type: "reply" })
    expect(rounds[0].commit).toBe("abc1234")
    const [c] = mergeRounds(rounds)
    expect(c).toMatchObject({ id: "c1", author: "Dana", status: "open", resolved: false, round: "2026-11-14-dana" })
    expect(c.replies).toEqual([expect.objectContaining({ author: "Klara", body: "On it" })])
  })

  it("keeps two people whose names make the same file name apart", () => {
    let rounds = applyOp([], ctx("Klara"), { op: "comment", comment: comment("c1") }).rounds
    rounds = applyOp(rounds, ctx("Klára"), { op: "comment", comment: comment("c2") }).rounds
    expect(rounds.map((r: any) => [r.id, r.author])).toEqual([
      ["2026-11-14-klara", "Klara"],
      ["2026-11-14-klara-2", "Klára"],
    ])
  })

  it("goes open → addressed (with the commit) → closed, and back to open", () => {
    let rounds = applyOp([], ctx("Dana"), { op: "comment", comment: comment("c1") }).rounds
    rounds = applyOp(rounds, ctx("Claude"), { op: "event", event: { id: "e1", thread: "c1", type: "status", status: "addressed", commit: "f00ba12", body: "Left-aligned.", at: "2026-11-14T11:00:00.000Z" } }).rounds
    let [c] = mergeRounds(rounds)
    expect(c).toMatchObject({ status: "addressed", addressedIn: "f00ba12", addressedBy: "Claude", resolved: false })
    expect(c.replies[0]).toMatchObject({ author: "Claude", body: "Left-aligned.", status: "addressed", commit: "f00ba12" })
    rounds = applyOp(rounds, ctx("Dana"), { op: "event", event: { id: "e2", thread: "c1", type: "status", status: "closed", at: "2026-11-14T12:00:00.000Z" } }).rounds
    ;[c] = mergeRounds(rounds)
    expect(c).toMatchObject({ status: "closed", resolved: true })
    rounds = applyOp(rounds, ctx("Dana"), { op: "event", event: { id: "e3", thread: "c1", type: "status", status: "open", at: "2026-11-14T13:00:00.000Z" } }).rounds
    ;[c] = mergeRounds(rounds)
    expect(c.status).toBe("open")
    expect(c.addressedIn).toBeUndefined()
  })

  it("is idempotent: the same comment, event or round applied twice changes nothing", () => {
    const a = applyOp([], ctx("Dana"), { op: "comment", comment: comment("c1") })
    const b = applyOp(a.rounds, ctx("Dana"), { op: "comment", comment: comment("c1") })
    expect(b.rounds).toBe(a.rounds)
    expect(b.changed.size).toBe(0)
    const again = applyOp(a.rounds, ctx("x"), { op: "import", round: a.rounds[0] })
    expect(again.rounds).toBe(a.rounds)
  })

  it("removes my own unanswered comment for real, and only hides one somebody else is part of", () => {
    let rounds = applyOp([], ctx("Dana"), { op: "comment", comment: comment("mine") }).rounds
    rounds = applyOp(rounds, ctx("Dana"), { op: "comment", comment: comment("answered") }).rounds
    rounds = applyOp(rounds, ctx("Klara"), { op: "event", event: { id: "e1", thread: "answered", type: "reply", body: "?" } }).rounds
    rounds = applyOp(rounds, ctx("Dana"), { op: "event", event: { thread: "mine", type: "remove" } }).rounds
    rounds = applyOp(rounds, ctx("Dana"), { op: "event", event: { thread: "answered", type: "remove" } }).rounds
    const dana = rounds.find((r: any) => r.author === "Dana")
    expect(dana.comments.map((c: any) => c.id)).toEqual(["answered"])
    expect(dana.events).toEqual([expect.objectContaining({ thread: "answered", type: "remove" })])
    expect(mergeRounds(rounds)).toEqual([])
    // Someone else removing a comment never touches its author's file.
    let other = applyOp([], ctx("Dana"), { op: "comment", comment: comment("c1") }).rounds
    other = applyOp(other, ctx("Klara"), { op: "event", event: { thread: "c1", type: "remove" } }).rounds
    expect(other[0].comments).toHaveLength(1)
    expect(mergeRounds(other)).toEqual([])
  })

  it("never writes into a round it was told to leave alone (shipped with a build)", () => {
    const shipped = applyOp([], ctx("Dana"), { op: "comment", comment: comment("c1") }).rounds
    const { rounds } = applyOp(shipped, { ...ctx("Dana"), avoid: ["2026-11-14-dana"] }, { op: "comment", comment: comment("c2") })
    expect(rounds[0]).toBe(shipped[0])
    expect(rounds[1]).toMatchObject({ id: "2026-11-14-dana-2", author: "Dana" })
  })
})

describe("rounds: the old comments.json", () => {
  it("becomes rounds without losing a comment, a reply or a status", () => {
    const rounds = legacyToRounds(LEGACY.comments)
    expect(rounds.map((r: any) => r.id)).toEqual(["2026-10-19-klara", "2026-10-20-klara", "2026-11-14-claude", "2026-11-14-klara"])
    const threads = mergeRounds(rounds)
    expect(threads.map((c: any) => c.id)).toEqual(["old1", "old2", "old3"])
    expect(threads[0].replies[0]).toMatchObject({ id: "r1", body: "Will something appear here?" })
    expect(threads[1]).toMatchObject({ status: "closed", resolved: true })
    expect(threads[2]).toMatchObject({ status: "addressed", addressedIn: "3061a96", addressedBy: "Claude", author: "Klára" })
    // Stored comments carry no derived state.
    for (const r of rounds) for (const c of r.comments) expect(Object.keys(c)).not.toEqual(expect.arrayContaining(["resolved", "replies", "status"]))
    // Converting twice gives the same thing.
    expect(legacyToRounds(LEGACY.comments)).toEqual(rounds)
  })
})

describe("rounds on disk", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stavy-rounds-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const files = () => readdirSync(join(dir, "rounds")).sort()

  it("migrates comments.json, removes it only when everything arrived, and lists the rounds in index.json", () => {
    writeFileSync(join(dir, "comments.json"), JSON.stringify(LEGACY))
    const r = migrateLegacy(dir)
    expect(r).toMatchObject({ ok: true, comments: 3 })
    expect(existsSync(join(dir, "comments.json"))).toBe(false)
    expect(files()).toEqual(["2026-10-19-klara.json", "2026-10-20-klara.json", "2026-11-14-claude.json", "2026-11-14-klara.json", "index.json"])
    expect(JSON.parse(readFileSync(join(dir, "rounds/index.json"), "utf8")).rounds).toHaveLength(4)
    expect(readThreads(dir).map((c: any) => c.id)).toEqual(["old1", "old2", "old3"])
    expect(migrateLegacy(dir)).toBeNull()
  })

  it("leaves a comments.json it cannot read exactly as it is", () => {
    writeFileSync(join(dir, "comments.json"), "{ not json")
    expect(migrateLegacy(dir)).toMatchObject({ ok: false })
    expect(readFileSync(join(dir, "comments.json"), "utf8")).toBe("{ not json")
  })

  // The regression: in the trial, three older comments were gone from
  // comments.json after a new round, because the viewer saved the list it had
  // in memory over the file. A write is now one operation applied to the rounds
  // on disk, so whoever writes, and whatever they have (or have not) loaded,
  // the comments already there stay.
  it("adding a comment never drops the comments already on disk", () => {
    writeFileSync(join(dir, "comments.json"), JSON.stringify(LEGACY))
    migrateLegacy(dir)
    const before = Object.fromEntries(files().filter((f) => f !== "index.json").map((f) => [f, readFileSync(join(dir, "rounds", f), "utf8")]))
    // A writer that knows nothing of what is on disk: its whole world is one new comment.
    applyOps(dir, [{ author: "Klára", date: "2026-11-15", op: { op: "comment", comment: comment("new1", { createdAt: "2026-11-15T09:00:00.000Z" }) } }])
    applyOps(dir, [{ author: "Klára", date: "2026-11-15", op: { op: "event", event: { thread: "old1", type: "status", status: "closed" } } }])
    expect(readThreads(dir).map((c: any) => c.id)).toEqual(["old1", "old2", "old3", "new1"])
    // Nobody else's file was touched.
    for (const [f, text] of Object.entries(before)) expect(readFileSync(join(dir, "rounds", f), "utf8")).toBe(text)
    expect(files()).toContain("2026-11-15-klara.json")
  })

  it("does not overwrite a round file it could not read", () => {
    mkdirSync(join(dir, "rounds"))
    writeFileSync(join(dir, "rounds/2026-11-14-dana.json"), "<<<<<<< merge conflict")
    applyOps(dir, [{ author: "Dana", date: "2026-11-14", op: { op: "comment", comment: comment("c1") } }])
    expect(readFileSync(join(dir, "rounds/2026-11-14-dana.json"), "utf8")).toBe("<<<<<<< merge conflict")
    expect(readRounds(dir).rounds.map((r: any) => r.id)).toEqual(["2026-11-14-dana-2"])
  })

  it("stavy:address records status, reply and commit in the caller's own round, and a log line", () => {
    applyOps(dir, [{ author: "Dana", date: "2026-11-14", op: { op: "comment", comment: comment("c1") } }])
    const danaFile = readFileSync(join(dir, "rounds/2026-11-14-dana.json"), "utf8")
    const now = new Date(2026, 10, 15, 9, 5)
    const r = address(dir, [["c1", "Checkboxes are left-aligned."], ["nope", "x"]], { author: "Claude", commit: "f00ba12", now })
    expect(r.done.map((d: any) => d.id)).toEqual(["c1"])
    expect(r.missing).toEqual(["nope"])
    expect(readFileSync(join(dir, "rounds/2026-11-14-dana.json"), "utf8")).toBe(danaFile)
    const mine = JSON.parse(readFileSync(join(dir, "rounds/2026-11-15-claude.json"), "utf8"))
    expect(mine).toMatchObject({ author: "Claude", commit: "f00ba12", comments: [] })
    expect(mine.events[0]).toMatchObject({ thread: "c1", type: "status", status: "addressed", commit: "f00ba12", body: "Checkboxes are left-aligned." })
    expect(readThreads(dir)[0]).toMatchObject({ status: "addressed", addressedIn: "f00ba12", resolved: false })
    expect(readFileSync(join(dir, "log/2026-11-15.md"), "utf8")).toContain("- 09:05 · members-default · Checkboxes are left-aligned. · why: review comment c1 · f00ba12\n")
  })

  it("stavy:log appends, with the real time and the commit, and never rewrites", () => {
    const now = new Date(2026, 10, 14, 17, 49)
    appendLog(dir, { what: "Roles list replaces\nthe table", why: "v2 outline", states: "roles-default, roles-with-custom", commit: "abc1234", now })
    appendLog(dir, { what: "faked: member counts", why: "", states: "", now })
    const text = readFileSync(join(dir, "log/2026-11-14.md"), "utf8")
    expect(text).toBe("# Log 2026-11-14\n\n- 17:49 · roles-default, roles-with-custom · Roles list replaces the table · why: v2 outline · abc1234\n- 17:49 · all · faked: member counts\n")
    expect(logLine({ what: "x", why: "y", states: "s", commit: "c", time: "10:00" })).toBe("10:00 · s · x · why: y · c")
  })
})
