# Changelog

What changed for a repo that uses Stavy, one section per release. `init`
prints the sections between the release a repo last took and the one it is
taking, so write each entry for that reader: what they get, and what, if
anything, they have to do.

## 0.2.2 — 2026-09-14

Tour fixes from adopting 0.2.1. Nothing to do on your side.

- **No more false "target not found" banner.** A tour started from the Play
  menu could warn that a step's target was missing, and keep warning, when the
  target rendered a moment late. The tour now keeps looking until the target
  appears, and warns only if it is still missing after a short grace period.
- **Long scenario names no longer crush the tour card.** The name truncates
  with an ellipsis, and shows in full on hover. The step counter and close
  button keep their size.

## 0.2.1 — 2026-09-14

Fixes from adopting 0.2.0.

- **Canvas clicks open the player again.** Clicking a card did nothing in
  Chrome: the canvas captured the pointer on every press, so the click never
  reached the card. It now captures only once a drag starts.
- **Glass blur is back in Chrome and Edge.** The build kept only the
  `-webkit-` form of `backdrop-filter`, which Chromium ignores. The release
  now checks the built CSS for the standard property.
- **Query placeholders can have a prefix or suffix.** A page URL like
  `?scene=simple-{step}` now matches its own frame, so those states are no
  longer marked off the map. If you made dimension values globally unique to
  work around this, you can shorten them.
- **Base path baked into the scan script.** `init` reads `base` from your Vite
  config or `basePath` from your Next config and adds `--app` to
  `stavy:scan`. A computed base is not detected; add `--app` by hand then.
- **`init` refuses to update a dirty repo.** Commit first, or pass
  `--allow-dirty`. `--check` and `--dry-run` are unaffected.
- **Quieter scans.** Abort errors caused by the scan's own navigation are no
  longer reported as prototype errors.
- **Docs.** `docs/INSPECT-ADAPTERS.md` says to measure your type scale in the
  running app, and shows why `tokenPattern` needs a lookahead to keep private
  primitives out of detection.

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
