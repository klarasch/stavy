import { describe, it, expect } from "vitest"
import { boardToItem, migrate, noteToItem, pageToStates } from "../../scripts/migrate.mjs"

const legacy = () =>
  ({
    version: "0.2",
    product: { name: "T" },
    dimensions: [],
    scenarios: [{ id: "sc", label: "S", steps: [{ page: "list", dims: { role: "admin" }, title: "x" }, { page: "list", title: "y" }] }],
    pages: [
      {
        id: "list",
        label: "List",
        url: "/list?role={role}&state={state}",
        dimensions: { role: ["admin", "viewer"], state: ["loaded", "empty"] },
        defaults: { role: "admin", state: "loaded" },
        instances: [{ dims: { role: "admin" }, note: "default" }, { dims: { role: "viewer", state: "empty" } }],
      },
    ],
    boards: [
      { id: "ia", title: "IA", description: "map", kind: "mermaid", source: "graph TD; A-->B", width: 600 },
      { id: "fig", title: "Figure", kind: "image", source: "/figures/x.png", page: "list", callouts: [{ x: 0.1, y: 0.2, title: "One" }] },
      { id: "txt", title: "Text", kind: "text", source: "# Hello" },
    ],
    notes: [{ id: "n1", text: "Check this", page: "list", dims: { role: "admin" }, target: "Header", placement: "right" }],
  }) as any

describe("migrate: legacy boards and notes", () => {
  it("maps each board kind to its item type", () => {
    const m = legacy()
    expect(boardToItem(m.boards[0])).toEqual({ id: "ia", title: "IA", note: "map", w: 600, type: "mermaid", code: "graph TD; A-->B" })
    expect(boardToItem(m.boards[1])).toMatchObject({ type: "image", src: "/figures/x.png", alt: "Figure", page: "list", callouts: [{ x: 0.1, y: 0.2, title: "One" }] })
    expect(boardToItem(m.boards[2])).toEqual({ id: "txt", title: "Text", type: "markdown", md: "# Hello" })
    expect(noteToItem(m.notes[0])).toEqual({ id: "n1", type: "note", text: "Check this", screen: "list", dims: { role: "admin" }, target: "Header", placement: "right" })
  })

  it("builds the legacy board, registers it, and removes boards[] and notes[]", () => {
    const r = migrate(legacy())
    expect(r.board.items.map((i: any) => [i.id, i.type])).toEqual([
      ["ia", "mermaid"],
      ["fig", "image"],
      ["txt", "markdown"],
      ["n1", "note"],
    ])
    expect(r.index).toEqual({ boards: [{ id: "legacy", title: r.board.title, description: expect.any(String) }], docs: [] })
    expect(r.manifest.boards).toBeUndefined()
    expect(r.manifest.notes).toBeUndefined()
    expect(r.manifest.pages).toEqual(legacy().pages) // pages untouched without --states
    expect(r.changed).toBe(true)
  })

  it("does not mutate its input", () => {
    const m = legacy()
    migrate(m, { statesPage: "list" })
    expect(m).toEqual(legacy())
  })

  it("is idempotent: a second run on the result changes nothing", () => {
    const first = migrate(legacy())
    const second = migrate(first.manifest, { board: first.board, index: first.index })
    expect(second.changed).toBe(false)
    expect(second.board.items).toHaveLength(4)
    expect(second.index.boards).toHaveLength(1)
  })

  it("keeps existing index entries and avoids id collisions with items already on the board", () => {
    const r = migrate(legacy(), {
      index: { boards: [{ id: "mine", title: "Mine" }], docs: [{ id: "d", title: "D" }] },
      board: { title: "Legacy", items: [{ id: "ia", type: "note", text: "unrelated" }] },
    })
    expect(r.index.boards.map((b: any) => b.id)).toEqual(["mine", "legacy"])
    expect(r.index.docs).toHaveLength(1)
    expect(r.board.items.map((i: any) => i.id)).toContain("ia-2")
  })

  it("reports nothing to do for a 0.3 manifest", () => {
    const m = legacy()
    delete m.boards
    delete m.notes
    expect(migrate(m).changed).toBe(false)
  })
})

describe("migrate --states", () => {
  it("turns pinned instances into named states with their urls", () => {
    const page = legacy().pages[0]
    const { states, idFor } = pageToStates(page)
    expect(states).toEqual([
      { id: "admin-loaded", label: "admin · loaded", url: "/list?role=admin&state=loaded", note: "default" },
      { id: "viewer-empty", label: "viewer · empty", url: "/list?role=viewer&state=empty" },
    ])
    expect(idFor({ role: "viewer", state: "empty" })).toBe("viewer-empty")
    expect(idFor({})).toBe("admin-loaded") // resolves defaults
  })

  it("rewrites the page, scenario steps and notes to state references", () => {
    const r = migrate(legacy(), { statesPage: "list" })
    const page = r.manifest.pages[0]
    expect(page.states).toHaveLength(2)
    for (const k of ["url", "dimensions", "defaults", "instances"]) expect(page[k]).toBeUndefined()
    expect(r.manifest.scenarios[0].steps.map((s: any) => [s.state, s.dims])).toEqual([
      ["admin-loaded", undefined],
      ["admin-loaded", undefined],
    ])
    const note = r.board.items.find((i: any) => i.id === "n1")
    expect(note.state).toBe("admin-loaded")
    expect(note.dims).toBeUndefined()
  })

  it("explains instead of failing for an unknown page", () => {
    expect(migrate(legacy(), { statesPage: "ghost" }).summary.join("\n")).toContain('no page "ghost"')
  })
})
