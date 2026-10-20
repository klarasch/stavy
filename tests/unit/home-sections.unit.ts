import { describe, expect, it } from "vitest"
import { parseDecision, relativeDate, splitSections } from "../../src/stavy/home/sections"

describe("home sections", () => {
  it("splits ## sections, drops the preamble, respects code fences", () => {
    const s = splitSections("# T\n\nintro\n\n## One\n- a\n\n```\n## not a heading\n```\n\n## Two\nbody")
    expect(s.map((x) => x.title)).toEqual(["One", "Two"])
    expect(s[0].body).toContain("## not a heading")
    expect(s[1].body).toBe("body")
  })

  it("parses a decision", () => {
    const d = parseDecision({ title: "2026-10-12 — Use one scene", body: "**Why:** it is simpler\n**Alternatives:** many params\n*Status*: decided" })
    expect(d).toEqual({ date: "2026-10-12", title: "Use one scene", why: "it is simpler", alternatives: "many params", status: "decided" })
    expect(parseDecision({ title: "Plain", body: "" })).toEqual({ title: "Plain" })
  })

  it("words relative dates", () => {
    const now = Date.parse("2026-10-20T12:00:00Z")
    expect(relativeDate("2026-10-19T12:00:00Z", now)).toBe("yesterday")
    expect(relativeDate("2026-10-17T12:00:00Z", now)).toBe("3 days ago")
    expect(relativeDate("2026-10-20T11:59:30Z", now)).toBe("just now")
  })
})
