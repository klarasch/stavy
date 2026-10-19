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
