// Generated from stavy.json — scenario "finance-reimburses". Regenerate with `npm run gen:tests`.
import { test, expect } from "@playwright/test"

// refs: PRD-118 §4
test.describe("Finance reimburses", () => {
  test("1. Open an approved expense", async ({ page }) => {
    await page.goto("/expenses?role=finance&state=loaded")
    const target = page.locator("[data-proto=\"ExpenseRow:exp-2102\"], [data-testid=\"ExpenseRow:exp-2102\"]").first()
    await expect(target, "Finance's list is pre-filtered to Approved — their inbox. Open one to work it.").toBeVisible()
    await target.click()
    // fidelity: navigable — next state: "Mark as reimbursed"
    await expect.soft(page).toHaveURL(new RegExp("/expenses/exp-2102\\/?(?:\\?(?=(?:(?:[^#]*&)?role=finance(?:&|#|$)))(?=(?:(?:[^#]*&)?lifecycle=approved(?:&|#|$)))(?=(?:(?:[^#]*&)?density=comfortable(?:&|#|$))|(?![^#]*(?:^|&)density=))(?=(?:(?:[^#]*&)?locale=en-US(?:&|#|$))|(?![^#]*(?:^|&)locale=))(?=(?:(?:[^#]*&)?overlay=none(?:&|#|$))|(?![^#]*(?:^|&)overlay=))[^#]*)(?:#.*)?$"))
  })

  test("2. Mark as reimbursed", async ({ page }) => {
    await page.goto("/expenses/exp-2102?role=finance&lifecycle=approved&density=comfortable&locale=en-US&overlay=none")
    const target = page.locator("[data-proto=\"ReimburseButton\"], [data-testid=\"ReimburseButton\"]").first()
    await expect(target, "The only finance action at this stage. Payment itself happens in an external system.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "Done — terminal state"
    await expect(page).toHaveURL(new RegExp("/expenses/exp-2102\\/?(?:\\?(?=(?:(?:[^#]*&)?role=finance(?:&|#|$)))(?=(?:(?:[^#]*&)?lifecycle=reimbursed(?:&|#|$)))(?=(?:(?:[^#]*&)?density=comfortable(?:&|#|$))|(?![^#]*(?:^|&)density=))(?=(?:(?:[^#]*&)?locale=en-US(?:&|#|$))|(?![^#]*(?:^|&)locale=))(?=(?:(?:[^#]*&)?overlay=none(?:&|#|$))|(?![^#]*(?:^|&)overlay=))[^#]*)(?:#.*)?$"))
  })

  test("3. Done — terminal state", async ({ page }) => {
    await page.goto("/expenses/exp-2102?role=finance&lifecycle=reimbursed&density=comfortable&locale=en-US&overlay=none")
    await expect(page.locator("body")).toBeVisible() // observe step
  })

})
