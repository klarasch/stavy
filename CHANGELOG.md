# Changelog

What changed for a repo that uses Stavy, one section per release. `init`
prints the sections between the release a repo last took and the one it is
taking, so write each entry for that reader: what they get, and what, if
anything, they have to do.

## 0.2.0 — 2026-09-13

The first packaged release. Stavy is an overlay: a static viewer next to your
app that reads your prototype's own URLs, driven by `stavy.json`.

- **Releases.** Everything an adopting repo needs is one download with no npm
  dependencies: https://github.com/klarasch/stavy/releases/latest/download/stavy.tgz.
  Unpack it at `../stavy` and run `node ../stavy/scripts/init.mjs .`.
- **Updates you can trust.** `init` installs and updates. `.stavy/lock.json`
  records which files Stavy owns; an update replaces those, prunes stale ones,
  and skips any you edited. Put your own conventions in `.stavy/SKILL.local.md`
  and `.stavy/RULES.local.md`. See `docs/UPDATING.md`.
  **To do, if you installed before this release:** run the update once. It checks
  your installed files against the release named in `public/stavy/VERSION`, or
  lists the files that differ and asks for `--force` after you've reviewed them.
- **Canvas.** Pages without dimensions, sections (`pages[].group`), a site map
  with scenario arrows, card labels only for dimensions that vary, figures
  (`boards[].page` with image callouts).
- **Player.** Tour steps navigate client-side, with no reload. Tour deep links
  apply the step's dimensions. Hotkeys still work after clicking inside the app.
- **Inspector.** Assumes no CSS framework. Describe your design system in
  `viewer.inspect` (kits, token and type-scale patterns), or add a code adapter
  with `viewer.inspect.module`. See `docs/INSPECT-ADAPTERS.md`.
- **Viewport.** `viewer.viewport` sets the page size (default 1920×1080).
  `scan --width/--height/--dpr`.
- **Checks.** The schema accepts manifest `version` 0.1 and 0.2. `validate` warns
  loudly when ajv is missing (`--require-schema` makes that fatal). `scan`
  scrolls targets into view and prunes states you removed. The installed
  `scan.mjs` no longer crashes on a missing `lib/viewport.mjs`.
