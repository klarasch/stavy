---
name: stavy
description: Set up and operate a Stavy prototyping workspace — a manifest-driven overlay for reviewing an existing (or in-progress) prototype, with a zoomable canvas, a player, guided scenario tours, dimension variants (states/roles/lifecycles), annotations, and dev-mode inspection. Use when the user wants to register a page with Stavy, add a page/scenario/dimension/annotation to a prototype's manifest, work from a comments export, or asks about stavy.json. Works with any framework, router, or UI kit — Stavy never imports the prototype's code.
---

# Stavy skill

You are operating a **Stavy workspace**: a prototype repo with a `stavy.json`
manifest and a static viewer served alongside it (`public/stavy/`), per the
spec in `SPEC.md` (read it if present; its rules win over this file on any
conflict). Read `skill/RULES.md` (or `STAVY.md` if this repo was set up by
`init`) before touching any page — it is the rule list this file summarizes,
written to be read cold.

## Core model

- **Stavy is a viewer of existing things, not a way to build them.** It reads
  the prototype's own URLs into a same-origin frame. It never imports the
  prototype's code, and the prototype must run identically with Stavy absent.
- **Dimensions** are generic named axes (data state, role, lifecycle stage,
  process step, locale…). Each declares a `scope`: `page` (default) for axes
  that live inside one screen, `workspace` for axes that decide which world
  the whole prototype is in — release phase, role, locale. See "Workspace
  axes" below; getting this wrong is the most common modelling mistake.
- **Pages** declare a `url` template with `{dim}` placeholders (this IS the
  binding contract — SPEC §2.1), which dimensions they support, defaults,
  curated canvas `instances`, and `annotations`. Pages with `kind:
  "component"` are bespoke **organisms**, registered the same way but
  rendered through a harness route or story in their own `frame`.
- **Scenarios** are executable step lists (page + dims + `target` + note)
  that power guided tours inside the player, canvas lanes, and written
  walkthroughs. Every step is a card on the canvas — a 13-step scenario puts
  13 more cards there — so keep step lists purposeful.
- Every reachable state is a URL. There is no other kind of "state" Stavy
  knows about: no hidden component state to wire, no navigation callback to
  implement.

## Rules for an existing prototype (additive only)

Full text and rationale: `skill/RULES.md`. Summary:

1. **Additive only** — add a param read, a harness route, an id, a manifest
   entry. Never remove, restructure, or simplify a page to fit Stavy.
2. **Never fake a state to satisfy Stavy.** Not URL-reachable yet? Register
   it as a gap, don't mock it.
3. **State = route + dataset + minimal UI params.** No forked pages per
   state, no per-state branches.
4. **No Stavy runtime imports in product code.** The app runs identically
   with Stavy absent.
5. **Fixtures are deterministic** — fixed clock, seeded ids, no network.
6. **Organisms render through a harness route or stories** — never by
   stripping a page down to one component.
7. **Targets are the kit's own instance ids**, added at the usage site —
   never inside a shared kit component.
8. **Same origin** — the viewer is served from the app's public folder.

## Registering a page

1. Find (or add) the URL that renders the state: which route, and which
   search params / path segments select the dimension values.
2. Write `url` with a `{dim}` placeholder for every dimension this page will
   declare — nothing more, nothing less (`npm run validate`/`stavy:validate`
   checks both directions).
3. Make sure every declared dimension is actually reachable that way. If a
   dimension the manifest wants isn't wired into the app's data layer yet,
   wire it (see "URL state recipes" below) — additively.
4. Add target ids at the elements a scenario, annotation, or note will point
   at (rule 7).
5. Add `dimensions`, `defaults`, 3–6 curated `instances`, and `annotations`.
6. Run the scan (`npm run scan` / `stavy:scan`) against a running dev server,
   then `npm run validate` / `stavy:validate`. Fix errors; treat warnings
   (missing fidelity, no default, un-pinned note target) as prompts to
   decide, not noise.

## URL state recipes

- **Search params via the app's own router.** The common case: read
  `useSearchParams()` (or the framework's equivalent) at the route or
  fixture layer, not deep inside a component. A ~20-line `useDims`-style
  helper that merges declared dimension ids over per-route defaults is
  usually all it takes (see `src/demo/app/dims.ts` in the Stavy repo for a
  worked example — not code to copy verbatim, a shape to imitate).
- **Dataset as a dimension.** For data-heavy prototypes, prefer a named
  dataset id (`?dataset=empty-org`) over per-field query params — one
  `{dataset}` placeholder can stand in for a whole fixture, which keeps the
  `url` template short even when a state depends on a dozen fields.
- **Dialogs and overlays as a param.** Model an open modal/drawer as an
  `overlay` or `modal` dimension value (`?overlay=confirm-reject`) that the
  page reads to decide whether to render it open — not as something reached
  only by clicking, which would make that state unlinkable.
- **When a state isn't URL-reachable:** register a gap (an annotation or a
  requirement noting what's missing, or simply don't declare that dimension
  value yet) and say so. Never rewrite the page's logic just to expose a URL
  hook — that's rule 2.

## Harness routes for organisms

A bespoke organism gets its own page entry with `kind: "component"` and a
`frame: { width, height }`. Its `url` points at:

- a new, **additive** route the app adds that renders just the organism with
  the app's real providers and no page shell around it, or
- an existing Storybook/Ladle story's iframe URL, if the team already runs
  one — same `{dim}` placeholder contract.

Never register an organism by registering an existing full page and pretending
its `frame` is smaller — that still ships the whole page shell.

## Scenarios & targets

Write steps as a real user path: one `target` per step, a note that says
*why* this step matters, not just what it does. Verify each target exists
under the step's dims (the scan does this for you — run it before declaring
done). `refs` cites the requirement(s) the scenario demonstrates.

## Fidelity ladder

Every page declares a `fidelity` rung. Climb only when a scenario step needs
it:

| Rung | `fidelity` | What the page has | Climb when… |
|---|---|---|---|
| 0 | `static` | Renders a fixed state at its URL. | — (default) |
| 1 | `navigable` | Links/buttons that change the URL (route, or a dimension param) to reach another registered state. | A scenario step's point is to go somewhere. |
| 2 | `interactive` | Real local behaviour beyond navigation: form validation, optimistic updates, in-page state machines. | A scenario step can't be demonstrated without it. |

Record the rung honestly and bump it in the same change that adds the
behaviour — the canvas shows it, so reviewers see scope creep. Never add real
data fetching, persistence, auth, or business logic to satisfy a scenario —
mock it, and say so in an annotation.

## Working with PMs: requirements and coverage

`requirements[]` is the PM-facing list of what must be demonstrated. Given a
PRD (Markdown, Confluence/Notion export), extract requirements from its
headings/criteria into `requirements[]` (`id` = the stable handle people
already use, e.g. `PRD-118 §3`), then propose a scenario for each uncovered
one — don't silently invent scenarios. Scenarios cite requirements in `refs`
using the exact id. The canvas's coverage board shows demonstrated vs. gaps;
`npm run validate --coverage --refs <prd.md>` cross-checks the document text.
PMs review the board and comment; they don't edit the manifest.

## Working from comments (designers' and PMs' feedback)

When given a comments export (`.json`/`.md` from the viewer's Comments
panel), treat each open comment as a task: it's anchored to `page + dims (+
target)` — open that state (in the player, at the manifest `url`), make the
change, then produce a resolution payload to *Import* back so threads close
with a reply: write `comments-resolved.json` with the same comments plus
`resolved: true` and a reply `{ "author": "Claude", "body": "Done: …" }`
(keep ids; merging is by id). Never delete comments; never invent new ones.

## Day-to-day operations

- **After any change to a registered page's markup or URL handling**: `npm
  run scan` (needs a running dev/preview server + `npx playwright install
  chromium` once). It checks every referenced target exists and refreshes
  the canvas snapshots. A missing-target failure is a real finding — fix the
  page or the manifest, not the scan.
- **After any manifest edit**: `npm run validate`. Static only — schema,
  cross-refs, the URL contract, the last scan's `missing` list.
- **Changelog**: `npm run changelog [base-ref]` — a Markdown diff of the
  manifest (states added, scenarios changed, fidelity bumps, requirement
  coverage). Run it after every change that touches the manifest and paste
  the result into the PR description; don't hand-write one.
- **Handoff**: `npm run handoff` writes `docs/handoff/<page>.md` per
  page/component from the manifest. Regenerate before a handoff; never edit
  by hand.
- **Generated tests**: `npm run gen:tests` writes Playwright specs from
  scenarios (each step opens the page's real `url` and asserts the target);
  `npm run test:scenarios` runs them. A failing generated test is a finding
  about the prototype's wiring or the scenario — fix the prototype or the
  step, not the test.

## Workspace axes

Use `scope: "workspace"` when the question is *which world am I looking at*
rather than *where in this screen am I*. The test: if a reviewer would be
annoyed to re-pick it on every screen, it's workspace-scoped. Release phase,
role, and locale usually are; flow step, data state, overlay and density
never are.

How to model a phased prototype:

- One `phase` dimension, `scope: "workspace"`, values in shipping order (the
  first value is the default world).
- A screen that is **the same in both phases declares nothing** — absence
  means unchanged, and it keeps showing in every phase.
- A screen that **gains features** declares `"phase": ["p1", "p2"]` and pins
  an instance per phase, so the canvas row reads as the before/after.
- A screen that is **new later** declares `"phase": ["p2"]` only. It drops
  off the canvas in Phase I; the coverage matrix shows the gap.
- Scenarios that differ per phase are separate scenarios (`…-p1`, `…-p2`)
  with the phase pinned in every step; a scenario may never straddle two
  values.
- Do **not** model phases as forked pages, branches, or repos — all three
  hide the delta the canvas exists to show.

**Many dimensions**: ten axes on one page is normal. Keep each axis small,
pin instances for the combinations reviewers must see, and use `defaults` so
scenario steps and links stay short.

## Style

- Prototype code is throwaway; the manifest is the durable artifact —
  optimize for manifest legibility over code cleverness.
- Mock data behind the UI; never add real backends to a prototype.
- When the user shows you a Figma frame or screenshot to prototype, build it
  as the real app would render it — a route, real components, wired to a
  named dataset — then register the URL. Don't build a one-off screen just to
  have something to point Stavy at.
