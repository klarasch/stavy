import { memo, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, ChevronDown, ChevronRight, Play } from "../icons"
import { contentUrl, getPage, getScenario, pageUrl } from "../manifest"
import { useChrome } from "../chrome"
import { cn } from "../cn"
import type { BoardCallout, FlowItem, ImageItem, MarkdownItem, MermaidItem, NoteItem, ScreenItem, StatesItem } from "../types"
import { Markdown, useMarkdownSource } from "./MarkdownView"
import { resolveShot, shotLabel, statesOf } from "./resolve"
import { ShotCard } from "./ShotCard"

/**
 * Item bodies. Placement, selection, the title above and the note below are
 * the board's job (BoardView); these only draw what the item *is*, at the
 * width they are given.
 */

export const DEFAULT_W = { screen: 360, crop: 420, markdown: 520, note: 240, image: 480, mermaid: 560, stateCard: 280, step: 200 }

function Unknown({ what }: { what: string }) {
  return <div className="ps-board-missing">{what}</div>
}

/* ---- screen ---- */

export const ScreenBody = memo(function ScreenBody({ item, width, wireframe }: { item: ScreenItem; width: number; wireframe: boolean }) {
  const shot = resolveShot(item.screen, item)
  if (!shot) return <Unknown what={`Unknown screen "${item.screen}"`} />
  return <ShotCard shot={shot} width={width} wireframe={wireframe} />
})

/* ---- states: one screen in several states ---- */

export const StatesBody = memo(function StatesBody({ item, wireframe }: { item: StatesItem; wireframe: boolean }) {
  const page = getPage(item.screen)
  if (!page) return <Unknown what={`Unknown screen "${item.screen}"`} />
  const states = statesOf(page, item.states)
  const all = states.map((s) => s.dims)
  const grid = item.layout === "grid"
  const cols = grid ? item.columns ?? Math.min(states.length, 3) : item.columns ?? states.length
  const gap = 20
  const cardW = item.w ? Math.floor((item.w - gap * (cols - 1)) / cols) : DEFAULT_W.stateCard
  return (
    <div className="grid items-start" style={{ gridTemplateColumns: `repeat(${cols}, ${cardW}px)`, gap: `24px ${gap}px` }}>
      {states.map((s) => {
        const shot = resolveShot(page.id, { dims: s.dims, crop: item.crop })
        if (!shot) return null
        return (
          <div key={s.ref} className="flex flex-col gap-1.5">
            <div className="ps-board-label">
              <span className="ps-zs">{shotLabel(page, s.dims, all)}</span>
            </div>
            <ShotCard shot={shot} width={cardW} wireframe={wireframe} />
            {s.note && <div className="ps-board-note">{s.note}</div>}
          </div>
        )
      })}
    </div>
  )
})

/* ---- flow: numbered steps that wrap, never capped ---- */

export const FlowBody = memo(function FlowBody({
  item,
  wireframe,
  collapsed,
  onToggle,
}: {
  item: FlowItem
  wireframe: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  const navigate = useNavigate()
  const sc = getScenario(item.flow)
  if (!sc) return <Unknown what={`Unknown flow "${item.flow}"`} />
  const gap = 28
  const perRow = Math.max(1, item.perRow ?? (item.w ? Math.floor((item.w + gap) / (DEFAULT_W.step + gap)) : 5))
  const stepW = item.w ? Math.floor((item.w - gap * (Math.min(perRow, sc.steps.length) - 1)) / Math.min(perRow, sc.steps.length)) : DEFAULT_W.step
  const tourHref = (i: number) => {
    const st = sc.steps[i]
    const shot = resolveShot(st.page, { dims: st.dims })
    return shot ? pageUrl(shot.page.id, shot.dims, { tour: sc.id, ts: String(i) }) : null
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2" data-ps-ui>
        <button type="button" className="ps-flow-toggle" onClick={onToggle} title={collapsed ? "Show the steps" : "Collapse to a list"}>
          {collapsed ? <ChevronRight /> : <ChevronDown />}
        </button>
        <span className="ps-flow-name">
          {sc.label}
          <span className="ps-flow-count">{sc.steps.length} steps</span>
          {sc.persona && <span className="ps-chip ps-chip-sm capitalize">{sc.persona}</span>}
        </span>
        <button
          type="button"
          className="ps-btn ps-flow-play"
          onClick={() => {
            const h = tourHref(0)
            if (h) navigate(h)
          }}
        >
          <Play /> Play
        </button>
      </div>
      {sc.description && !collapsed && <p className="ps-board-note max-w-2xl">{sc.description}</p>}
      {collapsed ? (
        <ol className="ps-flow-list">
          {sc.steps.map((st, i) => (
            <li key={i}>
              <button type="button" onClick={() => tourHref(i) && navigate(tourHref(i)!)}>
                <span className="ps-step-n">{i + 1}</span>
                <span className="truncate">{st.title}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="grid items-start" style={{ gridTemplateColumns: `repeat(${Math.min(perRow, sc.steps.length)}, ${stepW}px)`, gap: `28px ${gap}px` }}>
          {sc.steps.map((st, i) => {
            const shot = resolveShot(st.page, { dims: st.dims })
            const lastInRow = (i + 1) % perRow === 0 || i === sc.steps.length - 1
            return (
              <div key={i} className="relative flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="ps-step-n">{i + 1}</span>
                  <span className="ps-step-title truncate" title={st.title}>{st.title}</span>
                </div>
                {shot ? <ShotCard shot={shot} width={stepW} extra={{ tour: sc.id, ts: String(i) }} wireframe={wireframe} /> : <Unknown what={st.page} />}
                {st.note && <div className="ps-board-note line-clamp-3">{st.note}</div>}
                {!lastInRow && <ArrowRight className="ps-step-arrow" style={{ left: stepW + gap / 2 - 7, top: 24 + Math.round((stepW * 9) / 16 / 2) }} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

/* ---- markdown ---- */

export const MarkdownBody = memo(function MarkdownBody({ item }: { item: MarkdownItem }) {
  const loaded = useMarkdownSource(item.md == null ? item.src : undefined)
  if (item.md != null) return <Markdown md={item.md} className="ps-board-md" embedWidth={Math.min(420, (item.w ?? DEFAULT_W.markdown) - 48)} />
  if (loaded.error) return <Unknown what={`Could not load ${item.src}: ${loaded.error}`} />
  if (loaded.text == null) return <div className="ps-skeleton" style={{ height: 120 }} />
  return <Markdown md={loaded.text} className="ps-board-md" embedWidth={Math.min(420, (item.w ?? DEFAULT_W.markdown) - 48)} />
})

/* ---- sticky note ---- */

export const NoteBody = memo(function NoteBody({ item }: { item: NoteItem }) {
  return (
    <div className="ps-sticky" data-color={item.color ?? "yellow"}>
      <Markdown md={item.text ?? ""} inline />
      {item.author && <div className="ps-sticky-author">— {item.author}</div>}
    </div>
  )
})

/* ---- image with callouts ---- */

export const ImageBody = memo(function ImageBody({ item, width }: { item: ImageItem; width: number }) {
  const callouts = item.callouts ?? []
  const [err, setErr] = useState(false)
  const legendW = 240
  const imgW = callouts.length ? Math.max(160, width - legendW - 24) : width
  return (
    <div className="flex items-start gap-6">
      <div className="ps-figure ps-board-figure" style={{ width: imgW }}>
        {err ? (
          <div className="ps-board-missing" style={{ height: Math.round(imgW * 0.6) }}>Image not found: {item.src}</div>
        ) : (
          <img src={contentUrl(item.src)} alt={item.alt ?? item.title ?? ""} draggable={false} loading="lazy" onError={() => setErr(true)} />
        )}
        <CalloutMarks callouts={callouts} />
      </div>
      {callouts.length > 0 && <CalloutLegend callouts={callouts} width={legendW} />}
    </div>
  )
})

/** Numbered marks over an image; coordinates are fractions of it (the anatomy's visual language). */
function CalloutMarks({ callouts }: { callouts: BoardCallout[] }) {
  return (
    <>
      {callouts.map((c, i) => (
        <div key={i}>
          {c.w != null && c.h != null && (
            <div className="ps-anat-box" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }} />
          )}
          <div className="ps-anat-tag" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}>{i + 1}</div>
        </div>
      ))}
    </>
  )
}

function CalloutLegend({ callouts, width }: { callouts: BoardCallout[]; width: number }) {
  return (
    <div className="flex flex-col gap-2.5 pt-1" style={{ width }}>
      {callouts.map((c, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <span className="ps-anat-tag" style={{ position: "static", transform: "none", flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
          <div>
            <div className="text-[12.5px] font-semibold leading-tight">{c.title}</div>
            {c.note && <div className="ps-sub leading-snug mt-0.5">{c.note}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---- mermaid: the renderer is a separate chunk, loaded only when a board has one ---- */

function prefersDark(theme: string) {
  if (theme === "dark") return true
  if (theme === "light") return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

let mermaidSeq = 0

export const MermaidBody = memo(function MermaidBody({ item }: { item: MermaidItem }) {
  const { theme } = useChrome()
  const dark = prefersDark(theme)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const mermaid = (await import("mermaid")).default
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
          securityLevel: "strict",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          themeVariables: { fontSize: "14px" },
        })
        const { svg } = await mermaid.render(`ps-mmd-${item.id.replace(/\W/g, "")}-${++mermaidSeq}`, item.code)
        if (!cancelled) {
          setSvg(svg)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(String((e as Error)?.message ?? e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [item.id, item.code, dark])
  if (error)
    return (
      <div className="flex flex-col gap-2">
        <div className="ps-board-missing">Mermaid: {error.split("\n")[0]}</div>
        <pre className="ps-mono text-[11px] whitespace-pre-wrap" style={{ color: "var(--ps-muted)" }}>{item.code}</pre>
      </div>
    )
  if (!svg) return <div className="ps-skeleton" style={{ height: 160 }} />
  return <div className={cn("ps-board-mermaid")} dangerouslySetInnerHTML={{ __html: svg }} />
})
