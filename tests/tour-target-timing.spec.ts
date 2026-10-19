import { test, expect } from "@playwright/test"

// Adopter bug report: starting a scenario from the player's Play menu, when
// the first step is NOT the state the player currently shows, can leave the
// amber "Target `x` not found on this screen" banner stuck even though the
// frame does land on the right state and the target does eventually mount —
// just after the tour's fixed retry budget (TourOverlay.tsx) gave up looking.
// In the adopter's app the target renders a tick after the widget's data
// resolves; here we simulate the same "late-mounting target" by removing the
// element the instant it first mounts and adding it back ~4.2s later — past
// the old ~3.6s (30 x 120ms) retry budget, well within their observed
// 300ms-7s window.
test("a late-mounting tour target gets its halo once it appears, and viewers never see a 'not found' banner", async ({ page }) => {
  // Start on a different page than the scenario's first step (dashboard) —
  // this is the case from the bug report, not a fresh deep link into the step.
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded")
  await expect(page.frameLocator("iframe.ps-frame").locator('[data-proto="ExpenseRow:exp-2101"]')).toBeVisible()

  // Arm a one-shot interceptor inside the (still same, live) frame document:
  // as soon as ViewQueueLink (manager-approves step 0's target, on the
  // dashboard page) is inserted, whisk it away and reinsert it ~4.2s later.
  await page.frameLocator("iframe.ps-frame").locator("html").evaluate((html) => {
    const doc = html.ownerDocument!
    const obs = new MutationObserver(() => {
      const el = doc.querySelector('[data-proto="ViewQueueLink"]')
      if (!el) return
      const parent = el.parentElement!
      const clone = el.cloneNode(true) as Element
      el.remove()
      obs.disconnect()
      setTimeout(() => parent.appendChild(clone), 4200)
    })
    obs.observe(doc.documentElement, { childList: true, subtree: true })
  })

  // This is the reported repro path: launch the scenario via the player's
  // Play menu (a client-side navigation onto a different page), not a fresh
  // deep link.
  await page.getByTitle("Play a scenario that passes through this page").click()
  await page.getByRole("option", { name: "Manager reviews and approves" }).click()
  await expect(page).toHaveURL(/tour=manager-approves/)
  await expect(page).toHaveURL(/[?&]ts=0(&|$)/)

  // Past the grace period the target is still missing: the step is a plain
  // centred card (no halo) and nothing about "not found" is shown.
  await page.waitForTimeout(3000)
  await expect(page.locator(".ps-halo")).toHaveCount(0)
  await expect(page.getByText(/not found on this screen/)).toHaveCount(0)
  const card = page.locator(".ps-glass-strong").filter({ hasText: "From the queue to the full list" })
  const box = await card.boundingBox()
  const vp = page.viewportSize()!
  expect(Math.abs(box!.x + box!.width / 2 - vp.width / 2)).toBeLessThan(4)
  expect(Math.abs(box!.y + box!.height / 2 - vp.height / 2)).toBeLessThan(4)

  // The target comes back (~4.2s): the halo appears, still no banner.
  await expect(page.locator(".ps-halo")).toBeVisible({ timeout: 3000 })
  await expect(page.getByText(/not found on this screen/)).toHaveCount(0)
})

async function withMissingTarget(page: import("@playwright/test").Page) {
  await page.route("**/stavy.json", async (route) => {
    const manifest = await (await route.fetch()).json()
    manifest.scenarios.find((s: { id: string }) => s.id === "manager-approves").steps[0].target = "NoSuchTarget"
    await route.fulfill({ json: manifest })
  })
}

test("a missing target shows the step as a centred card with no diagnostics, and logs the reason", async ({ page }) => {
  const logs: string[] = []
  page.on("console", (m) => logs.push(m.text()))
  await withMissingTarget(page)
  await page.goto("/stavy/?p=dashboard&d_role=manager&d_state=loaded&tour=manager-approves&ts=0")
  await expect.poll(() => logs.some((l) => l.includes("NoSuchTarget")), { timeout: 5000 }).toBe(true)
  await expect(page.locator(".ps-halo")).toHaveCount(0)
  await expect(page.getByText("From the queue to the full list")).toBeVisible()
  await expect(page.getByText(/not found on this screen/)).toHaveCount(0)
})

test("?debug=1 keeps the 'not found' diagnostic visible", async ({ page }) => {
  await withMissingTarget(page)
  await page.goto("/stavy/?p=dashboard&d_role=manager&d_state=loaded&tour=manager-approves&ts=0&debug=1")
  await expect(page.getByText(/not found on this screen/)).toBeVisible({ timeout: 5000 })
})
