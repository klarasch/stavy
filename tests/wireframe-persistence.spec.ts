import { test, expect } from "@playwright/test"

// Wireframe (`w=1`) is URL state (SPEC.md §3 "Deep links"): it must survive every
// in-viewer navigation until the user switches it off. Regression coverage for the
// two navigation paths that used to drop it — tour steps and template nav() links.

test("wireframe persists across tour step navigation", async ({ page }) => {
  await page.goto("/p/dashboard?d_role=employee&d_state=loaded&w=1&tour=employee-submits&ts=0")
  await expect(page.locator(".proto-wireframe")).toBeVisible()

  await page.getByRole("button", { name: "Next" }).click()

  await expect(page).toHaveURL(/\/p\/submit-expense\b/)
  await expect(page).toHaveURL(/[?&]w=1(?:&|$)/)
  await expect(page).toHaveURL(/[?&]ts=1(?:&|$)/)
  await expect(page.locator(".proto-wireframe")).toBeVisible()
})

test("wireframe persists across in-page template navigation", async ({ page }) => {
  await page.goto("/p/dashboard?d_role=employee&d_state=loaded&w=1")
  await expect(page.locator(".proto-wireframe")).toBeVisible()

  await page.locator('[data-proto="NewExpenseButton"]').first().click()

  await expect(page).toHaveURL(/\/p\/submit-expense\b/)
  await expect(page).toHaveURL(/[?&]w=1(?:&|$)/)
  await expect(page.locator(".proto-wireframe")).toBeVisible()
})
