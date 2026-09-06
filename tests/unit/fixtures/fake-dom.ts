/**
 * A minimal DOM and CSSOM, hand-built.
 *
 * The viewer ships no DOM library and adds no dependency for tests, so the
 * inspector's CSSOM code is written against the parts of the platform it
 * genuinely needs — `el.matches`, `el.classList`, `el.parentElement`,
 * `rule.selectorText`, `rule.style`, `doc.styleSheets` — and this file
 * provides them. If you are writing an adapter for your own design system,
 * copy this file and `inspect-adapter.unit.ts` next to it and change the
 * fixtures; you will not need a browser to check that your tokens resolve.
 *
 * The selector matcher understands what component CSS actually contains:
 * descendant combinators, and compounds of tag / `.class` / `#id` /
 * `[attr]` / `[attr="value"]` / `:root`. Anything else throws, which is
 * exactly what a real `matches()` does with a selector it cannot parse — and
 * the code under test is expected to survive that.
 */

export interface FakeStyle {
  getPropertyValue: (prop: string) => string
  getPropertyPriority: (prop: string) => string
  length: number
  item: (i: number) => string
}

/**
 * A declaration block. Mark a property important by suffixing its value with
 * " !important", the way it is written in CSS.
 */
export function decl(props: Record<string, string>): FakeStyle {
  const clean: Record<string, string> = {}
  const priority: Record<string, string> = {}
  for (const [k, v] of Object.entries(props)) {
    const m = /^(.*?)\s*!important\s*$/.exec(v)
    clean[k] = (m ? m[1] : v).trim()
    priority[k] = m ? "important" : ""
  }
  const names = Object.keys(clean)
  return {
    getPropertyValue: (p) => clean[p] ?? "",
    getPropertyPriority: (p) => priority[p] ?? "",
    get length() {
      return names.length
    },
    item: (i) => names[i] ?? "",
  }
}

export interface FakeRule {
  selectorText?: string
  style?: FakeStyle
  cssRules?: FakeRule[]
  /** Set instead of the above to stand in for an `@import` rule. */
  styleSheet?: { cssRules: FakeRule[] }
}

/** A plain style rule, optionally with nested rules (CSS nesting: these hang off the rule itself). */
export function rule(selectorText: string, props: Record<string, string>, nested: FakeRule[] = []): FakeRule {
  return { selectorText, style: decl(props), cssRules: nested }
}

/** A grouping rule: `@media`, `@supports`, `@layer`. It has `cssRules` and no `selectorText`. */
export function group(children: FakeRule[]): FakeRule {
  return { cssRules: children }
}

/** An `@import`ed sheet. */
export function imported(children: FakeRule[]): FakeRule {
  return { styleSheet: { cssRules: children } }
}

export interface FakeElement {
  tagName: string
  classList: string[]
  id?: string
  attrs: Record<string, string>
  style: FakeStyle
  parentElement: FakeElement | null
  ownerDocument: FakeDocument
  getAttribute: (name: string) => string | null
  matches: (selector: string) => boolean
  attributes: Array<{ name: string; value: string }>
}

export interface FakeDocument {
  styleSheets: Array<{ cssRules: FakeRule[] }>
  documentElement: FakeElement | null
  body: FakeElement | null
  defaultView: null
}

export function doc(rules: FakeRule[]): FakeDocument {
  return { styleSheets: [{ cssRules: rules }], documentElement: null, body: null, defaultView: null }
}

interface ElementSpec {
  tag?: string
  class?: string
  id?: string
  attrs?: Record<string, string>
  /** Inline `style="…"`, same shape as a rule's props. */
  style?: Record<string, string>
}

/**
 * Build a chain of elements, outermost first, wired to `document`. Returns the
 * chain in the order given, so `chain[chain.length - 1]` is the innermost.
 */
export function elements(document: FakeDocument, specs: ElementSpec[]): FakeElement[] {
  const out: FakeElement[] = []
  let parent: FakeElement | null = null
  for (const spec of specs) {
    const classList = (spec.class ?? "").split(/\s+/).filter(Boolean)
    const attrs = { ...(spec.attrs ?? {}) }
    if (spec.class) attrs.class = spec.class
    if (spec.id) attrs.id = spec.id
    const el: FakeElement = {
      tagName: (spec.tag ?? "div").toUpperCase(),
      classList,
      id: spec.id,
      attrs,
      style: decl(spec.style ?? {}),
      parentElement: parent,
      ownerDocument: document,
      getAttribute: (name) => attrs[name] ?? null,
      attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
      matches: (selector) => matchesSelector(el, selector),
    }
    out.push(el)
    parent = el
  }
  if (!document.documentElement) document.documentElement = out[0] ?? null
  return out
}

const COMPOUND = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+|\[[^\]]+\]|:root)*)$/
const PART = /[.#][\w-]+|\[[^\]]+\]|:root/g

function matchesCompound(el: FakeElement, compound: string): boolean {
  const m = COMPOUND.exec(compound.trim())
  if (!m) throw new Error(`fake-dom: unsupported selector "${compound}"`)
  if (m[1] && m[1].toUpperCase() !== el.tagName) return false
  for (const part of m[2].match(PART) ?? []) {
    if (part === ":root") {
      if (el.ownerDocument.documentElement !== el) return false
    } else if (part.startsWith(".")) {
      if (!el.classList.includes(part.slice(1))) return false
    } else if (part.startsWith("#")) {
      if (el.id !== part.slice(1)) return false
    } else {
      const attr = /^\[([\w-]+)(?:([~^|$*]?=)"?([^"\]]*)"?)?\]$/.exec(part)
      if (!attr) throw new Error(`fake-dom: unsupported attribute selector "${part}"`)
      const value = el.attrs[attr[1]]
      if (value === undefined) return false
      if (attr[2] === "=" && value !== attr[3]) return false
      if (attr[2] === "*=" && !value.includes(attr[3])) return false
    }
  }
  return true
}

export function matchesSelector(el: FakeElement, selector: string): boolean {
  const compounds = selector.trim().split(/\s+/)
  if (compounds.length === 0) return false
  if (!matchesCompound(el, compounds[compounds.length - 1])) return false
  let cur: FakeElement | null = el.parentElement
  for (let i = compounds.length - 2; i >= 0; i--) {
    let found = false
    while (cur) {
      if (matchesCompound(cur, compounds[i])) {
        found = true
        cur = cur.parentElement
        break
      }
      cur = cur.parentElement
    }
    if (!found) return false
  }
  return true
}

/* ---------------- fake React fibers ---------------- */

export interface FakeFiber {
  /** 5 = host (a DOM node); anything else is a component. */
  tag: number
  type?: unknown
  memoizedProps?: Record<string, unknown>
  stateNode?: unknown
  return?: FakeFiber | null
  child?: FakeFiber | null
  sibling?: FakeFiber | null
  _debugOwner?: FakeFiber | null
}

/** A component whose render function has a real name, the easy case. */
export function named(name: string): unknown {
  const fn = () => null
  Object.defineProperty(fn, "name", { value: name })
  return fn
}

/** `forwardRef((props, ref) => …)` with no displayName — the case that has no name at all. */
export function anonymous(): unknown {
  const render = () => null
  Object.defineProperty(render, "name", { value: "" })
  return { $$typeof: Symbol.for("react.forward_ref"), render }
}

/**
 * Wire a linear fiber chain, innermost (the host) first, and hand back the DOM
 * node the inspector would be handed. `owners` are `_debugOwner` links by
 * index, which is how a development build records which render created what.
 */
export function fiberChain(fibers: FakeFiber[], owners: Array<FakeFiber | null | undefined> = []): FakeElement {
  for (let i = 0; i < fibers.length - 1; i++) {
    fibers[i].return = fibers[i + 1]
    fibers[i + 1].child = fibers[i]
  }
  fibers.forEach((f, i) => {
    if (owners[i] !== undefined) f._debugOwner = owners[i] ?? null
  })
  const el = fibers[0].stateNode as FakeElement
  ;(el as unknown as Record<string, unknown>).__reactFiber$test = fibers[0]
  return el
}

/** A DOM node with classes, detached from any document — enough for the fiber walk. */
export function node(classes: string[]): FakeElement {
  const attrs: Record<string, string> = { class: classes.join(" ") }
  return {
    tagName: "DIV",
    classList: classes,
    attrs,
    style: decl({}),
    parentElement: null,
    ownerDocument: null as unknown as FakeDocument,
    getAttribute: (name) => attrs[name] ?? null,
    attributes: [{ name: "class", value: attrs.class }],
    matches: () => false,
  }
}
