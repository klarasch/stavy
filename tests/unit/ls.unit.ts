import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
// @ts-expect-error plain ES modules shipped to adopters as-is
import { formatList, formatPage, listPages, showPage } from "../../scripts/ls.mjs"
// @ts-expect-error plain ES modules shipped to adopters as-is
import { fidelitySummary } from "../../scripts/validate.mjs"

const NAMED = {
  product: { name: "T" },
  pages: [
    {
      id: "keys",
      label: "API keys",
      group: "Settings",
      url: "/keys",
      fidelity: "static",
      states: [
        { id: "empty", url: "/keys?scene=keys-empty", note: "First run" },
        { id: "revoke", url: "/keys?scene=keys-revoke" },
        { id: "old", url: "/keys?scene=old", hidden: true },
      ],
    },
    { id: "policy", url: "/policy" },
  ],
  scenarios: [{ id: "revoke-flow", steps: [{ page: "keys", state: "empty" }] }],
}

const demo = () => JSON.parse(readFileSync(join(__dirname, "../../stavy.json"), "utf8"))

describe("stavy:ls", () => {
  it("lists screens with fidelity and the states the map shows", () => {
    const rows = listPages(NAMED)
    expect(rows).toEqual([
      { id: "keys", label: "API keys", group: "Settings", fidelity: "static", states: 2, url: "/keys" },
      { id: "policy", fidelity: null, states: 1, url: "/policy" },
    ])
    expect(formatList(rows)).toContain("2 screens")
  })

  it("shows named states with their URLs and shorthand scan keys", () => {
    const d = showPage(NAMED, "keys")
    expect(d.states).toEqual([
      { id: "empty", url: "/keys?scene=keys-empty", key: "keys/empty", note: "First run" },
      { id: "revoke", url: "/keys?scene=keys-revoke", key: "keys/revoke" },
    ])
    expect(d.hidden).toEqual(["old"])
    expect(d.flows).toEqual(["revoke-flow"])
    expect(d.dimensions).toBeUndefined()
  })

  it("gives a screen without states its default, keyed by the screen id", () => {
    const d = showPage(NAMED, "policy")
    expect(d.states).toEqual([{ url: "/policy", key: "policy" }])
    expect(formatPage(d)).toContain("default  /policy")
  })

  it("fills dimension templates and gives full instance keys", () => {
    const d = showPage(demo(), "dashboard")
    expect(d.dimensions.role).toContain("manager")
    const manager = d.states.find((s: { dims?: Record<string, string> }) => s.dims?.role === "manager")
    expect(manager.url).toBe("/?role=manager&state=loaded")
    expect(manager.key).toBe("dashboard?role=manager&state=loaded")
  })

  it("returns null for an unknown screen and never changes the manifest it reads", () => {
    const m = structuredClone(NAMED)
    expect(showPage(m, "nope")).toBeNull()
    listPages(m)
    expect(m).toEqual(NAMED)
  })
})

describe("validate: fidelity summary", () => {
  it("counts each rung in ladder order, unset last", () => {
    expect(fidelitySummary([{ fidelity: "interactive" }, { fidelity: "static" }, {}, { fidelity: "static" }])).toBe(
      "fidelity: 2 static · 1 interactive · 1 not set"
    )
    expect(fidelitySummary([])).toBe("fidelity: no screens")
  })
})
