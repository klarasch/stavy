import { describe, it, expect } from "vitest"
import { mapSpace, nearestArea } from "../../src/stavy/canvas/mapLayer"
import type { BoardItem } from "../../src/stavy/types"

const areas = { "page:a": { x: 100, y: 100, w: 400, h: 300 }, "page:b": { x: 600, y: 100, w: 400, h: 300 } }

describe("map layer anchoring", () => {
  it("picks the area containing a point, else the nearest", () => {
    expect(nearestArea(areas, 150, 150)).toBe("page:a")
    expect(nearestArea(areas, 1100, 120)).toBe("page:b")
    expect(nearestArea({}, 0, 0)).toBeNull()
  })

  it("round-trips: canvas position → anchor + offset → the same position", () => {
    const space = mapSpace(areas)
    const file = space.fromView([{ id: "n", type: "note", text: "x", x: 700, y: 450 } as BoardItem])
    expect(file[0]).toMatchObject({ anchor: "page:b", x: 100, y: 350 })
    expect(space.toView(file)[0]).toMatchObject({ x: 700, y: 450 })
  })

  it("moves an anchored item with its area", () => {
    const item = { id: "n", type: "note", text: "x", anchor: "page:a", x: 10, y: -40 } as BoardItem
    const moved = mapSpace({ "page:a": { x: 900, y: 50, w: 400, h: 300 } }).toView([item])
    expect(moved[0]).toMatchObject({ x: 910, y: 10 })
    expect((moved[0] as { anchor?: string }).anchor).toBeUndefined()
  })

  it("places an anchored item without x/y beside its area, stacked", () => {
    const items = [
      { id: "n1", type: "note", text: "1", anchor: "page:a" },
      { id: "n2", type: "note", text: "2", anchor: "page:a" },
    ] as BoardItem[]
    const v = mapSpace(areas).toView(items) as Array<{ x: number; y: number }>
    expect(v[0].x).toBe(548)
    expect(v[1].y).toBeGreaterThan(v[0].y)
  })

  it("drops an unplaced sticky into its screen's slot, and saves it back unplaced unless moved", () => {
    const withSlot = { ...areas, "slot:page:a": { x: 120, y: 330, w: 360, h: 150 } }
    const item = { id: "n", type: "note", text: "x", anchor: "page:a", screen: "a" } as BoardItem
    const space = mapSpace(withSlot)
    const [v] = space.toView([item]) as Array<BoardItem & { x: number; y: number; w: number }>
    expect(v).toMatchObject({ x: 120, y: 330, w: 240 })
    expect(space.fromView([v])[0]).toEqual(item)
    const [moved] = space.fromView([{ ...v, x: v.x + 30 }])
    expect(moved).toMatchObject({ anchor: "page:a", x: 50, y: 230 })
  })

  it("never anchors to a sticky slot", () => {
    expect(nearestArea({ "slot:page:a": { x: 0, y: 0, w: 10, h: 10 }, "page:b": { x: 500, y: 500, w: 10, h: 10 } }, 1, 1)).toBe("slot:page:a")
    const space = mapSpace({ "slot:page:a": { x: 0, y: 0, w: 10, h: 10 }, "page:b": { x: 500, y: 500, w: 10, h: 10 } })
    expect(space.fromView([{ id: "n", type: "note", text: "x", x: 1, y: 1 } as BoardItem])[0]).toMatchObject({ anchor: "page:b" })
  })

  it("keeps items whose area is off the map and writes them back untouched", () => {
    const hidden = { id: "h", type: "note", text: "h", anchor: "page:gone", x: 1, y: 2 } as BoardItem
    const space = mapSpace(areas)
    const view = space.toView([hidden])
    expect(view).toHaveLength(0)
    expect(space.fromView(view)).toEqual([hidden])
  })
})
