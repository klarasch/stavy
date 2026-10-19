import { describe, expect, it } from "vitest"
import { arrowPath, balancedWidth, ensureIds, estimateSize, layoutBoard, mapItems, SECTION_COLLAPSED_H, SECTION_PAD, snap } from "../../src/stavy/boards/layout"
import type { BoardItem } from "../../src/stavy/types"

const note = (id: string, extra: Partial<BoardItem> = {}): BoardItem => ({ id, type: "note", text: id, ...extra }) as BoardItem
const sizes = (ids: string[], w = 100, h = 50) => Object.fromEntries(ids.map((id) => [id, { w, h }]))

describe("layoutBoard", () => {
  it("flows unplaced items in rows that wrap at maxWidth, in order", () => {
    const items = ["a", "b", "c", "d"].map((id) => note(id))
    const { local } = layoutBoard(items, sizes(["a", "b", "c", "d"]), { gap: 10, maxWidth: 320 })
    expect(local.a).toMatchObject({ x: 0, y: 0 })
    expect(local.b).toMatchObject({ x: 110, y: 0 })
    expect(local.c).toMatchObject({ x: 220, y: 0 })
    expect(local.d).toMatchObject({ x: 0, y: 60 })
  })

  it("aligns rows to the tallest item of the row above", () => {
    const items = ["a", "b", "c"].map((id) => note(id))
    const s = { a: { w: 100, h: 50 }, b: { w: 100, h: 200 }, c: { w: 100, h: 50 } }
    const { local } = layoutBoard(items, s, { gap: 10, maxWidth: 220 })
    expect(local.c).toMatchObject({ x: 0, y: 210 })
  })

  it("stacks in a column when asked", () => {
    const items = ["a", "b"].map((id) => note(id))
    const { local } = layoutBoard(items, sizes(["a", "b"]), { direction: "column", gap: 20 })
    expect(local.b).toMatchObject({ x: 0, y: 70 })
  })

  it("keeps placed items and flows the rest below them", () => {
    const items = [note("p", { x: 300, y: 40 }), note("a"), note("b")]
    const { local } = layoutBoard(items, sizes(["p", "a", "b"]), { gap: 10, maxWidth: 1000 })
    expect(local.p).toMatchObject({ x: 300, y: 40 })
    expect(local.a).toMatchObject({ x: 0, y: 100 })
    expect(local.b).toMatchObject({ x: 110, y: 100 })
  })

  it("picks a balanced wrap width when none is given", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `n${i}`)
    const { bbox } = layoutBoard(ids.map((id) => note(id)), sizes(ids, 300, 200), { gap: 20 })
    const aspect = bbox.w / bbox.h
    expect(aspect).toBeGreaterThan(1)
    expect(aspect).toBeLessThan(2.5)
  })

  it("never wraps narrower than the widest item", () => {
    expect(balancedWidth([{ w: 2000, h: 10 }], 10)).toBe(2000)
    expect(balancedWidth([], 10)).toBe(0)
  })

  it("uses estimates for items not measured yet", () => {
    const items = [note("a")]
    const { local } = layoutBoard(items, {})
    expect(local.a.w).toBe(estimateSize(items[0]).w)
  })

  it("ignores arrows", () => {
    const items: BoardItem[] = [note("a"), { id: "x", type: "arrow", from: "a", to: "a" }]
    const { local } = layoutBoard(items, sizes(["a"]))
    expect(local.x).toBeUndefined()
  })
})

describe("sections", () => {
  const section = (extra: Record<string, unknown>, children: BoardItem[]): BoardItem =>
    ({ id: "s", type: "section", title: "S", items: children, ...extra }) as BoardItem

  it("size to their children plus the frame, children positioned inside", () => {
    const items = [section({ layout: "row" }, [note("a"), note("b")])]
    const { local, abs } = layoutBoard(items, sizes(["a", "b"]))
    // two 100-wide children with the section gap (28)
    expect(local.s.w).toBe(Math.max(320, 228 + SECTION_PAD.side * 2))
    expect(local.s.h).toBe(Math.max(160, 50 + SECTION_PAD.top + SECTION_PAD.bottom))
    expect(local.b).toMatchObject({ x: 128, y: 0 })
    expect(abs.b).toMatchObject({ x: 128 + SECTION_PAD.side, y: SECTION_PAD.top })
  })

  it("lay out children as a grid with uniform columns", () => {
    const kids = ["a", "b", "c", "d"].map((id) => note(id))
    const s = { a: { w: 100, h: 50 }, b: { w: 150, h: 50 }, c: { w: 100, h: 80 }, d: { w: 100, h: 50 } }
    const { local } = layoutBoard([section({ layout: "grid", columns: 2 }, kids)], s)
    expect(local.b.x).toBe(128)
    expect(local.c).toMatchObject({ x: 0, y: 78 })
    expect(local.d).toMatchObject({ x: 128, y: 78 })
  })

  it("lay out children in a column", () => {
    const { local } = layoutBoard([section({ layout: "column" }, [note("a"), note("b")])], sizes(["a", "b"]))
    expect(local.b).toMatchObject({ x: 0, y: 78 })
  })

  it("wrap rows at their own width when they have one", () => {
    const kids = ["a", "b", "c"].map((id) => note(id))
    const { local } = layoutBoard([section({ layout: "row", w: 2 * SECTION_PAD.side + 250 }, kids)], sizes(["a", "b", "c"]))
    expect(local.c).toMatchObject({ x: 0, y: 78 })
  })

  it("collapse to their title bar and hide their children's boxes", () => {
    const { local, abs } = layoutBoard([section({ collapsed: true }, [note("a")])], sizes(["a"]))
    expect(local.s.h).toBe(SECTION_COLLAPSED_H)
    expect(abs.a).toBeUndefined()
  })

  it("never measure themselves (their size comes from the children)", () => {
    const { local } = layoutBoard([section({ layout: "row" }, [note("a")])], { ...sizes(["a"]), s: { w: 9999, h: 9999 } })
    expect(local.s.w).toBeLessThan(9999)
  })
})

describe("arrowPath", () => {
  it("connects facing sides horizontally with an elbow", () => {
    const p = arrowPath({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 200, w: 100, h: 100 })
    expect(p.d).toBe("M100,50 H200 V250 H300")
    expect(p.end.dir).toBe("r")
  })
  it("goes vertical when the boxes are stacked", () => {
    const p = arrowPath({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 300, w: 100, h: 100 })
    expect(p.d).toBe("M50,100 L50,300")
    expect(p.end.dir).toBe("d")
  })
})

describe("tree helpers", () => {
  it("gives missing ids fresh ones, deep, without touching other fields", () => {
    const items = [{ type: "note", text: "x", custom: 1 }, { type: "section", title: "S", items: [{ type: "note", text: "y" }] }] as unknown as BoardItem[]
    const out = ensureIds(items)
    expect(out[0].id).toBe("note-1")
    expect((out[0] as unknown as { custom: number }).custom).toBe(1)
    expect((out[1] as { items: BoardItem[] }).items[0].id).toBe("note-2")
  })
  it("maps and drops items deep", () => {
    const items = [note("a"), { id: "s", type: "section", title: "S", items: [note("b"), note("c")] } as BoardItem]
    const out = mapItems(items, (it) => (it.id === "b" ? null : it))
    expect((out[1] as { items: BoardItem[] }).items.map((i) => i.id)).toEqual(["c"])
  })
  it("snaps to the 8px grid", () => {
    expect(snap(13)).toBe(16)
    expect(snap(-3)).toBe(-0)
  })
})
