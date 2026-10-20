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
