// Generated from stavy.json — scenario "employee-submits". Regenerate with `npm run gen:tests`.
import { test, expect } from "@playwright/test"

// refs: PRD-118 §2
test.describe("Employee submits an expense", () => {
  test("1. Start a new expense", async ({ page }) => {
    await page.goto("/?role=employee&state=loaded")
    const target = page.locator("[data-proto=\"NewExpenseButton\"], [data-testid=\"NewExpenseButton\"]").first()
    await expect(target, "The dashboard CTA is the main entry point for employees.").toBeVisible()
    await target.click()
    // fidelity: navigable — next state: "Fill in the details"
    await expect.soft(page).toHaveURL(new RegExp("/submit\\/?(?:\\?(?=(?:(?:[^#]*&)?step=details(?:&|#|$))|(?![^#]*(?:^|&)step=))[^#]*)?(?:#.*)?$"))
  })

  test("2. Fill in the details", async ({ page }) => {
    await page.goto("/submit?step=details")
    const target = page.locator("[data-proto=\"ContinueButton\"], [data-testid=\"ContinueButton\"]").first()
    await expect(target, "Merchant, amount, date, category. All fields are mock-validated only.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "Attach a receipt"
    await expect(page).toHaveURL(new RegExp("/submit\\/?(?:\\?(?=(?:(?:[^#]*&)?step=receipt(?:&|#|$)))[^#]*)(?:#.*)?$"))
  })

  test("3. Attach a receipt", async ({ page }) => {
    await page.goto("/submit?step=receipt")
    const target = page.locator("[data-proto=\"ContinueButton\"], [data-testid=\"ContinueButton\"]").first()
    await expect(target, "The dropzone is mocked — continue to proceed.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "Review and submit"
    await expect(page).toHaveURL(new RegExp("/submit\\/?(?:\\?(?=(?:(?:[^#]*&)?step=review(?:&|#|$)))[^#]*)(?:#.*)?$"))
  })

  test("4. Review and submit", async ({ page }) => {
    await page.goto("/submit?step=review")
    const target = page.locator("[data-proto=\"SubmitButton\"], [data-testid=\"SubmitButton\"]").first()
    await expect(target, "Summary of everything entered; submitting advances the lifecycle to Submitted.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "Confirmation"
    await expect(page).toHaveURL(new RegExp("/submit\\/?(?:\\?(?=(?:(?:[^#]*&)?step=done(?:&|#|$)))[^#]*)(?:#.*)?$"))
  })

  test("5. Confirmation", async ({ page }) => {
    await page.goto("/submit?step=done")
    const target = page.locator("[data-proto=\"ViewExpensesButton\"], [data-testid=\"ViewExpensesButton\"]").first()
    await expect(target, "The expense now exists. Jump to the list to see it.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "It shows up as Submitted"
    await expect(page).toHaveURL(new RegExp("/expenses\\/?(?:\\?(?=(?:(?:[^#]*&)?role=employee(?:&|#|$))|(?![^#]*(?:^|&)role=))(?=(?:(?:[^#]*&)?state=loaded(?:&|#|$))|(?![^#]*(?:^|&)state=))[^#]*)?(?:#.*)?$"))
  })

  test("6. It shows up as Submitted", async ({ page }) => {
    await page.goto("/expenses?role=employee&state=loaded")
    const target = page.locator("[data-proto=\"ExpenseRow:exp-2101\"], [data-testid=\"ExpenseRow:exp-2101\"]").first()
    await expect(target, "The freshly submitted expense appears at the top of the employee's list.").toBeVisible()
  })

})
