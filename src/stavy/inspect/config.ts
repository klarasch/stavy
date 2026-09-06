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

export type { InspectSettings }

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
  }
}

/** True when the workspace actually described a design system (as opposed to leaving `viewer.inspect` out). */
export function isConfigured(cfg: InspectConfig): boolean {
  return !!cfg.tokenPattern || cfg.kits.length > 0 || cfg.typeScale.length > 0
}
