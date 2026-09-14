import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { matchAppUrl, setManifest } from "../../src/stavy/manifest"
import type { Manifest, PageDef } from "../../src/stavy/types"

// matchAppUrl resolves relative hrefs against `location.origin` — the module
// assumes a browser. Stub it for this node test environment (only file that
// needs it, hence a local beforeAll/afterAll rather than a global setup).
beforeAll(() => {
  vi.stubGlobal("location", new URL("http://localhost/stavy/index.html"))
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const page = (id: string, url: string, dimensions: Record<string, string[]> = {}): PageDef =>
  ({ id, label: id, url, dimensions }) as PageDef

const install = (pages: PageDef[]) =>
  setManifest({
    version: "0.2",
    product: { name: "" },
    dimensions: [],
    pages,
    scenarios: [],
  } as unknown as Manifest)

describe("matchAppUrl: query placeholders", () => {
  it("matches a bare {dim} query value", () => {
    install([page("p", "/dashboards/edit?scene={step}", { step: ["simple", "advanced"] })])
    const m = matchAppUrl("/dashboards/edit?scene=advanced")
    expect(m?.page.id).toBe("p")
    expect(m?.dims.step).toBe("advanced")
  })

  it("matches a prefixed placeholder (simple-{step})", () => {
    install([page("p", "/dashboards/edit?scene=simple-{step}", { step: ["filter", "sort"] })])
    const m = matchAppUrl("/dashboards/edit?scene=simple-filter")
    expect(m?.page.id).toBe("p")
    expect(m?.dims.step).toBe("filter")
  })

  it("matches a placeholder with both a prefix and a suffix", () => {
    install([page("p", "/dashboards/edit?scene=simple-{step}-done", { step: ["filter", "sort"] })])
    const m = matchAppUrl("/dashboards/edit?scene=simple-sort-done")
    expect(m?.page.id).toBe("p")
    expect(m?.dims.step).toBe("sort")
  })

  it("returns null when the prefix doesn't match", () => {
    install([page("p", "/dashboards/edit?scene=simple-{step}", { step: ["filter", "sort"] })])
    expect(matchAppUrl("/dashboards/edit?scene=advanced-filter")).toBeNull()
  })

  it("falls through to the next page when an earlier one's prefix doesn't match", () => {
    install([
      page("simple", "/dashboards/edit?scene=simple-{step}", { step: ["filter", "sort"] }),
      page("advanced", "/dashboards/edit?scene=advanced-{step}", { step: ["filter", "sort"] }),
    ])
    const m = matchAppUrl("/dashboards/edit?scene=advanced-sort")
    expect(m?.page.id).toBe("advanced")
    expect(m?.dims.step).toBe("sort")
  })

  it("distinguishes two pages sharing a path by their query placeholder prefix", () => {
    install([
      page("simple", "/dashboards/edit?scene=simple-{step}", { step: ["filter"] }),
      page("advanced", "/dashboards/edit?scene=advanced-{step}", { step: ["filter"] }),
    ])
    expect(matchAppUrl("/dashboards/edit?scene=simple-filter")?.page.id).toBe("simple")
    expect(matchAppUrl("/dashboards/edit?scene=advanced-filter")?.page.id).toBe("advanced")
  })

  it("still requires a literal (non-placeholder) query value to match exactly", () => {
    install([page("p", "/dashboards/edit?mode=readonly", {})])
    expect(matchAppUrl("/dashboards/edit?mode=readonly")?.page.id).toBe("p")
    expect(matchAppUrl("/dashboards/edit?mode=edit")).toBeNull()
  })

  it("leaves the dim unset when its query param is absent from the url", () => {
    install([page("p", "/dashboards/edit?scene=simple-{step}", { step: ["filter", "sort"] })])
    const m = matchAppUrl("/dashboards/edit")
    expect(m?.page.id).toBe("p")
    // resolveDims falls back to the first declared value when unset.
    expect(m?.dims.step).toBe("filter")
  })

  it("rejects a value the page doesn't declare for that dim", () => {
    install([page("p", "/dashboards/edit?scene=simple-{step}", { step: ["filter", "sort"] })])
    expect(matchAppUrl("/dashboards/edit?scene=simple-unknown")).toBeNull()
  })
})
