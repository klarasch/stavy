import { test, expect } from "@playwright/test"

// Overlay containment (SPEC §3): a page state that opens a modal must portal
// it into the viewer-provided portalContainer. On the open page that means
// inside the page wrapper; on the canvas it means inside the instance card —
// never loose on document.body covering the canvas.

test("open page: reject-confirm modal renders inside the page wrapper, not on document.body", async ({ page }) => {
  await page.goto("/p/expense-detail?d_role=manager&d_lifecycle=submitted&d_overlay=reject-confirm")
  const modal = page.locator('[data-proto="RejectConfirmModal"]')
  await expect(modal).toBeVisible()
  const placement = await modal.evaluate((el) => ({
    onBody: el.parentElement === document.body,
    inViewer: !!el.closest(".ps-viewport"),
  }))
  expect(placement.onBody).toBe(false)
  expect(placement.inViewer).toBe(true)
})

test("open page: cancel and confirm are dimension walks", async ({ page }) => {
  await page.goto("/p/expense-detail?d_role=manager&d_lifecycle=submitted&d_overlay=reject-confirm")
  await page.locator('[data-proto="ConfirmRejectButton"]').click()
  await expect(page).toHaveURL(/d_lifecycle=rejected/)
  await expect(page.locator('[data-proto="RejectConfirmModal"]')).toHaveCount(0)
})

test("canvas: the pinned modal state stays contained in its instance card", async ({ page }) => {
  await page.goto("/")
  // Jump the viewport to the Expense detail area so its cards mount (cards mount lazily).
  await page.locator('.ps-toc-item:has-text("Expense detail")').click()
  const modal = page.locator('[data-proto="RejectConfirmModal"]')
  await expect(modal).toHaveCount(1, { timeout: 10_000 })
  const contained = await modal.evaluate((el) => {
    const card = el.closest(".ps-proto-content")
    if (!card) return { inCard: false, fillsCard: false, coversViewport: true }
    const mr = el.getBoundingClientRect()
    const cr = card.getBoundingClientRect()
    return {
      inCard: true,
      fillsCard: Math.abs(mr.left - cr.left) < 2 && Math.abs(mr.width - cr.width) < 2,
      coversViewport: mr.width > window.innerWidth * 0.9,
    }
  })
  expect(contained.inCard).toBe(true)
  expect(contained.fillsCard).toBe(true)
  expect(contained.coversViewport).toBe(false)
  // And nothing full-screen leaked to the document root.
  const bodyOverlays = await page.evaluate(() =>
    [...document.body.children].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width >= window.innerWidth && r.height >= window.innerHeight && getComputedStyle(el).position === "fixed"
    }).length
  )
  expect(bodyOverlays).toBe(0)
})
