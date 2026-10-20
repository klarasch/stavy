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
import { compileInspectConfig, compilePanel, isConfigured, type InspectSettings, type PanelConfig } from "./inspect/config"
import { cssVariablesDesignSystem, genericDesignSystem, utilityClassDesignSystem, type InspectConfig } from "./inspect/design-system"
import { DEFAULT_INTERNALS, reactComponentStack } from "./inspect/react"
import { INSPECT_API_VERSION, type CompFrame, type DesignSystemAdapter, type InspectAdapter, type InspectAdapterModule, type Kit, type PanelSectionRenderer } from "./inspect/types"

export type { CompFrame, DesignSystemAdapter, FrameworkAdapter, InspectAdapter, InspectAdapterModule, Provenance, TypeMetrics, PanelSectionContext, PanelSectionRenderer, PanelSectionResult, PanelRow } from "./inspect/types"
export { INSPECT_API_VERSION } from "./inspect/types"
export { BUILTIN_SECTIONS, linksFor, kebab, compilePanel, type PanelConfig, type CopyFormat } from "./inspect/config"
export { frameToJsx, componentName, reactComponentStack } from "./inspect/react"
export { invalidateStyleCache, computedStyleOf, primaryFontFamily, resolveVarChain, matchedDeclarations, specificity } from "./inspect/cssom"
export { compileInspectConfig } from "./inspect/config"
export { matchTypeScale, utilityClassDesignSystem, cssVariablesDesignSystem, genericDesignSystem } from "./inspect/design-system"

/* ---------------- assembling the adapter ---------------- */

let loadedModule: InspectAdapterModule | null = null
let cached: { adapter: InspectAdapter; panel: PanelConfig; from: InspectSettings | undefined; withModule: InspectAdapterModule | null } | null = null

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
    componentStack: (el: Element, stopAt: string) => reactComponentStack(el, stopAt, kitsFor(el.ownerDocument), cfg.internals ?? DEFAULT_INTERNALS),
    ...loadedModule?.framework,
  }
  const adapter: InspectAdapter = { framework, designSystems }
  cached = { adapter, panel: cfg.panel ?? compilePanel(undefined), from: settings, withModule: loadedModule }
  dsForDoc = new WeakMap()
  return adapter
}

/** `viewer.inspect.panel`, compiled: which sections, hidden props, links, copy buttons. */
export function panelConfig(): PanelConfig {
  build()
  return cached!.panel
}

/** Panel sections the workspace's code adapter exports, by id (empty until the module has loaded). */
export function moduleSections(): Record<string, PanelSectionRenderer> {
  const p = loadedModule?.panel
  if (!p || typeof p !== "object") return {}
  return Object.fromEntries(Object.entries(p).filter(([, fn]) => typeof fn === "function"))
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
 * Fetch a same-origin module's source and evaluate it from a blob URL.
 *
 * Importing the URL directly would be the obvious thing, and it is wrong here:
 * an adopter serves this file out of their app's static folder, and a dev
 * server that owns the module graph refuses to serve such a file as a module
 * — loudly, with a 500 and a full-screen error overlay over the prototype.
 * Going through a blob asks the dev server for a plain file, which every
 * server can do, and behaves identically on a static host.
 *
 * The trade is that a blob URL has no base to resolve relative specifiers
 * against, so the module must be self-contained. For a file whose whole job is
 * to answer questions about one design system, that is not a real constraint —
 * and it is documented in `docs/inspect-adapter.template.js`.
 */
async function importModule(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const blob = URL.createObjectURL(new Blob([await res.text()], { type: "text/javascript" }))
  try {
    return await import(/* @vite-ignore */ blob)
  } finally {
    URL.revokeObjectURL(blob)
  }
}

/**
 * A module written against another adapter interface may still half-work; say
 * so once, loudly enough to be found, and carry on with what does load.
 * A module without `apiVersion` predates it and is read as version 1.
 */
export function checkApiVersion(spec: string, declared: unknown): boolean {
  if (declared === undefined || declared === INSPECT_API_VERSION) return true
  console.warn(
    `[stavy] viewer.inspect.module ${spec} declares apiVersion ${JSON.stringify(declared)}; this viewer implements apiVersion ${INSPECT_API_VERSION}. ` +
      "It is loaded anyway. See docs/INSPECT-ADAPTERS.md, \"Testing your adapter on a new Stavy release\"."
  )
  return false
}

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
      const mod = await importModule(url)
      const partial = (mod.default ?? mod) as InspectAdapterModule
      if (!partial || typeof partial !== "object") {
        console.warn(`[stavy] viewer.inspect.module ${spec} has no default export shaped like an adapter, ignored`)
        return null
      }
      // Either on the default export or as a named export next to it.
      checkApiVersion(spec, partial.apiVersion ?? (mod as { apiVersion?: unknown }).apiVersion)
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
