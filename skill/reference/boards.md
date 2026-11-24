# Boards: reader, outline, composing

Load this when asked to compose, restructure or annotate a board, or to plan
what a review should show. Rules and field names are in `fields.md`; long
text goes in docs (`docs.md`).

## Who reads it: start from the problem

The designer already knows the prototype. Stavy is for the **PM** and the
**engineers** who will build it. Before you compose anything, find out (from
the conversation, the PRD, or by asking) what problem the feature solves and
what each reader has to take away. Then pick the parts of Stavy that answer
that, and skip the rest.

| Reader | Needs to know | Where it goes |
| --- | --- | --- |
| PM | Is this what we agreed? Which problem each flow solves, what is decided, what is still open, what is out of scope | flows, a lead `markdown` on each board, `decisions.md`, Home `links` (PRD, tickets) |
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

## Agree the content before you compose

Composing a board or doc is cheap for you and expensive for the person to
untangle. Before you write one (or restructure one), propose its outline in
chat and wait for a yes:

- the question it answers and who reads it;
- the items in reading order: which states, crops, flows, notes, one line
  each;
- what goes in the doc instead (rules, edge cases, copy, tables), by heading.

Keep the outline short enough to answer in one reply. If the person says
"just do it", go ahead, but still say in one line what you left out. Small
patches (a caption, one more state) need no outline. When nobody can answer
(an unattended or scheduled run), compose from the outline you would have
proposed and list your assumptions at the top of your report, not on the
board.

## Boards are the picture, docs are the words

A board is a **visual, simplified annotation of how the feature works**: the
states, the crops, the flow, and short labels that point at what matters.
Board columns are narrow; prose there turns into a wall of text nobody reads.
Every sentence that explains, specifies or lists belongs in
`stavy-content/docs/<id>.md`.

Sort each piece of content with one test: **would the reader point at it,
or read it?**

| Board (point at it) | Doc (read it) |
| --- | --- |
| a state, a crop, a flow: the evidence | the rules that decide which state shows |
| a 2-5 word caption naming a state | why it behaves that way |
| a numbered callout on a part of a crop | the full list of edge cases and limits |
| one open question, one risk, one decision (a note) | the reasoning, alternatives, history (`decisions.md`) |
| a diagram of how states connect | validation rules, error copy, tables, API notes |
| "See Error rules →" | the Error rules section |

A good board still makes sense with only its captions; a good doc still
makes sense with its embeds removed (embeds show what the words describe, at
the point they describe it).

- On a board, text is a label, not a paragraph: a lead of two or three
  sentences at most, captions of a few words, notes of one sentence.
- No rules, edge-case lists, copy tables or long Markdown on a board. Put
  them in the doc and link to the section from the board
  (`[Error rules](?doc=import#errors)`), or embed only a section that is a
  few lines long.
- Annotate with the picture first: crop to the component, show its states
  side by side, number the parts with a short `note` each. If you need more
  than one sentence to explain a crop, the explanation goes in the doc.
- When a board grows text anyway (people add it), offer to move it to the
  doc; don't do it silently.

## Boards: tell the story

A board answers one question for one audience: *"how does import fail and
recover?"*, *"every state of the sync chip"*, *"what's new for Thursday's
review"*. Make several small boards rather than one huge one. There is no
required shape; pick what explains it best:

| To show… | Use |
| --- | --- |
| a screen at a moment | `screen` (state, optional `crop` to one element) |
| one component in its states, side by side | `section` of `screen` items with the same `crop`, or `states` with `crop` |
| an open menu, hover, focus | `screen` with `do: [{ "click": "FilterButton" }]` / `{ "hover": … }` |
| responsive versions | `screen` items with `viewport` |
| a journey | `flow` (wraps, never capped) |
| rules, edge cases, copy, tables | the doc, linked from a short `markdown` label: never on the board, never an image of text |
| a state machine or sequence | `mermaid`, or an SVG you draw into `assets/` as an `image` |
| an open question, a decision, a caveat | `note` (yellow = question, blue = decision, pink = risk) |
| how parts connect | `arrow` between item ids, sparingly |
| grouping | `section` with a title; children lay out inside it |

How to compose:

- **Write no coordinates.** Items without `x`/`y` are laid out in order;
  sections lay out their children (`layout: row|column|grid`, `columns`).
  Order the items as the story reads. Give screens a `w` only to make one
  bigger or smaller than its neighbours.
- Lead with a short `markdown` block (what this board is, who it's for, a
  link to the doc), then the evidence, then open questions.
- Captions (`title`) name the state in the reader's words, in a few words;
  `note` says why it matters, in one sentence.
- **Spec text lives in docs.** Write rules, edge cases and copy in
  `docs/<id>.md` and link the section from the board:
  `{ "type": "markdown", "md": "[Error rules →](?doc=import#errors)" }`.
  Embed a section (`"src": "docs/import.md#errors"`) only when it is a few
  lines long. One source, no drift.
- Register every new board in `stavy-content/index.json`. Keep its `links`
  (`{ "title", "url", "kind"? }`) true when the person mentions a PRD, ticket
  or Figma file: Home shows them.
- **Respect human edits.** People move, resize and annotate in the viewer.
  Patch items by `id`; never rewrite a board wholesale, never drop fields you
  don't know, never move an item that has `x`/`y` unless asked. Don't edit
  or delete notes with an `author` other than you. Keep the file's layout
  (one item or one key per line, as the viewer writes it): `stavy:format`.
- **`do` only opens and points.** Use it to open a menu, a dialog, a
  tooltip, never to submit, save, delete or send. The viewer replays
  `click`/`hover`/`focus` on every inspect hover, against whatever app the
  workspace points at (maybe staging). An item that needs `type` or `press`
  stays a snapshot when inspected; prefer a named scene for that state.
- After adding screen items with `crop`/`do`/`viewport`, capture them:
  `stavy:scan` (incremental) picks them up.

## Notes on the map

The map lays itself out from `stavy.json`; `stavy-content/map.json` adds free
items on top (a board file: stickies, Markdown, images, arrows). Each top-level
item names the area it belongs to (`anchor`):

```json
{ "title": "Map", "items": [
  { "id": "empty-q", "type": "note", "text": "Does the empty state ship in v1?", "anchor": "page:dashboard" },
  { "id": "actions", "type": "note", "text": "Only managers see these actions.", "anchor": "page:expense-detail",
    "screen": "expense-detail", "state": "submitted", "target": "ApprovalActions" }
] }
```

- `anchor` is `page:<screen id>`, `area:map`, `area:boards` or `area:scenarios`.
- **Leave out `x`/`y`.** A sticky without them sits in a slot inside its
  screen's tile, under the card, and follows it however the map is laid out.
  Only add `x`/`y` (relative to the area's top-left) when the person placed
  it; a placed sticky keeps its screen open.
- **To point at something**, add `screen` (and `state` or `dims`, and
  optionally `target`): the map draws a line from the sticky to that card or
  element.
- One sentence per sticky: a question, a caveat, a decision. Anything longer
  goes in a doc.
- `notes[]` in `stavy.json` is retired: `npm run stavy:migrate -- --write`
  turns it into pointing stickies.
