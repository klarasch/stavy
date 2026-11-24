# Plan 0.5: cheap to iterate, reviewable, versionable

Status: proposal, 2026-11-14. Drawn from a hands-on trial, not yet agreed line by line.

## Goal

Stavy does three things well and nothing else:

1. **Cheap iteration** on a code prototype, on the app's real code and design system.
2. **Review** that is kept as versioned context, with or without a backend.
3. **Navigation**: any state is easy to find, and versions are easy to compare in words.

The app's real code stays the only form of a screen. Stavy sets no conventions on how screens are written.

## Decisions after the trial (2026-11-14)

- **Docs are the source of truth; boards are optional.** A doc is the handover. A board is a visual companion the designer authors, and can sit inside a doc as a figure.
- **Stavy scales down to one document.** Three sizes, each needing only what it uses:
  - *One document*: a few states and one interactive doc with those states embedded. No map, no boards. The viewer opens straight on the doc.
  - *One feature*: states, flows, a doc, review rounds, versions.
  - *A subproduct*: a workspace holding several features. A feature is a first-class level with its own doc, states, rounds and versions; the side panel lists features first.
- **A version is a commit.** Designers redeploy from the same branch to the same URL, so the URL does not identify a version. The published build is stamped with its commit, and comments, rounds and "what changed" notes refer to commits only. No pull requests in the loop.
- **URLs stay stable.** The deploy URL, state ids and state URLs are what people paste into chat and wiki pages, so they must keep working across versions. Renaming a state id or URL is a breaking change: avoid it, and when it is needed keep the old id as an alias. A link may carry the commit it was made on, so the viewer can say "this was made on an older version" without the link breaking.
- **Review comes back as one link or file.** A reviewer comments on the branch deploy and presses "Send feedback". That produces one link (and a Markdown digest with pictures, for reading) to send to the designer. Opening the link in the designer's local viewer offers "Import round: 5 comments from Dana", which writes the round file into the repo. No backend, no git for the reviewer.
- **Build order is in waves**, each ending in something to try:
  1. Lean loop, the two scripts, the comment bug fixes, round files and round import.
  2. Tweak write-back and variants side by side.
  3. Checkpoint note, side panel and map fix, the one-document size.
  Layers come after, one at a time, when asked for.

## The trial

A new feature (members and roles, then custom roles) was designed on the Northwind CRM sandbox by running the proposed process by hand. Each build step ran in a fresh context on a smaller model with a short brief.

| Step | Model | App lines changed | Tokens written | Total tokens | Time |
|---|---|---|---|---|---|
| Version 1: 8 static states | Sonnet | 298 | 8,900 | about 76,000 | 58 s |
| 4 review comments | Haiku | about 30 | 9,500 | about 71,000 | 49 s |
| Version 2: 7 new states | Sonnet | 143 | 8,600 | about 71,000 | 54 s |
| 2 review comments | done inline, not measured | 4 | | | |

### What it showed

- **Fixed overhead is the real price.** Three runs of very different size each cost about 70,000 tokens. The work itself was under 10,000 written tokens each time. A one-line change pays the same overhead as a feature. (That most of it is fixed context is an estimate, not a measurement.)
- **So the cheapest change is one that needs no model.** One of six review comments was a single class removal. A tweak panel would have written it for free.
- **Batching is the next best thing.** Four comments in one run cost the same as one would have.
- **Bookkeeping by a model is waste.** Marking four comments resolved in JSON took more written tokens than the four code fixes. A 35-line script did the same job for nothing in the next round.
- **Static first worked on an existing mock.** Real kit, real shell, fixed data, one scene per state. No kit gaps in version 1; version 2 reused a checkbox the kit already had.
- **Pointers worked.** Briefs that named the file and line finished in five to eight model calls with no searching.
- **The scratchpad earned its place.** It caught every decision the agent made alone and everything it faked. It needs a script for the timestamp: left to itself, the agent wrote 10:00 on every line.
- **"What changed" needs no model for the facts.** A byte comparison of snapshots sorted states into changed, new and same. The scratchpad supplied the why.
- **The agent oversteps a little, and logs it.** It removed two placeholder tabs from an existing page, and made product decisions (which actions apply to which area). All were in the scratchpad.

### Bugs found in the viewer

- Comments made after navigating inside the app were saved against the state the player was opened on, not the one on screen.
- Three older comments were no longer in `comments.json` after a new review round. Cause not established; they were recoverable from git.
- The supervising session, long and full of screenshots, cost more than the three builds together. Checking by screenshot is expensive and should be the exception.

## What to build, in order

### 1. A lean loop for iterating

- Split the skill. The part loaded while iterating is short: static first, real kit, one scene per state, point at file and line, log one line per change, no docs or boards or changelog.
- Checkpoint and handover instructions load only when asked for.
- `stavy:log "<what>" "<why>" [states]`: appends a line with the real time and the current commit to a dated file. Append-only, one file per day.
- Advice in the skill: one fresh session per feature, smaller model by default.
- **Static first applies to new work only.** Screens that already work keep their behaviour. A new screen or state starts static and gains behaviour when a named interaction needs it.
- **Variants before building.** Ask for two or three options of one component in a single run (it costs about the same as one). Each is a temporary state marked as an exploration. The viewer shows them side by side, cropped to the component. Picking one logs the choice; the others are deleted in the next batch.
- **Fixture recommendations** (in the optional `PROTOTYPING.md`, not enforced; the mechanism is each repo's choice):
  - one shared set of base data, reused by every screen, taken from the app's own data layer where one exists;
  - a scene is a named patch over the base data, not a new dataset;
  - fixed clock and seeded ids;
  - include the awkward cases: long names, empty lists, one item, too many;
  - say what is faked.

### 2. Review rounds

- A round is one file: author, date, the commit reviewed. One file per author per round, so nobody edits another person's file. Replies and status changes go in the acting person's own file and point at the thread.
- Three states: open, addressed (by whoever made the change, with the commit), closed (by the comment's author, or when the next version is published without a reopen).
- `stavy:address <id> "<sentence>"`: adds the reply, the commit and a log line. Agents use this and never edit comment files.
- Each comment stores a small picture of its element, taken when it is made. A past round is readable without recovering an old version.
- A flag that marks a comment as a change request, so a batch can be applied in one run.
- "Walk me through my feedback": the tour player over the open comments of a round, with Reply, Addressed and Next.
- A published build is stamped with its commit, so a comment made there records the version it was made on. Published builds carry no file and line; the designer's local viewer finds the element again from the comment's anchor and resolves the source place there.
- Reviewer mode on published builds: browse and comment only. People without git export their round; the maintaining designer commits it.
- Fix the two comment bugs above first.
- The storage seam stays, so a backend can later hold the same events.

### 3. Tweak panel, no agent

- In the player, select an element; change spacing, alignment or a component variant; see it live.
- "Apply" writes to the source file directly when the value is written literally in the code (a class, a prop). That needs the element's file and line from the dev build, which is not yet verified.
- Anything computed, or inside a shared kit component, becomes a change request comment for the next batch.
- Variant options and the spacing scale come from the workspace's own inspect configuration, never from Stavy.

### 4. Checkpoint and "what changed"

- `stavy:checkpoint <name>`: tags the commit, keeps that version's snapshots, compares them with the previous version and writes a draft note: states changed, new, removed and unchanged; the log lines since the last version; what is faked; open questions.
- The designer edits the note. One file per version, never rewritten afterwards.
- The viewer lists the notes, with before and after pictures for changed states.
- "Ready for dev" is set on a version.
- No version switcher.

### 5. Navigation

- A side panel lists screens, flows, boards, docs and versions, with a ready / not ready filter.
- The map uses one tile size, in three levels: screens, one screen's states, the player.
- Text on the map has a readable size range; outside it, text shortens or hides. Only screens scale freely.
- Title pills must not collide when zoomed out.

### 6. Layers, on demand

Everything optional is a layer switched on over the same screen, off by default.

- **Annotations**: small numbered markers on the element, one-sentence notes in a margin beside the screen, never on top of what they describe.
- **Kit**: every design system component outlined and named, tokens shown, anything off-kit flagged. The same check runs in the scan as an audit.
- **Copy**: every string in context, for content writers. A suggested replacement is a change request like any other.
- **Comments**, **site map and diagrams**, **live mode** on the map.

### 7. Docs

- A feature doc is generated once, then patched: only the sections a change affects, shown as a diff, one sentence per line, stable headings.
- The doc is the source of truth for words; facts (states, pictures) are embedded, not copied.
- Decisions are one file per feature, newest first, one heading per decision. An overturned decision gets a new entry, and the old one is marked superseded with a link to it.

## Remove

- PRD requirement checks and the coverage board.

Boards stay, authored by the designer, with a small set of item types. Strings, anatomy, diagrams and the site map stay as layers or on demand, as above.

## Not verified

- Whether a dev build of a React 18 app on the work kit exposes file and line per element.
- How spacing and variants are expressed in the work kit, and so how much of it the tweak panel can write without a model.
- How reviewers without git get their rounds into the repo at work.
- The split between fixed and variable token cost per run.
