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
      { id: "done", dims: { step: "done" }, status: "ready", ready: { at: "2026-10-01", by: "Morgan", snapshots: { "submit-expense?_state=done": "an-old-hash" } } },
    ]
    delete p.instances
  })
  // The current scan has a different hash for "done" than when it was marked ready.
  await page.route("**/snapshots/index.json", async (route) => {
    const index = await (await route.fetch()).json()
    index["submit-expense?_state=done"] = { ...(Object.values(index)[0] as object), hash: "a-new-hash" }
    await route.fulfill({ json: index })
  })
  await page.goto("/stavy/?view=map&x=submit-expense")
  const area = page.locator('[data-toc="page:submit-expense"]')
  await expect(area).toHaveCount(1)
  await expect(area.locator("[data-instance]")).toHaveCount(4)
  // Labels from the states (humanised when none is given), their notes, never "_state".
  await expect(area.getByText("Receipt", { exact: true }).first()).toBeAttached()
  await expect(area.getByText("Check before sending")).toBeAttached()
  await expect(area.getByText("4 states")).toBeAttached()
  expect(await area.innerText()).not.toMatch(/_state/i)
  await expect(area.locator(".ps-status-review").first()).toHaveText("In review")
  // A state marked ready shows it on its card, and that its picture changed since.
  const done = area.locator(`[data-instance="submit-expense?_state=done"]`)
  await expect(done.locator(".ps-status-ready")).toHaveText("Ready for dev")
  await expect(done.getByText("Changed since ready")).toBeVisible()
  // Nothing is ever drawn for a combination nobody pinned.
  await expect(page.locator(".ps-cell-empty")).toHaveCount(0)
})

test("a long row wraps at six cards", async ({ page }) => {
  await page.goto("/stavy/?view=map&x=expense-detail")
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
  await expect.poll(async () => { const c = await rows(); return c.length > 1 && Math.max(...c) <= 6 }, { timeout: 15_000 }).toBe(true)
})

test("a flow starts folded to its first and last step, and opens and folds again", async ({ page }) => {
  await page.goto("/stavy/?view=map")
  const lane = page.locator('[data-toc="scenario:employee-submits"]')
  await expect(lane.getByText("8 steps")).toBeAttached()
  await expect(lane.locator("[data-instance]")).toHaveCount(0)
  await expect(lane.locator(".ps-lane-peek .ps-lane-thumb")).toHaveCount(2)
  await expect(lane.locator(".ps-lane-peek")).toContainText("6 more")
  await lane.locator(".ps-lane-toggle").dispatchEvent("click")
  await expect(lane.locator("[data-instance]")).toHaveCount(8)
  await expect(page).toHaveURL(/[?&]fl=employee-submits(&|$)/)
  // Steps carry their title under the thumbnail.
  await expect(lane.locator("div.leading-snug", { hasText: "Start a new expense" })).toBeAttached()
  await lane.locator(".ps-lane-toggle").dispatchEvent("click")
  await expect(lane.locator("[data-instance]")).toHaveCount(0)
  await expect(page).not.toHaveURL(/[?&]fl=/)
})

// The map is an overview: one card per screen, every state one step away.
const screenCards = (page: Page) => page.locator('[data-toc^="page:"] [data-instance]')

test("the overview shows one card per screen, with its state count on it", async ({ page }) => {
  await page.goto("/stavy/?view=map")
  await page.locator('[data-toc="page:expense-detail"]').waitFor()
  const screens = await page.locator('section[data-toc^="page:"]').count()
  expect(screens).toBeGreaterThan(4)
  await expect(screenCards(page)).toHaveCount(screens)
  const detail = page.locator('[data-toc="page:expense-detail"]')
  await expect(detail.locator("[data-instance]")).toHaveCount(1)
  await expect(detail.locator(".ps-disclose")).toHaveText("7 states")
  // A screen with one state and nothing else to show has no control.
  await expect(page.locator('[data-toc="page:policy"] .ps-disclose')).toHaveCount(0)
  // The workspace's boards are links to the board; diagrams are chips until one is opened.
  await expect(page.locator('[data-toc="area:boards"] [data-board-link]')).toHaveCount(2)
  await expect(page.locator('[data-toc="area:boards"] button.ps-board-chip')).toHaveCount(4)
  await expect(page.locator('[data-toc="board:ia"]')).toHaveCount(0)
})

test("the state count opens a screen in place, and folds it again", async ({ page }) => {
  await page.goto("/stavy/?view=map")
  const detail = page.locator('[data-toc="page:expense-detail"]')
  await detail.locator(".ps-disclose").click()
  await expect(detail.locator("[data-instance]")).toHaveCount(7)
  await expect(page).toHaveURL(/[?&]x=expense-detail(&|$)/)
  // Open, the screen shows its anatomy too.
  await expect(detail.getByText("Anatomy", { exact: true })).toBeAttached()
  await detail.locator(".ps-disclose").click()
  await expect(detail.locator("[data-instance]")).toHaveCount(1)
  await expect(page).not.toHaveURL(/[?&]x=/)
})

test("double-clicking a folded screen's title opens it", async ({ page }) => {
  await page.goto("/stavy/?view=map")
  const area = page.locator('[data-toc="page:dashboard"]')
  await area.locator(".ps-area-title").dispatchEvent("dblclick")
  await expect(area.locator("[data-instance]")).toHaveCount(4)
})

test("All states (A) shows everything, and back", async ({ page }) => {
  await page.goto("/stavy/?view=map")
  await page.locator('[data-toc="page:expense-detail"]').waitFor()
  await expect(screenCards(page)).toHaveCount(await page.locator('section[data-toc^="page:"]').count())
  await page.keyboard.press("a")
  await expect(page).toHaveURL(/[?&]states=all(&|$)/)
  await expect(page.locator('[data-toc="page:expense-detail"] [data-instance]')).toHaveCount(7)
  await expect(page.locator('[data-toc="scenario:employee-submits"] [data-instance]')).toHaveCount(8)
  await expect(page.locator('[data-toc="board:ia"]')).toHaveCount(1)
  // Folding one screen keeps the rest open, spelled out in the link.
  await page.locator('[data-toc="page:expense-detail"] .ps-disclose').click()
  await expect(page.locator('[data-toc="page:expense-detail"] [data-instance]')).toHaveCount(1)
  await expect(page.locator('[data-toc="page:dashboard"] [data-instance]')).toHaveCount(4)
  await expect(page).not.toHaveURL(/states=all/)
  await page.getByRole("button", { name: "All states" }).click()
  await expect(page).toHaveURL(/[?&]states=all(&|$)/)
  await page.getByRole("button", { name: "All states" }).click()
  await expect(page).not.toHaveURL(/[?&](states|x|fl|bx)=/)
  await expect(page.locator('[data-toc="page:dashboard"] [data-instance]')).toHaveCount(1)
})

test("a link to one state opens its screen and lands on the card", async ({ page }) => {
  // Dims may be partial; the rest come from the screen's defaults, as in the player.
  await page.goto(`/stavy/?${new URLSearchParams({ view: "map", at: "expense-detail?role=finance&lifecycle=approved" })}`)
  const card = page.locator('[data-toc="page:expense-detail"] [data-instance*="lifecycle=approved"][data-instance*="role=finance"]')
  await expect(card).toHaveCount(1)
  await expect(page).toHaveURL(/[?&]x=expense-detail(&|$)/)
  await expect(page).not.toHaveURL(/[?&]at=/)
  await expect(card).toBeInViewport()
})

test("the contents open a board folded to a chip", async ({ page }) => {
  await page.goto("/stavy/?view=map")
  await page.locator(".ps-toc-item", { hasText: "Information architecture" }).click()
  await expect(page.locator('[data-toc="board:ia"][data-flash]')).toHaveCount(1)
  await expect(page).toHaveURL(/[?&]bx=ia(&|$)/)
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

test("board and map arrows are drawn, not clipped by their 1px svg", async ({ page }) => {
  await page.goto("/stavy/?b=approval-story")
  const svg = page.locator(".ps-board-arrows").first()
  await expect(svg).toBeAttached()
  expect(await svg.evaluate((el) => getComputedStyle(el).overflow)).toBe("visible")
  const path = page.locator("path.ps-board-arrow").first()
  const box = await path.boundingBox()
  expect((box?.width ?? 0) + (box?.height ?? 0)).toBeGreaterThan(10)
})

test("a board link on the map opens the board itself", async ({ page }) => {
  await page.goto("/stavy/?view=map")
  await page.locator('[data-board-link="approval-story"]').click()
  await expect(page).toHaveURL(/[?&]b=approval-story/)
})

test("edit mode keeps only the editing tools in the toolbar", async ({ page }) => {
  await page.goto("/stavy/?view=map&e=1")
  await expect(page.getByRole("button", { name: /Done/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /All states/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Wireframe/ })).toHaveCount(0)
})

test("a map sticky that points at an element draws a line to it", async ({ page }) => {
  await page.goto("/stavy/?view=map")
  await expect(page.locator('[data-map-pointers] [data-pointer="n-actions"]')).toHaveCount(1)
})
