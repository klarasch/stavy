---
name: stavy
description: Keep a Stavy workspace true and tell the prototype's story on it — register screens and their named states, write flows, compose boards (screens, component crops, flows, Markdown, notes, diagrams) and Markdown handover docs, resolve viewer comments, and keep a changelog. Use when the user works on a prototype or app that has a stavy.json, asks to add a screen/state/flow/board/doc, to document something for developers, to prepare a review or handover, or to act on Stavy comments. Works with any framework — Stavy never imports the app's code.
---

# Stavy skill

Stavy gives **windows into an app that already exists** — a prototype, or a
real app's staging build. Every state is a real URL; the viewer shows them
as snapshot cards on boards and opens the real app in a player. You keep
that map true and tell the story around it; humans refine it in the viewer.
Read `STAVY.md` (the rules) before changing app code. `SPEC.md`, if present,
wins over this file.

## The workspace

```
stavy.json                     the screen registry: screens, their states, flows, viewer settings
stavy-content/
  index.json                   which boards and docs exist, in order
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
- Register every new board in `stavy-content/index.json`.
- **Respect human edits.** People move, resize and annotate in the viewer.
  Patch items by `id`; never rewrite a board wholesale, never drop fields you
  don't know, never move an item that has `x`/`y` unless asked. Don't edit
  or delete notes with an `author` other than you.
- After adding screen items with `crop`/`do`/`viewport`, capture them:
  `stavy:scan` (incremental) picks them up.

## Docs: the handover

`stavy-content/docs/<id>.md` is what an engineer reads. Embed live states
with `![Empty state](stavy:contacts/empty)`. A useful shape per feature:
purpose · states (embedded) · behaviour rules · edge cases and limits · copy ·
open questions. Keep it current as you change the app: when a rule changes,
change the doc in the same step. Docs read fine on a git host too.

## Changelog

After each change the person would want to know about, append to
`STAVY-CHANGELOG.md` (newest first, under today's date or the current
version): what changed on the map (screens, states, flows, boards) and *why*,
in one line each, from the conversation. "Cut a version" = add a version
heading above the dated entries. Skip pure refactors.

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
