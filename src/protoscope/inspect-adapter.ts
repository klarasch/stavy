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
  /** The component's own root DOM node (first host descendant) — what the inspector should outline and measure */
  host: Element | null
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

/** First DOM node a fiber renders (depth-first through its children). */
function hostOf(fiber: any): Element | null {
  let f = fiber?.child
  while (f) {
    if (f.tag === 5 && f.stateNode instanceof Element) return f.stateNode // HostComponent
    const inner = hostOf(f)
    if (inner) return inner
    f = f.sibling
  }
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
        out.push({ name, props: (f.memoizedProps ?? {}) as Record<string, unknown>, host: hostOf(f) })
      }
    }
    f = f.return
  }
  return out
}

/* ---------------- JSX serialization (what the author wrote, nested) ---------------- */

function fmtAttr(k: string, v: unknown): string | null {
  if (v === undefined || v === null || v === false) return null
  if (v === true) return k
  if (typeof v === "string") return `${k}=${JSON.stringify(v)}`
  if (typeof v === "number") return `${k}={${v}}`
  if (typeof v === "function") return `${k}={${v.name || "handler"}}`
  if (typeof v === "object" && (v as any).$$typeof) return `${k}={${elementToJsx(v, 0, 1)}}`
  try {
    const j = JSON.stringify(v)
    return `${k}={${j.length > 60 ? j.slice(0, 57) + "…}" : j}}`
  } catch {
    return `${k}={…}`
  }
}

function elementToJsx(node: unknown, indent: number, depth: number): string {
  const pad = "  ".repeat(indent)
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return pad + String(node).replace(/\s+/g, " ").trim()
  if (Array.isArray(node)) return node.map((n) => elementToJsx(n, indent, depth)).filter(Boolean).join("\n")
  const el = node as any
  if (!el.$$typeof) return pad + "{…}"
  const type = el.type
  const name = typeof type === "string" ? type : type?.$$typeof && !componentName(type) ? "" : componentName(type) ?? "Component"
  if (!name) return elementToJsx(el.props?.children, indent, depth) // Fragment: flatten
  const attrs = Object.entries(el.props ?? {})
    .filter(([k]) => k !== "children" && !k.startsWith("data-proto"))
    .map(([k, v]) => fmtAttr(k, v))
    .filter(Boolean) as string[]
  const open = `${pad}<${name}${attrs.length ? " " + attrs.join(" ") : ""}`
  const children = el.props?.children
  if (children === undefined || children === null || (Array.isArray(children) && children.length === 0)) return `${open} />`
  if (depth <= 0) return `${open}>…</${name}>`
  if (typeof children === "string" || typeof children === "number") return `${open}>${String(children).trim()}</${name}>`
  const inner = elementToJsx(children, indent + 1, depth - 1)
  return `${open}>\n${inner}\n${pad}</${name}>`
}

/** JSX for a component frame as its author wrote it: props as attributes, children nested (3 levels). */
export function frameToJsx(frame: CompFrame): string {
  const attrs = Object.entries(frame.props)
    .filter(([k]) => k !== "children" && !k.startsWith("data-proto"))
    .map(([k, v]) => fmtAttr(k, v))
    .filter(Boolean) as string[]
  const open = attrs.length <= 2 ? `<${frame.name}${attrs.length ? " " + attrs.join(" ") : ""}` : `<${frame.name}\n  ${attrs.join("\n  ")}\n`
  const ch = frame.props.children
  if (ch === undefined || ch === null || (Array.isArray(ch) && ch.length === 0)) return `${open}${attrs.length <= 2 ? " />" : "/>"}`
  if (typeof ch === "string" || typeof ch === "number") return `${open}>${String(ch).trim()}</${frame.name}>`
  return `${open}>\n${elementToJsx(ch, 1, 3)}\n</${frame.name}>`
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
