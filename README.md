# Stavy — every state of your product, on one canvas

**An open standard for AI-assisted prototyping** — vibe-code your prototypes,
keep them legible.

Code prototypes beat static design mocks at interactivity, but they lose the
thing Figma had: the bird's-eye view. Nobody knows where to click, which
scenarios and states are covered, and every demo deploy packs the whole app.
Stavy fixes that with one manifest file and a viewer:

- 🗺 **Zoomable canvas** — every declared page variant live-rendered on a
  pan/zoom surface, grouped by page and by scenario. Click anything to drop
  into the fully interactive prototype.
- 🧭 **Guided tours** — scenarios are executable step lists; the viewer plays
  them as spotlight walkthroughs ("click here, because…"). Clicking the
  highlighted element advances the tour.
- 🧬 **Generic dimensions** — states, roles, lifecycle stages, process progress:
  all just named axes. Every page × dimension combination is addressable,
  linkable, and switchable live from the toolbar.
- 📝 **Annotations & pointing notes** — pins attached to semantic targets on
  the page and on canvas thumbnails, plus sticky "pointing notes" on the canvas
  with leader lines to a screen or a part of one.
- 🔗 **Everything is a URL** — dimensions, wireframe, annotations, inspect,
  tour step, and even the canvas viewport (`?v=x,y,zoom`) live in the link, so
  "look at this detail" is a paste, not a screen recording.
- 🎛 **Chrome that stays out of the way** — floating glass toolbar, light/dark
  independent from the prototype, a "Mock only — not a real product" label, and
  ⌘\ / Ctrl+\ to hide all viewer UI for clean demos.
- 🪜 **Fidelity ladder** — pages declare `static` / `navigable` / `interactive`;
  the skill only climbs a rung when a scenario step needs it, and the canvas
  shows the rung so scope creep is visible.
- 🧱 **Components & anatomy** — bespoke organisms (panels, widgets) registered
  with the same contract and their own states; each page's annotations double
  as its anatomy — numbered callouts with *what each part does*, right next to
  the states.
- 🗂 **Areas, not a noodle** — the canvas is organised into named areas
  (scenarios, one per page/component, boards) with titles that stay readable
  from orbit, plus a table of contents to jump around.
- 🧭 **Boards** — IA, flow and state diagrams (Mermaid), images, notes:
  supporting material next to the prototype, explicitly outside the contract.
- 🧮 **Coverage matrix** — pinned variants laid out on their two most-varying
  dimensions with labels that stay legible when zoomed out; unpinned cells
  show as gaps. Pages with many axes (10+) get a dimension panel instead of
  an overflowing toolbar.
- 🔬 **Inspector for engineers** — on pages and canvas thumbnails: the React
  component and its props, the element's classes (copyable), type/spacing
  tokens, and *where each color comes from* (the class that sets it, the
  ancestor it inherits from, the token variable behind it).
- 📋 **Requirement coverage** — `requirements[]` + scenario `refs` render as a
  board: demonstrated vs. gaps; the validator cross-checks the PRD text.
- 🧰 **Generated, not written** — changelog between manifest versions, a
  handoff sheet per page, and Playwright specs from scenarios.
- 📝 **Copy as a document** — every string lives in a keyed, per-locale
  catalog; designers rewrite it, legal reviews it as Markdown/CSV
  (`npm run strings`), the `locale` dimension switches it, and the inspector
  names the key behind any text.
- 💬 **Comments without a server** — leave comments on any page (anchored to
  semantic targets), share them as a link or a Slack-ready Markdown digest,
  unpack a colleague's link back in. Separate from annotations by design.
- 🧾 **Manifest schema** — `spec/stavy.schema.json` gives editor
  autocompletion and is enforced by `npm run check`.
- ⌨️ **Tooltips + shortcuts** — N/W/I/T/D/C, arrows in tours, ? for the sheet.
- ✏️ **Wireframe mode** — one toggle renders any page (or the whole canvas) as
  a lo-fi grayscale wireframe, for sharing early-stage work without polished-UI
  expectations.
- 🔍 **Dev-mode inspector** — hover/click any element to see its semantic id,
  meta, UI-kit component chain, page template and source, and active dimensions.
- 📦 **Sliced builds** — `PROTO=approval-flow vite build` ships only that
  prototype's pages. No more deploying the whole app to demo two screens.
- 🧩 **Registered page templates** — components come from your UI kit
  (this demo: shadcn/ui); Stavy's layer is reusable page templates that
  new prototypes start from.
- 🤖 **AI-native** — `stavy.json` doubles as machine-readable context: the
  bundled Claude skill (`skill/SKILL.md`) scaffolds workspaces, registers
  templates, and keeps the manifest true while vibe-coding.

## This repo

| Path | What it is |
|---|---|
| `SPEC.md` | The standard (v0.1 draft): manifest format + binding contract |
| `stavy.json` | The manifest for the demo workspace |
| `skill/SKILL.md` | Claude skill that operates any Stavy workspace |
| `docs/ADOPTION.md` | Hands-on guide: trial repo on another DS, rolling onto an existing mock repo, CI/CD |
| `scripts/validate.mjs` | `npm run check` — manifest ↔ code validation, `--refs` PRD check, coverage summary |
| `scripts/changelog.mjs` | `npm run changelog [ref]` — Markdown diff of the manifest for PRs |
| `scripts/handoff.mjs` | `npm run handoff` — a handoff sheet per page/component |
| `scripts/gen-tests.mjs` | `npm run test:scenarios` — Playwright specs generated from scenarios |
| `scripts/strings.mjs` | `npm run strings` — copy review document (Markdown + CSV) from the catalog |
| `scripts/init.mjs` | `node scripts/init.mjs ../other-repo` — installs the viewer + skill + CSS into any Vite/React repo |
| `scripts/snapshot.mjs` | `npm run snapshot` — Playwright PNG of every pinned instance (for visual diffs) |
| `docs/PRD-118.md` | Mock PRD the `refs` check runs against |
| `../protoscope-mui-trial/` | Transferability trial on MUI, built cold from SPEC + skill; see its `FRICTION.md` |
| `src/stavy/` | Reference viewer (canvas, page view, tours, annotations, inspector) |
| `src/demo/` | Demo product **Orbit** — expenses & approvals (employee / manager / finance) |
| `src/ui/` | Vendored shadcn/ui components (the "public UI kit" of the demo) |

## Run it

```bash
npm install
npm run dev          # full workspace on http://localhost:5173
```

Sliced demo builds:

```bash
PROTO=submit-flow npm run build:proto     # only the employee submission demo
PROTO=approval-flow npm run build:proto   # only the manager/finance demo
```

## Use it at work

The manifest and skill are UI-kit-agnostic, and the viewer is self-contained
(its own `--ps-*` tokens, zero imports from the host kit). To adopt on an
existing prototype repo: copy `src/stavy/` unchanged, add
`stavy.json`, implement the two-hook binding contract (page modules +
`data-proto` targets — plus a one-file `data-component` wrapper layer if your
kit doesn't stamp component names), and let the skill do the bookkeeping.
See `SPEC.md` §2 and the skill's "Setting up a new workspace" section. A cold
Sonnet agent did exactly this on MUI in under two hours; its friction report
drove the current wording of both documents.

## Status

v0.1 proof of concept. The spec is a draft — open an issue with your axes,
we made dimensions generic on purpose.
