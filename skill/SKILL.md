---
name: stavy
description: Keep a Stavy workspace true and tell the prototype's story on it — register screens and their named states, write flows, compose boards (screens, component crops, flows, Markdown, notes, diagrams) and Markdown handover docs, resolve viewer comments, and keep a changelog and decision log. Use when the user works on a prototype or app that has a stavy.json, asks to add a screen/state/flow/board/doc, to document something for developers, to prepare a review or handover, or to act on Stavy comments. Works with any framework — Stavy never imports the app's code.
---

# Stavy skill

Stavy gives **windows into an app that already exists** — a prototype, or a
real app's staging build. Every state is a real URL; the viewer shows them
as snapshot cards on boards and opens the real app in a player. You keep
that map true and tell the story around it; humans refine it in the viewer.
Read `STAVY.md` (the rules) before changing app code. `SPEC.md`, if present,
wins over this file.

## Who reads it: start from the problem

The designer already knows the prototype. Stavy is for the **PM** and the
**engineers** who will build it. Before you compose anything, find out (from
the conversation, the PRD, or by asking) what problem the feature solves and
what each reader has to take away. Then pick the parts of Stavy that answer
that, and skip the rest.

| Reader | Needs to know | Where it goes |
| --- | --- | --- |
| PM | Is this what we agreed? Which problem each flow solves, what is decided, what is still open, what is out of scope | flows with `refs`, a lead `markdown` on each board, `decisions.md`, Home `links` (PRD, tickets) |
| Engineers | What to build: every state they must handle (empty, error, loading, no permission), the rules between states, edge cases and limits, copy, which components | docs per feature with embedded states, `states` with notes, crops of components, the inspector |
| Both | What is ready to build and what changed since | `status: ready` on screens and boards, `changelog.md` |

- One board per problem or question, titled in the reader's words ("How a
  failed import recovers"), not one board per screen.
- A flow ends at the outcome the user sees, so the PM can check it against
  the problem.
- Write the state names and notes engineers will use in tickets.
- When you're unsure who a board is for, ask.
- **Name the workspace after the feature.** `product.name` (and `description`)
  in `stavy.json` is the product area or feature this workspace covers
  ("Event search"), never the repo name: Home and every header show it. Set
  it when you first touch a new workspace; ask if it isn't clear.

## The workspace

```
stavy.json                     the screen registry: screens, their states, flows, viewer settings
stavy-content/
  index.json                   which boards and docs exist, in order; `links` (PRD, tickets, Figma, repo) for Home
  changelog.md                 what changed on the map, newest first (listed in Docs, shown on Home)
  decisions.md                 the decision log (listed in Docs, shown on Home)
  boards/<id>.json             free-form boards (you compose, humans refine)
  docs/<id>.md                 Markdown handover docs (the source for spec text)
  assets/                      images and SVGs you or people add
  comments.json                comments left in the viewer
snapshots/  (gitignored)       a cache, made by scan on demand — never commit it
```

## The loop: cheap by default

The person is iterating fast. Don't make them wait on Stavy.

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
  normal.
- `group` sorts screens into sections; `status` (`draft`/`review`/`ready`)
  tells developers what's settled.
- Not URL-reachable yet? Add a scene to the app (additively) or leave it
  out. Never fake it.

## Flows

Steps reference states (`{ "page": "import", "state": "mapping", "title": …,
"note": … }`), so a flow never duplicates a screen. `target` (a `data-proto`
id) is optional: it highlights the element in the tour; without it the step
just shows the state, which can't fail. Run a flow to the outcome the user
would see next (the new record in its list), not to the last form step.
Long flows are fine: the board wraps them.

## Boards: tell the story

A board answers one question for one audience: *"how does import fail and
recover?"*, *"every state of the sync chip"*, *"what's new for Thursday's
review"*. Make several small boards rather than one huge one. There is no
required shape — pick what explains it best:

| To show… | Use |
| --- | --- |
| a screen at a moment | `screen` (state, optional `crop` to one element) |
| one component in its states, side by side | `section` of `screen` items with the same `crop`, or `states` with `crop` |
| an open menu, hover, focus | `screen` with `do: [{ "click": "FilterButton" }]` / `{ "hover": … }` |
| responsive versions | `screen` items with `viewport` |
| a journey | `flow` (wraps, never capped) |
| rules, edge cases, copy, tables | `markdown` — never an image of text |
| a state machine or sequence | `mermaid`, or an SVG you draw into `assets/` as an `image` |
| an open question, a decision, a caveat | `note` (yellow = question, blue = decision, pink = risk) |
| how parts connect | `arrow` between item ids, sparingly |
| grouping | `section` with a title; children lay out inside it |

How to compose:

- **Write no coordinates.** Items without `x`/`y` are laid out in order;
  sections lay out their children (`layout: row|column|grid`, `columns`).
  Order the items as the story reads. Give screens a `w` only to make one
  bigger or smaller than its neighbours.
- Lead with a short `markdown` block (what this board is, who it's for), then
  the evidence, then open questions.
- Captions (`title`) name the state in the reader's words; `note` says why it
  matters. One or two sentences.
- **Spec text lives in docs.** If the rules for a component are long, write
  them in `docs/<id>.md` and embed the section: `{ "type": "markdown",
  "src": "docs/import.md#errors" }`. One source, no drift.
- Register every new board in `stavy-content/index.json`. Keep its `links`
  (`{ "title", "url", "kind"? }`) true when the person mentions a PRD, ticket
  or Figma file: Home shows them.
- **Respect human edits.** People move, resize and annotate in the viewer.
  Patch items by `id`; never rewrite a board wholesale, never drop fields you
  don't know, never move an item that has `x`/`y` unless asked. Don't edit
  or delete notes with an `author` other than you.
- After adding screen items with `crop`/`do`/`viewport`, capture them:
  `stavy:scan` (incremental) picks them up.

## Reference (field names)

- Flows live under `scenarios` in stavy.json; a board's `flow` item takes the scenario `id`.
- Flow steps: `page`, `state` (or `dims`), `title`, `note`?, `target`?, `via`?, `hold`?. The player always loads a step's
  registered state fresh, so every step should be its own state URL. Only for a step that exists purely in
  component state (a menu the previous click opened, no URL) add `"via": "click"`: the tour then waits for its
  target after the click instead of loading a URL.
- **Transient steps:** a spinner, a "running" row, a toast that times out. Give the step `"hold": true` (usually
  with `"via": "click"`): the app's timers wait while the step shows, and Next lets the app finish and moves on.
  Without it the app moves on by itself and the step points at nothing.
- Board file: `{ "title", "description"?, "status"?, "items": [...] }`. Every item has `id`, `type`, optional `x`/`y`/`w`/`h`, `title`, `note`.
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
- `index.json`: `{ "boards": [{ "id", "title" }], "docs": [{ "id", "title" }], "links": [...] }`. Entries are objects,
  not bare ids. Keep each `title` the same as the board file's `title` (Home shows the file's).
- Heading slugs: lowercase, punctuation dropped, spaces → `-` ("Error states" → `error-states`).
- Doc embeds: `![caption](stavy:page/state)` renders a snapshot card; `[text](stavy:page/state)` links to the player.
- Scan keys: `--keys contacts` (a screen), `--keys contacts/empty` (a state, with its crops), comma separated.
- Checking targets: `stavy:scan -- --keys <screen>` prints `missing target "X"` for any flow or board target it can't find; `stavy:validate` lists the last scan's misses.

## Docs: the handover

`stavy-content/docs/<id>.md` is what an engineer reads. Embed live states
with `![Empty state](stavy:contacts/empty)`. A useful shape per feature:
purpose · states (embedded) · behaviour rules · edge cases and limits · copy ·
open questions. Keep it current as you change the app: when a rule changes,
change the doc in the same step. Docs read fine on a git host too.

## Changelog

After each change the person would want to know about, add to
`stavy-content/changelog.md` (newest first, under today's date or the current
version, `## 2026-10-20`): what changed on the map (screens, states, flows,
boards) and *why*, in one line each, from the conversation. Skip pure
refactors. Home shows the latest entries.

## Decision log

When the person makes a design decision in conversation, record it in
`stavy-content/decisions.md`, newest first:

```md
## 2026-10-20 — Rejecting an expense always asks for a reason
**Why:** what made this the choice, in their words.
**Alternatives:** what else was on the table.
**Status:** decided
```

Status is `decided`, `open` or `superseded`. Record only what the person
actually decided; never invent a decision or its reasons, and ask if unsure.

## Comments

`stavy-content/comments.json` holds what people left in the viewer, each
anchored to a screen, state and element. Treat open ones as tasks: open that
state, make the change, then set `resolved: true` and add a reply
`{ "author": "Claude", "body": "Done: …" }`. Never delete comments.

## Rules for the app (short — full text in STAVY.md)

1. Additive only: a scene, a param read, a `data-proto` id. Never restructure
   a page to fit Stavy.
2. The app runs identically without Stavy; no Stavy imports in app code.
3. Deterministic data in scenes: fixed clock, seeded ids.
4. Target ids go at the usage site, never inside a shared kit component.
5. Same origin: the viewer is served from the app's public folder.

How much real behaviour a prototype should have is the team's call (see
`PROTOTYPING.md` if the repo has one). Stavy only shows what's there.

## Inspector on a design system

`viewer.inspect` in stavy.json describes the team's design system as data
(kits, `classPattern`, `tokenPattern`, `typeScale`); `viewer.inspect.module`
is a same-origin module for what data can't say. Both belong to the team and
live in the repo's local layer. Recipe and checklist:
`docs/INSPECT-ADAPTERS.md`.

## The team's own conventions

This skill is generic, and the team's habits belong in their repo, not in it.
When the person states a lasting convention ("our boards always lead with the
PRD link", "screenshots go only to the deploy repo"), record it, and tell
them where you put it:

- How you work in Stavy (board layout and style, naming, which states every
  screen gets, how docs are shaped): `.stavy/SKILL.local.md`, a bullet in its
  body. Those bullets land at the top of this skill under "This workspace",
  and they win when they disagree with it.
- Rules for the app and the repo (what may be committed where, build and
  deploy steps, scene conventions): `.stavy/RULES.local.md`, appended to
  `STAVY.md`.

Then run `npm run stavy:update` to rebuild the installed skill and `STAVY.md`
from them. Never edit the installed skill or `STAVY.md` themselves: the next
update replaces them.
