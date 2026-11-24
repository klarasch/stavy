# Field reference

Load this when you need the exact shape of `stavy.json`, a flow, a board
item or `index.json`, or when registering more than a plain screen and state.

## The workspace

```
stavy.json                     the screen registry: screens, their states, flows, viewer settings
stavy-content/
  index.json                   which boards and docs exist, in order; `links` (PRD, tickets, Figma, repo) for Home
  changelog.md                 what changed on the map, newest first (listed in Docs, shown on Home)
  decisions.md                 the decision log (listed in Docs, shown on Home)
  log/<YYYY-MM-DD>.md          one line per change, written by `stavy:log`
  rounds/                      review comments, one file per author per round (never edit by hand)
  boards/<id>.json             free-form boards (you compose, humans refine)
  map.json                     notes and arrows placed on the map itself, each anchored to a screen's area
  docs/<id>.md                 Markdown handover docs (the source for spec text)
  assets/                      images and SVGs you or people add
  comments.json                comments from older workspaces (see the end of this file)
snapshots/  (gitignored)       a cache, made by scan on demand: never commit it
```

## Capturing and checking

- **Never run a full scan as routine.** After changing a screen, capture
  only what you touched: `npm run stavy:scan -- --keys "<key>,<key>"`, or
  just `stavy:scan` (incremental: only new or missing states). People can
  also press refresh on a card. `--all` is for before a review.
- Edit `stavy.json` for screens and flows, `stavy-content/` for everything
  else. The viewer reloads on its own.
- `stavy:validate` is cheap and static: run it after manifest edits. Treat
  warnings as prompts, not failures. The only real errors: a state that
  doesn't load, unparsable JSON.

## Screens and states

- **A state is a URL with a name.** Prefer named states:
  ```jsonc
  { "id": "contacts", "label": "Contacts", "url": "/contacts",
    "states": [
      { "id": "loaded", "url": "/contacts" },
      { "id": "empty", "url": "/contacts?scene=contacts-empty", "note": "First run: import or add" },
      { "id": "bulk-conflict", "url": "/contacts?scene=bulk-conflict", "label": "Bulk edit: conflicts" }
    ] }
  ```
- **One `scene` param beats many dimensions.** If the app needs a bundle of
  seeds, flags and open panels to land on a moment, give it one named scene.
  Dimensions (`url` template with `{dim}`) are still fine for genuine axes
  (role × state), and `layout: "matrix"` opts a page into a grid. Default is
  a row. Never add states to fill a grid.
- Register states that someone will look at. A screen with one state is
  normal. The map shows one card per screen and opens the rest on a click,
  so registering many states doesn't crowd it.
- `group` sorts screens into sections; `status` (`draft`/`review`/`ready`)
  tells developers what's settled. It can sit on a screen, a named state or a
  board; `ready` means ready for development. People set it in the viewer,
  which also records `ready` (when, who, and the snapshot hashes at that
  moment). Don't mark anything ready yourself unless asked. If you change a
  ready screen, say so: the viewer flags it "Changed since ready" after the
  next scan, and the person decides whether it goes back to review.
- Not URL-reachable yet? Add a scene to the app (additively) or leave it
  out. Never fake it.

## Flows

Steps reference states (`{ "page": "import", "state": "mapping", "title": …,
"note": … }`), so a flow never duplicates a screen. `target` (a `data-proto`
id) is optional: it highlights the element in the tour; without it the step
just shows the state, which can't fail. Run a flow to the outcome the user
would see next (the new record in its list), not to the last form step.
Long flows are fine: the board wraps them.

## Reference (field names)

- Flows live under `scenarios` in stavy.json; a board's `flow` item takes the scenario `id`.
- Flow steps: `page`, `state` (or `dims`), `title`, `note`?, `target`?, `via`?, `hold`?. The player always loads a step's
  registered state fresh, so every step should be its own state URL. Only for a step that exists purely in
  component state (a menu the previous click opened, no URL) add `"via": "click"`: the tour then waits for its
  target after the click instead of loading a URL.
- **Transient steps:** a spinner, a "running" row, a toast that times out. Give the step `"hold": true` (usually
  with `"via": "click"`): the app's timers wait while the step shows, and Next lets the app finish and moves on.
  Without it the app moves on by itself and the step points at nothing.
- Board file: `{ "title", "description"?, "status"?, "cover"?, "items": [...] }`. `cover` names the item whose picture
  Home shows (default: the first screen, states group, flow or image). Every item has `id`, `type`, optional `x`/`y`/`w`/`h`, `title`, `note`.
  - `screen`: `screen` (page id), `state` or `dims`, `crop`?, `do`?, `viewport`?
  - `do` actions, in order: `{ "click": t }`, `{ "hover": t }`, `{ "focus": t }`, `{ "press": "Shift+F10" }` (a key
    on whatever has focus), `{ "type": "text", "into": t }`, `{ "wait": ms }`, `{ "hold": true }` (before a click: keep
    the spinner or toast it starts, for the capture). `t` is a target id, a CSS selector, or visible text.
  - `states`: `screen`, `states`? (ids), `layout`? (`row`|`grid`), `columns`?, `crop`?
  - `flow`: `flow` (scenario id), `perRow`?, `collapsed`?
  - `markdown`: `md` (inline) or `src` (`docs/x.md`, or `docs/x.md#heading-slug`)
  - `note`: `text`, `color`?, `author`?
  - `section`: `title`, `items`, `layout`? (`row`|`column`|`grid`), `columns`?
  - `image`: `src`, `alt`?, `callouts`?  ·  `mermaid`: `code`  ·  `arrow`: `from`, `to`, `label`?, `style`?
- `index.json`: `{ "boards": [{ "id", "title" }], "docs": [{ "id", "title", "src"? }], "links": [...] }`. Entries are objects,
  not bare ids. A doc's file is `docs/<id>.md` unless `src` says otherwise; `changelog` and `decisions` are always
  in Docs (from `changelog.md` and `decisions.md` at the content root) whether listed or not. Keep each `title` the same as the board file's `title` (Home shows the file's).
- Heading slugs: lowercase, punctuation dropped, spaces → `-` ("Error states" → `error-states`).
- Doc embeds: `![caption](stavy:page/state)` renders a snapshot card; `[text](stavy:page/state)` links to the player.
- Scan keys: `--keys contacts` (a screen), `--keys contacts/empty` (a state, with its crops), comma separated.
- Checking targets: `stavy:scan -- --keys <screen>` prints `missing target "X"` for any flow or board target it can't find; `stavy:validate` lists the last scan's misses.

## Inspector on a design system

`viewer.inspect` in stavy.json describes the team's design system as data
(kits, `classPattern`, `tokenPattern`, `typeScale`); `viewer.inspect.module`
is a same-origin module for what data can't say. Both belong to the team and
live in the repo's local layer. Recipe and checklist:
`docs/INSPECT-ADAPTERS.md`.

## Older workspaces: comments.json

A `stavy-content/comments.json` from before review rounds is moved into
`stavy-content/rounds/` by the dev viewer on first load, or by
`npm run stavy:migrate -- --write`. Never edit either by hand; use
`stavy:address` (see SKILL.md).
