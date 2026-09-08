import { test, expect } from "@playwright/test"

// The canvas is a map: snapshot cards, no interaction inside them. Clicking a
// card opens the player at that instance.

test("canvas lists every page area and opens the player from a card", async ({ page }) => {
  await page.goto("/stavy/")
  await expect(page.locator("[data-canvas-root]")).toBeVisible()
  await expect(page.locator('[data-toc="page:expenses"]')).toHaveCount(1)
  await page.locator(".ps-toc-item", { hasText: "Expenses list" }).click()
  // The canvas is a pan/zoom surface: the card may sit outside the window after the jump, so click it directly.
  await page.locator('[data-instance="expenses?role=employee&state=loaded"] .ps-card-shield').first().dispatchEvent("click")
  await expect(page).toHaveURL(/[?&]p=expenses(?:&|$)/)
  await expect(page.locator("iframe.ps-frame")).toHaveAttribute("src", /\/expenses\?role=employee&state=loaded$/)
})

// The site map draws its arrows in an SVG under the nodes: the rows above it
// must let the pointer through between nodes, or no arrow is ever hoverable.
test("site map arrows are hoverable and a node fits that page's area", async ({ page }) => {
  await page.goto("/stavy/?ui=0")
  await expect(page.locator('[data-toc="area:map"]')).toHaveCount(1)
  const wire = page.locator(".ps-map-wire").first()
  await expect(wire.locator("title")).toHaveText(/\w/)
  const at = await wire.locator(".ps-map-hit").evaluate((hit: SVGPathElement) => {
    const p = (hit.getPointAtLength(hit.getTotalLength() / 2) as DOMPoint).matrixTransform(hit.getScreenCTM()!)
    return { x: p.x, y: p.y }
  })
  await page.mouse.move(at.x, at.y)
  await expect(page.locator(".ps-map-wire[data-on]")).toHaveCount(1)

  const before = new URL(page.url()).searchParams.get("v")
  await page.locator(".ps-map-node").first().click()
  await expect
    .poll(() => new URL(page.url()).searchParams.get("v"))
    .not.toBe(before)
})

// A figure (a board anchored to a page, SPEC §1.7) belongs to its page's area,
// not to the Boards area: that is the whole point of anchoring one.
test("an anchored board renders inside its page area, with its callouts", async ({ page }) => {
  await page.goto("/stavy/?ui=0")
  const figure = page.locator('[data-toc="page:expenses"] [data-toc="board:status-filter-menu"]')
  await expect(figure).toHaveCount(1)
  await expect(figure.locator("img")).toHaveAttribute("src", "/figures/status-filter-menu.png")
  // Three callouts: numbered over the image, and the same three in the legend.
  await expect(figure.locator(".ps-figure .ps-anat-tag")).toHaveCount(3)
  await expect(figure.locator(".ps-figure .ps-anat-box")).toHaveCount(2) // the third is a point pin
  await expect(figure.getByText("Current value")).toBeVisible()
  // …and it is not in the Boards area, nor listed under Boards.
  await expect(page.locator('[data-toc="area:boards"] [data-toc="board:status-filter-menu"]')).toHaveCount(0)
})

test("the contents list a figure under its page, not under Boards", async ({ page }) => {
  await page.goto("/stavy/")
  const item = page.locator(".ps-toc-item", { hasText: "Status filter menu" })
  await expect(item).toHaveClass(/ps-toc-sub/)
  await item.click()
  await expect(page.locator('[data-toc="board:status-filter-menu"][data-flash]')).toHaveCount(1)
})

test("?map=0 leaves the map out of the canvas and the contents list", async ({ page }) => {
  await page.goto("/stavy/?map=0")
  await expect(page.locator('[data-toc="area:map"]')).toHaveCount(0)
  await expect(page.locator(".ps-toc-item", { hasText: "Site map" })).toHaveCount(0)
})
