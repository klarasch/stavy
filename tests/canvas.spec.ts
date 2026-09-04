import { test, expect } from "@playwright/test"

// The canvas is a map: snapshot cards, no interaction inside them. Clicking a
// card opens the player at that instance.

test("canvas lists every page area and opens the player from a card", async ({ page }) => {
  await page.goto("/stavy/")
  await expect(page.locator("[data-canvas-root]")).toBeVisible()
  await expect(page.locator('[data-toc="page:expenses"]')).toHaveCount(1)
  await page.getByRole("button", { name: "Expenses" }).click()
  // The canvas is a pan/zoom surface: the card may sit outside the window after the jump, so click it directly.
  await page.locator('[data-instance="expenses?role=employee&state=loaded"] .ps-card-shield').first().dispatchEvent("click")
  await expect(page).toHaveURL(/[?&]p=expenses(?:&|$)/)
  await expect(page.locator("iframe.ps-frame")).toHaveAttribute("src", /\/expenses\?role=employee&state=loaded$/)
})
