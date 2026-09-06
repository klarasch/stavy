import { test, expect } from "@playwright/test"

// The player is an overlay over the prototype's own URL (SPEC §2.1): the frame
// shows the page's `url` template filled with the dimension assignment, a
// dimension switch rewrites the frame URL, in-frame navigation onto a
// registered state is followed, and the inspector reads through the frame.

test("the frame shows the prototype at the page url for the dims", async ({ page }) => {
  await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted")
  const frame = page.locator("iframe.ps-frame")
  await expect(frame).toHaveAttribute("src", /\/expenses\/exp-2101\?role=manager&lifecycle=submitted&density=comfortable&locale=en-US&overlay=none$/)
  await expect(page.frameLocator("iframe.ps-frame").locator('[data-proto="ApproveButton"]')).toBeVisible()
})

test("switching a dimension rewrites the frame url", async ({ page }) => {
  await page.goto("/stavy/?p=expenses&d_role=employee&d_state=loaded")
  await page.getByRole("button", { name: /Data state/ }).click()
  await page.getByRole("option", { name: "Empty" }).click()
  await expect(page).toHaveURL(/d_state=empty/)
  await expect(page.locator("iframe.ps-frame")).toHaveAttribute("src", /state=empty/)
  await expect(page.frameLocator("iframe.ps-frame").getByText("No expenses yet", { exact: false })).toBeVisible()
})

test("in-frame navigation onto a registered state is followed", async ({ page }) => {
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded")
  await page.frameLocator("iframe.ps-frame").locator('[data-proto="ExpenseRow:exp-2101"]').click()
  await expect(page).toHaveURL(/[?&]p=expense-detail(?:&|$)/)
  await expect(page).toHaveURL(/d_role=manager/)
})

test("a tour highlights the step target inside the frame", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&d_role=manager&d_state=loaded&tour=manager-approves&ts=0")
  await expect(page.locator(".ps-halo")).toBeVisible()
  const halo = await page.locator(".ps-halo").boundingBox()
  const target = await page.frameLocator("iframe.ps-frame").locator('[data-proto="ViewQueueLink"]').boundingBox()
  expect(halo && target && Math.abs(halo.x + 6 - target.x) < 3).toBe(true)
})

test("the inspector resolves the element under the pointer inside the frame", async ({ page }) => {
  await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted&i=1")
  const target = await page.frameLocator("iframe.ps-frame").locator('[data-proto="ApproveButton"]').boundingBox()
  expect(target).not.toBeNull()
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2)
  await expect(page.getByText("ApproveButton", { exact: true })).toBeVisible()
})

// The inspector panel and what it can tell you about the prototype under it
// (SPEC §3, "Inspector"). These sit at the bottom of the file on purpose:
// appending keeps them out of everyone else's way.
test.describe("inspector", () => {
  /** Centre of a target inside the frame, in host viewport coordinates. */
  async function targetCentre(page: import("@playwright/test").Page, proto: string) {
    const box = await page.frameLocator("iframe.ps-frame").locator(`[data-proto="${proto}"]`).boundingBox()
    expect(box).not.toBeNull()
    return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  }

  // The panel is fixed in a corner over the frame and grows as it fills, so
  // hovering something in that corner used to put the panel under the pointer
  // that summoned it — the hover read fine and the click landed on the panel.
  test("clicking pins the selection, even where the panel would cover it", async ({ page }) => {
    await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted&i=1")
    const panel = page.locator(".ps-inspect-panel")
    await expect(panel).toBeVisible()
    // A target in the panel's own corner: the case that used to fail.
    const at = await targetCentre(page, "ApproveButton")
    expect(at.x).toBeGreaterThan(page.viewportSize()!.width - 400)
    await page.mouse.move(at.x, at.y)
    await expect(page.getByText("ApproveButton", { exact: true })).toBeVisible()
    await expect(panel).toHaveAttribute("data-side", "left") // stepped aside
    await page.mouse.click(at.x, at.y)
    await expect(panel.getByText("pinned", { exact: true })).toBeVisible()
    // Pinned, the panel holds still — it is what the pointer is reaching for now.
    await page.mouse.move(at.x - 4, at.y)
    await expect(panel).toHaveAttribute("data-side", "left")
  })

  // The demo is a CSS-variables design system like any other: the token behind
  // a value is read out of the frame's CSSOM, not guessed from a class name.
  test("a pinned element reports its component, props and the token behind its background", async ({ page }) => {
    await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted&i=1")
    const at = await targetCentre(page, "ApproveButton")
    await page.mouse.move(at.x, at.y)
    await page.mouse.click(at.x, at.y)
    const panel = page.locator(".ps-inspect-panel")
    await expect(panel.getByText("pinned", { exact: true })).toBeVisible()

    // The React component, with the props its author wrote.
    await expect(panel.locator(".ps-crumb", { hasText: /^Button$/ })).toBeVisible()
    await expect(panel.locator("pre")).toContainText("<Button onClick=")

    // Background: a real value, and the custom property it resolves to.
    const background = panel.locator(".ps-kv div", { has: page.locator("dt", { hasText: /^background$/ }) })
    await expect(background).toContainText(/#[0-9a-f]{6}/)
    await expect(background).toContainText("var(--primary)")
    await expect(background).toContainText("background-color ←")
  })

  // A design system that needs more than manifest data points
  // `viewer.inspect.module` at a same-origin ES module. Both the manifest and
  // the module are stubbed here, so the demo itself ships neither.
  test("a viewer.inspect.module is imported and merged over the built-in adapter", async ({ page }) => {
    const module = `export default {
      designSystem: {
        detect: () => true,
        provenance: (el, prop) => ({ token: "--probe-token", chain: ["var(--probe-" + prop + ")"], raw: "probe", inheritedFrom: null }),
      },
    }`
    await page.route("**/stavy.json", async (route) => {
      const manifest = await (await route.fetch()).json()
      manifest.viewer = { ...manifest.viewer, inspect: { tokenPattern: "^--probe-", module: "/stavy-inspect-probe.js" } }
      await route.fulfill({ json: manifest })
    })
    await page.route("**/stavy-inspect-probe.js", (route) => route.fulfill({ body: module, contentType: "text/javascript" }))

    await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted&i=1")
    const at = await targetCentre(page, "ApproveButton")
    await page.mouse.move(at.x, at.y)
    await page.mouse.click(at.x, at.y)
    const panel = page.locator(".ps-inspect-panel")
    await expect(panel.getByText("pinned", { exact: true })).toBeVisible()
    // The module's own provenance, in place of the built-in one…
    await expect(panel).toContainText("--probe-token")
    await expect(panel).toContainText("var(--probe-background-color)")
    // …while everything it did not override keeps working.
    await expect(panel.locator(".ps-crumb", { hasText: /^Button$/ })).toBeVisible()
  })
})
