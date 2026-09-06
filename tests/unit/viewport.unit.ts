import { describe, it, expect } from "vitest"
import { isOutsideViewport } from "../../scripts/lib/viewport.mjs"

// scan.mjs's scroll-into-view decision (README feedback item 7): a state's
// first required target gets scrolled into view before measuring/capturing
// only when it's actually outside the viewport.
describe("isOutsideViewport", () => {
  const W = 1280
  const H = 832

  it("is false for a rect fully inside the viewport", () => {
    expect(isOutsideViewport({ top: 10, left: 10, bottom: 50, right: 100 }, W, H)).toBe(false)
  })

  it("is true for a rect below the fold", () => {
    expect(isOutsideViewport({ top: 900, left: 10, bottom: 950, right: 100 }, W, H)).toBe(true)
  })

  it("is true for a rect above the viewport (negative top)", () => {
    expect(isOutsideViewport({ top: -50, left: 10, bottom: -10, right: 100 }, W, H)).toBe(true)
  })

  it("is true for a rect past the right edge", () => {
    expect(isOutsideViewport({ top: 0, left: W - 10, bottom: 50, right: W + 40 }, W, H)).toBe(true)
  })

  it("is false for a rect exactly flush with the viewport edges", () => {
    expect(isOutsideViewport({ top: 0, left: 0, bottom: H, right: W }, W, H)).toBe(false)
  })

  it("is true for a rect one pixel past the bottom edge", () => {
    expect(isOutsideViewport({ top: 0, left: 0, bottom: H + 1, right: W }, W, H)).toBe(true)
  })
})
