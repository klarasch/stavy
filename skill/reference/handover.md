# Checkpoint and handover

Load this when asked to hand over, prepare a review, or record what changed.
While iterating, none of this is written: the one-line log (`stavy:log`) is
enough.

When asked to hand over: read the day logs under `stavy-content/log/` since
the last handover, then write the changelog and decision entries below from
them and from the conversation. Turn each "decided: ..." and "faked: ..." log
line into a decision entry or a note in the doc. Then load `docs.md` or
`boards.md` if a doc or board is asked for too.

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
