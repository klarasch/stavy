import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Crosshair, Copy, Check, ExternalLink } from "../icons"
import { Chip, Kbd, Keys } from "../chrome"
import type { PageDef, TemplateDef } from "../types"
import { valueLabel, dimensionLabel, appUrl, manifest, appBase, ownTargetId } from "../manifest"
import {
  componentStack as componentStackOf,
  designSystemFor,
  frameToJsx,
  loadInspectModule,
  computedStyleOf,
  primaryFontFamily,
  invalidateStyleCache,
  type CompFrame,
  type DesignSystemAdapter,
} from "../inspect-adapter"
import { hostRect, withWireframeLifted, frameDoc } from "../frame"

/* ================================================================== */
/* Selection model                                                     */
/* ================================================================== */

interface Level {
  el: Element
  kind: "exact" | "proto"
  protoId: string | null
  meta: Record<string, unknown> | null
  label: string
}

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

function elementLabel(el: Element) {
  const cls = Array.from(el.classList)
    .filter((c) => !c.includes("[") && !c.includes(":"))
    .slice(0, 2)
    .join(".")
  return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}>`
}

function levelsFor(target: Element): Level[] {
  const levels: Level[] = [{ el: target, kind: "exact", protoId: null, meta: null, label: elementLabel(target) }]
  const stop = target.ownerDocument.body
  let cur: Element | null = target
  while (cur && cur !== stop) {
    const id = ownTargetId(cur)
    if (id) {
      let meta: Record<string, unknown> | null = null
      try {
        meta = JSON.parse(cur.getAttribute("data-proto-meta") ?? "null")
      } catch {
        meta = null
      }
      levels.push({ el: cur, kind: "proto", protoId: id, meta, label: id })
    }
    cur = cur.parentElement
  }
  return levels
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

interface Picked {
  levels: Level[]
  iframe: HTMLIFrameElement
  ctx: InspectContext
}

/**
 * Dev-mode inspection of the prototype *through* its frame. The host (player
 * or canvas) owns the pointer surface — a shield over the frame — and resolves
 * each pointer event to an element inside a frame via `hit`. The inspector
 * never touches the prototype's code: component names come from React fibers
 * on the frame's DOM nodes, styles from the frame's own window.
 */
export function Inspector({
  host,
  hit,
  onClose,
  onPinChange,
}: {
  /** Element that receives pointer events for inspection (a shield over the frame, or the canvas viewport) */
  host: HTMLElement
  /** Resolve a pointer event to an element inside a prototype frame; null when nothing inspectable is under it */
  hit: (e: MouseEvent) => FrameHit | null
  onClose: () => void
  /** The host may keep a frame alive while a selection is pinned to it */
  onPinChange?: (pinnedIframe: HTMLIFrameElement | null) => void
}) {
  const [hover, setHover] = useState<Picked | null>(null)
  const [pinned, setPinned] = useState<Picked | null>(null)
  const [levelIdx, setLevelIdx] = useState<number | null>(null)
  const [compIdx, setCompIdx] = useState<number | null>(null)
  const [internalsOpen, setInternalsOpen] = useState(false)
  const [alt, setAlt] = useState(false)
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
  useEffect(() => onPinChange?.(pinned?.iframe ?? null), [pinned, onPinChange])

  useEffect(() => {
    const pick = (e: MouseEvent): Picked | null => {
      // Viewer UI (pins, notes, tour cards, comment bubbles, area titles…) is never a subject of inspection.
      if (e.target instanceof Element && e.target.closest("[data-ps-ui]")) return null
      const h = hit(e)
      return h ? { levels: levelsFor(h.el), iframe: h.iframe, ctx: h.ctx } : null
    }
    const onMove = (e: MouseEvent) => setHover(pick(e))
    const onClick = (e: MouseEvent) => {
      const p = pick(e)
      if (!p) return
      e.preventDefault()
      e.stopPropagation()
      // Once per pick, never per hover: rebuild this frame's flattened stylesheets
      // so provenance for the pinned selection reflects the document as it is now.
      const doc = frameDoc(p.iframe)
      if (doc) invalidateStyleCache(doc)
      setPinned(p)
      setLevelIdx(null)
      setCompIdx(null)
      setInternalsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      setAlt(e.altKey)
      if (e.key === "Escape") onClose()
    }
    host.addEventListener("mousemove", onMove)
    host.addEventListener("click", onClick, { capture: true })
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    return () => {
      host.removeEventListener("mousemove", onMove)
      host.removeEventListener("click", onClick, { capture: true })
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
    }
  }, [host, hit, onClose])

  const picked = pinned ?? hover
  const levels = picked?.levels ?? null
  // Default: the exact element (what an engineer clicked). ⌥ jumps to the nearest semantic ancestor.
  const defaultIdx = levels ? (alt ? Math.max(0, levels.findIndex((l) => l.kind === "proto")) : 0) : 0
  const idx = levelIdx ?? defaultIdx
  const focus = levels?.[Math.min(idx, (levels?.length ?? 1) - 1)] ?? null
  const stack = useMemo<CompFrame[]>(() => (focus ? componentStackOf(focus.el) : []), [focus])
  const internalCount = stack.filter((c) => c.internal).length
  // A design system's own internals are rarely what you meant to inspect first.
  const compIdxResolved = compIdx ?? Math.max(0, stack.findIndex((c) => !c.internal))
  const comp = stack[Math.min(compIdxResolved, Math.max(0, stack.length - 1))]
  // Choosing a parent component re-targets everything (outline, element, styles) to that
  // component's own root node — not the node that was clicked.
  const subject: Element | null = compIdxResolved > 0 && comp?.host ? comp.host : (focus?.el ?? null)
  const rect: Rect | null = subject && picked && subject.isConnected ? hostRect(subject, picked.iframe) : null
  const ctx = picked?.ctx ?? null
  const ds = useMemo(() => (subject?.ownerDocument ? designSystemFor(subject.ownerDocument) : null), [subject])
  const styles = useMemo(() => (subject && ds ? stylesFor(subject, ds) : null), [subject, ds])
  const classes = subject ? Array.from(subject.classList) : []
  const copyKey = subject ? copyKeyFor(subject) : null
  const attrs = subject
    ? Array.from(subject.attributes).filter((a) => /^(data-(?!proto)|aria-|role$|href$|type$|disabled$|tabindex$|id$|name$|placeholder$)/.test(a.name))
    : []

  const Section = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
    <div>
      <div className="flex items-center mb-1.5">
        <span className="text-[10.5px] uppercase tracking-wider" style={{ color: "var(--ps-faint)" }}>{title}</span>
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </div>
  )
  const Rows = ({ rows }: { rows: StyleRow[] }) => (
    <dl className="ps-kv">
      {rows.map((r) => (
        <div key={r.k} className="contents">
          <dt>{r.k}</dt>
          <dd className="ps-mono">
            {r.swatch && <span className="ps-swatch" style={{ background: r.swatch }} />}
            {r.v}
            {r.token && <span className="ml-1.5" style={{ color: "var(--ps-focus)" }}>{r.token}</span>}
            {r.note && <span className="ml-1.5" style={{ color: "var(--ps-muted)" }}>{r.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )

  return (
    <>
      {createPortal(
        <div className="ps-fixed-layer" data-ps-ui>
          {rect && (
            <div
              className="absolute rounded-md transition-all duration-75"
              style={{ ...rect, outline: "1.5px dashed var(--ps-focus)", outlineOffset: 2, background: "var(--ps-focus-soft)", opacity: 0.9 }}
            />
          )}
        </div>,
        document.body
      )}
      {createPortal(
      <div className="ps ps-glass-strong fixed right-4 top-4 w-[360px] rounded-2xl overflow-hidden" style={{ zIndex: "var(--ps-z-chrome)" }}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--ps-border)" }}>
          <Crosshair className="size-4" style={{ color: "var(--ps-muted)" }} />
          <span className="text-[13px] font-semibold">Inspect</span>
          <span className="text-[11px]" style={{ color: "var(--ps-muted)" }}>
            {pinned ? "pinned" : "hover, click to pin"}
          </span>
          <button className="ml-auto cursor-pointer" style={{ color: "var(--ps-faint)" }} onClick={onClose} title="Close (Esc)">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4 text-[12.5px] flex flex-col gap-4 max-h-[84vh] overflow-y-auto">
          {/* ---- 1. what is selected ---- */}
          <Section title="Selection: exact element → semantic ancestors">
            {levels ? (
              <div className="flex flex-wrap gap-1">
                {levels.map((l, i) => (
                  <button key={i} className={l.kind === "exact" ? "ps-crumb ps-mono" : "ps-crumb"} data-on={i === idx ? "true" : undefined} onClick={() => { setLevelIdx(i); setCompIdx(null) }}>
                    {l.label}
                  </button>
                ))}
              </div>
            ) : (
              <span style={{ color: "var(--ps-muted)" }}>Hover the prototype…</span>
            )}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]" style={{ color: "var(--ps-faint)" }}>
              <span className="flex items-center gap-1"><Kbd>⌥</Kbd> semantic region</span>
              <span className="flex items-center gap-1"><Kbd>click</Kbd> pin</span>
              <span className="flex items-center gap-1"><Keys keys={["esc"]} /> close</span>
            </div>
          </Section>

          {/* ---- 2. React component + props ---- */}
          {focus && (
            <Section
              title="React component"
              right={comp ? <CopyButton text={frameToJsx(comp)} label="copy JSX" /> : null}
            >
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
                  {comp && (
                    <pre className="rounded-lg p-2.5 ps-mono text-[11.5px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--ps-hover)", margin: 0 }}>
                      {frameToJsx(comp)}
                    </pre>
                  )}
                </>
              )}
            </Section>
          )}

          {copyKey && (
            <Section title="Copy" right={<CopyButton text={copyKey.key} label="copy key" />}>
              <div className="text-[12px]">
                <code className="ps-mono" style={{ color: "var(--ps-focus)" }}>{copyKey.key}</code>
                <span style={{ color: "var(--ps-muted)" }}> from the strings catalog ({copyKey.locale}) — edit the text there, not in the component</span>
              </div>
            </Section>
          )}

          {/* ---- 3. semantic target meta ---- */}
          {focus?.kind === "proto" && (
            <Section title="Semantic target">
              <code className="ps-mono text-[13px] font-semibold">{focus.protoId}</code>
              {focus.meta && (
                <dl className="ps-props mt-1.5">
                  {Object.entries(focus.meta).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt>{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Section>
          )}

          {/* ---- 4. DOM element: classes & attributes ---- */}
          {subject && (
            <Section title={`Element <${subject.tagName.toLowerCase()}>${compIdxResolved > 0 && comp?.host ? ` (root of ${comp.name})` : ""}`} right={classes.length > 0 ? <CopyButton text={classes.join(" ")} label="copy classes" /> : null}>
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
          )}

          {/* ---- 5. resolved styles with provenance ---- */}
          {styles?.wireframed && (
            <div className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: "var(--ps-hover)", color: "var(--ps-muted)" }}>
              Wireframe mode is on — values below are measured with the wireframe filter lifted.
            </div>
          )}
          {styles && (
            <>
              <Section title="Type">
                <Rows rows={styles.type} />
              </Section>
              <Section title="Spacing & shape">
                <Rows rows={styles.space} />
              </Section>
              {styles.color.length > 0 && (
                <Section title="Color: value, and where it comes from">
                  <Rows rows={styles.color} />
                </Section>
              )}
            </>
          )}

          <div style={{ height: 1, background: "var(--ps-border)" }} />

          {/* ---- 6. where in the product ---- */}
          {ctx && (
            <>
              <Section title={ctx.page.kind === "component" ? "Component" : "Page"}>
                <div className="font-semibold">{ctx.page.label}</div>
                {ctx.template && (
                  <div className="text-[11px] mt-0.5 flex flex-col gap-0.5" style={{ color: "var(--ps-muted)" }}>
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
                  </div>
                )}
                {ctx.template?.uiKit && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {ctx.template.uiKit.map((c) => (
                      <Chip key={c} sm mono>{c}</Chip>
                    ))}
                  </div>
                )}
              </Section>
              <Section title="Prototype URL" right={<CopyButton text={appUrl(ctx.page, ctx.dims)} label="copy" />}>
                <a className="ps-mono text-[11.5px] break-all" style={{ color: "var(--ps-focus)" }} href={appUrl(ctx.page, ctx.dims)} target="_blank" rel="noreferrer">
                  {appUrl(ctx.page, ctx.dims)}
                </a>
              </Section>
              <Section title="Active dimensions">
                <div className="flex flex-col gap-0.5">
                  {Object.entries(ctx.dims).map(([d, v]) => (
                    <div key={d} className="flex justify-between">
                      <span style={{ color: "var(--ps-muted)" }}>{dimensionLabel(d)}</span>
                      <span className="font-medium">{valueLabel(d, v)}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      </div>,
      document.body
      )}
    </>
  )
}
