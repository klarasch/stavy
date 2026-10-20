# The inspector on your design system

Stavy's inspector reads a prototype through the frame: it never imports your
code, it reads the DOM, the fiber tree and the CSSOM the browser already
built. That makes it design-system agnostic by construction — and it means
Stavy hardcodes no design system, including the one its own demo uses.

What it *cannot* work out unaided is what your names are. This document is
how you tell it, in about ten minutes and usually with no code.

---

## 1. What the inspector needs from you

The panel answers four questions about the element under the pointer. Three
of them need something from you.

| Question | Where the answer comes from | What you supply |
| --- | --- | --- |
| **Which component is this?** | The framework's own component tree (React fibers, in the reference viewer) | Nothing, *if* your components have names. If they are anonymous `forwardRef` wrappers, the class your kit stamps on each component's root node (`classPattern`) |
| **With which props?** | The same fiber, once it is the right one | Nothing beyond the above — getting the component right is what gets the props right |
| **Where does this value come from?** | The winning declaration in the frame's CSSOM, followed through its `var()` chain | Which custom properties are *tokens* (`tokenPattern`), and which are private primitives (`privateTokenPattern`) |
| **What piece of type is this?** | Computed family, size, weight and line-height | Your type scale (`typeScale`), so the metrics get a name |

Without any of it the inspector still works: it reports computed values and
the `var()` chain behind them, which for a CSS-variables design system is
already most of the way there. Configuration turns `#1c64f2 ←
var(--btn-bg) ← var(--acme-color-action-primary)` into a named token, an
anonymous wrapper into `AcButton`, and `14px / 21px` into `body`.

---

## 2. The zero-code recipe

Add `viewer.inspect` to `stavy.json`. Here is a complete, worked example for a
fictional design system — **Acme**: components named `AcButton`, `AcCard`, …,
written as anonymous `forwardRef` wrappers over a headless primitive library;
CSS modules, so each component's root node carries a class shaped
`AcButton-module_root__1a3`; tokens as custom properties under `--acme-`,
with raw primitives under `--acme-_`; a type scale compiled from mixins into
plain declarations.

```jsonc
{
  "viewer": {
    "inspect": {
      "kits": [
        {
          "name": "Acme",
          "componentPrefix": "Ac",
          "classPattern": "^(Ac[A-Z]\\w*)-module_"
        }
      ],
      "tokenPattern": "^--acme-(?!_)",
      "privateTokenPattern": "^--acme-_",
      "spacingTokenPattern": "^--acme-(spacing|radius)-",
      "typeScale": [
        { "name": "heading-1",  "family": "Inter", "size": 22, "weight": 700, "lineHeight": 1.25 },
        { "name": "heading-5",  "family": "Inter", "size": 14, "weight": 700, "lineHeight": 1.4  },
        { "name": "body",       "family": "Inter", "size": 14, "weight": 400, "lineHeight": 1.4  },
        { "name": "body-bold",  "family": "Inter", "size": 14, "weight": 700, "lineHeight": 1.4  },
        { "name": "code",       "family": "IBM Plex Mono", "size": 12, "weight": 400, "lineHeight": 1.4 }
      ],
      "componentAttrs": ["data-slot"]
    }
  }
}
```

Field by field:

- **`kits[].name`** — what the panel calls your library.
- **`kits[].componentPrefix`** — a component whose own name starts with this
  belongs to the kit. Used to tell your components apart from app code and
  from a second kit, which is how the panel decides what to collapse behind
  the `+N internals` chip.
- **`kits[].classPattern`** — a regular expression, as a string, matching one
  class your kit stamps on a component's root node. **Capture group 1 must be
  the component's name.** This is the whole answer to anonymous components:
  see §7.
- **`tokenPattern`** — a custom property matching this is a design token, and
  a `var()` chain stops there. It is also how the viewer detects, per frame
  document, that your design system is the one in use — so make it match
  something your `:root` really declares. A negative lookahead here, like the
  `(?!_)` in the worked example above, is what actually keeps your private
  primitives out of detection: `tokenPattern` alone doesn't know to skip past
  a private variable, so a chain can stop there and get reported as a token.
- **`privateTokenPattern`** — properties that exist but are not for anyone to
  reference. A chain that bottoms out on one is reported as a private
  primitive rather than as a token you should be using. On its own this does
  *not* stop a `var()` chain from stopping at a private primitive earlier —
  that's `tokenPattern`'s lookahead's job (above); `privateTokenPattern` only
  labels what the chain already reached.
- **`spacingTokenPattern`** — narrows which tokens are offered as names for
  spacing and radius values (matching is exact: an off-scale 7px stays 7px,
  which is itself worth knowing). Defaults to `tokenPattern`.
- **`typeScale`** — `lineHeight` is a ratio (`1.4`) or px (`21`); anything
  above 4 is read as px. `family` is one family name as it appears *first* in
  the computed stack, not the whole stack. Entries may collide metrically —
  a small heading and a bold body line often do — and the panel breaks the
  tie on whether the element is an `h1`–`h6`. Measure the running app —
  computed `font-family`/`size`/`weight`/`line-height` in devtools — rather
  than copying the design system's published scale table: apps commonly
  re-face or re-weight the DS, and the published numbers then don't match
  what's actually on screen.
- **`componentAttrs`** — attributes that mark kit components in the DOM.

Regex fields are compiled once when the manifest loads. An invalid one
produces a single console warning and is ignored; it never throws mid-hover.

**Two apps in one workspace.** Detection runs per frame document, so a
workspace whose pages come from more than one prototype gets the right answer
per page. A document that declares one of your tokens on its root uses your
configuration; one that does not falls through to the generic path.

---

## 3. The code recipe, for what data cannot say

If your design system needs logic — tokens that are not custom properties, a
framework that is not React, a naming rule with a real exception in it — point
`viewer.inspect.module` at a **same-origin ES module**:

```jsonc
"viewer": { "inspect": { "tokenPattern": "^--acme-", "module": "/stavy-inspect.js" } }
```

The viewer ships as a static build, so importing a file you serve is the only
plug there is. A path starting with `/` is resolved against `viewer.app`
(where your prototype is served); a cross-origin URL is refused. Copy
[`inspect-adapter.template.js`](./inspect-adapter.template.js) into your app's
static folder, fill in the parts you need, and delete the rest — everything
you leave out keeps the built-in behaviour.

The viewer fetches the file and evaluates it from a blob URL rather than
importing the path directly, because a dev server that owns the module graph
will refuse to serve a file from its own static folder as a module — with a
500 and a full-screen error overlay over your prototype. The consequence for
you: **the module must be self-contained**, since a blob URL has no base to
resolve relative specifiers against. For a file whose whole job is to answer
questions about one design system, that is not much of a constraint.

```js
export default {
  apiVersion: 1,                     // the adapter interface you wrote against
  designSystem: { /* any subset of the DesignSystemAdapter below */ },
  framework:    { /* any subset of the FrameworkAdapter below */ },
  panel:        { /* extra panel sections by id, see §4 */ },
}
```

**`apiVersion`.** The viewer implements adapter interface version 1. A
module that declares another version is still loaded, with one console
warning naming both versions — so a team upgrading Stavy sees at once that
its adapter was written against something else. A module without
`apiVersion` predates the field and is read as version 1, silently: every
module written before it keeps working unchanged.

The two halves, as the viewer defines them
(`src/stavy/inspect/types.ts` is the source of truth):

```ts
interface FrameworkAdapter {
  /** Walk outward from a DOM element and list components, innermost first. */
  componentStack(el: Element, stopAt: string): CompFrame[]
}

interface CompFrame {
  name: string
  props: Record<string, unknown>
  /** The component's own root node — what the inspector outlines and measures */
  host: Element | null
  /** True for the design system's own internals; collapsed behind a chip */
  internal?: boolean
  kit?: string
}

interface DesignSystemAdapter {
  name?: string
  /** Does this design system style this frame document? Runtime, per document. */
  detect(doc: Document): boolean
  /** Where the winning declaration for `prop` on `el` comes from. */
  provenance(el: Element, prop: string): Provenance | null
  /** The class that encodes `prop`, for a kit with class-encoded tokens. */
  classSource(el: Element, prop: string): ClassSource | null
  /** Name of the type-scale entry these metrics match. */
  typeScaleName(m: TypeMetrics, el: Element): string | null
  /** Spacing/radius token for a px value. */
  spacingToken(doc: Document, valuePx: number): string | null
  /** How to render one class in the element's class list. */
  classLabel(c: string): { label: string; kind: ClassKind; title?: string }
  kits: Kit[]
  componentAttrs: string[]
}

interface Provenance {
  token: string | null      // the custom property the value resolves to
  chain: string[]           // the var() hops, outermost first
  raw: string               // the winning declared value
  inheritedFrom: Element | null
  note?: string
}
```

Your partial is merged over the adapter the manifest data already produced, so
overriding `provenance` alone still gets you the built-in `detect`,
`typeScaleName` and everything else.

---

## 4. Shaping the panel

The panel is configured by data too. Its content belongs to your design
system: what a reviewer on your team needs to see first, which props are
noise, where your docs live.

```jsonc
"viewer": {
  "inspect": {
    "panel": {
      "sections": ["component", "props", "tokens", "type", "spacing", "accessibility", "url"],
      "hideProps": ["className", "/^on[A-Z]/", "/^data-/"],
      "links": [
        { "label": "Docs", "href": "https://ds.acme.example/components/{kebab}", "kit": "Acme" },
        { "label": "Storybook", "href": "https://storybook.acme.example/?path=/docs/{kebab}--docs", "kit": "Acme" },
        { "label": "Figma", "href": "https://figma.example/acme?node={name}", "match": "^Ac(Button|Card)$" }
      ],
      "copy": ["jsx", "token"]
    },
    "internals": {
      "exclude": ["^Acme(Theme|Telemetry|I18n)"],
      "primitives": ["^Headless"]
    }
  }
}
```

- **`panel.sections`** — order, and which. Built-in ids:
  `component` (the component stack, links, the JSX), `props` (the selected
  component's props as a table), `tokens` (colours and the token behind
  each), `type`, `spacing` (spacing, radius, border, size), `classes` (the
  element's classes and its data/id/name attributes), `accessibility` (role,
  an approximate accessible name, ARIA attributes, focusability — a nameless
  icon button shows `name  missing`), `source` (the semantic target, the
  strings-catalog key, the template and editor links) and `url` (the screen,
  its prototype URL and dimension values). A section you leave out is
  hidden. Without `sections`, every built-in shows in this order, followed
  by your module's sections.
- **`panel.hideProps`** — exact prop names, or regular expressions written as
  `"/pattern/flags"`. Hidden from the props table *and* from the copied JSX.
- **`panel.links`** — per-component link templates. `{name}` is the component
  name (`AcIconButton`), `{kebab}` its kebab case (`ac-icon-button`),
  `{kit}` the kit it belongs to. `kit` limits a link to one kit's
  components, `match` (a regex) to some names. A link whose placeholder has
  no value — `{kit}` on an app component — is left out rather than broken.
- **`panel.copy`** — which copy buttons appear: `jsx` (copy the component as
  JSX), `token` (next to every value that has a token or class name),
  `class` (the element's class list). Default all three.
- **`internals.exclude`** — component names dropped from the stack outright
  (framework plumbing: providers, routers, slots). **`internals.primitives`**
  — headless primitives your kit wraps, collapsed behind `+N internals` when
  a kit renders them (only with `kits` declared). Both are regex strings
  tested against the name minus any bundler digit suffix (`Button2` →
  `Button`), and both are *added* to the built-in lists; set
  `"keepDefaults": false` to replace them. The built-in lists are
  `DEFAULT_EXCLUDE` and `DEFAULT_PRIMITIVES` in `src/stavy/inspect/react.ts`.

**Sections from code.** A `viewer.inspect.module` can export renderers under
`panel`, keyed by section id. Each gets the selection and returns rows, or
`null` to hide itself for that element; the panel draws them like its own.

```js
export default {
  apiVersion: 1,
  panel: {
    "acme-usage"(ctx) {
      // ctx: { el, component: { name, kit?, props } | null, stack, doc, win,
      //        page: { id, label, template? }, dims }
      if (ctx.component?.kit !== "Acme") return null
      const line = `import { ${ctx.component.name} } from "@acme/ui"`
      return { title: "Acme usage", rows: [{ label: "import", value: line, copy: line }] }
    },
  },
}
```

Put `"acme-usage"` in `panel.sections` to place it; unlisted, it comes last.
`ctx.component.props` already has `hideProps` applied. A renderer that throws
shows its error in its own section and breaks nothing else.

---

## 5. Using the inspector

- **The panel docks.** In the player it takes its own space, on the right by
  default; the header switches it to the left or the bottom, and its inner
  edge drags to resize. Side and size are remembered per browser. Beside the
  frame, the prototype keeps the viewport width it had and is scaled to fit,
  so nothing reflows while you inspect and nothing is ever under the panel.
  On the map and on boards it sits on the window edge as an overlay.
- **Hover** outlines the element and tags it with its component name and
  size, in the prototype's own CSS pixels. Everything else is in the panel.
- **Click pins** exactly the element the tag was on. Clicks never reach the
  app while inspect is on, so a row that opens a page, or a menu that closes
  on outside click, stays put. Elements in the app's own dialogs, menus and
  portals pin like any other.
- **The pin holds.** It follows its element through scrolling and resizing,
  and when a re-render or hot reload replaces the node it is found again by
  its place in the tree. Clicking the panel never re-targets it. It ends with
  <kbd>Esc</kbd> (a second <kbd>Esc</kbd> closes inspect), or when the frame
  moves on to another state.
- **Walking**: the breadcrumb at the top of the panel lists the element's
  ancestors (semantic targets in blue); click one to pin it. With a pin,
  <kbd>↑</kbd> goes to the parent, <kbd>↓</kbd> back down the way you came (or
  to the first child), <kbd>←</kbd>/<kbd>→</kbd> to siblings. In the
  component stack, choosing an outer component re-targets the outline and
  styles to that component's root node.
- **Measure**: with something pinned, hover another element to see the
  distances between them as red lines with px labels — gaps between
  neighbours, or all four insets when one contains the other.

---

## 6. The ten-minute check

1. Add the `viewer.inspect` block above, with your names.
2. Open any page in the player and press <kbd>I</kbd> (or add `&i=1`).
3. Hover a button. It gets an outline and a tag with its name and size; the
   panel beside the frame fills in.
4. Click to pin. You should now see, in order:
   - **the component**: your component's real name — `AcButton`, not the
     headless primitive it wraps, and not the page-level container;
   - **its props**: `variant`, `size`, whatever your API is, as JSX you can copy;
   - **the token behind its background**: a value *and* a name, e.g.
     `#1c64f2  --acme-color-action-primary` with the chain
     `background-color ← var(--btn-bg) ← var(--acme-color-action-primary)`
     as the note;
   - **the type**: `14px / 19.6px` with `scale  body-bold`;
   - **spacing**: px, with a token name when the value is on your scale.
5. Click `+N internals` — your kit's own components appear; the default
   selection was the innermost one a person actually wrote.

If a step misses, §7.

---

## 7. Troubleshooting

| What you see | Why | Fix |
| --- | --- | --- |
| The wrong innermost component — a headless primitive, or a page-level container | Your components are anonymous `forwardRef` wrappers, so the fiber has no name. The inspector recovers the name from the class your kit stamps on the component's root node and hands down as `className`: it credits the fiber that *introduced* that class rather than the ones that merely passed it on | Set `kits[].classPattern`, with the component name as capture group 1. Check the pattern against a real class from your DOM: `/^(Ac[A-Z]\w*)-module_/.exec("AcButton-module_root__1a3")[1] === "AcButton"` |
| No props | Same cause — the props shown are those of the frame that was selected, so a wrong name means wrong props | Same fix |
| Component names are single letters, or absent in a production build | Minification dropped them | `esbuild.keepNames` (or your bundler's equivalent) in the build the reviewer opens |
| Your kit's internals crowd the stack | Nothing collapses unless a kit is declared — an app's own `Button` must never be hidden | Declare `kits[].componentPrefix`. In development builds `_debugOwner` then tells the panel which frames a kit rendered for itself |
| Hex values everywhere, no token names | Your tokens are not matched by `tokenPattern`, or the chain stops on a private primitive | Check `tokenPattern` against a real property name. Remember it also drives detection: if nothing on `:root` matches it, your configuration is never selected for that document |
| Every style row is blank | `getComputedStyle` was called from the wrong window. The frame is a different document; the host window returns empty strings for its elements | Only relevant if you wrote a code adapter: use `el.ownerDocument.defaultView.getComputedStyle(el)`, never bare `getComputedStyle` |
| Provenance finds nothing, though the CSS is right there | A stylesheet walk that tests `cssRules` before `selectorText`. Since CSS nesting shipped, every `CSSStyleRule` also exposes a `cssRules` list, so such a walk classifies every plain rule as a grouping rule | Test for a style rule first, then recurse into its nested rules — and resolve `instanceof CSSStyleRule` against the *frame's* window, since cross-realm it is always false |
| A colour set with a shorthand has no provenance | `getPropertyValue("background-color")` is `""` when the author wrote `background: var(--acme-color-surface)` | Fall back to the shorthand (`background`, `border`, `padding`, `margin`, `font`). The built-in adapter already does |
| Type never matches your scale | The computed `font-family` is the whole stack (`"Inter", system-ui`); the line-height is `normal`; or the size is in a fraction of a pixel | `family` must be the first entry only. A `normal` line-height never matches — a declared scale sets one. Line-height is matched within half a pixel of `size × ratio` |
| Spacing shows a token that is not the one you set | Only exact pixel matches are offered, and only from `:root`-declared properties whose value is a plain `px` length | Use `spacingTokenPattern` to narrow the candidates, or accept plain px — an off-scale value is worth seeing |
| Your `module` never loads | It is cross-origin, it 404s, or it has `import` statements of its own | Serve it from the prototype's own origin and keep it self-contained (§3); the console says which it was |
| A wrapper of your own (a theme or telemetry provider) sits on every stack | It has a real name and is not one of the built-in plumbing patterns | Add it to `internals.exclude` (§4) |
| A section, link or copy button you configured does not appear | A typo in a section id is a section that renders nothing; a link with `kit` set only shows on that kit's components; a link whose placeholder has no value is left out | Check ids against §4; check `kits[].name` matches the link's `kit` exactly |
| Console: `declares apiVersion N; this viewer implements apiVersion M` | Your module and this Stavy release disagree on the adapter interface | Work through §9 against the release notes, then update `apiVersion` |

---

## 8. Testing your adapter without a browser

`tests/unit/inspect-adapter.unit.ts` and `tests/unit/fixtures/fake-dom.ts` are
written to be copied. The fake DOM is about 200 lines — elements, a selector
matcher, style rules, and fake React fibers — and it is enough to assert that
your `var()` chains resolve, your anonymous components get their names, and
your type scale matches. Swap the Acme fixtures for yours and run
`npm test`.

For the round trip, `tests/player.spec.ts` shows the Playwright shape: open
`/stavy/?p=<page>&i=1`, move the mouse onto a target, click, and assert on the
panel's contents.

Unit-test your panel data the same way: `tests/unit/inspect-panel.unit.ts` compiles `panel` and `internals` blocks and checks link templates, hidden props and stack filtering without a browser.

---

## 9. Testing your adapter on a new Stavy release

Before rolling a new Stavy release out to your team, run through this with your own `stavy.json` and module. Fifteen minutes, and it catches the design system or the viewer moving under your adapter.

1. **Console first.** Open any screen with `&i=1` and the devtools console. There should be no `[stavy] viewer.inspect…` warnings: no invalid regex, no module load failure, no `apiVersion` mismatch.
2. **Component and props.** Pin one of your kit's components (a button) and one app component. The innermost name is yours (`AcButton`, not the primitive it wraps), the props are its own, and `+N internals` hides what you expect it to.
3. **Tokens and type.** On the same button the background names your token and shows its `var()` chain; a body-text element names its type-scale entry; a padding on your scale names its spacing token.
4. **Panel config.** Every section in `panel.sections` appears in that order and nothing else does; props in `hideProps` are gone from the table and the copied JSX; each link opens the right page for a kit component and is absent for an app component; each `copy` button copies what it says.
5. **Module sections.** Your sections render, return `null` where they should, and never show an `error` row.
6. **Pinning.** Pin a table cell and an item inside an open dialog or menu; scroll the prototype and resize the window — the outline stays on the element; `Esc` unpins. With a pin, hover a neighbour and check one redline against a value you know.
7. **Your tests.** Run your copies of the unit tests (§8) and any Playwright checks you keep against the new release.
8. **Bump `apiVersion`** in your module only after the release notes' adapter-interface changes are worked through. Older modules without the field keep loading as version 1.
