import { test, expect } from "@playwright/test"

// Wireframe (`w=1`) is URL state (SPEC.md §3 "Deep links"): it must survive every
// in-viewer navigation until the user switches it off. The player applies it by
// injecting a stylesheet into the prototype frame, so it must also come back
// after the frame navigates (tour steps, and the prototype's own links, which
// the player follows).

const wireframeStyle = (page: import("@playwright/test").Page) => page.frameLocator("iframe.ps-frame").locator("#stavy-wireframe")

test("wireframe persists across tour step navigation", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&d_role=employee&d_state=loaded&w=1&tour=employee-submits&ts=0")
  await expect(wireframeStyle(page)).toHaveCount(1)

  await page.getByRole("button", { name: "Next" }).click()

  await expect(page).toHaveURL(/[?&]p=submit-expense(?:&|$)/)
  await expect(page).toHaveURL(/[?&]w=1(?:&|$)/)
  await expect(page).toHaveURL(/[?&]ts=1(?:&|$)/)
  await expect(wireframeStyle(page)).toHaveCount(1)
})

test("wireframe persists when the prototype navigates itself and the player follows", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&d_role=employee&d_state=loaded&w=1")
  await expect(wireframeStyle(page)).toHaveCount(1)

  await page.frameLocator("iframe.ps-frame").locator('[data-proto="NewExpenseButton"]').first().click()

  await expect(page).toHaveURL(/[?&]p=submit-expense(?:&|$)/)
  await expect(page).toHaveURL(/[?&]w=1(?:&|$)/)
  await expect(wireframeStyle(page)).toHaveCount(1)
})
