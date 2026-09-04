import { describe, it, expect } from "vitest"
import {
  getPage,
  dimsFromParams,
  isWorkspaceDim,
  workspaceDimensions,
  workspaceDimsFromParams,
  workspaceCarry,
  workspaceOverridesFor,
  pageInWorkspace,
  scenarioInWorkspace,
} from "../../src/stavy/manifest"
import { setManifest } from "../../src/stavy/manifest"
import raw from "../../stavy.json"
import type { Manifest, PageDef, Scenario } from "../../src/stavy/types"

// The viewer loads the manifest at runtime; tests install the demo one directly.
setManifest(raw as unknown as Manifest)

/* The reference manifest declares exactly one workspace-scoped axis (locale),
   which the module-level helpers read. The pure predicates below are exercised
   against synthetic pages so they don't depend on the demo's page list. */

const page = (dimensions: Record<string, string[]>): PageDef =>
  ({ id: "p", label: "P", url: "/p", dimensions }) as PageDef

describe("workspace dimensions: manifest wiring", () => {
  it("picks up the axes declared scope: workspace", () => {
    expect(workspaceDimensions.map((d) => d.id)).toEqual(["locale"])
    expect(isWorkspaceDim("locale")).toBe(true)
    expect(isWorkspaceDim("state")).toBe(false)
  })

  it("falls back to the first value, and ignores a value that isn't declared", () => {
    expect(workspaceDimsFromParams(new URLSearchParams())).toEqual({ locale: "en-US" })
    expect(workspaceDimsFromParams(new URLSearchParams("d_locale=de-DE"))).toEqual({ locale: "de-DE" })
    expect(workspaceDimsFromParams(new URLSearchParams("d_locale=klingon"))).toEqual({ locale: "en-US" })
  })

  it("carries only non-default values, so links stay clean", () => {
    expect(workspaceCarry(new URLSearchParams())).toEqual({})
    expect(workspaceCarry(new URLSearchParams("d_locale=de-DE"))).toEqual({ d_locale: "de-DE" })
  })

  it("beats the page's own default when resolving a page's dims", () => {
    const detail = getPage("expense-detail")!
    expect(dimsFromParams(detail, new URLSearchParams("d_locale=de-DE")).locale).toBe("de-DE")
    expect(dimsFromParams(detail, new URLSearchParams()).locale).toBe("en-US")
  })

  it("leaves page-scoped axes alone", () => {
    const detail = getPage("expense-detail")!
    expect(dimsFromParams(detail, new URLSearchParams("d_lifecycle=approved")).lifecycle).toBe("approved")
    expect(dimsFromParams(detail, new URLSearchParams()).lifecycle).toBe("submitted")
  })
})

describe("workspace dimensions: scope predicates", () => {
  const wdims = { phase: "p1" }

  it("leaves a page that doesn't declare the axis in scope", () => {
    expect(pageInWorkspace(page({ state: ["loaded"] }), wdims)).toBe(true)
  })

  it("keeps a page that declares the active value", () => {
    expect(pageInWorkspace(page({ phase: ["p1", "p2"] }), wdims)).toBe(true)
  })

  it("drops a page that declares the axis but not the active value", () => {
    expect(pageInWorkspace(page({ phase: ["p2"] }), wdims)).toBe(false)
  })

  it("only seeds the workspace values a page actually supports", () => {
    expect(workspaceOverridesFor(page({ phase: ["p1", "p2"] }), wdims)).toEqual({ phase: "p1" })
    expect(workspaceOverridesFor(page({ phase: ["p2"] }), wdims)).toEqual({})
    expect(workspaceOverridesFor(page({ state: ["loaded"] }), wdims)).toEqual({})
  })

  it("drops a scenario whose step pins another value", () => {
    const sc = { id: "s", label: "S", steps: [{ page: "expense-detail", title: "x", dims: { locale: "de-DE" } }] } as Scenario
    expect(scenarioInWorkspace(sc, { locale: "de-DE" })).toBe(true)
    expect(scenarioInWorkspace(sc, { locale: "en-US" })).toBe(false)
  })

  it("keeps a scenario whose steps pin nothing on the axis", () => {
    const sc = { id: "s", label: "S", steps: [{ page: "expense-detail", title: "x" }] } as Scenario
    expect(scenarioInWorkspace(sc, { locale: "de-DE" })).toBe(true)
  })
})
