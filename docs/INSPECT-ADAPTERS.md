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
  see §5.
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
  designSystem: { /* any subset of the DesignSystemAdapter below */ },
  framework:    { /* any subset of the FrameworkAdapter below */ },
}
```

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

## 4. The ten-minute check

1. Add the `viewer.inspect` block above, with your names.
2. Open any page in the player and press <kbd>I</kbd> (or add `&i=1`).
3. Hover a button. The panel follows the pointer and steps aside rather than
   covering it.
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

If a step misses, §5.

---

## 5. Troubleshooting

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

---

## 6. Testing your adapter without a browser

`tests/unit/inspect-adapter.unit.ts` and `tests/unit/fixtures/fake-dom.ts` are
written to be copied. The fake DOM is about 200 lines — elements, a selector
matcher, style rules, and fake React fibers — and it is enough to assert that
your `var()` chains resolve, your anonymous components get their names, and
your type scale matches. Swap the Acme fixtures for yours and run
`npm test`.

For the round trip, `tests/player.spec.ts` shows the Playwright shape: open
`/stavy/?p=<page>&i=1`, move the mouse onto a target, click, and assert on the
panel's contents.
