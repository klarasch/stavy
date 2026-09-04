# Stavy — an open standard for AI-assisted prototyping (v0.2, draft)

Stavy is a viewer of existing things, not a way to build them. It reads a
manifest describing a prototype workspace — pages, dimensions, scenarios,
notes — and overlays a canvas, a player, and dev-mode inspection *on top of*
the prototype, at the prototype's own URLs. It never renders the prototype
itself and never imports its code.

It has three parts:

1. **The manifest** (`stavy.json`) — a framework-agnostic description of the
   prototype workspace. This file *is* the standard.
2. **The binding contract** — one field (`url`) per page, plus target ids at
   interaction points. No hooks, no imports, no required router or store.
3. **The viewer** — any tool that reads the manifest and renders the canvas,
   player, tours, annotations, and inspector, entirely from outside the
   prototype. This repo ships a React reference viewer; the manifest doesn't
   care what the viewer is written in, or what the prototype is written in.

A Claude skill (`skill/SKILL.md`) operates the system: it registers pages
against a running prototype, keeps the manifest in sync with the code, and
knows the rules for touching an existing codebase (`skill/RULES.md`) —
additive only, never a rewrite to fit the contract.

---

## 1. The manifest

One JSON document, served by the prototype at `/stavy.json` (or wherever
`loadManifest()` is pointed). Top-level shape:

```jsonc
{
  "version": "0.2",
  "product":    { "name": "...", "description": "..." },
  "viewer":     { "toolbar": "bottom", "app": "/", "targetAttrs": ["data-proto", "data-testid"] },
  "strings":    "/strings.json",
  "dimensions": [ ... ],
  "templates":  [ ... ],
  "pages":      [ ... ],
  "scenarios":  [ ... ],
  "prototypes": [ ... ],
  "notes":      [ ... ],
  "boards":     [ ... ],
  "requirements": [ ... ]
}
```

### 1.1 Dimensions

A **dimension** is a named axis along which a page varies. The standard does
not hardcode any particular axes — data states, user roles, lifecycle stages,
process progress, feature flags, locales, breakpoints are all just
dimensions.

```jsonc
{
  "id": "lifecycle",
  "label": "Expense lifecycle",
  "kind": "lifecycle",          // free-form tag: "state" | "role" | "lifecycle" | "process" | ...
  "values": [
    { "id": "draft", "label": "Draft", "description": "optional" },
    { "id": "submitted", "label": "Submitted" }
  ]
}
```

`kind` is advisory metadata for viewers (e.g. grouping or iconography); it
never changes semantics.

**Scope.** `scope` says *who owns the choice*, and it does change semantics:

```jsonc
{ "id": "phase", "label": "Release phase", "kind": "release", "scope": "workspace",
  "values": [{ "id": "p1", "label": "Phase I" }, { "id": "p2", "label": "Phase II" }] }
```

- `"page"` (default) — a local axis of one screen: flip it while the page is
  open, and it resets to the page's default when another page opens. Flow
  step, data state, overlay, density.
- `"workspace"` — one value for the *whole workspace*: chosen once in the
  viewer chrome, carried across every navigation and back to the canvas.
  Release phase, role, locale — the axes that answer "which world am I
  looking at" rather than "where in this screen am I".

A workspace-scoped axis follows three rules:

1. **A page that does not declare the axis is unaffected by it.** Absence
   means "the same in every value" — which is itself information, and it
   keeps unchanged screens on the canvas in every world.
2. **A page that declares the axis and excludes the active value is out of
   scope**: the viewer drops it from the canvas (and its scenarios with it).
   Declaring a single value (`"phase": ["p2"]`) is how a screen says "new in
   Phase II"; the coverage matrix then shows the other value as a gap.
3. **The dimension's first value is the workspace default**, and it wins over
   a page's own `defaults` entry for that axis — a workspace choice cannot
   mean different things on different pages. Order the values accordingly.

This is what makes a phased prototype legible: engineers browse all of Phase I
without re-picking it screen by screen, while flow step and data state stay
local toggles.

### 1.2 Templates (optional)

An optional registry of page **shapes**, purely informational: a grouping
label a viewer or handoff sheet can use to say "these five pages are all list
pages." Components still come from the prototype's own UI kit; Stavy does not
supply, require, or validate against a component library.

```jsonc
{
  "id": "list-page",
  "label": "List page",
  "description": "Filter bar + data table with empty/loading/error states",
  "source": "src/app/templates/ListTemplate.tsx",   // where the implementation lives; the inspector links to it in dev
  "uiKit": ["Input", "Select", "Table", "Badge"],    // UI-kit components it composes
  "organisms": ["work-queue"]                        // registered components (kind: "component") it is built from
}
```

`organisms` is the template's **anatomy** — which registered components it
composes. A `template` id on a page (§1.3) is optional and changes nothing
about how the page renders; it exists so a viewer or handoff sheet can group
pages by shape.

### 1.3 Pages

A **page** is one screen (or organism, see §2.4) of the prototype:

```jsonc
{
  "id": "expense-detail",
  "label": "Expense detail",
  "url": "/expenses/exp-2101?role={role}&lifecycle={lifecycle}",
  "template": "detail-page",
  "fidelity": "interactive",
  "dimensions": {                       // dimension id -> supported value ids
    "role": ["employee", "manager", "finance"],
    "lifecycle": ["draft", "submitted", "approved"]
  },
  "defaults": { "role": "employee", "lifecycle": "submitted" },
  "instances": [                        // variants pinned to the canvas
    { "dims": { "role": "manager", "lifecycle": "submitted" }, "note": "Approve / reject" }
  ],
  "annotations": [                      // notes attached to semantic targets
    { "target": "ApprovalActions", "title": "Action matrix", "note": "..." }
  ]
}
```

- **`url` is THE binding contract** (§2.1): where the prototype renders this
  page, as a path template with `{dim}` placeholders. Every dimension this
  page declares must appear as a placeholder somewhere in `url` — that is the
  whole contract, and it's checked by `npm run validate`.
- `kind` (optional: `page` | `component`). A **component** is a bespoke
  organism — a panel, widget, or composite the product builds from the design
  system's atoms (not the atoms themselves; those belong in the DS's own
  catalog). Components use the exact same contract as pages (dimensions,
  defaults, instances, annotations, fidelity, `url`), render inside their own
  `frame: { width, height }`, and appear in their own canvas section. See §2.4
  for how their `url` resolves.
- `template` (optional) — an informational grouping id (§1.2). Nothing reads
  it to decide how the page renders.
- `fidelity` (optional: `static` | `navigable` | `interactive`) declares how
  much behaviour the page carries. See the skill's "fidelity ladder" — the
  default is `static`, and the canvas surfaces the rung so scope creep is
  visible.
- The full variant space is `dimensions` (the cartesian product, addressable
  at runtime by editing the URL). `instances` is the *curated subset* shown
  on the canvas — coverage made visible without combinatorial explosion.
- `defaults` fill in unspecified dimensions everywhere (instances, scenario
  steps, deep links).

There is no `module` field, and no per-page render hook. The viewer never
imports or mounts the page — it navigates a frame to `url` (§2.1, §2.3).

### 1.4 Scenarios

A **scenario** is an executable walkthrough — the answer to "where do I
click?".

```jsonc
{
  "id": "manager-approves",
  "label": "Manager reviews and approves",
  "persona": "manager",
  "description": "...",
  "refs": ["PRD-118 §3"],
  "steps": [
    {
      "page": "expense-detail",
      "dims": { "role": "manager", "lifecycle": "submitted" },
      "target": "ApproveButton",     // target to highlight; omit = observe step
      "title": "Approve it",
      "note": "Why this step matters / what to look at"
    }
  ]
}
```

`refs` (optional `string[]`) links the scenario to the requirements it
realises — PRD sections, tickets, acceptance criteria. This is what makes the
manifest a checkable contract between PM, design, and engineering: every
requirement should be reachable through at least one scenario; every scenario
should cite what it's for.

Steps are declarative enough for a viewer to render them as (a) a guided tour
overlay with highlights inside the player's frame, (b) a flow lane on the
canvas, or (c) a written walkthrough. All three come from the same data.

### 1.5 Canvas notes ("pointing notes")

Free-standing notes placed on the canvas next to a page instance, with a
leader line to the instance or to a specific target inside it:

```jsonc
{
  "id": "n-actions",
  "page": "expense-detail",
  "dims": { "role": "manager", "lifecycle": "submitted" },  // which pinned instance
  "target": "ApprovalActions",                               // optional: point at a part
  "placement": "top",                                        // top | right | bottom | left
  "text": "The decision buttons are the crux of PRD-118 §3."
}
```

Notes differ from `pages[].annotations`: annotations are *about the UI* and
travel with the page wherever it's shown; canvas notes are *about the
review* — design rationale, open questions, scope remarks — and live on the
overview. Both are drawn from the snapshot index (§3), not measured live.

### 1.6 Requirements (the PM's half of the contract)

```jsonc
{ "id": "PRD-118 §3", "title": "Managers approve, reject, or request changes",
  "source": "docs/PRD-118.md §3", "priority": "must" }
```

`requirements[]` lists what the prototype must demonstrate; scenarios cite
them in `refs` by exact id. A viewer SHOULD render a coverage board
(requirement → scenarios → states, gaps highlighted); a validator SHOULD warn
for requirements no scenario cites and refs no requirement declares, and MAY
cross-check a requirements document's text (`validate --refs`). Requirements
are typically generated from the PRD by the agent; PMs review the board
rather than editing the manifest.

### 1.7 Boards (supporting material — outside the contract)

Information architecture, flow/state diagrams, moodboard images, principles:
things a team wants *next to* the prototype without them being part of what
must be covered. A viewer renders boards without interpreting them:

```jsonc
{ "id": "lifecycle", "title": "Expense lifecycle", "kind": "mermaid",   // mermaid | image | text
  "source": "stateDiagram-v2\n  [*] --> draft\n  …", "width": 620 }
```

Boards are deliberately not referenced by scenarios, slices, or refs; the
validator only checks ids and kinds.

### 1.7b Copy catalog (optional)

```jsonc
"strings": "/strings.json"     // a URL the prototype serves: { "<locale>": { "<key>": "text" } }
```

`strings` is a **URL the prototype serves**, not a repo file path — the
viewer fetches it at runtime like anything else at the prototype's origin.
Whether the prototype's own code routes copy through a keyed catalog at all
is up to the prototype; Stavy only needs somewhere to fetch it from if one
exists. When one does, a `locale` dimension can switch it and a copy-review
document can be generated from it (`scripts/strings.mjs`, if the workspace
keeps a local source file the served JSON is built from).

### 1.8 Viewer defaults

```jsonc
"viewer": {
  "toolbar": "bottom",        // floating: bottom | top | bottom-left | bottom-right | top-left | top-right
                               // docked bar (prototype viewport shrinks, nothing is covered): bar-bottom | bar-top
  "base": "/stavy",           // path prefix the viewer is served under. Default: derived from the viewer's own location.
  "app": "/",                 // where the prototype is served (origin or path prefix). Default: the viewer's origin at the parent of `base`.
  "targetAttrs": ["data-proto", "data-testid"]   // attributes a bare target id is looked up in, in order
}
```

Both `base` and `app` are normally left to their defaults — the viewer
derives them from wherever it was opened, so the same build works at the
root, under a sub-path, or on GitHub Pages. Set `app` explicitly only when the
prototype is genuinely served from somewhere other than the viewer's parent
path (a different origin during local dev, say).

### 1.9 Prototypes (informational slices)

A **prototype** names a subset of the workspace — purely informational, for
handoff docs and for telling a colleague "look at just this part":

```jsonc
{
  "id": "approval-flow",
  "label": "Approval flow demo",
  "pages": ["dashboard", "expenses", "expense-detail"],
  "scenarios": ["manager-approves", "finance-reimburses"]
}
```

There is no build-time slicing tool in v0.2 — the viewer is a static overlay,
not a bundler plugin, and it has nothing to exclude from a build. A
`prototypes[]` entry is a labeled subset a validator can check for dangling
ids and a viewer or handoff sheet can filter by; it does not affect what
ships. `prototypes[]` is optional.

---

## 2. The binding contract

The manifest is inert without a running prototype the viewer can point a
frame at. The contract is deliberately small:

### 2.1 The URL contract

Every page's `url` is a path template with `{dim}` placeholders:

```
"/expenses/exp-2101?role={role}&lifecycle={lifecycle}"
```

Every dimension the page declares in `dimensions` must appear as a
`{placeholder}` somewhere in `url` — in the path or the query string, your
choice. `npm run validate` checks this both ways: every placeholder must be a
declared dimension, and every declared dimension must appear as a
placeholder. The prototype reads the values however it likes — search
params, path segments, both — and renders that state. Stavy dictates nothing
about the app's router, store, UI kit, or URL scheme; the demo prototype in
this repo reads dimensions out of `useSearchParams()` at the route level
(`src/demo/app/dims.ts`), but that is one implementation choice among many.

The viewer resolves a page + dimension assignment to the prototype's actual
URL by filling the template (`appUrl()` in `src/stavy/manifest.ts`) and, for
the reverse direction — recognising what state the prototype is *currently*
showing, e.g. after in-frame navigation — matches the frame's URL back
against every page's template (`matchAppUrl()`). A URL that matches no
template is drift: state the manifest doesn't know about (§3, player).

A relative `url` (starting with `/`) is resolved against `viewer.app`
(§1.8); an absolute one (`https://…`) is used as-is, e.g. for a page served
from a different origin.

### 2.2 Targets

Scenario steps, annotations, notes, and comments all point at a **target**:
either a bare id, looked up in `viewer.targetAttrs` in order (default
`data-proto`, then `data-testid`), or any CSS selector, used verbatim.

```html
<button data-proto="ApproveButton">Approve</button>
```

If the prototype's kit already stamps stable ids at the DOM elements that
matter — `data-testid`, a design system's own instance attribute — point
`viewer.targetAttrs` at it and add nothing. Only where no such id exists does
adding one become the prototype's job, and it is additive: one attribute at
the usage site, never a restructuring of the component.

Target existence and location are checked dynamically, not by reading source:
`scripts/scan.mjs` visits every state that references a target in a real
browser and asserts it's there (§3b). There is no textual/grep-based target
resolution in v0.2 — the scan is the check.

### 2.3 Same-origin & the frame

The viewer is a static page served *next to* the prototype, same origin:

```
https://host/            → the prototype
https://host/stavy/      → the viewer
https://host/stavy.json  → the manifest
https://host/snapshots/  → PNGs + index.json, written by scripts/scan.mjs
```

The prototype renders inside a same-origin `<iframe>` that the viewer never
imports — `src/stavy/frame.ts` is the entire surface this requires: reading
the frame's document, measuring element rects against the frame's CSS scale,
and following its URL. Same-origin is the *one* requirement, and it is what
lets the viewer inspect, run tours, place pins and anchor comments into the
frame's live DOM without a single line of code in the prototype. Off
same-origin (a different host, a production deployment behind auth), those
features degrade; snapshots (pre-rendered by the scan) keep working
regardless, since they don't need the live frame at all.

A canvas card is a static preview by decision (§3): it shows the state's
snapshot, and only mounts a real frame — with a shield swallowing every
pointer event — while the inspector is hovering it or in Live mode near the
viewport, purely so those features can reach real DOM. Clicking a card always
opens the player, never navigates the card's own frame.

### 2.4 Organisms via harness routes or stories

A page with `kind: "component"` is an organism reviewed on its own. Its `url`
points at wherever the prototype renders that organism alone:

- A **harness route** the prototype adds — one additive route that renders
  the organism with the app's real providers and no page shell (e.g.
  `/components/approval-actions?role={role}&lifecycle={lifecycle}`). This is
  a new route, not a repurposed page; it never strips an existing page down
  to one component.
- An existing **Storybook or Ladle story** iframe URL, if the team already
  has one — same `{dim}` placeholder contract, pointed at the story's own
  query params.

Either way the organism gets a `frame: { width, height }` sized to it, and
the same dimensions/instances/annotations contract as a page.

### 2.5 The viewer is not built from the host kit

The viewer's own chrome (toolbars, tour cards, inspector, canvas panels) is a
separate product with its own tokens; it is **not** required — or
recommended — to be restyled in the host product's UI kit. Because the
prototype now renders in its own iframe document, the chrome and the
prototype don't even share a DOM: there is no CSS reset to fight, no
z-index war, no risk of the host's global styles leaking into the viewer or
vice versa. The reference viewer ships as a self-contained static build
(`dist-viewer/`, relative asset paths) — adopting it means dropping that
folder into the host's `public/` and implementing §2.1–§2.2. Re-theming the
chrome is optional polish, not part of conformance.

---

## 3. Viewer expectations

A conforming viewer SHOULD provide:

- **Canvas as map, not playground.** A pan/zoom overview showing every page's
  `instances`, grouped by page, plus scenario lanes (every scenario *step* is
  a card too). A card shows the state's pre-rendered snapshot (§3b) and
  clicking it opens the player — the canvas never runs the prototype for its
  own sake. A real frame mounts under a card only when it earns its cost:
  while the inspector is hovering that card, or in an explicit "Live" mode
  for cards near the viewport (useful before the first scan, when no
  snapshots exist yet) — and even then a shield swallows every pointer event,
  so a flow step can never navigate itself away. Off-screen and far-zoomed
  cards render as their snapshot or a label placeholder; nothing needs to be
  mounted for the overview to be legible, which is what makes the canvas
  scale to an enterprise-sized workspace.
- **The player**: one same-origin `<iframe>` of the real prototype filling the
  viewport, with the viewer chrome floating over it
  (`/stavy/?p=<page>&d_<dim>=…`). The prototype is fully interactive here — it
  *is* the app. Switching a dimension in the chrome rewrites the frame's URL
  (§2.1). In-frame navigation the prototype does on its own (clicking a link,
  submitting a form) is watched: if the frame's new URL matches a registered
  page + dims (`matchAppUrl`), the viewer URL updates to follow it; if it
  matches nothing, the viewer shows the state as **drift** — an "off the map"
  chip — with a reset back to the page the player opened. Tours, annotation
  pins, comments and the inspector all reach into the frame because it's
  same-origin, with zero code required in the prototype. Keyboard events
  typed into the frame are bridged back to the host window so hotkeys
  (N/I/W/Esc, tour arrows) keep working even when the frame has focus.
  **Wireframe mode** injects a stylesheet into the frame document (grayscale,
  flattened shapes, sketch type) rather than touching the prototype's code.
- **Workspace dimensions**: axes declared `scope: "workspace"` (§1.1) are
  chosen in the chrome, not in the page switcher, and the choice survives
  every navigation (it lives in the URL like all viewer state, so a link
  still reproduces exactly what the sender saw). The canvas hides pages and
  scenarios that are out of scope and says how many, and a page reached by a
  direct link into a value it does not support is marked rather than
  silently re-dimensioned.
- **Dimension switcher**: flip any page-scoped dimension of the open page at
  runtime — it rewrites the frame's URL (§2.1), nothing more. Pages may carry
  many axes (ten is realistic); beyond a handful the switcher MUST degrade to
  a panel rather than overflow (reference: inline pills up to 3 axes, then a
  panel with segmented controls and a "changed from default" count).
- **Coverage matrix**: on the canvas, a page's pinned instances are laid out
  on its two most-varying dimensions with row/column headers; declared-but-
  unpinned cells are shown as empty placeholders (still openable). Headers
  and group titles stay legible when zoomed out (rendered at constant screen
  size).
- **Anatomy as design annotation, scan-backed**: a page's `annotations`
  double as its anatomy — the canvas shows one instance with the annotated
  regions numbered and a legend of *what each part does*. The boxes come from
  the snapshot index (`scripts/scan.mjs` measures every referenced target as
  a fraction of the frame, §3b), so drawing anatomy, pins, and pointing-note
  leader lines on the canvas costs nothing at view time — no live DOM is
  read. (Which components implement a part is the inspector's job, reached
  by opening the player.)
- **Table of contents**: the canvas grows; a viewer SHOULD offer a jump list
  of scenarios, pages and components.
- **Tour player**: play scenarios as overlay-guided walkthroughs inside the
  player's frame; clicking the highlighted element advances the tour.
- **Annotations**: pins from `pages[].annotations`, shown both in the player
  (measured live against the frame) and over canvas thumbnails (measured from
  the snapshot index), with modes on a page — hidden, numbers with the note
  on hover, all notes open (review/print).
- **Distinct chrome**: viewer UI must be visually separate from the prototype
  (the reference viewer uses floating dark chrome) so tool and product are
  never confused in a demo.
- **Inspector**: dev mode, on the player and on canvas thumbnails while
  hovered. Works entirely through the frame (§2.3): for the focused element
  it answers *which React component is this, with which props* (read from
  the frame's fiber tree — needs `esbuild.keepNames` or equivalent in
  production builds so component names survive minification), *which
  classes/tokens produce what I see* (the element's classes, grouped,
  copyable; type/spacing tokens derived from computed style), and *where does
  this color come from* (the class on this element or the ancestor it
  inherits from, and the token variable behind it). Plus the target's
  identity, DOM attributes, the resolved prototype URL of the exact state,
  and — in dev — links to the manifest and template source. Any level from
  the exact element outward through every semantic ancestor is selectable.
- **Comments** (optional, viewer-level, never in the manifest): conversation
  anchored to `page + dims + target + the exact element's child path`
  (position in % of that element, so bubbles survive browser zoom and
  reflow), visually distinct from annotations, threadable and resolvable. A
  reference viewer SHOULD work without a server: local storage plus a
  shareable payload (URL hash) and a Markdown export; richer backends are
  adapters.
- **Tooltips and shortcuts**: every mode toggle has a tooltip that names its
  key; a "?" sheet lists them. Single-letter keys are ignored while typing.
- **Deep links**: every page × dimension assignment has a URL
  (`/stavy/?p=<pageId>&d_<dim>=<value>&...`), so any state is shareable.
  Viewer modes are URL state too (`w=1` wireframe, `i=1` inspect,
  `tour=<id>&ts=<n>`), and the canvas persists its viewport (`v=x,y,zoom`)
  and flags (`notes=1`, `w=1`, `live=1`) — a link reproduces exactly what the
  sender saw.
- **Honesty + hide UI**: the chrome carries a "Mock only — not a real
  product" label and a shortcut (⌘\ / Ctrl+\) that hides all viewer UI for
  clean demos and screenshots.
- **Canvas zoom range** must reach far enough to read details inside
  thumbnails (the reference viewer allows 5%–1200%), and the canvas must stay
  legible from orbit: content is organised into **named areas** (one per
  page/component, plus scenarios and boards) whose titles render at constant
  screen size, so the overview reads as a map rather than a scroll.
- **Headless mode**: `?ui=0` starts with all viewer chrome hidden, for
  snapshots, embeds, and screenshots in CI.
- **Authoring in dev** (optional): a dev server MAY expose an endpoint that
  writes a design annotation into the manifest from the viewer (reference:
  `POST /__stavy/annotation`), so designers annotate without prompting an
  agent; the manifest stays the source of truth.

## 3b. Tooling expectations

A workspace SHOULD ship:

- **`scan`** (`scripts/scan.mjs`, `npm run scan`) — the contract check and
  the snapshots, one Playwright pass against a running dev/preview server.
  Visits every state that matters (pinned instances ∪ scenario step states ∪
  note anchors), asserts every referenced target exists at that state,
  measures each found target's box as a fraction of the frame, and
  screenshots the state. Writes `public/snapshots/index.json` (instanceKey →
  `{ file, width, height, targets, missing }`) and one PNG per state. Exits 1
  when a target is missing or a state fails to load — that is the contract
  breaking, made visible in CI.
- **`validate`** (`scripts/validate.mjs`, `npm run validate`) — static
  checks only, never reads the prototype's source: manifest shape against
  `spec/stavy.schema.json`, cross-references (templates, scenario pages,
  requirement refs, note targets), the URL contract (§2.1, every declared
  dimension is a placeholder and vice versa), and the last scan's `missing`
  targets. Also prints a coverage summary (`--coverage`) and can cross-check
  scenario refs against a requirements document's text (`--refs <doc>`).
- Three more generators follow from the manifest alone: a **changelog**
  between two manifest versions (`changelog.mjs`), **handoff sheets** per
  page (`handoff.mjs`), and **acceptance-test skeletons** from scenarios
  (`gen-tests.mjs` → Playwright, each step opening the page's real `url` and
  asserting the target).

## 4. Conformance levels

- **Level 0 — manifest + urls + snapshots.** The workspace has an accurate
  `stavy.json` with a `url` for every page, and `npm run scan` runs clean
  enough to produce snapshots (targets may still be missing — that's Level
  1). Even without a viewer running, this is useful: machine-readable context
  for AI agents, and a coverage map from the PNGs alone.
- **Level 1 — url state for every declared dimension, targets, scan green.**
  Every page's `url` reaches every dimension it declares (§2.1); every
  referenced target exists and is found by the scan; `npm run scan` and
  `npm run validate` both exit 0. The canvas, player, tours, and inspector
  all work.
- **Level 2 — organisms via harness routes or stories.** Bespoke components
  are registered with `kind: "component"` and reviewable on their own,
  through an additive harness route or an existing story, never by stripping
  a page down.

## 5. Non-goals

- **Stavy never renders the prototype.** No page modules, no render hook, no
  bundler plugin on the prototype's side. If the viewer needs to import
  something from the prototype to work, that's a bug in the viewer, not a
  missing hook to add.
- **Stavy never dictates the prototype's architecture.** No required router,
  store, UI kit, or URL scheme. The only requirement is that some URL renders
  a given dimension assignment — how is entirely the prototype's business.
- Not a component library or design system — components come from the host
  kit.
- Not a data-mocking framework — fixtures are the prototype's business.
- Not production routing/state — prototypes are throwaway by design; the
  manifest is the durable artifact.

---

## Changes from v0.1

v0.1 had the viewer *render* the prototype: page modules exporting
`Page({ dims, nav, portalContainer })`, mounted inside canvas cards and the
page view by a viewer that imported the prototype's code. Adoption failed in
practice — making an existing prototype fit that contract meant gutting it:
stripping app shells, routers, and providers down to what the viewer's mount
point could host, producing half-functioning screens and leaking modals.

v0.2 makes the viewer an overlay instead. It is a static page served next to
the prototype, same origin, that loads the prototype's own URLs into a frame
and never imports its code. Concretely, this removes:

- Page modules, the `module` field, `nav`, `portalContainer`.
- **Overlay containment** as a viewer concern — a modal that portals to
  `document.body` now portals to the *iframe's* body, which the frame already
  clips and scales correctly. No container prop to thread, no escape-hatch
  cheat sheet per UI kit.
- The **State** rules (no module-level stores, no routers, no import-time
  side effects, fixtures-not-fetch) — they existed only because the viewer
  mounted many instances of the same module in one document. The prototype is
  now a real, independently-running app; it can have exactly the singletons,
  routers, and stores a real app has. (Deterministic fixtures — fixed clock,
  seeded ids, no network — remain good practice for scannable, diffable
  states, but they're no longer a document-sharing hazard.)
- The Vite slice plugin and `PROTO=<id>` sliced builds. `prototypes[]`
  survives as an informational grouping only (§1.9).
- `templates[]` as *code* — a template id no longer selects a render path;
  it's an optional label (§1.2).
- `prebuilt/stavy.css`, the containment-diagnostics warnings, and
  `snapshot.mjs` (replaced by `scan.mjs`, which now also checks targets
  instead of only screenshotting).

And it adds: the `url` field (§2.1) as the entire binding contract, the
player as a first-class mode distinct from the canvas, drift detection for
in-frame navigation, and a scan step that is simultaneously the contract
check and the source of the canvas's pins/anatomy/snapshots.
