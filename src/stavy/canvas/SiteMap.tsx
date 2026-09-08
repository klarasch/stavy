import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { groupPages, pageUrl, resolveDims, snapshotUrl, workspaceOverridesFor, pageViewport } from "../manifest"
import type { PageDef, Scenario } from "../types"

/**
 * The site map: every page as one small node, arrows derived from the
 * scenarios. It answers the question a wall of variants cannot — how do these
 * screens fit together — and it is honest about pages that connect to nothing:
 * a disconnected screen simply sits in its row with no arrows, which is what a
 * couple of stand-alone frames look like in a design file.
 *
 * Nodes are static `<img>` snapshots on purpose. The map is the first thing on
 * the canvas, so it must cost nothing: it never mounts a frame and never
 * registers with the card visibility/eviction budget (visibility.tsx).
 */

const NODE_W = 176
const GAP_X = 64
const GAP_Y = 54

/** One arrow between two pages, and the scenarios that walk it. */
interface Edge {
  from: string
  to: string
  scenarios: string[]
}

/** Consecutive scenario steps on different pages, deduped; several scenarios sharing a hop share one arrow. */
export function scenarioEdges(scenarios: Scenario[], has: (pageId: string) => boolean): Edge[] {
  const edges = new Map<string, Edge>()
  for (const sc of scenarios) {
    for (let i = 1; i < sc.steps.length; i++) {
      const from = sc.steps[i - 1].page
      const to = sc.steps[i].page
      if (from === to || !has(from) || !has(to)) continue
      const key = `${from}→${to}`
      const edge = edges.get(key) ?? { from, to, scenarios: [] }
      if (!edge.scenarios.includes(sc.label)) edge.scenarios.push(sc.label)
      edges.set(key, edge)
    }
  }
  return [...edges.values()]
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A gentle curve between two node boxes. The ports are chosen by which way the
 * arrow mostly travels, so a hop along a row leaves the right edge and a hop to
 * another row leaves the bottom — both routes run through the gaps between
 * nodes rather than across them.
 */
export function edgePath(a: Box, b: Box): string {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const dx = bc.x - ac.x
  const dy = bc.y - ac.y
  // A hop that skips over its neighbours would run straight through them, so it
  // swings around instead, the way a flow arrow does on a wall: under the row
  // for a long hop along one, down the margin for one that skips a row.
  if (Math.abs(dy) < a.h / 2 && Math.abs(dx) > a.w * 1.6) {
    const bow = Math.min(38, 20 + Math.abs(dx) * 0.06)
    const s = { x: ac.x, y: a.y + a.h }
    const e = { x: bc.x, y: b.y + b.h }
    return `M ${s.x} ${s.y} C ${s.x} ${s.y + bow}, ${e.x} ${e.y + bow}, ${e.x} ${e.y}`
  }
  if (Math.abs(dx) < a.w / 2 && Math.abs(dy) > a.h * 1.6) {
    const bow = Math.min(34, 18 + Math.abs(dy) * 0.06)
    const s = { x: a.x, y: ac.y }
    const e = { x: b.x, y: bc.y }
    return `M ${s.x} ${s.y} C ${s.x - bow} ${s.y}, ${e.x - bow} ${e.y}, ${e.x} ${e.y}`
  }
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const start = horizontal
    ? { x: dx >= 0 ? a.x + a.w : a.x, y: ac.y }
    : { x: ac.x, y: dy >= 0 ? a.y + a.h : a.y }
  const end = horizontal
    ? { x: dx >= 0 ? b.x : b.x + b.w, y: bc.y }
    : { x: bc.x, y: dy >= 0 ? b.y : b.y + b.h }
  const bow = horizontal ? Math.max(24, Math.abs(end.x - start.x) / 2) : Math.max(24, Math.abs(end.y - start.y) / 2)
  const c1 = horizontal ? { x: start.x + (dx >= 0 ? bow : -bow), y: start.y } : { x: start.x, y: start.y + (dy >= 0 ? bow : -bow) }
  const c2 = horizontal ? { x: end.x - (dx >= 0 ? bow : -bow), y: end.y } : { x: end.x, y: end.y - (dy >= 0 ? bow : -bow) }
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`
}

export const SiteMap = memo(function SiteMap({
  pages, scenarios, wdims, linkExtra, onJump,
}: {
  /** In-scope pages, components already excluded */
  pages: PageDef[]
  /** In-scope scenarios — the arrows come from their steps */
  scenarios: Scenario[]
  wdims: Record<string, string>
  linkExtra: Record<string, string>
  /** Fit the canvas to a page's own area (the table of contents' jump) */
  onJump: (tocId: string) => void
}) {
  const navigate = useNavigate()
  const hostRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const [boxes, setBoxes] = useState<Record<string, Box>>({})
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hot, setHot] = useState<string | null>(null)

  const clusters = useMemo(() => groupPages(pages), [pages])
  const ids = useMemo(() => new Set(pages.map((p) => p.id)), [pages])
  const edges = useMemo(() => scenarioEdges(scenarios, (id) => ids.has(id)), [scenarios, ids])

  // Node geometry, measured in layout coordinates (offsets, not client rects,
  // so the canvas' zoom transform never enters the arithmetic).
  const measure = () => {
    const host = hostRef.current
    if (!host) return
    const next: Record<string, Box> = {}
    for (const [id, el] of nodeRefs.current) next[id] = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
    setBoxes(next)
    setSize({ w: host.offsetWidth, h: host.offsetHeight })
  }
  useLayoutEffect(measure, [clusters])
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={hostRef} className="relative">
      <svg className="ps-map-wires" width={size.w} height={size.h} aria-hidden>
        <defs>
          <marker id="ps-map-head" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 z" fill="var(--ps-faint)" />
          </marker>
          <marker id="ps-map-head-hot" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 z" fill="var(--ps-fg)" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = boxes[e.from]
          const b = boxes[e.to]
          if (!a || !b) return null
          const key = `${e.from}→${e.to}`
          const on = hot === key
          return (
            <g
              key={key}
              className="ps-map-wire"
              data-on={on || undefined}
              onPointerEnter={() => setHot(key)}
              onPointerLeave={() => setHot((h) => (h === key ? null : h))}
            >
              <title>{`${e.scenarios.join(" · ")}`}</title>
              <path d={edgePath(a, b)} className="ps-map-hit" />
              <path d={edgePath(a, b)} markerEnd={`url(#ps-map-head${on ? "-hot" : ""})`} />
            </g>
          )
        })}
      </svg>

      {/* The rows sit above the wires but let the pointer through between nodes,
          so an arrow in the gap is hoverable and a node always wins its click. */}
      <div className="ps-map-rows relative flex flex-col" style={{ gap: GAP_Y }}>
        {clusters.map((cluster) => (
          <div key={cluster.group ?? "ungrouped"}>
            {cluster.group && <div className="ps-map-row-label">{cluster.group}</div>}
            <div className="flex flex-wrap items-start" style={{ gap: `${GAP_Y}px ${GAP_X}px` }}>
              {cluster.pages.map((page) => {
                // The first pinned instance the active workspace allows, else the
                // page's defaults — the thumbnail the scan is most likely to have.
                const inst = (page.instances ?? []).find((i) => Object.entries(workspaceOverridesFor(page, wdims)).every(([d, v]) => !i.dims[d] || i.dims[d] === v))
                const dims = resolveDims(page, { ...inst?.dims, ...workspaceOverridesFor(page, wdims) })
                const wired = edges.some((e) => e.from === page.id || e.to === page.id)
                return (
                  <button
                    key={page.id}
                    ref={(el) => {
                      if (el) nodeRefs.current.set(page.id, el)
                      else nodeRefs.current.delete(page.id)
                    }}
                    className="ps-map-node"
                    style={{ width: NODE_W }}
                    title={wired ? page.label : `${page.label} (no scenario walks through it)`}
                    onClick={(e) => {
                      if (e.shiftKey || e.altKey || e.metaKey) navigate(pageUrl(page.id, dims, linkExtra))
                      else onJump(`page:${page.id}`)
                    }}
                  >
                    <span className="ps-map-thumb" style={{ height: Math.round((NODE_W * pageViewport().height) / pageViewport().width) }}>
                      <span className="ps-map-thumb-label" aria-hidden>{page.label}</span>
                      <img src={snapshotUrl(page, dims)} alt="" draggable={false} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                    </span>
                    <span className="ps-map-label">{page.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})
