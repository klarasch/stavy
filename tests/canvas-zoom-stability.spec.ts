import { test, expect } from "@playwright/test"

// Mount/evict must not be able to disagree about the same card. Mounting is
// `withinMargin(NEAR_PX)`; budget eviction used to fire on any `dist > 0`,
// which overlaps that band — and because the visibility effect re-checks
// synchronously whenever `live` flips, the overlap cascaded inside one commit
// ("Maximum update depth exceeded") instead of merely flickering.
//
// Live mode (`live=1`) is what makes this reachable now: cards near the
// viewport mount frozen frames of the prototype, so jumping to a crowded page
// area puts the registry over LIVE_BUDGET with candidates just off-screen.
// Zooming then re-runs the check on every frame.

for (const url of ["/stavy/?live=1", "/stavy/?live=1&d_locale=de-DE"]) {
  test(`canvas survives zooming a crowded area (${url})`, async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()))

    await page.goto(url)
    await expect(page.locator("[data-canvas-root]")).toBeVisible()

    await page.getByRole("button", { name: "Expense detail" }).click()
    await page.waitForTimeout(1500)
    // Guard the guard: if nothing mounted, the test proves nothing.
    expect(await page.locator("iframe.ps-card-live").count()).toBeGreaterThan(2)

    for (let i = 0; i < 4; i++) {
      await page.mouse.move(640, 400)
      await page.mouse.wheel(0, -200)
      await page.waitForTimeout(120)
      await page.mouse.wheel(0, 200)
      await page.waitForTimeout(120)
    }
    await page.keyboard.press("2")
    await page.keyboard.press("1")
    await page.waitForTimeout(800)

    expect(errors).toEqual([])
  })
}
