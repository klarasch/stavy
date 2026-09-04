# Stavy on Monday

A first trial of Stavy **on the existing work prototype**, on a branch, in
about half a day. Nothing under `src/` changes for the first two hours; by the
end you have a canvas of the real screens, one flow you can walk through in
the player, and the inspector working on your own UI kit.

Assumptions: the prototype is a Vite (or any dev-server) app with a `public/`
folder; you have Claude Code; Node 22+.

---

## 0. The night before (5 min)

Push the reference repo so the work clone has the current viewer and scripts:

```bash
cd ~/Code/prototyping/stavy && git push
```

## 1. Install (15 min)

```bash
cd ~/work/prototype && git checkout -b stavy
git clone <stavy repo> ../stavy && (cd ../stavy && npm install)
node ../stavy/scripts/init.mjs .
npm i -D playwright ajv ajv-formats && npx playwright install chromium
```

Add `@STAVY.md` to the repo's `CLAUDE.md`. Commit. Start the dev server and
open `http://localhost:5173/stavy/index.html` — an empty-ish canvas with the
starter page. The app is untouched.

## 2. Level 0 — the screens you already have (45 min)

Ask Claude (the skill is installed): *"List this app's routes and register the
ten that matter in public/stavy.json, at the URLs they have today, one pinned
instance each, no dimensions."* Review the entries; fix labels. Then:

```bash
npm run stavy:scan
```

Reload the canvas. Every registered screen is there as a real snapshot,
grouped by page. Zoom around. Click one: the player shows the live app at that
URL. This is the demo's first slide — *"nothing was rewritten."*

## 3. Level 1 — one flow (2 hours)

Pick the flow people ask about most. Work with Claude under the rules in
`STAVY.md` (additive only):

1. For each screen in the flow, name the axes that matter — usually a role or
   a data state, sometimes a step or an open dialog. Add them as
   `dimensions[]`, declare them on the pages, and put each into the page's
   `url` as `{dim}`.
2. Make them reachable: one read at the data/fixture layer that merges search
   params over defaults (Orbit's `src/demo/app/dims.ts` is the pattern; for a
   data-heavy app prefer a `dataset` dimension that selects a named fixture
   set). No page component changes.
3. Put a stable id on each element the flow clicks — the kit's own attribute
   if it has one (name it in `viewer.targetAttrs`), else `data-testid` at the
   usage site.
4. Write the `scenarios[]` entry: one step per click, with `page`, `dims`,
   `target`, a one-line `title` and `note`. Pin the instances you want to see.
5. `npm run stavy:scan` until it is green, then `npm run stavy:validate`.

## 4. Show it (30 min)

- **Canvas**: the flow as a lane of real snapshots; the page areas with their
  state matrices; unpinned cells are the honest gaps.
- **Player**: click step 1, press **Play**, walk the tour with → — the halo
  sits on the real button in the real app; clicking it advances.
- **Inspect** (I): hover anything; the panel names your kit's component,
  its props, the classes and tokens, and the state's URL.
- **Comments** (M): leave one on a button, **Copy as Markdown**, paste in
  Slack. That paste is the next brief for Claude.

## 5. What to decide afterwards

- Which flows get Level 1 next (each is an hour, mostly deciding the axes).
- Whether the scan runs in CI (recommended: it is the drift hook).
- Whether an organism deserves its own matrix on the canvas (a harness route
  or a Storybook story URL, `kind: "component"`).
