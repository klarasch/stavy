// Generated from stavy.json — scenario "finance-reimburses". Regenerate with `npm run gen:tests`.
import { test, expect } from "@playwright/test"

// refs: PRD-118 §4
test.describe("Finance reimburses", () => {
  test("1. Open an approved expense", async ({ page }) => {
    await page.goto("/p/expenses?d_role=finance&d_state=loaded&ui=0")
    const target = page.locator('[data-proto="ExpenseRow:exp-2102"]').first()
    await expect(target, "Finance's list is pre-filtered to Approved — their inbox. Open one to work it.").toBeVisible()
    await target.click()
    // fidelity: navigable — next state: "Mark as reimbursed"
    await expect.soft(page).toHaveURL(/\/p\/expense-detail\b/)
    await expect.soft(page).toHaveURL(new RegExp("d_role=finance"))
    await expect.soft(page).toHaveURL(new RegExp("d_lifecycle=approved"))
    await expect.soft(page).toHaveURL(new RegExp("d_density=comfortable"))
    await expect.soft(page).toHaveURL(new RegExp("d_locale=en-US"))
    await expect.soft(page).toHaveURL(new RegExp("d_overlay=none"))
  })

  test("2. Mark as reimbursed", async ({ page }) => {
    await page.goto("/p/expense-detail?d_role=finance&d_lifecycle=approved&d_density=comfortable&d_locale=en-US&d_overlay=none&ui=0")
    const target = page.locator('[data-proto="ReimburseButton"]').first()
    await expect(target, "The only finance action at this stage. Payment itself happens in an external system.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "Done — terminal state"
    await expect(page).toHaveURL(/\/p\/expense-detail\b/)
    await expect(page).toHaveURL(new RegExp("d_lifecycle=reimbursed"))
  })

  test("3. Done — terminal state", async ({ page }) => {
    await page.goto("/p/expense-detail?d_role=finance&d_lifecycle=reimbursed&d_density=comfortable&d_locale=en-US&d_overlay=none&ui=0")
    await expect(page.locator("[data-proto]").first()).toBeVisible() // observe step
  })

})
