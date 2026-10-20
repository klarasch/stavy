/* ------------------------------------------------------------------ */
/* Element anchors: where a comment sits inside a prototype document.   */
/*                                                                      */
/* A comment remembers the element it was placed on four ways, from     */
/* most to least semantic:                                              */
/*   1. the nearest target id above it (+ which occurrence, `nth`)      */
/*   2. the nth-child path from that target (or the page root) down     */
/*   3. a short text snippet of the element (verifies 2, or finds it    */
/*      again when the DOM around it changed)                           */
/*   4. its box as fractions of the frame document (last resort)        */
/*                                                                      */
/* Pure functions over a minimal element shape, so they unit-test       */
/* without a DOM; the DOM-specific lookups are passed in.               */
/* ------------------------------------------------------------------ */

/** The slice of `Element` the anchor code touches. */
export interface AnchorEl {
  parentElement: AnchorEl | null
  children: ArrayLike<AnchorEl>
  textContent: string | null
  getAttribute(name: string): string | null
}

/** A box as fractions (0–1) of the frame document's scroll size. */
export interface FracBox {
  x: number
  y: number
  w: number
  h: number
}

export interface ElementAnchor {
  /** Nearest target id at or above the element */
  target?: string
  /** Which occurrence of `target` in the document (ids can repeat) */
  nth?: number
  /** nth-child path from the target (or the page root) down to the element */
  path?: number[]
  /** Short text of the element, to verify the path or search for it again */
  snippet?: string
  /** The element's box as fractions of the document: the fallback */
  box?: FracBox
}

export interface AnchorLookups {
  /** The page root (the frame's body) */
  root: AnchorEl
  /** Nearest element carrying a target id, at or above `el` */
  targetOf: (el: AnchorEl) => { id: string; el: AnchorEl } | null
  /** Every element carrying target id `id`, in document order */
  targetsById: (id: string) => AnchorEl[]
  /** The element's box as fractions of the document (omit to store none) */
  boxOf?: (el: AnchorEl) => FracBox | null
}

export type Located = { el: AnchorEl; via: "path" | "snippet" | "target" | "root" } | { box: FracBox; via: "box" }

export const SNIPPET_MAX = 80
const LABEL_ATTRS = ["aria-label", "title", "alt", "placeholder", "value"]

export const normText = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()

/** What the element says: its text, else an accessible label. Undefined for a wordless element. */
export function snippetOf(el: AnchorEl): string | undefined {
  const t = normText(el.textContent)
  if (t) return t.slice(0, SNIPPET_MAX)
  for (const a of LABEL_ATTRS) {
    const v = normText(el.getAttribute(a))
    if (v) return v.slice(0, SNIPPET_MAX)
  }
  return undefined
}

/** Does `el` say `snippet`? (Snippets are truncated, so a full-length one matches as a prefix.) */
export function snippetMatches(el: AnchorEl, snippet: string): boolean {
  const s = snippetOf(el)
  if (!s) return false
  if (s === snippet) return true
  return snippet.length >= SNIPPET_MAX && s.startsWith(snippet)
}

/** nth-child path from `from` down to `el` (empty when el === from or el is outside from). */
export function pathBetween(from: AnchorEl, el: AnchorEl): number[] {
  const path: number[] = []
  let cur: AnchorEl | null = el
  while (cur && cur !== from) {
    const parent: AnchorEl | null = cur.parentElement
    if (!parent) return []
    path.unshift(Array.prototype.indexOf.call(parent.children, cur))
    cur = parent
  }
  return cur === from ? path : []
}

/** Follow an nth-child path; null if the DOM changed underneath it. */
export function followPath(from: AnchorEl, path: number[] | undefined): AnchorEl | null {
  let cur: AnchorEl | null = from
  for (const i of path ?? []) {
    cur = cur?.children[i] ?? null
    if (!cur) return null
  }
  return cur
}

/** Deepest element under `base` that says `snippet` (first in document order). */
export function findBySnippet(base: AnchorEl, snippet: string): AnchorEl | null {
  for (let i = 0; i < base.children.length; i++) {
    const hit = findBySnippet(base.children[i], snippet)
    if (hit) return hit
  }
  return snippetMatches(base, snippet) ? base : null
}

/** Capture an anchor for `el`. */
export function describeElement(el: AnchorEl, look: AnchorLookups): ElementAnchor {
  const t = look.targetOf(el)
  const base = t?.el ?? look.root
  const out: ElementAnchor = { path: pathBetween(base, el) }
  if (t) {
    out.target = t.id
    const all = look.targetsById(t.id)
    const nth = all.indexOf(t.el)
    if (nth > 0) out.nth = nth
  }
  const snippet = snippetOf(el)
  if (snippet) out.snippet = snippet
  const box = look.boxOf?.(el)
  if (box) out.box = box
  return out
}

/**
 * Find an anchor's element again: target + path, verified by the snippet →
 * the snippet searched for inside the target → the stored box. Anchors
 * written before snippets existed (target + path only) resolve as they
 * always did: the path if it still exists, else the target itself.
 */
export function relocate(a: ElementAnchor, look: AnchorLookups): Located | null {
  let bases: AnchorEl[]
  if (a.target) {
    const all = look.targetsById(a.target)
    const nth = a.nth ?? 0
    bases = nth < all.length ? [all[nth], ...all.filter((_, i) => i !== nth)] : all
  } else bases = [look.root]

  let unverified: AnchorEl | null = null
  for (const base of bases) {
    const el = followPath(base, a.path)
    if (!el) continue
    if (!a.snippet || snippetMatches(el, a.snippet)) return { el, via: "path" }
    unverified ??= el
  }
  if (a.snippet) {
    for (const base of bases) {
      const el = findBySnippet(base, a.snippet)
      if (el) return { el, via: "snippet" }
    }
    // The target is gone from the page altogether: look for the words anywhere.
    if (a.target && !bases.length) {
      const el = findBySnippet(look.root, a.snippet)
      if (el) return { el, via: "snippet" }
    }
  }
  if (a.box) return { box: a.box, via: "box" }
  if (unverified) return { el: unverified, via: "path" }
  if (bases[0]) return { el: bases[0], via: a.target ? "target" : "root" }
  return null
}
