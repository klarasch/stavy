/**
 * The inspector seam, in two halves.
 *
 * The inspector answers three questions about the element under the pointer:
 * *which component is this, with which props* (the **framework** half), *where
 * does this value come from* and *what is this piece of type* (the **design
 * system** half). Both halves are data, not code, for the common cases — a
 * design system usually only has to describe itself in `viewer.inspect` in the
 * manifest (see `docs/INSPECT-ADAPTERS.md`). The interfaces below are what a
 * code adapter implements when the data is not enough.
 */

/** One component on the stack from the inspected element outward. */
export interface CompFrame {
  name: string
  props: Record<string, unknown>
  /** The component's own root DOM node (first host descendant) — what the inspector outlines and measures */
  host: Element | null
  /** True when this frame is a design system's own internal render, not something app code wrote — collapsed behind a chip */
  internal?: boolean
  /** Name of the kit this frame belongs to, when it is a kit component */
  kit?: string
}

/** Computed type metrics of one element, normalised for matching against a type scale. */
export interface TypeMetrics {
  /** The single family actually rendering — the first entry of the computed stack, unquoted */
  family: string
  /** px */
  size: number
  weight: number
  /** px, or null for CSS `normal` */
  lineHeight: number | null
}

/** Where one computed CSS value came from. */
export interface Provenance {
  /** The design token (a custom property name, with `--`) the value resolves to, or null */
  token: string | null
  /** The `var()` hops from the declared value down to the token, outermost first */
  chain: string[]
  /** The winning declared value, e.g. `var(--btn-fg)` */
  raw: string
  /** Set when the value is declared on an ancestor and inherited, not on the element itself */
  inheritedFrom: Element | null
  /** Short remark for the panel, e.g. when the chain bottoms out on a private primitive */
  note?: string
}

/** The class on an element (or an ancestor) that encodes a value, for kits whose tokens live in class names. */
export interface ClassSource {
  cls: string
  /** The ancestor the class sits on, when the value is inherited rather than set here */
  from: Element | null
  note?: string
}

/** How the panel renders one class of an element's class attribute. */
export type ClassKind = "color" | "type" | "space" | "layout" | "kit" | "other"

/** One entry of a design system's type scale. */
export interface TypeScaleEntry {
  name: string
  family: string
  /** px */
  size: number
  weight: number
  /**
   * Ratio (1.5) or px (21). Values above 4 are read as px — no real scale has a
   * ratio that large, and no real scale has a 4px line box.
   */
  lineHeight: number
}

/** A component library whose components the inspector should be able to name. */
export interface Kit {
  /** Shown in the panel, e.g. "Acme" */
  name: string
  /** A component whose own fiber name starts with this belongs to the kit */
  componentPrefix?: string
  /**
   * Matches one class the kit stamps on a component's root node; capture group 1
   * is the component's name (e.g. `^(Ac[A-Z]\w*)-module_` for
   * `AcButton-module_root__1f2a3`). This is what gives anonymous components
   * (`forwardRef((props, ref) => …)`) a name.
   */
  classPattern?: RegExp
}

/** Framework half: how to get from a DOM node to the components that rendered it. */
export interface FrameworkAdapter {
  /** Walk outward from a DOM element and list components, innermost first; stop at `stopAt` (a component name, or "" for the root). */
  componentStack: (el: Element, stopAt: string) => CompFrame[]
}

/** Design-system half: how to get from a computed value to the token, class or scale entry behind it. */
export interface DesignSystemAdapter {
  /** Shown in the panel when a kit is recognised */
  name?: string
  /** Does this design system style this frame document? Runtime, per document — two apps can coexist in one workspace. */
  detect: (doc: Document) => boolean
  /** Where the winning declaration for `prop` on `el` comes from, followed through its `var()` chain. */
  provenance: (el: Element, prop: string) => Provenance | null
  /** The class that encodes `prop` for a kit with class-encoded tokens; null for a CSS-variables kit. */
  classSource: (el: Element, prop: string) => ClassSource | null
  /** Name of the type-scale entry these metrics match, or null. */
  typeScaleName: (m: TypeMetrics, el: Element) => string | null
  /** Spacing/radius token for a px value, or null. */
  spacingToken: (doc: Document, valuePx: number) => string | null
  /** How to render one class in the element's class list. */
  classLabel: (c: string) => { label: string; kind: ClassKind; title?: string }
  /** Component libraries whose components should be named and whose internals should collapse. */
  kits: Kit[]
  /** Attributes that mark UI-kit components in the DOM. */
  componentAttrs: string[]
}

export interface InspectAdapter {
  framework: FrameworkAdapter
  /**
   * Design systems in priority order; the first whose `detect` matches a frame
   * document wins, and the last always matches (the generic CSS-variables path).
   */
  designSystems: DesignSystemAdapter[]
}

/** What a code adapter module default-exports: partials merged over the built-in defaults. */
export interface InspectAdapterModule {
  framework?: Partial<FrameworkAdapter>
  designSystem?: Partial<DesignSystemAdapter>
}
