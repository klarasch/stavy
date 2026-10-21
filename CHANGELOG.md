# Changelog

What changed for a repo that uses Stavy, one section per release. `init`
prints the sections between the release a repo last took and the one it is
taking, so write each entry for that reader: what they get, and what, if
anything, they have to do.

## 0.3.1 — 2026-10-21 (alpha)

Fixes from the first 0.3 adoption.

**What you get**

- **Tour steps can hold a passing moment.** A step with `"hold": true` keeps
  its spinner, "running" row or toast on screen until Next: the app's timers
  (50 ms or longer) wait while the step shows, and Next lets the app finish
  and follows it. A step whose target goes away by itself now says so instead
  of pointing at nothing. Board captures take `{ "hold": true }` in `do` too,
  so a short-lived state can be captured.
- **Faster state switching.** A state counted as loaded only once nothing on
  the page changed for 150 ms, so a ticking clock or relative timestamp made
  every switch wait the full 2.5 s. Now only elements being added or removed
  count, and an element that keeps changing is ignored. With `?debug=1` the
  console says where each load spent its time.
- **Snapshots live in `.stavy/snapshots`** for new installs, outside
  `public/`, so a build never copies them into `dist/`. The dev plugin serves
  them from there. A plain build's viewer then shows cards without pictures;
  to deploy with them, run `npm run stavy:publish` (captures fresh), or
  `npm run stavy:publish -- --skip-build --from-cache` after your build
  (copies your local cache in, no browser needed).
- The starter `stavy.json` uses named `states`, and the workspace is named
  after the feature it covers, not the repo: `init --name "Event search"`,
  else "Untitled feature". `stavy:validate` warns while the name is the repo's
  or the placeholder.
- `init` warns when your Vite `base` is computed and it can't add `--app` for
  you, and repoints `stavy:update` when you run it from a different folder.
- The skill now starts from who reads the work (the PM and the engineers) and
  what each needs. It also documents `via`, `hold`, every `do` action and the
  `index.json` entry shape. `docs/STAVY-SPEC.md` and the adoption guide are
  up to date with 0.3.
- The skill tells agents about your local layer: say "from now on, …" and the
  convention goes into `.stavy/SKILL.local.md` (how boards and docs look) or
  `.stavy/RULES.local.md` (repo and deploy rules), composed in on update.
- Repeated scan flags: the last one wins (`npm run stavy:scan -- --url …`).

**What to do**

1. `npm run stavy:update`.
2. To get held tour steps on states loaded fresh, keep the dev plugin in
   `vite.config`; it adds a one-line hook to the app's `<head>` in dev only.
3. If `init` warned that snapshots are in `public/snapshots`: set
   `snapshots: ".stavy/snapshots"` in the plugin, add `--out .stavy/snapshots`
   to `stavy:scan`, then `rm -rf public/snapshots && npm run stavy:scan`.
4. If Home shows your repo's name, set `product.name` in `stavy.json` to the
   feature this workspace covers.
5. Optional: in scene mode, pin "now" to a fixed time so rescans of an
   unchanged state don't change pixels (`STAVY.md` rule 5).

## 0.3.0 — 2026-10-20 (alpha)

An alpha of the lean core: authored boards and docs, editing on the dev
server, a static publish. Expect rough edges; report them.

**What you get**

- **Named states.** A screen can list `states` as named URLs (one `?scene=` param
  is the recommended shape). Dimensions are optional; the map shows rows, and a
  matrix only with `layout: "matrix"`. No more placeholder cells.
- **Boards and Docs** in `public/stavy-content/`: free-form boards (screens at
  any state, crops, `do: [{click}]` captures, flows, Markdown, notes, sections,
  images, Mermaid, arrows) and Markdown docs with `stavy:` embeds. A **Home**
  page with links, changelog, decisions and recent commits.
- **Editing on the dev server** (add the plugin, below): move and resize board
  items, edit text, add items, edit screen/state titles and notes on the Map,
  links on Home. Everything is saved to files in your repo.
- **Comments anywhere**: precise to the element in the player, on boards, the
  map and docs. Saved to `stavy-content/comments.json` on the dev server; in a
  published build they stay in the reviewer's browser and travel as a link or
  `.md` you import.
- **Inspect** docks beside the frame (never covers it), pins reliably, measures
  distances, has **copy reference** for pasting into a chat, and is shaped per
  design system with `viewer.inspect.panel` / `internals`. Adapters keep working;
  to test yours on this release, follow §9 of `docs/INSPECT-ADAPTERS.md`.
- **Fast and stable**: scans are incremental WebP (only new/changed states), on
  demand from the viewer; every requested state loads fresh and shows its
  snapshot until it settles; tours let your clicks through to the app.
- **`npm run stavy:publish`**: a static build that carries its own snapshots.

**What to do**

1. Update: `npm run stavy:update` (or unpack this release and run its `init`).
2. Add the dev plugin to `vite.config`:
   `import stavy from "./scripts/stavy/vite-plugin.mjs"` and `plugins: [..., stavy({ root: "public", snapshots: "public/snapshots" })]`.
3. Snapshots are now a gitignored cache: `git rm -r --cached public/snapshots` if you committed them.
4. Optional: `npm run stavy:migrate` turns 0.2 boards and notes into a board file.
5. If your app uses Tailwind v4 and saving a board reloads the page, add
   `@source not "../public/stavy-content";` to your main CSS.

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
