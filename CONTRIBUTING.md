# Contributing to Stavy

This repo is three things at once, and it matters which one you're touching:

1. **The standard** — `SPEC.md` and `spec/stavy.schema.json`. The manifest
   format and the URL contract any viewer relies on.
2. **The reference viewer** — `src/stavy/`, a standalone React page that
   overlays a prototype through same-origin iframes. Built on its own by
   `vite.viewer.config.ts` into `dist-viewer/`, which is what adopters copy
   into their `public/stavy/`.
3. **The demo prototype** — `src/demo/` ("Orbit"), a normal React app with
   URL-addressable state, served at `/` while the viewer is served at
   `/stavy/` (two entries in `vite.config.ts`). It is the thing the viewer is
   exercised against and the reference for "what a prototype does".

Changes to the standard are a different kind of change than changes to the
viewer, and are reviewed differently (see below).

## Proposing a spec change

Don't open a PR against `SPEC.md` or `spec/stavy.schema.json` first. Open an
**issue** describing your use case: what you're trying to model (a role, a
lifecycle stage, some other axis) and why the current manifest shape doesn't
fit. Dimensions are deliberately generic — most "missing feature" requests
turn out to be expressible as a dimension or a scenario without touching the
schema. If discussion concludes the standard itself needs to change, the PR
comes after, and it should update `SPEC.md`, the schema, `src/stavy/types.ts`
and `docs/` together.

Changes to the viewer (bug fixes, inspector behaviour, canvas layout) can go
straight to a PR. The viewer must keep working with **zero code inside the
prototype**: if a change needs the prototype to cooperate beyond serving URLs
and carrying target ids, it is a spec change.

## Dev setup

```bash
npm install
npx playwright install chromium
npm run dev            # Orbit at http://localhost:5173, the viewer at http://localhost:5173/stavy/
npm run scan           # against the dev server: snapshots + the target report → public/snapshots
npm run validate       # manifest shape, cross-references, the URL contract, last scan's misses
npm run check          # validate + coverage summary + PRD refs check
npm test               # unit tests (vitest)
npm run test:scenarios # generated Playwright specs from stavy.json + the viewer specs
npm run build:viewer   # the redistributable viewer → dist-viewer/
```

Run `npm run validate` before opening a PR that touches `stavy.json`; run
`npm run scan` when you touched Orbit or the manifest's targets — the scan is
what keeps the manifest honest.

## "Home is upstream" — this repo is not meant to be forked-and-edited

`src/stavy/` is developed **only here**. Adopting repos get the *built* viewer
from `scripts/init.mjs` and never edit it; a fix for something noticed while
adopting belongs in this repo (see `docs/ADOPTION.md` §B5).

## Generated files — don't hand-edit these

| Generated | Regenerate with |
|---|---|
| `src/stavy/icons.tsx` | `node scripts/vendor-icons.mjs` |
| `tests/scenarios/` | `npm run gen:tests` |
| `public/snapshots/` (git-ignored) | `npm run scan` |
| `dist-viewer/` (git-ignored) | `npm run build:viewer` |

CI diffs the committed generated files against a fresh run and fails on
drift, then builds, scans and validates the demo before deploying it.
