import { describe, it, expect } from "vitest"
import { encodeRounds, decodeRounds, dimsEqual, uid, pathBetween, followPath, resolveAnchor, type Comment, type Round } from "../../src/stavy/comments/store"

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    page: "dashboard",
    dims: { role: "manager" },
    x: 12.5,
    y: 84.2,
    body: "Looks off on mobile",
    author: "klara",
    createdAt: 1700000000000,
    status: "open",
    resolved: false,
    replies: [],
    ...overrides,
  }
}

// base64url encoding, replicated independently of the module's private
// `b64u` helper, so we can hand-build a legacy `c0.` payload the same way
// the module itself would have (uncompressed, plain JSON bytes).
function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
function legacyC0Payload(list: Comment[]): string {
  return "c0." + b64urlEncode(new TextEncoder().encode(JSON.stringify(list)))
}

/* ------------------------------------------------------------------ */
/* dimsEqual                                                           */
/* ------------------------------------------------------------------ */

describe("dimsEqual", () => {
  it("is true for two empty dims objects", () => {
    expect(dimsEqual({}, {})).toBe(true)
  })

  it("is true for identical dims", () => {
    expect(dimsEqual({ role: "manager", state: "loaded" }, { role: "manager", state: "loaded" })).toBe(true)
  })

  it("is false when a value differs", () => {
    expect(dimsEqual({ role: "manager" }, { role: "employee" })).toBe(false)
  })

  it("is false when key counts differ", () => {
    expect(dimsEqual({ role: "manager" }, { role: "manager", state: "loaded" })).toBe(false)
  })

  it("is false when same length but different keys", () => {
    expect(dimsEqual({ role: "manager" }, { state: "manager" })).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* uid                                                                  */
/* ------------------------------------------------------------------ */

describe("uid", () => {
  it("produces a non-empty string", () => {
    expect(typeof uid()).toBe("string")
    expect(uid().length).toBeGreaterThan(0)
  })

  it("produces distinct ids across many calls", () => {
    const ids = new Set(Array.from({ length: 200 }, () => uid()))
    expect(ids.size).toBe(200)
  })
})

/* ------------------------------------------------------------------ */
/* encodeRounds / decodeRounds: the feedback link                       */
/* ------------------------------------------------------------------ */

const round = (comments: Comment[] = [makeComment()]): Round => ({
  version: 1,
  id: "2026-11-14-klara",
  author: "klara",
  date: "2026-11-14",
  commit: "abc1234",
  comments: comments.map(({ resolved: _r, replies: _p, status: _s, ...c }) => ({ ...c, createdAt: new Date(c.createdAt).toISOString() })),
  events: [{ id: "e1", thread: "c1", type: "reply", body: "Agreed", at: "2026-11-14T12:00:00.000Z" }],
})

describe("encodeRounds / decodeRounds: round trip", () => {
  it("round-trips rounds, comments and events", async () => {
    const list = [round([makeComment(), makeComment({ id: "c2", body: "Unicode: přílišžluťoučký 🐎" })])]
    expect(await decodeRounds(await encodeRounds(list))).toEqual(list)
  })

  it("emits the r1. (gzip) prefix where CompressionStream is available", async () => {
    expect((await encodeRounds([round()])).startsWith("r1.")).toBe(true)
  })

  it("survives a round large enough to need chunked base64", async () => {
    const many = Array.from({ length: 3000 }, (_, i) => makeComment({ id: `c${i}`, body: Math.random().toString(36).repeat(8) }))
    const decoded = await decodeRounds(await encodeRounds([round(many)]))
    expect(decoded[0].comments).toHaveLength(3000)
  })
})

describe("decodeRounds: the input shapes it accepts", () => {
  it("accepts a #round= fragment and a full share link", async () => {
    const payload = await encodeRounds([round()])
    expect(await decodeRounds(`#round=${payload}`)).toEqual([round()])
    expect(await decodeRounds(`https://example.com/app/stavy/?comments=1#round=${payload}`)).toEqual([round()])
  })

  it("accepts a round as plain JSON, alone or as { rounds }", async () => {
    expect(await decodeRounds(JSON.stringify(round()))).toEqual([round()])
    expect(await decodeRounds(`  ${JSON.stringify({ v: 1, rounds: [round()] })}  `)).toEqual([round()])
  })

  it("turns an older link (#c=c0.…, a list of comments) into rounds, replies included", async () => {
    const old = [makeComment({ replies: [{ id: "r1", author: "dana", body: "ok", createdAt: 1700000100000 }], resolved: true })]
    const rounds = await decodeRounds(`#c=${legacyC0Payload(old)}`)
    expect(rounds.map((r) => r.author).sort()).toEqual(["dana", "klara"])
    expect(rounds.flatMap((r) => r.comments).map((c) => c.id)).toEqual(["c1"])
    expect(rounds.flatMap((r) => r.events).map((e) => e.type).sort()).toEqual(["reply", "status"])
    expect(await decodeRounds(JSON.stringify(old))).toEqual(rounds)
  })
})

describe("decodeRounds: malformed input", () => {
  it("rejects what is not a payload", async () => {
    await expect(decodeRounds("")).rejects.toThrow("Not a Stavy feedback payload")
    await expect(decodeRounds("totally-unrelated-garbage")).rejects.toThrow("Not a Stavy feedback payload")
    await expect(decodeRounds('{"hello":"world"}')).rejects.toThrow("Not a Stavy feedback payload")
  })

  it("rejects broken base64, broken gzip and broken JSON", async () => {
    await expect(decodeRounds("r1.not-valid-base64!!!")).rejects.toThrow()
    const full = await encodeRounds([round()])
    await expect(decodeRounds(full.slice(0, Math.floor(full.length / 2)))).rejects.toThrow()
    await expect(decodeRounds("[not valid json")).rejects.toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* pathBetween / followPath: nth-child anchoring arithmetic             */
/* ------------------------------------------------------------------ */

// Minimal fake "Element" — pathBetween/followPath only ever touch
// `.parentElement` and `.children` (as an indexable, array-like list), so a
// plain object tree stands in for a real DOM without needing jsdom.
interface FakeEl {
  parentElement: FakeEl | null
  children: FakeEl[]
}
function fakeEl(children: FakeEl[] = []): FakeEl {
  const node: FakeEl = { parentElement: null, children }
  for (const c of children) c.parentElement = node
  return node
}

describe("pathBetween / followPath", () => {
  it("returns an empty path when from === el", () => {
    const root = fakeEl()
    expect(pathBetween(root as unknown as Element, root as unknown as Element)).toEqual([])
  })

  it("computes the nth-child path down a nested tree", () => {
    const target = fakeEl()
    const c = fakeEl([target])
    const b = fakeEl()
    const a = fakeEl([b, c]) // target is a.children[1].children[0]
    const root = fakeEl([a])

    const path = pathBetween(root as unknown as Element, target as unknown as Element)
    expect(path).toEqual([0, 1, 0])
  })

  it("followPath is the inverse of pathBetween", () => {
    const target = fakeEl()
    const c = fakeEl([fakeEl(), target])
    const root = fakeEl([fakeEl(), c])

    const path = pathBetween(root as unknown as Element, target as unknown as Element)
    expect(followPath(root as unknown as Element, path)).toBe(target)
  })

  it("pathBetween returns [] when el is not a descendant of from", () => {
    const other = fakeEl()
    const root = fakeEl([fakeEl()])
    expect(pathBetween(root as unknown as Element, other as unknown as Element)).toEqual([])
  })

  it("followPath returns null when the path no longer resolves (DOM changed underneath it)", () => {
    const root = fakeEl([fakeEl()]) // only index 0 exists
    expect(followPath(root as unknown as Element, [5])).toBeNull()
  })

  it("followPath returns the root itself for an empty/undefined path", () => {
    const root = fakeEl([fakeEl()])
    expect(followPath(root as unknown as Element, [])).toBe(root)
    expect(followPath(root as unknown as Element, undefined)).toBe(root)
  })
})

/* ------------------------------------------------------------------ */
/* resolveAnchor: target-less case (no CSS.escape / querySelector needed) */
/* ------------------------------------------------------------------ */

describe("resolveAnchor", () => {
  it("falls back to the page root when the comment has no target and no path", () => {
    const root = fakeEl()
    const wrapper = fakeEl([root])
    const c = makeComment({ target: undefined, path: undefined })
    expect(resolveAnchor(c, wrapper as unknown as HTMLElement, root as unknown as Element)).toBe(root)
  })

  it("follows the recorded path from the root when there is no target", () => {
    const grandchild = fakeEl()
    const child = fakeEl([fakeEl(), grandchild])
    const root = fakeEl([child])
    const wrapper = fakeEl([root])
    const c = makeComment({ target: undefined, path: [0, 1] })
    expect(resolveAnchor(c, wrapper as unknown as HTMLElement, root as unknown as Element)).toBe(grandchild)
  })
})
