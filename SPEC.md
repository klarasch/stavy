# Protoscope — an open standard for AI-assisted prototyping (v0.1, draft)

Protoscope is a convention for organizing vibe-coded prototypes so that they stay
legible: anyone can see, bird's-eye, what scenarios, states, and screens exist,
zoom into any of them and interact, and ship a demo build that only contains the
pages actually being demoed.

It has three parts:

1. **The manifest** (`protoscope.json`) — a framework-agnostic description of the
   prototype workspace. This file *is* the standard.
2. **The binding contract** — the two small hooks a host codebase implements so a
   viewer can render what the manifest describes.
3. **The viewer** — any tool that reads the manifest and renders the canvas,
   tours, annotations, and inspector. This repo ships a React reference viewer;
   the manifest doesn't care what the viewer is written in.

A Claude skill (`skill/SKILL.md`) operates the system: it scaffolds workspaces,
registers templates, and keeps the manifest in sync with the code.

---

## 1. The manifest

One JSON document at the workspace root. Top-level shape:

```jsonc
{
  "version": "0.1",
  "product":    { "name": "...", "description": "..." },
  "dimensions": [ ... ],
  "templates":  [ ... ],
  "pages":      [ ... ],
  "scenarios":  [ ... ],
  "prototypes": [ ... ]
}
```

### 1.1 Dimensions

A **dimension** is a named axis along which a page varies. The standard does not
hardcode any particular axes — data states, user roles, lifecycle stages,
process progress, feature flags, locales, breakpoints are all just dimensions.

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

`kind` is advisory metadata for viewers (e.g. grouping or iconography); it never
changes semantics.

### 1.2 Templates

The registry of **reusable page templates**. Components come from the host's UI
kit; templates are the layer this system owns — page-level compositions that new
pages start from instead of a blank file.

```jsonc
{
  "id": "list-page",
  "label": "List page",
  "description": "Filter bar + data table with empty/loading/error states",
  "source": "src/demo/templates/ListTemplate.tsx",   // where the implementation lives
  "uiKit": ["Input", "Select", "Table", "Badge"],    // UI-kit components it composes
  "organisms": ["work-queue"]                        // registered components (kind: "component") it is built from
}
```

`organisms` is the template's **anatomy**: which registered components it
composes. Viewers use it (together with `data-proto-meta.organism` on the
rendered regions) for the page-anatomy view, and validators check the ids.

### 1.3 Pages

A **page** is a template instantiation with declared dimensions:

```jsonc
{
  "id": "expense-detail",
  "label": "Expense detail",
  "template": "detail-page",
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

- `kind` (optional: `page` | `component`). A **component** is a bespoke organism
  — a panel, widget, or composite that the product builds from the design
  system's atoms (not the atoms themselves; those belong in the DS's own
  catalog). Components use the exact same contract as pages (dimensions,
  defaults, instances, annotations, fidelity, `data-proto`), render inside
  their own `frame: { width, height }`, and appear in their own canvas section.
- `module` (optional) — path of the page module when it isn't at the default
  location (`src/demo/pages/<id>.tsx` in the reference implementation).
- Components register **a template of their own** whose `source` is the
  organism file (e.g. `approval-actions-organism` → `src/demo/organisms/ApprovalActions.tsx`);
  the page template that composes it lists the component id in `organisms`.
  That is how validators and the inspector resolve where an organism lives.
- `fidelity` (optional: `static` | `navigable` | `interactive`) declares how much
  behaviour the page carries. See the skill's "fidelity ladder" — the default
  is `static`, and the canvas surfaces the rung so scope creep is visible.
- The full variant space is `dimensions` (the cartesian product, addressable at
  runtime via the dimension switcher). `instances` is the *curated subset* shown
  on the canvas — coverage made visible without combinatorial explosion.
- `defaults` fill in unspecified dimensions everywhere (instances, scenario
  steps, deep links).

### 1.4 Scenarios

A **scenario** is an executable walkthrough — the answer to "where do I click?".

```jsonc
{
  "id": "manager-approves",
  "label": "Manager reviews and approves",
  "persona": "manager",
  "description": "...",
  "steps": [
    {
      "page": "expense-detail",
      "dims": { "role": "manager", "lifecycle": "submitted" },
      "target": "ApproveButton",     // semantic target to highlight; omit = observe step
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
overlay with highlights, (b) a flow lane on the canvas, or (c) a written
walkthrough. All three come from the same data.

### 1.5 Canvas notes ("pointing notes")

Free-standing notes placed on the canvas next to a page instance, with a leader
line to the instance or to a specific element inside it:

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
travel with the page wherever it's shown; canvas notes are *about the review* —
design rationale, open questions, scope remarks — and live on the overview.

### 1.6 Requirements (the PM's half of the contract)

```jsonc
{ "id": "PRD-118 §3", "title": "Managers approve, reject, or request changes",
  "source": "docs/PRD-118.md §3", "priority": "must" }
```

`requirements[]` lists what the prototype must demonstrate; scenarios cite
them in `refs` by exact id. A viewer SHOULD render a coverage board
(requirement → scenarios → states, gaps highlighted); a validator SHOULD warn
for requirements no scenario cites and refs no requirement declares, and MAY
cross-check a requirements document's text (`check --refs`). Requirements are
typically generated from the PRD by the agent; PMs review the board rather
than editing the manifest.

### 1.7 Boards (supporting material — outside the contract)

Information architecture, flow/state diagrams, moodboard images, principles:
things a team wants *next to* the prototype without them being part of what
must be covered. A viewer renders boards without interpreting them:

```jsonc
{ "id": "lifecycle", "title": "Expense lifecycle", "kind": "mermaid",   // mermaid | image | text
  "source": "stateDiagram-v2\n  [*] --> draft\n  …", "width": 620 }
```

Boards are deliberately not referenced by scenarios, slices, or refs; the
validator only checks ids and kinds. Teams may ask their agent to generate
boards freely — the contract (§1.3–1.5) stays unchanged.

### 1.7b Copy catalog (optional, strongly recommended)

```jsonc
"strings": "src/demo/strings.json"     // { "<locale>": { "<key>": "text" } }
```

All user-visible copy lives in one catalog, keyed, per locale; templates never
inline it. This makes copy a **document** rather than code: designers rewrite
it without touching components (and without an agent), legal/compliance review
it as Markdown/CSV (`strings.mjs`), translators get a file, a `locale`
dimension switches it, and the inspector shows which key produced any text on
screen. Fixture *data* (names, merchants, amounts) is not copy and stays in
fixtures.

### 1.8 Viewer defaults

A product or design system picks viewer defaults once; individual links may
override them (e.g. `?tb=top-right` moves the toolbar for a page whose footer
it would cover):

```jsonc
"viewer": { "toolbar": "bottom" }   // floating: bottom | top | bottom-left | bottom-right | top-left | top-right
                                    // docked bar (prototype viewport shrinks, nothing is covered): bar-bottom | bar-top
```

### 1.9 Prototypes (build slices)

A **prototype** names a subset of the workspace — the unit of demoing and of
build scoping:

```jsonc
{
  "id": "approval-flow",
  "label": "Approval flow demo",
  "pages": ["dashboard", "expenses", "expense-detail"],
  "scenarios": ["manager-approves", "finance-reimburses"]
}
```

A conforming build tool, given a prototype id, MUST exclude non-listed pages
from the bundle and SHOULD filter the canvas to the slice. (Reference
implementation: the `protoscope-slice` Vite plugin + `PROTO=<id> vite build`.)

---

## 2. The binding contract

The manifest is inert without two hooks the host codebase provides:

### 2.1 Page modules

Each page id maps to a renderable module with a uniform interface:

```ts
// The viewer calls every page the same way:
Page({ dims, nav })
// dims: full dimension assignment, e.g. { role: "manager", lifecycle: "submitted" }
// nav(pageId, dimOverrides): navigate to another page/variant
```

Pages resolve their own mock data (fixtures) from `dims`. Interactions that
"change state" in the prototype are expressed as navigation across dimension
values (`nav("expense-detail", { lifecycle: "approved" })`) — prototype state
machines are dimension walks, which keeps every reachable state addressable,
linkable, and visible on the canvas.

### 2.2 Semantic targets

Elements referenced by scenarios, annotations, or the inspector carry a
`data-proto` attribute; optional `data-proto-meta` holds JSON shown in dev-mode
inspection:

```html
<button data-proto="ApproveButton"
        data-proto-meta='{"component":"Button","advancesTo":"approved"}'>
```

Target ids are PascalCase, stable, and unique per page (use `Name:key` for
repeated elements, e.g. `ExpenseRow:exp-2104`). Validators resolve targets
textually, not by rendering: an id counts as present when it appears as a
string literal in the page's sources — the template, the page module, the
template's organisms, and whatever those import relatively — or as a dynamic
prefix (`` proto(`Row:${id}`) ``). Ids that are genuinely computed can be
declared for the validator in a comment: `// @proto-targets ApproveButton RejectButton`.

**Component names for the inspector.** The inspector builds its "UI-kit chain"
from a component-name attribute on kit components. Two cases:

- The kit already stamps one (shadcn: `data-slot="button"`). Nothing to do.
- The kit does not (MUI, Ant, most in-house systems). Add a thin wrapper layer
  — one file that re-exports the kit components your templates use, each
  stamping `data-component="<Name>"` on its root node — and import kit
  components from that layer instead of the kit directly. A conforming
  inspector MUST read both `data-slot` and `data-component`.

Suggested-not-required: a `state` dimension with `loaded / empty / loading /
error` is the conventional starter set, but no value is mandated.

### 2.3 Inspector adapter

Dev-mode inspection has two framework/kit-specific parts, isolated in one
adapter module (`inspect-adapter.ts` in the reference viewer): how to list the
**components** behind a DOM element (React: the component tree; other
frameworks supply their equivalent) and how to attribute **colors and tokens**
(Tailwind + token names by default; CSS-in-JS kits degrade to computed values
unless they map their theme). Everything else in the inspector — semantic
targets, DOM classes/attributes, computed type/spacing, page and dimensions —
is framework-free. Setting up a workspace on a new stack means filling in this
adapter, which the skill does.

### 2.4 The viewer is not built from the host kit

The viewer's own chrome (toolbars, tour cards, inspector, canvas panels) is a
separate product with its own tokens; it is **not** required — or recommended —
to be restyled in the host product's UI kit. The reference viewer is
self-contained (no imports from the host kit), so adopting it means copying
`src/protoscope/` unchanged and implementing only §2.1 and §2.2. Re-theming the
chrome is optional polish, not part of conformance. (This was the single
largest cost in a transferability trial on MUI before the viewer was made
self-contained.)

---

## 3. Viewer expectations

A conforming viewer SHOULD provide:

- **Canvas**: pan/zoom overview rendering every page's `instances` live, grouped
  by page, plus scenario lanes; anything clickable zooms into the interactive page.
- **Dimension switcher**: flip any dimension of the open page at runtime. Pages
  may carry many axes (ten is realistic); beyond a handful the switcher MUST
  degrade to a panel rather than overflow (reference: inline pills up to 3
  axes, then a panel with segmented controls and a "changed from default" count).
- **Coverage matrix**: on the canvas, a page's pinned instances are laid out on
  its two most-varying dimensions with row/column headers; declared-but-unpinned
  cells are shown as empty placeholders (still openable). Headers and group
  titles stay legible when zoomed out (rendered at constant screen size).
- **Anatomy as design annotation**: a page's `annotations` double as its
  anatomy — the canvas shows, next to the page's states, one instance with the
  annotated regions numbered and a legend of *what each part does*, readable by
  PMs, designers and engineers alike. (Which components implement a part is the
  inspector's job, not the anatomy's.)
- **Table of contents**: the canvas grows; a viewer SHOULD offer a jump list of
  scenarios, pages and components.
- **Tour player**: play scenarios as overlay-guided walkthroughs; clicking the
  highlighted element advances the tour.
- **Annotations**: pins from `pages[].annotations`, shown both on the open page
  and over canvas thumbnails, with three modes on a page — hidden, numbers with
  the note on hover, all notes open (review/print).
- **Distinct chrome**: viewer UI must be visually separate from the prototype
  (the reference viewer uses floating dark chrome) so tool and product are never
  confused in a demo.
- **Wireframe mode** (optional): a fidelity toggle that renders prototype
  content lo-fi without touching the code.
- **Inspector**: dev mode, on pages *and* on the canvas thumbnails. For the
  focused element it answers the questions an engineer actually has:
  *which React component is this, with which props* (read from the component
  tree, innermost first, parents walkable); *which classes / tokens produce
  what I see* (the element's classes, grouped, copyable; type/spacing tokens
  derived from computed style); and *where does this color come from* (the
  class on this element or the ancestor it inherits from, and the design-token
  variable behind it). Plus the semantic target's meta, DOM attributes, the
  page/template, and active dimensions. Any level from the exact element
  outward through every semantic ancestor is selectable.
- **Comments** (optional, viewer-level, never in the manifest): conversation
  anchored to `page + dims + data-proto target + the exact element's child path`
  (position in % of that element, so bubbles survive browser zoom and reflow),
  visually distinct from annotations, threadable and resolvable. A reference
  viewer SHOULD work without a server: local storage plus a shareable payload
  (URL hash) and a Markdown export; richer backends are adapters.
- **Tooltips and shortcuts**: every mode toggle has a tooltip that names its
  key; a "?" sheet lists them. Single-letter keys are ignored while typing.
- **Deep links**: every page × dimension assignment has a URL
  (`/p/<pageId>?d_<dim>=<value>&...`), so any state is shareable. Viewer modes
  are URL state too (`w=1` wireframe, `a=1` annotations, `i=1` inspect,
  `tour=<id>&ts=<n>`), and the canvas persists its viewport (`v=x,y,zoom`) and
  flags (`notes=1`, `w=1`) — a link reproduces exactly what the sender saw.
- **Honesty + hide UI**: the chrome carries a "Mock only — not a real product"
  label and a shortcut (⌘\ / Ctrl+\) that hides all viewer UI for clean demos
  and screenshots.
- **Canvas zoom range** must reach far enough to read details inside thumbnails
  (the reference viewer allows 5%–1200%), and the canvas must stay legible from
  orbit: content is organised into **named areas** (one per page/component,
  plus scenarios and boards) whose titles render at constant screen size, so
  the overview reads as a map rather than a scroll.
- **Headless mode**: `?ui=0` starts with all viewer chrome hidden, for
  snapshots, embeds, and screenshots in CI.

---

- **Authoring in dev** (optional): a dev server MAY expose an endpoint that
  writes a design annotation into the manifest from the viewer
  (reference: `POST /__protoscope/annotation`), so designers annotate without
  prompting an agent; the manifest stays the source of truth.

## 3b. Tooling expectations

A workspace SHOULD ship a `check` that (a) validates the manifest against the
code (targets exist, dimension values declared, slices consistent, notes and
organisms resolve), (b) checks scenario `refs` against requirement documents
— every ref must appear in a document, and every documented section should be
demonstrated by some scenario — and (c) prints coverage (pinned instances per
declared variant space). The reference implementation is `scripts/validate.mjs`
(`npm run check`). Snapshots of every pinned instance (`scripts/snapshot.mjs`)
make state-level visual diffs possible in CI. Three more generators follow
from the manifest alone: a **changelog** between two manifest versions
(`changelog.mjs`), **handoff sheets** per page (`handoff.mjs`), and
**acceptance-test skeletons** from scenarios (`gen-tests.mjs` → Playwright).

## 4. Conformance levels

- **Level 0 — manifest only.** The workspace has an accurate `protoscope.json`.
  Even without a viewer this is useful: it's machine-readable context for AI
  agents and a human-readable coverage map.
- **Level 1 — viewable.** Binding contract implemented; some viewer renders
  canvas + pages.
- **Level 2 — full.** Tours, annotations, inspector, and sliced builds.

## 5. Non-goals

- Not a component library or design system — components come from the host kit.
- Not a data-mocking framework — fixtures are the host's business.
- Not production routing/state — prototypes are throwaway by design; the
  manifest is the durable artifact.
