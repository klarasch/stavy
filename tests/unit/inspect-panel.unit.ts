import { describe, it, expect, vi } from "vitest"
import { compileInspectConfig, compilePanel, kebab, linksFor, BUILTIN_SECTIONS } from "../../src/stavy/inspect/config"
import { reactComponentStack, DEFAULT_INTERNALS } from "../../src/stavy/inspect/react"
import { redlines } from "../../src/stavy/inspect/measure"
import { checkApiVersion, INSPECT_API_VERSION } from "../../src/stavy/inspect-adapter"
import { fiberChain, named, node, type FakeFiber } from "./fixtures/fake-dom"

/**
 * `viewer.inspect.panel` and `viewer.inspect.internals`: the data a team
 * writes to shape the inspector for its design system, and the redlines the
 * panel draws. The shapes here are the contract an adapter relies on across
 * releases — see "Testing your adapter on a new Stavy release" in
 * docs/INSPECT-ADAPTERS.md.
 */

describe("viewer.inspect.panel", () => {
  it("defaults to every built-in section, every copy button, no hidden props and no links", () => {
    const p = compilePanel(undefined)
    expect(p.sections).toBeNull()
    expect([...p.copy].sort()).toEqual(["class", "jsx", "token"])
    expect(p.hideProp("onClick")).toBe(false)
    expect(p.links).toEqual([])
    expect(BUILTIN_SECTIONS).toEqual(["component", "props", "tokens", "type", "spacing", "classes", "accessibility", "source", "url"])
  })

  it("keeps the declared section order and the copy formats it knows", () => {
    const p = compilePanel({ sections: ["type", "component", "acme-usage"], copy: ["token", "nope" as never] })
    expect(p.sections).toEqual(["type", "component", "acme-usage"])
    expect([...p.copy]).toEqual(["token"])
  })

  it("hides props by exact name or by /regex/", () => {
    const p = compilePanel({ hideProps: ["className", "/^on[A-Z]/", "/^data-/i"] })
    expect(p.hideProp("className")).toBe(true)
    expect(p.hideProp("onClick")).toBe(true)
    expect(p.hideProp("DATA-x")).toBe(true)
    expect(p.hideProp("variant")).toBe(false)
    expect(p.hideProp("one")).toBe(false)
  })

  it("warns about a bad hideProps regex and ignores it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const p = compilePanel({ hideProps: ["/(/"] })
    expect(p.hideProp("(")).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it("fills link templates per component, and leaves out a link whose placeholder has no value", () => {
    const p = compilePanel({
      links: [
        { label: "Docs", href: "https://ds.example.com/components/{kebab}" },
        { label: "Storybook", href: "https://sb.example.com/?path=/docs/{kit}-{name}", kit: "Acme" },
        { label: "Buttons", href: "https://ds.example.com/buttons#{name}", match: "Button$" },
      ],
    })
    expect(linksFor(p, { name: "AcIconButton", kit: "Acme" })).toEqual([
      { label: "Docs", href: "https://ds.example.com/components/ac-icon-button" },
      { label: "Storybook", href: "https://sb.example.com/?path=/docs/Acme-AcIconButton" },
      { label: "Buttons", href: "https://ds.example.com/buttons#AcIconButton" },
    ])
    // An app component: no kit, so the kit-only link is left out.
    expect(linksFor(p, { name: "ExpenseSummary" }).map((l) => l.label)).toEqual(["Docs"])
    expect(linksFor(p, null)).toEqual([])
  })

  it("kebab-cases component names", () => {
    expect(kebab("AcButton")).toBe("ac-button")
    expect(kebab("HTMLPreview")).toBe("html-preview")
    expect(kebab("Card2")).toBe("card2")
  })

  it("compiles as part of viewer.inspect", () => {
    const cfg = compileInspectConfig({ panel: { sections: ["component"] } })
    expect(cfg.panel?.sections).toEqual(["component"])
  })
})

describe("viewer.inspect.internals", () => {
  const stackOf = (names: string[], internals = DEFAULT_INTERNALS) => {
    const hostFiber: FakeFiber = { tag: 5, stateNode: node([]) }
    const fibers: FakeFiber[] = names.map((n) => ({ tag: 0, type: named(n), memoizedProps: {} }))
    const el = fiberChain([hostFiber, ...fibers])
    return reactComponentStack(el as unknown as Element, "", [], internals).map((f) => f.name)
  }

  it("drops today's framework plumbing by default", () => {
    expect(stackOf(["Slot", "ThemeProvider", "Card", "RenderedRoute", "Page"])).toEqual(["Card", "Page"])
  })

  it("adds a team's own plumbing patterns to the defaults", () => {
    const cfg = compileInspectConfig({ internals: { exclude: ["^Acme(Theme|Telemetry)"] } })
    expect(stackOf(["AcmeTelemetry", "Slot", "Card"], cfg.internals)).toEqual(["Card"])
  })

  it("replaces the defaults when keepDefaults is false", () => {
    const cfg = compileInspectConfig({ internals: { keepDefaults: false, exclude: ["^Card$"] } })
    expect(stackOf(["Slot", "Card"], cfg.internals)).toEqual(["Slot"])
  })

  it("treats a team's primitives as kit internals in a production build", () => {
    const cfg = compileInspectConfig({ kits: [{ name: "Acme", componentPrefix: "Ac" }], internals: { primitives: ["^Headless"] } })
    const hostFiber: FakeFiber = { tag: 5, stateNode: node([]) }
    const el = fiberChain([hostFiber, { tag: 0, type: named("HeadlessToggle"), memoizedProps: {} }, { tag: 0, type: named("AcSwitch"), memoizedProps: {} }])
    const stack = reactComponentStack(el as unknown as Element, "", cfg.kits, cfg.internals)
    expect(stack.map((f) => [f.name, f.internal])).toEqual([
      ["HeadlessToggle", true],
      ["AcSwitch", false],
    ])
  })
})

describe("adapter apiVersion", () => {
  it("accepts the current version and a module that predates the field", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(INSPECT_API_VERSION).toBe(1)
    expect(checkApiVersion("/a.js", 1)).toBe(true)
    expect(checkApiVersion("/a.js", undefined)).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    expect(checkApiVersion("/a.js", 2)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe("redlines", () => {
  const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height })

  it("measures a vertical gap between stacked boxes", () => {
    const lines = redlines(box(0, 0, 100, 20), box(0, 36, 100, 20))
    expect(lines).toEqual([expect.objectContaining({ dir: "v", value: 16, y1: 20, y2: 36 })])
  })

  it("measures a horizontal gap, in prototype px when the frame is scaled", () => {
    const lines = redlines(box(0, 0, 50, 50), box(74, 10, 50, 20), 0.75)
    expect(lines).toEqual([expect.objectContaining({ dir: "h", value: 32 })])
  })

  it("measures all four insets when one box contains the other", () => {
    const lines = redlines(box(0, 0, 200, 100), box(16, 8, 168, 84))
    expect(lines.map((l) => l.value).sort((a, b) => a - b)).toEqual([8, 8, 16, 16])
  })

  it("reports corresponding edges for a partial overlap", () => {
    const lines = redlines(box(0, 0, 100, 100), box(50, 40, 100, 100))
    expect(lines.map((l) => [l.dir, l.value])).toEqual([
      ["h", 50],
      ["v", 40],
    ])
  })
})
