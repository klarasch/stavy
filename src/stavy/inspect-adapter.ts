/**
 * Inspector adapter — the seam that makes dev-mode inspection work across
 * frameworks and design systems.
 *
 * It has two halves. The **framework** half turns a DOM node into the
 * components that rendered it; the React implementation ships. The **design
 * system** half turns a computed value into the token, class or type-scale
 * entry behind it; three implementations ship and the right one is detected
 * per frame document.
 *
 * Most design systems need no code at all: describe the kit in `viewer.inspect`
 * in the manifest and the CSS-variables path does the rest. For what data
 * cannot express, `viewer.inspect.module` names a same-origin ES module that
 * the viewer imports at startup and whose partial adapter is merged over the
 * defaults. `docs/INSPECT-ADAPTERS.md` is the recipe for both.
 */

import { appBase, manifest } from "./manifest"
import { compileInspectConfig, isConfigured, type InspectSettings } from "./inspect/config"
import { cssVariablesDesignSystem, genericDesignSystem, utilityClassDesignSystem, type InspectConfig } from "./inspect/design-system"
import { reactComponentStack } from "./inspect/react"
import type { CompFrame, DesignSystemAdapter, InspectAdapter, InspectAdapterModule, Kit } from "./inspect/types"

export type { CompFrame, DesignSystemAdapter, FrameworkAdapter, InspectAdapter, InspectAdapterModule, Provenance, TypeMetrics } from "./inspect/types"
export { frameToJsx, componentName, reactComponentStack } from "./inspect/react"
export { invalidateStyleCache, computedStyleOf, primaryFontFamily, resolveVarChain, matchedDeclarations, specificity } from "./inspect/cssom"
export { compileInspectConfig } from "./inspect/config"
export { matchTypeScale, utilityClassDesignSystem, cssVariablesDesignSystem, genericDesignSystem } from "./inspect/design-system"

/* ---------------- assembling the adapter ---------------- */

let loadedModule: InspectAdapterModule | null = null
let cached: { adapter: InspectAdapter; from: InspectSettings | undefined; withModule: InspectAdapterModule | null } | null = null

function build(): InspectAdapter {
  const settings = manifest.viewer?.inspect
  if (cached && cached.from === settings && cached.withModule === loadedModule) return cached.adapter

  const cfg: InspectConfig = compileInspectConfig(settings)
  const designSystems: DesignSystemAdapter[] = []

  if (loadedModule?.designSystem) {
    // A code adapter applies wherever the workspace's own token pattern is seen;
    // with no pattern declared it simply applies, which is what a workspace that
    // wrote a module for exactly one app wants.
    const base = cssVariablesDesignSystem(cfg, cfg.tokenPattern ? undefined : () => true)
    designSystems.push({ ...base, ...loadedModule.designSystem })
  }
  if (isConfigured(cfg)) designSystems.push(cssVariablesDesignSystem(cfg))
  designSystems.push(utilityClassDesignSystem(cfg))
  designSystems.push(genericDesignSystem(cfg))

  const framework = {
    componentStack: (el: Element, stopAt: string) => reactComponentStack(el, stopAt, kitsFor(el.ownerDocument)),
    ...loadedModule?.framework,
  }
  const adapter: InspectAdapter = { framework, designSystems }
  cached = { adapter, from: settings, withModule: loadedModule }
  dsForDoc = new WeakMap()
  return adapter
}

/** The assembled adapter for this workspace. */
export function inspectAdapter(): InspectAdapter {
  return build()
}

let dsForDoc = new WeakMap<Document, DesignSystemAdapter>()

/** Which design system styles this frame document. Detected once per document, then remembered. */
export function designSystemFor(doc: Document): DesignSystemAdapter {
  const hit = dsForDoc.get(doc)
  if (hit) return hit
  const { designSystems } = build()
  let chosen = designSystems[designSystems.length - 1]
  for (const ds of designSystems) {
    let ok = false
    try {
      ok = ds.detect(doc)
    } catch {
      ok = false
    }
    if (ok) {
      chosen = ds
      break
    }
  }
  dsForDoc.set(doc, chosen)
  return chosen
}

function kitsFor(doc: Document | null | undefined): Kit[] {
  if (!doc) return []
  try {
    return designSystemFor(doc).kits
  } catch {
    return []
  }
}

/** Components that rendered `el`, innermost first. */
export function componentStack(el: Element, stopAt = ""): CompFrame[] {
  return build().framework.componentStack(el, stopAt)
}

/* ---------------- the code adapter ---------------- */

let modulePromise: Promise<InspectAdapterModule | null> | null = null

/**
 * Import the workspace's `viewer.inspect.module`, if it declared one, and merge
 * its partial adapter over the defaults. The viewer is a static bundle served
 * next to the prototype, so a runtime `import()` of a same-origin file is the
 * only plug an adopter can reach; a cross-origin URL is refused.
 *
 * Resolves to true when the adapter changed, so the caller can re-render.
 */
export function loadInspectModule(): Promise<boolean> {
  const spec = manifest.viewer?.inspect?.module
  if (!spec) return Promise.resolve(false)
  modulePromise ??= (async () => {
    const url = spec.startsWith("/") ? `${appBase}${spec}` : spec
    try {
      if (new URL(url, location.href).origin !== location.origin) {
        console.warn(`[stavy] viewer.inspect.module must be same-origin, ignored — ${spec}`)
        return null
      }
      const mod = await import(/* @vite-ignore */ url)
      const partial = (mod.default ?? mod) as InspectAdapterModule
      if (!partial || typeof partial !== "object") {
        console.warn(`[stavy] viewer.inspect.module ${spec} has no default export shaped like an adapter, ignored`)
        return null
      }
      return partial
    } catch (err) {
      console.warn(`[stavy] viewer.inspect.module ${spec} failed to load, using the built-in adapter —`, err)
      return null
    }
  })()
  return modulePromise.then((partial) => {
    if (!partial || loadedModule === partial) return false
    loadedModule = partial
    cached = null
    dsForDoc = new WeakMap()
    return true
  })
}
