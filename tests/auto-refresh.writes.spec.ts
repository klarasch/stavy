// A change to the app's source re-captures the cards on screen first, and the
// card shows the new capture without a reload. Edits a demo source file, so it
// runs in the `writes` project (playwright.config.ts matches *writes.spec.ts).
import { expect, test } from "@playwright/test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const KEY = "expenses?role=employee&state=loaded"
const index = () => {
  const p = resolve("public/snapshots/index.json")
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {}
}

test("a source change refreshes the visible card and the viewer picks it up", async ({ page, request }) => {
  test.setTimeout(90_000)
  // Make sure the card has a capture to replace.
  if (!index()[KEY]) {
    await request.post("/__stavy/scan", { data: { keys: [KEY] } })
    await expect.poll(() => index()[KEY]?.file, { timeout: 45_000 }).toBeTruthy()
  }
  await page.goto("/stavy/?view=map")
  const card = page.locator(`[data-instance="${KEY}"]`).first()
  await card.scrollIntoViewIfNeeded()
  await expect(card.locator("img.ps-card-img")).toBeVisible()
  const srcBefore = await card.locator("img.ps-card-img").getAttribute("src")
  // The viewer reports what is on screen (throttled).
  await page.waitForTimeout(1500)

  const file = resolve("src/demo/strings.json")
  const original = readFileSync(file, "utf8")
  expect(original).toContain('"New expense"')
  const changedAt = new Date().toISOString()
  try {
    writeFileSync(file, original.replace('"New expense"', '"New expense (changed)"'))
    // Re-captured after the change, with new pixels.
    await expect.poll(() => index()[KEY]?.checkedAt > changedAt, { timeout: 60_000 }).toBe(true)
    expect(index()[KEY].at > changedAt).toBe(true)
    // The card swaps its image without a reload.
    await expect.poll(() => card.locator("img.ps-card-img").getAttribute("src"), { timeout: 10_000 }).not.toBe(srcBefore)
  } finally {
    writeFileSync(file, original)
  }
  // Restoring is a change too: wait until the server saw it and finished
  // re-capturing, so the next spec doesn't meet a reload or a running scan.
  const restoredAt = new Date().toISOString()
  await expect
    .poll(async () => {
      const h = await (await request.get("/__stavy/health")).json()
      return h.sourceChangedAt >= restoredAt && !h.refreshing
    }, { timeout: 60_000, intervals: [1000] })
    .toBe(true)
  await expect(card.locator(".ps-card-updating")).toHaveCount(0)
})
