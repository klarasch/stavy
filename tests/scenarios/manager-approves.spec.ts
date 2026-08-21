// Generated from protopact.json — scenario "manager-approves". Regenerate with `npm run gen:tests`.
import { test, expect } from "@playwright/test"

// refs: PRD-118 §3, JIRA-ORB-412
test.describe("Manager reviews and approves", () => {
  test("1. From the queue to the full list", async ({ page }) => {
    await page.goto("/p/dashboard?d_role=manager&d_state=loaded&ui=0")
    const target = page.locator('[data-proto="ViewQueueLink"]').first()
    await expect(target, "Managers land on a queue of expenses awaiting review; \"View all\" opens the complete list.").toBeVisible()
    await target.click()
    // fidelity: navigable — next state: "Open the submitted expense"
    await expect.soft(page).toHaveURL(/\/p\/expenses\b/)
    await expect.soft(page).toHaveURL(new RegExp("d_role=manager"))
    await expect.soft(page).toHaveURL(new RegExp("d_state=loaded"))
  })

  test("2. Open the submitted expense", async ({ page }) => {
    await page.goto("/p/expenses?d_role=manager&d_state=loaded&ui=0")
    const target = page.locator('[data-proto="ExpenseRow:exp-2101"]').first()
    await expect(target, "The manager list adds a Submitted-by column. Click the row to open it.").toBeVisible()
    await target.click()
    // fidelity: navigable — next state: "Approve it"
    await expect.soft(page).toHaveURL(/\/p\/expense-detail\b/)
    await expect.soft(page).toHaveURL(new RegExp("d_role=manager"))
    await expect.soft(page).toHaveURL(new RegExp("d_lifecycle=submitted"))
    await expect.soft(page).toHaveURL(new RegExp("d_density=comfortable"))
    await expect.soft(page).toHaveURL(new RegExp("d_locale=en-US"))
  })

  test("3. Approve it", async ({ page }) => {
    await page.goto("/p/expense-detail?d_role=manager&d_lifecycle=submitted&d_density=comfortable&d_locale=en-US&ui=0")
    const target = page.locator('[data-proto="ApproveButton"]').first()
    await expect(target, "Approve advances the lifecycle. Reject and Request-changes branch to other stages — see those variants on the canvas.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "Approved"
    await expect(page).toHaveURL(/\/p\/expense-detail\b/)
    await expect(page).toHaveURL(new RegExp("d_lifecycle=approved"))
  })

  test("4. Approved", async ({ page }) => {
    await page.goto("/p/expense-detail?d_role=manager&d_lifecycle=approved&d_density=comfortable&d_locale=en-US&ui=0")
    const target = page.locator('[data-proto="LifecycleTimeline"]').first()
    await expect(target, "The timeline records the decision; the expense now waits for finance.").toBeVisible()
  })

})
