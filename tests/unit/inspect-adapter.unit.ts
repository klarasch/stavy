import { describe, it, expect, vi } from "vitest"
import {
  matchedDeclarations,
  resolveVarChain,
  provenanceFor,
  specificity,
  rootCustomProperties,
  documentDeclaresToken,
  pixelTokens,
  primaryFontFamily,
} from "../../src/stavy/inspect/cssom"
import { reactComponentStack } from "../../src/stavy/inspect/react"
import { matchTypeScale, cssVariablesDesignSystem } from "../../src/stavy/inspect/design-system"
import { compileInspectConfig, isConfigured } from "../../src/stavy/inspect/config"
import { anonymous, doc, elements, fiberChain, group, imported, named, node, rule, type FakeDocument, type FakeElement, type FakeFiber } from "./fixtures/fake-dom"

/**
 * The inspector, exercised the way an adopter should exercise their own
 * adapter: fixtures for a fictional design system called Acme — components
 * named `Ac*`, tokens under `--acme-`, private primitives under `--acme-_`,
 * component roots stamped with `AcName-module_local__hash` — and no browser.
 *
 * Copy this file and `fixtures/fake-dom.ts`, swap the fixtures for your own,
 * and you have a regression suite for your design system's provenance.
 */

const ACME = {
  kits: [{ name: "Acme", componentPrefix: "Ac", classPattern: "^(Ac[A-Z]\\w*)-module_" }],
  tokenPattern: "^--acme-(?!_)",
  privateTokenPattern: "^--acme-_",
  typeScale: [
    { name: "body", family: "Inter", size: 14, weight: 400, lineHeight: 1.5 },
    { name: "body-bold", family: "Inter", size: 14, weight: 700, lineHeight: 1.4 },
    { name: "heading-5", family: "Inter", size: 14, weight: 700, lineHeight: 1.4 },
    { name: "code", family: "IBM Plex Mono", size: 12, weight: 400, lineHeight: 1.5 },
  ],
}
const acmeConfig = compileInspectConfig(ACME)
const patterns = { token: acmeConfig.tokenPattern, private: acmeConfig.privateTokenPattern }

/** `doc` + a chain of elements in one call; returns the innermost element. */
function fixture(rules: Parameters<typeof doc>[0], chain: Parameters<typeof elements>[1]): { d: FakeDocument; els: FakeElement[]; el: FakeElement } {
  const d = doc(rules)
  const els = elements(d, chain)
  return { d, els, el: els[els.length - 1] }
}

const as = <T>(x: unknown) => x as T
const el = (x: FakeElement) => as<Element>(x)
const document_ = (x: FakeDocument) => as<Document>(x)

/* ================================================================== */

describe("specificity", () => {
  it("counts ids, classes and elements separately", () => {
    expect(specificity("div")).toEqual([0, 0, 1])
    expect(specificity(".btn")).toEqual([0, 1, 0])
    expect(specificity("#main .btn span")).toEqual([1, 1, 1])
  })
  it("counts an attribute selector and a pseudo-class with the classes", () => {
    expect(specificity('button[type="submit"]:hover')).toEqual([0, 2, 1])
  })
  it("counts a pseudo-element as an element, not a pseudo-class", () => {
    expect(specificity(".btn::before")).toEqual([0, 1, 1])
  })
})

describe("the stylesheet walk", () => {
  it("yields a plain rule even though CSS nesting gives every style rule a cssRules list", () => {
    // The bug this guards: a walker that tests `cssRules` first treats every
    // plain rule as a grouping rule and yields nothing at all.
    const { el: button } = fixture(
      [rule(".btn", { color: "red" }, [rule(".btn .icon", { color: "blue" })])],
      [{ tag: "button", class: "btn" }]
    )
    expect(matchedDeclarations(el(button), "color")[0].value).toBe("red")
  })

  it("finds a declaration nested inside a style rule", () => {
    const { el: icon } = fixture(
      [rule(".btn", { color: "red" }, [rule(".btn .icon", { color: "blue" })])],
      [{ tag: "button", class: "btn" }, { tag: "span", class: "icon" }]
    )
    expect(matchedDeclarations(el(icon), "color")[0].value).toBe("blue")
  })

  it("recurses into grouping rules and @import", () => {
    const { el: button } = fixture(
      [imported([rule(".btn", { color: "grey" })]), group([group([rule(".btn", { color: "green" })])])],
      [{ tag: "button", class: "btn" }]
    )
    const values = matchedDeclarations(el(button), "color").map((d) => d.value)
    expect(values).toEqual(["green", "grey"]) // same specificity, later source wins
  })
})

describe("the cascade", () => {
  it("orders by !important, then inline, then specificity, then source order", () => {
    const { el: button } = fixture(
      [
        rule("button", { color: "tag" }),
        rule(".btn", { color: "class" }),
        rule("#go", { color: "id" }),
        rule(".btn", { color: "shouted !important" }),
      ],
      [{ tag: "button", class: "btn", id: "go", style: { color: "inline" } }]
    )
    expect(matchedDeclarations(el(button), "color").map((d) => d.value)).toEqual(["shouted", "inline", "id", "class", "tag"])
  })

  it("counts a comma branch that matches even when a sibling branch does not", () => {
    const { el: button } = fixture([rule(".nope, .btn", { color: "red" })], [{ tag: "button", class: "btn" }])
    expect(matchedDeclarations(el(button), "color")[0].value).toBe("red")
  })

  it("skips a selector branch the browser cannot parse rather than the whole rule", () => {
    const { el: button } = fixture([rule("::-vendor-thing, .btn", { color: "red" })], [{ tag: "button", class: "btn" }])
    expect(matchedDeclarations(el(button), "color")[0].value).toBe("red")
  })

  it("falls back to the shorthand when the longhand is empty", () => {
    // `getPropertyValue("background-color")` is "" when the author wrote
    // `background: var(--acme-color-surface)`; provenance has to read the shorthand.
    const { el: card } = fixture(
      [rule(".card", { background: "var(--acme-color-surface)", border: "1px solid var(--acme-color-border)" })],
      [{ class: "card" }]
    )
    expect(matchedDeclarations(el(card), "background-color")[0]).toMatchObject({ value: "var(--acme-color-surface)", prop: "background" })
    expect(matchedDeclarations(el(card), "border-top-color")[0].prop).toBe("border")
  })
})

describe("resolving a value to a design token", () => {
  it("follows a var() chain through local variables to the first token", () => {
    const { el: button } = fixture(
      [rule(".AcButton-module_root__1a3", { "--btn-bg": "var(--acme-color-action-primary)", background: "var(--btn-bg)" })],
      [{ tag: "button", class: "AcButton-module_root__1a3" }]
    )
    const p = resolveVarChain(el(button), "background-color", patterns)
    expect(p).toMatchObject({ token: "--acme-color-action-primary", raw: "var(--btn-bg)" })
    expect(p!.chain).toEqual(["var(--btn-bg)", "var(--acme-color-action-primary)"])
  })

  it("looks a custom property up on ancestors, because custom properties inherit", () => {
    const { el: label } = fixture(
      [rule(".panel", { "--panel-fg": "var(--acme-color-text-primary)" }), rule(".label", { color: "var(--panel-fg)" })],
      [{ class: "panel" }, { tag: "span", class: "label" }]
    )
    expect(resolveVarChain(el(label), "color", patterns)!.token).toBe("--acme-color-text-primary")
  })

  it("reports a private primitive as such rather than as a token", () => {
    const { el: chip } = fixture([rule(".chip", { background: "var(--acme-_blue-500)" })], [{ class: "chip" }])
    expect(resolveVarChain(el(chip), "background-color", patterns)).toMatchObject({ token: null, note: "private token" })
  })

  it("with no token pattern, reports the deepest custom property in the chain", () => {
    // The no-configuration case: nothing to recognise, so the end of the chain
    // is the best answer available — and usually the right one.
    const { el: button } = fixture(
      [rule(".btn", { "--btn-bg": "var(--brand-blue)", background: "var(--btn-bg)" })],
      [{ tag: "button", class: "btn" }]
    )
    expect(resolveVarChain(el(button), "background-color", {})!.token).toBe("--brand-blue")
  })

  it("gives up rather than looping on a self-referential variable", () => {
    const { el: x } = fixture([rule(".x", { "--a": "var(--b)", "--b": "var(--a)", color: "var(--a)" })], [{ class: "x" }])
    expect(resolveVarChain(el(x), "color", patterns)!.token).toBeNull()
  })

  it("is null when nothing declares the property at all", () => {
    const { el: x } = fixture([rule(".other", { color: "red" })], [{ class: "x" }])
    expect(resolveVarChain(el(x), "color", patterns)).toBeNull()
  })

  it("names the ancestor an inherited value comes from", () => {
    const { els } = fixture(
      [rule(".panel", { color: "var(--acme-color-text-primary)" })],
      [{ class: "panel" }, { tag: "span", class: "label" }]
    )
    const p = provenanceFor(el(els[1]), "color", patterns, true)
    expect(p).toMatchObject({ token: "--acme-color-text-primary" })
    expect(p!.inheritedFrom).toBe(els[0])
  })

  it("does not walk ancestors for a property that does not inherit", () => {
    const { els } = fixture([rule(".panel", { background: "var(--acme-color-surface)" })], [{ class: "panel" }, { class: "label" }])
    expect(provenanceFor(el(els[1]), "background-color", patterns, false)).toBeNull()
  })
})

describe("the token catalog at the document root", () => {
  const rules = [
    rule(":root", { "--acme-color-action-primary": "#1c64f2", "--acme-spacing-2": "8px", "--acme-radius-s": "4px", "--acme-_blue-500": "#1c64f2" }),
    rule("html[data-theme=\"dark\"]", { "--acme-color-action-primary": "#3f83f8" }),
    rule(".btn", { "--not-a-root-token": "1px" }),
  ]

  it("collects custom properties declared on the root", () => {
    const names = [...rootCustomProperties(document_(doc(rules))).keys()]
    expect(names).toContain("--acme-color-action-primary")
    expect(names).not.toContain("--not-a-root-token")
  })

  it("detects the design system from one of its own tokens", () => {
    expect(documentDeclaresToken(document_(doc(rules)), /^--acme-/)).toBe(true)
    expect(documentDeclaresToken(document_(doc(rules)), /^--other-/)).toBe(false)
  })

  it("discovers pixel-valued spacing tokens instead of hardcoding a scale", () => {
    const tokens = pixelTokens(document_(doc(rules)), /^--acme-(spacing|radius)-/)
    expect([...tokens]).toEqual([["--acme-spacing-2", 8], ["--acme-radius-s", 4]])
  })

  it("names a spacing value through the configured design system", () => {
    const ds = cssVariablesDesignSystem({ ...acmeConfig, spacingTokenPattern: /^--acme-(spacing|radius)-/ })
    expect(ds.spacingToken(document_(doc(rules)), 8)).toBe("--acme-spacing-2")
    expect(ds.spacingToken(document_(doc(rules)), 7)).toBeNull() // off-scale is itself information
  })
})

describe("typography by metrics", () => {
  const scale = acmeConfig.typeScale
  const metrics = (size: number, weight: number, lineHeight: number | null, family = "Inter") => ({ family, size, weight, lineHeight })

  it("names a scale entry from computed metrics", () => {
    expect(matchTypeScale(scale, metrics(14, 400, 21), false)).toBe("body")
  })
  it("tolerates the browser's rounding of a line-height ratio", () => {
    expect(matchTypeScale(scale, metrics(12, 400, 17.98, "IBM Plex Mono"), false)).toBe("code")
  })
  it("breaks a metric tie on whether the element is a heading", () => {
    expect(matchTypeScale(scale, metrics(14, 700, 19.6), false)).toBe("body-bold")
    expect(matchTypeScale(scale, metrics(14, 700, 19.6), true)).toBe("heading-5")
  })
  it("does not match when the line-height is `normal` — a declared scale always sets one", () => {
    expect(matchTypeScale(scale, metrics(14, 400, null), false)).toBeNull()
  })
  it("does not match another family at the same size", () => {
    expect(matchTypeScale(scale, metrics(14, 400, 21, "Helvetica"), false)).toBeNull()
  })
  it("matches against the family that actually renders, not the whole stack", () => {
    expect(primaryFontFamily('"Inter", system-ui, sans-serif')).toBe("Inter")
  })
})

describe("naming components a kit left anonymous", () => {
  const kits = acmeConfig.kits.concat([{ name: "Sys", componentPrefix: "Sys" }])

  /**
   * The shape that defeats a naive walk: `AcButton` is
   * `forwardRef((props, ref) => …)` with no name, and it hands the class it
   * stamps down to a *named* primitive. Look for the class below a fiber and
   * stop at the first named child and the wrapper is lost; search the whole
   * subtree and a page-level fiber gets credited with a deep button's class.
   */
  function acmeButtonInATable() {
    const host = node(["base-Button-root", "AcButton-module_root-primary__9f2", "AcButton-module_root__1a3"])
    const hostFiber: FakeFiber = { tag: 5, stateNode: host }
    const primitive: FakeFiber = { tag: 0, type: named("Button"), memoizedProps: { className: host.classList.join(" ") } }
    const acButton: FakeFiber = { tag: 15, type: anonymous(), memoizedProps: { variant: "primary", testId: "create-role" } }
    const sysRenderer: FakeFiber = { tag: 0, type: named("SysTableHeaderRenderer"), memoizedProps: {} }
    const rolesTab: FakeFiber = { tag: 0, type: named("RolesTab"), memoizedProps: {} }
    // Not a DOM ancestor: a render-prop callback runs during its caller's
    // render, so this is only reachable through `_debugOwner`.
    const sysTable: FakeFiber = { tag: 0, type: named("SysTable"), memoizedProps: {} }
    const el = fiberChain([hostFiber, primitive, acButton, sysRenderer, rolesTab], [undefined, acButton, sysRenderer, sysTable, null])
    return { el, host }
  }

  it("finds the anonymous kit component, not the primitive it wraps", () => {
    const { el } = acmeButtonInATable()
    expect(reactComponentStack(el as unknown as Element, "", kits).map((f) => f.name)).toEqual([
      "Button",
      "AcButton",
      "SysTableHeaderRenderer",
      "RolesTab",
    ])
  })

  it("gives that component its own props, not the caller's", () => {
    const { el } = acmeButtonInATable()
    const frame = reactComponentStack(el as unknown as Element, "", kits).find((f) => f.name === "AcButton")
    expect(frame?.props).toEqual({ variant: "primary", testId: "create-role" })
    expect(frame?.kit).toBe("Acme")
  })

  it("collapses a kit's own internals but keeps a component a different kit rendered", () => {
    const { el } = acmeButtonInATable()
    const stack = reactComponentStack(el as unknown as Element, "", kits)
    const internal = stack.filter((f) => f.internal).map((f) => f.name)
    expect(internal).toEqual(["Button", "SysTableHeaderRenderer"])
    // AcButton was created inside a Sys render, so it is still something a person wrote.
    expect(stack.find((f) => f.name === "AcButton")?.internal).toBe(false)
    expect(stack.find((f) => f.name === "RolesTab")?.internal).toBe(false)
  })

  it("does not rename a named component after the kit component it happens to render", () => {
    const host = node(["AcCard-module_root__77b"])
    const hostFiber: FakeFiber = { tag: 5, stateNode: host }
    const acCard: FakeFiber = { tag: 15, type: anonymous(), memoizedProps: {} }
    const summary: FakeFiber = { tag: 0, type: named("ExpenseSummary"), memoizedProps: {} }
    const el = fiberChain([hostFiber, acCard, summary])
    expect(reactComponentStack(el as unknown as Element, "", kits).map((f) => f.name)).toEqual(["AcCard", "ExpenseSummary"])
  })

  it("marks nothing internal when the workspace declared no kit", () => {
    const { el } = acmeButtonInATable()
    const stack = reactComponentStack(el as unknown as Element, "", [])
    expect(stack.map((f) => f.name)).toEqual(["Button", "SysTableHeaderRenderer", "RolesTab"]) // the anonymous one has no name to give
    expect(stack.every((f) => f.internal === undefined)).toBe(true)
  })

  it("stops at `stopAt`", () => {
    const { el } = acmeButtonInATable()
    expect(reactComponentStack(el as unknown as Element, "SysTableHeaderRenderer", kits).map((f) => f.name)).toEqual(["Button", "AcButton"])
  })
})

describe("compiling viewer.inspect", () => {
  it("compiles the regex fields once and keeps the rest as data", () => {
    expect(acmeConfig.tokenPattern?.source).toBe("^--acme-(?!_)")
    expect(acmeConfig.kits[0]).toMatchObject({ name: "Acme", componentPrefix: "Ac" })
    expect(acmeConfig.kits[0].classPattern?.exec("AcButton-module_root__1a3")?.[1]).toBe("AcButton")
    expect(acmeConfig.typeScale).toHaveLength(4)
  })

  it("warns once about an invalid pattern and ignores it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const cfg = compileInspectConfig({ tokenPattern: "^--acme-(", kits: [{ name: "Acme", classPattern: "[" }] })
    expect(cfg.tokenPattern).toBeNull()
    expect(cfg.kits[0].classPattern).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2) // one per bad pattern, not one per use
    warn.mockRestore()
  })

  it("drops type-scale entries that are not fully specified", () => {
    const cfg = compileInspectConfig({ typeScale: [{ name: "body" } as never, { name: "ok", family: "Inter", size: 14, weight: 400, lineHeight: 1.5 }] })
    expect(cfg.typeScale.map((e) => e.name)).toEqual(["ok"])
  })

  it("defaults the component attributes and reports an empty config as unconfigured", () => {
    const empty = compileInspectConfig(undefined)
    expect(empty.componentAttrs).toEqual(["data-slot", "data-component"])
    expect(isConfigured(empty)).toBe(false)
    expect(isConfigured(acmeConfig)).toBe(true)
  })
})

describe("choosing a design system per document", () => {
  it("recognises its own document and stays out of another one", () => {
    const ds = cssVariablesDesignSystem(acmeConfig)
    expect(ds.detect(document_(doc([rule(":root", { "--acme-color-text-primary": "#111" })])))).toBe(true)
    expect(ds.detect(document_(doc([rule(":root", { "--other-color": "#111" })])))).toBe(false)
  })

  it("labels a stamped class by component and part, hiding the hash", () => {
    const ds = cssVariablesDesignSystem(acmeConfig)
    expect(ds.classLabel("AcButton-module_root-primary__9f2")).toMatchObject({ label: "AcButton/root-primary", kind: "kit" })
    expect(ds.classLabel("some-app-class")).toMatchObject({ label: "some-app-class", kind: "other" })
  })
})
