import { test, expect } from "@playwright/test"

// The player is an overlay over the prototype's own URL (SPEC §2.1): the frame
// shows the page's `url` template filled with the dimension assignment, a
// dimension switch rewrites the frame URL, in-frame navigation onto a
// registered state is followed, and the inspector reads through the frame.

test("the frame shows the prototype at the page url for the dims", async ({ page }) => {
  await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted")
  const frame = page.locator("iframe.ps-frame")
  await expect(frame).toHaveAttribute("src", /\/expenses\/exp-2101\?role=manager&lifecycle=submitted&density=comfortable&locale=en-US&overlay=none$/)
  await expect(page.frameLocator("iframe.ps-frame").locator('[data-proto="ApproveButton"]')).toBeVisible()
})

test("switching a dimension rewrites the frame url", async ({ page }) => {
  await page.goto("/stavy/?p=expenses&d_role=employee&d_state=loaded")
  await page.getByRole("button", { name: /Data state/ }).click()
  await page.getByRole("option", { name: "Empty" }).click()
  await expect(page).toHaveURL(/d_state=empty/)
  await expect(page.locator("iframe.ps-frame")).toHaveAttribute("src", /state=empty/)
  await expect(page.frameLocator("iframe.ps-frame").getByText("No expenses yet", { exact: false })).toBeVisible()
})

test("in-frame navigation onto a registered state is followed", async ({ page }) => {
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded")
  await page.frameLocator("iframe.ps-frame").locator('[data-proto="ExpenseRow:exp-2101"]').click()
  await expect(page).toHaveURL(/[?&]p=expense-detail(?:&|$)/)
  await expect(page).toHaveURL(/d_role=manager/)
})

test("a tour highlights the step target inside the frame", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&d_role=manager&d_state=loaded&tour=manager-approves&ts=0")
  await expect(page.locator(".ps-halo")).toBeVisible()
  const halo = await page.locator(".ps-halo").boundingBox()
  const target = await page.frameLocator("iframe.ps-frame").locator('[data-proto="ViewQueueLink"]').boundingBox()
  expect(halo && target && Math.abs(halo.x + 6 - target.x) < 3).toBe(true)
})

test("the inspector resolves the element under the pointer inside the frame", async ({ page }) => {
  await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted&i=1")
  const target = await page.frameLocator("iframe.ps-frame").locator('[data-proto="ApproveButton"]').boundingBox()
  expect(target).not.toBeNull()
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2)
  await expect(page.getByText("ApproveButton", { exact: true })).toBeVisible()
})
