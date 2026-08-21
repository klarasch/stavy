# Adopting Protoscope on your own design system

This is the hands-on guide for trying Protoscope in a fresh repo with a
different UI kit, and for rolling it onto an existing prototype/mock repo at
work. Steps marked **(skill)** are what Claude does for you when the
`protoscope` skill is installed — you can do them by hand too.

---

## A. Fresh trial repo (≈ 1–1.5 hours, mostly manifest design)

1. **Scaffold** a Vite + React + TypeScript app and install your design system
   package (MUI, Ant, Chakra, your in-house kit). Your *product* does not need
   Tailwind; the viewer chrome uses Tailwind utilities scoped to itself (no
   preflight, so nothing in your app changes) — `init` sets that up.
2. **Install the viewer with one command** — do not re-theme it:
   ```bash
   node /path/to/protoscope/scripts/init.mjs ../my-trial-repo
   ```
   It copies `src/protoscope/`, the scoped `src/protoscope.css`, the validator
   and snapshot scripts, the skill, `SPEC.md`, this guide, and a starter
   `protoscope.json`, then prints the five things left to wire (deps, the
   Vite plugin with your page path, the CSS import, routes, scripts).
3. **Install the skill**: copy `skill/SKILL.md` to
   `.claude/skills/protoscope/SKILL.md` in the new repo (and `SPEC.md` next to
   it or at the repo root — the skill reads it).
4. **Let the skill set the workspace up** **(skill)** — in Claude Code:
   > "Set up Protoscope for *<product>* on *<design system>*. Start with a
   > dashboard and a list page, roles *<a/b>*, a *<thing>* lifecycle
   > *<x → y → z>*, and two scenarios."
   It will create `protoscope.json`, an `AppFrame`-style shell, the first
   templates and pages, fixtures, scenarios, slices, and run the validator.
5. **Binding contract checklist** (what the skill must have produced):
   - page modules `export default ({ dims, nav }) => …` at the paths the
     manifest names (`module`, or `src/demo/pages/<id>.tsx` by default —
     change the default path in the Vite plugin's `load()` if your layout differs)
   - `data-proto` on every region a scenario, annotation, or note references
   - if your kit doesn't stamp component names (MUI/Ant don't): a one-file
     wrapper layer that re-exports the components you use with
     `data-component="<Name>"` on the root node. The whole pattern is:
     ```tsx
     // src/kit/index.tsx — import kit components from here, not from the kit
     import MuiButton, { type ButtonProps } from "@mui/material/Button"
     const stamp = <P extends object>(name: string, C: React.ComponentType<P>) =>
       Object.assign((p: P) => React.createElement(C, { ...p, "data-component": name } as P), { displayName: name })
     export const Button = stamp<ButtonProps>("Button", MuiButton)
     ```
6. **Adapt the inspector** **(skill)** — `src/protoscope/inspect-adapter.ts`:
   - React: nothing to do (component + props come from the React tree)
   - Tailwind + shadcn tokens: nothing to do
   - other token names (e.g. `--color-primary-500`): replace `tokenNames`
   - CSS-in-JS (emotion/styled-components): class names are hashed, so
     class-based color provenance degrades gracefully to computed values;
     keep `componentStack` (still works) and optionally map your theme
     object's palette to values for token matching. If the kit ships a global
     reset (MUI `CssBaseline`, Chakra's baseline), mount it inside your page
     templates rather than at the app root — both share one document, so a
     root-level reset restyles the viewer's chrome too
   - Vue/Svelte: replace `componentStack` with the framework's equivalent
     (`__vueParentComponent` / `__svelte_meta`) — the rest is framework-free
7. **Run**: `npm run dev` → the canvas. `npm run check` (validation + coverage;
   add `--refs docs/your-prd.md` to check scenario refs against a PRD). Then
   `PROTO=<slice> npx vite build --outDir dist-<slice>` and confirm excluded
   page chunks are absent from `dist-<slice>/assets`. With the dev server
   running and Playwright's browser installed (`npx playwright install
   chromium`), `npm run snapshot -- --slice <id>` writes a PNG per pinned
   instance to `snapshots/`.

What to look for while testing: does the canvas read as a coverage map of
your product? Can a colleague play a scenario without help? Does Inspect show
the component you expected with the props you'd write?

---

## B. Rolling onto an existing mock repo (recommended path at work)

Set it up **inside the existing mock repo** — it already imports the design
system, has the fixtures, and designers know it. But **rebuild the page
templates clean**, extracted from the existing mocks one shape at a time
(strangler pattern), rather than registering every old page as-is:

1. Add the viewer, plugin, validator, skill, and an empty `protoscope.json`
   (product + dimensions only). Nothing else changes; old routes keep working.
2. Audit the mock: list the 3–5 dominant page shapes (list, detail, dashboard,
   form flow, settings…). Those become the first `templates`, each extracted
   from the cleanest existing page and fixed to the `({ dims, nav })` contract.
3. Migrate pages by *feature*, not by folder: when a designer starts a new
   exploration, the skill builds it on templates; when an old page is needed
   in a scenario, port it then. Unported mock pages are not a problem — they
   just aren't on the canvas yet.
4. Promote organisms as they recur (`kind: "component"`), and make the
   canvas the place PRs are reviewed from (the PR description links the
   preview's canvas URL).
5. Retire the separate builds repo once slice builds cover the demos
   (see CI below).

Branch model stays as it is: `main` = the system (templates, dimensions,
shared fixtures, canonical mock); feature branches = explorations with their
own slices; template changes = reviewed "system PRs".

---

## B2. Keep the manifest true automatically (the "drift hook")

Claude Code can run a shell command after specific events. Add this to the
workspace's `.claude/settings.json` and the validator runs every time Claude
edits the manifest, a page, a template, or an organism — its output goes
straight back to Claude, which fixes the drift in the same turn:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "f=$(jq -r '.tool_input.file_path // empty'); case \"$f\" in *protoscope.json|*/pages/*|*/templates/*|*/organisms/*|*/components/*) npm run validate --silent ;; esac"
          }
        ]
      }
    ]
  }
}
```

(`jq` parses the hook's JSON input; drop the `case` filter if you'd rather run
the validator after every edit — it takes well under a second.)

## B3. Comments without a server (GitHub Pages + Slack)

Comments are separate from annotations: annotations are authored
documentation in the manifest; comments are conversation. The viewer stores
comments **in the browser** (local-first), so a static host like GitHub Pages
needs nothing extra:

1. On any page press **M** (or the speech-bubble button) and click where the
   comment belongs — ideally on the element itself, so the comment anchors to
   its `data-proto` target and survives redesigns. Name once; reply, resolve.
2. Open **Comments** → **Copy link**. The link carries all comments as a
   compressed payload in the URL hash (never sent to the server) — paste it
   in Slack. Whoever opens it sees the bubbles and the panel. **Copy as
   Markdown** produces a Slack-readable digest with a deep link per comment.
3. Others comment and send *their* link back; **Import → Unpack** merges
   payloads by comment id. The designer resolves items and, when the thread
   is done, either exports the Markdown into the PR or simply clears.

Capacity: a comment compresses to roughly 60 characters, so one link carries
~500 comments before Safari's URL limit (~80k) or Slack's message limit (~40k)
matter; the viewer falls back to the Markdown digest automatically beyond that.

When the team outgrows links, swap the store for a GitHub-issues or small
hosted backend — the anchor model and UI stay the same.

## C. CI/CD

One workflow, three jobs. Example for GitHub Actions (adapt to GitLab/Bitbucket 1:1):

```yaml
name: protoscope
on: [pull_request, push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run validate          # manifest ↔ code invariants (+ --refs docs/PRD.md for the contract)
      - run: npx tsc -b
      - run: npx vite build            # full workspace

  slices:
    needs: check
    runs-on: ubuntu-latest
    strategy:
      matrix:
        slice: ${{ fromJson(needs.check.outputs.slices || '["full"]') }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: PROTO=${{ matrix.slice }} npx vite build --outDir dist-${{ matrix.slice }}
      - uses: actions/upload-artifact@v4
        with: { name: slice-${{ matrix.slice }}, path: dist-${{ matrix.slice }} }

  preview:
    needs: slices
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      # Deploy each slice artifact to your static host (Vercel/Netlify/Cloudflare
      # Pages/S3+CloudFront/GitHub Pages) under <pr>-<slice>.your-preview.host
      # and comment the canvas URLs on the PR. Slice ids come from
      # `jq -r '.prototypes[].id' protoscope.json`.
      - run: echo "deploy + comment"
```

Notes:
- Read slice ids from the manifest (`jq -r '.prototypes[].id' protoscope.json`)
  and expose them as a job output for the matrix; build only the slices whose
  pages changed if you want to save minutes (`git diff --name-only` against
  `manifest.pages[].module`).
- `main` deploys the full workspace; PRs deploy slices. The PR comment should
  link the **canvas** of each slice — that's the review surface.
- Visual diffs of every pinned state: run `vite preview` in the job, then
  `node scripts/snapshot.mjs --url http://localhost:4173` and diff
  `snapshots/` against the base branch (upload as artifact, or use a visual
  diff service). The viewer hides its chrome with `?ui=0`, which the script sets.
- The requirements check is built in: `node scripts/validate.mjs --refs
  docs/PRD-118.md` fails if a scenario cites a ref that isn't in the document,
  and warns for documented sections no scenario demonstrates — the manifest as
  a contract between PM, design and engineering, enforced.
