# Comments

Comments are conversation about the prototype, separate from annotations
(authored documentation in the manifest). They work everywhere the viewer
shows something, with or without a server.

| Where | How to place one | What it is anchored to |
| --- | --- | --- |
| Player (`?p=`) | **M**, hover (the outline names the element), click. **Parent** / **Child** in the composer widen or narrow the choice. | the exact element: see *Anchors* below |
| Board (`?b=`) | **M**, click an item or the empty board | `{ board, item?, x, y }` |
| Map | **M**, click a card or the empty canvas | `{ board: "@map", item?, x, y }` (item = the card's instance key) |
| Doc (`?doc=`) | select text and press **Comment**, or **M** and click a paragraph | `{ doc, heading?, quote, block? }` |

**One panel** (the speech-bubble button) lists every comment, with
**Here** (this page state, board or doc) vs **Everywhere**, and
open / addressed / resolved / all. Clicking a comment takes you to its place
and opens its thread; replies and resolve work the same everywhere.

## Review rounds

Comments are kept as rounds: `stavy-content/rounds/<date>-<author>.json`,
one file per author per day.

```jsonc
{ "version": 1, "id": "2026-11-14-dana", "author": "Dana", "date": "2026-11-14",
  "commit": "3061a96", "branch": "rbac",          // what was reviewed
  "comments": [ { "id": "…", "body": "…", "createdAt": "…", /* where it is anchored */ } ],
  "events":   [ { "id": "…", "thread": "<comment id>", "type": "reply", "body": "…", "at": "…" } ] }
```

- Nobody edits another person's file. A reply or a status change is an
  event in the acting person's own round, and names the thread. Event types:
  `reply`, `status` (`open`, `addressed` with `commit`, `closed`), `edit`,
  `remove`.
- A comment is **open**, then **addressed** by whoever made the change (with
  the commit), then **closed** by its author. `resolved` means closed.
- The viewer shows the merge of all rounds. It writes one change at a time
  and never a whole list, so a save can not drop comments it has not loaded.
  Deleting your own unanswered comment removes it; deleting anyone else's
  hides it (a `remove` event) and leaves their file alone.
- Never edit round files by hand. After a fix:
  `npm run stavy:address -- <id> "<one sentence>" [--as "<name>"]` records
  the status, the reply and the current commit in your own round and adds a
  log line. `--list` prints the open comments.
- `rounds/index.json` lists the files, so a static host can load them. It
  is regenerated on every write.
- A `comments.json` from before rounds is moved into rounds by the dev
  viewer on first load, or by `npm run stavy:migrate -- --write`. It is
  removed only after every comment and reply is found in the rounds.

### Sending feedback without git

A reviewer on a published build comments, then presses **Send feedback**:
one link is copied (and **Digest .md** downloads the same feedback as
Markdown to read). Whoever maintains the prototype opens the link in
their dev viewer, which offers "Import round: 5 comments from Dana" and writes the round file.
`stavy:publish` writes `stavy-content/build.json` with the build's branch and
commit; each comment made there records them.

A player comment records the state on screen when it is made. If the app had
navigated to a URL that is not a registered state, the comment keeps that
`url` (with the state the reviewer came from) and its pin shows only there.

## Anchors

A player comment remembers its element four ways, most semantic first, and
is found again on every load in the same order:

1. `target` (+ `nth` when the id repeats): the nearest element above it that
   carries a target id (`data-proto`, `data-testid`, or `viewer.targetAttrs`);
2. `path`: the nth-child path from that target (or the page body) down;
3. `snippet`: the element's text (≤ 80 chars), or its accessible label. It
   verifies the path, and when the path no longer holds, the element is
   searched for by these words inside the target;
4. `box`: the element's box as fractions of the document, the last resort.

`x`, `y` are the click position in % of the element. Comments written before
snippets and boxes existed (`target` + `path` only) still load and resolve as
before.

On boards and the map, `x`, `y` are % of the item's box (the pin follows the
item when it moves or resizes, at any zoom), or board coordinates in px when
the comment is on the empty board. On docs the `quote` is highlighted (the
first occurrence after `heading`), with a marker in the margin; `block` (the
index of the top-level block) places the marker when the quote is no longer
in the text.

## Where comments are kept

```jsonc
// stavy.json
"viewer": {
  "comments": { "adapter": "file" }       // or "local", or { "module": "/stavy-comments.js" }
}
```

- **`"file"`**: round files in `stavy-content/rounds/` through the dev
  endpoint, which the team and agents can read, commit and review. Changes
  on disk show up live. Needs the writable dev endpoint; without it the viewer falls
  back to `"local"`.
- **`"local"`**: this browser (localStorage) until the reviewer presses
  **Send feedback**; **Import** takes in a colleague's link. Rounds shipped
  with the published build are shown too and are never changed.
- **`{ "module": "<url>" }`**: a same-origin ES module, so comments can go to
  any backend you already have. No Stavy server is involved.

**Default:** `"file"` when the dev endpoint is writable, else `"local"`. So
a published static build works with no configuration.

### Writing an adapter module

```js
// public/stavy-comments.js — served next to the viewer, same origin
const API = "/api/review-comments"

export async function list() {
  return (await fetch(API)).json()                 // Comment[]
}
export async function save(comment) {             // a new comment (or one imported from a link)
  await fetch(API, { method: "POST", body: JSON.stringify(comment) })
}
export async function update(id, patch) {         // { status, resolved, replies, addressedIn }, …
  await fetch(`${API}/${id}`, { method: "PATCH", body: JSON.stringify(patch) })
}
export async function remove(id) {                // optional
  await fetch(`${API}/${id}`, { method: "DELETE" })
}
```

- The four functions can also be the module's `default` export (an object).
- A path starting with `/` resolves under the app's base, like
  `viewer.inspect.module`. Cross-origin URLs are refused.
- The module is fetched and imported as one file: keep it self-contained (no
  relative imports).
- The viewer updates the screen first, then calls the adapter; `list()` is
  called on load and whenever the window regains focus.
- Store comments as given: unknown fields must round-trip. Dates
  (`createdAt`) are numbers (ms); ISO strings are accepted on the way in.

### The comment shape

```ts
interface Comment {
  id: string
  body: string
  author: string
  createdAt: number
  status: "open" | "addressed" | "closed"
  addressedIn?: string          // commit
  resolved: boolean             // status === "closed"
  replies: { id: string; author: string; body: string; createdAt: number }[]
  commit?: string; branch?: string   // the build it was made on
  // player
  page?: string; dims?: Record<string, string>; url?: string
  target?: string; nth?: number; path?: number[]; snippet?: string
  box?: { x: number; y: number; w: number; h: number }
  // board / map ("@map")
  board?: string; item?: string
  // doc
  doc?: string; heading?: string; quote?: string; block?: number
  // position: player = % of the element, board item = % of the item, board point = px
  x?: number; y?: number
}
```

A comment with `doc` is a doc comment, one with `board` a board (or map)
comment, anything else a player comment.
