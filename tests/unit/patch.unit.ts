import { describe, expect, it } from "vitest"
import { applyPatch, resolvePatchPath } from "../../scripts/lib/patch.mjs"

const make = () => ({
  pages: [
    {
      id: "inbox",
      label: "Inbox",
      description: "d",
      url: "/inbox",
      states: [{ id: "empty", url: "/inbox?s=empty", label: "Empty", note: "n" }, { id: "full", url: "/inbox?s=full" }],
      instances: [{ dims: { a: "b" } }, { dims: { a: "c" }, note: "x" }],
    },
  ],
  scenarios: [{ id: "flow", label: "Flow", steps: [{ page: "inbox", title: "T" }, { page: "inbox", note: "n" }] }],
})

describe("manifest patch paths", () => {
  it("resolves ids to the right fields", () => {
    const m = make()
    expect(resolvePatchPath(m, ["pages", "inbox", "label"])).toEqual({ parent: m.pages[0], key: "label" })
    expect(resolvePatchPath(m, ["pages", "inbox", "states", "full", "note"]).parent).toBe(m.pages[0].states[1])
    expect(resolvePatchPath(m, ["pages", "inbox", "instances", 1, "note"]).parent).toBe(m.pages[0].instances[1])
    expect(resolvePatchPath(m, ["scenarios", "flow", "steps", 0, "title"]).parent).toBe(m.scenarios[0].steps[0])
    expect(resolvePatchPath(m, ["scenarios", "flow", "description"]).key).toBe("description")
  })

  it("rejects everything else", () => {
    const m = make()
    for (const p of [
      [],
      "pages",
      ["pages", "inbox", "url"],
      ["pages", "inbox", "states", "full", "url"],
      ["pages", "inbox", "states", "missing", "label"],
      ["pages", "nope", "label"],
      ["pages", "inbox", "instances", 0, "dims"],
      ["pages", "inbox", "instances", 9, "note"],
      ["pages", "inbox", "instances", -1, "note"],
      ["pages", "inbox", "instances", "0", "note"],
      ["scenarios", "flow", "steps", 0, "page"],
      ["scenarios", "flow", "steps", 5, "title"],
      ["scenarios", "flow", "steps", 0, "title", "x"],
      ["viewer", "viewport"],
      ["pages", "inbox", "__proto__"],
      ["pages", "inbox", "label", "x"],
    ])
      expect(() => resolvePatchPath(m, p as never), JSON.stringify(p)).toThrow()
  })

  it("sets trimmed text, removes optional fields when emptied, keeps key order", () => {
    const m = make()
    applyPatch(m, ["pages", "inbox", "states", "empty", "label"], "  Nothing yet ")
    expect(m.pages[0].states[0].label).toBe("Nothing yet")
    expect(Object.keys(m.pages[0].states[0])).toEqual(["id", "url", "label", "note"])
    applyPatch(m, ["pages", "inbox", "states", "empty", "note"], "")
    expect("note" in m.pages[0].states[0]).toBe(false)
    expect(() => applyPatch(m, ["pages", "inbox", "label"], " ")).toThrow()
    expect(() => applyPatch(m, ["pages", "inbox", "label"], 3 as never)).toThrow()
  })
})

describe("status", () => {
  const m = () => ({ pages: [{ id: "p", label: "P", states: [{ id: "a", url: "/a" }] }], scenarios: [] }) as any

  it("sets a page or state status from the allowed set", () => {
    const x = m()
    applyPatch(x, ["pages", "p", "status"], "review")
    applyPatch(x, ["pages", "p", "states", "a", "status"], "draft")
    expect(x.pages[0].status).toBe("review")
    expect(x.pages[0].states[0].status).toBe("draft")
    expect(() => applyPatch(x, ["pages", "p", "status"], "shipped")).toThrow(/status must be one of/)
  })

  it("records the ready mark on ready and drops it otherwise", () => {
    const x = m()
    const ready = { at: "2026-10-21", by: "K", snapshots: { "p?_state=a": "h1" } }
    applyPatch(x, ["pages", "p", "states", "a", "status"], "ready", { ready })
    expect(x.pages[0].states[0].ready).toEqual(ready)
    applyPatch(x, ["pages", "p", "states", "a", "status"], "review")
    expect(x.pages[0].states[0].ready).toBeUndefined()
    applyPatch(x, ["pages", "p", "states", "a", "status"], "")
    expect(x.pages[0].states[0].status).toBeUndefined()
  })

  it("marks ready with a date when no mark is given", () => {
    const x = m()
    applyPatch(x, ["pages", "p", "status"], "ready")
    expect(x.pages[0].ready.at).toMatch(/^\d{4}-\d\d-\d\d$/)
  })
})
