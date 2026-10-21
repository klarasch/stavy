# Adopting Stavy on an existing prototype

Stavy is an overlay. It is served *next to* your prototype, loads your
prototype's own URLs, and never imports it. Adoption therefore touches nothing
under `src/`: a static folder in `public/`, a JSON file, a few scripts, and
one rules file for the agents working in the repo. Steps marked **(skill)** are
what Claude does for you when the `stavy` skill is installed.

Same origin is the one requirement: the viewer must be served from the same
host and port as the prototype (that is what `public/` gives you), otherwise
the inspector, tours, pins and comments cannot reach into the frame. Snapshots
work regardless.

---

## A. An afternoon: from nothing to a map of what you already have

Download the release next to the prototype repo and run its init. A release has
the viewer prebuilt and no npm dependencies, so this works behind a
locked-down registry:

```bash
curl -fL -o /tmp/stavy.tgz https://github.com/klarasch/stavy/releases/latest/download/stavy.tgz
mkdir -p ../stavy && tar -xzf /tmp/stavy.tgz -C ../stavy --strip-components=1
node ../stavy/scripts/init.mjs .
```

(A git checkout of the reference repo works too, after `npm install` there. It
builds the viewer itself.) Init copies:

| Into your repo | What it is |
|---|---|
| `public/stavy/` | the viewer, a static page (+ `VERSION`) |
| `public/stavy.json` | a starter manifest (only if absent) |
| `public/stavy-content/` | boards, docs, changelog and decisions, scaffolded once |
| `scripts/stavy/` | `validate`, `scan`, `migrate`, `publish`, `gen-tests`, the dev plugin (`vite-plugin.mjs`), `lib/`, the schemas |
| `.claude/skills/stavy/SKILL.md` | the agent skill |
| `STAVY.md` | the rules for agents in this repo; add `@STAVY.md` to your CLAUDE.md |
| `docs/STAVY-SPEC.md`, `docs/STAVY-UPDATING.md` | the spec, and how updates work |
| `.stavy/lock.json` | which of these Stavy owns, with hashes; commit it |

It adds `.stavy/snapshots/` to `.gitignore`, and adds `stavy:validate`,
`stavy:scan`, `stavy:migrate`, `stavy:publish`, `stavy:tests` and
`stavy:update` to `package.json` when absent. `stavy:scan` picks up a Vite
`base` or Next `basePath` from your config file at install time and bakes it
in as `--app` (best-effort; see the base-path note below if it isn't
detected). Everything except `public/stavy.json`, `public/stavy-content/` and
`package.json` is Stavy's and replaced by updates; your own additions go in
the local layer (`.stavy/SKILL.local.md`, `.stavy/RULES.local.md`;
[`UPDATING.md`](UPDATING.md) §2). Then, in order:

1. **Add the dev plugin.** In `vite.config.ts`:
   ```ts
   import stavy from "./scripts/stavy/vite-plugin.mjs"

   export default defineConfig({
     plugins: [/* your plugins */, stavy({ root: "public", snapshots: ".stavy/snapshots" })],
   })
   ```
   It applies to `vite dev` only; `vite build` is unchanged. It lets the viewer
   save boards, notes and comments to files in your repo, serves the snapshots
   cache, and re-captures states on demand. Without it the viewer is read-only.
2. **Register what exists.** `npm run dev`, open
   `http://localhost:5173/stavy/index.html`. In `public/stavy.json`, add one
   `pages[]` entry per screen you want on the map, with the URL it already
   has (`"url": "/settings"`) and its states by name (see §B):
   ```jsonc
   { "id": "settings", "label": "Settings", "url": "/settings",
     "states": [
       { "id": "default", "url": "/settings" },
       { "id": "unsaved", "url": "/settings?scene=unsaved-changes" }
     ] }
   ```
   A screen with one state is normal, and a screen with no `states` is one
   card at its `url`. **(skill)** Claude lists the routes and writes the entries.
3. **Scan.** `npm i -D playwright ajv@8.12.0 ajv-formats@2.1.1 && npx playwright install chromium`,
   then `npm run stavy:scan` against the running dev server (set its `--url`
   in `package.json` if your port isn't 5173). Every registered state gets a
   snapshot; the map now shows your real screens. Nothing in the app changed.
   (Those exact ajv versions matter on a locked-down registry; see "Locked-down
   registries" below.) The scan is incremental: later runs capture only new or
   missing states. `-- --keys settings/unsaved` captures exactly one, and
   `-- --all` re-captures everything before a review.
4. **Make the states you care about URL-reachable.** For each moment that
   isn't reachable yet (an empty list, an error, a dialog), give the app one
   named scene and read it from a `?scene=` param. See §B. Add the state to
   the page. Add stable ids to the elements a flow clicks (`data-testid` at the
   usage site, or whatever attribute your kit already stamps; name it in
   `viewer.targetAttrs`).
5. **Validate.** `npm run stavy:validate` checks the manifest, boards and
   references statically, and reports the last scan's misses. Warnings are
   prompts. Only a state that won't load, or unparsable JSON, is an error.
6. **Write a flow, compose boards and docs.** A flow is a `scenarios[]` entry
   whose steps point at states (`{ "page": "settings", "state": "unsaved",
   "title": … }`). Boards and docs live in `public/stavy-content/`. **(skill)**
   Ask Claude to compose them: "a board on how import fails and recovers", "a
   handover doc for the settings screen". It picks screens, crops, flows and
   Markdown for the question, writes `stavy-content/boards/<id>.json` and
   `docs/<id>.md`, registers them in `index.json`, and captures what the board
   needs. In the viewer you move, resize and annotate what it made, and the dev
   plugin saves your edits back to the files.
7. **Review and publish.** The map and boards are the review surface: click a
   state to open the player, press **Play** to walk a flow, press **I** to
   inspect, press **M** to comment. When it's time to share, `npm run
   stavy:publish` (§C) makes a static build that carries its own snapshots.

If you have 0.2 boards and notes, `npm run stavy:migrate` turns them into a
board file in `stavy-content/`.

Level 2, organisms, comes when you want a component on its own: add a
harness route (§B, "Organisms"), register it as a page with `"kind":
"component"` and a `frame`.

**Dev server or deploy under a base path.** If your prototype's dev server or
deploy uses a Vite `base` other than `/` (a GitHub Pages project site is
typically `/pages/<org>/<repo>/dist/`), a page's `url` in the manifest is
still the app's own route (`/settings`), but scan needs to know the prefix to
find it: pass `--app <base>` — e.g. `node scripts/stavy/scan.mjs --url
http://localhost:5173 --app /pages/<org>/<repo>/dist/`. `init.mjs` tries to
detect this for you (a `base`/`basePath` literal in `vite.config.*` or
`next.config.*`) and bakes `--app <base>` straight into the generated
`stavy:scan` script; the detection is best-effort (a simple regex, not a
config evaluation), so if your base is computed or your config file isn't one
of the usual names, add `--app <base>` to `stavy:scan` in `package.json`
yourself. The viewer figures out the same base from its own script path by
default, so nothing else changes; set `"viewer": { "app":
"/pages/<org>/<repo>/dist/" }` in the manifest only if the viewer is served
from somewhere other than a path directly under that base.

---

## B. Making states URL-addressable without touching page code

The whole contract is: the prototype renders a state when opened at a URL.
How it reads that URL is its business. The cheap patterns, in order of
preference:

- **One named scene.** A state is a URL with a name. When a moment needs a
  bundle of seeds, flags and open panels, give the app one `?scene=` param
  that selects a named, deterministic setup (`?scene=bulk-conflict`) and let
  the app's real logic compute the rest. Register each scene as a named
  state on the page. This keeps real behaviour and makes every state a link.
- **A read at the data layer.** One hook or function that reads the `scene`
  param (and any other param you keep), merges it over defaults and hands the
  result to the fixture selection. It is usually a few dozen lines and the
  only place that knows the param names. Nothing in a page component changes.
- **Dimensions, when an axis is genuine.** A role or locale that a reviewer
  compares side by side can still be a dimension (`"url":
  "/expenses?role={role}"`, SPEC §1.1). Use them sparingly. Don't add states
  to fill a grid.
- **Path segments.** A record id can sit in the path of a state's url
  (`"url": "/expenses/exp-2101?scene=submitted"`). The viewer recognises the
  state when the app navigates there on its own.
- **Dialogs and overlays.** A scene that opens the dialog on mount
  (`?scene=confirm-delete`). The state gets a snapshot, a tour can point at the confirm
  button, and the modal stays inside its own document — containment is the
  frame's job now, not yours.
- **Workspace axes** (release phase, locale, tenant): one param the app reads
  once, declared as a dimension with `"scope": "workspace"` so the viewer
  carries it across every navigation (SPEC §1.1).
- **Menus and hovers.** An open menu, a hover or a focus ring doesn't need a
  URL: a board item can capture it with `do: [{ "click": "FilterButton" }]`
  (the actions are click, hover, focus, press, type + into, wait, hold). A
  flow step that exists only in component state uses `"via": "click"`. A
  spinner or toast that vanishes on its own can stay on screen with `"hold":
  true` on the step or the action.

When a state is *not* reachable by URL — it lives three clicks deep in local
state — leave it out and note the gap in the page description, or reach it
with a `do` action on a board, rather than restructuring the page. That is the rule agents in
the repo follow (`STAVY.md`).

**Organisms.** Add one route that mounts the organism alone with the app's
real providers — `/components/<name>?state={state}` — and register it with
`"kind": "component"` and a `frame`. If you already have Storybook or Ladle,
point `url` at the story's iframe URL instead; no harness needed. Never strip
an existing page down to one component.

**Targets.** A bare id in the manifest is looked up in `viewer.targetAttrs`
(default `["data-proto", "data-testid"]`); anything else is used as a CSS
selector. Kits that already stamp instance ids need nothing added.

**Copy provenance** (optional): if the app serves its string catalog as JSON,
set `"strings": "/strings.json"` and the inspector names the key behind any
text.

---

## B2. Keep the manifest true: scan and validate

`scan` is the drift hook. It visits every state the manifest, flows and
boards care about, asserts the referenced targets exist, measures them, and
writes the snapshots. A state that stopped rendering fails with the exact
state in the log, and a renamed button is reported as a missing target by name.
`stavy:validate` lists the last scan's misses.

Snapshots are a **gitignored cache**. They default to `.stavy/snapshots`,
outside `public/`, so `vite build` never copies them into `dist/`. That makes
the default safe for repos that commit `dist/` (a GitHub Pages project served
from the repo, say): a normal build can't pull in hundreds of images by
accident. The dev plugin serves the cache at `/snapshots/` and re-captures on
demand; people can press refresh on a card. If you committed
`public/snapshots` under 0.2, run `git rm -r --cached public/snapshots`, delete
the folder, and let the scan rebuild the cache in its new place.

When you want snapshots on a static host, don't commit them. Use
`npm run stavy:publish` (§C), which captures them into the build output.

**Snapshot resolution.** `scan` captures every `kind: "page"` state at
`1920 × 1080` by default; set `"viewer": { "viewport": { "width": …, "height":
…, "dpr": … } }` in the manifest to change it (`--width`/`--height`/`--dpr`
override it per invocation; a page's own `frame` always wins, e.g. a
`kind: "component"` harness route). `dpr` trades bytes for sharpness: `1` is
fine at arm's length on the map, `2` gives crisp thumbnails when a reviewer
zooms in on a retina display but roughly quadruples every image's size — worth
it for a small workspace, not for hundreds of states. Changed the knob without
rescanning? `npm run stavy:validate` warns which snapshots are now stale.

---

## B3. Comments without a server (GitHub Pages + Slack)

Comments are separate from annotations: annotations are authored
documentation in the manifest; comments are conversation. The viewer stores
comments **in the browser** (local-first), so a static host needs nothing:

1. Press **M** (or the speech-bubble button) and click where the comment
   belongs: an element in the player (it anchors to that exact element —
   the nearest target id, the path to it and its text), an item or a point
   on a board or the map, or a paragraph of a doc (or select text in a doc
   and press **Comment**). Name once; reply, resolve. See
   [`COMMENTS.md`](COMMENTS.md) for anchors and storage adapters.
2. **Comments → Copy link.** The link carries every comment as a compressed
   payload in the URL hash — paste it in Slack. **Copy as Markdown** produces
   a digest with a deep link per comment (page, dims, target).
3. Others send *their* link back; **Import → Unpack** merges by comment id.

A comment compresses to roughly 60 characters, so one link carries a few
hundred before URL limits matter; the Markdown digest is the fallback.

The Markdown export is also the agent's brief: each item names the page,
the dimension assignment, the target and the URL. Hand it to Claude as the
task list; it finds the file through the inspector's component/source view
instead of searching the repo.

---

## B4. What PMs, engineers, designers get without touching JSON

- **PMs**: Home (links to the PRD and tickets, the changelog, the decision
  log), boards that answer one question each, and comments on anything. Their
  input is the PRD or a conversation; the skill turns it into flows and boards.
  If the manifest lists `requirements[]`, the coverage board shows which
  flows cover them.
- **Engineers / QA**: the scan log (which state, which selector), `npm run
  stavy:tests` (Playwright specs from scenarios, against the app's own URLs),
  the inspector (component + props, classes, tokens, the state's URL, a
  source link in dev), and the docs: Markdown handover pages with states
  embedded, readable on a git host too.
- **Designers**: the published link or the dev server; the player with **N**
  for annotations, **W** for wireframe, **⌘\** to hide the chrome for a clean
  demo; comments; in dev, moving and resizing board items, editing text and
  titles, all saved to files in the repo.

---

## B5. Maintenance: the viewer is a folder in `public/`

- **Upgrade:** unpack the new release into `../stavy`, then `npm run
  stavy:update` (the same `init.mjs`). It shows the Stavy log since your last update, replaces the
  files Stavy owns, prunes the ones it no longer ships, and **skips any owned
  file you edited** — naming it and exiting 1. `.stavy/lock.json` records the
  commit and hashes. Full model, the local layer, and the flags in
  [`UPDATING.md`](UPDATING.md); `init --check` in CI keeps owned files unedited.
- **Bugs** found while adopting are fixed in the reference repo, never by
  patching an installed file — the update would skip it and you'd stop
  getting fixes for that file.
- **Removing Stavy:** [`UPDATING.md`](UPDATING.md) §6. The app never knew.

---

## B6. Locked-down registries

`validate` checks the manifest against `spec/stavy.schema.json` only when
`ajv` and `ajv-formats` resolve — without them the check is silently skipped,
so a broken manifest can "pass" with 0 errors. Pin the versions that install
cleanly through a strict corporate registry/artifactory:

```bash
npm i -D ajv@8.12.0 ajv-formats@2.1.1
```

Stavy itself needs nothing from your registry: a release (§A) is prebuilt and
dependency-free. What the prototype repo installs is only this pair and
`playwright` for the scan. Playwright downloads Chromium from its own CDN, so
behind a proxy set `PLAYWRIGHT_DOWNLOAD_HOST` to your internal mirror before
`npx playwright install chromium`.

Newer `ajv` releases pull in `fast-uri`, which some artifactories block by
policy, and the install fails or falls back to a stale cached version. If
`validate` runs without ajv installed it now prints `SCHEMA NOT CHECKED —
install ajv@8.12.0 ajv-formats@2.1.1 …` as the first line and counts it as a
warning; pass `--require-schema` to `stavy:validate` in CI to make it fail
instead of warn when the schema can't be checked.

---

## C. Publishing and CI

**Publish.** `npm run stavy:publish` builds the app, serves the build locally,
captures every state against it, and writes the snapshots into the build
output. The result is plain static files (the prototype, the viewer,
`stavy.json`, `stavy-content/`, `snapshots/`) that any static host serves. It
takes `--build "<cmd>"`, `--dist <dir>`, `--base <path>` (as in your build's
base), `--port`, and `--skip-build`; other flags go to the scan.

A plain `npm run build` carries no snapshots: its viewer shows cards without
pictures (the player still opens the real app). If your pipeline builds and
commits `dist/` itself, add one step after the build:
`npm run stavy:publish -- --skip-build --from-cache` copies your local cache
(`.stavy/snapshots`) into `dist/snapshots` without a browser. The pictures are
as fresh as your last scan. The published
viewer is read-only: editing needs the dev server, and reviewers' comments stay
in their browser and travel as a link or a Markdown file you import (see B3).
The viewer opens at `<site>/stavy/` (or `/stavy/index.html` on hosts without
directory indexes) and finds the manifest and snapshots one level up. No
rewrite rules: the viewer routes by query string only.

**CI.** Minimum: `node scripts/stavy/validate.mjs public/stavy.json
--require-schema` on every PR. `--require-schema` fails the build instead of
silently skipping the schema check when ajv isn't installed. To keep the
contract from rotting, also run the scan against a preview of the built app:

```bash
npx vite build
npx vite preview --port 4173 &                      # wait for it
npm run stavy:scan -- --url http://localhost:4173   # --app is already baked in from your base path
npm run stavy:validate -- --require-schema          # also reports the scan's misses
```

Then deploy with `stavy:publish`, which does the capture itself. Snapshots stay
out of git and out of a plain `vite build`, so a repo that commits `dist/`
can keep doing so without carrying them.
