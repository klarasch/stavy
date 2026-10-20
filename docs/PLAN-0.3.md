# Stavy 0.3 — the lean core

**What Stavy is for:** lay out every state of a prototype's screens and flows
on one canvas, and open any of them in the real prototype. Everything in 0.3
serves that, or moves out.

**Four promises:**

1. **Light.** A small viewer, a small manifest, a short skill.
2. **Cheap to update.** Refreshing the map after a change takes seconds, not
   a full rescan.
3. **Balanced.** The canvas arranges itself into a calm, readable layout at
   any size of prototype.
4. **Tours that work.** A flow never stops on "not found".

Plus one seam kept open on purpose: **the inspect adapter is a plugin.**

0.3 may break the 0.2 manifest format; `stavy migrate` converts existing
manifests.

---

## Where it is today (demo prototype)

| | 0.2 | 0.3 target |
| --- | --- | --- |
| Viewer bundle | 3.8 MB, 62 files; ~3.4 MB is Mermaid (diagram boards) | ≤ 400 KB, no Mermaid; the inspector loads only when opened |
| Demo manifest | 30 KB, 13 top-level keys | ~8 KB: `product`, `viewer`, `screens`, `flows`, `boards` |
| Spec + schema | 815 + 682 lines | ~200 + ~250 |
| Agent skill | 293 lines | ~100 |
| Commands | validate, scan, check, changelog, handoff, gen:tests, strings, release, init | `init`, `scan`, `migrate`, `docs` |
| Scan | Every state, one at a time, full reload + `networkidle` + 300 ms each, 1920×1080 PNG | Only what changed, in parallel, WebP snapshots |

---

## 1. The model: screens, flows, boards

- **Screen**: `id`, `url` template, optional axes (`dims`), optional `label`,
  `group`, `pin`. Labels and groups default from the id and URL path.
  Every combination of axes is shown unless the grid would exceed 12 cards,
  then `pin` lists which.
- **Flow**: `id`, `label`, ordered `steps`. A step is `screen` + optional
  `dims`, `title`, `note`, `target`. **A step without a target is valid and
  can't fail**: it shows the state with the card over it.
- **Board**: a freeform spec sheet, like a Figma page for developers. See 1a.

Removed: Mermaid diagrams (and with them ~3.4 MB of the bundle), templates,
figures (folded into boards), requirements, strings, changelog/handoff/test
generators. Moved to an **optional add-on bundle** (`stavy-extras`) that the
viewer loads only if installed: components/prototypes, canvas notes,
annotations, fidelity, comments, wireframe. The core carries none of their
code, tests or docs.

### 1a. Boards: freeform specs, no matrix

Screens and flows answer "what exists". A board answers "look at this
detail": the five loader × table combinations that matter, the hover and
focus states of one control, the empty and error versions of one panel. No
axes to declare in full, no grid, no rules beyond "each item is a real
state".

```jsonc
{
  "id": "table-loading",
  "title": "Expenses table — loading states",
  "screen": "expenses",            // optional: shows the board in that screen's section
  "columns": 3,                    // optional; otherwise the layout picks
  "items": [
    { "screen": "expenses", "dims": { "table": "loading" }, "crop": "ExpensesTable", "label": "First load: skeleton rows" },
    { "screen": "expenses", "dims": { "table": "refreshing" }, "crop": "ExpensesTable", "label": "Refresh: rows stay, bar on top" },
    { "url": "/expenses?table=loaded&loader=inline", "crop": "ExpensesTable", "label": "One-off state, not an axis" },
    { "text": "Never show the spinner and the skeleton together." },
    { "image": "boards/old-design.webp", "label": "Before" }
  ]
}
```

- **Items** are a real state (screen + dims, or a raw `url` for a one-off
  that doesn't deserve an axis), a text note, or an image.
- **`do`** is a short list of actions scan performs before capturing, so
  states that have no URL cost nothing in the prototype:
  `"do": [{ "click": "StatusFilter" }]` (an open menu),
  `[{ "hover": "SaveButton" }]`, `[{ "focus": "SearchField" }]`,
  `[{ "press": "ArrowDown" }]`. Hover and focus are forced through the
  browser, so they hold still for the capture. Opening the item in the
  player replays the same actions.
- **`viewport`** on an item (`{ "width": 390 }`) captures it at another
  width: responsive states side by side.
- **`status`** on a board or screen (`draft` / `ready`) shows as a chip, so
  a developer knows what's settled.
- **`crop`** names a target; scan captures just that element (plus a small
  margin) instead of the whole page, so details read at a legible size.
- Items lay out in the order written, in rows; `columns` is a hint.
- Validation is light: the state must load and the crop target must exist.
  That's all.
- Every board item opens in the player like any other state.

### 1b. Strict where it helps, loose everywhere else

Only two things fail `scan`: a state that doesn't load, and a flow that
can't be played. Everything else (missing labels, unpinned combinations, an
id not found for a crop) is a warning listed in the scan summary.

## 2. Cheap updates

Scan today visits every state on every run, one at a time, with a full page
load, a `networkidle` wait and a fixed 300 ms pause each, and writes a
full-size PNG. Changes:

- **Incremental by default.** `stavy scan` re-captures only:
  states that are new in the manifest, states whose rendered DOM changed
  since the last scan (a cheap hash, computed after the state settles), and
  states named with `--only`. `--all` forces a full scan. Unchanged states
  keep their snapshot and its timestamp.
- **Client-side state changes.** Within the same app, move between states
  with `history.pushState` + a `popstate` event instead of a full reload;
  fall back to a reload if the state doesn't appear. Saves the app's boot on
  every state.
- **A settle check instead of fixed waits.** Fonts loaded, no DOM mutations
  for ~150 ms, no pending requests to the app's own origin. Replaces
  `networkidle` + 300 ms.
- **Parallel.** Several browser tabs (default 4).
- **Smaller snapshots.** Canvas cards are a few hundred pixels wide; capture
  at the page viewport, store as **WebP** (q≈80) via Chromium's own
  `Page.captureScreenshot` (CDP), so no new dependency; PNG fallback for
  non-Chromium browsers. Store the boxes the canvas needs alongside.
  Lazy-load images on the canvas.
- **Agent loop.** The skill runs `stavy scan` (incremental) after changing
  a screen; it's fast enough to run every time.
- **Scan reports what changed** (`.stavy/last-scan.json`: new, changed and
  removed states), which seeds the changelog (§9) and shows as a small
  "changed" dot on canvas cards until the next release.

## 3. A balanced canvas

**Why it's unbalanced today:** the canvas is CSS flex-wrap. Areas of very
different sizes (a wide site map, a 10-step flow as one long strip, a tall
role×state grid) wrap into ragged rows inside a fixed 4200 px max width,
leaving large holes and one very long strip.

**0.3:** a computed layout, as a pure function from the manifest.

- Every area's size is known without the DOM: viewport size × card scale ×
  the counts of axes, states and steps. So the layout is computed, not
  measured, unit-tested, and the same on every load.
- **Pack sections, then areas inside them**, with a shelf/skyline packer
  aiming at a target canvas aspect ratio (≈16:10), so the whole map reads
  like a page from orbit.
- **Cap the extremes.** Long flows wrap onto several lines (≤ 6 steps a
  line, numbered). Big grids cap at 4 columns and wrap rows.
- **Stable.** Sections keep their order and areas keep their order within a
  section, so adding one state shifts its neighbours, not the whole canvas.
- Fixed order of zones: site map → flows → screens by section.

## 4. Tours that work

Clicking the highlighted element today is blocked (`preventDefault()` +
`stopPropagation()` in `TourOverlay.tsx`), and the frame jumps to the next
step's URL. The app never sees the click, so any state the click itself
creates (an open modal or menu, a selected row) is never there.

- **Let the click through.** Wait up to ~1.5 s for the next step (its target
  present, or the frame at its state); if so, advance without touching the
  frame. Otherwise navigate to the next step's URL, as today. "Next" and →
  click the target too.
- **Recover in order, never show an error:** wait for a late mount → put
  the frame into the step's state → replay clicks from the nearest
  URL-reachable step → find the element by a fingerprint scan recorded (role,
  accessible name, text, box) → show the step with the halo where scan
  measured it, or as a centred card.
- **`scan` plays flows with real clicks** using the same step engine as the
  viewer, so green means it works in the player.
- Reasons go to the console and a debug toggle, never the step card.

## 5. Inspect as a plugin

The viewer core ships a framework-neutral inspector (computed values, the
`var()` chain behind each, classes). Everything that knows about a framework
or a design system is a plugin.

- **Plugin shape:** one folder or npm package with `stavy-inspect.json`
  (the data: kits, token and class patterns, type scale) and an optional
  `index.js` (code for what data can't say). Declares `apiVersion`.
- **Two kinds:** *framework* plugins (component name + props from the
  rendered tree; React ships as the first, Vue/Svelte possible) and
  *design-system* plugins (tokens, type scale, component classes). A
  prototype uses one of each, or none.
- **Wiring:** `viewer.inspect.plugins: ["@stavy/react", "./.stavy/inspect/acme"]`.
  `stavy init --plugin <path|package>` copies it next to the viewer so it
  stays same-origin and static. One design-system plugin serves all of a
  team's prototypes.
- **Typed interface** published as `.d.ts`; the viewer warns on an
  `apiVersion` mismatch; the changelog lists interface changes separately.
- **`stavy scan --inspect-check`** runs the plugin's fixture file ("screen
  X, target Y → component `AcButton`, color token
  `--acme-color-action-primary`, type `body`") against the live prototype.
  Catches the design system moving under the plugin.
- `docs/INSPECT-PLUGINS.md` (replacing `INSPECT-ADAPTERS.md`): writing,
  sharing, versioning and maintaining a plugin, with a troubleshooting table.
- The inspector code itself loads lazily, only when inspect is opened.

## 6. Agents: describe, don't dictate

- `RULES.md` keeps only the map contract: keep the map true, keep target
  ids, don't bend the app to fit Stavy.
- The prototyping approach (mock the UI, fixtures not fetches, add behaviour
  only when a flow needs it) moves to an optional `PROTOTYPING.md` that
  `init` offers, for CLAUDE.md/AGENTS.md.
- Optional `product.purpose` / `product.outOfScope` in the manifest:
  context for agents, a header on the canvas.

## 7. Viewer UI

With the extras out, the player toolbar holds only: screen and state
switchers, flows, inspect, back to canvas, hide UI.

- **Toolbar docked by default.** The default becomes the full-width bottom
  bar (`bar-bottom`), which shrinks the prototype's viewport instead of
  covering it. Floating stays available by dragging the grip.
- **"Mock only" belongs to the toolbar.** It renders inside the bar (and
  inside the floating pill), never as a separately positioned label.
- **Tour card:** the close button is fixed to the card's top-right corner
  (absolute, not part of the header's flex row), so no title length or chip
  can move it. A layout test covers it.
- **Inspect panel: docked, never over the page.**
  - A side panel (right by default; left or bottom from a switch) that takes
    its own space. The prototype frame keeps its viewport width and is
    scaled to fit beside the panel, so nothing reflows while inspecting and
    nothing is ever covered.
  - Hover shows only a small tag at the element (component name + size);
    all detail is in the panel. The corner-dodging logic goes away.
  - Panel width is resizable and remembered per browser.
  - On the canvas the panel docks to the window edge.
- **Inspect panel content is set by the plugin.** The design-system plugin's
  JSON declares `panel`: which sections show and in what order (component,
  props, tokens, type, spacing, classes, accessibility), which props to
  hide, link templates per component (`"docs": "https://ds.example/{name}"`,
  Storybook, source), and the copy formats ("copy as JSX", "copy token").
  A team shapes the panel without touching viewer code.
- **Measure.** With one element pinned, hovering another shows the distance
  between them, as in Figma.

## 8. Cheap review loops

- **"Copy reference"** in the player and inspector: one click copies a
  link plus a line of text (screen, state, element, component) to paste to
  an agent or a chat. Feedback without a comments system.
- **"Add to board"**: in the player, with the state as it is on screen (a
  menu open, an element picked for the crop), copy a ready board item for
  the agent to add. The designer browses and picks; the agent writes the
  manifest.
- **What changed.** Changed cards carry a dot; a canvas filter shows only
  what changed since the last version; scan keeps the previous snapshot of
  a changed state so the card can flip before/after.
- **A link per review.** Every view (canvas position, board, state, tour
  step) is a URL already; with the viewer deployed next to each preview
  build, a review is one link with the "changed" filter on.

## 9. Changelog and written docs, kept by the skill

One rule: **written docs live next to what they describe, and the skill
keeps them in step**, so they don't drift.

- **Changelog** (`stavy-content/changelog.md`). After each
  scan that changed the map, the skill appends an entry: the *what* comes
  from scan's change report (new/changed/removed screens, states, flows,
  boards), the *why* from the conversation ("manager can now bulk-approve,
  asked for in review"). Grouped under a version or date; the skill bumps it
  when asked to "cut a version".
- **Docs** are the manifest's own text fields: `description` on screens,
  flows and boards, `label`/`note` on states, steps and board items. They
  render on the canvas, so they're always looked at. The skill writes them
  whenever it adds or changes something and flags empty ones.
- **`stavy docs`** exports the same text as one Markdown file (screens →
  states → flows → boards, with snapshot links) for a wiki, a PR or a
  handoff. Generated, never edited by hand.
- Both behaviours are part of the skill, so they can be switched off in
  `.stavy/SKILL.local.md`.

---

## Order and size

Rough, one person working with an agent:

| # | Work | Size |
| --- | --- | --- |
| 0 | Reproduce tour failures and time a full scan on a real prototype (baseline) | ½ day |
| 1 | Tours: let clicks through (ships alone as 0.2.3) | 1 day |
| 2 | Model: screens + flows, `migrate`, extras out of the core, Mermaid removed | 2–3 days |
| 2b | Boards: freeform items, crops, `do` actions, raw-URL states, images | 2–2½ days |
| 2c | Viewer UI: docked toolbar, mock label, tour close button, docked inspect panel, plugin-defined panel, measure | 2½–3 days |
| 2d | Review loop: copy reference, add to board, changed filter, before/after | 1½–2 days |
| 3 | Cheap updates: incremental, settle check, client-side moves, parallel, WebP, change report | 1½–2 days |
| 4 | Balanced canvas: computed packing layout | 1½–2 days |
| 5 | Inspect plugins: plugin shape, wiring, lazy load, check, docs | 2 days |
| 6 | Tours: recovery ladder, flow playback in scan | 2 days |
| 7 | Changelog + docs in the skill, `stavy docs` export | 1 day |
| 8 | Spec, skill and docs rewritten for the lean core | 1–1½ days |

About **18–23 working days**. 0.3.0 ships after 1–5, 2b, 2c and 8; 2d, 6 and 7 can follow as 0.3.x.
