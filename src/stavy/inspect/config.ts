/**
 * `viewer.inspect` in the manifest: the zero-code way to teach the inspector a
 * design system. Data only — component prefixes, the shape of the class a kit
 * stamps on its roots, which custom properties are tokens, the type scale.
 * Compiled once, here, so a bad regex in a manifest is one warning rather than
 * an exception on every hover.
 */

import type { InspectSettings } from "../types"
import type { InspectConfig } from "./design-system"
import type { Kit, TypeScaleEntry } from "./types"
import { DEFAULT_EXCLUDE, DEFAULT_PRIMITIVES, type InternalsPatterns } from "./react"

export type { InspectSettings }

/** The built-in panel sections, in their default order. */
export const BUILTIN_SECTIONS = ["component", "props", "tokens", "type", "spacing", "classes", "accessibility", "source", "url"] as const

export type CopyFormat = "jsx" | "token" | "class"

export interface CompiledLink {
  label: string
  href: string
  match: RegExp | null
  kit?: string
}

/** `viewer.inspect.panel`, compiled. */
export interface PanelConfig {
  /** Section ids in display order, or null for the default (every built-in, then the module's own) */
  sections: string[] | null
  /** True when a prop of this name must not be shown */
  hideProp: (name: string) => boolean
  links: CompiledLink[]
  copy: Set<CopyFormat>
}

export const DEFAULT_COMPONENT_ATTRS = ["data-slot", "data-component"]

function compileRegex(source: string | undefined, where: string): RegExp | null {
  if (!source) return null
  try {
    return new RegExp(source)
  } catch (err) {
    console.warn(`[stavy] viewer.inspect.${where}: not a valid regular expression, ignored —`, source, err)
    return null
  }
}

function compileKits(input: InspectSettings["kits"]): Kit[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((k) => k && typeof k.name === "string")
    .map((k) => ({
      name: k.name,
      componentPrefix: k.componentPrefix,
      classPattern: compileRegex(k.classPattern, `kits[${JSON.stringify(k.name)}].classPattern`) ?? undefined,
    }))
}

function compileTypeScale(input: InspectSettings["typeScale"]): TypeScaleEntry[] {
  if (!Array.isArray(input)) return []
  return input.filter(
    (e): e is TypeScaleEntry =>
      !!e && typeof e.name === "string" && typeof e.family === "string" &&
      Number.isFinite(e.size) && Number.isFinite(e.weight) && Number.isFinite(e.lineHeight)
  )
}

function compilePatternList(input: unknown, where: string): RegExp[] {
  if (!Array.isArray(input)) return []
  return input.map((src, i) => (typeof src === "string" ? compileRegex(src, `${where}[${i}]`) : null)).filter((r): r is RegExp => !!r)
}

function compileInternals(input: InspectSettings["internals"]): InternalsPatterns {
  const keep = input?.keepDefaults !== false
  return {
    exclude: [...compilePatternList(keep ? DEFAULT_EXCLUDE : [], "internals.exclude"), ...compilePatternList(input?.exclude, "internals.exclude")],
    primitives: [...compilePatternList(keep ? DEFAULT_PRIMITIVES : [], "internals.primitives"), ...compilePatternList(input?.primitives, "internals.primitives")],
  }
}

/** "/^on[A-Z]/" or "/x/i" is a regex; anything else is an exact prop name. */
function compileHideProps(input: unknown): (name: string) => boolean {
  if (!Array.isArray(input) || input.length === 0) return () => false
  const exact = new Set<string>()
  const res: RegExp[] = []
  input.forEach((entry, i) => {
    if (typeof entry !== "string") return
    const m = /^\/(.*)\/([a-z]*)$/.exec(entry)
    if (!m) return void exact.add(entry)
    try {
      res.push(new RegExp(m[1], m[2]))
    } catch (err) {
      console.warn(`[stavy] viewer.inspect.panel.hideProps[${i}]: not a valid regular expression, ignored —`, entry, err)
    }
  })
  return (name) => exact.has(name) || res.some((re) => re.test(name))
}

const COPY_FORMATS: CopyFormat[] = ["jsx", "token", "class"]

export function compilePanel(input: InspectSettings["panel"]): PanelConfig {
  const sections = Array.isArray(input?.sections) ? input!.sections.filter((s): s is string => typeof s === "string") : null
  const links: CompiledLink[] = Array.isArray(input?.links)
    ? input!.links
        .filter((l) => l && typeof l.label === "string" && typeof l.href === "string")
        .map((l, i) => ({ label: l.label, href: l.href, match: compileRegex(l.match, `panel.links[${i}].match`), kit: l.kit }))
    : []
  const copy = new Set<CopyFormat>(Array.isArray(input?.copy) ? input!.copy.filter((c): c is CopyFormat => COPY_FORMATS.includes(c as CopyFormat)) : COPY_FORMATS)
  return { sections, hideProp: compileHideProps(input?.hideProps), links, copy }
}

/** Kebab-case of a component name: "AcIconButton" -> "ac-icon-button". */
export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
}

/** The links that apply to one component, with placeholders filled. A link whose placeholder has no value is left out. */
export function linksFor(panel: PanelConfig, comp: { name: string; kit?: string } | null): Array<{ label: string; href: string }> {
  if (!comp) return []
  const vars: Record<string, string | undefined> = { name: comp.name, kebab: kebab(comp.name), kit: comp.kit }
  const out: Array<{ label: string; href: string }> = []
  for (const l of panel.links) {
    if (l.kit && l.kit !== comp.kit) continue
    if (l.match && !l.match.test(comp.name)) continue
    let missing = false
    const href = l.href.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = vars[k]
      if (v === undefined) missing = true
      return encodeURIComponent(v ?? "")
    })
    if (!missing) out.push({ label: l.label, href })
  }
  return out
}

/** Compile `viewer.inspect` (or nothing at all) into what the design-system adapters read. */
export function compileInspectConfig(input: InspectSettings | undefined): InspectConfig {
  const kits = compileKits(input?.kits)
  return {
    name: kits[0]?.name,
    kits,
    tokenPattern: compileRegex(input?.tokenPattern, "tokenPattern"),
    privateTokenPattern: compileRegex(input?.privateTokenPattern, "privateTokenPattern"),
    spacingTokenPattern: compileRegex(input?.spacingTokenPattern, "spacingTokenPattern"),
    typeScale: compileTypeScale(input?.typeScale),
    componentAttrs: input?.componentAttrs?.length ? input.componentAttrs : DEFAULT_COMPONENT_ATTRS,
    module: input?.module,
    internals: compileInternals(input?.internals),
    panel: compilePanel(input?.panel),
  }
}

/** True when the workspace actually described a design system (as opposed to leaving `viewer.inspect` out). */
export function isConfigured(cfg: InspectConfig): boolean {
  return !!cfg.tokenPattern || cfg.kits.length > 0 || cfg.typeScale.length > 0
}
