import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { X, Crosshair, Copy, Check, ExternalLink } from "lucide-react"
import { Chip, Kbd, Keys } from "../chrome"
import type { PageDef, TemplateDef } from "../types"
import { valueLabel, dimensionLabel } from "../manifest"
import { adapter, frameToJsx, type CompFrame } from "../inspect-adapter"
import { strings as copyCatalog } from "virtual:proto-strings"

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

function elementLabel(el: Element) {
  const cls = Array.from(el.classList)
    .filter((c) => !c.includes("[") && !c.includes(":"))
    .slice(0, 2)
    .join(".")
  return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}>`
}

function levelsFor(target: Element, wrapper: HTMLElement): Level[] {
  const levels: Level[] = [{ el: target, kind: "exact", protoId: null, meta: null, label: elementLabel(target) }]
  let cur: Element | null = target
  while (cur && cur !== wrapper) {
    const id = cur.getAttribute("data-proto")
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

function rectOf(el: Element, wrapper: HTMLElement, k: number): Rect {
  const w = wrapper.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return {
    top: (r.top - w.top) / k + wrapper.scrollTop,
    left: (r.left - w.left) / k + wrapper.scrollLeft,
    width: r.width / k,
    height: r.height / k,
  }
}

/* ---- copy provenance: which catalog key produced this element's text ---- */
let copyIndex: Map<string, { key: string; locale: string }> | null = null
function copyKeyFor(el: Element): { key: string; locale: string } | null {
  if (!copyIndex) {
    copyIndex = new Map()
    for (const [locale, table] of Object.entries(copyCatalog)) for (const [key, text] of Object.entries(table)) {
      const t = String(text).replace(/\s+/g, " ").trim()
      if (t && !copyIndex.has(t)) copyIndex.set(t, { key, locale })
    }
  }
  if (copyIndex.size === 0) return null
  // Own text first (direct text nodes), then the whole subtree for small elements.
  const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").replace(/\s+/g, " ").trim()
  const all = (el.textContent ?? "").replace(/\s+/g, " ").trim()
  return copyIndex.get(own) ?? (all.length <= 140 ? copyIndex.get(all) ?? null : null)
}

/* ================================================================== */
/* Style provenance: classes, tokens, computed values                   */
/* ================================================================== */

const TOKEN_NAMES = adapter.tokenNames
const PALETTE = adapter.paletteClass
const TEXT_SIZE = /^text-(xs|sm|base|lg|xl|\dxl|\[.+\])$/
const FONT = /^(font-(thin|light|normal|medium|semibold|bold|extrabold|black|sans|serif|mono)|leading-\S+|tracking-\S+|italic|uppercase|capitalize|tabular-nums|truncate|line-clamp-\d+)$/
const SPACE = /^-?(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|w|h|size|min-w|max-w|min-h|max-h|rounded(-\w+)?|border(-\d)?|inset|top|left|right|bottom)(-\S+)?$/

type ClassKind = "color" | "type" | "space" | "layout" | "other"

function classifyClass(c: string): ClassKind {
  const base = c.replace(/^[a-z-]+:/, "").replace(/!$/, "") // strip variants like hover:, md:
  const m = base.match(/^(text|bg|border|ring|outline|fill|stroke|decoration|from|to|via)-(.+)$/)
  if (m) {
    const v = m[2].replace(/\/\d+$/, "")
    if (TOKEN_NAMES.has(v) || PALETTE.test(v) || v.startsWith("[")) return "color"
  }
  if (TEXT_SIZE.test(base) || FONT.test(base)) return "type"
  if (SPACE.test(base)) return "space"
  if (/^(flex|grid|inline|block|hidden|items-|justify-|col-|row-|self-|shrink|grow|absolute|relative|fixed|sticky|overflow|z-)/.test(base)) return "layout"
  return "other"
}

function colorSource(el: Element, wrapper: HTMLElement, prefix: "text" | "bg" | "border"): { cls: string; from: Element | null } | null {
  let cur: Element | null = el
  while (cur && cur !== wrapper) {
    const cls = adapter.colorClass(cur.getAttribute("class") ?? "", prefix)
    if (cls) return { cls, from: cur === el ? null : cur }
    if (prefix !== "text") break // background/border don't inherit
    cur = cur.parentElement
  }
  return null
}

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

const TEXT_SCALE: Array<[number, string]> = [
  [12, "text-xs"], [14, "text-sm"], [16, "text-base"], [18, "text-lg"], [20, "text-xl"], [24, "text-2xl"], [30, "text-3xl"], [36, "text-4xl"],
]
const WEIGHTS: Record<string, string> = { "400": "font-normal", "500": "font-medium", "600": "font-semibold", "700": "font-bold" }
const px = (v: string) => Math.round(parseFloat(v || "0") * 100) / 100
const sp = (n: number) => (n === 0 ? "0" : n === 1 ? "px" : Number.isInteger(n / 2) ? String(n / 4) : "")

function boxShorthand(cs: CSSStyleDeclaration, prop: "padding" | "margin", p: string) {
  const t = px(cs.getPropertyValue(`${prop}-top`)), r = px(cs.getPropertyValue(`${prop}-right`))
  const b = px(cs.getPropertyValue(`${prop}-bottom`)), l = px(cs.getPropertyValue(`${prop}-left`))
  if ([t, r, b, l].every((n) => n === 0)) return null
  let token = ""
  if (t === r && r === b && b === l) token = sp(t) && `${p}-${sp(t)}`
  else if (t === b && l === r) token = [sp(l) && `${p}x-${sp(l)}`, sp(t) && `${p}y-${sp(t)}`].filter(Boolean).join(" ")
  else token = [`${p}t-${sp(t)}`, `${p}r-${sp(r)}`, `${p}b-${sp(b)}`, `${p}l-${sp(l)}`].join(" ")
  const value = t === r && r === b && b === l ? `${t}px` : t === b && l === r ? `${t}px ${r}px` : `${t}px ${r}px ${b}px ${l}px`
  return { value, token }
}

interface StyleRow {
  k: string
  v: string
  token?: string
  swatch?: string
  note?: string
}

/** Read computed style with the wireframe filter temporarily lifted, so values describe the design, not the filter. */
function computedWithoutWireframe(el: Element): { cs: CSSStyleDeclaration; wireframed: boolean } {
  const wf = el.closest(".proto-wireframe")
  if (!wf) return { cs: getComputedStyle(el), wireframed: false }
  wf.classList.remove("proto-wireframe")
  const snapshot = getComputedStyle(el)
  // Copy the few properties we read before restoring the class (the declaration is live).
  const keys = ["fontSize", "lineHeight", "fontFamily", "fontWeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "marginTop", "marginRight", "marginBottom", "marginLeft", "gap", "borderTopLeftRadius", "borderTopWidth", "borderTopStyle", "width", "height",
    "color", "backgroundColor", "borderTopColor"] as const
  const copy: Record<string, string> = {}
  for (const k of keys) copy[k] = snapshot[k as keyof CSSStyleDeclaration] as string
  for (const k of ["padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left"])
    copy[k] = snapshot.getPropertyValue(k)
  wf.classList.add("proto-wireframe")
  const cs = { ...copy, getPropertyValue: (k: string) => copy[k] ?? "" } as unknown as CSSStyleDeclaration
  return { cs, wireframed: true }
}

function stylesFor(el: Element, wrapper: HTMLElement) {
  const { cs, wireframed } = computedWithoutWireframe(el)
  const size = px(cs.fontSize)
  const lh = cs.lineHeight === "normal" ? "normal" : `${px(cs.lineHeight)}px`
  const type: StyleRow[] = [
    { k: "font", v: cs.fontFamily.split(",")[0].replace(/"/g, ""), token: /mono/i.test(cs.fontFamily) ? "font-mono" : "font-sans" },
    { k: "size / line", v: `${size}px / ${lh}`, token: TEXT_SCALE.find(([p]) => p === size)?.[1] },
    { k: "weight", v: cs.fontWeight, token: WEIGHTS[cs.fontWeight] },
  ]
  if (cs.letterSpacing !== "normal") type.push({ k: "tracking", v: cs.letterSpacing })

  const space: StyleRow[] = []
  const pad = boxShorthand(cs, "padding", "p")
  if (pad) space.push({ k: "padding", v: pad.value, token: pad.token })
  const mar = boxShorthand(cs, "margin", "m")
  if (mar) space.push({ k: "margin", v: mar.value, token: mar.token })
  const gap = px(cs.gap || "0")
  if (gap > 0) space.push({ k: "gap", v: `${gap}px`, token: sp(gap) && `gap-${sp(gap)}` })
  const radius = px(cs.borderTopLeftRadius)
  if (radius > 0) space.push({ k: "radius", v: `${radius}px` })
  const bw = px(cs.borderTopWidth)
  if (bw > 0) space.push({ k: "border", v: `${bw}px ${cs.borderTopStyle}` })
  space.push({ k: "size", v: `${px(cs.width)} × ${px(cs.height)}` })

  const color: StyleRow[] = []
  const add = (k: string, raw: string, prefix: "text" | "bg" | "border") => {
    const parsed = cssColorToHex(raw)
    if (!parsed) return
    const src = colorSource(el, wrapper, prefix)
    const row: StyleRow = { k, v: parsed.alpha < 1 ? `${parsed.hex} ${Math.round(parsed.alpha * 100)}%` : parsed.hex, swatch: raw }
    if (src) {
      const v = src.cls.replace(/^[a-z-]+:/, "").replace(/^(text|bg|border)-/, "").replace(/\/\d+$/, "")
      row.token = src.cls
      row.note = TOKEN_NAMES.has(v) ? `var(--${v})` : PALETTE.test(v) ? "tailwind palette" : undefined
      if (src.from) row.note = `inherited from ${elementLabel(src.from)}${row.note ? " · " + row.note : ""}`
    }
    color.push(row)
  }
  add("text", cs.color, "text")
  add("background", cs.backgroundColor, "bg")
  if (bw > 0) add("border", cs.borderTopColor, "border")
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

export function Inspector({
  wrapper,
  context,
  scale,
  within,
  onClose,
}: {
  wrapper: HTMLElement
  /** Resolve which page/dims an element belongs to (constant on a page, per-card on the canvas) */
  context: (el: Element) => InspectContext | null
  /** Current zoom of the wrapper's content (1 on a page; canvas zoom on the canvas) */
  scale?: () => number
  /** Only inspect elements inside this selector (e.g. thumbnails on the canvas) */
  within?: string
  onClose: () => void
}) {
  const [hoverLevels, setHoverLevels] = useState<Level[] | null>(null)
  const [pinnedLevels, setPinnedLevels] = useState<Level[] | null>(null)
  const [levelIdx, setLevelIdx] = useState<number | null>(null)
  const [compIdx, setCompIdx] = useState(0)
  const [alt, setAlt] = useState(false)

  useEffect(() => {
    // Viewer UI (pins, notes, tour cards, comment bubbles, area titles…) is never a subject of inspection.
    const eligible = (t: EventTarget | null): t is Element =>
      t instanceof Element && wrapper.contains(t) && !t.closest("[data-ps-ui]") && (!within || !!t.closest(within))
    const onMove = (e: MouseEvent) => {
      if (!eligible(e.target)) {
        setHoverLevels(null)
        return
      }
      setHoverLevels(levelsFor(e.target, wrapper))
    }
    const onClick = (e: MouseEvent) => {
      if (!eligible(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      setPinnedLevels(levelsFor(e.target, wrapper))
      setLevelIdx(null)
      setCompIdx(0)
    }
    const onKey = (e: KeyboardEvent) => {
      setAlt(e.altKey)
      if (e.key === "Escape") onClose()
    }
    wrapper.addEventListener("mousemove", onMove)
    wrapper.addEventListener("click", onClick, { capture: true })
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    return () => {
      wrapper.removeEventListener("mousemove", onMove)
      wrapper.removeEventListener("click", onClick, { capture: true })
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
    }
  }, [wrapper, onClose, within])

  const levels = pinnedLevels ?? hoverLevels
  // Default: the exact element (what an engineer clicked). ⌥ jumps to the nearest semantic ancestor.
  const defaultIdx = levels ? (alt ? Math.max(0, levels.findIndex((l) => l.kind === "proto")) : 0) : 0
  const idx = levelIdx ?? defaultIdx
  const focus = levels?.[Math.min(idx, (levels?.length ?? 1) - 1)] ?? null
  const k = scale?.() ?? 1
  const stack = useMemo<CompFrame[]>(() => (focus ? adapter.componentStack(focus.el, "PageRenderer") : []), [focus])
  const comp = stack[Math.min(compIdx, Math.max(0, stack.length - 1))]
  // Choosing a parent component re-targets everything (outline, element, styles) to that
  // component's own root node — not the node that was clicked.
  const subject: Element | null = compIdx > 0 && comp?.host ? comp.host : (focus?.el ?? null)
  const rect = subject ? rectOf(subject, wrapper, k) : null
  const ctx = focus ? context(focus.el) : null
  const styles = useMemo(() => (subject ? stylesFor(subject, wrapper) : null), [subject, wrapper])
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
      <div className="absolute inset-0 pointer-events-none z-30">
        {rect && (
          <div
            className="absolute rounded-md transition-all duration-75"
            style={{ ...rect, outline: `${1.5 / k}px dashed var(--ps-focus)`, outlineOffset: 2 / k, background: "var(--ps-focus-soft)", opacity: 0.9 }}
          />
        )}
      </div>
      {createPortal(
      <div className="ps ps-glass-strong fixed right-4 top-4 w-[360px] rounded-2xl z-50 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--ps-border)" }}>
          <Crosshair className="size-4" style={{ color: "var(--ps-muted)" }} />
          <span className="text-[13px] font-semibold">Inspect</span>
          <span className="text-[11px]" style={{ color: "var(--ps-muted)" }}>
            {pinnedLevels ? "pinned" : "hover, click to pin"}
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
                  <button key={i} className={l.kind === "exact" ? "ps-crumb ps-mono" : "ps-crumb"} data-on={i === idx ? "true" : undefined} onClick={() => { setLevelIdx(i); setCompIdx(0) }}>
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
                    {stack.map((c, i) => (
                      <span key={i} className="contents">
                        {i > 0 && <span style={{ color: "var(--ps-faint)" }}>‹</span>}
                        <button className="ps-crumb" data-on={i === compIdx ? "true" : undefined} onClick={() => setCompIdx(i)}>
                          {c.name}
                        </button>
                      </span>
                    ))}
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
            <Section title={`Element <${subject.tagName.toLowerCase()}>${compIdx > 0 && comp?.host ? ` (root of ${comp.name})` : ""}`} right={classes.length > 0 ? <CopyButton text={classes.join(" ")} label="copy classes" /> : null}>
              {classes.length > 0 ? (
                <div className="ps-classes">
                  {classes.map((c) => (
                    <span key={c} data-kind={classifyClass(c)}>{c}</span>
                  ))}
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
                <Section title="Color: value, and the class that sets it">
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
                      <span className="ps-mono">{ctx.template.source}</span>
                      {typeof __PROTO_ROOT__ === "string" && __PROTO_ROOT__ && (
                        <>
                          <a className="ps-copy" href={`vscode://file/${__PROTO_ROOT__}/${ctx.template.source}`} title="Open the template in VS Code">
                            <ExternalLink className="size-3" /> template
                          </a>
                          <a className="ps-copy" href={`vscode://file/${__PROTO_ROOT__}/stavy.json`} title="Open the manifest in VS Code">
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
