/**
 * The design-system half of the seam, built from data.
 *
 * Three design systems ship, tried in order against each frame document:
 *
 * 1. whatever `viewer.inspect` in the manifest describes (a CSS-variables kit,
 *    with names for its components and its type scale),
 * 2. the utility-class preset, for kits that encode tokens in class names,
 * 3. the generic CSS-variables path, which always matches and reports computed
 *    values with the `var()` chain that produced them.
 *
 * A workspace can hold apps on different stacks; detection is per document, so
 * they coexist. Nothing here knows the name of any real design system.
 */

import type { ClassKind, ClassSource, DesignSystemAdapter, Kit, TypeMetrics, TypeScaleEntry } from "./types"
import { pixelTokens, provenanceFor, rootHasProperties, documentDeclaresToken, type TokenPatterns } from "./cssom"

/** A workspace's compiled `viewer.inspect` settings (see `./config`). */
export interface InspectConfig {
  name?: string
  kits: Kit[]
  tokenPattern: RegExp | null
  privateTokenPattern: RegExp | null
  spacingTokenPattern: RegExp | null
  typeScale: TypeScaleEntry[]
  componentAttrs: string[]
  module?: string
}

/** Properties whose value is inherited when the element does not set one itself. */
const INHERITED = new Set(["color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing"])

/* ---------------- type scale ---------------- */

const isHeadingName = (name: string) => /head|title|display/i.test(name)

/**
 * Name of the scale entry these computed metrics match: family, size and
 * weight exactly, line-height within half a pixel of the entry's (a ratio, or
 * px when the number is larger than any plausible ratio).
 *
 * Real scales collide — a small heading and a bold body line are often
 * metrically identical — so when several entries match, an `h1`–`h6` element
 * takes the heading-shaped name and everything else takes the other one.
 */
export function matchTypeScale(scale: TypeScaleEntry[], m: TypeMetrics, isHeading: boolean): string | null {
  if (m.lineHeight === null) return null // a declared scale always sets a line-height
  const family = m.family.toLowerCase()
  const hits = scale.filter((e) => {
    if (e.family.toLowerCase() !== family) return false
    if (e.size !== m.size || e.weight !== m.weight) return false
    const expected = e.lineHeight > 4 ? e.lineHeight : e.size * e.lineHeight
    return Math.abs(expected - (m.lineHeight as number)) <= 0.5 + 1e-9
  })
  if (hits.length === 0) return null
  const preferred = hits.find((e) => isHeadingName(e.name) === isHeading)
  return (preferred ?? hits[0]).name
}

/* ---------------- CSS-variables design systems ---------------- */

const spacingCache = new WeakMap<Document, { pattern: RegExp | null; tokens: Map<string, number> }>()

function spacingTokensFor(doc: Document, pattern: RegExp | null): Map<string, number> {
  const cached = spacingCache.get(doc)
  if (cached && cached.pattern === pattern) return cached.tokens
  const tokens = pixelTokens(doc, pattern)
  spacingCache.set(doc, { pattern, tokens })
  return tokens
}

/** `AcButton-module_root__1f2a3` → `AcButton/root`, so the panel shows the component, not the hash. */
function kitClassLabel(cls: string, kits: Kit[]): { label: string; kind: ClassKind; title?: string } | null {
  for (const kit of kits) {
    const m = kit.classPattern?.exec(cls)
    if (m?.[1]) {
      const local = cls.slice(m[0].length).replace(/__[^_]*$/, "")
      return { label: local ? `${m[1]}/${local}` : m[1], kind: "kit", title: cls }
    }
  }
  return null
}

/**
 * The zero-code adapter: everything the inspector needs, read out of the
 * frame's own CSSOM and the workspace's `viewer.inspect` data.
 */
export function cssVariablesDesignSystem(cfg: InspectConfig, detect?: (doc: Document) => boolean): DesignSystemAdapter {
  const patterns: TokenPatterns = { token: cfg.tokenPattern, private: cfg.privateTokenPattern }
  return {
    name: cfg.name,
    detect: detect ?? ((doc) => (cfg.tokenPattern ? documentDeclaresToken(doc, cfg.tokenPattern) : false)),
    provenance: (el, prop) => provenanceFor(el, prop, patterns, INHERITED.has(prop)),
    classSource: () => null,
    typeScaleName: (m, el) => matchTypeScale(cfg.typeScale, m, /^h[1-6]$/i.test(el.tagName)),
    spacingToken: (doc, valuePx) => {
      for (const [name, value] of spacingTokensFor(doc, cfg.spacingTokenPattern ?? cfg.tokenPattern)) if (value === valuePx) return name
      return null
    },
    classLabel: (c) => kitClassLabel(c, cfg.kits) ?? { label: c, kind: "other" },
    kits: cfg.kits,
    componentAttrs: cfg.componentAttrs,
  }
}

/** The last resort, and a perfectly good answer: computed values with the `var()` chain behind them. */
export function genericDesignSystem(cfg: InspectConfig): DesignSystemAdapter {
  return { ...cssVariablesDesignSystem(cfg), detect: () => true }
}

/* ---------------- the utility-class preset ---------------- */

/**
 * Semantic tokens of the utility-class convention the reference viewer's own
 * demo uses. They are ordinary CSS custom properties, so provenance still runs
 * through the CSSOM path — the class is extra evidence, not the mechanism.
 */
export const UTILITY_TOKEN_PATTERN =
  /^--(background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|radius|chart-\d+|sidebar)(-[\w-]+)?$/

const UTILITY_TOKEN_NAMES = new Set([
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground",
  "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border",
  "input", "ring",
])

const UTILITY_PALETTE =
  /^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$|^(white|black|transparent|current)$/

const TEXT_SIZE = /^text-(xs|sm|base|lg|xl|\d?xl|\[.+\])$/
const FONT = /^(font-(thin|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono)|leading-\S+|tracking-\S+|italic|uppercase|capitalize|tabular-nums|truncate|line-clamp-\d+)$/
const SPACE = /^-?(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|w|h|size|min-w|max-w|min-h|max-h|rounded(-\w+)?|border(-\d)?|inset|top|left|right|bottom)(-\S+)?$/

/** Which class, if any, on `className` sets a color of this kind. */
export function utilityColorClass(className: string, kind: "text" | "bg" | "border"): string | null {
  for (const c of className.split(/\s+/)) {
    const base = c.replace(/^[a-z-]+:/, "")
    const m = base.match(new RegExp(`^${kind}-(.+)$`))
    if (!m) continue
    const v = m[1].replace(/\/\d+$/, "")
    if (UTILITY_TOKEN_NAMES.has(v) || UTILITY_PALETTE.test(v) || v.startsWith("[")) return c
  }
  return null
}

/**
 * A class that really is the source of a value — matched against the classes
 * actually on the element, never guessed from the computed number. Guessing is
 * how an inspector ends up telling a CSS-modules app that its 8px padding is
 * `p-2`.
 */
const CLASS_FOR: Record<string, RegExp[]> = {
  "font-family": [/^font-(sans|serif|mono)$/],
  "font-size": [TEXT_SIZE],
  "font-weight": [/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/],
  "line-height": [/^leading-\S+$/],
  "letter-spacing": [/^tracking-\S+$/],
  // Most specific edge first: the row reports the top edge, so `py-2` beats `p-2` and `px-4` never wins.
  "padding-top": [/^pt-\S+$/, /^py-\S+$/, /^p-\S+$/],
  "margin-top": [/^-?mt-\S+$/, /^-?my-\S+$/, /^-?m-\S+$/],
  gap: [/^gap-y-\S+$/, /^gap-\S+$/],
  "border-top-left-radius": [/^rounded-(t|tl)-\S+$/, /^rounded(-[a-z0-9]+)?$/],
  "border-top-width": [/^border-t(-\d+)?$/, /^border(-\d+)?$/],
}

const COLOR_KIND: Record<string, "text" | "bg" | "border"> = {
  color: "text",
  "background-color": "bg",
  "border-top-color": "border",
}

function utilityClassSource(el: Element, prop: string): ClassSource | null {
  const kind = COLOR_KIND[prop]
  if (kind) {
    // Text color inherits, so the class that sets it may be on an ancestor.
    const stop = el.ownerDocument?.body
    let cur: Element | null = el
    while (cur && cur !== stop) {
      const cls = utilityColorClass(cur.getAttribute("class") ?? "", kind)
      if (cls) {
        const v = cls.replace(/^[a-z-]+:/, "").replace(/^(text|bg|border)-/, "").replace(/\/\d+$/, "")
        const note = UTILITY_TOKEN_NAMES.has(v) ? undefined : UTILITY_PALETTE.test(v) ? "raw palette color" : undefined
        return { cls, from: cur === el ? null : cur, note }
      }
      if (kind !== "text") break
      cur = cur.parentElement
    }
    return null
  }
  const patterns = CLASS_FOR[prop]
  if (!patterns) return null
  // A variant (hover:, md:, has-[…]:) is not the source of the resting value.
  const own = Array.from(el.classList).filter((c) => !c.includes(":"))
  for (const pattern of patterns) {
    const hit = own.find((c) => pattern.test(c))
    if (hit) return { cls: hit, from: null }
  }
  return null
}

function utilityClassKind(c: string): ClassKind {
  const base = c.replace(/^[a-z-]+:/, "").replace(/!$/, "")
  const m = base.match(/^(text|bg|border|ring|outline|fill|stroke|decoration|from|to|via)-(.+)$/)
  if (m) {
    const v = m[2].replace(/\/\d+$/, "")
    if (UTILITY_TOKEN_NAMES.has(v) || UTILITY_PALETTE.test(v) || v.startsWith("[")) return "color"
  }
  if (TEXT_SIZE.test(base) || FONT.test(base)) return "type"
  if (SPACE.test(base)) return "space"
  if (/^(flex|grid|inline|block|hidden|items-|justify-|col-|row-|self-|shrink|grow|absolute|relative|fixed|sticky|overflow|z-)/.test(base)) return "layout"
  return "other"
}

/**
 * The preset for the utility-class convention: the CSS-variables path plus the
 * class that encodes each value. Detected by the semantic custom properties
 * such a setup declares on `:root`, so an app that does not use it falls
 * through to the generic path instead of being told about classes it has none of.
 */
export function utilityClassDesignSystem(cfg: InspectConfig): DesignSystemAdapter {
  const base = cssVariablesDesignSystem({
    ...cfg,
    tokenPattern: cfg.tokenPattern ?? UTILITY_TOKEN_PATTERN,
    spacingTokenPattern: cfg.spacingTokenPattern ?? /^--spacing/,
  })
  return {
    ...base,
    detect: (doc) => rootHasProperties(doc, ["--background", "--foreground", "--primary", "--muted", "--ring"], 2),
    classSource: utilityClassSource,
    classLabel: (c) => kitClassLabel(c, cfg.kits) ?? { label: c, kind: utilityClassKind(c) },
  }
}
