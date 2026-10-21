import { test, expect } from "@playwright/test"

// Adopter report (0.3.0): a tour step pointing at a loader kept its card after
// the app had moved on. A `hold: true` step keeps the app where it is until
// Next; Next lets it finish and the tour follows.
test("a held tour step keeps its transient state until Next", async ({ page }) => {
  // employee-submits: step 4 = Review (SubmitButton), step 5 = Submitting (held), step 6 = Confirmation.
  await page.goto("/stavy/?p=submit-expense&d_step=review&tour=employee-submits&ts=3")
  const frame = page.frameLocator("iframe.ps-frame")
  await expect(frame.locator('[data-proto="SubmitButton"]')).toBeVisible()
  await expect(page.locator(".ps-halo")).toBeVisible()

  await page.getByRole("button", { name: /Next/ }).click()
  await expect(page.getByText("Submitting", { exact: true })).toBeVisible()
  await expect(frame.locator('[data-proto="SubmittingIndicator"]')).toBeVisible()

  // The app's 1.2 s save would be over by now; held, the spinner stays.
  await page.waitForTimeout(2500)
  await expect(frame.locator('[data-proto="SubmittingIndicator"]')).toBeVisible()
  await expect(page.locator(".ps-halo")).toBeVisible()

  await page.getByRole("button", { name: /Next/ }).click()
  await expect(frame.locator('[data-proto="ViewExpensesButton"]')).toBeVisible()
  await expect(page).toHaveURL(/[?&]ts=5(&|$)/)
  await expect(page.getByText("Confirmation", { exact: true })).toBeVisible()
})

test("a held step loaded fresh starts held", async ({ page }) => {
  // The dev plugin's frame hook gates the window before app scripts run.
  await page.goto("/stavy/?p=submit-expense&d_step=review")
  const frame = page.frameLocator("iframe.ps-frame")
  await expect(frame.locator('[data-proto="SubmitButton"]')).toBeVisible()
  const hooked = await page.evaluate(() => !!(document.querySelector("iframe.ps-frame") as HTMLIFrameElement).contentWindow!.__stavyGate)
  expect(hooked).toBe(true)
})
