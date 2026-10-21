# Stavy rules for this repo

This repo is instrumented with Stavy: a `stavy.json` manifest plus a static
viewer served from `public/stavy/` describes states of this app for review.
The viewer never imports this app's code — it loads this app's own URLs into
a frame. That means integrating Stavy touches this codebase only in small,
additive ways. Follow these rules whenever you touch a page the manifest
registers, or register a new one.

1. **Integration is additive only.** Add a URL param read, a harness route,
   an id at a usage site, a manifest entry. Never remove, restructure, or
   simplify an existing page or layout to make it fit Stavy. If nothing needs
   to change to register a page, register it as-is.
2. **Never replace real logic with a static mock to satisfy Stavy.** If a
   state genuinely isn't reachable through a URL yet, add a scene for it or
   leave it out — don't fake the screen.
3. **A state is a URL with a name.** Route + dataset + minimal UI params,
   ideally one `scene` param naming a bundle of them. No page-per-state, no
   branch that only exists for Stavy.
4. **No Stavy runtime imports in product code.** Nothing under `src/` (or
   equivalent) imports anything from the viewer. This app must build, run,
   and behave identically with the entire `stavy/` folder deleted.
5. **Fixtures are deterministic.** Fixed clock, seeded ids, no live network
   calls in states the manifest registers — the scan screenshots and checks
   these states, and nondeterminism makes both flaky. If data is anchored to
   "now", pin "now" whenever a `scene` param is present (e.g. 2026-01-15
   09:00), so a rescan of an unchanged state gives the same pixels.
   Fake latency with `setTimeout` (≥50 ms): a tour step or capture with
   `hold` can then keep a spinner or toast on screen.
6. **Organisms render through a harness route or an existing story, never by
   stripping a page down to one component.** A harness route is a new,
   additive route that renders the organism with the app's real providers and
   no page chrome around it.
7. **Targets are the app's own instance ids.** Prefer an id the kit or tests
   already stamp (`data-testid`, a design-system instance attribute) over
   adding a new one. Where none exists, add one attribute at the usage site —
   never inside a shared kit component, which would stamp every instance
   everywhere it's used.
8. **Same origin.** The viewer is served from this app's own public folder
   (`public/stavy/`), at the same origin as the app. Don't move it behind a
   different host or a proxy that changes the origin — that breaks inspect,
   tours, pins, and comments (snapshots keep working regardless).

## Commands

- `npm run stavy:scan` — captures snapshots for new or missing states only
  (incremental). `-- --keys a,b` for exactly those states, `-- --all` before
  a review. The viewer's refresh button does the same on demand. Snapshots
  are a cache: never commit them.
- `npm run stavy:validate` — static checks (manifest, boards, references).
  Fast; run it after editing `stavy.json` or `stavy-content/`. Only a state
  that doesn't load or unparsable JSON is an error; the rest are warnings.
- Open `/stavy/` next to the running app. With the dev plugin in the Vite
  config, boards, notes and comments are editable there.
