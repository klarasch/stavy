# Contributing to Stavy

This repo is two things at once, and it matters which one you're touching:

1. **The standard** — `SPEC.md` and `spec/stavy.schema.json`. This is the
   contract: the manifest format and the binding contract any viewer relies on.
2. **The reference viewer** — `src/stavy/`, the React implementation of that
   contract, plus the demo product (`src/demo/`) it's exercised against.

Changes to the standard are a different kind of change than changes to the
viewer, and are reviewed differently (see below).

## Proposing a spec change

Don't open a PR against `SPEC.md` or `spec/stavy.schema.json` first. Open an
**issue** describing your use case: what you're trying to model (a role, a
lifecycle stage, some other axis), and why the current manifest shape doesn't
fit. Dimensions are deliberately generic — most "missing feature" requests turn
out to be expressible as a dimension or a scenario without touching the schema.
If discussion concludes the standard itself needs to change, the PR comes
after, and it should update `SPEC.md`, the schema, and `docs/` together — a
spec change that isn't reflected in the schema (or vice versa) will fail
`npm run check`.

Changes to the reference viewer (bug fixes, new inspector behavior, etc.) can
go straight to a PR.

## Dev setup

```bash
npm install
npm run dev        # full workspace at http://localhost:5173
npm run validate   # manifest ↔ code invariants
npm run check      # validate + coverage summary + PRD refs check
```

Run `npm run validate` (or `check`) before opening a PR that touches
`stavy.json`, a page, a template, or an organism — it's the thing that keeps
the manifest honest.

## "Home is upstream" — this repo is not meant to be forked-and-edited

`src/stavy/` is developed **only here**. Repos that adopt Stavy (via
`node scripts/init.mjs ../their-repo`) get a copy of the viewer, but they never
edit it in place — see `docs/ADOPTION.md` for the full model. If you're fixing
something you noticed while adopting Stavy elsewhere, the fix belongs in *this*
repo, not in the adopting repo's copy (a work-local patch is silently
overwritten the next time `init` is re-run there).

## Generated files — don't hand-edit these

The following are produced by scripts and get overwritten the next time those
scripts run. Edit the source they're generated from, then re-run the script,
not the file itself:

| Generated file | Regenerate with |
|---|---|
| `src/stavy/icons.tsx` | `node scripts/vendor-icons.mjs` |
| `prebuilt/stavy.css` | `npm run build:css` |
| `tests/scenarios/` | `npm run gen:tests` (or `npm run test:scenarios` to also run them) |
| `docs/handoff/` | `npm run handoff` |
| `docs/strings.md`, `docs/strings.csv` | `npm run strings` (source of truth is `src/demo/strings.json`) |

CI checks that these are in sync with their sources, so a PR that hand-edits
one of them directly will drift out from under the next regeneration and fail
review either way.
