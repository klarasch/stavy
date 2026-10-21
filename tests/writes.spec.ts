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

test("marking a screen ready for dev saves status, who and the snapshot baseline, and Home lists it", async ({ page }) => {
  const file = resolve("stavy.json")
  const original = readFileSync(file, "utf8")
  try {
    await page.goto("/stavy/?view=map")
    // Jump to the screen through the contents, as a person would, then open its status menu.
    await page.locator(".ps-toc").getByText("Dashboard", { exact: true }).click()
    const head = page.locator('[data-toc="page:dashboard"]').locator(".ps-status-control").first()
    await expect(head).toBeInViewport()
    await head.locator("button.ps-status-trigger").click()
    await page.getByRole("option", { name: "Ready for dev" }).click()
    // Saving stavy.json can make the dev server reload the page: read the file, not the DOM.
    await expect.poll(() => JSON.parse(readFileSync(file, "utf8")).pages.find((p: { id: string }) => p.id === "dashboard").status).toBe("ready")
    const saved = JSON.parse(readFileSync(file, "utf8")).pages.find((p: { id: string }) => p.id === "dashboard")
    expect(saved.status).toBe("ready")
    expect(saved.ready.at).toMatch(/^\d{4}-\d\d-\d\d$/)
    // Each of the screen's states that has a snapshot gets its hash recorded (when the scan wrote hashes).
    if (saved.ready.snapshots) expect(Object.keys(saved.ready.snapshots).every((k) => k.startsWith("dashboard?"))).toBe(true)

    await page.waitForLoadState("load")
    await expect(async () => {
      await page.goto("/stavy/?view=home")
      const ready = page.getByTestId("home-ready")
      await expect(ready.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: 3000 })
    }).toPass({ timeout: 15000 })
  } finally {
    writeFileSync(file, original)
  }
})

test("a note on the map is saved to map.json, anchored to the area it sits on, and stays with it", async ({ page }) => {
  const file = resolve("stavy-content/map.json")
  const { existsSync, rmSync } = await import("node:fs")
  const had = existsSync(file) ? readFileSync(file, "utf8") : null
  try {
    await page.goto("/stavy/?view=map")
    await page.locator(".ps-toc").getByText("Dashboard", { exact: true }).click()
    await page.waitForTimeout(500)
    await page.keyboard.press("e")
    await page.getByRole("button", { name: /Add/ }).click()
    await page.getByRole("button", { name: "Sticky note" }).click()
    const editor = page.locator("textarea.ps-text-editor")
    await expect(editor).toBeFocused()
    await editor.fill("Ask PM: is the empty state needed for v1?")
    await editor.press("Meta+Enter")
    await expect(page.locator("[data-map-layer] [data-item-type=note]")).toContainText("Ask PM")

    await expect.poll(() => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).items?.length : 0), { timeout: 5000 }).toBe(1)
    const note = JSON.parse(readFileSync(file, "utf8")).items[0]
    expect(note.type).toBe("note")
    expect(note.text).toContain("Ask PM")
    expect(note.anchor).toMatch(/^(page|area):/)
    expect(typeof note.x).toBe("number")

    // After a reload the note is drawn next to the same area.
    const anchorBox = async () => page.locator(`[data-toc="${note.anchor}"]`).boundingBox()
    const noteBox = async () => page.locator("[data-map-layer] [data-item-type=note]").boundingBox()
    const before = { a: await anchorBox(), n: await noteBox() }
    await page.reload()
    await expect(page.locator("[data-map-layer] [data-item-type=note]")).toBeVisible()
    await page.locator(".ps-toc").getByText("Dashboard", { exact: true }).click()
    await page.waitForTimeout(600)
    const after = { a: await anchorBox(), n: await noteBox() }
    const k = (r: { width: number } | null, s: { width: number } | null) => (r && s ? r.width / s.width : 1)
    // Offset from the area, in the area's own scale, is unchanged.
    const off = (x: { a: any; n: any }) => ({ dx: (x.n.x - x.a.x) / x.a.width, dy: (x.n.y - x.a.y) / x.a.width })
    expect(Math.abs(off(before).dx - off(after).dx)).toBeLessThan(0.02)
    expect(Math.abs(off(before).dy - off(after).dy)).toBeLessThan(0.02)
    void k
  } finally {
    if (had == null) rmSync(file, { force: true })
    else writeFileSync(file, had)
  }
})
