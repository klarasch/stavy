# Adopting Stavy on an existing prototype

Stavy is an overlay. It is served *next to* your prototype, loads your
prototype's own URLs, and never imports it. Adoption therefore touches nothing
under `src/`: a static folder in `public/`, a JSON file, two scripts, and one
rules file for the agents working in the repo. Steps marked **(skill)** are
what Claude does for you when the `stavy` skill is installed.

Same origin is the one requirement: the viewer must be served from the same
host and port as the prototype (that is what `public/` gives you), otherwise
the inspector, tours, pins and comments cannot reach into the frame. Snapshots
work regardless.

---

## A. An afternoon: from nothing to a canvas of what you already have

Download a release next to the prototype repo and run its init. A release has
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
| `scripts/stavy/{validate,scan,gen-tests}.mjs`, `lib/`, `stavy.schema.json` | the checks |
| `.claude/skills/stavy/SKILL.md` | the agent skill |
| `STAVY.md` | the rules for agents in this repo — add `@STAVY.md` to your CLAUDE.md |
| `docs/STAVY-SPEC.md`, `docs/STAVY-UPDATING.md` | the spec, and how updates work |
| `.stavy/lock.json` | which of these Stavy owns, with hashes — commit it |

and adds `stavy:validate`, `stavy:scan`, `stavy:tests`, `stavy:update` to
`package.json` when absent. Everything except `public/stavy.json` and
`package.json` is Stavy's and replaced by updates; your own additions go in
the local layer (`.stavy/SKILL.local.md`, `.stavy/RULES.local.md` —
[`UPDATING.md`](UPDATING.md) §2). Then, in order:

1. **Level 0 — register what exists.** `npm run dev`, open
   `http://localhost:5173/stavy/index.html`. In `public/stavy.json`, add one
   `pages[]` entry per screen you want on the canvas, with the URL it already
   has (`"url": "/settings"`), no dimensions yet, one pinned instance
   (`"instances": [{ "dims": {} }]`). **(skill)** Claude lists the routes and
   writes the entries.
2. **Scan.** `npm i -D playwright ajv@8.12.0 ajv-formats@2.1.1 && npx playwright install chromium`,
   then `npm run stavy:scan` against the running dev server. Every registered
   state gets a snapshot; the canvas now shows your real screens. Nothing in
   the app changed. (Those exact ajv versions matter on a locked-down
   registry — see "Locked-down registries" below.)
3. **Level 1 — one flow, addressable.** Pick the flow you want to walk
   through. For each screen in it, decide which axes matter (a role, a data
   state, a step, an open dialog) and make them reachable by URL — see §B. Add
   them as `dimensions[]`, declare them on the page, put every declared
   dimension in the page's `url` as `{dim}`, pin the instances you want to
   see. Add stable ids to the elements the flow clicks (`data-testid` at the
   usage site — or whatever attribute your kit already stamps; name it in
   `viewer.targetAttrs`). Write the `scenarios[]` entry.
4. **Scan again, validate.** `npm run stavy:scan` asserts every scenario
   target exists in the rendered state and fails otherwise. `npm run
   stavy:validate` checks the manifest and the URL contract statically and
   reports the last scan's misses.
5. Open the canvas: the flow is a lane of real snapshots; click a step to open
   the player at that state; press **Play** to walk the tour with the
   spotlight; press **I** to inspect. Show that.

Level 2 — organisms — comes when you want a component's own state matrix on
the canvas: add a harness route (§B, "Organisms"), register it as a page with
`"kind": "component"` and a `frame`.

**Dev server or deploy under a base path.** If your prototype's dev server or
deploy uses a Vite `base` other than `/` (a GitHub Pages project site is
typically `/pages/<org>/<repo>/dist/`), a page's `url` in the manifest is
still the app's own route (`/settings`), but scan needs to know the prefix to
find it: pass `--app <base>` — e.g. `node scripts/stavy/scan.mjs --url
http://localhost:5173 --app /pages/<org>/<repo>/dist/`. The viewer figures out
the same base from its own script path by default, so nothing else changes;
set `"viewer": { "app": "/pages/<org>/<repo>/dist/" }` in the manifest only if
the viewer is served from somewhere other than a path directly under that base.

---

## B. Making states URL-addressable without touching page code

The whole contract is: the prototype renders a state when opened at a URL.
How it reads that URL is its business. The cheap patterns, in order of
preference:

- **A read at the data layer.** One hook or function that merges search
  params over defaults (`role`, `state`, …) and hands the result to the
  fixture selection. Orbit's `src/demo/app/dims.ts` is 60 lines and the only
  place that knows the param names. Nothing in a page component changes.
- **Dataset as a dimension.** For data-heavy prototypes don't flag UI states,
  select a *dataset*: `?dataset=manager-empty` picks a named, deterministic
  fixture set and the app's real logic computes the rest. Register `dataset`
  as a dimension. This keeps real behaviour and still makes every state a link.
- **Path segments.** `"url": "/expenses/{expense}?role={role}"` — a record id
  is a dimension too; the viewer fills path and query placeholders alike and
  recognises the state when the app navigates there on its own.
- **Dialogs and overlays.** An `overlay=confirm-delete` param that opens the
  dialog on mount. The state gets a snapshot, a tour can point at the confirm
  button, and the modal stays inside its own document — containment is the
  frame's job now, not yours.
- **Workspace axes** (release phase, locale, tenant): one param the app reads
  once, declared `"scope": "workspace"` so the viewer carries it across every
  navigation (SPEC §1.1).

When a state is *not* reachable by URL — it lives three clicks deep in local
state — register the gap (leave the cell unpinned, note it in the page
description) rather than restructuring the page. That is the rule agents in
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

## B2. Keep the manifest true: scan in CI

`scan` is the drift hook. It visits every state the manifest cares about —
pinned instances, scenario steps, note anchors — asserts the referenced
targets exist, measures them, and writes the snapshots. Run it against a
preview of the built app in CI and the contract cannot silently rot: a renamed
button or a state that stopped rendering fails the build with the exact
state and selector in the log. The reference repo's
`.github/workflows/pages.yml` is the template: build → preview → scan →
validate → build again with the snapshots → deploy.

Snapshots are generated artifacts. Commit them if reviewers should see the
canvas on a static host without CI; otherwise ignore `public/snapshots/` and
let CI produce them.

**Snapshot resolution.** `scan` captures every `kind: "page"` state at
`1920 × 1080` by default; set `"viewer": { "viewport": { "width": …, "height":
…, "dpr": … } }` in the manifest to change it (`--width`/`--height`/`--dpr`
override it per invocation; a page's own `frame` always wins, e.g. a
`kind: "component"` harness route). `dpr` trades bytes for sharpness: `1` is
fine at arm's length on the canvas, `2` gives crisp thumbnails when a reviewer
zooms in on a retina display but roughly quadruples every PNG's size — worth
it for a small workspace, not for hundreds of states. Changed the knob without
rescanning? `npm run validate` warns which snapshots are now stale.

---

## B3. Comments without a server (GitHub Pages + Slack)

Comments are separate from annotations: annotations are authored
documentation in the manifest; comments are conversation. The viewer stores
comments **in the browser** (local-first), so a static host needs nothing:

1. In the player press **M** (or the speech-bubble button) and click where
   the comment belongs — on the element itself, so it anchors to the target
   id and survives redesigns. Name once; reply, resolve.
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

- **PMs**: the *Requirement coverage* board on the canvas (requirements →
  scenarios → states, gaps in amber; click a scenario to play it). Their input
  is the PRD: the skill extracts `requirements[]` from its headings and
  proposes scenarios for gaps. Stable section handles (`§3`, ticket ids) are
  enough; Markdown exports from Confluence/Notion work.
- **Engineers / QA**: the scan log (which state, which selector), `npm run
  stavy:tests` (Playwright specs from scenarios, against the app's own URLs),
  the inspector (component + props, classes, tokens, the state's URL, a
  source link in dev), `npm run handoff` and `npm run changelog` in the
  reference repo.
- **Designers**: the canvas link; the player with **N** for annotations,
  **W** for wireframe, **⌘\** to hide the chrome for a clean demo; comments;
  in dev, *Save as a design annotation* writes straight into the manifest.

---

## B5. Maintenance: the viewer is a folder in `public/`

- **Upgrade:** pull the reference repo, then `npm run stavy:update` (the same
  `init.mjs`). It shows the Stavy log since your last update, replaces the
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
warning; pass `--require-schema` (wired into `npm run check`) to make CI fail
instead of warn when the schema can't be checked.

---

## C. CI/CD

Minimum: `node scripts/stavy/validate.mjs public/stavy.json --require-schema`
on every PR — `--require-schema` fails the build instead of silently skipping
the schema check when ajv isn't installed. Full: the scan. In the reference
repo's Pages workflow the sequence is

```bash
npx vite build
npx vite preview --port 4173 &            # wait for it
node scripts/scan.mjs --url http://localhost:4173 --app /stavy   # --app = the deploy's base path
npm run check                              # validate + coverage + PRD refs + scan misses
npx vite build                             # picks up public/snapshots
```

Deploy `dist/`. The viewer opens at `<site>/stavy/` (or `/stavy/index.html`
on hosts without directory indexes) and finds the manifest and snapshots one
level up. No rewrite rules: the viewer routes by query string only.
