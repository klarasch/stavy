/**
 * The framework half for React: DOM node → the components that rendered it,
 * with their real props.
 *
 * The easy case is a named function component: the fiber carries its name.
 * The hard case — and the one most component libraries land in — is a
 * component written as `forwardRef((props, ref) => …)`. It has no name and no
 * `displayName`, so the fiber says nothing, and the inspector ends up showing
 * whatever named primitive the library happens to wrap.
 *
 * What such a library *does* leave behind is a class on the component's root
 * node ("AcButton-module_root__1f2a3"), which it then hands down as
 * `className` to the primitive underneath. That makes the class a name with a
 * provenance question attached: *which* fiber on the way down introduced it?
 * The one that did is the component. `classesIntroducedBy` answers that from a
 * single fiber's own subtree, in O(depth), with no state carried across the
 * outward walk — see its comment for why that matters.
 */

import type { CompFrame, FrameworkAdapter, Kit } from "./types"

/* ---------------- fibers ---------------- */

/**
 * Framework and router plumbing: never a component anyone would call theirs,
 * dropped from the stack outright in both development and production builds.
 */
const HARD_EXCLUDE =
  /^(Primitive|Slot|SlotClone|Presence|Portal|FocusScope|DismissableLayer|RovingFocus|Collection|Anonymous|Suspense|Fragment|Lazy|Memo|ForwardRef|Route|Routes|Router|BrowserRouter|Navigator|Location|Outlet|RenderedRoute|StrictMode|Styled|Insertion|Tooltip|Popper|Arrow|ErrorBoundary|Unstable|Focus|Scroll|Visually)\b/

/**
 * Headless primitives a component library wraps, which do have a real fiber
 * name of their own but no identity outside the library. Only consulted when
 * the workspace has declared kits: with no kit configured there is no such
 * thing as "the kit's internals", and an app's own `Button` must not collapse.
 */
const KIT_PRIMITIVES =
  /^(Button|Input|TextField|Menu|MenuItem|Listbox|Option|Select|Switch|Slider|Tabs|Tab|Badge|Popup|Modal|Backdrop|Snackbar|ClickAwayListener|Portal)$/

/** Drop a bundler's numeric collision suffix ("Button2") before matching a name against the lists above. */
function debundled(name: string): string {
  return name.replace(/\d+$/, "")
}

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

/** Duck-typed element test — keeps every function here exercisable against fake DOM objects in unit tests. */
function looksLikeElement(x: any): x is Element {
  return !!x && typeof x === "object" && typeof x.getAttribute === "function" && "classList" in x
}

function isHostFiber(fiber: any): boolean {
  return fiber?.tag === 5 && looksLikeElement(fiber.stateNode)
}

/** First DOM node a fiber renders (depth-first through its children). */
function hostOf(fiber: any): Element | null {
  let f = fiber?.child
  while (f) {
    if (isHostFiber(f)) return f.stateNode as Element
    const inner = hostOf(f)
    if (inner) return inner
    f = f.sibling
  }
  return null
}

/* ---------------- names for anonymous components ---------------- */

/**
 * The kits of one workspace, indexed for the two questions this file asks of
 * them: which component name a stamped class encodes, and which kit a
 * component name belongs to.
 */
interface KitIndex {
  kits: Kit[]
  /** Component names encoded by the classes in a class string, added to `out`. */
  namesIn: (value: unknown, out: Set<string>) => void
  /** Kit a component name belongs to, by declared prefix or by a class seen earlier in this walk. */
  kitOf: (name: string) => string | undefined
  /** True when this class encodes `name` and names its root part (a kit stamps `…_root__hash` on the component's own node). */
  isRootClass: (cls: string, name: string) => boolean
}

export function kitIndex(kits: Kit[]): KitIndex {
  const learned = new Map<string, string>()
  const match = (cls: string): { name: string; kit: Kit; rest: string } | null => {
    for (const kit of kits) {
      const m = kit.classPattern?.exec(cls)
      if (m?.[1]) return { name: m[1], kit, rest: cls.slice(m[0].length) }
    }
    return null
  }
  return {
    kits,
    namesIn(value, out) {
      if (typeof value !== "string") return
      for (const cls of value.split(/\s+/)) {
        const m = match(cls)
        if (m) {
          out.add(m.name)
          learned.set(m.name, m.kit.name)
        }
      }
    },
    kitOf(name) {
      for (const kit of kits) if (kit.componentPrefix && name.startsWith(kit.componentPrefix)) return kit.name
      return learned.get(name)
    },
    isRootClass(cls, name) {
      const m = match(cls)
      return !!m && m.name === name && /^root\b|^root/.test(m.rest)
    },
  }
}

/**
 * The kit component names a fiber carries: for a host fiber, off its own
 * classList; for a component fiber, off any string `className`/`class` prop,
 * plus one or two levels into the prop objects libraries forward classes
 * through (`classes`, `slotProps`, `slots`). Never descends into `children` or
 * element-shaped values.
 */
function namesCarriedBy(fiber: any, idx: KitIndex): Set<string> {
  const out = new Set<string>()
  if (!fiber) return out
  if (isHostFiber(fiber)) {
    const el = fiber.stateNode as Element
    for (const cls of Array.from(el.classList as unknown as string[])) idx.namesIn(cls, out)
    return out
  }
  const props = fiber.memoizedProps
  if (!props || typeof props !== "object") return out
  idx.namesIn(props.className, out)
  idx.namesIn(props.class, out)
  const descend = (val: unknown, depth: number) => {
    if (depth <= 0 || val === null || typeof val !== "object" || Array.isArray(val) || val === props) return
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (k === "children") continue
      if (typeof v === "string") {
        if (k === "className" || k === "class") idx.namesIn(v, out)
      } else if (depth > 1) descend(v, depth - 1)
    }
  }
  for (const key of ["classes", "slotProps", "slots"]) descend((props as any)[key], 2)
  return out
}

function without<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>()
  for (const x of a) if (!b.has(x)) out.add(x)
  return out
}

/**
 * Which kit component names a fiber's own subtree introduces — computed
 * strictly from this fiber downward, never from anything seen earlier on the
 * outward walk. That restriction is the whole point: a named component that
 * happens to render a kit component first would otherwise be renamed after it,
 * and an anonymous one rendering `<><AcCard/><div><AcButton/></div></>` would
 * be labelled after whichever host happened to be leftmost.
 *
 * Walk down the leftmost child path to the first host node — by construction
 * that node is inside this fiber's own subtree. Seed the carried set with the
 * kit classes on it. Then climb back up: at each step, the names that step's
 * own props do *not* carry were introduced there, so remove them. Whatever is
 * still carried when we get back to `fiber`, minus what `fiber`'s own props
 * already carried in, is what `fiber` itself introduced — which is to say,
 * what it is.
 */
export function classesIntroducedBy(fiber: any, idx: KitIndex): Set<string> {
  const path: any[] = []
  let f = fiber?.child
  while (f && !isHostFiber(f)) {
    path.push(f)
    f = f.child
  }
  if (!f) return new Set() // renders no DOM of its own
  const carried = new Set<string>()
  const el = f.stateNode as Element
  for (const cls of Array.from(el.classList as unknown as string[])) idx.namesIn(cls, carried)
  for (let i = path.length - 1; i >= 0; i--) {
    for (const name of without(carried, namesCarriedBy(path[i], idx))) carried.delete(name)
  }
  return without(carried, namesCarriedBy(fiber, idx))
}

/** When a fiber introduces more than one name at once, the one stamped on its root node is the component itself. */
function preferRootName(introduced: Set<string>, fiber: any, idx: KitIndex): string | null {
  if (introduced.size === 0) return null
  const first = introduced.values().next().value as string
  if (introduced.size === 1) return first
  const classes: string[] = []
  if (isHostFiber(fiber)) classes.push(...Array.from((fiber.stateNode as Element).classList as unknown as string[]))
  else if (typeof fiber?.memoizedProps?.className === "string") classes.push(...fiber.memoizedProps.className.split(/\s+/))
  for (const cls of classes) for (const name of introduced) if (idx.isRootClass(cls, name)) return name
  return first
}

/** A fiber's identity: its own name when it has one from a kit, otherwise whatever its subtree says it introduced. */
function frameIdentity(fiber: any, idx: KitIndex): { name: string; kit?: string } | null {
  const own = componentName(fiber?.type)
  if (own) {
    const kit = idx.kitOf(own)
    if (kit) return { name: own, kit }
  }
  const introduced = preferRootName(classesIntroducedBy(fiber, idx), fiber, idx)
  if (introduced) return { name: introduced, kit: idx.kitOf(introduced) }
  return own ? { name: own } : null
}

/**
 * Which kit created the element this fiber renders, following `_debugOwner`
 * (development builds only). The owner is whichever component's render was
 * running when the element was created, which is not necessarily a DOM
 * ancestor: a render-prop callback runs during its caller's render but its
 * result is nested elsewhere. So resolve each owner's own kit directly instead
 * of expecting it to show up on the stack.
 */
function owningKit(fiber: any, idx: KitIndex): string | null {
  const kitOfFiber = (owner: any): string | null => {
    const own = componentName(owner?.type)
    if (own) return idx.kitOf(own) ?? null
    const picked = preferRootName(classesIntroducedBy(owner, idx), owner, idx)
    return picked ? idx.kitOf(picked) ?? null : null
  }
  let owner = fiber?._debugOwner
  for (let hops = 0; owner && hops < 20; hops++) {
    const kit = kitOfFiber(owner)
    if (kit) return kit
    owner = owner._debugOwner
  }
  return null
}

export function reactComponentStack(el: Element, stopAt: string, kits: Kit[] = []): CompFrame[] {
  const idx = kitIndex(kits)
  const collected: Array<{ fiber: any; name: string; kit?: string }> = []
  let f = fiberOf(el)
  if (isHostFiber(f)) f = f.return // the node itself is never a component frame
  while (f) {
    const id = frameIdentity(f, idx)
    if (id) {
      if (id.name === stopAt) break
      const bare = debundled(id.name)
      const excluded =
        HARD_EXCLUDE.test(bare) || /(Context|Provider|Consumer|Impl|Boundary)$/.test(bare) || id.name.startsWith("_") || id.name.includes("$")
      if (!excluded && /^[A-Z]/.test(id.name) && collected[collected.length - 1]?.name !== id.name) {
        collected.push({ fiber: f, name: id.name, kit: id.kit })
      }
    }
    f = f.return
  }

  if (kits.length === 0) {
    return collected.map((c) => ({ name: c.name, props: (c.fiber.memoizedProps ?? {}) as Record<string, unknown>, host: hostOf(c.fiber) }))
  }

  const hasOwners = collected.some((c) => c.fiber?._debugOwner)
  return collected.map((c) => {
    let internal: boolean
    if (hasOwners) {
      const owner = owningKit(c.fiber, idx)
      // A kit component rendered by the *same* kit is that kit's own business.
      // One rendered by a different kit is still something a person wrote.
      // A headless primitive has no identity outside whichever kit wraps it.
      internal = c.kit ? owner === c.kit : KIT_PRIMITIVES.test(debundled(c.name)) && owner !== null
    } else {
      // Production build, no owner chain: only the primitives heuristic is left,
      // and a kit-named frame is assumed to be user-facing rather than guessed at.
      internal = !c.kit && KIT_PRIMITIVES.test(debundled(c.name))
    }
    return {
      name: c.name,
      props: (c.fiber.memoizedProps ?? {}) as Record<string, unknown>,
      host: hostOf(c.fiber),
      internal,
      kit: c.kit,
    }
  })
}

/** The shipped framework adapter. `kitsFor` supplies the kits declared for the document being inspected. */
export function reactFramework(kitsFor: (el: Element) => Kit[]): FrameworkAdapter {
  return { componentStack: (el, stopAt) => reactComponentStack(el, stopAt, kitsFor(el)) }
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
  if (typeof node === "string" || typeof node === "number") {
    const text = String(node).replace(/\s+/g, " ").trim()
    return text ? pad + text : ""
  }
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
