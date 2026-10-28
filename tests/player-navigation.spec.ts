import { test, expect } from "@playwright/test"

// Switching states keeps the current one on screen while the next loads in a
// second frame, then swaps: no empty (black in dark mode) gap between states.
test("switching state never shows an empty veil; the next state swaps in when ready", async ({ page }) => {
  await page.goto("/stavy/?p=expenses&d_role=employee&d_state=loaded")
  const front = page.frameLocator("iframe.ps-frame")
  await expect(front.locator("body")).toBeVisible()
  await expect(page.locator(".ps-frame-veil")).toHaveCount(0)
  // Watch for an empty veil from here on.
  await page.evaluate(() => {
    ;(window as any).__blankVeil = false
    new MutationObserver(() => {
      const v = document.querySelector(".ps-frame-veil")
      if (v && !v.querySelector("img")) (window as any).__blankVeil = true
    }).observe(document.body, { childList: true, subtree: true })
  })
  const url = new URL(page.url())
  url.searchParams.set("d_role", "manager")
  await page.evaluate((u) => history.pushState(null, "", u), url.toString())
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")))
  await expect.poll(() => page.locator("iframe.ps-frame").evaluate((f) => (f as HTMLIFrameElement).contentWindow?.location.href ?? "")).toMatch(/role=manager/)
  expect(await page.evaluate(() => (window as any).__blankVeil)).toBe(false)
  await expect(page.locator("iframe.ps-frame")).toHaveCount(1)
})

test("Back returns to the board the screen was opened from", async ({ page }) => {
  await page.goto("/stavy/?b=status-filter")
  await page.locator("[data-instance]").first().waitFor()
  await page.goto("/stavy/?p=expenses&d_role=employee&d_state=loaded")
  await expect(page.frameLocator("iframe.ps-frame").locator("body")).toBeVisible()
  await expect.poll(async () => {
    await page.locator("body").press("c")
    return page.url()
  }).toMatch(/[?&]b=status-filter/)
})

test("Back goes to the map when the player was opened directly", async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto("/stavy/?p=expenses&d_role=employee&d_state=loaded")
  await expect(page.frameLocator("iframe.ps-frame").locator("body")).toBeVisible()
  await expect.poll(async () => {
    await page.locator("body").press("c")
    return page.url()
  }).toMatch(/[?&]view=map/)
  await ctx.close()
})
