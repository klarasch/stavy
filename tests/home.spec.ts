import { expect, test } from "@playwright/test"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

test("Home is the default entry: product, links, boards, changes, decisions", async ({ page }) => {
  await page.goto("/stavy/")
  await expect(page.getByTestId("home")).toBeVisible()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Orbit")
  await expect(page.getByTestId("home-links").locator("a")).toHaveCount(4)
  await expect(page.locator(".ps-home-board")).toHaveCount(2)
  await expect(page.getByTestId("home-changes")).toContainText("Approval story")
  await expect(page.getByTestId("home-decisions").locator("article")).toHaveCount(3)
  // The dev server runs the plugin in a repo: recent commits show.
  await expect(page.getByTestId("home-commits").locator("li").first()).toBeVisible()
  // The switcher lists Home, Map, boards, Docs; the map is still one click away.
  await page.getByRole("link", { name: /Open the map/ }).click()
  await expect(page).toHaveURL(/view=map/)
  await expect(page.locator("[data-instance]").first()).toBeAttached()
})

test("Home fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 })
  await page.goto("/stavy/")
  await expect(page.getByTestId("home")).toBeVisible()
  const overflow = await page.evaluate(() => document.querySelector(".ps-home")!.scrollWidth - document.querySelector(".ps-home")!.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test("a decisions doc and a changelog doc are listed in Docs", async ({ page }) => {
  await page.goto("/stavy/?doc=decisions")
  await expect(page.locator(".ps-docs-md h2").first()).toContainText("Rejecting an expense")
  await expect(page.locator(".ps-docs-nav")).toContainText("Changelog")
})

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
