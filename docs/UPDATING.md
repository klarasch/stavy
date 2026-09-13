# Updating Stavy in your repo

This page is for anyone running Stavy in a prototype repo. It's installed
into your repo as `docs/STAVY-UPDATING.md`, and it's replaced by every update.

The short version: **updates are a file copy, never a merge.** Stavy owns a
fixed set of files in your repo and replaces them whole. Everything else is
yours and an update never touches it. Anything you want to change about
Stavy goes in a file you own. The update won't let a change to one of
Stavy's files slip through unnoticed.

---

## 1. Who owns what

**Stavy owns these.** Every update replaces them, and they're listed with their
hashes in `.stavy/lock.json`:

```
public/stavy/                     the built viewer (or public/<dir>/ with --dir)
scripts/stavy/                    validate, scan, gen-tests, the schema
.claude/skills/stavy/SKILL.md     the agent skill, composed (§2)
STAVY.md                          the rules for agents, composed (§2)
docs/STAVY-SPEC.md                the spec
docs/STAVY-UPDATING.md            this page
```

**You own these.** `init` may create them once, then never touches them:

```
public/stavy.json                 your manifest (a starter is created if absent)
.stavy/SKILL.local.md             your skill's identity and standing orders
.stavy/RULES.local.md             your repo's own rules
a viewer.inspect.module file      your design system's inspect adapter
package.json                      the stavy:* scripts are added once, when absent
everything else in the repo
```

`.stavy/lock.json` is written by `init`. Commit it with each update and don't edit it.

## 2. The local layer: changing what Stavy ships without editing it

Stavy's files are generic. They don't know your design system, your team, or
your conventions, and they shouldn't. The local layer is where those go.

### The skill: `.stavy/SKILL.local.md`

```markdown
---
name: acme-prototypes
description: Operate the Acme prototype workspace — register pages, write scenarios, …
---

- Pages are grouped by product area: billing, admin, onboarding.
- Every scenario starts from the dashboard.
- Our components come from the Acme kit; never restyle one inline.
```

`init` composes the shipped skill from this file and Stavy's own `skill/SKILL.md`:

- **Frontmatter:** your fields replace Stavy's. `name` also names the
  folder, so the skill above is written to `.claude/skills/acme-prototypes/`.
  The old folder is removed. Keep each value on one line.
- **Body:** your standing orders go first, under "This workspace", followed by
  Stavy's generic instructions. When the two disagree, yours win.

Without this file you get Stavy's skill as it ships.

### The rules: `.stavy/RULES.local.md`

Plain Markdown, appended to `STAVY.md` under "Local rules (this repo)".
Stavy's rules still apply; yours add to them.

### The viewer

The built viewer is never edited. Everything a repo configures is in the
manifest:

- `viewer.*` in `stavy.json`: toolbar, target attributes, viewport, base path.
- `viewer.inspect` for your design system's names, tokens and type scale. For
  anything data can't say, add `viewer.inspect.module`, a file you own
  (`docs/INSPECT-ADAPTERS.md` in the Stavy repo).

### When none of that is enough

If what you need can't be said in any of those places, that's a gap in Stavy.
Report it (or fix it in Stavy) instead of editing around it. A local patch
to the viewer or the scripts is the one thing an update can't carry for you.

## 3. Take an update

Keep a Stavy checkout next to your repo:

```bash
git clone https://github.com/klarasch/stavy.git ../stavy
```

Then, from your repo:

```bash
git -C ../stavy pull && (cd ../stavy && npm install)
npm run stavy:update            # = node ../stavy/scripts/init.mjs .
```

What it does, in order:

1. **Shows what changed** in Stavy since the commit you last took (from the
   lock). Read it: some changes let you delete a local workaround.
2. **Rebuilds the viewer** if `dist-viewer/` in the checkout wasn't built from
   this commit.
3. **Checks your repo for edits** to Stavy's files, comparing each against the
   hash the last install recorded.
4. **Copies.** Files you haven't edited are replaced. Files an older release
   shipped and this one doesn't are deleted. Edited files are **skipped** and
   named at the end, and the command exits with 1 (§4).
5. **Records** the new commit and hashes in `.stavy/lock.json`.

Commit first, so the update shows up in `git diff` on its own. Then check it:

```bash
npm run stavy:validate && npm run stavy:scan
```

A new release may change the manifest spec. `stavy:validate` tells you what
your `stavy.json` now needs.

Useful flags:

| flag | does |
| --- | --- |
| `--dry-run` | report what would change, write nothing |
| `--check` | only list Stavy's files that you've edited; exits 1 if any. Cheap enough for CI or a pre-commit hook |
| `--force` | take Stavy's copy of edited files too, discarding your edits |
| `--rebuild` | rebuild the viewer even if it looks current |
| `--allow-dirty` | take from a Stavy checkout with uncommitted changes (the lock then can't name an exact commit) |
| `--dir <name>` | viewer folder under `public/`; remembered in the lock |

## 4. "NOT taken — edited in this repo"

Someone changed a file Stavy owns. The update didn't overwrite it, and it
didn't take the new version either. So that file is now stuck on the old
release until you resolve it:

1. `git log -p -- <file>` in your repo to see what the edit was and why.
2. Move it where it belongs (§2), or report it to Stavy.
3. Re-run with `--force` to take Stavy's copy.

The viewer is all-or-nothing. If one of its files was edited, the whole
viewer is skipped, because a new `index.html` next to old chunks would be broken.

## 5. Repos installed before the lock existed

An older `init` wrote no lock, so there's no record of what it installed. The
first update handles that:

- **The built viewer** is replaced. It was never meant to be edited.
- **Everything else** is compared against the Stavy commit named in
  `public/stavy/VERSION`, if the checkout can reach it. Edits are then found
  exactly, as in §4.
- **If it can't** (the VERSION says `-dirty`, or the commit is gone), any file
  that differs from the new release is listed and nothing is written. Review
  them, move local changes into the local layer, then re-run with `--force`.

From then on the lock makes every update exact.

## 6. Removing Stavy

```bash
rm -r public/stavy public/stavy.json scripts/stavy .stavy STAVY.md docs/STAVY-*.md .claude/skills/stavy
```

Then drop the `stavy:*` scripts from `package.json`. The app never knew it was there.
