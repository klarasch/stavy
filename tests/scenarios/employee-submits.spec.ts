// Generated from stavy.json — scenario "employee-submits". Regenerate with `npm run gen:tests`.
import { test, expect } from "@playwright/test"

// refs: PRD-118 §2
test.describe("Employee submits an expense", () => {
  test("1. Start a new expense", async ({ page }) => {
    await page.goto("/p/dashboard?d_role=employee&d_state=loaded&ui=0")
    const target = page.locator('[data-proto="NewExpenseButton"]').first()
    await expect(target, "The dashboard CTA is the main entry point for employees.").toBeVisible()
    await target.click()
    // fidelity: navigable — next state: "Fill in the details"
    await expect.soft(page).toHaveURL(/\/p\/submit-expense\b/)
    await expect.soft(page).toHaveURL(new RegExp("d_step=details"))
  })

  test("2. Fill in the details", async ({ page }) => {
    await page.goto("/p/submit-expense?d_step=details&ui=0")
    const target = page.locator('[data-proto="ContinueButton"]').first()
    await expect(target, "Merchant, amount, date, category. All fields are mock-validated only.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "Attach a receipt"
    await expect(page).toHaveURL(/\/p\/submit-expense\b/)
    await expect(page).toHaveURL(new RegExp("d_step=receipt"))
  })

  test("3. Attach a receipt", async ({ page }) => {
    await page.goto("/p/submit-expense?d_step=receipt&ui=0")
    const target = page.locator('[data-proto="ContinueButton"]').first()
    await expect(target, "The dropzone is mocked — continue to proceed.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "Review and submit"
    await expect(page).toHaveURL(/\/p\/submit-expense\b/)
    await expect(page).toHaveURL(new RegExp("d_step=review"))
  })

  test("4. Review and submit", async ({ page }) => {
    await page.goto("/p/submit-expense?d_step=review&ui=0")
    const target = page.locator('[data-proto="SubmitButton"]').first()
    await expect(target, "Summary of everything entered; submitting advances the lifecycle to Submitted.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "Confirmation"
    await expect(page).toHaveURL(/\/p\/submit-expense\b/)
    await expect(page).toHaveURL(new RegExp("d_step=done"))
  })

  test("5. Confirmation", async ({ page }) => {
    await page.goto("/p/submit-expense?d_step=done&ui=0")
    const target = page.locator('[data-proto="ViewExpensesButton"]').first()
    await expect(target, "The expense now exists. Jump to the list to see it.").toBeVisible()
    await target.click()
    // fidelity: interactive — next state: "It shows up as Submitted"
    await expect(page).toHaveURL(/\/p\/expenses\b/)
    await expect(page).toHaveURL(new RegExp("d_role=employee"))
    await expect(page).toHaveURL(new RegExp("d_state=loaded"))
  })

  test("6. It shows up as Submitted", async ({ page }) => {
    await page.goto("/p/expenses?d_role=employee&d_state=loaded&ui=0")
    const target = page.locator('[data-proto="ExpenseRow:exp-2101"]').first()
    await expect(target, "The freshly submitted expense appears at the top of the employee's list.").toBeVisible()
  })

})
