import { describe, it, expect } from "vitest"
import { encodePayload, decodePayload, dimsEqual, uid, pathBetween, followPath, resolveAnchor, type Comment } from "../../src/stavy/comments/store"

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
/* encodePayload / decodePayload: round-tripping                       */
/* ------------------------------------------------------------------ */

describe("encodePayload / decodePayload: round trip", () => {
  it("round-trips a single comment", async () => {
    const list = [makeComment()]
    const decoded = await decodePayload(await encodePayload(list))
    expect(decoded).toEqual(list)
  })

  it("round-trips multiple comments with replies", async () => {
    const list = [
      makeComment({ id: "a", replies: [{ id: "r1", author: "bob", body: "fixed", createdAt: 1 }] }),
      makeComment({ id: "b", resolved: true, target: "SubmitButton", path: [0, 2, 1] }),
    ]
    const decoded = await decodePayload(await encodePayload(list))
    expect(decoded).toEqual(list)
  })

  it("round-trips an empty list", async () => {
    const decoded = await decodePayload(await encodePayload([]))
    expect(decoded).toEqual([])
  })

  it("round-trips unicode and special characters in the body", async () => {
    const list = [makeComment({ body: "emoji check ✅🎉 — “curly quotes” & <tags>" })]
    const decoded = await decodePayload(await encodePayload(list))
    expect(decoded).toEqual(list)
  })

  it("produces a c1. (compressed) payload when CompressionStream is available", async () => {
    const encoded = await encodePayload([makeComment()])
    expect(encoded.startsWith("c1.")).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* decodePayload: legacy c0. format                                    */
/* ------------------------------------------------------------------ */

describe("decodePayload: legacy c0. format", () => {
  it("decodes a hand-built c0. (uncompressed) payload", async () => {
    const list = [makeComment({ id: "legacy" })]
    const decoded = await decodePayload(legacyC0Payload(list))
    expect(decoded).toEqual(list)
  })

  it("decodes an empty c0. payload", async () => {
    const decoded = await decodePayload(legacyC0Payload([]))
    expect(decoded).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* decodePayload: input shapes it accepts besides a raw payload         */
/* ------------------------------------------------------------------ */

describe("decodePayload: alternate input shapes", () => {
  it("accepts plain JSON array text", async () => {
    const list = [makeComment()]
    const decoded = await decodePayload(JSON.stringify(list))
    expect(decoded).toEqual(list)
  })

  it("extracts the payload from a #c=... hash fragment", async () => {
    const list = [makeComment()]
    const payload = await encodePayload(list)
    const decoded = await decodePayload(`#c=${payload}`)
    expect(decoded).toEqual(list)
  })

  it("extracts the payload from a full share URL", async () => {
    const list = [makeComment()]
    const payload = await encodePayload(list)
    const decoded = await decodePayload(`https://example.com/app/?comments=1#c=${payload}`)
    expect(decoded).toEqual(list)
  })

  it("trims surrounding whitespace", async () => {
    const list = [makeComment()]
    const decoded = await decodePayload(`  ${JSON.stringify(list)}  `)
    expect(decoded).toEqual(list)
  })
})

/* ------------------------------------------------------------------ */
/* decodePayload: malformed / truncated / garbage input                */
/* ------------------------------------------------------------------ */

describe("decodePayload: malformed input", () => {
  it("rejects an empty string", async () => {
    await expect(decodePayload("")).rejects.toThrow("Not a Stavy comments payload")
  })

  it("rejects text with no recognizable prefix", async () => {
    await expect(decodePayload("totally-unrelated-garbage")).rejects.toThrow("Not a Stavy comments payload")
  })

  it("rejects a c1. payload with invalid base64", async () => {
    await expect(decodePayload("c1.not-valid-base64!!!")).rejects.toThrow()
  })

  it("rejects a c1. payload whose bytes are not valid gzip", async () => {
    const bogus = "c1." + b64urlEncode(new TextEncoder().encode("this is not gzip data"))
    await expect(decodePayload(bogus)).rejects.toThrow()
  })

  it("rejects a truncated c1. payload (corrupted mid-stream)", async () => {
    const full = await encodePayload([makeComment(), makeComment({ id: "c2" })])
    const truncated = full.slice(0, Math.floor(full.length * 0.6))
    await expect(decodePayload(truncated)).rejects.toThrow()
  })

  it("rejects a c0. payload whose bytes are not valid JSON", async () => {
    const bogus = "c0." + b64urlEncode(new TextEncoder().encode("not json at all"))
    await expect(decodePayload(bogus)).rejects.toThrow()
  })

  it("rejects malformed JSON passed directly as an array-looking string", async () => {
    await expect(decodePayload("[not valid json")).rejects.toThrow()
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
