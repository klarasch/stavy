import { describe, it, expect } from "vitest"
import { setManifest, groupPages, varyingDims, varyingAcross } from "../../src/stavy/manifest"
import { scenarioEdges, edgePath } from "../../src/stavy/canvas/SiteMap"
import raw from "../../stavy.json"
import type { Manifest, PageDef, Scenario } from "../../src/stavy/types"

setManifest(raw as unknown as Manifest)

const page = (id: string, group?: string, dimensions: Record<string, string[]> = {}): PageDef =>
  ({ id, label: id, url: `/${id}`, group, dimensions }) as PageDef

const scenario = (id: string, label: string, pages: string[]): Scenario =>
  ({ id, label, steps: pages.map((p) => ({ page: p, title: p })) }) as Scenario

describe("sections", () => {
  it("clusters pages by group in first-appearance order, ungrouped last", () => {
    const out = groupPages([page("a", "Two"), page("b"), page("c", "One"), page("d", "Two")])
    expect(out.map((s) => [s.group, s.pages.map((p) => p.id)])).toEqual([
      ["Two", ["a", "d"]],
      ["One", ["c"]],
      [undefined, ["b"]],
    ])
  })

  it("keeps a fully ungrouped workspace as one unlabelled cluster", () => {
    expect(groupPages([page("a"), page("b")])).toEqual([{ pages: [page("a"), page("b")] }])
  })
})

describe("varying dimensions", () => {
  const p = page("p", undefined, { role: ["a", "b", "c"], state: ["x", "y"] })

  it("is empty when one instance is pinned — nothing to compare, nothing to label", () => {
    expect(varyingDims(p, [{ role: "a", state: "x" }])).toEqual([])
  })

  it("lists only the axis that differs, widest declared axis first", () => {
    expect(varyingDims(p, [{ role: "a", state: "x" }, { role: "b", state: "x" }])).toEqual(["role"])
    expect(varyingDims(p, [{ role: "a", state: "x" }, { role: "b", state: "y" }])).toEqual(["role", "state"])
  })

  it("across a scenario, reports what moves between steps", () => {
    expect(varyingAcross([{ role: "manager", lifecycle: "submitted" }, { role: "manager", lifecycle: "approved" }])).toEqual(["lifecycle"])
  })

  it("ignores workspace-scoped axes (locale is one in the demo manifest)", () => {
    expect(varyingAcross([{ locale: "en-US" }, { locale: "de-DE" }])).toEqual([])
  })
})

describe("site map edges", () => {
  const has = () => true

  it("derives one directed edge per page-to-page hop", () => {
    const edges = scenarioEdges([scenario("s", "S", ["a", "b", "c"])], has)
    expect(edges.map((e) => `${e.from}->${e.to}`)).toEqual(["a->b", "b->c"])
  })

  it("ignores steps that stay on the same page", () => {
    expect(scenarioEdges([scenario("s", "S", ["a", "a", "b"])], has).map((e) => `${e.from}->${e.to}`)).toEqual(["a->b"])
  })

  it("merges a hop several scenarios share into one arrow", () => {
    const edges = scenarioEdges([scenario("s1", "One", ["a", "b"]), scenario("s2", "Two", ["a", "b"])], has)
    expect(edges).toHaveLength(1)
    expect(edges[0].scenarios).toEqual(["One", "Two"])
  })

  it("drops hops to a page the map is not showing (out of workspace scope)", () => {
    expect(scenarioEdges([scenario("s", "S", ["a", "hidden", "b"])], (id) => id !== "hidden")).toEqual([])
  })

  it("routes a distant same-row hop under the row instead of through its neighbours", () => {
    const a = { x: 0, y: 0, w: 100, h: 60 }
    const far = { x: 500, y: 0, w: 100, h: 60 }
    const next = { x: 160, y: 0, w: 100, h: 60 }
    expect(edgePath(a, far).startsWith("M 50 60")).toBe(true)
    expect(edgePath(a, next).startsWith("M 100 30")).toBe(true)
  })
})
