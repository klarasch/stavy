// Generated from stavy.json — scenario "manager-approves". Regenerate with `npm run gen:tests`.
import { test, expect } from "@playwright/test"

// refs: PRD-118 §3, JIRA-ORB-412
test.describe("Manager reviews and approves", () => {
  test("1. From the queue to the full list", async ({ page }) => {
    await page.goto("/?role=manager&state=loaded")
    const target = page.locator("[data-proto=\"ViewQueueLink\"], [data-testid=\"ViewQueueLink\"]").first()
    await expect(target, "Managers land on a queue of expenses awaiting review; \"View all\" opens the complete list.").toBeVisible()
    await target.click()
    // fidelity: navigable — next state: "Open the submitted expense"
    await expect.soft(page).toHaveURL(new RegExp("/expenses\\/?(?:\\?(?=(?:(?:[^#]*&)?role=manager(?:&|#|$)))(?=(?:(?:[^#]*&)?state=loaded(?:&|#|$))|(?![^#]*(?:^|&)state=))[^#]*)(?:#.*)?$"))
  })

  test("2. Open the submitted expense", async ({ page }) => {
    await page.goto("/expenses?role=manager&state=loaded")
    const target = page.locator("[data-proto=\"ExpenseRow:exp-2101\"], [data-testid=\"ExpenseRow:exp-2101\"]").first()
    await expect(target, "The manager list adds a Submitted-by column. Click the row to open it.").toBeVisible()
    await target.click()
    // fidelity: navigable — next state: "Approve it"
    await expect.soft(page).toHaveURL(new RegExp("/expenses/exp-2101\\/?(?:\\?(?=(?:(?:[^#]*&)?role=manager(?:&|#|$)))(?=(?:(?:[^#]*&)?lifecycle=submitted(?:&|#|$))|(?![^#]*(?:^|&)lifecycle=))(?=(?:(?:[^#]*&)?density=comfortable(?:&|#|$))|(?![^#]*(?:^|&)density=))(?=(?:(?:[^#]*&)?locale=en-US(?:&|#|$))|(?![^#]*(?:^|&)locale=))(?=(?:(?:[^#]*&)?overlay=none(?:&|#|$))|(?![^#]*(?:^|&)overlay=))[^#]*)(?:#.*)?$"))
  })

  test("3. Approve it", async ({ page }) => {
    await page.goto("/expenses/exp-2101?role=manager&lifecycle=submitted&density=comfortable&locale=en-US&overlay=none")
    const target = page.locator("[data-proto=\"ApproveButton\"], [data-testid=\"ApproveButton\"]").first()
    await expect(target, "Approve advances the lifecycle. Reject and Request-changes branch to other stages — see those variants on the canvas.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "Approved"
    await expect(page).toHaveURL(new RegExp("/expenses/exp-2101\\/?(?:\\?(?=(?:(?:[^#]*&)?role=manager(?:&|#|$)))(?=(?:(?:[^#]*&)?lifecycle=approved(?:&|#|$)))(?=(?:(?:[^#]*&)?density=comfortable(?:&|#|$))|(?![^#]*(?:^|&)density=))(?=(?:(?:[^#]*&)?locale=en-US(?:&|#|$))|(?![^#]*(?:^|&)locale=))(?=(?:(?:[^#]*&)?overlay=none(?:&|#|$))|(?![^#]*(?:^|&)overlay=))[^#]*)(?:#.*)?$"))
  })

  test("4. Approved", async ({ page }) => {
    await page.goto("/expenses/exp-2101?role=manager&lifecycle=approved&density=comfortable&locale=en-US&overlay=none")
    const target = page.locator("[data-proto=\"LifecycleTimeline\"], [data-testid=\"LifecycleTimeline\"]").first()
    await expect(target, "The timeline records the decision; the expense now waits for finance.").toBeVisible()
  })

})
