import { describe, it, expect } from "vitest"
import {
  computeScreenRect,
  withinMargin,
  distanceBeyondViewport,
  farthestBeyondBudget,
  budgetEvictable,
  NEAR_PX,
  EVICT_PX,
  MIN_LIVE_K,
  LIVE_BUDGET,
  type RectLike,
  type ViewportSize,
  type ScreenRect,
} from "../../src/stavy/canvas/visibility"
import type { Transform } from "../../src/stavy/canvas/PanZoom"

const rect = (left: number, top: number, width: number, height: number): RectLike => ({ left, top, width, height })
const T = (x: number, y: number, k: number): Transform => ({ x, y, k })
const VP = (clientWidth: number, clientHeight: number): ViewportSize => ({ clientWidth, clientHeight })

/* ------------------------------------------------------------------ */
/* computeScreenRect                                                    */
/* ------------------------------------------------------------------ */

describe("computeScreenRect", () => {
  it("passes an element through unchanged at identity transform (k=1, x=0, y=0) and domK=1", () => {
    const root = rect(0, 0, 1000, 800)
    const el = rect(100, 50, 200, 100)
    const out = computeScreenRect(el, root, 1000, T(0, 0, 1))
    expect(out).toEqual({ left: 100, top: 50, w: 200, h: 100 })
  })

  it("applies pan (t.x, t.y) as a translation on top of the root-relative offset", () => {
    const root = rect(0, 0, 1000, 800)
    const el = rect(100, 50, 200, 100)
    const out = computeScreenRect(el, root, 1000, T(50, 20, 1))
    expect(out).toEqual({ left: 150, top: 70, w: 200, h: 100 })
  })

  it("scales offset and size by the zoom factor t.k", () => {
    const root = rect(0, 0, 1000, 800)
    const el = rect(100, 50, 200, 100)
    const out = computeScreenRect(el, root, 1000, T(0, 0, 2))
    // offset (100,50) scales too, then size doubles
    expect(out).toEqual({ left: 200, top: 100, w: 400, h: 200 })
  })

  it("divides out a DOM transform that lags the live transform (domK != 1)", () => {
    // root's painted rect is 2x its layout offsetWidth: the DOM has already
    // applied a k=2 CSS transform that `t` (k=2 as well) hasn't caught up to
    // painting-wise on this frame — domK cancels it back out to identity.
    const root = rect(0, 0, 2000, 1600)
    const el = rect(200, 100, 400, 200) // painted at 2x already
    const out = computeScreenRect(el, root, 1000, T(0, 0, 2))
    // domK = 2000/1000 = 2; (200-0)/2 * 2 = 200 (unscaled offset re-scaled by t.k)
    expect(out).toEqual({ left: 200, top: 100, w: 400, h: 200 })
  })

  it("falls back to domK=1 when rootOffsetWidth is 0 (unmeasured / display:none root)", () => {
    const root = rect(0, 0, 500, 400)
    const el = rect(10, 10, 50, 50)
    const out = computeScreenRect(el, root, 0, T(0, 0, 1))
    expect(out).toEqual({ left: 10, top: 10, w: 50, h: 50 })
  })

  it("handles a huge zoom-out (tiny k) without blowing up", () => {
    const root = rect(0, 0, 1000, 800)
    const el = rect(5000, 4000, 10000, 8000)
    const out = computeScreenRect(el, root, 1000, T(0, 0, 0.001))
    expect(out.left).toBeCloseTo(5)
    expect(out.top).toBeCloseTo(4)
    expect(out.w).toBeCloseTo(10)
    expect(out.h).toBeCloseTo(8)
  })

  it("handles a zero-size element", () => {
    const root = rect(0, 0, 1000, 800)
    const el = rect(100, 100, 0, 0)
    const out = computeScreenRect(el, root, 1000, T(0, 0, 1.5))
    expect(out).toEqual({ left: 150, top: 150, w: 0, h: 0 })
  })
})

/* ------------------------------------------------------------------ */
/* withinMargin                                                         */
/* ------------------------------------------------------------------ */

describe("withinMargin", () => {
  const vp = VP(1000, 800)

  it("is true for a rect fully inside the viewport with 0 margin", () => {
    const r: ScreenRect = { left: 100, top: 100, w: 200, h: 200 }
    expect(withinMargin(r, vp, 0)).toBe(true)
  })

  it("is false for a rect fully to the right of the viewport with 0 margin", () => {
    const r: ScreenRect = { left: 1000, top: 0, w: 100, h: 100 } // left === vp width, strictly not < it
    expect(withinMargin(r, vp, 0)).toBe(false)
  })

  it("a margin brings a nearby off-screen rect into range", () => {
    const r: ScreenRect = { left: 1000, top: 0, w: 100, h: 100 } // sitting exactly at the right edge
    expect(withinMargin(r, vp, 400)).toBe(true)
    expect(withinMargin(r, vp, 0)).toBe(false)
  })

  it("boundary: rect.left exactly at vp.clientWidth + margin is NOT within (strict <)", () => {
    const r: ScreenRect = { left: 1400, top: 0, w: 50, h: 50 } // 1400 = 1000 + 400
    expect(withinMargin(r, vp, 400)).toBe(false)
  })

  it("boundary: rect.left one px inside vp.clientWidth + margin IS within", () => {
    const r: ScreenRect = { left: 1399, top: 0, w: 50, h: 50 }
    expect(withinMargin(r, vp, 400)).toBe(true)
  })

  it("boundary: a rect whose right edge exactly touches the left margin boundary is NOT within (strict >)", () => {
    // left + w === -margin  ->  left+w > -margin is false
    const r: ScreenRect = { left: -450, top: 0, w: 50, h: 50 } // left+w = -400 = -margin
    expect(withinMargin(r, vp, 400)).toBe(false)
  })

  it("a zero-size rect sitting exactly on the viewport edge is not within at margin 0", () => {
    const r: ScreenRect = { left: 1000, top: 400, w: 0, h: 0 }
    expect(withinMargin(r, vp, 0)).toBe(false)
  })

  it("a huge rect from an extreme zoom-out that fully covers the viewport is within", () => {
    const r: ScreenRect = { left: -100000, top: -100000, w: 500000, h: 500000 }
    expect(withinMargin(r, vp, 0)).toBe(true)
  })

  it("checks vertical overflow independently of horizontal", () => {
    const r: ScreenRect = { left: 0, top: 5000, w: 100, h: 100 } // horizontally fine, way below vertically
    expect(withinMargin(r, vp, 0)).toBe(false)
    expect(withinMargin(r, vp, NEAR_PX)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* distanceBeyondViewport                                               */
/* ------------------------------------------------------------------ */

describe("distanceBeyondViewport", () => {
  const vp = VP(1000, 800)

  it("is 0 for a rect fully inside the viewport", () => {
    const r: ScreenRect = { left: 100, top: 100, w: 200, h: 200 }
    expect(distanceBeyondViewport(r, vp)).toBe(0)
  })

  it("is 0 for a rect exactly flush with the viewport edges", () => {
    const r: ScreenRect = { left: 0, top: 0, w: 1000, h: 800 }
    expect(distanceBeyondViewport(r, vp)).toBe(0)
  })

  it("measures overflow past the right edge", () => {
    const r: ScreenRect = { left: 1050, top: 0, w: 100, h: 100 }
    expect(distanceBeyondViewport(r, vp)).toBe(50)
  })

  it("measures overflow past the left edge (rect entirely off to the left)", () => {
    const r: ScreenRect = { left: -300, top: 0, w: 100, h: 100 } // right edge at -200
    expect(distanceBeyondViewport(r, vp)).toBe(200)
  })

  it("measures overflow past the bottom edge", () => {
    const r: ScreenRect = { left: 0, top: 850, w: 100, h: 100 }
    expect(distanceBeyondViewport(r, vp)).toBe(50)
  })

  it("measures overflow past the top edge", () => {
    const r: ScreenRect = { left: 0, top: -260, w: 100, h: 100 } // bottom edge at -160
    expect(distanceBeyondViewport(r, vp)).toBe(160)
  })

  it("takes the max when a rect overflows on two axes at once (diagonal placement)", () => {
    const r: ScreenRect = { left: 1200, top: 900, w: 50, h: 50 } // dx=200 dy=100, max is 200
    expect(distanceBeyondViewport(r, vp)).toBe(200)
  })

  it("is 0 for a huge rect from an extreme zoom-out that swallows the whole viewport", () => {
    const r: ScreenRect = { left: -100000, top: -100000, w: 500000, h: 500000 }
    expect(distanceBeyondViewport(r, vp)).toBe(0)
  })

  it("is 0 for a zero-size rect sitting exactly on the boundary", () => {
    const r: ScreenRect = { left: 1000, top: 800, w: 0, h: 0 }
    expect(distanceBeyondViewport(r, vp)).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* farthestBeyondBudget                                                 */
/* ------------------------------------------------------------------ */

describe("farthestBeyondBudget", () => {
  it("returns null for an empty registry", () => {
    expect(farthestBeyondBudget(new Map())).toBeNull()
  })

  it("returns null when every distance is 0 (nothing is actually off-screen)", () => {
    const m = new Map([["a", 0], ["b", 0]])
    expect(farthestBeyondBudget(m)).toBeNull()
  })

  it("picks the single farthest entry", () => {
    const m = new Map([
      ["a", 10],
      ["b", 500],
      ["c", 200],
    ])
    expect(farthestBeyondBudget(m)).toBe("b")
  })

  it("on a tie, keeps the first entry seen (insertion order)", () => {
    const m = new Map([
      ["a", 300],
      ["b", 300],
      ["c", 100],
    ])
    expect(farthestBeyondBudget(m)).toBe("a")
  })

  it("works with object keys (real usage keys the registry by Element)", () => {
    const elA = { id: "a" }
    const elB = { id: "b" }
    const m = new Map([
      [elA, 40],
      [elB, 900],
    ])
    expect(farthestBeyondBudget(m)).toBe(elB)
  })
})

/* ------------------------------------------------------------------ */
/* Integration: the eviction-budget decision as the hook actually uses it */
/* (over budget, off-screen, farthest one out gets evicted; on-screen or  */
/* under budget, nobody does) — exercised through the same pure helpers   */
/* the hook calls, without needing to mount a component or a DOM.         */
/* ------------------------------------------------------------------ */

describe("eviction budget decision (composed from the pure helpers)", () => {
  const vp = VP(1000, 800)

  /** A screen rect sitting `dist` px beyond the right edge of `vp` (0 = on screen). */
  const beyondRight = (dist: number): ScreenRect => ({ left: vp.clientWidth + dist, top: 0, w: 200, h: 200 })

  function shouldEvictForBudget(registry: Map<string, number>, candidate: string, inspecting: boolean, hover: boolean): boolean {
    const dist = registry.get(candidate) ?? 0
    if (!(registry.size > LIVE_BUDGET && budgetEvictable(beyondRight(dist), vp) && !inspecting && !hover)) return false
    return farthestBeyondBudget(registry) === candidate
  }

  it("does not evict when under budget even if far off-screen", () => {
    const registry = new Map([["only-card", 5000]])
    expect(shouldEvictForBudget(registry, "only-card", false, false)).toBe(false)
  })

  it("evicts the single farthest card once over budget", () => {
    const registry = new Map(Array.from({ length: LIVE_BUDGET + 1 }, (_, i) => [`card-${i}`, NEAR_PX + 1 + i] as const))
    const farthestKey = `card-${LIVE_BUDGET}` // largest index -> largest distance
    expect(shouldEvictForBudget(registry, farthestKey, false, false)).toBe(true)
    expect(shouldEvictForBudget(registry, "card-0", false, false)).toBe(false)
  })

  it("never evicts an on-screen (dist=0) card even when over budget", () => {
    const registry = new Map(Array.from({ length: LIVE_BUDGET + 1 }, (_, i) => [`card-${i}`, NEAR_PX + 1 + i] as const))
    registry.set(`card-${LIVE_BUDGET}`, 0) // the "farthest" one is actually on-screen
    expect(shouldEvictForBudget(registry, `card-${LIVE_BUDGET}`, false, false)).toBe(false)
  })

  it("inspect mode suppresses budget eviction entirely", () => {
    const registry = new Map(Array.from({ length: LIVE_BUDGET + 1 }, (_, i) => [`card-${i}`, NEAR_PX + 1 + i] as const))
    expect(shouldEvictForBudget(registry, `card-${LIVE_BUDGET}`, true, false)).toBe(false)
  })

  // The invariant that keeps the canvas from crashing: nothing may be both
  // "near enough to mount" and "far enough to budget-evict", or the two rules
  // fight each other on every check until React gives up.
  it("is never evictable while the mount test would bring the card straight back", () => {
    for (const dist of [0, 1, NEAR_PX / 2, NEAR_PX - 1]) {
      const r = beyondRight(dist)
      expect(withinMargin(r, vp, NEAR_PX)).toBe(true)
      expect(budgetEvictable(r, vp)).toBe(false)
    }
  })

  it("becomes evictable once the card is past the mount margin", () => {
    const r = beyondRight(NEAR_PX + 1)
    expect(withinMargin(r, vp, NEAR_PX)).toBe(false)
    expect(budgetEvictable(r, vp)).toBe(true)
  })

  it("a hovered card is never the one evicted", () => {
    const registry = new Map(Array.from({ length: LIVE_BUDGET + 1 }, (_, i) => [`card-${i}`, NEAR_PX + 1 + i] as const))
    expect(shouldEvictForBudget(registry, `card-${LIVE_BUDGET}`, false, true)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Sanity on the exported thresholds                                    */
/* ------------------------------------------------------------------ */

describe("visibility thresholds", () => {
  it("NEAR_PX, EVICT_PX and MIN_LIVE_K keep their documented relative ordering", () => {
    expect(NEAR_PX).toBeGreaterThan(0)
    expect(EVICT_PX).toBeGreaterThan(NEAR_PX)
    expect(MIN_LIVE_K).toBeGreaterThan(0)
    expect(MIN_LIVE_K).toBeLessThan(1)
  })
})
