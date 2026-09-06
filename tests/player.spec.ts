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
  // The frame navigates client-side now (pushState, not a `src` rewrite — see
  // navigateFrame in frame.ts), so the live URL is asserted through the frame's
  // own window rather than the iframe element's `src` attribute.
  const frame = page.locator("iframe.ps-frame")
  await expect.poll(() => frame.evaluate((el: HTMLIFrameElement) => el.contentWindow?.location.href)).toContain("state=empty")
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

// Item 1 (adopter feedback): tour steps used to rewrite the iframe's `src`,
// which the browser treats as a document load — the frame re-bootstrapped on
// every step and any state built up in the app was lost. navigateFrame()
// (frame.ts) pushes into the frame's own history and dispatches a popstate
// instead, for a same-origin frame with a live document.
test("tour steps navigate the frame client-side, without reloading it", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&tour=employee-submits&ts=0")
  const frame = page.locator("iframe.ps-frame")
  await frame.evaluate((el: HTMLIFrameElement) => {
    ;(el.contentWindow as unknown as { __stamp?: number }).__stamp = 1
  })
  // employee-submits: dashboard -> submit-expense (details/receipt/review/done) -> expenses.
  // Every step but the page itself changes; a real navigation anywhere in
  // there would reset the stamp and add a navigation entry.
  for (let i = 1; i <= 5; i++) {
    await page.getByRole("button", { name: "Next" }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]ts=${i}(&|$)`))
  }
  const stamp = await frame.evaluate((el: HTMLIFrameElement) => (el.contentWindow as unknown as { __stamp?: number }).__stamp)
  expect(stamp).toBe(1)
  const navCount = await frame.evaluate((el: HTMLIFrameElement) => el.contentWindow?.performance.getEntriesByType("navigation").length)
  expect(navCount).toBe(1)
})
