# Docs: the handover

Load this when asked to write or update a doc for developers. What belongs
in a doc rather than on a board is in `boards.md`; field names for embeds and
`index.json` are in `fields.md`.

`stavy-content/docs/<id>.md` is what an engineer reads. Embed live states
with `![Empty state](stavy:contacts/empty)`. A useful shape per feature:
purpose · states (embedded) · behaviour rules · edge cases and limits · copy ·
open questions. Keep it current as you change the app: when a rule changes,
change the doc in the same step. Docs read fine on a git host too.

- Spec text lives here, never on a board: rules between states, edge cases
  and limits, copy, validation, tables, API notes.
- Boards link to a section (`[Error rules](?doc=import#errors)`) or embed one
  that is a few lines long (`"src": "docs/import.md#errors"`). One source, no
  drift.
- Register the doc in `stavy-content/index.json` (`docs: [{ "id", "title" }]`).
- Write the state names and notes the way engineers will use them in tickets.
