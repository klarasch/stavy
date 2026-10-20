import { test, expect } from "@playwright/test"

// With the dev endpoint (the plugin runs under `npm run dev`) comments are a
// file — stavy-content/comments.json — not browser state: placing, replying
// and resolving write it, and edits to the file show up in the viewer.

const FILE = "/stavy-content/comments.json"
const API = "/__stavy/content/comments.json"

test.afterEach(async ({ request }) => {
  await request.delete(API)
})

async function readFile(request: import("@playwright/test").APIRequestContext) {
  const r = await request.get(FILE)
  const text = r.ok() ? await r.text() : ""
  // (the dev server answers a missing file with index.html)
  return text.trimStart().startsWith("{") ? (JSON.parse(text) as { comments: Array<Record<string, any>> }) : null
}

test("a comment is placed on an element, written to comments.json, and survives a reload", async ({ page, request }) => {
  await request.delete(API)
  await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted")
  const approve = page.frameLocator("iframe.ps-frame").locator('[data-proto="ApproveButton"]')
  await expect(approve).toBeVisible()

  // Place: M, then click on the element.
  await page.locator("body").press("m")
  const box = (await approve.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  // The name is asked once.
  await page.getByPlaceholder("Your name").fill("Tester")
  await page.getByPlaceholder("What should change, and why?").fill("Make this clearer")
  await page.getByRole("button", { name: "Post" }).click()
  await expect(page.locator(".ps-cbubble").first()).toBeVisible()

  await expect.poll(async () => (await readFile(request))?.comments.length).toBe(1)
  const saved = (await readFile(request))!.comments[0]
  expect(saved).toMatchObject({
    page: "expense-detail",
    dims: { role: "manager", lifecycle: "submitted" },
    target: "ApproveButton",
    author: "Tester",
    body: "Make this clearer",
    resolved: false,
  })
  expect(Array.isArray(saved.path)).toBe(true)
  expect(new Date(saved.createdAt).toString()).not.toBe("Invalid Date")

  // From the file, not from this browser: wipe local storage and reload.
  await page.evaluate(() => localStorage.removeItem("ps-comments:Orbit"))
  await page.reload()
  await expect(page.locator(".ps-cbubble").first()).toBeVisible()

  // Resolve from the thread: the file follows.
  await page.locator(".ps-cbubble").first().click()
  await expect(page.getByText("Make this clearer")).toBeVisible()
  await page.getByRole("button", { name: "Resolve" }).click()
  await expect.poll(async () => (await readFile(request))?.comments[0].resolved).toBe(true)

  // Reply keeps the name that was given once.
  await page.getByPlaceholder("Reply…").fill("Done in the next version")
  await page.getByPlaceholder("Reply…").press("Enter")
  await expect.poll(async () => (await readFile(request))?.comments[0].replies?.[0]?.body).toBe("Done in the next version")
  expect((await readFile(request))!.comments[0].replies[0].author).toBe("Tester")
})

test("an edit to comments.json shows up without a reload", async ({ page, request }) => {
  await request.delete(API)
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded&comments=1")
  await expect(page.getByText("No comments yet")).toBeVisible()
  await request.put(API, {
    data: {
      version: 1,
      comments: [
        {
          id: "agent1",
          page: "expenses",
          dims: { role: "manager", state: "loaded" },
          x: 10,
          y: 10,
          body: "Agent note: empty state copy",
          author: "Agent",
          createdAt: "2026-01-02T10:00:00.000Z",
          resolved: false,
          replies: [],
        },
      ],
    },
  })
  await expect(page.getByText("Agent note: empty state copy")).toBeVisible({ timeout: 6000 })
})

test("read-only (no dev endpoint): comments stay in the browser and export as Markdown", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await request.delete(API)
  await page.route("**/__stavy/health", (route) => route.fulfill({ status: 404, body: "" }))
  await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted")
  const approve = page.frameLocator("iframe.ps-frame").locator('[data-proto="ApproveButton"]')
  await expect(approve).toBeVisible()
  await page.locator("body").press("m")
  const box = (await approve.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.getByPlaceholder("Your name").fill("Reader")
  await page.getByPlaceholder("What should change, and why?").fill("Local only")
  await page.getByRole("button", { name: "Post" }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ps-comments:Orbit"))).toContain("Local only")
  expect(await readFile(request)).toBeNull()

  await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted&comments=1")
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: ".md" }).click()])
  const { readFile: read } = await import("node:fs/promises")
  const md = await read((await download.path())!, "utf8")
  expect(md).toContain("Local only")
  expect(md).toContain("Reader")

  await page.getByRole("button", { name: "Link" }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("#c=")
  await page.evaluate(() => localStorage.removeItem("ps-comments:Orbit"))
})

/* ---------------- precise anchors, boards, docs, the one panel, the adapter seam ---------------- */

/** The pin's tip (bottom centre of the bubble) in page coordinates. */
async function pinTip(loc: import("@playwright/test").Locator) {
  const b = (await loc.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height }
}
const inside = (p: { x: number; y: number }, b: { x: number; y: number; width: number; height: number }, slack = 2) =>
  p.x >= b.x - slack && p.x <= b.x + b.width + slack && p.y >= b.y - slack && p.y <= b.y + b.height + slack

async function post(page: import("@playwright/test").Page, body: string, name = "Tester") {
  const nameField = page.getByPlaceholder("Your name")
  if (await nameField.isVisible().catch(() => false)) await nameField.fill(name)
  await page.getByPlaceholder("What should change, and why?").fill(body)
  await page.getByRole("button", { name: "Post" }).click()
}

test("a comment on one table cell lands on that cell after a reload (not on the first row)", async ({ page, request }) => {
  await request.delete(API)
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded")
  const frame = page.frameLocator("iframe.ps-frame")
  const rows = frame.locator('[data-proto^="ExpenseRow:"]')
  await expect(rows.nth(2)).toBeVisible()
  const cell = rows.nth(2).locator("td").nth(1)
  const cellText = ((await cell.textContent()) ?? "").trim()
  const rowId = await rows.nth(2).getAttribute("data-proto")

  await page.locator("body").press("m")
  const box = (await cell.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator(".ps-ctarget-tag")).toBeVisible() // the hover outline names what it will attach to
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator("[data-ps-anchor]")).toContainText(cellText)
  await post(page, "This category is wrong")

  await expect.poll(async () => (await readFile(request))?.comments.length).toBe(1)
  const saved = (await readFile(request))!.comments[0]
  expect(saved).toMatchObject({ page: "expenses", target: rowId, snippet: cellText, path: [1] })
  expect(saved.box).toBeTruthy()

  await page.evaluate(() => localStorage.removeItem("ps-comments:Orbit"))
  await page.reload()
  await expect(rows.nth(2)).toBeVisible()
  const pin = page.locator(`.ps-cbubble[data-comment-id="${saved.id}"]`)
  await expect(pin).toBeVisible()
  await expect.poll(async () => inside(await pinTip(pin), (await cell.boundingBox())!)).toBe(true)
  // …and not on the first row.
  expect(inside(await pinTip(pin), (await rows.nth(0).boundingBox())!)).toBe(false)
})

test("the composer can widen a comment to the parent element", async ({ page, request }) => {
  await request.delete(API)
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded")
  const row = page.frameLocator("iframe.ps-frame").locator('[data-proto^="ExpenseRow:"]').nth(1)
  await expect(row).toBeVisible()
  const cell = row.locator("td").nth(0)
  await page.locator("body").press("m")
  const box = (await cell.boundingBox())!
  await page.mouse.click(box.x + 8, box.y + box.height / 2)
  await page.getByRole("button", { name: "Parent" }).click()
  await expect(page.locator("[data-ps-anchor]")).toContainText("@ExpenseRow:")
  await post(page, "The whole row")
  await expect.poll(async () => (await readFile(request))?.comments[0]?.path).toEqual([])
})

test("a board comment sits on its item, survives a reload and follows the zoom", async ({ page, request }) => {
  await request.delete(API)
  await page.goto("/stavy/?b=approval-story")
  const item = page.locator('[data-item-id="m-review"]')
  await expect(item).toBeVisible()
  await page.locator("body").press("m")
  const box = (await item.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5)
  // Clicking a screen in comment mode does not open the player.
  await expect(page).toHaveURL(/[?&]b=approval-story/)
  await post(page, "Show who reviews")

  await expect.poll(async () => (await readFile(request))?.comments.length).toBe(1)
  const saved = (await readFile(request))!.comments[0]
  expect(saved).toMatchObject({ board: "approval-story", item: "m-review" })
  expect(saved.x).toBeGreaterThan(20)
  expect(saved.x).toBeLessThan(40)

  await page.reload()
  const pin = page.locator(`.ps-cpin [data-comment-id="${saved.id}"]`)
  await expect(pin).toBeVisible()
  await expect.poll(async () => inside(await pinTip(pin), (await item.boundingBox())!, 4)).toBe(true)
  await page.locator("body").press("+")
  await page.waitForTimeout(600)
  expect(inside(await pinTip(pin), (await item.boundingBox())!, 4)).toBe(true)

  // A point on the empty board.
  await page.locator("body").press("m")
  await page.mouse.click(30, 700)
  await post(page, "Room for a legend here")
  await expect.poll(async () => (await readFile(request))?.comments.length).toBe(2)
  const point = (await readFile(request))!.comments[1]
  expect(point.board).toBe("approval-story")
  expect(point.item).toBeUndefined()
})

test("a doc comment highlights its passage, and the panel takes you there from anywhere", async ({ page, request }) => {
  await request.delete(API)
  await page.goto("/stavy/?doc=approval-rules")
  const md = page.locator(".ps-docs-md")
  await expect(md.getByText("Finance never approves.")).toBeVisible()
  // Select a sentence, as a reader would.
  await page.evaluate(() => {
    const root = document.querySelector(".ps-docs-md")!
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let n: Text | null
    while ((n = walker.nextNode() as Text | null)) {
      const i = n.data.indexOf("Finance never approves.")
      if (i >= 0) {
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + "Finance never approves.".length)
        getSelection()!.removeAllRanges()
        getSelection()!.addRange(r)
        root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
        return
      }
    }
  })
  await page.getByRole("button", { name: "Comment" }).click()
  await post(page, "And who reimburses rejected ones?")
  await expect.poll(async () => (await readFile(request))?.comments.length).toBe(1)
  const saved = (await readFile(request))!.comments[0]
  expect(saved).toMatchObject({ doc: "approval-rules", quote: "Finance never approves.", heading: "Who approves" })

  await page.reload()
  await expect(page.locator(`mark.ps-chl[data-cid="${saved.id}"]`)).toHaveText("Finance never approves.")
  await expect(page.locator(`.ps-cmargin[data-comment-id="${saved.id}"]`)).toBeVisible()

  // From the map, "everywhere" lists it; clicking it opens the doc with the thread.
  await page.goto("/stavy/?comments=1")
  await page.getByRole("button", { name: "Everywhere" }).click()
  await page.locator(`[data-comment-row="${saved.id}"]`).click()
  await expect(page).toHaveURL(/[?&]doc=approval-rules/)
  // The doc renders, then its comment layer re-applies highlights and opens the thread.
  await expect(page.locator(".ps-cthread")).toContainText("And who reimburses rejected ones?", { timeout: 10_000 })
})

test("a workspace comments adapter module receives and lists comments", async ({ page, request }) => {
  await request.delete(API)
  const manifest = await (await request.get("/stavy.json")).json()
  manifest.viewer = { ...(manifest.viewer ?? {}), comments: { adapter: { module: "/test-comments-adapter.js" } } }
  await page.route("**/stavy.json", (route) => route.fulfill({ json: manifest }))
  await page.route("**/test-comments-adapter.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `const w = window; w.__saved ??= [{ id: "srv1", board: "approval-story", item: "intro", x: 50, y: 50, body: "From the server", author: "API", createdAt: 1700000000000, resolved: false, replies: [] }];
        export async function list() { return w.__saved }
        export async function save(c) { w.__saved.push(c) }
        export async function update(id, patch) { w.__saved = w.__saved.map((c) => c.id === id ? { ...c, ...patch } : c) }`,
    })
  )
  await page.goto("/stavy/?b=approval-story&comments=1")
  await expect(page.getByText("From the server")).toBeVisible()
  await expect(page.locator("[data-ps-storage]")).toHaveAttribute("data-ps-storage", "module")
  await page.getByRole("button", { name: "New comment" }).click()
  await page.mouse.click(30, 700)
  await post(page, "Via the adapter")
  await expect.poll(() => page.evaluate(() => (window as any).__saved.map((c: any) => c.body))).toContain("Via the adapter")
  expect(await readFile(request)).toBeNull()
})
