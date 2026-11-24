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
2. **Don't remove or simplify existing logic to fit Stavy.** A screen that
   already works keeps its behaviour. If one of its states isn't reachable
   through a URL yet, add a scene for it or leave it out. Don't swap the
   screen for a static copy.
3. **Don't build logic Stavy doesn't need.** A new screen, dialog or state
   starts `static`: a route plus a `scene` that loads fixture data into real
   kit components. No handlers, no stores, no side effects on other pages.
   It becomes `navigable` (links between registered states) only when a flow
   step clicks through it, and `interactive` only when a reviewer has to
   operate it. Set the page's `fidelity` to match.
4. **A state is a URL with a name.** Route + dataset + minimal UI params,
   ideally one `scene` param naming a bundle of them. No page-per-state, no
   branch that only exists for Stavy.
5. **No Stavy runtime imports in product code.** Nothing under `src/` (or
   equivalent) imports anything from the viewer. This app must build, run,
   and behave identically with the entire `stavy/` folder deleted.
6. **Fixtures are deterministic.** Fixed clock, seeded ids, no live network
   calls in states the manifest registers — the scan screenshots and checks
   these states, and nondeterminism makes both flaky. If data is anchored to
   "now", pin "now" whenever a `scene` param is present (e.g. 2026-01-15
   09:00), so a rescan of an unchanged state gives the same pixels.
   Fake latency with `setTimeout` (≥50 ms): a tour step or capture with
   `hold` can then keep a spinner or toast on screen.
7. **Organisms render through a harness route or an existing story, never by
   stripping a page down to one component.** A harness route is a new,
   additive route that renders the organism with the app's real providers and
   no page chrome around it.
8. **Targets are the app's own instance ids.** Prefer an id the kit or tests
   already stamp (`data-testid`, a design-system instance attribute) over
   adding a new one. Where none exists, add one attribute at the usage site —
   never inside a shared kit component, which would stamp every instance
   everywhere it's used.
9. **Same origin.** The viewer is served from this app's own public folder
   (`public/stavy/`), at the same origin as the app. Don't move it behind a
   different host or a proxy that changes the origin — that breaks inspect,
   tours, pins, and comments (snapshots keep working regardless).
10. **People review the pictures; agents check text.** The canvas is the
    visual review, and a person does it. Don't take screenshots, pull images
    into your context, or write your own browser scripts to check a state.
    Run `npm run stavy:scan -- --keys <keys>` once, after your edits, and
    read its text: `✗` means the state didn't load, `missing target` and
    `console:` lines say what's wrong. Then stop and ask the person to look.

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
- How to add a state, a scene, a dimension, a dialog or an open menu: the
  Stavy skill's `reference/recipes.md`. Don't read Stavy's scripts or the
  viewer bundle to find out.
