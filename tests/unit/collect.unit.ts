import { describe, it, expect } from "vitest"
import { collectStates } from "../../scripts/lib/collect.mjs"
import { instanceKey, normalizeManifest, snapshotStem, variantKey, variantStem } from "../../scripts/lib/model.mjs"

const manifest = () =>
  ({
    version: "0.3",
    product: { name: "T" },
    pages: [
      {
        id: "contacts",
        label: "Contacts",
        states: [
          { id: "loaded", url: "/contacts" },
          { id: "empty", url: "/contacts?empty=1" },
          { id: "error", url: "/contacts?error=1", hidden: true },
        ],
        annotations: [{ target: "FilterMenu", title: "Filter", note: "" }],
      },
      {
        id: "detail",
        label: "Detail",
        url: "/detail?role={role}",
        dimensions: { role: ["admin", "viewer"] },
        defaults: { role: "admin" },
        instances: [{ dims: { role: "admin" } }, { dims: { role: "viewer" } }],
      },
    ],
    scenarios: [{ id: "flow-a", label: "A", steps: [{ page: "contacts", state: "empty", title: "Empty", target: "EmptyMsg" }, { page: "detail", dims: { role: "viewer" }, title: "Detail" }] }],
    notes: [{ id: "n1", page: "detail", text: "hi", target: "Header" }],
  }) as any

const board = (items: any[]) => ({ id: "b", board: { title: "B", items } })

describe("collectStates", () => {
  it("collects pinned instances, scenario steps and notes without boards", () => {
    const { states } = collectStates(manifest(), [])
    expect([...states.keys()].sort()).toEqual(["contacts?_state=empty", "contacts?_state=loaded", "detail?role=admin", "detail?role=viewer"].sort())
    // hidden states are not pinned, so they are not captured unless something refers to them
    expect(states.has("contacts?_state=error")).toBe(false)
    const empty = states.get("contacts?_state=empty")!
    expect([...empty.required]).toEqual(["EmptyMsg"])
    expect([...empty.strict]).toEqual(["EmptyMsg"])
    expect([...empty.optional]).toEqual(["FilterMenu"])
    expect([...states.get("detail?role=admin")!.required]).toEqual(["Header"])
  })

  it("collects screen items: a plain state, a crop, actions, a viewport; recursing into sections", () => {
    const { states, warnings } = collectStates(manifest(), [
      board([
        { id: "a", type: "screen", screen: "contacts", state: "error" },
        { id: "b", type: "screen", screen: "contacts", state: "loaded", crop: "FilterMenu", do: [{ click: "Filter" }] },
        {
          id: "sec",
          type: "section",
          title: "S",
          items: [{ id: "c", type: "screen", screen: "contacts", state: "empty", viewport: { width: 390, height: 844 } }],
        },
      ]),
    ])
    expect(states.has("contacts?_state=error")).toBe(true)
    const crop = states.get("contacts?_state=loaded#crop=FilterMenu&do=click:Filter")!
    expect(crop.variant).toEqual({ crop: "FilterMenu", do: [{ click: "Filter" }] })
    expect(crop.required.has("FilterMenu")).toBe(true)
    expect(states.has("contacts?_state=empty#vp=390x844")).toBe(true)
    // the plain states are still there
    expect(states.has("contacts?_state=loaded")).toBe(true)
    expect(warnings).toEqual([])
  })

  it("collects every listed state of a states item, with the crop", () => {
    const { states } = collectStates(manifest(), [board([{ id: "s", type: "states", screen: "contacts", states: ["loaded", "error"], crop: "FilterMenu" }])])
    expect(states.has("contacts?_state=loaded#crop=FilterMenu")).toBe(true)
    expect(states.has("contacts?_state=error#crop=FilterMenu")).toBe(true)
    expect(states.has("contacts?_state=empty#crop=FilterMenu")).toBe(false)
  })

  it("resolves instance indexes and defaults on dimension pages", () => {
    const { states } = collectStates(manifest(), [board([{ id: "s", type: "states", screen: "detail", crop: "Header" }, { id: "d", type: "screen", screen: "detail" }])])
    expect(states.has("detail?role=admin#crop=Header")).toBe(true)
    expect(states.has("detail?role=viewer#crop=Header")).toBe(true)
    expect(states.has("detail?role=admin")).toBe(true)
  })

  it("collects a flow item's steps", () => {
    const m = manifest()
    m.scenarios.push({ id: "flow-b", label: "B", steps: [{ page: "contacts", state: "error", title: "x" }] })
    const { states } = collectStates(m, [board([{ id: "f", type: "flow", flow: "flow-b" }])])
    expect(states.has("contacts?_state=error")).toBe(true)
  })

  it("warns about unknown references instead of throwing", () => {
    const { warnings } = collectStates(manifest(), [
      board([
        { id: "a", type: "screen", screen: "nope" },
        { id: "b", type: "states", screen: "contacts", states: ["ghost"] },
        { id: "c", type: "flow", flow: "ghost-flow" },
      ]),
    ])
    expect(warnings).toHaveLength(3)
  })

  it("--only restricts to one page", () => {
    const { states } = collectStates(manifest(), [board([{ id: "a", type: "screen", screen: "contacts", state: "error" }])], { only: "detail" })
    expect([...states.keys()].every((k) => k.startsWith("detail?"))).toBe(true)
  })

  it("keys match what the viewer computes (model.mjs), so scan and viewer agree", () => {
    const m = normalizeManifest(manifest())
    const page = m.pages[0]
    const { states } = collectStates(m, [board([{ id: "b", type: "screen", screen: "contacts", state: "loaded", crop: "FilterMenu" }])])
    const s = states.get(variantKey("contacts", { _state: "loaded" }, { crop: "FilterMenu" }))!
    expect(s.stem).toBe(variantStem(page, { _state: "loaded" }, { crop: "FilterMenu" }))
    expect(states.get(instanceKey("contacts", { _state: "loaded" }))!.stem).toBe(snapshotStem(page, { _state: "loaded" }))
  })
})

describe("variantKey / variantStem stability", () => {
  const page = normalizeManifest(manifest()).pages[0]
  const dims = { _state: "loaded" }

  it("never changes for a given variant (keys are stored in index.json and in boards)", () => {
    expect(variantKey("contacts", dims, { crop: "FilterMenu", do: [{ click: "Filter" }] })).toBe("contacts?_state=loaded#crop=FilterMenu&do=click:Filter")
    expect(variantKey("contacts", dims, { viewport: { width: 390, height: 844 } })).toBe("contacts?_state=loaded#vp=390x844")
    expect(variantKey("contacts", dims, {})).toBe(instanceKey("contacts", dims))
    expect(variantStem(page, dims, {})).toBe(snapshotStem(page, dims))
    expect(snapshotStem(page, dims)).toBe("contacts__state=loaded")
  })

  it("is deterministic and distinguishes variants", () => {
    const a = variantStem(page, dims, { crop: "FilterMenu" })
    expect(variantStem(page, dims, { crop: "FilterMenu" })).toBe(a)
    expect(variantStem(page, dims, { crop: "Other" })).not.toBe(a)
    expect(variantStem(page, dims, { crop: "FilterMenu", do: [{ hover: "X" }] })).not.toBe(a)
    expect(a).toMatch(/^contacts__state=loaded__v[a-z0-9]+$/)
  })

  it("stems are filesystem-safe even for odd targets", () => {
    expect(variantStem(page, dims, { crop: "[data-x='a b']/c", do: [{ type: "q?", into: "#s" }] })).toMatch(/^[\w=.-]+$/)
  })
})
