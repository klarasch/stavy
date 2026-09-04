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
   state genuinely isn't reachable through a URL yet, register it as a gap
   (leave it out of `dimensions`, or note it) rather than faking the screen.
3. **State is route + dataset + minimal UI params.** A page's `url` template
   (SPEC §2.1) should read as "this route, with this dataset, with these
   flags" — not a fork. No page-per-state, no branch that only exists to
   satisfy a dimension value.
4. **No Stavy runtime imports in product code.** Nothing under `src/` (or
   equivalent) imports anything from the viewer. This app must build, run,
   and behave identically with the entire `stavy/` folder deleted.
5. **Fixtures are deterministic.** Fixed clock, seeded ids, no live network
   calls in states the manifest registers — the scan screenshots and checks
   these states, and nondeterminism makes both flaky.
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

## The fidelity compromise: real app, fake data

The prototype should be the real app shell, router, and UI kit, wired to
named, deterministic datasets — not a separate mock. State = route + dataset
+ minimal UI params. Prefer wiring one more `{dim}` into an existing data
layer over adding a new page, a new mode, or a new mock. If a scenario needs
a state the app can't reach yet, that's a real gap — say so, don't paper over
it with a static screen.

## Commands

- `npm run stavy:scan` — visits every registered state in a real browser,
  checks that every referenced target exists, and writes the canvas
  snapshots. Run it after any change that touches a registered page's markup
  or URL handling.
- `npm run stavy:validate` — static checks only (manifest shape, cross-refs,
  the URL contract, the last scan's missing targets). Fast; run it after any
  manifest edit.
- Open `/stavy/` (or `/stavy/index.html`) next to the running app to see the
  canvas.
