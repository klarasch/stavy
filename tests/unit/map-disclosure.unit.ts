import { describe, it, expect } from "vitest"
import { readDisclosure, isOpen, setOpen, setAll, runsOf, shelfWidth, shelfColumns, type Universe } from "../../src/stavy/canvas/disclosure"

const universe: Universe = { screens: ["a", "b", "c"], lanes: ["f1", "f2"], boards: ["coverage", "ia"] }
const sp = (q: string) => new URLSearchParams(q)

describe("map disclosure (URL state)", () => {
  it("reads what is open from x / fl / bx / states", () => {
    const d = readDisclosure(sp("x=a,c&fl=f2"))
    expect(isOpen(d, "screens", "a")).toBe(true)
    expect(isOpen(d, "screens", "b")).toBe(false)
    expect(isOpen(d, "lanes", "f2")).toBe(true)
    expect(isOpen(d, "boards", "ia")).toBe(false)
    expect(isOpen(readDisclosure(sp("states=all")), "boards", "ia")).toBe(true)
  })

  it("opens and closes one item, keeping lists in map order and other params", () => {
    let q = setOpen(sp("v=1,2,3&x=c"), "screens", ["a"], true, universe)
    expect(q.get("x")).toBe("a,c")
    expect(q.get("v")).toBe("1,2,3")
    q = setOpen(q, "screens", ["a", "c"], false, universe)
    expect(q.has("x")).toBe(false)
  })

  it("closing one thing while everything is open spells out the rest", () => {
    const q = setOpen(sp("states=all"), "screens", ["b"], false, universe)
    expect(q.has("states")).toBe(false)
    expect(q.get("x")).toBe("a,c")
    expect(q.get("fl")).toBe("f1,f2")
    expect(q.get("bx")).toBe("coverage,ia")
    // Opening under "all" changes nothing.
    expect(setOpen(sp("states=all"), "lanes", ["f1"], true, universe).toString()).toBe("states=all")
  })

  it("All states on and off drops the per-item lists", () => {
    expect(setAll(sp("x=a&fl=f1&bx=ia&w=1"), true).toString()).toBe("w=1&states=all")
    expect(setAll(sp("states=all&w=1"), false).toString()).toBe("w=1")
  })
})

describe("map packing", () => {
  const tile = (id: string) => ({ id, open: false, w: 346, h: 300 })
  it("groups consecutive folded and open screens into runs, in order", () => {
    const runs = runsOf([tile("a"), tile("b"), { id: "c", open: true, w: 1700, h: 900 }, tile("d")])
    expect(runs).toEqual([
      { open: false, ids: ["a", "b"] },
      { open: true, ids: ["c"] },
      { open: false, ids: ["d"] },
    ])
  })

  it("aims at a wide shape: more tiles per row as the map grows, never narrower than an open screen", () => {
    const cols = (n: number) => shelfColumns(shelfWidth(Array.from({ length: n }, (_, i) => tile(String(i))), 346, 40), 346, 40)
    expect(cols(2)).toBe(2)
    expect(cols(5)).toBe(3)
    expect(cols(40)).toBeGreaterThanOrEqual(7)
    // Rows × columns stays roughly 16:10 in tiles of ~346 × 300.
    const n = 40
    const c = cols(n)
    const ratio = (c * 386) / (Math.ceil(n / c) * 340)
    expect(ratio).toBeGreaterThan(1.2)
    expect(ratio).toBeLessThan(2.2)
    expect(shelfWidth([tile("a"), { id: "b", open: true, w: 2600, h: 900 }], 346, 40)).toBeGreaterThanOrEqual(2600)
  })
})
