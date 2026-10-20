// Tests that write workspace files (stavy.json, stavy-content/). They run in the
// `writes` project, after every other spec, so the manifest reloads they cause
// never land in the middle of an unrelated test (playwright.config.ts).
import { expect, test } from "@playwright/test"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"


test("editing a flow step title on the map persists to stavy.json", async ({ page, request }) => {
  const file = resolve("stavy.json")
  const original = readFileSync(file, "utf8")
  try {
    await page.goto("/stavy/?view=map")
    const lane = page.locator('[data-toc="scenario:employee-submits"]')
    const label = lane.locator("[data-editable$='steps/0/title']")
    await expect(label).toBeVisible()
    await label.dblclick()
    const input = lane.locator("input.ps-inline-input")
    await input.fill("Start an expense (edited)")
    await input.press("Enter")
    await expect(label).toHaveText("Start an expense (edited)")
    const saved = JSON.parse(readFileSync(file, "utf8"))
    expect(saved.scenarios.find((s: { id: string }) => s.id === "employee-submits").steps[0].title).toBe("Start an expense (edited)")
    // Only that field changed, formatting and key order intact.
    const before = JSON.parse(original)
    before.scenarios.find((s: { id: string }) => s.id === "employee-submits").steps[0].title = "Start an expense (edited)"
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify(before, null, 2) + "\n")
  } finally {
    writeFileSync(file, original)
  }
  // Anything but an allowed text field is refused.
  const bad = await request.patch("/__stavy/manifest", { data: { path: ["pages", "dashboard", "url"], value: "/x" } })
  expect(bad.status()).toBe(400)
})
