import { test, expect } from "@playwright/test"

// The player is an overlay over the prototype's own URL (SPEC §2.1): the frame
// shows the page's `url` template filled with the dimension assignment, a
// dimension switch rewrites the frame URL, in-frame navigation onto a
// registered state is followed, and the inspector reads through the frame.

test("the frame shows the prototype at the page url for the dims", async ({ page }) => {
  await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted")
  const frame = page.locator("iframe.ps-frame")
  await expect(frame).toHaveAttribute("src", /\/expenses\/exp-2101\?role=manager&lifecycle=submitted&locale=en-US&overlay=none$/)
  await expect(page.frameLocator("iframe.ps-frame").locator('[data-proto="ApproveButton"]')).toBeVisible()
})

test("switching a dimension rewrites the frame url", async ({ page }) => {
  await page.goto("/stavy/?p=expenses&d_role=employee&d_state=loaded")
  await page.getByRole("button", { name: /Data state/ }).click()
  await page.getByRole("option", { name: "Empty" }).click()
  await expect(page).toHaveURL(/d_state=empty/)
  // The frame navigates client-side now (pushState, not a `src` rewrite — see
  // navigateFrame in frame.ts), so the live URL is asserted through the frame's
  // own window rather than the iframe element's `src` attribute.
  const frame = page.locator("iframe.ps-frame")
  await expect.poll(() => frame.evaluate((el: HTMLIFrameElement) => el.contentWindow?.location.href)).toContain("state=empty")
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

// Item 1 (adopter feedback): tour steps used to rewrite the iframe's `src`,
// which the browser treats as a document load — the frame re-bootstrapped on
// every step and any state built up in the app was lost. navigateFrame()
// (frame.ts) pushes into the frame's own history and dispatches a popstate
// instead, for a same-origin frame with a live document.
test("tour steps navigate the frame client-side, without reloading it", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&tour=employee-submits&ts=0")
  const frame = page.locator("iframe.ps-frame")
  await frame.evaluate((el: HTMLIFrameElement) => {
    ;(el.contentWindow as unknown as { __stamp?: number }).__stamp = 1
  })
  // employee-submits: dashboard -> submit-expense (details/receipt/review/done) -> expenses.
  // Every step but the page itself changes; a real navigation anywhere in
  // there would reset the stamp and add a navigation entry.
  for (let i = 1; i <= 5; i++) {
    await page.getByRole("button", { name: "Next" }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]ts=${i}(&|$)`))
  }
  const stamp = await frame.evaluate((el: HTMLIFrameElement) => (el.contentWindow as unknown as { __stamp?: number }).__stamp)
  expect(stamp).toBe(1)
  const navCount = await frame.evaluate((el: HTMLIFrameElement) => el.contentWindow?.performance.getEntriesByType("navigation").length)
  expect(navCount).toBe(1)
})

// Item 2 (adopter feedback): a deep link straight into a tour step, with no
// d_* params yet, used to render the page's defaults until Next was pressed.
// expense-detail defaults to role=employee (no ApproveButton); step 2 of
// manager-approves pins role=manager, so the step's own dims must apply
// immediately.
test("a deep link into a tour step resolves dims from the step, not the page defaults", async ({ page }) => {
  await page.goto("/stavy/?p=expense-detail&tour=manager-approves&ts=2")
  await expect(page.frameLocator("iframe.ps-frame").locator('[data-proto="ApproveButton"]')).toBeVisible()
})

// Item 2, continued: the tour is the intent, so a stale/mismatched `p` in the
// URL (here: dashboard, but step 2 of manager-approves is expense-detail)
// must not win over the step's own page.
test("a deep link whose page disagrees with the tour step uses the step's page", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&tour=manager-approves&ts=2")
  await expect(page.frameLocator("iframe.ps-frame").locator('[data-proto="ApproveButton"]')).toBeVisible()
})

// Item 3 (adopter feedback): after clicking inside the app frame, the tour's
// arrow-key hotkeys stopped working. bridgeFrameKeys (frame.ts) forwards the
// frame's keydown/keyup to the host window — but it listened in the bubble
// phase. Root cause: a focused widget with its own keyboard handling (a UI
// kit's listbox, roving-tabindex menu, a modal focus trap — anything managing
// its own arrow-key navigation) commonly calls stopPropagation() on keydown so
// it doesn't also trigger page-level shortcuts. That stops the event on its
// way up through bubble listeners, exactly where the bridge used to sit —
// silently losing the hotkey the moment focus lands on such a widget. The
// plain demo has no such widget, so this simulates one the way a real design
// system's component does.
test("arrow keys still step the tour when a focused frame widget stops keydown propagation", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&d_role=manager&d_state=loaded&tour=manager-approves&ts=0")
  const dashboardTab = page.frameLocator("iframe.ps-frame").getByRole("button", { name: "Dashboard" })
  await dashboardTab.evaluate((el) => el.addEventListener("keydown", (e) => e.stopPropagation()))
  await dashboardTab.click()
  await page.keyboard.press("ArrowRight")
  await expect(page).toHaveURL(/[?&]ts=1(&|$)/, { timeout: 3000 })
})

// Item 3, continued: the bridge must still never hijack typing — the capture-
// phase fix must not turn into "every keystroke gets forwarded regardless of
// where it lands".
test("typing inside a frame input is never hijacked by tour hotkeys", async ({ page }) => {
  await page.goto("/stavy/?p=submit-expense&tour=employee-submits&ts=1")
  const merchant = page.frameLocator("iframe.ps-frame").locator("#merchant")
  await merchant.click()
  // ArrowLeft/ArrowRight are the tour's own hotkeys — inside a text field they
  // must move the cursor, never step the tour. Checked after each key so a
  // stray Prev-then-Next couldn't mask a real hijack.
  await merchant.press("ArrowLeft")
  await expect(page).toHaveURL(/[?&]ts=1(&|$)/)
  await merchant.press("ArrowRight")
  await expect(page).toHaveURL(/[?&]ts=1(&|$)/)
})

// Item 4: navigateFrame (Item 1) makes the frame's document persist across
// ordinary steps, so useFrameDocument's load-listener/poll matters less day
// to day — but drift recovery still does a real `iframe.src` reload
// (resetFrame in PageView.tsx), and `doc` must still pick up that new
// document afterwards (the halo, the inspector and the hotkey bridge all read
// through it).
test("drift is detected and reset returns to the registered state with a live document", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&d_role=manager&d_state=loaded")
  await expect(page.frameLocator("iframe.ps-frame").locator('[data-proto="ViewQueueLink"]')).toBeVisible()

  // The prototype navigating itself somewhere the manifest doesn't know about.
  await page.locator("iframe.ps-frame").evaluate((el: HTMLIFrameElement) => {
    const win = el.contentWindow as unknown as { history: History; dispatchEvent: (e: Event) => boolean; PopStateEvent: typeof PopStateEvent }
    win.history.pushState({}, "", "/somewhere-not-registered")
    win.dispatchEvent(new win.PopStateEvent("popstate"))
  })
  await expect(page.getByText("off the map")).toBeVisible()

  await page.getByText("reset", { exact: true }).click()
  await expect(page.getByText("off the map")).toHaveCount(0)
  // The reset was a real reload (not navigateFrame) — confirm the frame's
  // document came back live, not just that the drift chip cleared.
  await expect(page.frameLocator("iframe.ps-frame").locator('[data-proto="ViewQueueLink"]')).toBeVisible()
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
