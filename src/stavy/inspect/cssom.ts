/**
 * Reading a frame's CSS the way the browser resolved it: which declaration
 * won for a property, and which design token is behind it.
 *
 * This is the kit-agnostic half of token provenance. Any design system whose
 * tokens are CSS custom properties — which is most of them, utility-class kits
 * included — gets names for its values out of this file alone; all a kit has
 * to say is which custom properties count as *its* tokens.
 *
 * Three things bite every implementation of this and are handled here:
 *
 * 1. **Cross-window.** The inspected element lives in the frame's document.
 *    `getComputedStyle` and `instanceof CSSStyleRule` must both come from the
 *    frame's own window — the host window returns empty values for another
 *    document's element, and a cross-realm `instanceof` is always false.
 * 2. **CSS nesting.** Since nesting shipped, every `CSSStyleRule` also exposes
 *    a `cssRules` list. A walker that tests `cssRules` first therefore treats
 *    every plain rule as a grouping rule and yields nothing.
 * 3. **Shorthands.** `rule.style.getPropertyValue("background-color")` is `""`
 *    when the author wrote `background: var(--surface)`, so provenance has to
 *    fall back to the shorthand that carries the value.
 */

import type { Provenance } from "./types"

/** The element's own window — never the host's (see note 1 above). */
export function windowOf(node: Element | Document): (Window & typeof globalThis) | null {
  const doc = (node as Element).ownerDocument ?? (node as Document)
  return (doc?.defaultView as (Window & typeof globalThis) | null) ?? null
}

/** Computed style read from the element's own window; null when the document has no view (detached frame). */
export function computedStyleOf(el: Element): CSSStyleDeclaration | null {
  const win = windowOf(el)
  if (!win) return null
  try {
    return win.getComputedStyle(el)
  } catch {
    return null
  }
}

/** The single family actually rendering: the first entry of a computed `font-family` stack, unquoted. */
export function primaryFontFamily(computedFontFamily: string): string {
  return (computedFontFamily || "").split(",")[0].replace(/["']/g, "").trim()
}

/* ---------------- flattening the stylesheets ---------------- */

function isStyleRule(rule: CSSRule, win: Window | null): rule is CSSStyleRule {
  const Ctor = (win as any)?.CSSStyleRule
  if (typeof Ctor === "function" && rule instanceof Ctor) return true
  // Duck-typing fallback: no window (unit tests), or a realm that hides the constructor.
  const r = rule as CSSStyleRule
  return typeof r.selectorText === "string" && !!r.style
}

function* walkRuleList(rules: ArrayLike<CSSRule> | null | undefined, win: Window | null): Generator<CSSStyleRule> {
  if (!rules) return
  for (const rule of Array.from(rules)) {
    if (isStyleRule(rule, win)) {
      yield rule
      // Nested rules come after their parent, which is also their cascade order.
      const nested = (rule as unknown as CSSGroupingRule).cssRules
      if (nested && nested.length) yield* walkRuleList(nested, win)
      continue
    }
    const imported = (rule as CSSImportRule).styleSheet
    if (imported) {
      try {
        yield* walkRuleList(imported.cssRules, win)
      } catch {
        /* cross-origin @import: unreadable */
      }
      continue
    }
    // @media, @supports, @layer, @container … — recurse, source order preserved.
    const grouped = (rule as CSSGroupingRule).cssRules
    if (grouped) yield* walkRuleList(grouped, win)
  }
}

function* allStyleRules(doc: Document): Generator<CSSStyleRule> {
  const win = windowOf(doc)
  for (const sheet of Array.from(doc.styleSheets ?? [])) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // cross-origin stylesheet
    }
    yield* walkRuleList(rules, win)
  }
}

/**
 * Flattened, source-ordered rules for a document. Cached: the inspector reads
 * this on every hover, and walking every stylesheet per mousemove is exactly
 * the kind of work that makes an inspector feel broken. The cache is rebuilt
 * when the sheet count changes, and on demand via `invalidateStyleCache` —
 * which the panel calls once per pick (a pin), never per hover.
 */
const ruleCache = new WeakMap<Document, { count: number; rules: CSSStyleRule[] }>()

export function cachedRules(doc: Document): CSSStyleRule[] {
  const cached = ruleCache.get(doc)
  const count = doc.styleSheets?.length ?? 0
  if (cached && cached.count === count) return cached.rules
  const rules = Array.from(allStyleRules(doc))
  ruleCache.set(doc, { count, rules })
  return rules
}

/**
 * Drop the cached rule list (and, with it, every element's memoised lookups —
 * each is pinned to the rule array's identity, so a fresh array misses
 * everywhere). Call once per pick, never from a per-mousemove path.
 */
export function invalidateStyleCache(doc: Document): void {
  ruleCache.delete(doc)
  rootPropsCache.delete(doc)
}

/* ---------------- the cascade, for one property on one element ---------------- */

/**
 * Specificity as (ids, classes+attributes+pseudo-classes, elements) by string
 * parsing. `:is()`/`:where()` are counted as ordinary pseudo-classes rather
 * than by their real rules, which can overcount `:where()` slightly; it never
 * underrates a real rule, and both are rare in the component CSS this reads.
 */
export function specificity(selector: string): [number, number, number] {
  let elements = 0
  let s = selector.replace(/::[a-zA-Z-]+/g, () => {
    elements++ // a pseudo-element adds to the element tally, not the pseudo-class one
    return ""
  })
  const ids = (s.match(/#[a-zA-Z0-9_-]+/g) ?? []).length
  const classy = (s.match(/\.[a-zA-Z0-9_-]+|\[[^\]]*\]|:[a-zA-Z-]+(\([^)]*\))?/g) ?? []).length
  s = s.replace(/#[a-zA-Z0-9_-]+/g, "").replace(/\.[a-zA-Z0-9_-]+|\[[^\]]*\]|:[a-zA-Z-]+(\([^)]*\))?/g, "")
  elements += (s.match(/[a-zA-Z][a-zA-Z0-9-]*/g) ?? []).length
  return [ids, classy, elements]
}

function compareSpecificity(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

export interface MatchedDecl {
  value: string
  important: boolean
  specificity: [number, number, number]
  sourceOrder: number
  inline: boolean
  /** The property the value was actually read from — the longhand, or the shorthand it fell back to */
  prop: string
  selector: string
}

/**
 * Longhand → the shorthands that may carry its value. CSSOM reports `""` for
 * the longhand when the author wrote the shorthand with a `var()` inside it.
 */
const SHORTHANDS: Record<string, string[]> = {
  color: [],
  "background-color": ["background"],
  "border-top-color": ["border-color", "border-top", "border"],
  "border-top-width": ["border-width", "border-top", "border"],
  "border-top-left-radius": ["border-radius"],
  "padding-top": ["padding"],
  "padding-right": ["padding"],
  "padding-bottom": ["padding"],
  "padding-left": ["padding"],
  "margin-top": ["margin"],
  "margin-right": ["margin"],
  "margin-bottom": ["margin"],
  "margin-left": ["margin"],
  "row-gap": ["gap"],
  "column-gap": ["gap"],
  gap: [],
  "font-size": ["font"],
  "font-weight": ["font"],
  "font-family": ["font"],
  "line-height": ["font"],
}

function declValue(style: CSSStyleDeclaration, prop: string): { value: string; prop: string } | null {
  const direct = style.getPropertyValue(prop)
  if (direct) return { value: direct, prop }
  for (const sh of SHORTHANDS[prop] ?? []) {
    const v = style.getPropertyValue(sh)
    if (v) return { value: v, prop: sh }
  }
  return null
}

/** A comma-separated selector list, split so a matching branch still counts when a sibling branch does not parse. */
function selectorBranches(selectorText: string): string[] {
  return selectorText.split(",").map((s) => s.trim()).filter(Boolean)
}

const declCache = new WeakMap<Element, { gen: CSSStyleRule[]; byProp: Map<string, MatchedDecl[]> }>()

/**
 * Every declaration of `prop` that matches `el`, in cascade order — index 0
 * won. `!important` first, then inline style, then specificity, then source
 * order. Memoised per (element, property) against the document's current rule
 * list; a `var()` chain asks for the same element and its ancestors over and
 * over within one pick.
 */
export function matchedDeclarations(el: Element, prop: string): MatchedDecl[] {
  const doc = el.ownerDocument
  const rules = doc ? cachedRules(doc) : []
  let entry = declCache.get(el)
  if (!entry || entry.gen !== rules) {
    entry = { gen: rules, byProp: new Map() }
    declCache.set(el, entry)
  }
  const cached = entry.byProp.get(prop)
  if (cached) return cached

  const out: MatchedDecl[] = []
  const inlineStyle = (el as HTMLElement).style
  const inlineDecl = inlineStyle ? declValue(inlineStyle, prop) : null
  if (inlineDecl) {
    out.push({
      value: inlineDecl.value,
      important: inlineStyle.getPropertyPriority(inlineDecl.prop) === "important",
      specificity: [0, 0, 0],
      sourceOrder: Infinity,
      inline: true,
      prop: inlineDecl.prop,
      selector: "style=",
    })
  }
  rules.forEach((rule, i) => {
    const decl = declValue(rule.style, prop)
    if (!decl) return
    for (const branch of selectorBranches(rule.selectorText)) {
      let matches = false
      try {
        matches = el.matches(branch)
      } catch {
        continue // unsupported selector (a vendor pseudo-element, a nesting `&`) — that branch only
      }
      if (!matches) continue
      out.push({
        value: decl.value,
        important: rule.style.getPropertyPriority(decl.prop) === "important",
        specificity: specificity(branch),
        sourceOrder: i,
        inline: false,
        prop: decl.prop,
        selector: branch,
      })
      break
    }
  })
  out.sort((a, b) => {
    if (a.important !== b.important) return a.important ? -1 : 1
    if (a.inline !== b.inline) return a.inline ? -1 : 1
    const sc = compareSpecificity(b.specificity, a.specificity)
    if (sc !== 0) return sc
    return b.sourceOrder - a.sourceOrder
  })
  entry.byProp.set(prop, out)
  return out
}

/* ---------------- following the var() chain to a token ---------------- */

const VAR_REF = /var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)/

export interface TokenPatterns {
  /** A custom property matching this is a design token — where the chain stops. Absent: the chain runs to its end. */
  token?: RegExp | null
  /** A custom property matching this is a private primitive: recorded, but not surfaced as a token. */
  private?: RegExp | null
}

/**
 * Resolve the winning declaration for `prop` on `el` through its `var()` chain
 * to a design token. Custom properties inherit, so a hop that is not declared
 * on the current element is looked up on its ancestors.
 *
 * With no token pattern configured there is nothing to recognise, so the walk
 * runs to the end of the chain and the last custom property — the one that
 * finally held a literal value — is reported as the token. That is the right
 * answer surprisingly often: `color ← var(--btn-fg) ← var(--x-color-text-primary)`.
 */
export function resolveVarChain(el: Element, prop: string, patterns: TokenPatterns = {}): Provenance | null {
  const decls = matchedDeclarations(el, prop)
  if (decls.length === 0) return null
  const raw = decls[0].value
  const chain: string[] = []
  let current: string | null = raw
  let cur: Element | null = el
  let last: string | null = null

  for (let hop = 0; hop < 8 && current; hop++) {
    const m = VAR_REF.exec(current)
    if (!m) break
    const varName = m[1]
    chain.push(`var(${varName})`)
    last = varName
    if (patterns.private?.test(varName)) return { token: null, chain, raw, inheritedFrom: null, note: "private token" }
    if (patterns.token?.test(varName)) return { token: varName, chain, raw, inheritedFrom: null }
    // A local variable (`--btn-fg`): find its own winning declaration here, then up the ancestors.
    let found: MatchedDecl[] = []
    let scan: Element | null = cur
    while (scan) {
      found = matchedDeclarations(scan, varName)
      if (found.length > 0) break
      scan = scan.parentElement
    }
    if (found.length === 0) break
    cur = scan
    current = found[0].value
  }
  // No pattern to recognise: the deepest custom property is the best answer available.
  if (!patterns.token && last) return { token: last, chain, raw, inheritedFrom: null }
  return { token: null, chain, raw, inheritedFrom: null }
}

/**
 * `resolveVarChain`, plus the ancestor walk for a property that is inherited
 * rather than declared here (text `color`, mostly). Returns the ancestor that
 * actually declared it in `inheritedFrom`.
 */
export function provenanceFor(el: Element, prop: string, patterns: TokenPatterns, inherits: boolean): Provenance | null {
  const own = resolveVarChain(el, prop, patterns)
  if (own && (own.token || own.chain.length > 0)) return own
  if (!inherits) return own
  let anc = el.parentElement
  const stop = el.ownerDocument?.documentElement ?? null
  while (anc) {
    const up = resolveVarChain(anc, prop, patterns)
    if (up && (up.token || up.chain.length > 0)) return { ...up, inheritedFrom: anc }
    if (anc === stop) break
    anc = anc.parentElement
  }
  return own
}

/* ---------------- custom properties declared at the document root ---------------- */

const rootPropsCache = new WeakMap<Document, Map<string, string>>()
const ROOT_SELECTOR = /(^|[\s,>+~])(:root|html)\b|^\[data-/

/**
 * Every custom property declared by a root-level rule (`:root`, `html`, a
 * `[data-theme]` block), with its declared value. Used to detect which design
 * system styles a document and to name spacing/radius values, so a kit's token
 * catalog is discovered rather than hardcoded.
 */
export function rootCustomProperties(doc: Document): Map<string, string> {
  const cached = rootPropsCache.get(doc)
  if (cached) return cached
  const out = new Map<string, string>()
  for (const rule of cachedRules(doc)) {
    if (!ROOT_SELECTOR.test(rule.selectorText)) continue
    const style = rule.style
    for (let i = 0; i < style.length; i++) {
      const prop = style.item(i)
      if (prop.startsWith("--")) out.set(prop, style.getPropertyValue(prop).trim())
    }
  }
  rootPropsCache.set(doc, out)
  return out
}

/**
 * Does this document declare a custom property matching `pattern`? The runtime
 * "is this app styled by that design system" test: the stylesheets first, then
 * the computed root style, which also catches properties set from script.
 */
export function documentDeclaresToken(doc: Document, pattern: RegExp): boolean {
  try {
    for (const name of rootCustomProperties(doc).keys()) if (pattern.test(name)) return true
    const root = doc.documentElement
    const cs = root ? computedStyleOf(root) : null
    if (cs) for (let i = 0; i < cs.length; i++) {
      const p = cs.item(i)
      if (p.startsWith("--") && pattern.test(p)) return true
    }
  } catch {
    /* unreadable document */
  }
  return false
}

/** Do these specific custom properties resolve on the document root? */
export function rootHasProperties(doc: Document, names: string[], atLeast = 1): boolean {
  try {
    const root = doc.documentElement
    const cs = root ? computedStyleOf(root) : null
    let hits = 0
    for (const n of names) {
      const fromComputed = cs?.getPropertyValue(n).trim()
      if (fromComputed) hits++
      else if (rootCustomProperties(doc).has(n)) hits++
      if (hits >= atLeast) return true
    }
  } catch {
    /* unreadable document */
  }
  return false
}

/** Custom properties matching `pattern` whose declared value is a plain pixel length: token name → px. */
export function pixelTokens(doc: Document, pattern: RegExp | null | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const [name, value] of rootCustomProperties(doc)) {
    if (pattern && !pattern.test(name)) continue
    const m = /^(-?[\d.]+)px$/.exec(value)
    if (m) out.set(name, parseFloat(m[1]))
  }
  return out
}
