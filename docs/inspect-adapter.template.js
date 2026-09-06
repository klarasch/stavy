/**
 * Stavy inspect adapter — copy-and-fill template.
 *
 * You almost certainly do not need this file. Describing your design system
 * in `viewer.inspect` in the manifest (data only: token patterns, component
 * prefixes, type scale) covers the normal cases, and this is the escape hatch
 * for what data cannot say. Read `docs/INSPECT-ADAPTERS.md` first.
 *
 * HOW TO USE
 *   1. Copy this file into whatever your prototype serves statically, e.g.
 *      `public/stavy-inspect.js`. It must be SAME-ORIGIN with the viewer;
 *      a cross-origin module is refused.
 *   2. Point the manifest at it:
 *        "viewer": { "inspect": { "tokenPattern": "^--acme-",
 *                                 "module": "/stavy-inspect.js" } }
 *      A path starting with "/" is resolved against `viewer.app`.
 *   3. Delete every function below that you do not need. What you leave out
 *      keeps the built-in behaviour: your object is merged OVER the adapter
 *      the manifest data already produced, key by key.
 *
 * It is a plain ES module. No build step, no imports from the viewer — the
 * viewer is a static bundle and does not export anything to you. Everything
 * here is standard DOM.
 *
 * It must also be SELF-CONTAINED: no relative or bare `import` statements of
 * your own. The viewer fetches this file and evaluates it from a blob URL,
 * because a dev server that owns the module graph refuses to serve a file
 * from its static folder as a module — and a blob URL has no base to resolve
 * relative specifiers against.
 *
 * The one rule that is easy to get wrong: every element you are handed lives
 * in the PROTOTYPE's document, not the viewer's. Read computed style through
 * `el.ownerDocument.defaultView`, never through a bare `getComputedStyle` —
 * the host window returns empty strings for another document's element.
 */

/* ------------------------------------------------------------------ *
 * Fill these in for your design system.                               *
 * ------------------------------------------------------------------ */

const TOKEN = /^--acme-(?!_)/          // a custom property that is a design token
const PRIVATE = /^--acme-_/            // …and one that is a raw primitive
const KIT_CLASS = /^(Ac[A-Z]\w*)-module_/ // group 1 = the component's name

/** Computed style from the element's OWN window. Always use this. */
function computed(el) {
  const win = el.ownerDocument?.defaultView
  return win ? win.getComputedStyle(el) : null
}

/* ------------------------------------------------------------------ *
 * The adapter.                                                        *
 * ------------------------------------------------------------------ */

export default {
  designSystem: {
    /** Shown in the panel. */
    name: "Acme",

    /**
     * Is this frame document styled by you? Runtime, per document, so a
     * workspace can hold apps on different stacks. Cheap: it runs once per
     * document, but make it a presence check, not a scan.
     *
     * Delete this to keep the built-in check ("does `:root` declare a custom
     * property matching `tokenPattern`").
     */
    detect(doc) {
      const root = doc.documentElement
      const cs = root && doc.defaultView ? doc.defaultView.getComputedStyle(root) : null
      return !!cs?.getPropertyValue("--acme-color-text-primary").trim()
    },

    /**
     * Where the winning declaration for `prop` on `el` comes from.
     *
     * Delete this unless your tokens are NOT reachable as custom properties:
     * the built-in implementation already matches every rule in the frame's
     * CSSOM (nesting, @media, @layer, @import and shorthand fallback
     * included), orders them by the real cascade, and follows the winning
     * value's var() chain through the element and its ancestors.
     *
     * @param {Element} el
     * @param {string} prop  a CSS property name, e.g. "background-color"
     * @returns {{token: string|null, chain: string[], raw: string,
     *            inheritedFrom: Element|null, note?: string} | null}
     */
    provenance(el, prop) {
      const cs = computed(el)
      if (!cs) return null
      const raw = cs.getPropertyValue(prop)
      if (!raw) return null
      // Your logic here. `token` is the name to show, `chain` is the trail of
      // var() hops shown as the note, `raw` is the declared value.
      return { token: null, chain: [], raw, inheritedFrom: null }
    },

    /**
     * The class that encodes `prop`, for a kit whose tokens live in class
     * names rather than custom properties. Return null (or delete this) if
     * yours do not — a name the inspector cannot prove is worse than none.
     *
     * @returns {{cls: string, from: Element|null, note?: string} | null}
     *          `from` is the ancestor the class sits on, for inherited values.
     */
    classSource(el, prop) {
      return null
    },

    /**
     * Name for a set of computed type metrics. Delete this if `typeScale` in
     * the manifest can express your scale — it usually can.
     *
     * @param {{family: string, size: number, weight: number, lineHeight: number|null}} m
     *        `family` is the first family of the computed stack; `lineHeight`
     *        is px, or null for CSS `normal`.
     */
    typeScaleName(m, el) {
      return null
    },

    /** Spacing/radius token for an exact px value, or null. */
    spacingToken(doc, valuePx) {
      return null
    },

    /**
     * How to render one class in the element's class list.
     * @returns {{label: string, kind: "color"|"type"|"space"|"layout"|"kit"|"other", title?: string}}
     */
    classLabel(c) {
      const m = KIT_CLASS.exec(c)
      if (!m) return { label: c, kind: "other" }
      const local = c.slice(m[0].length).replace(/__[^_]*$/, "")
      return { label: local ? `${m[1]}/${local}` : m[1], kind: "kit", title: c }
    },

    /** Attributes that mark your components in the DOM. */
    componentAttrs: ["data-slot"],
  },

  /**
   * Only if you are not on React, or your component tree needs a rule the
   * built-in walk cannot express. Delete the whole half otherwise — the
   * built-in one already names anonymous components from `kits[].classPattern`
   * and collapses a kit's own internals.
   */
  framework: {
    /**
     * Components that rendered `el`, INNERMOST FIRST, stopping at `stopAt`
     * (a component name; "" means go to the root).
     *
     * @returns {Array<{name: string, props: object, host: Element|null,
     *                  internal?: boolean, kit?: string}>}
     *          `host` is that component's own root node — the inspector
     *          outlines and measures it when the frame is selected.
     *          `internal: true` hides the frame behind the internals chip.
     */
    componentStack(el, stopAt) {
      return []
    },
  },
}
