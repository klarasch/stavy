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
test("banner clears once a late-mounting tour target appears, even past the old retry budget", async ({ page }) => {
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

  // Let the old fixed retry budget (~3.6s) run out before the target (which
  // reappears at ~4.2s) comes back.
  await page.waitForTimeout(4000)

  // The target is back and the frame is on the right state: the banner must
  // clear and the halo must appear, not stay stuck from a retry budget that
  // expired before the target remounted.
  await expect(page.locator(".ps-halo")).toBeVisible({ timeout: 3000 })
  await expect(page.getByText(/not found on this screen/)).toHaveCount(0)
})
