import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowRight, ChevronRight, RotateCcw, Minus, Plus, Maximize2, Layers, BookOpen, MessageSquare, PencilRuler, StickyNote, Boxes, Crosshair, Map as MapIcon, MessageCircle, Play, Waypoints,
  Pencil, Undo2, Redo2, GalleryHorizontalEnd, FileText, Image as ImageIcon, CheckCircle2,
} from "../icons"
import { cn } from "../cn"
import {
  manifest, getPage, getTemplate, resolveDims, pageUrl, valueLabel, dimensionLabel,
  isWorkspaceDim, workspaceDimensions, workspaceDimsFromParams, workspaceCarry, workspaceKey,
  workspaceOverridesFor, pageInWorkspace, scenarioInWorkspace, varyingDims, varyingAcross, groupPages, instanceKey,
  pageViewport, frameOf, stateLabel, STATE_DIM,
  pageFigures, standaloneBoards, snapshotUrl,
} from "../manifest"
import { PanZoom, clampK, type PanZoomHandle, type Transform } from "./PanZoom"
import { cardHit } from "./cardHit"
import { CanvasInspectContext, CanvasViewportContext, type CanvasInspect, type CanvasViewport } from "./visibility"
import { InstanceCard } from "./InstanceCard"
import { CanvasNotes } from "./CanvasNotes"
import { AnatomyCard } from "./AnatomyCard"
import { CanvasToc } from "./CanvasToc"
import { SiteMap } from "./SiteMap"
import { BoardCard } from "./BoardCard"
import { CoverageBoard } from "./CoverageBoard"
import { PageSwitcher } from "../boards/PageSwitcher"
import { Inspector } from "../overlays/Inspector"
import { CommentsPanel } from "../comments/CommentsPanel"
import { useComments, MAP_BOARD } from "../comments/store"
import { SurfaceCommentLayer } from "../comments/SurfaceCommentLayer"
import { useScan } from "../snapshots"
import { EditableText } from "../EditableText"
import { StatusControl } from "../status"
import { useDev, patchManifest } from "../dev"
import { useBoardEditor } from "../boards/editor"
import { AddPalette } from "../boards/Palette"
import { mapSpace, useMapAreas } from "./mapLayer"
import { readDisclosure, isOpen, setOpen, setAll, overviewDims, stateCount, runsOf, shelfWidth, shelfColumns, type DisclosureKind, type ShelfItem, type Universe } from "./disclosure"
import { useManifestRev } from "../manifest"
import { PsButton, PsDivider, Chip, ThemeToggle, MockNotice, HelpButton, ShortcutsSheet, WorkspaceDims, useChrome, useHotkeys, cycleTheme } from "../chrome"
import type { BoardDef, BoardFile, PageDef, Scenario } from "../types"

const INITIAL: Transform = { x: 300, y: 110, k: 0.55 }

const fidelityTone: Record<string, string> = {
  static: "#a1a1aa",
  navigable: "#60a5fa",
  interactive: "#f59e0b",
}

function parseView(v: string | null): Transform | null {
  if (!v) return null
  const [x, y, k] = v.split(",").map(Number)
  if ([x, y, k].some((n) => !Number.isFinite(n))) return null
  return { x, y, k: clampK(k) }
}

// Target on-canvas widths, pinned to what they've always rendered at the
// legacy 1280-wide default viewport, so widening `viewer.viewport` scales
// every card down to match rather than growing it 1.5×.
const CARD_TARGET_W = 256
const LANE_CARD_TARGET_W = 179.2
const ANATOMY_CARD_TARGET_W = 384
/** Most cards in one row before the row wraps. */
const MAX_ROW = 6
/** Flow steps are thumbnails, smaller than page cards. */
const STEP_THUMB_W = 150
const STEPS_PER_ROW = 6
/** A folded flow shows its first and last step this wide. */
const LANE_PEEK_W = 96
/** Gap between areas on the map. */
const AREA_GAP = 40
/** An area's padding and border, both sides (.ps-area). */
const AREA_PAD = 90

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

function cardScale(page: PageDef) {
  return Math.min(0.6, CARD_TARGET_W / frameOf(page).width)
}

/** A named region of the canvas. The title pill scales with 1/zoom so it reads from orbit. */
function Area({
  title, kind, icon, tocId, children, className, onTitleDoubleClick, pillMax,
}: {
  /** Widest the title pill may look on screen (canvas px): a tile's pill never runs into its neighbour */
  pillMax?: number
  title: React.ReactNode
  kind?: string
  icon: React.ReactNode
  tocId?: string
  children: React.ReactNode
  className?: string
  /** Double-clicking the title opens what the area folds away */
  onTitleDoubleClick?: () => void
}) {
  return (
    <section className={cn("ps-area", className)} data-toc={tocId}>
      <div
        className="ps-area-title"
        data-ps-ui
        onDoubleClick={
          onTitleDoubleClick &&
          ((e) => {
            e.stopPropagation()
            onTitleDoubleClick()
          })
        }
      >
        <span style={pillMax ? { maxWidth: `calc(${pillMax}px / var(--ps-inv-big, 1))` } : undefined}>
          {icon}
          <span className="ps-area-name">{title}</span>
          {kind && <span className="ps-area-kind">{kind}</span>}
        </span>
      </div>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* One page's cards. A plain row by default (wrapping after MAX_ROW),  */
/* labelled with state names or the axes that differ — one card,       */
/* labelled with nothing, being the normal case. A coverage matrix     */
/* (axes as headers, unpinned cells as dashed placeholders) only when  */
/* the page asks for `layout: "matrix"` and two axes vary.             */
/* ------------------------------------------------------------------ */

/**
 * Where a card's note lives in stavy.json. A named state owns its note (the
 * instance copy made when the manifest is read carries the same text); an
 * instance with a note of its own, or a page without states, edits the
 * instance entry. No path when the file has no such entry to edit.
 */
/** A named state's status and where to set it (only pages with named states have per-state status). */
function stateStatus(page: PageDef, stateId: string | undefined) {
  const st = stateId ? page.states?.find((x) => x.id === stateId) : undefined
  if (!st) return {}
  return { status: st.status, ready: st.ready, statusPath: ["pages", page.id, "states", st.id, "status"] as (string | number)[] }
}

function notePathOf(page: PageDef, inst: { idx: number; note?: string; full: Record<string, string> }): (string | number)[] | undefined {
  const st = page.states?.find((x) => x.id === inst.full[STATE_DIM])
  if (st && (inst.note === undefined || inst.note === st.note)) return ["pages", page.id, "states", st.id, "note"]
  return page.instances ? ["pages", page.id, "instances", inst.idx, "note"] : undefined
}

/**
 * A screen's "N states" control: on the folded card's corner, or first in the
 * open screen's header. Zoom-constant like the other labels. Nothing to show
 * for a screen with one state, no anatomy and no figures.
 */
function FoldToggle({ page, wdims, open, onToggle, keptOpen }: {
  page: PageDef
  wdims: Record<string, string>
  open: boolean
  /** Fold or unfold; `fit` also fits the area afterwards */
  onToggle?: (open: boolean, fit?: boolean) => void
  /** Why this screen can't fold right now (map notes sit on it, edit mode) */
  keptOpen?: string
}) {
  const n = stateCount(page, wdims)
  const figures = pageFigures(page.id).length
  const more = [
    n > 1 && `${n} states`,
    (page.annotations?.length ?? 0) > 0 && "anatomy",
    figures > 0 && (figures === 1 ? "a figure" : `${figures} figures`),
  ].filter(Boolean) as string[]
  if (!more.length) return null
  const label = n > 1 ? more[0] : more.join(" · ").replace(/^a /, "").replace(/^./, (c) => c.toUpperCase())
  const what = more.join(", ").replace(/, ([^,]*)$/, " and $1")
  return (
    <button
      type="button"
      className="ps-disclose"
      aria-expanded={open}
      disabled={!onToggle}
      title={keptOpen ?? (open ? "Show only the first state" : `Show ${what}`)}
      onClick={(e) => {
        // The second click of a double-click must not fold it straight back.
        if (e.detail > 1) return
        onToggle?.(!open)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onToggle?.(true, true)
      }}
    >
      <span>{label}</span>
      {onToggle && <ChevronRight />}
    </button>
  )
}

const PageGroup = memo(function PageGroup({
  page, showNotes, wireframe, wdims, linkExtra, figures, open, fold,
}: {
  page: PageDef
  showNotes: boolean
  wireframe: boolean
  /** Active workspace assignment (SPEC §1.1) */
  wdims: Record<string, string>
  /** Query params every link out of the canvas must carry */
  linkExtra: Record<string, string>
  /** Boards anchored to this page (SPEC §1.7) */
  figures: BoardDef[]
  /** All states (plus anatomy and figures), or just the overview card */
  open: boolean
  /** The "N states" control (FoldToggle) */
  fold?: React.ReactNode
}) {
  const navigate = useNavigate()
  const writable = !!useDev()?.writable
  const template = getTemplate(page.template)
  const scale = cardScale(page)
  const fr = frameOf(page)
  const w = Math.round(fr.width * scale)
  const h = Math.round(fr.height * scale)

  const wOver = useMemo(() => workspaceOverridesFor(page, wdims), [page, wdims])

  const layout = useMemo(() => {
    // Instances pinned to another value of a workspace axis belong to another
    // world; the rest are rendered at the active value.
    const instances = (page.instances ?? [{ dims: {} }])
      .map((i, idx) => ({ ...i, idx }))
      .filter((i) => Object.entries(wOver).every(([d, v]) => !i.dims[d] || i.dims[d] === v))
      .map((i) => ({ ...i, full: resolveDims(page, { ...i.dims, ...wOver }) }))
    // Only what differs between these cards is worth drawing (a workspace axis
    // is fixed for the whole canvas, so it never counts).
    const varying = varyingDims(page, instances.map((i) => i.full))
    // A matrix is opt-in (`layout: "matrix"`) and needs two axes to cross.
    const matrix = page.layout === "matrix" && varying.length >= 2
    const colDim = matrix ? varying[0] : undefined
    const rowDim = matrix ? varying[1] : undefined
    const extraVarying = matrix ? varying.slice(2) : []
    const groups = new Map<string, typeof instances>()
    for (const inst of instances) {
      const key = extraVarying.map((d) => `${d}=${inst.full[d]}`).join("|")
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(inst)
    }
    // A single axis reads better as a row in its declared order than as a
    // one-row matrix with a header over every column.
    const row = varying.length
      ? [...instances].sort((a, b) => {
          for (const d of varying) {
            const diff = page.dimensions[d].indexOf(a.full[d]) - page.dimensions[d].indexOf(b.full[d])
            if (diff) return diff
          }
          return 0
        })
      : instances
    return { instances, varying, matrix, colDim, rowDim, extraVarying, groups, row }
  }, [page, wOver])

  const { instances, varying, matrix, colDim, rowDim, extraVarying, groups, row } = layout
  const cols = colDim ? page.dimensions[colDim] : [null]
  const rows = rowDim ? page.dimensions[rowDim] : [null]

  const n = instances.length
  const status = <StatusControl status={page.status} ready={page.ready} onChange={writable ? (v) => patchManifest(["pages", page.id, "status"], v) : undefined} />

  if (!open) {
    // The overview: one card (the screen's first state), the rest stacked behind it.
    // Its "N states" control (FoldToggle) sits on the stack.
    const firstKey = instanceKey(page.id, overviewDims(page, wdims))
    const first = instances.find((i) => instanceKey(page.id, i.full) === firstKey) ?? instances[0]
    return (
      <div>
        {/* Status stays settable from the overview (a screen is marked ready here). */}
        {(page.status || writable) && (
          <div className="flex items-center gap-2 mb-1 ps-fold-status" data-empty={page.status ? undefined : "true"}>
            <span className="ps-zl">{status}</span>
          </div>
        )}
        {first && (
          <div className="relative" style={{ width: w, marginTop: n > 1 ? 14 : 0 }}>
            {/* On the stack's corner, zoom-constant, growing over the card rather than out of the tile. */}
            {fold && (
              <span className="ps-zl ps-zl-tr ps-fold-badge" style={{ top: n > 1 ? -18 : -8 }}>
                {fold}
              </span>
            )}
            {n > 1 && (
              <>
                <div className="ps-stack-layer" aria-hidden style={{ left: 16, top: -10, width: w - 32, height: h }} />
                <div className="ps-stack-layer" aria-hidden style={{ left: 8, top: -5, width: w - 16, height: h }} />
              </>
            )}
            <InstanceCard
              pageId={page.id}
              dims={first.full}
              label={page.states ? stateLabel(page, first.full[STATE_DIM]) : undefined}
              labelPath={page.states ? ["pages", page.id, "states", first.full[STATE_DIM], "label"] : undefined}
              {...stateStatus(page, first.full[STATE_DIM])}
              scale={scale}
              frame={page.frame}
              annotations={page.annotations}
              showPins={showNotes}
              wireframe={wireframe}
              href={pageUrl(page.id, first.full, linkExtra)}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="ps-zl">
          <h3 className="flex items-center gap-2">
            {fold}
            {template && <Chip sm mono>{template.label}</Chip>}
            {page.fidelity && (
              <Chip sm title="Fidelity rung (see SKILL.md)">
                <span className="size-1.5 rounded-full" style={{ background: fidelityTone[page.fidelity] }} />
                {page.fidelity}
              </Chip>
            )}
            <span className="flex items-center gap-1">
              {Object.entries(page.dimensions).filter(([d]) => !isWorkspaceDim(d) && !(n > 1 && d === STATE_DIM)).map(([d, vs]) =>
                d === STATE_DIM ? (
                  <span key={d} className="ps-chip ps-chip-sm font-normal">
                    {vs.length} state{vs.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span key={d} className="ps-chip ps-chip-sm font-normal">
                    <span className="ps-chip-k">{dimensionLabel(d)}</span> {vs.length}
                  </span>
                )
              )}
            </span>
            {status}
          </h3>
        </span>
      </div>
      {page.description && (
        <p className="ps-sub mb-4 max-w-2xl">
          <EditableText path={["pages", page.id, "description"]} value={page.description} />
        </p>
      )}

      <div className="flex flex-col gap-8">
        {!matrix && (
          <div className="flex flex-col gap-6">
            {chunk(row, MAX_ROW).map((rw, ri) => (
              <div key={ri} className="flex items-start gap-5">
                {rw.map((inst) => (
                  <InstanceCard
                    key={instanceKey(page.id, inst.full)}
                    pageId={page.id}
                    dims={inst.full}
                    label={page.states ? stateLabel(page, inst.full[STATE_DIM]) : undefined}
                    note={inst.note ?? page.states?.find((x) => x.id === inst.full[STATE_DIM])?.note}
                    labelPath={page.states ? ["pages", page.id, "states", inst.full[STATE_DIM], "label"] : undefined}
                    notePath={notePathOf(page, inst)}
                    {...stateStatus(page, inst.full[STATE_DIM])}
                    scale={scale}
                    frame={page.frame}
                    chips={varying.filter((d) => d !== STATE_DIM)}
                    annotations={page.annotations}
                    showPins={showNotes}
                    wireframe={wireframe}
                    href={pageUrl(page.id, inst.full, linkExtra)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        {matrix && [...groups.entries()].map(([groupKey, insts], gi) => {
          const groupDims = Object.fromEntries(groupKey ? groupKey.split("|").map((kv) => kv.split("=")) : [])
          const find = (c: string | null, r: string | null) =>
            insts.find((i) => (!colDim || i.full[colDim] === c) && (!rowDim || i.full[rowDim] === r))
          // The first group shows the full declared matrix (coverage); secondary
          // groups only show the rows/columns they actually pin.
          const gCols = gi === 0 || !colDim ? cols : cols.filter((c) => insts.some((i) => i.full[colDim] === c))
          const gRows = gi === 0 || !rowDim ? rows : rows.filter((r) => insts.some((i) => i.full[rowDim] === r))
          return (
            <div key={groupKey}>
              {extraVarying.length > 0 && (
                <div className="flex items-center gap-1.5 mb-3">
                  {extraVarying.map((d) => (
                    <Chip key={d} sm>
                      <span className="ps-chip-k">{dimensionLabel(d)}</span> {valueLabel(d, groupDims[d])}
                    </Chip>
                  ))}
                </div>
              )}
              <div
                className="grid items-start"
                style={{
                  gridTemplateColumns: `${rowDim ? "120px " : ""}repeat(${gCols.length}, ${w}px)`,
                  columnGap: 20,
                  rowGap: 18,
                }}
              >
                {colDim && (
                  <>
                    {rowDim && <div />}
                    {gCols.map((c) => (
                      <div key={c!} className="h-5 flex items-end">
                        <span className="ps-zl">
                          <span className="ps-chip ps-chip-sm">{valueLabel(colDim, c!)}</span>
                        </span>
                      </div>
                    ))}
                  </>
                )}
                {gRows.map((r) => (
                  <RowFragment
                    key={r ?? "row"}
                    page={page}
                    r={r}
                    cols={gCols}
                    colDim={colDim}
                    rowDim={rowDim}
                    groupDims={groupDims}
                    find={find}
                    w={w}
                    h={h}
                    scale={scale}
                    showNotes={showNotes}
                    wireframe={wireframe}
                    wOver={wOver}
                    linkExtra={linkExtra}
                    onOpen={(dims) => navigate(pageUrl(page.id, dims, linkExtra))}
                  />
                ))}
              </div>
            </div>
          )
        })}
        {(page.annotations?.length ?? 0) > 0 && (
          <div>
            {/* The whole label scales with 1/zoom, not only the chip: scaling
                the chip alone slides it over the words next to it. */}
            <div className="ps-sub mb-3">
              <span className="ps-zl inline-flex items-center gap-2">
                <span className="ps-chip ps-chip-sm">Anatomy</span>
                what each part of the screen does
              </span>
            </div>
            <AnatomyCard page={page} overrides={wOver} scale={page.kind === "component" ? Math.min(0.8, 420 / frameOf(page).width) : ANATOMY_CARD_TARGET_W / pageViewport().width} />
          </div>
        )}
        {/* Figures last: the same composition as the anatomy, for the parts of
            the screen that never earn a URL of their own (SPEC §1.7). */}
        {figures.length > 0 && (
          <div>
            <div className="ps-sub mb-3">
              <span className="ps-zl inline-flex items-center gap-2">
                <span className="ps-chip ps-chip-sm">{figures.length === 1 ? "Figure" : "Figures"}</span>
                parts of this screen that have no URL of their own
              </span>
            </div>
            <div className="flex flex-wrap items-start gap-10">
              {figures.map((b) => (
                <div key={b.id} data-toc={`board:${b.id}`}>
                  <BoardCard board={b} figure />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

function RowFragment({
  page, r, cols, colDim, rowDim, groupDims, find, w, h, scale, showNotes, wireframe, wOver, linkExtra, onOpen,
}: {
  page: PageDef
  r: string | null
  cols: (string | null)[]
  colDim?: string
  rowDim?: string
  groupDims: Record<string, string>
  find: (c: string | null, r: string | null) => { idx: number; full: Record<string, string>; note?: string } | undefined
  w: number
  h: number
  scale: number
  showNotes: boolean
  wireframe: boolean
  wOver: Record<string, string>
  linkExtra: Record<string, string>
  onOpen: (dims: Record<string, string>) => void
}) {
  return (
    <>
      {rowDim && (
        <div className="flex items-start justify-end pr-3" style={{ height: h }}>
          <span className="ps-zl ps-zl-right mt-2">
            <span className="ps-chip ps-chip-sm">{valueLabel(rowDim, r!)}</span>
          </span>
        </div>
      )}
      {cols.map((c) => {
        const inst = find(c, r)
        if (inst) {
          return (
            <InstanceCard
              key={c ?? "one"}
              pageId={page.id}
              dims={inst.full}
              note={inst.note}
              notePath={notePathOf(page, inst)}
              scale={scale}
              frame={page.frame}
              annotations={page.annotations}
              showPins={showNotes}
              wireframe={wireframe}
              href={pageUrl(page.id, inst.full, linkExtra)}
            />
          )
        }
        const dims = resolveDims(page, {
          ...groupDims,
          ...(colDim ? { [colDim]: c! } : {}),
          ...(rowDim ? { [rowDim]: r! } : {}),
          ...wOver,
        })
        return (
          <button
            key={c ?? "one"}
            className="ps-cell-empty"
            style={{ width: w, height: h }}
            title="Declared but not pinned — click to open this variant anyway"
            onClick={() => onOpen(dims)}
          >
            not pinned
          </button>
        )
      })}
    </>
  )
}


/** One flow: numbered step thumbnails wrapped onto rows, collapsible. */
/** A folded flow's peek: its first and last step, small, with the count between. */
function LanePeek({ steps, stepDims, onOpen }: { steps: Array<{ i: number; page?: PageDef }>; stepDims: Record<string, string>[]; onOpen: () => void }) {
  const ends = steps.length > 1 ? [steps[0], steps[steps.length - 1]] : steps
  const thumb = (x: { i: number; page?: PageDef }) => {
    const fr = frameOf(x.page!)
    return (
      <span className="ps-lane-thumb" style={{ width: LANE_PEEK_W, height: Math.round((LANE_PEEK_W * fr.height) / fr.width) }}>
        <img src={snapshotUrl(x.page!, stepDims[x.i])} alt="" draggable={false} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
      </span>
    )
  }
  return (
    <button type="button" className="ps-lane-peek" title="Show every step" onClick={onOpen}>
      {thumb(ends[0])}
      {ends.length > 1 && (
        <>
          <span className="ps-lane-peek-mid">
            <ArrowRight />
            {steps.length > 2 && <span>{steps.length - 2} more</span>}
            {steps.length > 2 && <ArrowRight />}
          </span>
          {thumb(ends[1])}
        </>
      )}
    </button>
  )
}

function ScenarioLane({ sc, wdims, linkExtra, open, onToggle }: {
  sc: Scenario
  wdims: Record<string, string>
  linkExtra: Record<string, string>
  open: boolean
  onToggle?: (open: boolean) => void
}) {
  const setOpen = (v: boolean) => onToggle?.(v)
  // Every step resolved once: the lane labels only the axes that move between
  // steps (a lifecycle advancing), never the ones that hold still.
  const stepDims = sc.steps.map((st) => {
    const p = getPage(st.page)
    return p ? resolveDims(p, { ...st.dims, ...workspaceOverridesFor(p, wdims) }) : {}
  })
  const laneDims = varyingAcross(stepDims)
  const steps = sc.steps.map((st, i) => ({ st, i, page: getPage(st.page) })).filter((x) => x.page)
  return (
    <div data-toc={`scenario:${sc.id}`}>
      <span className="ps-zl">
        <div className="flex items-center gap-2 mb-1">
          <button className="ps-lane-toggle" data-open={open ? "true" : undefined} aria-expanded={open} title={open ? "Collapse this flow" : "Expand this flow"} onClick={() => setOpen(!open)}>
            <ChevronRight />
          </button>
          <h3 className="ps-h3"><EditableText path={["scenarios", sc.id, "label"]} value={sc.label} /></h3>
          <Chip sm>{sc.steps.length} step{sc.steps.length === 1 ? "" : "s"}</Chip>
          {sc.persona && <Chip sm className="capitalize">{sc.persona}</Chip>}
          {sc.refs?.map((r) => (
            <Chip key={r} sm mono>{r}</Chip>
          ))}
        </div>
      </span>
      {!open && steps.length > 0 && <LanePeek steps={steps} stepDims={stepDims} onOpen={() => setOpen(true)} />}
      {open && sc.description && (
        <p className="ps-sub mb-4 max-w-2xl">
          <EditableText path={["scenarios", sc.id, "description"]} value={sc.description} />
        </p>
      )}
      {open && (
        <div className="flex flex-col gap-5">
          {chunk(steps, STEPS_PER_ROW).map((rw, ri) => (
            <div key={ri} className="flex items-start gap-3">
              {rw.map(({ st, i, page }, k) => {
                const dims = stepDims[i]
                return (
                  <div key={i} className="flex items-start gap-3">
                    {k > 0 && <ArrowRight className="size-3.5 mt-10 shrink-0" style={{ color: "var(--ps-faint)" }} />}
                    <div className="relative">
                      <span
                        className="absolute -top-1.5 -left-1.5 z-10 size-4 rounded-full flex items-center justify-center text-[10px] font-semibold pointer-events-none"
                        style={{ background: "var(--ps-accent)", color: "var(--ps-accent-fg)" }}
                      >
                        {i + 1}
                      </span>
                      <InstanceCard
                        pageId={st.page}
                        dims={dims}
                        scale={page!.kind === "component" ? cardScale(page!) * 0.6 : STEP_THUMB_W / pageViewport().width}
                        frame={page!.frame}
                        scope="scenarios"
                        chips={laneDims.filter((d) => d in page!.dimensions && d !== STATE_DIM)}
                        label={st.title}
                        note={st.note}
                        labelPath={st.title ? ["scenarios", sc.id, "steps", i, "title"] : undefined}
                        notePath={["scenarios", sc.id, "steps", i, "note"]}
                        href={pageUrl(st.page, dims, { tour: sc.id, ts: String(i), ...linkExtra })}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

const MAP_LAYER_EMPTY: BoardFile = { title: "Map", items: [] }

export function CanvasPage() {
  const manifestRev = useManifestRev() // re-render when a title or note was edited
  const [sp, setSp] = useSearchParams()
  const { hidden } = useChrome()
  const [t, setT] = useState<Transform>(() => parseView(sp.get("v")) ?? INITIAL)
  const pz = useRef<PanZoomHandle>(null)
  const zoomLabel = useRef<HTMLSpanElement>(null)
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)
  const contentElRef = useRef<HTMLDivElement | null>(null)
  const initialT = useRef(t)

  // Lazy card mounting: cards subscribe to the live transform and mount when
  // they come near the viewport (see visibility.tsx for why not IO).
  const vpListeners = useRef<Set<() => void>>(new Set())
  const canvasViewport = useMemo<CanvasViewport>(
    () => ({
      get: () => pz.current?.get() ?? initialT.current,
      subscribe: (fn) => {
        vpListeners.current.add(fn)
        return () => {
          vpListeners.current.delete(fn)
        }
      },
      viewportEl: () => contentElRef.current?.parentElement ?? null,
      contentEl: () => contentElRef.current,
    }),
    []
  )

  const { theme, setTheme, setHidden } = useChrome()
  const dev = useDev()
  const writable = !!dev?.writable
  const editMode = writable && sp.get("e") === "1"
  const { open: openComments, comments: allComments } = useComments()
  const scanAll = useScan("all")
  const wKey = workspaceKey(sp)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wdims = useMemo(() => workspaceDimsFromParams(sp), [wKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wCarry = useMemo(() => workspaceCarry(sp), [wKey])
  const showNotes = sp.get("notes") === "1"
  const showMap = sp.get("map") !== "0"
  const wireframe = sp.get("w") === "1"
  const inspect = sp.get("i") === "1"
  const liveMode = sp.get("live") === "1"
  const commentsOpen = sp.get("comments") === "1"
  // Comments on the map: a card (by its instance key) or a point.
  const [placing, setPlacing] = useState(false)
  const openCommentId = sp.get("c")
  const setCommentParam = (cid: string | null) => {
    const next = new URLSearchParams(sp)
    if (cid) next.set("c", cid)
    else next.delete("c")
    setSp(next, { replace: true })
  }
  const instanceIdOf = useCallback((el: Element) => el.getAttribute("data-instance"), [])
  const [hold, setHold] = useState<HTMLIFrameElement | null>(null)
  const inspectCtx = useMemo<CanvasInspect>(() => ({ on: inspect, live: liveMode, hold }), [inspect, liveMode, hold])

  const setFlag = (k: string, on: boolean) => {
    const next = new URLSearchParams(sp)
    if (on) next.set(k, "1")
    else next.delete(k)
    setSp(next, { replace: true })
  }

  useEffect(() => {
    const id = setTimeout(() => {
      const v = `${Math.round(t.x)},${Math.round(t.y)},${t.k.toFixed(3)}`
      if (sp.get("v") === v) return
      // From the live URL, not this render's params (nor the router's updater,
      // which sees the same stale copy): a fold or "All states" written in the
      // meantime must survive the viewport write.
      const next = new URLSearchParams(window.location.search)
      next.set("v", v)
      setSp(next, { replace: true })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  // The map's own layer: notes and other free items, anchored to areas.
  // Re-measured when what is folded changes, too: areas move and resize.
  const discKey = ["states", "x", "fl", "bx", "e"].map((k) => sp.get(k) ?? "").join("|")
  const areas = useMapAreas(contentEl, pz, `${manifestRev}|${wKey}|${showMap}|${discKey}`)
  const space = useMemo(() => mapSpace(areas), [areas])
  const layer = useBoardEditor({ file: "map.json", editMode, wireframe, pz, contentElRef, space, extraBoxes: areas, fallback: MAP_LAYER_EMPTY })

  const fmtZoom = (k: number) => (k >= 1 ? `${k.toFixed(1)}×` : `${Math.round(k * 100)}%`)
  const zoomBy = (f: number) => pz.current?.zoomBy(f, true)
  const getScale = useCallback(() => pz.current?.get().k ?? initialT.current.k, [])
  const onLive = useCallback((lt: Transform) => {
    if (zoomLabel.current) zoomLabel.current.textContent = fmtZoom(lt.k)
    for (const fn of vpListeners.current) fn()
  }, [])

  useHotkeys({
    a: () => toggleAll(),
    m: () => setPlacing((p) => !p),
    n: () => setFlag("notes", !showNotes),
    w: () => setFlag("w", !wireframe),
    i: () => setFlag("i", !inspect),
    l: () => setFlag("live", !liveMode),
    t: () => setTheme(cycleTheme(theme)),
    e: () => writable && setFlag("e", !editMode),
    "0": () => pz.current?.set(INITIAL, true),
    "1": () => pz.current?.zoomBy(1 / (pz.current.get().k || 1), true),
    "2": () => pz.current?.fitAll(true),
    "+": () => zoomBy(1.5),
    "=": () => zoomBy(1.5),
    "-": () => zoomBy(1 / 1.5),
    Escape: () => {
      if (placing) setPlacing(false)
      else if (openCommentId) setCommentParam(null)
      else if (inspect) setFlag("i", false)
      else if (commentsOpen) setFlag("comments", false)
      else if (layer.editing) layer.setEditing(null)
      else if (layer.selection.size) layer.setSelection(new Set())
      else setHidden(false)
    },
  })

  // Inspect on the canvas: the pointer lands on a card's shield; resolve it to
  // the element under it inside that card's (live) frame.
  const hit = cardHit

  const linkExtra = useMemo(
    () => ({ ...wCarry, ...(wireframe ? { w: "1" } : {}) }),
    [wCarry, wireframe]
  )

  // Pages that declare a workspace axis and exclude its active value are not
  // part of this world; pages that don't declare it are unaffected (SPEC §1.1).
  const inScope = manifest.pages.filter((p) => pageInWorkspace(p, wdims))
  const outOfScopeCount = manifest.pages.length - inScope.length
  const pages = inScope.filter((p) => p.kind !== "component")
  const components = inScope.filter((p) => p.kind === "component")
  // Sections (SPEC §1.3): page areas cluster by `group`, ungrouped last.
  const sections = groupPages(pages)
  const scenarios = manifest.scenarios.filter((sc) => scenarioInWorkspace(sc, wdims))
  const hasCoverage = (manifest.requirements?.length ?? 0) > 0
  const screens = [...sections.flatMap((s) => s.pages), ...components]

  /* ---------------- progressive disclosure (disclosure.ts) ---------------- */

  const universe: Universe = {
    screens: screens.map((p) => p.id),
    lanes: scenarios.map((s) => s.id),
    boards: [...(hasCoverage ? ["coverage"] : []), ...standaloneBoards.map((b) => b.id)],
  }
  const disc = readDisclosure(sp)
  // Notes are authored against the full map, so edit mode shows everything.
  if (editMode) disc.all = true
  // A map note anchored to a screen keeps it open: the note was placed
  // relative to the open screen and would land on other cards otherwise.
  const noted = new Set(
    (layer.stored?.items ?? []).flatMap((it) => { const a = (it as { anchor?: string }).anchor; return a?.startsWith("page:") ? [a.slice(5)] : [] })
  )
  const screenOpen = (id: string) => isOpen(disc, "screens", id) || noted.has(id)
  const keptOpenWhy = (id: string) =>
    editMode ? "Edit mode shows every state" : noted.has(id) && !isOpen(disc, "screens", id) ? "Kept open: a map note sits on this screen" : undefined

  // After a fold or unfold, the area the person acted on stays where it was on
  // screen; the rest of the map reflows around it.
  const placeHold = useRef<{ toc: string; left: number; top: number } | null>(null)
  const areaEl = (toc: string) => contentEl?.querySelector<HTMLElement>(`[data-toc="${CSS.escape(toc)}"]`) ?? null
  const holdPlace = (toc: string | null) => {
    const el = toc ? areaEl(toc) : null
    if (!el) return
    const r = el.getBoundingClientRect()
    placeHold.current = { toc: toc!, left: r.left, top: r.top }
  }
  useLayoutEffect(() => {
    const h = placeHold.current
    if (!h || !pz.current) return
    placeHold.current = null
    const el = areaEl(h.toc)
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = r.left - h.left
    const dy = r.top - h.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
    const cur = pz.current.get()
    pz.current.set({ ...cur, x: cur.x - dx, y: cur.y - dy })
  })
  /** The area under the middle of the window: what "All states" keeps in place. */
  const centerArea = () => {
    const vp = contentEl?.parentElement?.getBoundingClientRect()
    if (!vp || !contentEl) return null
    const cx = vp.left + vp.width / 2
    const cy = vp.top + vp.height / 2
    let best: string | null = null
    let bestD = Infinity
    for (const el of contentEl.querySelectorAll<HTMLElement>("section.ps-area[data-toc]")) {
      const r = el.getBoundingClientRect()
      const d = Math.hypot(Math.max(r.left - cx, 0, cx - r.right), Math.max(r.top - cy, 0, cy - r.bottom))
      if (d < bestD) {
        bestD = d
        best = el.dataset.toc!
      }
    }
    return best
  }

  // Fits wait for the render that unfolds their target.
  const pendingFit = useRef<string | null>(null)
  const fitNow = useCallback((target: string) => {
    let el: HTMLElement | null = null
    if (target.startsWith("inst:")) {
      const key = target.slice(5)
      el = contentEl?.querySelector<HTMLElement>(`[data-toc="${CSS.escape(`page:${key.split("?")[0]}`)}"] [data-instance="${CSS.escape(key)}"]`) ?? null
    } else el = contentEl?.querySelector<HTMLElement>(`[data-toc="${CSS.escape(target)}"]`) ?? null
    if (!el || !pz.current) return false
    pz.current.fitTo(el, true)
    el.setAttribute("data-flash", "true")
    setTimeout(() => el.removeAttribute("data-flash"), 1200)
    return true
  }, [contentEl])
  useEffect(() => {
    const target = pendingFit.current
    if (target && fitNow(target)) pendingFit.current = null
  })

  /** What must be open for a jump target to be on the map. */
  const needFor = (target: string): { kind: DisclosureKind; id: string } | null => {
    if (target.startsWith("board:")) {
      const id = target.slice(6)
      const fig = manifest.boards?.find((b) => b.id === id && b.page)
      return fig ? { kind: "screens", id: fig.page! } : { kind: "boards", id }
    }
    if (target.startsWith("inst:")) {
      const key = target.slice(5)
      const page = getPage(key.split("?")[0])
      if (!page || key === instanceKey(page.id, overviewDims(page, wdims))) return null
      return { kind: "screens", id: page.id }
    }
    return null
  }
  const opened = (need: { kind: DisclosureKind; id: string }) =>
    need.kind === "screens" ? screenOpen(need.id) : isOpen(disc, need.kind, need.id)

  // Zoom the viewport to fit a section, a board or a state, unfolding it first.
  const jumpTo = (target: string) => {
    const need = needFor(target)
    if (need && !opened(need)) {
      pendingFit.current = target
      setSp(setOpen(sp, need.kind, [need.id], true, universe), { replace: true })
      return
    }
    fitNow(target)
  }

  // Stable for the memoised site map; always calls the current jumpTo.
  const jumpRef = useRef(jumpTo)
  jumpRef.current = jumpTo
  const onJump = useCallback((target: string) => jumpRef.current(target), [])

  const toggle = (kind: DisclosureKind, id: string, open: boolean, fit = false) => {
    const toc = kind === "screens" ? `page:${id}` : kind === "boards" ? "area:boards" : "area:scenarios"
    if (fit) pendingFit.current = toc
    else holdPlace(toc)
    setSp(setOpen(sp, kind, [id], open, universe), { replace: true })
  }
  const toggleAll = () => {
    if (editMode) return
    holdPlace(centerArea())
    setSp(setAll(sp, !disc.all), { replace: true })
  }

  // Deep link to one state (`at=<page>?<dims>`): unfold its screen, fit the card.
  const at = sp.get("at")
  useEffect(() => {
    if (!at || !contentEl) return
    // Dims may be partial (`expense-detail?role=finance&lifecycle=approved`): resolve them like the player does.
    const [pid, qs] = at.split("?")
    const page = getPage(pid)
    let next = new URLSearchParams(sp)
    next.delete("at")
    if (page) {
      const key = instanceKey(page.id, resolveDims(page, { ...Object.fromEntries(new URLSearchParams(qs ?? "")), ...workspaceOverridesFor(page, wdims) }))
      if (needFor(`inst:${key}`)) next = setOpen(next, "screens", [page.id], true, universe)
      pendingFit.current = `inst:${key}`
    }
    setSp(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, contentEl])

  // A comment opened on a card that is folded away unfolds its screen; the
  // comment layer then brings the pin into view.
  useEffect(() => {
    const c = openCommentId ? allComments.find((x) => x.id === openCommentId) : undefined
    if (!c || c.board !== MAP_BOARD || !c.item) return
    const need = needFor(`inst:${c.item}`)
    if (need && !opened(need)) setSp(setOpen(sp, need.kind, [need.id], true, universe), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCommentId, allComments])

  // Calm packing: folded screens are same-size tiles in a grid; open ones
  // break the grid and wrap at the same width (disclosure.ts).
  const shelf: ShelfItem[] = screens.map((p) => {
    const s = cardScale(p)
    const fr = frameOf(p)
    const cw = fr.width * s
    const ch = fr.height * s
    const open = screenOpen(p.id)
    if (!open) return { id: p.id, open, w: cw + AREA_PAD, h: ch + 150 }
    const n = p.instances?.length ?? 1
    const cols = Math.min(n, MAX_ROW)
    let w = cols * (cw + 20) - 20 + AREA_PAD
    let h = Math.ceil(n / MAX_ROW) * (ch + 70) + 130
    if (p.annotations?.length) {
      w = Math.max(w, ANATOMY_CARD_TARGET_W + 400)
      h += 340
    }
    if (pageFigures(p.id).length) h += 380
    return { id: p.id, open, w: Math.round(w), h: Math.round(h) }
  })
  const tileW = (ps: PageDef[]) => Math.max(...ps.map((p) => Math.round(frameOf(p).width * cardScale(p)))) + AREA_PAD
  const shelfW = screens.length ? shelfWidth(shelf, tileW(screens), AREA_GAP) : 0
  /** One section's areas: folded screens as a grid of tiles, open ones wrapping at the shelf width. */
  const renderScreens = (ps: PageDef[], kind: "page" | "component") =>
    runsOf(shelf.filter((it) => ps.some((p) => p.id === it.id))).map((run) => {
      const runPages = run.ids.map((id) => ps.find((p) => p.id === id)!)
      const tw = tileW(runPages)
      const areasOf = runPages.map((page) => {
        const why = keptOpenWhy(page.id)
        return (
          <Area
            key={page.id}
            title={<EditableText path={["pages", page.id, "label"]} value={page.label} />}
            kind={run.open ? kind : undefined}
            icon={kind === "page" ? <Layers /> : <Boxes />}
            tocId={`page:${page.id}`}
            pillMax={run.open ? undefined : tw - 16}
            onTitleDoubleClick={run.open ? undefined : () => toggle("screens", page.id, true, true)}
          >
            <PageGroup
              page={page}
              showNotes={showNotes}
              wireframe={wireframe}
              wdims={wdims}
              linkExtra={linkExtra}
              figures={pageFigures(page.id)}
              open={run.open}
              fold={
                <FoldToggle
                  page={page}
                  wdims={wdims}
                  open={run.open}
                  keptOpen={why}
                  onToggle={why ? undefined : (o, fit) => toggle("screens", page.id, o, fit)}
                />
              }
            />
          </Area>
        )
      })
      if (run.open)
        return (
          <div key={run.ids[0]} className="flex flex-wrap items-start" style={{ gap: AREA_GAP, maxWidth: shelfW }}>
            {areasOf}
          </div>
        )
      return (
        <div key={run.ids[0]} className="grid" style={{ gap: AREA_GAP, gridTemplateColumns: `repeat(${runCols(run.ids.length, tw)}, ${tw}px)` }}>
          {areasOf}
        </div>
      )
    })
  const runCols = (n: number, tw: number) => Math.min(n, shelfColumns(shelfW, tw, AREA_GAP))
  /** A section's width when all of it is folded (else the shelf width): its heading never runs past it. */
  const sectionW = (ps: PageDef[]) => {
    if (ps.some((p) => screenOpen(p.id))) return shelfW
    const tw = tileW(ps)
    const c = runCols(ps.length, tw)
    return c * tw + (c - 1) * AREA_GAP
  }
  const screenSections = [
    ...sections.map((s) => ({ key: s.group ?? "ungrouped", label: s.group, pages: s.pages, kind: "page" as const })),
    ...(components.length ? [{ key: "components", label: "Components", pages: components, kind: "component" as const }] : []),
  ]

  const setWorkspaceDim = (dimId: string, value: string) => {
    const dim = workspaceDimensions.find((d) => d.id === dimId)
    if (!dim) return
    const next = new URLSearchParams(sp)
    if (dim.values[0].id === value) next.delete(`d_${dimId}`)
    else next.set(`d_${dimId}`, value)
    setSp(next, { replace: true })
  }

  return (
    <CanvasViewportContext.Provider value={canvasViewport}>
    <CanvasInspectContext.Provider value={inspectCtx}>
    <div className="h-screen relative overflow-hidden" {...layer.background}>
      <PanZoom ref={pz} initial={initialT.current} onCommit={setT} onLive={onLive} contentRef={(el) => { contentElRef.current = el; if (el && el !== contentEl) setContentEl(el) }}>
        <div
          data-canvas-root
          className={cn("ps flex flex-col items-start gap-14 p-12", wireframe && "proto-wireframe", inspect && "ps-inspect-on")}
        >
          {/* ---- Overview zone: site map, boards and flows side by side ---- */}
          <div className="flex flex-wrap items-start" style={{ gap: 56, maxWidth: Math.max(shelfW, 2400) }}>
            {/* ---- Site map: how the screens fit together (arrows from scenarios) ---- */}
            {showMap && pages.length > 1 && (
              <Area title="Site map" kind={`${pages.length} screens`} icon={<Waypoints />} tocId="area:map" className="self-start">
                <SiteMap pages={pages} scenarios={scenarios} wdims={wdims} linkExtra={linkExtra} onJump={onJump} />
              </Area>
            )}

            {/* ---- Boards: supporting material, outside the contract. Chips; one opens in place. ---- */}
            {universe.boards.length > 0 && (
              <Area title="Boards" kind="supporting material" icon={<MapIcon />} tocId="area:boards" className="self-start">
                <div className="flex flex-wrap items-start gap-2.5" style={{ maxWidth: 640 }}>
                  {universe.boards.map((id) => {
                    const b = standaloneBoards.find((x) => x.id === id)
                    const open = isOpen(disc, "boards", id)
                    const Icon = !b ? CheckCircle2 : b.kind === "image" ? ImageIcon : b.kind === "text" ? FileText : Waypoints
                    return (
                      <button
                        key={id}
                        type="button"
                        className="ps-board-chip"
                        aria-expanded={open}
                        disabled={editMode}
                        title={b?.description ?? (open ? "Fold this board" : "Show this board")}
                        onClick={() => toggle("boards", id, !open)}
                      >
                        <Icon />
                        <span className="truncate">{b?.title ?? "Requirement coverage"}</span>
                        <ChevronRight className="ps-board-chip-chev" />
                      </button>
                    )
                  })}
                </div>
                {universe.boards.some((id) => isOpen(disc, "boards", id)) && (
                  <div className="flex flex-wrap items-start gap-10 mt-10">
                    {hasCoverage && isOpen(disc, "boards", "coverage") && (
                      <div data-toc="board:coverage">
                        <CoverageBoard wireframe={wireframe} linkExtra={wCarry} wdims={wdims} />
                      </div>
                    )}
                    {standaloneBoards.filter((b) => isOpen(disc, "boards", b.id)).map((b) => (
                      <div key={b.id} data-toc={`board:${b.id}`}>
                        <BoardCard board={b} />
                      </div>
                    ))}
                  </div>
                )}
              </Area>
            )}

            {/* ---- Scenarios: one area, lanes stacked, each folded to a line until opened ---- */}
            <Area title="Scenarios" kind={`${scenarios.length} walkthrough${scenarios.length === 1 ? "" : "s"}`} icon={<BookOpen />} tocId="area:scenarios" className="self-start">
              <div className="flex flex-col gap-6">
                {scenarios.map((sc) => (
                  <ScenarioLane
                    key={sc.id}
                    sc={sc}
                    wdims={wdims}
                    linkExtra={linkExtra}
                    open={isOpen(disc, "lanes", sc.id)}
                    onToggle={editMode ? undefined : (o) => toggle("lanes", sc.id, o)}
                  />
                ))}
              </div>
            </Area>
          </div>

          {/* ---- Screens: one area per screen, clustered by section; sections wrap at the shelf width ---- */}
          <div className="flex flex-wrap items-start" style={{ columnGap: 72, rowGap: 64, maxWidth: shelfW }}>
            {screenSections.map((section) => (
              <div key={section.key} className="flex flex-col gap-5">
                {section.label && (
                  <div data-ps-ui>
                    <span className="ps-group-h" style={{ maxWidth: `calc(${sectionW(section.pages)}px / var(--ps-inv-big, 1))` }}>{section.label}</span>
                  </div>
                )}
                <div className="flex flex-col items-start" style={{ gap: AREA_GAP }}>
                  {renderScreens(section.pages, section.kind)}
                </div>
              </div>
            ))}
          </div>

        </div>
        <div className={cn("ps ps-board-root ps-map-layer", editMode && "is-editing", wireframe && "proto-wireframe")} data-map-layer>
          {layer.layer}
        </div>
        {contentEl && showNotes && manifest.notes && manifest.notes.length > 0 && (
          <CanvasNotes notes={manifest.notes} root={contentEl} getScale={getScale} />
        )}
        {contentEl?.parentElement && inspect && !hidden && (
          <Inspector host={contentEl.parentElement} hit={hit} onClose={() => setFlag("i", false)} onPinChange={setHold} />
        )}
      </PanZoom>
      {layer.marqueeEl}
      <SurfaceCommentLayer
        surface={MAP_BOARD}
        itemSelector="[data-instance]"
        itemIdOf={instanceIdOf}
        placing={placing}
        onPlaced={() => setPlacing(false)}
        openId={openCommentId}
        onOpenChange={setCommentParam}
        reveal={(x, y) => {
          const k = Math.max(pz.current?.get().k ?? 0.5, 0.5)
          pz.current?.set({ k, x: window.innerWidth / 2 - x * k, y: window.innerHeight / 2 - y * k }, true)
        }}
      />

      {!hidden && (
        <>
          <div className="ps ps-glass absolute top-4 left-4 z-20 rounded-2xl px-3.5 py-2 flex items-center gap-2.5">
            <Layers className="size-4" style={{ color: "var(--ps-muted)" }} />
            <span className="font-semibold text-[13px]">Stavy</span>
            <span style={{ color: "var(--ps-faint)" }}>/</span>
            <span className="font-medium text-[13px]">{manifest.product.name}</span>
            <span style={{ color: "var(--ps-faint)" }}>/</span>
            <PageSwitcher current={{ kind: "map" }} />
            <Chip sm>{manifest.pages.length} screens</Chip>
            {workspaceDimensions.length > 0 && (
              <>
                <PsDivider />
                <WorkspaceDims value={wdims} onChange={setWorkspaceDim} direction="down" />
                {outOfScopeCount > 0 && (
                  <Chip
                    sm
                    className="ps-chip-warn"
                    title={`${outOfScopeCount} registered screen(s) are not part of ${workspaceDimensions
                      .map((d) => `${d.label} = ${valueLabel(d.id, wdims[d.id])}`)
                      .join(", ")}. Switch above to see them.`}
                  >
                    {outOfScopeCount} not in scope
                  </Chip>
                )}
              </>
            )}
          </div>
          <MockNotice className="absolute top-[58px] left-6 z-20" />
          <CanvasToc className="absolute top-[84px] left-4 z-20" onJump={onJump} wdims={wdims} showMap={showMap} />

          <div className="ps ps-glass absolute top-4 right-4 z-20 rounded-2xl px-1.5 py-1 flex items-center gap-0.5" data-ps-ui>
            {writable && (
              <>
                <PsButton active={editMode} tip="Add and arrange notes, text and images on the map" keys={["E"]} tipBelow onClick={() => setFlag("e", !editMode)}>
                  <Pencil /> Edit
                </PsButton>
                {editMode && (
                  <>
                    <AddPalette onAdd={layer.addItem} />
                    <PsButton icon tip="Undo" keys={["⌘", "Z"]} tipBelow disabled={!layer.canUndo} onClick={layer.doUndo}>
                      <Undo2 />
                    </PsButton>
                    <PsButton icon tip="Redo" keys={["⇧", "⌘", "Z"]} tipBelow disabled={!layer.canRedo} onClick={layer.doRedo}>
                      <Redo2 />
                    </PsButton>
                    <span className={cn("ps-save", layer.saveState === "error" && "is-error")} aria-live="polite">
                      {layer.saveState === "saving" ? "Saving…" : layer.saveState === "error" ? "Not saved" : layer.saveState === "saved" ? "Saved" : ""}
                    </span>
                  </>
                )}
                <PsDivider />
              </>
            )}
            <PsButton
              active={disc.all}
              disabled={editMode}
              aria-pressed={disc.all}
              tip={editMode ? "Edit mode shows every state" : disc.all ? "Back to the overview: one card per screen" : "Show every state, flow step and board"}
              keys={["A"]}
              tipBelow
              onClick={toggleAll}
            >
              <GalleryHorizontalEnd /> All states
            </PsButton>
            <PsButton active={showNotes} tip="Annotation pins and pointing notes" keys={["N"]} tipBelow onClick={() => setFlag("notes", !showNotes)}>
              <StickyNote /> Notes
            </PsButton>
            <PsButton active={wireframe} tip="Wireframe rendering" keys={["W"]} tipBelow onClick={() => setFlag("w", !wireframe)}>
              <PencilRuler /> Wireframe
            </PsButton>
            <PsButton active={inspect} tip="Inspect: hover a card to read its live DOM" keys={["I"]} tipBelow onClick={() => setFlag("i", !inspect)}>
              <Crosshair /> Inspect
            </PsButton>
            <PsButton active={liveMode} tip="Live frames instead of snapshots for cards near the viewport (heavier; handy before the first scan)" keys={["L"]} tipBelow onClick={() => setFlag("live", !liveMode)}>
              <Play /> Live
            </PsButton>
            <PsButton active={commentsOpen} tip="Comments" tipBelow onClick={() => setFlag("comments", !commentsOpen)} className="relative">
              <MessageCircle /> Comments
              {openComments > 0 && <span className="ps-ccount">{openComments}</span>}
            </PsButton>
            {scanAll.writable && (
              <PsButton icon aria-label="Refresh all snapshots" tip={scanAll.busy ? "Capturing every snapshot…" : "Refresh all snapshots"} tipBelow disabled={scanAll.busy} onClick={scanAll.start}>
                {scanAll.busy ? <span className="ps-spinner" /> : <RotateCcw />}
              </PsButton>
            )}
            <PsDivider />
            <PsButton icon tip="Zoom out" keys={["−"]} tipBelow onClick={() => zoomBy(1 / 1.5)}>
              <Minus />
            </PsButton>
            <PsButton className="ps-mono tabular-nums px-1.5 w-14 justify-center" tip="Reset view" keys={["0"]} tipBelow onClick={() => pz.current?.set(INITIAL, true)}>
              <span ref={zoomLabel}>{fmtZoom(t.k)}</span>
            </PsButton>
            <PsButton icon tip="Zoom in" keys={["+"]} tipBelow onClick={() => zoomBy(1.5)}>
              <Plus />
            </PsButton>
            <PsButton icon tip="Fit everything" keys={["2"]} tipBelow onClick={() => pz.current?.fitAll(true)}>
              <Maximize2 />
            </PsButton>
            <PsDivider />
            <ThemeToggle tipBelow />
            <HelpButton tipBelow />
          </div>
          {commentsOpen && (
            <CommentsPanel
              wireframe={wireframe}
              here={{ label: "the map", test: (c) => c.board === MAP_BOARD, open: (c) => setCommentParam(c.id) }}
              onClose={() => setFlag("comments", false)}
              onAdd={() => {
                setFlag("comments", false)
                setPlacing(true)
              }}
            />
          )}
          <ShortcutsSheet
            items={[
              ...(writable ? ([["Edit the map's notes", "E"]] as Array<[string, string]>) : []),
              ["All states / overview", "A"], ["Notes", "N"], ["Leave a comment", "M"], ["Wireframe", "W"], ["Inspect", "I"], ["Live frames", "L"], ["Theme", "T"],
              ["Zoom in / out", "+ −"], ["100% / fit everything", "1 2"], ["Reset view", "0"], ["Fit an area (and open a screen)", "double-click"],
              ["Hide / show UI", "⌘ \\ ⇧ H"], ["This sheet", "?"],
            ]}
          />

          <div className="ps ps-glass absolute bottom-4 left-4 z-20 rounded-xl px-3 py-1.5 flex items-center gap-4 text-[11px]" style={{ color: "var(--ps-muted)" }}>
            <span className="flex items-center gap-1.5"><MessageSquare className="size-3" /> scroll to pan</span>
            <span>pinch to zoom</span>
            <span>click a screen to open it</span>
          </div>
        </>
      )}
    </div>
    </CanvasInspectContext.Provider>
    </CanvasViewportContext.Provider>
  )
}
