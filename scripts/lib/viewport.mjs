// Pure geometry, no DOM/Playwright dependency: whether a client rect sits
// fully inside a W×H viewport. Used by scan.mjs to decide whether a state's
// first required target needs scrolling into view before measuring and
// screenshotting (README feedback item 7 — a target below the fold otherwise
// renders a thumbnail that shows nothing selected). Kept in its own module,
// framework-free, so the decision is unit-testable without a browser; see
// tests/unit/viewport.unit.ts.
export function isOutsideViewport(rect, width, height) {
  return !(rect.top >= 0 && rect.left >= 0 && rect.bottom <= height && rect.right <= width)
}
