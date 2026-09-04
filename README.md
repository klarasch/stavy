# Stavy — every state of your product, on one canvas

**An open standard for AI-assisted prototyping.** Stavy is a viewer of
existing things, not a way to build them: it reads a manifest and overlays a
zoomable canvas, a real interactive player, guided tours, and dev-mode
inspection *on top of* your prototype — without ever rendering it, importing
its code, or telling it how to be built.

Code prototypes beat static design mocks at interactivity, but they lose the
thing Figma had: the bird's-eye view. Nobody knows where to click, which
scenarios and states are covered, and reviewing means running the whole app
and clicking around to find a state. Stavy fixes that with one manifest file
and a static viewer that lives next to your app:

```
https://your-app/            → the prototype, unchanged
https://your-app/stavy/      → the viewer
https://your-app/stavy.json  → the manifest
```

## Three lines to try it on something you already have

```bash
node /path/to/stavy/scripts/init.mjs ../my-prototype-repo
cd ../my-prototype-repo && npm run dev
# register a page's URL in stavy.json, then open http://localhost:5173/stavy/
```

`init` builds the viewer as a self-contained static folder and drops it into
`public/stavy/`. No bundler plugin, no imports, no required router or UI kit
— see [`docs/ADOPTION.md`](docs/ADOPTION.md) for the full walkthrough and
[`docs/MONDAY.md`](docs/MONDAY.md) for a half-day trial plan.

## What it does

- **Canvas = map, not playground.** Every declared page × dimension variant
  shows as a pre-rendered snapshot, grouped by page and by scenario. Clicking
  a card opens the **player** — the canvas itself never runs your app.
- **Player = the real thing.** One same-origin frame of your actual
  prototype, fully interactive, with viewer chrome floating over it.
  Switching a dimension rewrites the frame's URL; navigating inside the app
  is followed if it lands on a registered state, or flagged as "off the map"
  if it doesn't.
- **The contract is a coverage check, not a rewrite.** A page is "in Stavy"
  when it has a `url` template with `{dim}` placeholders for the axes it
  varies by — nothing about your router, store, or components changes.
  `npm run scan` visits every registered state in a real browser, asserts
  every referenced target exists, and writes the canvas's snapshots; `npm
  run validate` checks the manifest statically (schema, cross-references, the
  URL contract) without touching your code at all.
- **Guided tours** — scenarios are executable step lists; the player runs
  them as spotlight walkthroughs inside the real frame. Clicking the
  highlighted element advances the tour.
- **Generic dimensions** — states, roles, lifecycle stages, process progress:
  all just named axes. Every page × dimension combination is addressable,
  linkable, and switchable live from the toolbar.
- **Annotations & pointing notes** — pins attached to target ids on the page
  and on canvas thumbnails (drawn from the scan's measurements — no live DOM
  needed to view them), plus sticky "pointing notes" on the canvas with
  leader lines to a screen or a part of one.
- **Everything is a URL** — dimensions, wireframe, annotations, inspect, tour
  step, and even the canvas viewport (`?v=x,y,zoom`) live in the link, so
  "look at this detail" is a paste, not a screen recording.
- **Chrome that stays out of the way** — floating glass toolbar,
  independent light/dark, a "Mock only — not a real product" label, and
  ⌘\ / Ctrl+\ to hide all viewer UI for clean demos. Because the prototype
  renders in its own frame document, the chrome shares no CSS with it —
  nothing to reset, nothing to fight.
- **Fidelity ladder** — pages declare `static` / `navigable` / `interactive`;
  the skill only climbs a rung when a scenario step needs it, and the canvas
  shows the rung so scope creep is visible.
- **Components & anatomy** — bespoke organisms (panels, widgets) registered
  through an additive harness route or an existing Storybook/Ladle story,
  with their own states; each page's annotations double as its anatomy —
  numbered callouts with *what each part does*, right next to the states.
- **Areas, not a noodle** — the canvas is organised into named areas
  (scenarios, one per page/component, boards) with titles that stay readable
  from orbit, plus a table of contents to jump around.
- **Boards** — IA, flow and state diagrams (Mermaid), images, notes:
  supporting material next to the prototype, explicitly outside the contract.
- **Coverage matrix** — pinned variants laid out on their two most-varying
  dimensions with labels that stay legible when zoomed out; unpinned cells
  show as gaps. Pages with many axes (10+) get a dimension panel instead of
  an overflowing toolbar.
- **Inspector for engineers** — on the player and on canvas thumbnails,
  reaching into the real frame: the React component and its props, the
  element's classes (copyable), type/spacing tokens, and *where each color
  comes from* (the class that sets it, the ancestor it inherits from, the
  token variable behind it).
- **Requirement coverage** — `requirements[]` + scenario `refs` render as a
  board: demonstrated vs. gaps; the validator cross-checks the PRD text.
- **Generated, not written** — changelog between manifest versions, a
  handoff sheet per page, and Playwright specs from scenarios.
- **Comments without a server** — leave comments on any page (anchored to
  target ids), share them as a link or a Slack-ready Markdown digest, unpack
  a colleague's link back in. Separate from annotations by design.
- **Manifest schema** — `spec/stavy.schema.json` gives editor autocompletion
  and is enforced by `npm run validate`.
- **AI-native** — `stavy.json` doubles as machine-readable context: the
  bundled Claude skill (`skill/SKILL.md`) registers pages against a running
  prototype and keeps the manifest true while vibe-coding, following
  additive-only rules (`skill/RULES.md`) so it never rewrites your app to fit
  the contract.

## Three ways into this repo

This repo is the standard, its reference viewer, and a demo product exercising
both.

### (a) The standard

The manifest format and binding contract that any viewer implements — this
is what makes a Stavy workspace portable across frameworks, routers, and UI
kits.

- [`SPEC.md`](SPEC.md) — the spec itself: manifest format + binding contract
- [`spec/stavy.schema.json`](spec/stavy.schema.json) — the JSON Schema behind
  it, enforced by `npm run validate` and giving editors autocompletion

**Status:** v0.2, draft. Dimensions are deliberately generic — open an issue
with the axes your product needs before assuming the schema doesn't fit.

### (b) The reference viewer

`src/stavy/` — canvas, player, tours, annotations, inspector — builds as a
self-contained static bundle (`npm run build:viewer` → `dist-viewer/`) with
relative asset paths, so it drops into any prototype's `public/` folder
unchanged, whatever that prototype is written in.

```bash
node scripts/init.mjs ../that-repo
```

This builds the viewer and copies it to `<repo>/public/stavy/`, copies the
validator/scan scripts and schema into `<repo>/scripts/stavy/`, the skill
into `<repo>/.claude/skills/stavy/`, and `skill/RULES.md` to `<repo>/STAVY.md`
for your agent's CLAUDE.md/AGENTS.md to reference. You then register a page
by writing its `url` (SPEC §2.1) and run the scan — no route to mount, no
binding-contract hooks to implement.

- [`docs/ADOPTION.md`](docs/ADOPTION.md) — the full hands-on guide: adopting
  on an existing prototype in an afternoon, making states URL-addressable
  without touching page code, CI, and comments without a server
- [`docs/MONDAY.md`](docs/MONDAY.md) — a half-day trial on a branch of an
  existing prototype, step by step
- [`scripts/init.mjs`](scripts/init.mjs) — the installer above

### (c) The demo — Orbit

`src/demo/` is **Orbit**, an expenses & approvals app (employee / manager /
finance) built on `src/ui/`, a vendored shadcn/ui kit — used to exercise the
standard and the viewer end to end. Its routes read dimensions from the URL
at `src/demo/app/dims.ts` — a reference for what "the prototype's own URL
contract" looks like in practice, not code Stavy requires.

```bash
npm install
npm run dev          # Orbit at http://localhost:5173, the viewer at /stavy/
```

**First run:** pre-rendered canvas snapshots aren't committed to this repo.
Generate them with `npm run scan` (needs the dev server running, plus
Playwright's Chromium installed once via `npx playwright install chromium`).
Without them the canvas still works — cards fall back to live frames (Live
mode) or label placeholders instead of snapshots.

## This repo

| Path | What it is |
|---|---|
| `SPEC.md` | The standard (v0.2 draft): manifest format + binding contract |
| `stavy.json` | The manifest for the demo workspace (Orbit) |
| `skill/SKILL.md` | Claude skill that operates any Stavy workspace |
| `skill/RULES.md` | Additive-only rules for an existing prototype repo, copied to `STAVY.md` by `init` |
| `docs/ADOPTION.md` | Hands-on guide: adopting on an existing prototype, URL-addressable states, CI |
| `docs/MONDAY.md` | A half-day trial plan on a branch of an existing prototype |
| `scripts/validate.mjs` | `npm run validate` — manifest ↔ schema/cross-ref validation, `--refs` PRD check, coverage summary |
| `scripts/scan.mjs` | `npm run scan` — the contract check (targets exist) + canvas snapshots, via Playwright |
| `scripts/changelog.mjs` | `npm run changelog [ref]` — Markdown diff of the manifest for PRs |
| `scripts/handoff.mjs` | `npm run handoff` — a handoff sheet per page/component |
| `scripts/gen-tests.mjs` | `npm run test:scenarios` — Playwright specs generated from scenarios |
| `scripts/strings.mjs` | `npm run strings` — copy review document (Markdown + CSV) from the catalog |
| `scripts/init.mjs` | `node scripts/init.mjs ../other-repo` — installs the built viewer + skill into any repo |
| `docs/PRD-118.md` | Mock PRD the `--refs` check runs against |
| `src/stavy/` | Reference viewer (canvas, player, tours, annotations, inspector) |
| `vite.viewer.config.ts` | Builds `src/stavy/` alone as the redistributable `dist-viewer/` |
| `src/demo/` | Demo product **Orbit** — expenses & approvals (employee / manager / finance) |
| `src/ui/` | Vendored shadcn/ui components (the "public UI kit" of the demo) |

## License

See [`LICENSE`](LICENSE).

## Status

v0.2 proof of concept. The spec is a draft — open an issue with your axes,
we made dimensions generic on purpose.
