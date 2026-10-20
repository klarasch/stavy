import { test, expect, type Page } from "@playwright/test"

// The map (0.3): a page's states are a row, wrapped; no placeholders; named
// states show their own names; flows wrap and collapse; snapshots can be
// requested from the cards when the dev endpoint is there.

async function withManifest(page: Page, edit: (m: any) => void) {
  await page.route("**/stavy.json", async (route) => {
    const manifest = await (await route.fetch()).json()
    edit(manifest)
    await route.fulfill({ json: manifest })
  })
}

test("states render as a wrapping row: no placeholders, named states labelled, a status chip", async ({ page }) => {
  await withManifest(page, (m) => {
    const p = m.pages.find((x: any) => x.id === "submit-expense")
    p.status = "review"
    p.states = [
      { id: "details", label: "Details", note: "Fill in the basics", dims: { step: "details" } },
      { id: "receipt", dims: { step: "receipt" } },
      { id: "review-step", label: "Review", note: "Check before sending", dims: { step: "review" } },
      { id: "done", dims: { step: "done" } },
    ]
    delete p.instances
  })
  await page.goto("/stavy/?view=map")
  const area = page.locator('[data-toc="page:submit-expense"]')
  await expect(area).toHaveCount(1)
  await expect(area.locator("[data-instance]")).toHaveCount(4)
  // Labels from the states (humanised when none is given), their notes, never "_state".
  await expect(area.getByText("Receipt", { exact: true }).first()).toBeAttached()
  await expect(area.getByText("Check before sending")).toBeAttached()
  await expect(area.getByText("4 states")).toBeAttached()
  expect(await area.innerText()).not.toMatch(/_state/i)
  await expect(area.locator(".ps-status-review")).toHaveText("review")
  // Nothing is ever drawn for a combination nobody pinned.
  await expect(page.locator(".ps-cell-empty")).toHaveCount(0)
})

test("a long row wraps at six cards", async ({ page }) => {
  await page.goto("/stavy/?view=map")
  const cards = page.locator('[data-toc="page:expense-detail"] [data-instance]')
  await expect.poll(() => cards.count()).toBeGreaterThan(6)
  // Cards sharing a parent row: no row holds more than six. Polled, because the
  // canvas may still be mounting cards when the count first passes six.
  const rows = () =>
    cards.evaluateAll((els) => {
      const by = new Map<Element, number>()
      for (const e of els) by.set(e.parentElement!, (by.get(e.parentElement!) ?? 0) + 1)
      return [...by.values()]
    })
  await expect.poll(async () => { const c = await rows(); return c.length > 1 && Math.max(...c) <= 6 }).toBe(true)
})

test("a flow collapses and expands", async ({ page }) => {
  await page.goto("/stavy/?view=map")
  const lane = page.locator('[data-toc="scenario:employee-submits"]')
  await expect(lane.locator("[data-instance]")).toHaveCount(7)
  await lane.locator(".ps-lane-toggle").dispatchEvent("click")
  await expect(lane.locator("[data-instance]")).toHaveCount(0)
  await lane.locator(".ps-lane-toggle").dispatchEvent("click")
  await expect(lane.locator("[data-instance]")).toHaveCount(7)
  // Steps carry their title under the thumbnail.
  await expect(lane.locator("div.leading-snug", { hasText: "Start a new expense" })).toBeAttached()
})

test("with the dev endpoint, a card without a snapshot can be captured and all snapshots refreshed", async ({ page }) => {
  const posted: unknown[] = []
  await page.route("**/__stavy/scan", async (route) => {
    if (route.request().method() === "POST") posted.push(route.request().postDataJSON())
    await route.fulfill({ status: 202, json: { ok: true } })
  })
  // No snapshot for the first expenses card: it shows the placeholder.
  await page.route("**/snapshots/index.json", (route) => route.fulfill({ json: {} }))
  await page.goto("/stavy/?view=map")
  const card = page.locator('[data-toc="page:expenses"] [data-instance]').first()
  await card.locator(".ps-capture").dispatchEvent("click")
  await expect.poll(() => posted.length).toBe(1)
  expect((posted[0] as { keys: string[] }).keys[0]).toMatch(/^expenses\?/)
  await expect(card.getByText("Capturing")).toBeVisible()

  await page.getByRole("button", { name: "Refresh all snapshots" }).click()
  await expect.poll(() => posted.length).toBe(2)
  expect(posted[1]).toEqual({ all: true })
})
