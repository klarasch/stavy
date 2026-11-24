import { test, expect, type APIRequestContext, type Page } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
// @ts-expect-error plain ES module shipped to adopters as-is
import { mergeRounds, localDate } from "../scripts/lib/rounds.mjs"

// With the dev endpoint (the plugin runs under `npm run dev`) comments are
// round files, stavy-content/rounds/<date>-<author>.json, not browser state:
// placing, replying and resolving write them (one operation at a time, to the
// author's own file), and files written on disk show up in the viewer.

const ROUNDS = "stavy-content/rounds"
const LEGACY = "stavy-content/comments.json"
const API = "/__stavy/rounds"

function clearRounds() {
  rmSync(ROUNDS, { recursive: true, force: true })
  rmSync(LEGACY, { force: true })
}
test.beforeEach(clearRounds)
test.afterEach(clearRounds)

type Thread = Record<string, any>

/** Every thread, merged from the rounds the dev endpoint serves. */
async function threads(request: APIRequestContext): Promise<Thread[]> {
  const r = await request.get(API)
  return mergeRounds((await r.json()).rounds ?? []) as Thread[]
}
/** The merged comments, or null when there are none (read-only / adapter tests expect nothing written). */
async function readFile(request: APIRequestContext) {
  const c = await threads(request)
  return c.length ? { comments: c } : null
}
/** The round files on disk (not index.json). */
function roundFiles(): Array<{ name: string; round: Record<string, any>; text: string }> {
  if (!existsSync(ROUNDS)) return []
  return readdirSync(ROUNDS)
    .filter((n) => n.endsWith(".json") && n !== "index.json")
    .map((name) => {
      const text = readFileSync(`${ROUNDS}/${name}`, "utf8")
      return { name, round: JSON.parse(text), text }
    })
}
/** Seed a reviewer's comments through the endpoint, as the viewer would. */
async function seedRound(request: APIRequestContext, author: string, comments: Thread[]) {
  const date = localDate()
  const r = await request.post(API, { data: { ops: comments.map((comment) => ({ author, date, op: { op: "comment", comment: { author, ...comment } } })) } })
  expect(r.ok()).toBe(true)
}

test("a comment is placed on an element, written to the author's round file, and survives a reload", async ({ page, request }) => {
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
  await page.evaluate(() => localStorage.removeItem("ps-rounds:Orbit"))
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

test("a round file written on disk shows up without a reload", async ({ page }) => {
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded&comments=1")
  await expect(page.getByText("No comments yet")).toBeVisible()
  // An agent or a script writes a round file straight into stavy-content/rounds/.
  mkdirSync(ROUNDS, { recursive: true })
  writeFileSync(
    `${ROUNDS}/2026-01-02-agent.json`,
    JSON.stringify({
      version: 1,
      id: "2026-01-02-agent",
      author: "Agent",
      date: "2026-01-02",
      comments: [
        { id: "agent1", page: "expenses", dims: { role: "manager", state: "loaded" }, x: 10, y: 10, body: "Agent note: empty state copy", author: "Agent", createdAt: "2026-01-02T10:00:00.000Z" },
      ],
      events: [],
    })
  )
  await expect(page.getByText("Agent note: empty state copy")).toBeVisible({ timeout: 6000 })
})

test("read-only (no dev endpoint): comments stay in the browser, export as Markdown and travel as a link", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
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
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ps-rounds:Orbit"))).toContain("Local only")
  expect(await readFile(request)).toBeNull()
  expect(roundFiles()).toEqual([])

  await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted&comments=1")
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Digest .md" }).click()])
  const { readFile: read } = await import("node:fs/promises")
  const md = await read((await download.path())!, "utf8")
  expect(md).toContain("Local only")
  expect(md).toContain("Reader")

  await page.getByRole("button", { name: "Send feedback" }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("#round=")
  const link = await page.evaluate(() => navigator.clipboard.readText())

  // Opening the link (here still without the dev endpoint) offers the round; Import adds it to the browser.
  const fresh = await context.newPage()
  await fresh.route("**/__stavy/health", (route) => route.fulfill({ status: 404, body: "" }))
  await fresh.evaluate(() => localStorage.removeItem("ps-rounds:Orbit")).catch(() => {})
  await fresh.goto(link)
  await expect(fresh.locator("[data-ps-incoming]")).toContainText("Import round: 1 comment from Reader")
  await fresh.locator("[data-ps-incoming]").getByRole("button", { name: "Import", exact: true }).click()
  await expect(fresh.locator("[data-ps-incoming]")).toHaveCount(0)
  await expect.poll(() => fresh.evaluate(() => localStorage.getItem("ps-rounds:Orbit"))).toContain("Local only")
  await page.evaluate(() => localStorage.removeItem("ps-rounds:Orbit"))
  await fresh.evaluate(() => localStorage.removeItem("ps-rounds:Orbit"))
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

  await page.evaluate(() => localStorage.removeItem("ps-rounds:Orbit"))
  await page.reload()
  await expect(rows.nth(2)).toBeVisible()
  const pin = page.locator(`.ps-cbubble[data-comment-id="${saved.id}"]`)
  await expect(pin).toBeVisible()
  await expect.poll(async () => inside(await pinTip(pin), (await cell.boundingBox())!)).toBe(true)
  // …and not on the first row.
  expect(inside(await pinTip(pin), (await rows.nth(0).boundingBox())!)).toBe(false)
})

test("the composer can widen a comment to the parent element", async ({ page, request }) => {
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
  expect(roundFiles()).toEqual([])
})

/* ---------------- rounds: nothing is lost, the state on screen, addressed, import ---------------- */

test("new comments never drop the ones already there", async ({ page, request }) => {
  // An old-format file with three comments, and a viewer whose first load of the rounds fails.
  const old = ["a1", "a2", "a3"].map((id, i) => ({
    id,
    page: "expenses",
    dims: { role: "manager", state: "loaded" },
    x: 10 + i * 10,
    y: 10,
    body: `Old note ${id}`,
    author: "Klara",
    createdAt: new Date(Date.UTC(2026, 9, 1, 10, i)).toISOString(),
    resolved: false,
    replies: [],
  }))
  writeFileSync(LEGACY, JSON.stringify({ version: 2, comments: old }))

  let gets = 0
  await page.route("**/__stavy/rounds", (route) => {
    if (route.request().method() === "GET" && gets++ === 0) return route.abort()
    return route.continue()
  })
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded")
  await expect(page.frameLocator("iframe.ps-frame").locator('[data-proto^="ExpenseRow:"]').first()).toBeVisible()
  await page.locator("body").press("m")
  await page.mouse.click(700, 500)
  await post(page, "Dana's new note", "Dana")
  await expect.poll(async () => (await threads(request)).length).toBe(4)

  const all = await threads(request)
  expect(all.map((c) => c.id).sort()).toEqual(["a1", "a2", "a3", all.find((c) => c.author === "Dana")!.id].sort())
  expect(existsSync(LEGACY)).toBe(false)
  const files = roundFiles()
  const klara = files.filter((f) => f.round.author === "Klara")
  expect(klara).toHaveLength(1)
  expect(klara[0].round.comments.map((c: any) => c.id).sort()).toEqual(["a1", "a2", "a3"])
  const dana = files.filter((f) => f.round.author === "Dana")
  expect(dana).toHaveLength(1)
  expect(dana[0].round.comments.map((c: any) => c.body)).toEqual(["Dana's new note"])
  expect(dana[0].name).not.toBe(klara[0].name)

  // Comments can only be changed one operation at a time, never as a whole file.
  expect((await request.put("/__stavy/content/comments.json", { data: { comments: [] } })).status()).toBe(400)
  expect((await request.put("/__stavy/content/rounds/x.json", { data: { id: "x", comments: [] } })).status()).toBe(400)
})

/** The Orbit frame as a Playwright Frame. */
async function appFrame(page: Page) {
  const h = await page.locator("iframe.ps-frame").elementHandle()
  return (await h!.contentFrame())!
}
/** Click an element inside the frame in comment mode and post. */
async function placeOnFrame(page: Page, body: string) {
  await page.locator("body").press("m")
  const target = page.frameLocator("iframe.ps-frame").locator("[data-proto], main, body").first()
  const box = (await target.boundingBox())!
  await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + Math.min(20, box.height / 2))
  await post(page, body)
}

for (const settled of [false, true]) {
  test(`a comment made after navigating inside the app records the state on screen (${settled ? "after" : "before"} the viewer URL follows)`, async ({ page, request }) => {
    await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded")
    const frame = page.frameLocator("iframe.ps-frame")
    const row = frame.locator('[data-proto^="ExpenseRow:"]').first()
    await expect(row).toBeVisible()
    await row.click()
    const f = await appFrame(page)
    await f.waitForURL(/\/expenses\/[^/?]+/)
    if (settled) await expect(page).toHaveURL(/[?&]p=expense-detail/)
    await placeOnFrame(page, "Comment inside the detail")
    await expect.poll(async () => (await threads(request)).length).toBe(1)
    const saved = (await threads(request))[0]
    expect(saved.page).toBe("expense-detail")
    expect(saved.dims.role).toBe("manager")
    expect(saved.url).toBeUndefined()
  })
}

test("a comment made off the map is remembered by its URL and shown only there", async ({ page, request }) => {
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded")
  const rows = page.frameLocator("iframe.ps-frame").locator('[data-proto^="ExpenseRow:"]')
  await expect(rows.first()).toBeVisible()
  // The app wanders to a URL no state is registered for (it still renders: "Not found").
  await (await appFrame(page)).evaluate(() => {
    history.pushState(null, "", "/nowhere-registered")
    dispatchEvent(new PopStateEvent("popstate"))
  })
  await expect(page.locator(".ps-drift")).toBeVisible({ timeout: 6000 })
  await expect(page.locator(".ps-drift")).toContainText("off the map")
  await placeOnFrame(page, "Seen off the map")
  await expect.poll(async () => (await threads(request)).length).toBe(1)
  const off = (await threads(request))[0]
  expect(off).toMatchObject({ url: "/nowhere-registered", page: "expenses", dims: { role: "manager", state: "loaded" } })
  const offPin = page.locator(`.ps-cbubble[data-comment-id="${off.id}"]`)
  await expect(offPin).toBeVisible()

  // Back on the registered state: that pin is gone, and a comment made here shows.
  if (await page.locator(".ps-cthread").isVisible()) await page.locator('.ps-cthread button[title="Close"]').click() // so an open thread does not pull the frame back
  await page.locator(".ps-drift").getByText("reset").click()
  await expect(page.locator(".ps-drift")).toHaveCount(0, { timeout: 6000 })
  await expect(rows.first()).toBeVisible()
  await expect(offPin).toHaveCount(0)
  await placeOnFrame(page, "Seen on the state")
  await expect.poll(async () => (await threads(request)).length).toBe(2)
  const on = (await threads(request)).find((c) => c.id !== off.id)!
  expect(on.url).toBeUndefined()
  await expect(page.locator(`.ps-cbubble[data-comment-id="${on.id}"]`)).toBeVisible()
  await expect(offPin).toHaveCount(0)
})

test("a comment marked addressed by a script shows as addressed, and Close goes to the viewer's own round", async ({ page, request }) => {
  const logDir = "stavy-content/log"
  const logFile = `${logDir}/${localDate()}.md`
  const hadDir = existsSync(logDir)
  const hadFile = existsSync(logFile)
  const before = hadFile ? readFileSync(logFile, "utf8") : null
  try {
    await seedRound(request, "Dana", [{ id: "addr1", page: "expenses", dims: { role: "manager", state: "loaded" }, x: 20, y: 20, body: "The label is wrong", createdAt: new Date().toISOString() }])
    execFileSync("node", ["scripts/address.mjs", "addr1", "Fixed the label.", "--as", "Claude"])
    const claude = roundFiles().find((f) => f.round.author === "Claude")!
    expect(claude).toBeTruthy()
    const t = (await threads(request)).find((c) => c.id === "addr1")!
    expect(t.status).toBe("addressed")

    await page.addInitScript(() => localStorage.setItem("ps-author", "Tester"))
    await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded&c=addr1")
    const thread = page.locator(".ps-cthread")
    await expect(thread).toContainText("The label is wrong")
    await expect(thread.locator('[data-ps-status="addressed"]')).toBeVisible()
    await expect(thread).toContainText("Fixed the label.")
    await expect(thread).toContainText("Claude")
    await expect(thread.locator(".ps-btn", { hasText: "Close" })).toBeVisible()
    await expect(thread.getByRole("button", { name: "Reopen" })).toBeVisible()

    await thread.locator(".ps-btn", { hasText: "Close" }).click()
    await expect.poll(async () => (await threads(request)).find((c) => c.id === "addr1")?.status).toBe("closed")
    expect(roundFiles().find((f) => f.round.author === "Claude")!.text).toBe(claude.text)
    const tester = roundFiles().find((f) => f.round.author === "Tester")!
    expect(tester.round.events.some((e: any) => e.thread === "addr1" && e.type === "status" && e.status === "closed")).toBe(true)
  } finally {
    if (hadFile) writeFileSync(logFile, before!)
    else if (!hadDir) rmSync(logDir, { recursive: true, force: true })
    else rmSync(logFile, { force: true })
  }
})

test("importing a reviewer's round in the dev viewer writes the round file", async ({ browser, request }) => {
  // The reviewer: read-only viewer (no dev endpoint), one comment, "Send feedback" copies the link.
  const ctx = await browser.newContext()
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"])
  const reviewer = await ctx.newPage()
  await reviewer.route("**/__stavy/health", (route) => route.fulfill({ status: 404, body: "" }))
  await reviewer.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded")
  await expect(reviewer.frameLocator("iframe.ps-frame").locator('[data-proto^="ExpenseRow:"]').first()).toBeVisible()
  await reviewer.locator("body").press("m")
  await reviewer.mouse.click(700, 500)
  await post(reviewer, "From the reviewer", "Reader")
  await expect.poll(() => reviewer.evaluate(() => localStorage.getItem("ps-rounds:Orbit"))).toContain("From the reviewer")
  await reviewer.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded&comments=1")
  await reviewer.getByRole("button", { name: "Send feedback" }).click()
  await expect.poll(() => reviewer.evaluate(() => navigator.clipboard.readText())).toContain("#round=")
  // Sending says only that the link was copied: no instructions, no role.
  await expect(reviewer.getByText("Link copied", { exact: true })).toBeVisible()
  await expect(reviewer.getByText(/designer|imports your round/)).toHaveCount(0)
  const link = await reviewer.evaluate(() => navigator.clipboard.readText())
  await ctx.close()

  // The designer: the dev viewer, which writes the file.
  const designer = await (await browser.newContext()).newPage()
  await designer.goto(link)
  const banner = designer.locator("[data-ps-incoming]")
  await expect(banner).toContainText("Import round: 1 comment from Reader")
  await banner.getByRole("button", { name: "Import", exact: true }).click()
  await expect(banner).toHaveCount(0)
  const file = `${ROUNDS}/${localDate()}-reader.json`
  await expect.poll(() => existsSync(file)).toBe(true)
  const round = JSON.parse(readFileSync(file, "utf8"))
  expect(round.author).toBe("Reader")
  expect(round.comments.map((c: any) => c.body)).toEqual(["From the reviewer"])
  expect((await threads(request)).map((c) => c.body)).toEqual(["From the reviewer"])
  await designer.context().close()
})
