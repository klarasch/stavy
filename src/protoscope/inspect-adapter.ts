/**
 * Inspector adapter — the seam that makes dev-mode inspection work across
 * frameworks and design systems. The reference adapter knows React (component
 * tree via fibers) and Tailwind/shadcn (class → token provenance). A workspace
 * on another stack replaces the parts that differ and keeps the rest.
 *
 * To customise: edit this file (or point the import in overlays/Inspector.tsx
 * at your own adapter module). The skill does this during setup.
 */

export interface CompFrame {
  name: string
  props: Record<string, unknown>
}

export interface InspectAdapter {
  /** Framework: walk outward from a DOM element and list user-land components, innermost first. */
  componentStack: (el: Element, stopAt: string) => CompFrame[]
  /** Design system: CSS-variable token names (without `--`) that colors may resolve to. */
  tokenNames: Set<string>
  /** Design system: palette class suffixes that are "raw" colors rather than tokens. */
  paletteClass: RegExp
  /** Design system: which class (if any) on an element sets text/background/border color. */
  colorClass: (className: string, kind: "text" | "bg" | "border") => string | null
  /** Attributes that mark UI-kit components in the DOM (for the kit chain). */
  componentAttrs: string[]
}

/* ---------------- React ---------------- */

const SKIP = /^(Primitive|Slot|SlotClone|Presence|Portal|FocusScope|DismissableLayer|RovingFocus|Collection|Anonymous|Suspense|Fragment|Lazy|Memo|ForwardRef|Route|Routes|Router|BrowserRouter|Navigator|Location|Outlet|RenderedRoute|StrictMode|Styled|Insertion|Tooltip|Popper|Arrow|ErrorBoundary|Unstable|Focus|Scroll|Visually)/

function fiberOf(el: Element): any {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
  return key ? (el as any)[key] : null
}

export function componentName(type: any): string | null {
  if (!type) return null
  if (typeof type === "function") return type.displayName || type.name || null
  if (typeof type === "object") return type.displayName || componentName(type.render) || componentName(type.type) || null
  return null
}

export function reactComponentStack(el: Element, stopAt: string): CompFrame[] {
  const out: CompFrame[] = []
  let f = fiberOf(el)
  while (f) {
    const name = componentName(f.type)
    if (name) {
      if (name === stopAt) break
      const internal =
        SKIP.test(name) || /(Context|Provider|Consumer|Impl|Boundary)$/.test(name) || name.startsWith("_") || name.includes("$")
      if (!internal && /^[A-Z]/.test(name) && out[out.length - 1]?.name !== name) {
        out.push({ name, props: (f.memoizedProps ?? {}) as Record<string, unknown> })
      }
    }
    f = f.return
  }
  return out
}

/* ---------------- Tailwind + shadcn tokens ---------------- */

export const SHADCN_TOKENS = new Set([
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "primary", "primary-foreground",
  "secondary", "secondary-foreground", "muted", "muted-foreground", "accent", "accent-foreground", "destructive", "border",
  "input", "ring",
])

export const TAILWIND_PALETTE =
  /^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$|^(white|black|transparent|current)$/

export function tailwindColorClass(tokens: Set<string>, palette: RegExp) {
  return (className: string, kind: "text" | "bg" | "border"): string | null => {
    for (const c of className.split(/\s+/)) {
      const base = c.replace(/^[a-z-]+:/, "")
      const m = base.match(new RegExp(`^${kind}-(.+)$`))
      if (!m) continue
      const v = m[1].replace(/\/\d+$/, "")
      if (tokens.has(v) || palette.test(v) || v.startsWith("[")) return c
    }
    return null
  }
}

/* ---------------- default adapter ---------------- */

export const adapter: InspectAdapter = {
  componentStack: reactComponentStack,
  tokenNames: SHADCN_TOKENS,
  paletteClass: TAILWIND_PALETTE,
  colorClass: tailwindColorClass(SHADCN_TOKENS, TAILWIND_PALETTE),
  componentAttrs: ["data-slot", "data-component"],
}
