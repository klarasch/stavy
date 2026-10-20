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

// The toolbar is a docked, full-width bottom bar unless the manifest says
// otherwise, and the "mock only" notice is part of it, floating or docked.
test("the toolbar is the docked bottom bar by default, with the mock notice inside it", async ({ page }) => {
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded")
  const dock = page.locator(".ps-dock")
  await expect(dock).toHaveAttribute("data-anchor", "bar-bottom")
  await expect(dock.locator(".ps-dock-pill .ps-dock-notice")).toContainText("Mock only")
  const bar = (await dock.boundingBox())!
  expect(bar.x).toBe(0)
  expect(bar.width).toBe(page.viewportSize()!.width)
  // The bar takes its own space: the prototype's viewport ends where it starts.
  const frame = (await page.locator("iframe.ps-frame").boundingBox())!
  expect(frame.y + frame.height).toBeLessThanOrEqual(bar.y + 1)
})

test("a floating toolbar carries the mock notice attached to the pill", async ({ page }) => {
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded&tb=bottom")
  const pill = page.locator(".ps-dock-pill")
  const notice = pill.locator(".ps-dock-notice")
  await expect(notice).toContainText("Mock only")
  const p = (await pill.boundingBox())!
  const n = (await notice.boundingBox())!
  expect(n.y).toBeGreaterThanOrEqual(p.y)
  expect(n.y + n.height).toBeLessThanOrEqual(p.y + p.height + 1)
})

test("a page with named states switches between them by their names", async ({ page }) => {
  await page.route("**/stavy.json", async (route) => {
    const manifest = await (await route.fetch()).json()
    const p = manifest.pages.find((x: { id: string }) => x.id === "submit-expense")
    p.states = [
      { id: "details", label: "Details", dims: { step: "details" } },
      { id: "receipt-upload", dims: { step: "receipt" } },
    ]
    delete p.instances
    await route.fulfill({ json: manifest })
  })
  await page.goto("/stavy/?p=submit-expense")
  await page.getByRole("button", { name: /State/ }).click()
  await page.getByRole("option", { name: "Receipt upload" }).click()
  await expect(page).toHaveURL(/d__state=receipt-upload/)
  await expect(page.frameLocator("iframe.ps-frame").getByText("Attach a receipt")).toBeVisible()
  // The frame sits on the state's own URL, so it is not "off the map".
  await expect(page.getByText("off the map")).toHaveCount(0)
  expect(await page.locator("body").innerText()).not.toMatch(/_state/)
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

// The tour card header packs a scenario chip, a step counter and a close
// button into one row (TourOverlay.tsx). A long scenario label used to have
// nowhere to shrink: the chip stayed at its full nowrap width, squeezing the
// counter down to a few px where "1 / 5" wrapped into "1 / / / 5" and shoving
// the close button against the edge of the card.
test("a long scenario label truncates instead of squeezing the step counter or close button", async ({ page }) => {
  const longLabel = "Employee submits a very unusually long expense report scenario label"
  await page.route("**/stavy.json", async (route) => {
    const manifest = await (await route.fetch()).json()
    const scenario = manifest.scenarios.find((s: { id: string }) => s.id === "manager-approves")
    scenario.label = longLabel
    await route.fulfill({ json: manifest })
  })

  await page.goto("/stavy/?p=dashboard&d_role=manager&d_state=loaded&tour=manager-approves&ts=0")
  const card = page.locator(".ps-glass-strong")
  await expect(card).toBeVisible()

  const counter = page.getByText(/^\d+ \/ \d+$/)
  await expect(counter).toBeVisible()
  await expect(counter).toHaveText(/^1 \/ \d+$/)
  const counterBox = await counter.boundingBox()
  expect(counterBox).not.toBeNull()
  expect(counterBox!.height).toBeLessThan(24)

  const closeButton = page.getByTitle("Exit tour")
  const closeBox = await closeButton.boundingBox()
  const cardBox = await card.boundingBox()
  expect(closeBox).not.toBeNull()
  expect(cardBox).not.toBeNull()
  expect(closeBox!.x).toBeGreaterThanOrEqual(cardBox!.x)
  expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 0.5)

  // The close button is pinned to the card's top-right corner, whatever the header holds.
  expect(closeBox!.y).toBeLessThan(cardBox!.y + 20)
  expect(cardBox!.x + cardBox!.width - (closeBox!.x + closeBox!.width)).toBeLessThan(20)

  // The truncated chip still carries the full label for hover discovery.
  await expect(page.locator(".ps-chip", { hasText: /^Employee/ })).toHaveAttribute("title", longLabel)
})

test("the inspector resolves the element under the pointer inside the frame", async ({ page }) => {
  await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted&i=1")
  const target = await page.frameLocator("iframe.ps-frame").locator('[data-proto="ApproveButton"]').boundingBox()
  expect(target).not.toBeNull()
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2)
  await expect(page.locator('.ps-inspect-panel [data-section="selection"]').getByText("ApproveButton", { exact: true })).toBeVisible()
})

// Item 1 (adopter feedback): tour steps used to rewrite the iframe's `src`,
// which the browser treats as a document load — the frame re-bootstrapped on
// every step and any state built up in the app was lost. navigateFrame()
// (frame.ts) pushes into the frame's own history and dispatches a popstate
// instead, for a same-origin frame with a live document.
test("tour steps navigate the frame client-side, without reloading it", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&tour=employee-submits&ts=0")
  const frame = page.locator("iframe.ps-frame")
  // The frame's real document must be up before it is stamped.
  await expect(page.locator(".ps-halo")).toBeVisible()
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

// The app gets the click. The tour used to swallow it and navigate the frame
// to the next step's URL, so anything the click itself creates never existed.
test("clicking a step's target reaches the app, and the tour advances without touching the frame", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&d_role=manager&d_state=loaded&tour=manager-approves&ts=0")
  const frame = page.locator("iframe.ps-frame")
  await expect(page.locator(".ps-halo")).toBeVisible()
  await frame.evaluate((el: HTMLIFrameElement) => {
    ;(el.contentWindow as unknown as { __stamp?: number }).__stamp = 1
  })
  const t0 = Date.now()
  await page.frameLocator("iframe.ps-frame").locator('[data-proto="ViewQueueLink"]').click()
  await expect(page).toHaveURL(/[?&]ts=1(&|$)/, { timeout: 1400 })
  // In place: well before the 1.5 s fallback navigation could have run.
  expect(Date.now() - t0).toBeLessThan(1400)
  // The URL is the app's own (its link has no state param), not the viewer's rewrite of it.
  const href = await frame.evaluate((el: HTMLIFrameElement) => el.contentWindow!.location.href)
  expect(href).toMatch(/\/expenses\?role=manager$/)
  expect(await frame.evaluate((el: HTMLIFrameElement) => (el.contentWindow as unknown as { __stamp?: number }).__stamp)).toBe(1)
  await expect(page.locator(".ps-halo")).toBeVisible()
})

test("Next clicks the current target like a reviewer would", async ({ page }) => {
  await page.goto("/stavy/?p=dashboard&d_role=manager&d_state=loaded&tour=manager-approves&ts=0")
  await expect(page.locator(".ps-halo")).toBeVisible()
  await page.getByRole("button", { name: "Next" }).click()
  await expect(page).toHaveURL(/[?&]ts=1(&|$)/, { timeout: 1400 })
  const href = await page.locator("iframe.ps-frame").evaluate((el: HTMLIFrameElement) => el.contentWindow!.location.href)
  expect(href).toMatch(/\/expenses\?role=manager$/)
})

// A state the click itself creates (an open menu): the next step's target
// exists only because the app got the click.
test("a step whose target only exists after the click is reached without a reload", async ({ page }) => {
  await page.route("**/stavy.json", async (route) => {
    const manifest = await (await route.fetch()).json()
    manifest.scenarios.push({
      id: "open-menu",
      label: "Open the filter",
      steps: [
        { page: "expenses", dims: { role: "manager", state: "loaded" }, target: "StatusFilter", title: "Open the filter" },
        { page: "expenses", dims: { role: "manager", state: "loaded" }, target: "[role=option]", title: "Pick a status" },
      ],
    })
    await route.fulfill({ json: manifest })
  })
  await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded&tour=open-menu&ts=0")
  await expect(page.locator(".ps-halo")).toBeVisible()
  const t0 = Date.now()
  await page.frameLocator("iframe.ps-frame").locator('[data-proto="StatusFilter"] button').click()
  await expect(page).toHaveURL(/[?&]ts=1(&|$)/, { timeout: 1400 })
  expect(Date.now() - t0).toBeLessThan(1400)
  await expect(page.frameLocator("iframe.ps-frame").locator("[role=option]").first()).toBeVisible()
  await expect(page.getByText("Pick a status")).toBeVisible()
  await expect(page.locator(".ps-halo")).toBeVisible()
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

  // The panel docks into its own space: the frame keeps its viewport width,
  // scaled to fit beside it, so nothing of the prototype is ever under it.
  test("the docked panel never overlaps the frame, on any side", async ({ page }) => {
    await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted&i=1")
    const panel = page.locator(".ps-inspect-panel")
    const frame = page.locator("iframe.ps-frame")
    await expect(panel).toBeVisible()
    const overlaps = async () => {
      const a = (await panel.boundingBox())!
      const b = (await frame.boundingBox())!
      return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1
    }
    await expect(panel).toHaveAttribute("data-side", "right")
    expect(await overlaps()).toBe(false)
    // Scaled, not reflowed: the frame's own viewport is still the full width.
    const inner = await frame.evaluate((el: HTMLIFrameElement) => el.contentWindow!.innerWidth)
    expect(inner).toBe(page.viewportSize()!.width)
    for (const side of ["left", "bottom", "right"]) {
      await panel.getByTitle(`Dock ${side}`).click()
      await expect(panel).toHaveAttribute("data-side", side)
      expect(await overlaps()).toBe(false)
    }
    // Resizable from its inner edge; side and width are remembered across reloads.
    await panel.getByTitle("Dock left").click()
    const handle = (await panel.locator(".ps-inspect-resize").boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 200)
    await page.mouse.down()
    await page.mouse.move(handle.x + 120, handle.y + 200, { steps: 4 })
    await page.mouse.up()
    const wide = (await panel.boundingBox())!.width
    expect(wide).toBeGreaterThan(440)
    expect(await overlaps()).toBe(false)
    await page.reload()
    await expect(page.locator(".ps-inspect-panel")).toHaveAttribute("data-side", "left")
    expect(Math.abs((await page.locator(".ps-inspect-panel").boundingBox())!.width - wide)).toBeLessThan(2)
  })

  test("clicking pins exactly the hovered element; Esc unpins; the app never sees the click", async ({ page }) => {
    await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded&i=1")
    const panel = page.locator(".ps-inspect-panel")
    const cell = page.frameLocator("iframe.ps-frame").locator('[data-proto="ExpenseRow:exp-2101"] td').nth(1)
    const box = (await cell.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator(".ps-inspect-tag")).toBeVisible()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(panel.locator(".ps-inspect-status")).toHaveText("pinned")
    // The row opens an expense in the app; while inspecting, it must not.
    await expect(page).toHaveURL(/p=expenses(&|$)/)
    await expect(panel.locator('[data-section="selection"] .ps-crumb[data-on="true"]')).toHaveText(/^td/)
    await expect(panel.locator(".ps-crumb", { hasText: /^TableCell$/ })).toBeVisible()
    await expect(page.locator('.ps-inspect-outline[data-kind="pinned"]')).toBeVisible()
    // Clicking in the panel never re-targets.
    await panel.locator('[data-section="classes"]').click()
    await expect(panel.locator('[data-section="selection"] .ps-crumb[data-on="true"]')).toHaveText(/^td/)
    // ↑ walks to the parent, ↓ back down to where it came from.
    await page.keyboard.press("ArrowUp")
    await expect(panel.locator('[data-section="selection"] .ps-crumb[data-on="true"]')).toHaveText("ExpenseRow:exp-2101")
    await page.keyboard.press("ArrowDown")
    await expect(panel.locator('[data-section="selection"] .ps-crumb[data-on="true"]')).toHaveText(/^td/)
    await page.keyboard.press("Escape")
    await expect(panel.locator(".ps-inspect-status")).toHaveText("hover, click to pin")
    await expect(page).toHaveURL(/i=1/) // Esc unpinned; it did not close inspect
  })

  test("a pin follows its element when the prototype scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 380 })
    await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded&i=1")
    const frame = page.frameLocator("iframe.ps-frame")
    const cell = frame.locator('[data-proto="ExpenseRow:exp-2101"] td').first()
    const box = (await cell.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const outline = page.locator('.ps-inspect-outline[data-kind="pinned"]')
    await expect(outline).toBeVisible()
    const before = (await outline.boundingBox())!
    await page.locator("iframe.ps-frame").evaluate((el: HTMLIFrameElement) => {
      const w = el.contentWindow!
      const d = w.document
      const inner = Array.from(d.querySelectorAll("*")).filter(
        (n) => n.scrollHeight > n.clientHeight + 20 && /(auto|scroll)/.test(w.getComputedStyle(n).overflowY)
      )
      const scroller = inner[inner.length - 1] ?? d.scrollingElement!
      scroller.scrollTop += 40
    })
    await expect.poll(async () => (await outline.boundingBox())?.y ?? before.y).toBeLessThan(before.y - 10)
    const after = (await outline.boundingBox())!
    const moved = (await cell.boundingBox())!
    expect(Math.abs(after.y - moved.y)).toBeLessThan(2)
    await expect(page.locator(".ps-inspect-status")).toHaveText("pinned")
  })

  test("with an element pinned, hovering another shows the distance between them", async ({ page }) => {
    await page.goto("/stavy/?p=expenses&d_role=manager&d_state=loaded&i=1")
    const frame = page.frameLocator("iframe.ps-frame")
    const row = frame.locator('[data-proto="ExpenseRow:exp-2101"] td').first()
    const r = (await row.boundingBox())!
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
    await expect(page.locator(".ps-inspect-status")).toHaveText("pinned")
    // A cell two rows down: a vertical gap between them.
    const other = frame.locator("tbody tr").nth(3).locator("td").first()
    const o = (await other.boundingBox())!
    await page.mouse.move(o.x + o.width / 2, o.y + o.height / 2)
    const label = page.locator(".ps-measure-label").first()
    await expect(label).toBeVisible()
    await expect(label).toHaveText(/^\d+(\.\d)?px$/)
    // Labels are in the prototype's own px, not the scaled screen px.
    const gap = await frame.locator("tbody").evaluate((tb) => {
      const rows = tb.querySelectorAll("tr")
      const first = Array.from(rows).find((x) => x.getAttribute("data-proto") === "ExpenseRow:exp-2101")!
      return Math.round(rows[3].getBoundingClientRect().top - first.getBoundingClientRect().bottom)
    })
    const values = (await page.locator(".ps-measure-label").allTextContents()).map((t) => Math.round(parseFloat(t)))
    expect(values).toContain(gap)
  })

  // A team shapes the panel from data: which sections, in which order, links per component.
  test("viewer.inspect.panel hides a section and adds a component link", async ({ page }) => {
    await page.route("**/stavy.json", async (route) => {
      const manifest = await (await route.fetch()).json()
      manifest.viewer = {
        ...manifest.viewer,
        inspect: {
          ...manifest.viewer?.inspect,
          panel: {
            sections: ["component", "props", "tokens", "type", "spacing", "accessibility", "url"],
            hideProps: ["/^on[A-Z]/"],
            links: [{ label: "Docs", href: "https://ds.example.com/components/{kebab}" }],
          },
        },
      }
      await route.fulfill({ json: manifest })
    })
    await page.goto("/stavy/?p=expense-detail&d_role=manager&d_lifecycle=submitted&i=1")
    const at = await targetCentre(page, "ApproveButton")
    await page.mouse.move(at.x, at.y)
    await page.mouse.click(at.x, at.y)
    const panel = page.locator(".ps-inspect-panel")
    await expect(panel.locator(".ps-inspect-status")).toHaveText("pinned")
    await expect(panel.locator('[data-section="classes"]')).toHaveCount(0)
    await expect(panel.locator('[data-section="source"]')).toHaveCount(0)
    await expect(panel.locator('[data-section="accessibility"]')).toBeVisible()
    await expect(panel.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "https://ds.example.com/components/button")
    // onClick is hidden from the JSX as well as from the props table.
    await expect(panel.locator("pre")).not.toContainText("onClick")
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
    await expect(panel.locator('[data-section="props"]')).toContainText("onClick")

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
      apiVersion: 1,
      panel: {
        probe: (ctx) => ({ title: "Probe section", rows: [{ label: "component", value: ctx.component ? ctx.component.name : "none", copy: "x" }] }),
      },
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
    // A module may add panel sections; unplaced, they come after the built-in ones.
    await expect(panel.locator('[data-section="probe"]')).toContainText("Probe section")
    await expect(panel.locator('[data-section="probe"]')).toContainText("Button")
  })
})
