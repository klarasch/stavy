import { test, expect, type Page, type Locator } from "@playwright/test"

// A cropped component on a board (or a state embedded in a doc) used to be a
// screenshot only: inspect found no frame under it. Now hovering it in
// inspect mode mounts the real app, replays the item's `do`, and places the
// frame on the crop — so the inspector reads live DOM.

async function hoverUntilTag(page: Page, card: Locator) {
  // The board fits itself on load (animated), so measure on every try.
  await expect.poll(async () => {
    const box = await card.boundingBox()
    if (!box) return false
    await page.mouse.move(box.x + box.width / 2 + Math.random(), box.y + box.height / 2)
    return (await card.locator("iframe").count()) === 1 && (await page.locator(".ps-inspect-tag").isVisible())
  }, { intervals: [250], timeout: 15_000 }).toBe(true)
}

test("a cropped board item is inspectable: live frame placed on the crop", async ({ page }) => {
  await page.goto("/stavy/?b=status-filter&i=1")
  const card = page.locator('[data-instance*="#crop=StatusFilter"]').first()
  await expect(card).toBeVisible()
  await hoverUntilTag(page, card)
  const iframe = card.locator("iframe")
  await expect(iframe).toHaveClass(/is-ready/)
  // Placed on the crop: scaled up from the full page and shifted to the target.
  const transform = await iframe.evaluate((el) => (el as HTMLElement).style.transform)
  expect(transform).toMatch(/translate\(-\d/)
  // The inspector reads the real element under the pointer.
  await expect(page.locator(".ps-inspect-tag")).toBeVisible()
})

test("a board item with `do` replays its actions in the live frame", async ({ page }) => {
  await page.goto("/stavy/?b=status-filter&i=1")
  const card = page.locator('[data-instance*="do=click:StatusFilter"]').first()
  await expect(card).toBeVisible()
  await hoverUntilTag(page, card)
  await expect(card.locator("iframe")).toHaveClass(/is-ready/)
  const open = await card.locator("iframe").evaluate((el) => !!(el as HTMLIFrameElement).contentDocument?.querySelector("[role=listbox]"))
  expect(open).toBe(true)
})

test("docs: Inspect makes an embedded state live", async ({ page }) => {
  await page.goto("/stavy/?doc=approval-rules&i=1")
  const card = page.locator(".ps-docs-md [data-instance]").first()
  await card.scrollIntoViewIfNeeded()
  await expect(card).toBeVisible()
  await hoverUntilTag(page, card)
})
