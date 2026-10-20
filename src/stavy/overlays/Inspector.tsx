import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Crosshair, Copy, Check, ExternalLink, PanelLeft, PanelRight, PanelBottom } from "../icons"
import { Chip, Keys, isTyping } from "../chrome"
import type { PageDef, TemplateDef } from "../types"
import { valueLabel, dimensionLabel, appUrl, manifest, appBase, ownTargetId, STATE_DIM, stateLabel } from "../manifest"
import {
  componentStack as componentStackOf,
  designSystemFor,
  frameToJsx,
  loadInspectModule,
  computedStyleOf,
  primaryFontFamily,
  invalidateStyleCache,
  panelConfig,
  moduleSections,
  linksFor,
  BUILTIN_SECTIONS,
  type CompFrame,
  type DesignSystemAdapter,
  type PanelSectionResult,
} from "../inspect-adapter"
import { a11yRows } from "../inspect/a11y"
import { redlines, type Redline } from "../inspect/measure"
import { hostRect, withWireframeLifted, frameDoc, frameScale, frameWin } from "../frame"

/* ================================================================== */
/* Dock: where the panel lives, remembered per browser                 */
/* ================================================================== */

export type DockSide = "right" | "left" | "bottom"
export interface DockState {
  side: DockSide
  /** px, for a left/right dock */
  width: number
  /** px, for a bottom dock */
  height: number
}

const DOCK_KEY = "stavy.inspect.dock"
const DOCK_DEFAULT: DockState = { side: "right", width: 360, height: 300 }
const DOCK_MIN = { width: 280, height: 160 }

function readDock(): DockState {
  try {
    const v = JSON.parse(localStorage.getItem(DOCK_KEY) ?? "null")
    if (v && (v.side === "right" || v.side === "left" || v.side === "bottom")) return { ...DOCK_DEFAULT, ...v }
  } catch {
    /* storage blocked or garbage: defaults */
  }
  return DOCK_DEFAULT
}

function clampDock(d: DockState): DockState {
  const maxW = Math.max(DOCK_MIN.width, Math.min(760, window.innerWidth * 0.6))
  const maxH = Math.max(DOCK_MIN.height, window.innerHeight * 0.7)
  return {
    side: d.side,
    width: Math.round(Math.min(maxW, Math.max(DOCK_MIN.width, Number(d.width) || DOCK_DEFAULT.width))),
    height: Math.round(Math.min(maxH, Math.max(DOCK_MIN.height, Number(d.height) || DOCK_DEFAULT.height))),
  }
}

/** The panel's side and size, remembered in localStorage. The player reads it to make room; the panel's header and edge change it. */
export function useInspectDock(): [DockState, (patch: Partial<DockState>) => void] {
  const [dock, setDock] = useState<DockState>(() => clampDock(readDock()))
  const update = useCallback((patch: Partial<DockState>) => {
    setDock((d) => {
      const next = clampDock({ ...d, ...patch })
      try {
        localStorage.setItem(DOCK_KEY, JSON.stringify(next))
      } catch {
        /* not remembered, still applied */
      }
      return next
    })
  }, [])
  return [dock, update]
}

/* ================================================================== */
/* Selection model                                                     */
/* ================================================================== */

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface InspectContext {
  page: PageDef
  template?: TemplateDef
  dims: Record<string, string>
}

/** What the host resolved under the pointer: an element inside a prototype frame, and which instance that frame shows. */
export interface FrameHit {
  el: Element
  iframe: HTMLIFrameElement
  ctx: InspectContext
}

interface Sel {
  el: Element
  iframe: HTMLIFrameElement
  ctx: InspectContext
}

/** A pinned selection also remembers where it was, so it survives the node being replaced (HMR, a re-keyed list, a reload). */
interface Pin extends Sel {
  path: number[]
  tag: string
}

function elementLabel(el: Element) {
  const cls = Array.from(el.classList)
    .filter((c) => !c.includes("[") && !c.includes(":"))
    .slice(0, 2)
    .join(".")
  return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}>`
}

function crumbLabel(el: Element) {
  return ownTargetId(el) ?? el.tagName.toLowerCase() + (el.classList[0] && !/[[:]/.test(el.classList[0]) ? "." + el.classList[0] : "")
}

/**
 * A plain-text pointer to one element, for pasting into a chat with an agent:
 * which screen and state, the app URL that renders it, the nearest target id
 * and the path from it, the text it shows, and the components it sits in —
 * enough for the agent to open the state and grep its way to the code.
 */
export function elementReference(el: Element, ctx: { page: { id: string; label: string; states?: { id: string }[] } & Parameters<typeof appUrl>[0]; dims: Record<string, string> }, stack: CompFrame[]): string {
  const page = ctx.page
  const stateId = ctx.dims[STATE_DIM]
  const state = stateId
    ? `${stateLabel(page, stateId)} (${page.id}/${stateId})`
    : Object.entries(ctx.dims).map(([d, v]) => `${dimensionLabel(d)}: ${valueLabel(d, v)}`).join(", ") || "default"
  // Nearest element carrying a target id, and the CSS-ish steps from it down to `el`.
  let anchor: Element | null = el
  while (anchor && !ownTargetId(anchor)) anchor = anchor.parentElement
  const steps: string[] = []
  for (let cur: Element | null = el; cur && cur !== anchor; cur = cur.parentElement) {
    const parent: Element | null = cur.parentElement
    const same = parent ? [...parent.children].filter((c) => c.tagName === cur!.tagName) : []
    steps.unshift(cur.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(cur) + 1})` : ""))
    if (!parent || parent.tagName === "BODY") break
  }
  const where = anchor ? `[data-proto="${ownTargetId(anchor)}"]${steps.length ? " › " + steps.join(" › ") : ""}` : steps.join(" › ")
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim()
  const comps = stack.filter((c) => !c.internal).slice(0, 3).map((c) => c.name)
  return [
    `Stavy reference — ${page.label} · ${state}`,
    `App URL: ${appUrl(page as Parameters<typeof appUrl>[0], ctx.dims)}`,
    `Element: ${where}${text ? ` — "${text.length > 80 ? text.slice(0, 77) + "…" : text}"` : ""}`,
    comps.length ? `Component: ${comps.join(" in ")}` : null,
    `Viewer: ${location.href}`,
  ]
    .filter(Boolean)
    .join("\n")
}

/** Child indices from the document element down to `el`. */
function elementPath(el: Element): number[] {
  const path: number[] = []
  let cur: Element = el
  while (cur.parentElement) {
    path.unshift(Array.prototype.indexOf.call(cur.parentElement.children, cur))
    cur = cur.parentElement
  }
  return path
}

function resolvePath(doc: Document, path: number[], tag: string): Element | null {
  let cur: Element | null = doc.documentElement
  for (const i of path) {
    cur = cur?.children[i] ?? null
    if (!cur) return null
  }
  return cur && cur.tagName === tag ? cur : null
}

function pinOf(sel: Sel): Pin {
  return { ...sel, path: elementPath(sel.el), tag: sel.el.tagName }
}

/** Nearest semantic target (`data-proto`) at or above an element. */
function protoTargetOf(el: Element): { el: Element; id: string; meta: Record<string, unknown> | null } | null {
  const stop = el.ownerDocument.body
  let cur: Element | null = el
  while (cur && cur !== stop) {
    const id = ownTargetId(cur)
    if (id) {
      let meta: Record<string, unknown> | null = null
      try {
        meta = JSON.parse(cur.getAttribute("data-proto-meta") ?? "null")
      } catch {
        meta = null
      }
      return { el: cur, id, meta }
    }
    cur = cur.parentElement
  }
  return null
}

/* ---- copy provenance: which catalog key produced this element's text ---- */
/* The catalog is optional: `manifest.strings` is a URL the prototype serves. */
let copyIndex: Map<string, { key: string; locale: string }> | null = null
let copyLoading: Promise<void> | null = null
function loadCopyCatalog(onReady: () => void) {
  if (copyIndex || !manifest.strings) return
  copyLoading ??= fetch(manifest.strings.startsWith("/") ? `${appBase}${manifest.strings}` : manifest.strings)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((catalog: Record<string, Record<string, string>>) => {
      copyIndex = new Map()
      for (const [locale, table] of Object.entries(catalog)) for (const [key, text] of Object.entries(table)) {
        const t = String(text).replace(/\s+/g, " ").trim()
        if (t && !copyIndex.has(t)) copyIndex.set(t, { key, locale })
      }
      onReady()
    })
}
function copyKeyFor(el: Element): { key: string; locale: string } | null {
  if (!copyIndex || copyIndex.size === 0) return null
  // Own text first (direct text nodes), then the whole subtree for small elements.
  const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").replace(/\s+/g, " ").trim()
  const all = (el.textContent ?? "").replace(/\s+/g, " ").trim()
  return copyIndex.get(own) ?? (all.length <= 140 ? copyIndex.get(all) ?? null : null)
}

/* ================================================================== */
/* Style provenance: classes, tokens, computed values                   */
/* ================================================================== */

/* ---- color parsing: Chrome reports computed colors as oklch/rgb/color(srgb) ---- */
function clamp01(x: number) {
  return Math.min(1, Math.max(0, x))
}
function toHexByte(x: number) {
  return Math.round(clamp01(x) * 255).toString(16).padStart(2, "0")
}
function gamma(c: number) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}
function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}
function cssColorToHex(str: string): { hex: string; alpha: number } | null {
  if (!str || str === "transparent" || str === "rgba(0, 0, 0, 0)") return null
  let m = str.match(/^oklch\(([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\)$/)
  if (m) {
    let L = parseFloat(m[1])
    if (str.includes("%")) L = L / 100
    const [r, g, b] = oklchToRgb(L, parseFloat(m[2]), parseFloat(m[3]))
    const alpha = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1
    return { hex: `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`, alpha }
  }
  m = str.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat)
    const [r, g, b] = parts
    const alpha = parts[3] ?? 1
    return { hex: `#${toHexByte(r / 255)}${toHexByte(g / 255)}${toHexByte(b / 255)}`, alpha }
  }
  m = str.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/)
  if (m) return { hex: `#${toHexByte(+m[1])}${toHexByte(+m[2])}${toHexByte(+m[3])}`, alpha: m[4] ? +m[4] : 1 }
  return { hex: str, alpha: 1 }
}

const px = (v: string) => Math.round(parseFloat(v || "0") * 100) / 100

/** The four sides of a box as CSS writes them: one value, two, or four. */
function boxShorthand(cs: CSSStyleDeclaration, prop: "padding" | "margin"): { value: string; top: number } | null {
  const t = px(cs.getPropertyValue(`${prop}-top`)), r = px(cs.getPropertyValue(`${prop}-right`))
  const b = px(cs.getPropertyValue(`${prop}-bottom`)), l = px(cs.getPropertyValue(`${prop}-left`))
  if ([t, r, b, l].every((n) => n === 0)) return null
  const value = t === r && r === b && b === l ? `${t}px` : t === b && l === r ? `${t}px ${r}px` : `${t}px ${r}px ${b}px ${l}px`
  return { value, top: t }
}

interface StyleRow {
  k: string
  v: string
  token?: string
  swatch?: string
  note?: string
}

/**
 * Read computed style with the wireframe stylesheet temporarily lifted, so
 * values describe the design and not the filter over it.
 *
 * `getComputedStyle` must come from the element's *own* window: asking the
 * host window about an element in the frame's document returns empty strings
 * for everything, which is how an inspector ends up reporting no styles at all.
 */
function computedWithoutWireframe(el: Element): { cs: CSSStyleDeclaration | null; wireframed: boolean } {
  const doc = el.ownerDocument
  const { value, lifted } = withWireframeLifted(doc, () => {
    const snapshot = computedStyleOf(el)
    if (!snapshot) return null
    // Copy the properties we read before the stylesheet comes back (the declaration is live).
    const keys = ["fontSize", "lineHeight", "fontFamily", "fontWeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "marginTop", "marginRight", "marginBottom", "marginLeft", "gap", "borderTopLeftRadius", "borderTopWidth", "borderTopStyle", "width", "height",
      "color", "backgroundColor", "borderTopColor"] as const
    const copy: Record<string, string> = {}
    for (const k of keys) copy[k] = snapshot[k as keyof CSSStyleDeclaration] as string
    for (const k of ["padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left"])
      copy[k] = snapshot.getPropertyValue(k)
    return { ...copy, getPropertyValue: (k: string) => copy[k] ?? "" } as unknown as CSSStyleDeclaration
  })
  return { cs: value, wireframed: lifted }
}

/**
 * Resolved styles with provenance, for whichever design system styles this
 * document. Every name shown here is evidence, never a guess: a token comes
 * from following the winning declaration's `var()` chain through the frame's
 * CSSOM, and a class is only named when that class is actually on the element.
 */
function stylesFor(el: Element, ds: DesignSystemAdapter) {
  const { cs, wireframed } = computedWithoutWireframe(el)
  if (!cs) return null
  const doc = el.ownerDocument

  const prov = (prop: string) => {
    try {
      return ds.provenance(el, prop)
    } catch {
      return null
    }
  }
  const cls = (prop: string) => {
    try {
      return ds.classSource(el, prop)
    } catch {
      return null
    }
  }
  /** The token/class behind one property, and the chain that got us there. */
  const source = (prop: string) => {
    const p = prov(prop)
    const c = cls(prop)
    const notes: string[] = []
    const from = p?.inheritedFrom ?? c?.from ?? null
    if (from) notes.push(`inherited from ${elementLabel(from)}`)
    if (p?.chain.length) notes.push([prop, ...p.chain].join(" ← "))
    if (p?.note) notes.push(p.note)
    if (c?.note) notes.push(c.note)
    const fallback = p?.chain.length ? p.chain[p.chain.length - 1].replace(/^var\(|\)$/g, "") : undefined
    return { token: c?.cls ?? p?.token ?? fallback, note: notes.length ? notes.join(" · ") : undefined }
  }

  const size = px(cs.fontSize)
  const lhPx = cs.lineHeight === "normal" ? null : px(cs.lineHeight)
  const family = primaryFontFamily(cs.fontFamily)
  const weight = parseInt(cs.fontWeight, 10)
  const type: StyleRow[] = [
    { k: "font", v: family, ...source("font-family") },
    { k: "size / line", v: `${size}px / ${lhPx === null ? "normal" : `${lhPx}px`}`, ...source("font-size") },
    { k: "weight", v: cs.fontWeight, ...source("font-weight") },
  ]
  let scale: string | null = null
  try {
    scale = ds.typeScaleName({ family, size, weight, lineHeight: lhPx }, el)
  } catch {
    scale = null
  }
  if (scale) type.push({ k: "scale", v: scale })
  if (cs.letterSpacing !== "normal") type.push({ k: "tracking", v: cs.letterSpacing, ...source("letter-spacing") })

  /** A spacing name: the token behind the declaration, the class that set it, or a token of the same size. */
  const spaceSource = (prop: string, valuePx: number) => {
    const s = source(prop)
    if (s.token) return s
    try {
      const t = ds.spacingToken(doc, valuePx)
      if (t) return { token: t, note: undefined as string | undefined }
    } catch {
      /* no scale to match against */
    }
    return s
  }

  const space: StyleRow[] = []
  const pad = boxShorthand(cs, "padding")
  if (pad) space.push({ k: "padding", v: pad.value, ...spaceSource("padding-top", pad.top) })
  const mar = boxShorthand(cs, "margin")
  if (mar) space.push({ k: "margin", v: mar.value, ...spaceSource("margin-top", mar.top) })
  const gap = px(cs.gap || "0")
  if (gap > 0) space.push({ k: "gap", v: `${gap}px`, ...spaceSource("gap", gap) })
  const radius = px(cs.borderTopLeftRadius)
  if (radius > 0) space.push({ k: "radius", v: `${radius}px`, ...spaceSource("border-top-left-radius", radius) })
  const bw = px(cs.borderTopWidth)
  if (bw > 0) space.push({ k: "border", v: `${bw}px ${cs.borderTopStyle}`, ...spaceSource("border-top-width", bw) })
  space.push({ k: "size", v: `${px(cs.width)} × ${px(cs.height)}` })

  const color: StyleRow[] = []
  const add = (k: string, raw: string, prop: string) => {
    const parsed = cssColorToHex(raw)
    if (!parsed) return
    color.push({
      k,
      v: parsed.alpha < 1 ? `${parsed.hex} ${Math.round(parsed.alpha * 100)}%` : parsed.hex,
      swatch: raw,
      ...source(prop),
    })
  }
  add("text", cs.color, "color")
  add("background", cs.backgroundColor, "background-color")
  if (bw > 0) add("border", cs.borderTopColor, "border-top-color")
  return { type, space, color, wireframed }
}

/* ================================================================== */

function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="ps-copy"
      onClick={() => {
        navigator.clipboard?.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />} {done ? "copied" : label}
    </button>
  )
}

/** A prop value as one short line for the props table. */
function fmtValue(v: unknown): string {
  if (v === undefined) return "undefined"
  if (v === null) return "null"
  if (typeof v === "string") return JSON.stringify(v.length > 80 ? v.slice(0, 77) + "…" : v)
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (typeof v === "function") return `ƒ ${v.name || "handler"}`
  if (typeof v === "object" && (v as { $$typeof?: unknown }).$$typeof) {
    const t = (v as { type?: unknown }).type
    const name = typeof t === "string" ? t : (t as { displayName?: string; name?: string } | undefined)?.displayName ?? (t as { name?: string } | undefined)?.name ?? "Element"
    return `<${name} />`
  }
  try {
    const j = JSON.stringify(v)
    return j.length > 80 ? j.slice(0, 77) + "…" : j
  } catch {
    return "{…}"
  }
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)

function round(r: Rect): Rect {
  return { left: Math.round(r.left * 10) / 10, top: Math.round(r.top * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 }
}

function clipOf(iframe: HTMLIFrameElement): Rect | null {
  if (!iframe.isConnected) return null
  const r = iframe.getBoundingClientRect()
  return r.width && r.height ? round({ left: r.left, top: r.top, width: r.width, height: r.height }) : null
}

function rectIn(el: Element | null, iframe: HTMLIFrameElement | undefined): Rect | null {
  if (!el || !iframe || !el.isConnected || el.ownerDocument !== frameDoc(iframe)) return null
  return round(hostRect(el, iframe))
}

interface Geo {
  hover: Rect | null
  hoverClip: Rect | null
  pin: Rect | null
  pinClip: Rect | null
  /** Rendered scale of the hovered frame: host px per prototype px */
  k: number
}
const NO_GEO: Geo = { hover: null, hoverClip: null, pin: null, pinClip: null, k: 1 }

/** Placement of the panel: docked into a slot the host reserved (the player), or as an overlay on the window edge (canvas). */
export type InspectPlacement = "docked" | "overlay"

/**
 * Dev-mode inspection of the prototype *through* its frame. The host (player
 * or canvas) owns the pointer surface — a shield over the frame — and resolves
 * each pointer event to an element inside a frame via `hit`. The inspector
 * never touches the prototype's code: component names come from React fibers
 * on the frame's DOM nodes, styles from the frame's own window.
 *
 * Hover draws an outline and a small tag (component, size) at the element;
 * every detail is in the panel. A click pins exactly the hovered element; the
 * pin follows the element through scroll, resize and re-renders (re-resolved
 * by its position in the tree when the node is replaced), and holds until Esc.
 */
export function Inspector({
  host,
  hit,
  onClose,
  onPinChange,
  placement = "overlay",
  slot,
  dock: dockProp,
  onDock,
}: {
  /** Element that receives pointer events for inspection (a shield over the frame, or the canvas viewport) */
  host: HTMLElement
  /** Resolve a pointer event to an element inside a prototype frame; null when nothing inspectable is under it */
  hit: (e: MouseEvent) => FrameHit | null
  onClose: () => void
  /** The host may keep a frame alive while a selection is pinned to it */
  onPinChange?: (pinnedIframe: HTMLIFrameElement | null) => void
  placement?: InspectPlacement
  /** For `docked`: the element the host reserved for the panel */
  slot?: HTMLElement | null
  /** For a host that lays itself out around the panel: its dock state, and how to change it */
  dock?: DockState
  onDock?: (patch: Partial<DockState>) => void
}) {
  const [ownDock, setOwnDock] = useInspectDock()
  const dock = dockProp ?? ownDock
  const setDock = onDock ?? setOwnDock

  const [hover, setHover] = useState<Sel | null>(null)
  const [pinned, setPinned] = useState<(Pin & { href: string | null }) | null>(null)
  const [compIdx, setCompIdx] = useState<number | null>(null)
  const [internalsOpen, setInternalsOpen] = useState(false)
  const [geo, setGeo] = useState<Geo>(NO_GEO)
  const [, bump] = useState(0)

  useEffect(() => loadCopyCatalog(() => bump((n) => n + 1)), [])
  // A workspace may ship a code adapter; it lands after the first render, so re-render when it does.
  useEffect(() => {
    let live = true
    loadInspectModule().then((changed) => {
      if (changed && live) bump((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => onPinChange?.(pinned?.iframe ?? null), [pinned?.iframe, onPinChange])

  const pinRef = useRef(pinned)
  pinRef.current = pinned
  const hoverRef = useRef(hover)
  hoverRef.current = hover
  /** Walking down with ↓ retraces the way ↑ came up. */
  const trail = useRef<Element[]>([])

  const pin = useCallback((sel: Sel) => {
    // Once per pick, never per hover: rebuild this frame's flattened stylesheets
    // so provenance for the pinned selection reflects the document as it is now.
    const doc = frameDoc(sel.iframe)
    if (doc) invalidateStyleCache(doc)
    const next = { ...pinOf(sel), href: frameWin(sel.iframe)?.location.href ?? null }
    pinRef.current = next
    setPinned(next)
    setCompIdx(null)
    setInternalsOpen(false)
  }, [])

  /* ---- pointer: hover tags, click pins exactly what is hovered ---- */
  useEffect(() => {
    const pick = (e: MouseEvent): Sel | null => {
      // Viewer UI (pins, notes, tour cards, comment bubbles, area titles…) is never a subject of inspection.
      if (e.target instanceof Element && e.target.closest("[data-ps-ui]")) return null
      return hit(e)
    }
    const onMove = (e: MouseEvent) => {
      const p = pick(e)
      setHover((prev) => (prev?.el === p?.el && prev?.iframe === p?.iframe ? prev : p))
    }
    const onLeave = () => setHover(null)
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-ps-ui]")) return
      // Exactly what the tag and outline show, when the click lands on it — a
      // host that captures the pointer (canvas pan) may retarget the click
      // event itself away from the card it happened over.
      const h = hoverRef.current
      const hr = h && h.el.isConnected ? hostRect(h.el, h.iframe) : null
      const onHovered = !!hr && e.clientX >= hr.left && e.clientX <= hr.left + hr.width && e.clientY >= hr.top && e.clientY <= hr.top + hr.height
      const p = onHovered ? h : pick(e)
      if (!p) return
      // Inspecting is reading: the click is the inspector's, never the app's.
      e.preventDefault()
      e.stopPropagation()
      trail.current = []
      pin(p)
    }
    host.addEventListener("mousemove", onMove)
    host.addEventListener("mouseleave", onLeave)
    host.addEventListener("click", onClick, { capture: true })
    return () => {
      host.removeEventListener("mousemove", onMove)
      host.removeEventListener("mouseleave", onLeave)
      host.removeEventListener("click", onClick, { capture: true })
    }
  }, [host, hit, pin])

  /* ---- keyboard: Esc unpins, arrows walk the tree ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = pinRef.current
      if (!p || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const consume = () => {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      if (e.key === "Escape") {
        consume()
        setPinned(null)
        pinRef.current = null
        return
      }
      const el = p.el
      let next: Element | null = null
      if (e.key === "ArrowUp") {
        const parent = el.parentElement
        if (parent && parent !== el.ownerDocument.documentElement) {
          trail.current.push(el)
          next = parent
        }
      } else if (e.key === "ArrowDown") {
        const back = trail.current[trail.current.length - 1]
        if (back && back.parentElement === el) next = trail.current.pop()!
        else {
          trail.current = []
          next = el.firstElementChild
        }
      } else if (e.key === "ArrowLeft") next = el.previousElementSibling
      else if (e.key === "ArrowRight") next = el.nextElementSibling
      else return
      consume()
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") trail.current = []
      if (next) {
        const keepTrail = trail.current
        pin({ el: next, iframe: p.iframe, ctx: p.ctx })
        trail.current = keepTrail
      }
    }
    // Capture on the window: ahead of the host's own hotkeys (Esc closes inspect, arrows drive tours).
    window.addEventListener("keydown", onKey, { capture: true })
    return () => window.removeEventListener("keydown", onKey, { capture: true })
  }, [pin])

  /* ---- what the panel describes ---- */
  const focusSel: Sel | null = pinned ?? hover
  const focusEl = focusSel?.el ?? null
  const stack = useMemo<CompFrame[]>(() => (focusEl ? componentStackOf(focusEl) : []), [focusEl])
  const internalCount = stack.filter((c) => c.internal).length
  // A design system's own internals are rarely what you meant to inspect first.
  const compIdxResolved = compIdx ?? Math.max(0, stack.findIndex((c) => !c.internal))
  const comp = stack[Math.min(compIdxResolved, Math.max(0, stack.length - 1))] as CompFrame | undefined
  // Choosing a parent component re-targets the outline, element and styles to
  // that component's own root node — not the node that was clicked.
  const subject: Element | null = compIdxResolved > 0 && comp?.host ? comp.host : focusEl
  const subjectRef = useRef(subject)
  subjectRef.current = pinned ? subject : null

  const hoverName = useMemo(() => {
    if (!hover) return null
    const s = componentStackOf(hover.el)
    return (s.find((c) => !c.internal) ?? s[0])?.name ?? null
  }, [hover])

  /* ---- geometry: follows scroll, resize and re-renders every frame ---- */
  useEffect(() => {
    let raf = 0
    let last = NO_GEO
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = pinRef.current
      if (p && (!p.el.isConnected || p.el.ownerDocument !== frameDoc(p.iframe))) {
        const doc = frameDoc(p.iframe)
        const href = frameWin(p.iframe)?.location.href ?? null
        if (doc && href && p.href && href !== p.href) {
          // The frame moved on to another state: the pin no longer means anything.
          pinRef.current = null
          setPinned(null)
        } else if (doc) {
          const el = resolvePath(doc, p.path, p.tag)
          if (el) {
            invalidateStyleCache(doc)
            const next = { ...p, el }
            pinRef.current = next
            setPinned(next)
          }
        }
      }
      const h = hoverRef.current
      const pinEl = subjectRef.current ?? pinRef.current?.el ?? null
      const g: Geo = {
        hover: h ? rectIn(h.el, h.iframe) : null,
        hoverClip: h ? clipOf(h.iframe) : null,
        pin: rectIn(pinEl, pinRef.current?.iframe),
        pinClip: pinRef.current ? clipOf(pinRef.current.iframe) : null,
        k: h ? Math.round(frameScale(h.iframe) * 1000) / 1000 || 1 : 1,
      }
      if (!sameRect(g.hover, last.hover) || !sameRect(g.pin, last.pin) || !sameRect(g.hoverClip, last.hoverClip) || !sameRect(g.pinClip, last.pinClip) || g.k !== last.k) {
        last = g
        setGeo(g)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const ctx = focusSel?.ctx ?? null
  const panel = panelConfig()
  const ds = useMemo(() => (subject?.ownerDocument ? designSystemFor(subject.ownerDocument) : null), [subject])
  const styles = useMemo(() => (subject && ds && subject.isConnected ? stylesFor(subject, ds) : null), [subject, ds])
  const classes = subject ? Array.from(subject.classList) : []
  const copyKey = subject ? copyKeyFor(subject) : null
  const target = subject ? protoTargetOf(subject) : null
  const attrs = subject
    ? Array.from(subject.attributes).filter((a) => /^(data-(?!proto)|href$|type$|id$|name$|placeholder$)/.test(a.name))
    : []
  const shownProps = useMemo(
    () => (comp ? Object.fromEntries(Object.entries(comp.props).filter(([k]) => k !== "children" && !k.startsWith("data-proto") && !panel.hideProp(k))) : {}),
    [comp, panel]
  )
  const jsx = comp ? frameToJsx({ ...comp, props: { ...shownProps, ...(comp.props.children !== undefined ? { children: comp.props.children } : {}) } }) : ""
  const links = linksFor(panel, comp ?? null)
  const extra = moduleSections()

  // Hovering something else while pinned: redlines between the two.
  const lines: Redline[] =
    pinned && hover && hover.iframe === pinned.iframe && hover.el !== subject && geo.pin && geo.hover ? redlines(geo.pin, geo.hover, geo.k) : []

  const Section = ({ id, title, children, right }: { id: string; title: string; children: React.ReactNode; right?: React.ReactNode }) => (
    <div data-section={id}>
      <div className="flex items-center mb-1.5 gap-2">
        <span className="text-[10.5px] uppercase tracking-wider" style={{ color: "var(--ps-faint)" }}>{title}</span>
        <span className="ml-auto flex gap-1">{right}</span>
      </div>
      {children}
    </div>
  )
  const Rows = ({ rows, copyTokens }: { rows: StyleRow[]; copyTokens?: boolean }) => (
    <dl className="ps-kv">
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <dt>{r.k}</dt>
          <dd className="ps-mono">
            {r.swatch && <span className="ps-swatch" style={{ background: r.swatch }} />}
            {r.v}
            {r.token && <span className="ml-1.5" style={{ color: "var(--ps-focus)" }}>{r.token}</span>}
            {r.token && copyTokens && panel.copy.has("token") && <span className="ml-1.5"><CopyButton text={r.token} label="copy" /></span>}
            {r.note && <span className="ml-1.5" style={{ color: "var(--ps-muted)" }}>{r.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )

  /* ---- sections, each a function so the workspace can order and drop them ---- */
  const builtin: Record<string, () => React.ReactNode> = {
    component: () =>
      focusEl && (
        <Section id="component" title="Component" right={comp && panel.copy.has("jsx") ? <CopyButton text={jsx} label="copy JSX" /> : null}>
          {stack.length === 0 ? (
            <span style={{ color: "var(--ps-muted)" }}>No React component found for this element.</span>
          ) : (
            <>
              <div className="ps-comp-stack mb-2">
                {stack.map((c, i) =>
                  c.internal && !internalsOpen ? null : (
                    <span key={i} className="contents">
                      {i > 0 && <span style={{ color: "var(--ps-faint)" }}>‹</span>}
                      <button
                        className="ps-crumb"
                        data-on={i === compIdxResolved ? "true" : undefined}
                        data-internal={c.internal ? "true" : undefined}
                        title={c.internal ? `${c.name} — internal to ${c.kit ?? "the design system"}` : undefined}
                        onClick={() => setCompIdx(i)}
                      >
                        {c.name}
                      </button>
                    </span>
                  )
                )}
                {internalCount > 0 && (
                  <span className="contents">
                    <span style={{ color: "var(--ps-faint)" }}>‹</span>
                    <button
                      className="ps-crumb ps-crumb-muted"
                      onClick={() => setInternalsOpen(!internalsOpen)}
                      title={internalsOpen ? "Hide the design system's own components" : "Show the design system's own components"}
                    >
                      {internalsOpen ? "hide internals" : `+${internalCount} internals`}
                    </button>
                  </span>
                )}
              </div>
              {links.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {links.map((l) => (
                    <a key={l.label + l.href} className="ps-copy ps-inspect-link" href={l.href} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3" /> {l.label}
                    </a>
                  ))}
                </div>
              )}
              {comp && (
                <pre className="rounded-lg p-2.5 ps-mono text-[11.5px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--ps-hover)", margin: 0 }}>
                  {jsx}
                </pre>
              )}
            </>
          )}
        </Section>
      ),
    props: () =>
      comp &&
      Object.keys(shownProps).length > 0 && (
        <Section id="props" title={`Props of ${comp.name}`}>
          <dl className="ps-props">
            {Object.entries(shownProps).map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{k}</dt>
                <dd>{fmtValue(v)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ),
    tokens: () =>
      styles &&
      styles.color.length > 0 && (
        <Section id="tokens" title="Color: value, and where it comes from">
          <Rows rows={styles.color} copyTokens />
        </Section>
      ),
    type: () =>
      styles && (
        <Section id="type" title="Type">
          <Rows rows={styles.type} copyTokens />
        </Section>
      ),
    spacing: () =>
      styles && (
        <Section id="spacing" title="Spacing & shape">
          <Rows rows={styles.space} copyTokens />
        </Section>
      ),
    classes: () =>
      subject && (
        <Section
          id="classes"
          title={`Element <${subject.tagName.toLowerCase()}>${compIdxResolved > 0 && comp?.host ? ` (root of ${comp.name})` : ""}`}
          right={classes.length > 0 && panel.copy.has("class") ? <CopyButton text={classes.join(" ")} label="copy classes" /> : null}
        >
          {classes.length > 0 ? (
            <div className="ps-classes">
              {classes.map((c) => {
                const { label, kind, title } = ds ? ds.classLabel(c) : { label: c, kind: "other" as const, title: undefined }
                return (
                  <span key={c} data-kind={kind} title={title}>
                    {label}
                  </span>
                )
              })}
            </div>
          ) : (
            <span style={{ color: "var(--ps-muted)" }}>no classes</span>
          )}
          {attrs.length > 0 && (
            <dl className="ps-props mt-2">
              {attrs.map((a) => (
                <div key={a.name} className="contents">
                  <dt>{a.name}</dt>
                  <dd>{a.value || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
      ),
    accessibility: () =>
      subject && (
        <Section id="accessibility" title="Accessibility">
          <dl className="ps-kv">
            {a11yRows(subject).map((r) => (
              <div key={r.k} className="contents">
                <dt>{r.k}</dt>
                <dd className="ps-mono" data-missing={r.v === "missing" ? "true" : undefined}>
                  {r.v}
                  {r.note && <span className="ml-1.5" style={{ color: "var(--ps-muted)" }}>{r.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      ),
    source: () =>
      (target || copyKey || ctx?.template) && (
        <Section id="source" title="Source">
          <div className="flex flex-col gap-2">
            {target && (
              <div>
                <span className="text-[11px]" style={{ color: "var(--ps-muted)" }}>semantic target </span>
                <code className="ps-mono text-[12.5px] font-semibold">{target.id}</code>
                {target.meta && (
                  <dl className="ps-props mt-1">
                    {Object.entries(target.meta).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt>{k}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}
            {copyKey && (
              <div className="text-[12px] flex items-start gap-1.5">
                <span>
                  <code className="ps-mono" style={{ color: "var(--ps-focus)" }}>{copyKey.key}</code>
                  <span style={{ color: "var(--ps-muted)" }}> from the strings catalog ({copyKey.locale}) — edit the text there, not in the component</span>
                </span>
                <CopyButton text={copyKey.key} label="copy key" />
              </div>
            )}
            {ctx?.template && (
              <div className="text-[11px] flex flex-col gap-0.5" style={{ color: "var(--ps-muted)" }}>
                <span>template <code className="ps-mono">{ctx.template.id}</code></span>
                <span className="flex items-center gap-1.5 flex-wrap">
                  {ctx.template.source && <span className="ps-mono">{ctx.template.source}</span>}
                  {typeof __STAVY_ROOT__ === "string" && __STAVY_ROOT__ && (
                    <>
                      {ctx.template.source && (
                        <a className="ps-copy" href={`vscode://file/${__STAVY_ROOT__}/${ctx.template.source}`} title="Open the template in VS Code">
                          <ExternalLink className="size-3" /> source
                        </a>
                      )}
                      <a className="ps-copy" href={`vscode://file/${__STAVY_ROOT__}/stavy.json`} title="Open the manifest in VS Code">
                        <ExternalLink className="size-3" /> manifest
                      </a>
                    </>
                  )}
                </span>
                {ctx.template.uiKit && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {ctx.template.uiKit.map((c) => (
                      <Chip key={c} sm mono>{c}</Chip>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>
      ),
    url: () =>
      ctx && (
        <Section id="url" title={ctx.page.kind === "component" ? "Component" : "Page"} right={panel.copy.size > 0 ? <CopyButton text={appUrl(ctx.page, ctx.dims)} label="copy URL" /> : null}>
          <div className="font-semibold">{ctx.page.label}</div>
          <a className="ps-mono text-[11.5px] break-all" style={{ color: "var(--ps-focus)" }} href={appUrl(ctx.page, ctx.dims)} target="_blank" rel="noreferrer">
            {appUrl(ctx.page, ctx.dims)}
          </a>
          {Object.keys(ctx.dims).length > 0 && (
            <div className="flex flex-col gap-0.5 mt-1.5">
              {Object.entries(ctx.dims).map(([d, v]) => (
                <div key={d} className="flex justify-between">
                  <span style={{ color: "var(--ps-muted)" }}>{dimensionLabel(d)}</span>
                  <span className="font-medium">{valueLabel(d, v)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      ),
  }

  /** A section a `viewer.inspect.module` exports: its renderer returns rows, the panel draws them. */
  const renderModuleSection = (id: string) => {
    const fn = extra[id]
    if (!fn || !subject || !focusSel) return null
    let result: PanelSectionResult | null = null
    try {
      result = fn({
        el: subject,
        component: comp ? { name: comp.name, kit: comp.kit, props: shownProps } : null,
        stack: stack.map((c) => ({ name: c.name, kit: c.kit, internal: c.internal })),
        doc: subject.ownerDocument,
        win: subject.ownerDocument.defaultView,
        page: { id: focusSel.ctx.page.id, label: focusSel.ctx.page.label, template: focusSel.ctx.template?.id },
        dims: focusSel.ctx.dims,
      })
    } catch (err) {
      result = { title: id, rows: [{ label: "error", value: String((err as Error)?.message ?? err) }] }
    }
    if (!result || !Array.isArray(result.rows)) return null
    return (
      <Section id={id} title={String(result.title ?? id)}>
        <dl className="ps-kv">
          {result.rows.map((r, i) => (
            <div key={i} className="contents">
              <dt>{String(r.label)}</dt>
              <dd className="ps-mono">
                {String(r.value)}
                {r.copy && <span className="ml-1.5"><CopyButton text={String(r.copy)} label="copy" /></span>}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    )
  }

  const order: string[] = panel.sections ?? [...BUILTIN_SECTIONS, ...Object.keys(extra).filter((k) => !(BUILTIN_SECTIONS as readonly string[]).includes(k))]
  const rendered = order.map((id) => {
    const node = id in extra ? renderModuleSection(id) : builtin[id]?.()
    return node ? <div key={id} className="contents">{node}</div> : null
  })

  /* ---- breadcrumb: the pinned (or hovered) element's ancestors ---- */
  const crumbs: Element[] = []
  if (focusEl) {
    const top = focusEl.ownerDocument.body
    for (let cur: Element | null = focusEl; cur && cur !== top.parentElement; cur = cur.parentElement) crumbs.unshift(cur)
  }
  const shownCrumbs = crumbs.slice(-6)
  const hiddenCrumb = crumbs.length > shownCrumbs.length ? crumbs[crumbs.length - shownCrumbs.length - 1] : null

  /* ---- panel geometry ---- */
  const side = dock.side
  const panelStyle: React.CSSProperties =
    placement === "docked"
      ? { position: "absolute", inset: 0 }
      : side === "bottom"
        ? { position: "fixed", left: 0, right: 0, bottom: 0, height: dock.height, zIndex: "var(--ps-z-chrome)" as unknown as number }
        : { position: "fixed", top: 0, bottom: 0, [side]: 0, width: dock.width, zIndex: "var(--ps-z-chrome)" as unknown as number }

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      if (side === "right") setDock({ width: box.right - ev.clientX })
      else if (side === "left") setDock({ width: ev.clientX - box.left })
      else setDock({ height: box.bottom - ev.clientY })
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const clipBox = (r: Rect, children: React.ReactNode, key: string) => (
    <div key={key} className="ps-inspect-clip" style={{ left: r.left, top: r.top, width: r.width, height: r.height }}>
      {children}
    </div>
  )
  const rel = (r: Rect, c: Rect): Rect => ({ left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height })

  const panelEl = (
    <div
      className="ps ps-glass-strong ps-inspect-panel"
      data-ps-ui
      data-side={side}
      data-placement={placement}
      style={panelStyle}
      // The panel is never a subject: nothing here reaches the host's pointer surface.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="ps-inspect-resize" data-side={side} onPointerDown={startResize} title="Drag to resize" />
      <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--ps-border)" }}>
        <Crosshair className="size-4" style={{ color: "var(--ps-muted)" }} />
        <span className="text-[13px] font-semibold">Inspect</span>
        <span className="text-[11px] ps-inspect-status" style={{ color: "var(--ps-muted)" }}>
          {pinned ? "pinned" : "hover, click to pin"}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          {pinned && ctx && subject && (
            <span className="mr-1.5" title="Copy a pointer to this element (screen, state, URL, target, component) to paste into a chat with an agent">
              <CopyButton text={elementReference(subject, ctx, stack)} label="copy reference" />
            </span>
          )}
          {(["left", "bottom", "right"] as DockSide[]).map((s) => (
            <button
              key={s}
              className="ps-inspect-dockbtn"
              data-on={side === s ? "true" : undefined}
              aria-pressed={side === s}
              title={`Dock ${s}`}
              onClick={() => setDock({ side: s })}
            >
              {s === "left" ? <PanelLeft className="size-3.5" /> : s === "right" ? <PanelRight className="size-3.5" /> : <PanelBottom className="size-3.5" />}
            </button>
          ))}
          <button className="ps-inspect-dockbtn" style={{ color: "var(--ps-faint)" }} onClick={onClose} title="Close inspect (Esc)">
            <X className="size-4" />
          </button>
        </span>
      </div>
      <div className="ps-inspect-body p-4 text-[12.5px] flex flex-col gap-4">
        {/* ---- the selection, and the way up and down from it ---- */}
        <div data-section="selection">
          {focusEl ? (
            <div className="flex flex-wrap items-center gap-1 ps-inspect-crumbs">
              {hiddenCrumb && (
                <button className="ps-crumb ps-crumb-muted" title="Parent" onClick={() => focusSel && pin({ el: hiddenCrumb, iframe: focusSel.iframe, ctx: focusSel.ctx })}>
                  …
                </button>
              )}
              {shownCrumbs.map((el, i) => (
                <span key={i} className="contents">
                  {(i > 0 || hiddenCrumb) && <span style={{ color: "var(--ps-faint)" }}>›</span>}
                  <button
                    className="ps-crumb ps-mono"
                    data-on={el === focusEl ? "true" : undefined}
                    data-proto-crumb={ownTargetId(el) ? "true" : undefined}
                    title={elementLabel(el)}
                    onClick={() => focusSel && pin({ el, iframe: focusSel.iframe, ctx: focusSel.ctx })}
                  >
                    {crumbLabel(el)}
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span style={{ color: "var(--ps-muted)" }}>Hover the prototype, click to pin.</span>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]" style={{ color: "var(--ps-faint)" }}>
            <span className="flex items-center gap-1"><Keys keys={["↑", "↓"]} /> parent / child</span>
            <span className="flex items-center gap-1"><Keys keys={["←", "→"]} /> siblings</span>
            <span className="flex items-center gap-1"><Keys keys={["esc"]} /> {pinned ? "unpin" : "close"}</span>
            {pinned && <span>hover another element to measure</span>}
          </div>
        </div>

        {styles?.wireframed && (
          <div className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: "var(--ps-hover)", color: "var(--ps-muted)" }}>
            Wireframe mode is on — values below are measured with the wireframe filter lifted.
          </div>
        )}
        {rendered}
      </div>
    </div>
  )

  return (
    <>
      {createPortal(
        <div className="ps-fixed-layer ps-inspect-layer" data-ps-ui>
          {geo.pin && geo.pinClip &&
            clipBox(geo.pinClip, <div className="ps-inspect-outline" data-kind="pinned" style={rel(geo.pin, geo.pinClip)} />, "pin")}
          {geo.hover && geo.hoverClip &&
            clipBox(
              geo.hoverClip,
              <>
                {!(pinned && hover?.el === subject) && <div className="ps-inspect-outline" data-kind="hover" style={rel(geo.hover, geo.hoverClip)} />}
                {lines.map((l, i) => (
                  <div
                    key={i}
                    className="ps-measure-line"
                    data-dir={l.dir}
                    style={{ left: l.x1 - geo.hoverClip!.left, top: l.y1 - geo.hoverClip!.top, width: l.x2 - l.x1, height: l.y2 - l.y1 }}
                  />
                ))}
              </>,
              "hover"
            )}
          {/* Labels and the tag sit outside the clip — a small card must not cut them — but only for what is inside it. */}
          {geo.hoverClip &&
            lines.map((l, i) => {
              const x = (l.x1 + l.x2) / 2
              const y = (l.y1 + l.y2) / 2
              const c = geo.hoverClip!
              if (x < c.left || x > c.left + c.width || y < c.top || y > c.top + c.height) return null
              return (
                <div key={i} className="ps-measure-label" style={{ left: x, top: y }}>
                  {l.value}px
                </div>
              )
            })}
          {hover && geo.hover && geo.hoverClip && lines.length === 0 && (() => {
            const c = geo.hoverClip
            const r = geo.hover
            if (r.left > c.left + c.width || r.left + r.width < c.left || r.top > c.top + c.height || r.top + r.height < c.top) return null
            const above = Math.max(r.top, c.top) - 22
            const top = above >= 0 ? above : Math.min(r.top + r.height, c.top + c.height) + 4
            return (
              <div className="ps-inspect-tag" style={{ left: Math.max(c.left, r.left), top }}>
                <b>{hoverName ?? hover.el.tagName.toLowerCase()}</b>
                <span className="ps-inspect-tag-size">
                  {Math.round(r.width / geo.k)} × {Math.round(r.height / geo.k)}
                </span>
              </div>
            )
          })()}
        </div>,
        document.body
      )}
      {placement === "docked" ? (slot ? createPortal(panelEl, slot) : null) : createPortal(panelEl, document.body)}
    </>
  )
}
