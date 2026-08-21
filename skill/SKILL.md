---
name: protoscope
description: Set up and operate a Protoscope prototyping workspace — a manifest-driven system for vibe-coded prototypes with a zoomable canvas overview, guided scenario tours, dimension variants (states/roles/lifecycles), annotations, dev-mode inspection, and per-prototype build slicing. Use when the user wants to scaffold a prototyping workspace, register a page template, add a page/scenario/dimension/annotation to a prototype, create a demo build slice, or asks about protoscope.json. Works with any UI kit or design system.
---

# Protoscope skill

You are operating a **Protoscope workspace**: a prototyping repo organized around
a `protoscope.json` manifest, per the spec in `SPEC.md` (read it if present;
its rules win over this file on any conflict).

## Core model (memorize this)

- **Dimensions** are generic named axes (data state, role, lifecycle stage,
  process step, locale…). Never hardcode axis semantics; add a dimension when a
  page varies along a new axis.
- **Templates** are registered page-level compositions built from the host UI
  kit. New pages start from a template; if none fits, create and register one.
- **Pages** declare which dimensions they support, defaults, curated canvas
  `instances`, and `annotations`. Pages with `kind: "component"` are bespoke
  **organisms** (panels, widgets — not the design system's atoms) registered
  with the same contract inside their own `frame`, so they get their own
  states/notes on the canvas. Templates list the organisms they compose in
  `organisms` (their anatomy).
- **Scenarios** are executable step lists (page + dims + `target` + note) that
  power guided tours, canvas lanes, and written walkthroughs.
- **Prototypes** are named slices (pages + scenarios) used for scoped demo
  builds — a demo deploy must not pack the whole workspace.
- Every interactive "state change" in a prototype is navigation across dimension
  values via `nav(pageId, dims)` — never hidden component state — so every
  reachable state stays addressable and visible on the canvas.

## Invariants — keep the manifest true

The manifest is the single source of truth and must never drift from the code:

1. Any new page/template/scenario/dimension you code gets registered in
   `protoscope.json` in the same change, and vice versa.
2. Every scenario `target` and annotation `target` must exist as a
   `data-proto="<Target>"` attribute on the page it references, with dims under
   which it is actually rendered (a target inside a manager-only card needs
   `role: manager` in the step dims).
3. Target ids: PascalCase, stable, unique per page; repeated elements use
   `Name:key` (e.g. `ExpenseRow:exp-2104`). Add `data-proto-meta` JSON with at
   least `component`, plus anything an engineer would want in inspection
   (props, advancesTo, mock notes).
4. Page ids are kebab-case and must match the page module filename.
5. Every page keeps `defaults` covering all its dimensions; instances/steps may
   be partial (defaults fill the rest).
6. Every page carries a `fidelity` rung (see the ladder below) that matches
   what its code actually does. Canvas `notes` must reference an existing page
   (and, if given, an instance that is pinned and a `target` that exists).
   Scenario `refs` (PRD sections, tickets) are free-form strings — keep them
   stable so they can be grepped against requirement docs.
7. After edits, run `npm run validate` (`scripts/validate.mjs`). It checks:
   every `template` referenced by a page exists; every dim value used in
   instances/steps/defaults/notes is declared in `dimensions` AND allowed by
   the page's `dimensions` map; every prototype references existing
   pages/scenarios; every scenario step's page is in some prototype that
   includes the scenario; every `target` (steps, annotations, notes) exists
   as a `proto("…")` / `data-proto` in the page's source. Fix errors before
   you report done; treat warnings (missing fidelity, refs, defaults,
   un-pinned note targets) as prompts to decide, not noise.

## Fidelity ladder — static first, behaviour on demand

Prototypes drift toward "building the product". Protoscope resists this with
an explicit ladder. Every page declares its rung in the manifest (`fidelity`),
and you only climb when a scenario step *requires* it:

| Rung | `fidelity` | What the page may contain | Climb when… |
|---|---|---|---|
| 0 | `static` | Screens rendered from fixtures. No handlers except what the template ships. | — (default for every new page) |
| 1 | `navigable` | `nav()` calls between pages / dimension values (row → detail, CTA → flow). | A scenario step targets an element whose purpose is to go somewhere. |
| 2 | `interactive` | Local state beyond navigation: form inputs that affect the screen, toggles, optimistic list changes, in-page state machines. | A scenario step cannot be *demonstrated* without it (e.g. "filter narrows the table"). |
| ✗ | — | Real data fetching, persistence, auth, validation libraries, business logic. | Never. Mock it, and say so in an annotation. |

Rules of thumb:
- **Default to static.** When asked for "a page", deliver rung 0 with the states
  the reviewer must see (loaded / empty / loading / error as pinned instances).
  Static variants on the canvas are cheaper and more reviewable than code paths.
- **Prefer a dimension to a handler.** "After clicking Approve the status
  changes" is a lifecycle *dimension* with a `nav()` between values — not
  component state. This keeps every reachable state on the canvas.
- **Bind logic only for a named scenario step.** Before adding interactivity,
  point to the step that needs it. If no step needs it, add a pinned instance
  instead and move on.
- **Record the rung.** Set `fidelity` on the page and bump it deliberately in
  the same change that adds the behaviour; the canvas shows it, so reviewers see
  scope creep.
- **Mark mocks.** Anything faked (upload, search, validation) gets an annotation
  saying it is mocked, so stakeholders don't assume it works.
- When a user asks for "full functionality", confirm which scenario it serves
  and climb one rung at a time; never jump a whole page to `interactive` because
  one button needed state.

## Setting up a new workspace

When asked to install Protoscope in a repo (any framework, any UI kit):

1. Ask which UI kit / design system package to build on; import components from
   it — never fork or restyle kit components in the workspace.
2. Create `protoscope.json` with the product info and an initial dimension set
   drawn from the product's reality (typical starters: a `state` dimension with
   loaded/empty/loading/error; a role dimension if the product has roles).
3. Implement the binding contract for the host framework:
   - page modules exporting `({ dims, nav })` renderers, resolving fixtures from dims;
   - `data-proto` targets on everything scenarios/annotations reference;
   - if the kit does not stamp component names (MUI, Ant, most in-house kits),
     add a wrapper layer that re-exports the components you use with
     `data-component="<Name>"` on the root node, and import from it;
   - a registry that maps page ids → modules **through a build-time filter** so
     a slice env var (`PROTO=<id>`) excludes unlisted pages from the bundle
     (see `vite.config.ts` → `protoscopeSlice()` in the reference repo for the
     virtual-module pattern; port the idea to the host bundler). **Edit the
     hardcoded page-import path** in the plugin's `load()` hook
     (`/src/demo/pages/${id}.tsx`) to wherever this product's pages live —
     if you forget, every page import 404s silently.
4. Install the viewer: copy `src/protoscope/` from the reference repo **as is**.
   It is self-contained (own CSS tokens in `index.css` under `--ps-*`, no
   imports from the host UI kit) — do **not** re-theme it in the host kit; the
   chrome is deliberately a different product from the prototype. Also copy
   the `--ps-*` token block and `.ps-*` classes from the reference `index.css`,
   and `scripts/validate.mjs`. Caution: the reference pins React 19; under
   `@types/react@18`, `useRef<T>(null)` yields a read-only `current` — use
   `useRef<T | null>(null)` if you hit that.
5. Add an `AppFrame`-style shell template first, then register 2–4 page
   templates that match the product's dominant page shapes (list, detail,
   dashboard, form flow are the usual suspects).

## Day-to-day operations

**Extracting an organism**: when a region of a page is bespoke and will be
reviewed or reused on its own (a decision panel, a queue widget, a stepper),
move it to `src/demo/organisms/<Name>.tsx`, stamp its root with
`proto("<Name>", { component: "<Name> (organism)", organism: "<id>" })`,
register it as a page with `kind: "component"`, a `frame`, a `module`, **its
own template entry** (`<id>-organism`, `source` = the organism file), its own
dimensions/instances, and list it in the owning template's `organisms`. Ids
that are computed rather than literal get a `// @proto-targets …` comment so
`npm run validate` can see them. Do not
register design-system atoms (buttons, inputs) — those live in the DS catalog.

**Many dimensions**: ten axes on one page is normal. Keep each axis small,
pin instances for the combinations reviewers must see (the canvas lays pinned
instances out on the two most-varying axes and shows unpinned cells as gaps),
and use `defaults` so scenario steps and links stay short.

**Adding a page**: pick (or register) a template → create the page module →
declare dimensions/defaults → pin 3–6 curated instances (happy path + the
states a reviewer must not miss) → write `annotations` as **design
annotations**: one per meaningful region, `title` = what the part is, `note` =
what it does / why. They render as pins on the page, pins on thumbnails, and
the page's anatomy legend on the canvas — so write them for a PM, not for an
engineer (engineers use Inspect).

**Adding a scenario**: write steps as a real user path with one `target` per
step and a note that says *why*, not just *what*. Verify each target exists
under the step's dims. Add the scenario to the relevant prototypes.

**Adding a demo slice**: add a `prototypes` entry with the minimal page set;
build with the slice env var and confirm excluded pages are absent from the
output before sharing a deploy.

**Fixtures**: keep them as functions of dims in one fixtures module per product
area. Loading/empty/error variants should come from the same fixture logic,
not scattered conditionals.

## Style

- Prototype code is throwaway; the manifest is the durable artifact — optimize
  for manifest legibility over code cleverness.
- Mock everything behind the UI; never add real backends to a prototype.
- When the user shows you a Figma frame or screenshot to prototype, first map
  it to an existing template; only diverge when the mapping genuinely fails.
