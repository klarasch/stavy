---
name: stavy
description: Iterate on a prototype that has a stavy.json, keeping its screens and named states true, logging each change, and answering review comments with the Stavy scripts. Reference files for boards, docs, handover and field names load only when asked. Use when the user works on a prototype or app that has a stavy.json, adds a screen or state, or acts on Stavy review comments. Works with any framework; Stavy never imports the app's code.
---

# Stavy skill

Stavy gives windows into an app that already exists. Every state is a real
URL; the viewer shows them as cards and opens the real app in a player. Read
`STAVY.md` (the app rules) before changing app code. Don't read
`docs/STAVY-SPEC.md` (about 57 KB): `reference/recipes.md` and
`reference/fields.md` answer what you need.

## While iterating

- **Static first, for new work only.** A new screen or state starts as real
  kit components with fixed data. It gains behaviour when a named interaction
  needs it. Screens that already work keep their behaviour.
- **Use the app's real kit and shell.** Never invent a component the kit has.
- **One scene per state.** Every state is URL-addressable (`?scene=<name>`)
  and registered in `stavy.json`:
  `{ "id": "contacts", "url": "/contacts", "states": [{ "id": "empty", "url": "/contacts?scene=contacts-empty" }] }`.
  Other fields: `reference/fields.md`. Fixture advice: `PROTOTYPING.md`.
- **Point at file and line** in every brief and report.
- **Look things up with `npm run stavy:ls [screen]`**, never by reading the
  whole `stavy.json`.
- **How-to answers are in `reference/recipes.md`**: add a state, scene,
  screen, dialog or dimension, capture an open menu.
  Never read Stavy's scripts, schema or viewer bundle to find out.
- **Check with text, once.** After your edits, run `stavy:validate` and
  `npm run stavy:scan -- --keys "<screen>/<state>"`, and read the output. A
  person reviews the pictures on the canvas: never pull screenshots into
  your context or write your own browser scripts.
- **No docs, boards or changelog** while iterating. Write them at a
  checkpoint or handover, only when asked, and load the file from the table
  below first.

## Log every change, with the script

```
npm run stavy:log -- "<what>" "<why>" [states]
```

It appends `- HH:MM · <states> · <what> · why: <why> · <short commit>` to
`stavy-content/log/<YYYY-MM-DD>.md` with the real time. Never write the file
or the time by hand. Also log every decision you make alone ("decided: ...")
and everything you fake ("faked: ...").

## Review comments

Comments live in round files under `stavy-content/rounds/`. Never edit them
by hand. After fixing comments, commit the code change first so the commit
recorded is the fix, then run:

```
npm run stavy:address -- <id> "<one sentence>" [<id> "<one sentence>" ...]
```

It records status "addressed", your reply and the current commit, and writes
the log line. Sign as someone other than the git user with `--as "<name>"`;
agents use their own name (`--as Claude`). Batch all open comments of a round
into one run. Only the comment's author closes a comment.

## Budget

Every model call re-sends the whole context, so cost is the number of steps
times the context size. Keep both small.

- **Register the states, then stop.** Don't polish, document or verify
  pixels.
- **Check in after about six new states** with what you built and what you
  faked, before going on.
- **One builder, one fresh session per feature.** Splitting one feature
  across parallel agents makes each re-read the repo. Use a smaller model by
  default.
- **Batch changes**, and when exploring, ask for two or three variants of a
  component in one run.

## Load when asked for

| Ask | File |
| --- | --- |
| how to add a state, scene, screen, dialog or dimension | `reference/recipes.md` |
| a board, or what a review should show | `reference/boards.md` |
| a doc for developers | `reference/docs.md` |
| a checkpoint, handover, changelog or decision log | `reference/handover.md` |
| exact field names, flows, `index.json`, inspector | `reference/fields.md` |

## App rules and team conventions

The short list is in `STAVY.md`: additive only, the app runs without Stavy,
fixed data in scenes, target ids at the usage site, same origin. How real a
prototype should be is the team's call (`PROTOTYPING.md`).

A lasting convention the person states belongs in the repo, not here. How you
work in Stavy goes in `.stavy/SKILL.local.md` (bullets land at the top of this
skill and win on conflict). Rules for the app go in `.stavy/RULES.local.md`
(appended to `STAVY.md`). Tell them where you put it, then run
`npm run stavy:update`. Never edit the installed skill, reference files or
`STAVY.md`: the next update replaces them.
