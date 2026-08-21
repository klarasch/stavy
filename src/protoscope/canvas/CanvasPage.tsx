import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowRight, Minus, Plus, Maximize2, Layers, BookOpen, MessageSquare, PencilRuler, StickyNote, Boxes, Crosshair, Map as MapIcon, MessageCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { manifest, activeSlice, getPage, resolveDims, pageUrl, valueLabel, dimensionLabel } from "../manifest"
import { PanZoom, clampK, type PanZoomHandle, type Transform } from "./PanZoom"
import { InstanceCard, VIEWPORT_W } from "./InstanceCard"
import { CanvasNotes } from "./CanvasNotes"
import { AnatomyCard } from "./AnatomyCard"
import { CanvasToc } from "./CanvasToc"
import { BoardCard } from "./BoardCard"
import { Inspector, type InspectContext } from "../overlays/Inspector"
import { CommentsPanel } from "../comments/CommentsPanel"
import { useComments } from "../comments/store"
import { PsButton, PsDivider, Chip, ThemeToggle, MockNotice, HelpButton, ShortcutsSheet, useChrome, useHotkeys, cycleTheme } from "../chrome"
import type { PageDef } from "../types"

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

function cardScale(page: PageDef) {
  if (page.kind === "component" && page.frame) return Math.min(0.6, 256 / page.frame.width)
  return 0.2
}

/** A named region of the canvas. The title pill scales with 1/zoom so it reads from orbit. */
function Area({
  title, kind, icon, tocId, children, className,
}: {
  title: string
  kind?: string
  icon: React.ReactNode
  tocId?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("ps-area", className)} data-toc={tocId}>
      <div className="ps-area-title" data-ps-ui>
        <span>
          {icon}
          {title}
          {kind && <span className="ps-area-kind">{kind}</span>}
        </span>
      </div>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Coverage matrix: pinned instances laid out on the two most-varying  */
/* dimensions, declared-but-unpinned cells shown as dashed placeholders */
/* ------------------------------------------------------------------ */

const PageGroup = memo(function PageGroup({ page, showNotes }: { page: PageDef; showNotes: boolean }) {
  const navigate = useNavigate()
  const template = manifest.templates.find((tp) => tp.id === page.template)
  const scale = cardScale(page)
  const w = Math.round((page.frame?.width ?? VIEWPORT_W) * scale)
  const h = Math.round((page.frame?.height ?? 832) * scale)

  const layout = useMemo(() => {
    const instances = (page.instances ?? [{ dims: {} }]).map((i) => ({ ...i, full: resolveDims(page, i.dims) }))
    const dimIds = Object.keys(page.dimensions)
    const varying = dimIds
      .filter((d) => new Set(instances.map((i) => i.full[d])).size > 1)
      .sort((a, b) => page.dimensions[b].length - page.dimensions[a].length)
    const colDim = varying[0]
    const rowDim = varying[1]
    const extraVarying = varying.slice(2)
    const groups = new Map<string, typeof instances>()
    for (const inst of instances) {
      const key = extraVarying.map((d) => `${d}=${inst.full[d]}`).join("|")
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(inst)
    }
    return { instances, colDim, rowDim, extraVarying, groups }
  }, [page])

  const { colDim, rowDim, extraVarying, groups } = layout
  const cols = colDim ? page.dimensions[colDim] : [null]
  const rows = rowDim ? page.dimensions[rowDim] : [null]
  const hideChips = !!colDim

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="ps-zl">
          <h3 className="flex items-center gap-2">
            <Chip sm mono>{template?.label ?? page.template}</Chip>
            {page.fidelity && (
              <Chip sm title="Fidelity rung (see SKILL.md)">
                <span className="size-1.5 rounded-full" style={{ background: fidelityTone[page.fidelity] }} />
                {page.fidelity}
              </Chip>
            )}
            <span className="flex items-center gap-1">
              {Object.entries(page.dimensions).map(([d, vs]) => (
                <span key={d} className="ps-chip ps-chip-sm font-normal">
                  <span className="ps-chip-k">{dimensionLabel(d)}</span> {vs.length}
                </span>
              ))}
            </span>
          </h3>
        </span>
      </div>
      {page.description && <p className="ps-sub mb-4 max-w-2xl">{page.description}</p>}

      <div className="flex flex-col gap-8">
        {[...groups.entries()].map(([groupKey, insts], gi) => {
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
                    hideChips={hideChips}
                    showNotes={showNotes}
                    onOpen={(dims) => navigate(pageUrl(page.id, dims))}
                  />
                ))}
              </div>
            </div>
          )
        })}
        {(page.annotations?.length ?? 0) > 0 && (
          <div>
            <div className="ps-sub mb-3 flex items-center gap-2">
              <span className="ps-zl"><span className="ps-chip ps-chip-sm">Anatomy</span></span>
              what each part of the screen does
            </div>
            <AnatomyCard page={page} scale={page.kind === "component" ? Math.min(0.8, 420 / (page.frame?.width ?? VIEWPORT_W)) : 0.3} />
          </div>
        )}
      </div>
    </div>
  )
})

function RowFragment({
  page, r, cols, colDim, rowDim, groupDims, find, w, h, scale, hideChips, showNotes, onOpen,
}: {
  page: PageDef
  r: string | null
  cols: (string | null)[]
  colDim?: string
  rowDim?: string
  groupDims: Record<string, string>
  find: (c: string | null, r: string | null) => { full: Record<string, string>; note?: string } | undefined
  w: number
  h: number
  scale: number
  hideChips: boolean
  showNotes: boolean
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
              scale={scale}
              frame={page.frame}
              hideChips={hideChips}
              annotations={page.annotations}
              showPins={showNotes}
            />
          )
        }
        const dims = resolveDims(page, {
          ...groupDims,
          ...(colDim ? { [colDim]: c! } : {}),
          ...(rowDim ? { [rowDim]: r! } : {}),
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

/* ------------------------------------------------------------------ */

export function CanvasPage() {
  const [sp, setSp] = useSearchParams()
  const { hidden } = useChrome()
  const [t, setT] = useState<Transform>(() => parseView(sp.get("v")) ?? INITIAL)
  const pz = useRef<PanZoomHandle>(null)
  const zoomLabel = useRef<HTMLSpanElement>(null)
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)
  const initialT = useRef(t)

  const { theme, setTheme, setHidden } = useChrome()
  const { open: openComments } = useComments()
  const showNotes = sp.get("notes") === "1"
  const wireframe = sp.get("w") === "1"
  const inspect = sp.get("i") === "1"
  const commentsOpen = sp.get("comments") === "1"

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
      const next = new URLSearchParams(sp)
      next.set("v", v)
      setSp(next, { replace: true })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  const fmtZoom = (k: number) => (k >= 1 ? `${k.toFixed(1)}×` : `${Math.round(k * 100)}%`)
  const zoomBy = (f: number) => pz.current?.zoomBy(f, true)
  const getScale = useCallback(() => pz.current?.get().k ?? initialT.current.k, [])
  const onLive = useCallback((lt: Transform) => {
    if (zoomLabel.current) zoomLabel.current.textContent = fmtZoom(lt.k)
  }, [])

  // Zoom the viewport to fit the chosen section.
  const jumpTo = (tocId: string) => {
    const el = contentEl?.querySelector<HTMLElement>(`[data-toc="${CSS.escape(tocId)}"]`)
    if (!el || !pz.current) return
    pz.current.fitTo(el, true)
    el.setAttribute("data-flash", "true")
    setTimeout(() => el.removeAttribute("data-flash"), 1200)
  }

  useHotkeys({
    n: () => setFlag("notes", !showNotes),
    w: () => setFlag("w", !wireframe),
    i: () => setFlag("i", !inspect),
    t: () => setTheme(cycleTheme(theme)),
    "0": () => pz.current?.set(INITIAL, true),
    "1": () => pz.current?.zoomBy(1 / (pz.current.get().k || 1), true),
    "2": () => pz.current?.fitAll(true),
    "+": () => zoomBy(1.5),
    "=": () => zoomBy(1.5),
    "-": () => zoomBy(1 / 1.5),
    Escape: () => {
      if (inspect) setFlag("i", false)
      else if (commentsOpen) setFlag("comments", false)
      else setHidden(false)
    },
  })

  const inspectContext = useCallback((el: Element): InspectContext | null => {
    const card = el.closest<HTMLElement>("[data-instance]")
    if (!card) return null
    const key = card.getAttribute("data-instance") ?? ""
    const [pageId, qs] = key.split("?")
    const page = getPage(pageId)
    if (!page) return null
    const dims = Object.fromEntries(new URLSearchParams(qs ?? ""))
    return { page, template: manifest.templates.find((tp) => tp.id === page.template), dims: resolveDims(page, dims) }
  }, [])

  const pages = manifest.pages.filter((p) => p.kind !== "component")
  const components = manifest.pages.filter((p) => p.kind === "component")

  return (
    <div className="h-screen relative overflow-hidden">
      <PanZoom ref={pz} initial={initialT.current} onCommit={setT} onLive={onLive} contentRef={(el) => { if (el !== contentEl) setContentEl(el) }}>
        <div
          data-canvas-root
          className={cn("ps flex flex-col items-start gap-14 p-12", wireframe && "proto-wireframe", inspect && "ps-inspect-on")}
        >
          {/* ---- Boards: supporting material, outside the contract ---- */}
          {(manifest.boards?.length ?? 0) > 0 && (
            <Area title="Boards" kind="supporting material" icon={<MapIcon />} tocId="area:boards" className="self-start">
              <div className="flex flex-wrap items-start gap-10">
                {manifest.boards!.map((b) => (
                  <div key={b.id} data-toc={`board:${b.id}`}>
                    <BoardCard board={b} />
                  </div>
                ))}
              </div>
            </Area>
          )}

          {/* ---- Scenarios: one wide area, lanes stacked ---- */}
          <Area title="Scenarios" kind={`${manifest.scenarios.length} walkthroughs`} icon={<BookOpen />} tocId="area:scenarios" className="self-start">
            <div className="flex flex-col gap-8">
              {manifest.scenarios.map((sc) => (
                <div key={sc.id} data-toc={`scenario:${sc.id}`}>
                  <span className="ps-zl">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="ps-h3">{sc.label}</h3>
                      {sc.persona && <Chip sm className="capitalize">{sc.persona}</Chip>}
                      {sc.refs?.map((r) => (
                        <Chip key={r} sm mono>{r}</Chip>
                      ))}
                    </div>
                  </span>
                  {sc.description && <p className="ps-sub mb-4 max-w-2xl">{sc.description}</p>}
                  <div className="flex items-start gap-3">
                    {sc.steps.map((st, i) => {
                      const page = getPage(st.page)
                      if (!page) return null
                      const dims = resolveDims(page, st.dims)
                      return (
                        <div key={i} className="flex items-start gap-3">
                          {i > 0 && <ArrowRight className="size-4 mt-14 shrink-0" style={{ color: "var(--ps-faint)" }} />}
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 text-[11.5px]">
                              <span
                                className="size-4 rounded-full flex items-center justify-center text-[10px] font-semibold"
                                style={{ background: "var(--ps-accent)", color: "var(--ps-accent-fg)" }}
                              >
                                {i + 1}
                              </span>
                              <span className="font-medium truncate max-w-40">{st.title}</span>
                            </div>
                            <InstanceCard
                              pageId={st.page}
                              dims={dims}
                              scale={page.kind === "component" ? cardScale(page) * 0.7 : 0.14}
                              frame={page.frame}
                              scope="scenarios"
                              href={pageUrl(st.page, dims, { tour: sc.id, ts: String(i) })}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Area>

          {/* ---- Pages: one area per page, flowing left→right, wrapping ---- */}
          <div className="flex flex-wrap items-start gap-10" style={{ maxWidth: 4200 }}>
            {pages.map((page) => (
              <Area key={page.id} title={page.label} kind="page" icon={<Layers />} tocId={`page:${page.id}`}>
                <PageGroup page={page} showNotes={showNotes} />
              </Area>
            ))}
          </div>

          {/* ---- Components ---- */}
          {components.length > 0 && (
            <div className="flex flex-wrap items-start gap-10" style={{ maxWidth: 4200 }}>
              {components.map((page) => (
                <Area key={page.id} title={page.label} kind="component" icon={<Boxes />} tocId={`page:${page.id}`}>
                  <PageGroup page={page} showNotes={showNotes} />
                </Area>
              ))}
            </div>
          )}

        </div>
        {contentEl && showNotes && manifest.notes && manifest.notes.length > 0 && (
          <CanvasNotes notes={manifest.notes} root={contentEl} getScale={getScale} />
        )}
        {contentEl && inspect && !hidden && (
          <Inspector wrapper={contentEl} within=".ps-proto-content" context={inspectContext} scale={getScale} onClose={() => setFlag("i", false)} />
        )}
      </PanZoom>

      {!hidden && (
        <>
          <div className="ps ps-glass absolute top-4 left-4 z-20 rounded-2xl px-3.5 py-2 flex items-center gap-2.5">
            <Layers className="size-4" style={{ color: "var(--ps-muted)" }} />
            <span className="font-semibold text-[13px]">Protoscope</span>
            <span style={{ color: "var(--ps-faint)" }}>/</span>
            <span className="font-medium text-[13px]">{manifest.product.name}</span>
            <Chip sm accent={!!activeSlice}>
              {activeSlice ? (<><span className="ps-chip-k">slice</span>{activeSlice.label}</>) : "full workspace"}
            </Chip>
          </div>
          <MockNotice className="absolute top-[58px] left-6 z-20" />
          <CanvasToc className="absolute top-[84px] left-4 z-20" onJump={jumpTo} />

          <div className="ps ps-glass absolute top-4 right-4 z-20 rounded-2xl px-1.5 py-1 flex items-center gap-0.5">
            <PsButton active={showNotes} tip="Annotation pins and pointing notes" keys={["N"]} tipBelow onClick={() => setFlag("notes", !showNotes)}>
              <StickyNote /> Notes
            </PsButton>
            <PsButton active={wireframe} tip="Wireframe rendering" keys={["W"]} tipBelow onClick={() => setFlag("w", !wireframe)}>
              <PencilRuler /> Wireframe
            </PsButton>
            <PsButton active={inspect} tip="Inspect any thumbnail" keys={["I"]} tipBelow onClick={() => setFlag("i", !inspect)}>
              <Crosshair /> Inspect
            </PsButton>
            <PsButton active={commentsOpen} tip="Comments" tipBelow onClick={() => setFlag("comments", !commentsOpen)} className="relative">
              <MessageCircle /> Comments
              {openComments > 0 && <span className="ps-ccount">{openComments}</span>}
            </PsButton>
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
          {commentsOpen && <CommentsPanel onClose={() => setFlag("comments", false)} />}
          <ShortcutsSheet
            items={[
              ["Notes", "N"], ["Wireframe", "W"], ["Inspect", "I"], ["Theme", "T"],
              ["Zoom in / out", "+ −"], ["100% / fit everything", "1 2"], ["Reset view", "0"], ["Fit an area", "double-click"],
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
  )
}
