# Stavy on Monday

A first trial of Stavy **inside the existing work mock repo**, on a branch,
in about half a day. Nothing lands on `main`; nothing existing is changed.
By the end you have a branch that deploys the mock exactly as before **plus**
a canvas at `/canvas` with two real pages on it.

Assumptions: the mock is Vite + React with react-router; you have Claude Code
(Opus is plenty — the skill is written for it); Node 22+.

---

## 0. The night before, on the private laptop (2 min)

Push the reference repo so the work clone has the current viewer, the
`init` script and this file:

```bash
cd ~/Code/prototyping/stavy && git push
```

(If `git status` shows uncommitted work, commit it first.)

---

## 1. Two repos side by side (10 min)

Clone Stavy **next to** the mock repo — `init` is run from the mock with a
relative path to it.

```bash
cd ~/Code    # wherever the mock repo lives; the two must be siblings
git clone https://github.com/klarasch/stavy.git
```

No `npm install` needed in the Stavy clone — `init` uses the committed
prebuilt viewer CSS, so it works from a bare clone (locked-down npm included).

Then a fresh branch in the mock:

```bash
cd <mock-repo>
git checkout main && git pull
git checkout -b stavy-trial
node -v    # 22 or newer
```

---

## 2. Install (2 min)

From the mock repo root:

```bash
node ../stavy/scripts/init.mjs . --route /canvas
```

What this does — **copies files in, nothing else**:

| It adds | What it is |
|---|---|
| `src/stavy/` | the viewer (canvas, page view, inspector, comments). Never edit it. |
| `src/stavy.css` | prebuilt, plain CSS for the viewer only — no preflight, no global styles |
| `stavy.json` | the manifest, starter: product name + one `state` dimension, no pages, `viewer.base = "/canvas"` |
| `scripts/validate.mjs`, `scripts/snapshot.mjs` | the checker and the screenshot script |
| `.claude/skills/stavy/SKILL.md`, `SPEC.md`, `docs/STAVY-ADOPTION.md` | what Claude reads |
| `src/vite-env.d.ts` | type declarations the viewer needs |

The wiring steps it prints are also saved to `docs/STAVY-WIRING.md` in the
mock repo, so losing the terminal output doesn't matter — and re-running init
is always safe (it overwrites `src/stavy/`, never your manifest or wiring). Then:

```bash
git status --short
```

Expect only `??` (new) lines. If `src/vite-env.d.ts` shows as ` M`
(modified), the mock already had one and `init` overwrote it — not a
problem, just mention it in the next prompt.

---

## 3. Wire it — Claude does this (15 min)

Open Claude Code **in the mock repo** (restart it if it was already open, so
it picks up `.claude/skills/stavy`). Paste, filling in the two blanks:

```
Stavy was just installed in this repo with
`node ../stavy/scripts/init.mjs . --route /canvas`. Here is what it printed:

<PASTE THE INIT OUTPUT — or say: read docs/STAVY-WIRING.md>

Do exactly steps 1–4 from that output:
- install react-router-dom IF this repo doesn't already have it (it's the only
  dependency; skip mermaid and playwright today)
- vite.config.ts: the stavySlice plugin; set the default page
  path inside load() to `src/stavy-pages/${id}.tsx`
- main.tsx: import "./stavy.css"
- mount <Route path="/canvas/*" element={<StavyApp />} /> inside our EXISTING
  router, with StavyApp loaded via React.lazy so the mock's bundle doesn't grow
- package.json scripts: validate, check, snapshot

Rules: do not change any existing route, page, component, style or provider.
Do not add esbuild.keepNames. Do not register any pages yet.
<IF git status SHOWED ' M' ON src/vite-env.d.ts: "init overwrote
src/vite-env.d.ts — merge my original from git with the new declarations.">

Then run `npm run validate` and `npm run dev` and give me the canvas URL.
```

**Check** (both must be true before you go on):

- `http://localhost:5173/canvas` → an empty canvas with the product name and
  the Stavy toolbar.
- `http://localhost:5173/` → the mock's home, pixel-identical to before.

Commit:

```bash
git add -A && git commit -m "Stavy: install viewer on /canvas (trial)"
```

---

## 4. Inventory — Claude reads, you decide (20 min)

This is the one step where a model must not decide alone. Paste:

```
Read .claude/skills/stavy/SKILL.md and SPEC.md. Do NOT edit anything.

1. List every route/page in this mock. For each one: the visible states it can
   show (empty, loading, error, per role, step N of a flow…) and how that state
   is chosen today — props, useState, context, router params, or hardcoded.
2. List the React providers a page needs just to render (router, auth/user,
   theme, data, i18n).
3. Propose 3–5 dimensions for stavy.json from this product's reality, each
   with its values. A good dimension is something a PM asks "what does it look
   like when…" about: role, data state, lifecycle stage, plan tier. "Page" is
   not a dimension.
4. Recommend the 2 pages that are cheapest to register first (fewest providers,
   state already comes from props).

Stop and wait for me.
```

Pick **three** dimensions for Monday, rename them to the words your team
uses (labels are what the canvas shows), pick the two pages. Reply with that.

---

## 5. Register two pages as they are (45 min)

Paste (fill in A and B):

```
Write the dimensions we agreed into stavy.json. Register pages <A> and <B>
AS THEY ARE TODAY:

- one adapter module per page at src/stavy-pages/<id>.tsx, exporting
  `default ({ dims, nav }) => …`, rendering the existing page component and
  mounting the providers it needs INSIDE the adapter, not at the app root
- map dims → the props/fixtures the page already accepts; where a state lives
  in useState, leave it alone — on Monday we show only what props can reach
- add data-proto on the 3–5 regions a walkthrough would point at (primary
  action, the list/table, the empty state, the status indicator)
- pin 2 instances per page (e.g. default role + loaded, other role + empty)
- add one scenario that goes from A to B; fidelity "static" is fine

Run `npm run validate` and fix until it reports 0 errors.
Do not refactor the pages themselves.
```

**Check on the canvas** (`/canvas`):

- two page areas, each with two pinned cards rendering the real page
- click a card → the page; press **D** → dimensions panel; switch role; **C** → back
- open the scenario from the Contents panel and step through it

Commit:

```bash
git add -A && git commit -m "Stavy: dimensions + first two pages (trial)"
```

---

## 6. Show it (10 min)

Deploy the branch exactly the way you always do. The link to share is

```
<branch-url>/canvas
```

If `<branch-url>/canvas/p/<page>` 404s on a hard refresh, the host needs
`/canvas/*` in the same SPA rewrite the mock already uses for its own routes
(ask Claude: "add /canvas/* to the SPA fallback for <host>").

Feedback without a server: on a page press **M**, click the element, write;
**Comments → Copy link** carries all comments in the URL — paste it in Slack.

---

## If npm is locked down at work

The mock repo installs its dependencies somehow — Stavy rides the same channel.
Find out which world you're in (ask whoever set up the repo, or run
`npm config get registry` in it):

1. **Internal mirror** (Artifactory/Nexus URL): `npm i react-router-dom` works
   as usual — and the repo almost certainly has react-router-dom already, so
   most likely you install nothing at all.
2. **Mirror with an allow-list**: only react-router-dom would ever need
   approval (mermaid and playwright are optional, skip them for the trial).
3. **No registry at all**: the Stavy clone needs no install (prebuilt CSS is
   committed), and if react-router-dom is missing, bring it as tarballs.
   At home:

   ```bash
   npm pack react-router-dom react-router cookie set-cookie-parser
   ```

   Copy the four `.tgz` files into the mock repo (e.g. `vendor/`) the same way
   you brought the Stavy clone in, then at work:

   ```bash
   npm i ./vendor/*.tgz
   ```

   That installs from the local files without touching any registry.

---

## What to tell the repo owner

> It adds a folder and a route. The diff outside `src/stavy/` is: one import
> in `main.tsx`, one lazy route, ~30 lines in `vite.config.ts` (a plugin that
> only serves a virtual module the viewer imports), three npm scripts, and at
> most one dependency (react-router-dom, which we probably already have — the
> viewer vendors everything else). No Tailwind, no global CSS, no change to any
> existing page, route or provider. `npm run validate` is not in CI. Removing
> it is `git revert` of two commits.

---

## If something goes wrong

| Symptom | Cause → fix |
|---|---|
| Canvas shows the page card but the page is blank / 404 in console | the Vite plugin's default page path doesn't match where the adapters are — `load()` in `vite.config.ts` must say `src/stavy-pages/${id}.tsx` |
| The mock's own pages look different after the install | something imported Tailwind preflight or a global reset at the root — the viewer CSS is preflight-free; check `main.tsx` imports only `./stavy.css` |
| Vite 7/8 complains about `esbuild` | someone added `keepNames` — remove it |
| Claude doesn't know what Stavy is | Claude Code was open before `init` — restart it; the skill lives at `.claude/skills/stavy/SKILL.md` |
| Page renders but role/state switches do nothing | that state is `useState` inside the page, not props — expected on Monday; lift it into a dim later for the pages a scenario needs |
| `npm run validate` says a `data-proto` target is missing | the adapter wraps a component that doesn't pass `data-*` through — put the attribute on a wrapping `div` in the adapter, or add a `// @proto-targets` comment (SPEC §2) |

---

## Not on Monday

- No templates, no "porting all pages". Two pages, as they are.
- No edits in `src/stavy/`. If the viewer needs a change, it goes in the
  reference repo and `init` is re-run.
- No merge to `main`, no CI check. Show first.
- No refactoring page internals. The inventory tells you which pages are
  cheap; the expensive ones wait for a scenario that needs them.

## Words you will see

| Word | Meaning |
|---|---|
| manifest | `stavy.json` — what exists, in which states, and which walkthroughs demonstrate it |
| dimension | an axis of variation (role, data state, lifecycle stage); every page declares which values it supports |
| instance / pin | one page at one full dimension assignment, shown as a card on the canvas |
| `data-proto` | an attribute naming a region so scenarios, annotations and comments can point at it |
| scenario | a walkthrough: ordered steps, each a page + dims + target |
| slice (`prototypes[]`) | a named subset of pages/scenarios that can be built and deployed on its own |
| template | a page shape (list, detail, dashboard…) pages are built on — not needed for the trial |
