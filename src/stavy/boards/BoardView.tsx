import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Crosshair, Layers, Maximize2, MessageCircle, MessageCirclePlus, Minus, Pencil, Play, Plus, Redo2, Undo2 } from "../icons"
import { cn } from "../cn"
import { getPage, getTemplate, manifest, resolveDims } from "../manifest"
import { Inspector, type FrameHit } from "../overlays/Inspector"
import { elementAt } from "../frame"
import { useDev } from "../dev"
import { HelpButton, PsButton, PsDivider, ShortcutsSheet, ThemeToggle, cycleTheme, useChrome, useHotkeys } from "../chrome"
import { PanZoom, clampK, type PanZoomHandle, type Transform } from "../canvas/PanZoom"
import { CanvasInspectContext, CanvasViewportContext, type CanvasInspect, type CanvasViewport } from "../canvas/visibility"
import type { BoardFile } from "../types"
import { findItem, walkItems } from "./layout"
import { AddPalette } from "./Palette"
import { PageSwitcher } from "./PageSwitcher"
import { rememberView } from "./store"
import { SurfaceCommentLayer } from "../comments/SurfaceCommentLayer"
import { CommentsPanel } from "../comments/CommentsPanel"
import { useComments } from "../comments/store"
import { StatusControl } from "../status"
import { InlineInput, useBoardEditor } from "./editor"

/**
 * An authored board (stavy-content/boards/<id>.json): a free-form canvas page
 * an agent composes from the app's states and a designer refines. Rendered on
 * the same PanZoom as the map; items without coordinates are laid out by
 * `layoutBoard`, so a board written with zero coordinates still reads well.
 *
 * With the dev endpoint the board is editable (toggle with E); the editing
 * itself lives in ./editor (shared with the map's own layer).
 */

function parseView(v: string | null): Transform | null {
  if (!v) return null
  const [x, y, k] = v.split(",").map(Number)
  if ([x, y, k].some((n) => !Number.isFinite(n))) return null
  return { x, y, k: clampK(k) }
}

export function BoardView() {
  const [sp, setSp] = useSearchParams()
  const id = sp.get("b") ?? ""
  const dev = useDev()
  const writable = !!dev?.writable
  const { hidden, theme, setTheme, setHidden } = useChrome()

  /* ---------------- modes ---------------- */

  const editMode = writable && sp.get("e") === "1"
  const liveMode = sp.get("live") === "1"
  const wireframe = sp.get("w") === "1"
  const setFlag = (k: string, on: boolean) => {
    const next = new URLSearchParams(sp)
    if (on) next.set(k, "1")
    else next.delete(k)
    setSp(next, { replace: true })
  }

  const pz = useRef<PanZoomHandle>(null)
  const contentElRef = useRef<HTMLDivElement | null>(null)
  const { board, error, commit, layout, sizes, selection, setSelection, editing, setEditing, addItem, doUndo, doRedo, canUndo, canRedo, saveState, layer, marqueeEl, background } =
    useBoardEditor({ file: `boards/${id}.json`, editMode, wireframe, pz, contentElRef })

  /* ---- comments: on an item or a point of the board ---- */
  const { comments } = useComments()
  const [placing, setPlacing] = useState(false)
  const commentsOpen = sp.get("comments") === "1"
  const openCommentId = sp.get("c")
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp)
    if (v == null) next.delete(k)
    else next.set(k, v)
    setSp(next, { replace: true })
  }
  const boardComments = comments.filter((c) => c.board === id && !c.resolved).length
  const itemIdOf = useCallback((el: Element) => el.getAttribute("data-item-id"), [])
  /* ---------------- viewport ---------------- */

  const zoomLabel = useRef<HTMLSpanElement>(null)
  const urlView = useRef(parseView(sp.get("v")))
  const initialT = useRef<Transform>(urlView.current ?? { x: 120, y: 160, k: 0.5 })
  const [t, setT] = useState<Transform>(initialT.current)
  const vpListeners = useRef<Set<() => void>>(new Set())
  const canvasViewport = useMemo<CanvasViewport>(
    () => ({
      get: () => pz.current?.get() ?? initialT.current,
      subscribe: (fn) => {
        vpListeners.current.add(fn)
        return () => void vpListeners.current.delete(fn)
      },
      viewportEl: () => contentElRef.current?.parentElement ?? null,
      contentEl: () => contentElRef.current,
    }),
    []
  )
  // Inspect on a board: the same panel as the map, docked to the window edge.
  // Off while editing — the pointer belongs to the editor then.
  const inspect = sp.get("i") === "1" && !editMode
  const [hold, setHold] = useState<HTMLIFrameElement | null>(null)
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null)
  const inspectCtx = useMemo<CanvasInspect>(() => ({ on: inspect, live: liveMode, hold }), [inspect, liveMode, hold])
  const inspectHit = useCallback((e: MouseEvent): FrameHit | null => {
    const card = (e.target as Element | null)?.closest<HTMLElement>("[data-instance]")
    const iframe = card?.querySelector("iframe")
    if (!card || !iframe) return null
    const el = elementAt(iframe, e.clientX, e.clientY)
    if (!el) return null
    const [pageId, qs] = (card.getAttribute("data-instance") ?? "").split("?")
    const page = getPage(pageId)
    if (!page) return null
    return { el, iframe, ctx: { page, template: getTemplate(page.template), dims: resolveDims(page, Object.fromEntries(new URLSearchParams(qs ?? ""))) } }
  }, [])
  const fmtZoom = (k: number) => (k >= 1 ? `${k.toFixed(1)}×` : `${Math.round(k * 100)}%`)
  const onLive = useCallback((lt: Transform) => {
    if (zoomLabel.current) zoomLabel.current.textContent = fmtZoom(lt.k)
    for (const fn of vpListeners.current) fn()
  }, [])

  const fit = useCallback(
    (smooth = true) => {
      const b = layout.bbox
      if (!b.w || !b.h) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const top = 200 // room for the chrome and the board's own title
      const k = clampK(Math.min((vw - 160) / b.w, (vh - top - 60) / b.h, 1))
      pz.current?.set({ k, x: (vw - b.w * k) / 2 - b.x * k, y: top + (vh - top - 60 - b.h * k) / 2 - b.y * k }, smooth)
    },
    [layout.bbox]
  )
  // First visit (no ?v): fit once the items have been measured.
  const fitted = useRef(!!urlView.current)
  useEffect(() => {
    if (fitted.current || !board) return
    const n = (() => {
      let c = 0
      walkItems(board.items, () => c++)
      return c
    })()
    if (Object.keys(sizes).length < Math.min(n, 1) && n > 0) return
    const tm = setTimeout(() => {
      fitted.current = true
      fit(false)
    }, 120)
    return () => clearTimeout(tm)
  }, [board, sizes, fit])

  useEffect(() => {
    const tm = setTimeout(() => {
      const v = `${Math.round(t.x)},${Math.round(t.y)},${t.k.toFixed(3)}`
      rememberView(`b:${id}`, v)
      if (sp.get("v") === v) return
      const next = new URLSearchParams(sp)
      next.set("v", v)
      setSp(next, { replace: true })
    }, 300)
    return () => clearTimeout(tm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  useHotkeys({
    m: () => setPlacing((p) => !p),
    e: () => writable && setFlag("e", !editMode),
    l: () => setFlag("live", !liveMode),
    w: () => setFlag("w", !wireframe),
    t: () => setTheme(cycleTheme(theme)),
    "1": () => pz.current?.zoomBy(1 / (pz.current.get().k || 1), true),
    "2": () => fit(true),
    "0": () => fit(true),
    "+": () => pz.current?.zoomBy(1.5, true),
    "=": () => pz.current?.zoomBy(1.5, true),
    "-": () => pz.current?.zoomBy(1 / 1.5, true),
    i: () => setFlag("i", sp.get("i") !== "1"),
    Escape: () => {
      if (placing) setPlacing(false)
      else if (openCommentId) setParam("c", null)
      else if (commentsOpen) setParam("comments", null)
      else if (inspect) setFlag("i", false)
      else if (editing) setEditing(null)
      else if (selection.size) setSelection(new Set())
      else setHidden(false)
    },
  })

  const bbox = layout.bbox
  const empty = board && !board.items.some((i) => i.type !== "arrow")

  return (
    <CanvasViewportContext.Provider value={canvasViewport}>
      <CanvasInspectContext.Provider value={inspectCtx}>
        <div className="h-screen relative overflow-hidden" {...background}>
          <PanZoom ref={pz} initial={initialT.current} onCommit={setT} onLive={onLive} contentRef={(el) => {
            contentElRef.current = el
            if (el?.parentElement && el.parentElement !== viewportEl) setViewportEl(el.parentElement)
          }}>
            <div data-canvas-root className={cn("ps ps-board-root", wireframe && "proto-wireframe", editMode && "is-editing", inspect && "ps-inspect-on")} style={{ width: bbox.x + bbox.w, height: bbox.y + bbox.h }}>
              {board && (
                <BoardHeading board={board} x={bbox.x} y={bbox.y} editMode={editMode} onPatch={(p) => commit({ ...board, ...p })} />
              )}
              {layer}
            </div>
          </PanZoom>
          {board && (
            <SurfaceCommentLayer
              surface={id}
              itemSelector="[data-item-id]"
              itemIdOf={itemIdOf}
              itemLabel={(iid) => {
                const it = findItem(board.items, iid) as { title?: string } | undefined
                return it?.title
              }}
              placing={placing}
              onPlaced={() => setPlacing(false)}
              openId={openCommentId}
              onOpenChange={(cid) => setParam("c", cid)}
              reveal={(x, y) => {
                const k = Math.max(pz.current?.get().k ?? 0.5, 0.5)
                pz.current?.set({ k, x: window.innerWidth / 2 - x * k, y: window.innerHeight / 2 - y * k }, true)
              }}
            />
          )}
          {inspect && !hidden && viewportEl && <Inspector host={viewportEl} hit={inspectHit} onClose={() => setFlag("i", false)} onPinChange={setHold} />}

          {marqueeEl}

          {(error || empty) && (
            <div className="ps ps-glass-strong ps-board-empty" data-ps-ui>
              {error ? (
                <>
                  <div className="font-semibold mb-1">This board could not be loaded</div>
                  <div className="ps-sub">{error}</div>
                </>
              ) : (
                <>
                  <div className="font-semibold mb-1">An empty board</div>
                  <div className="ps-sub">
                    {writable
                      ? "Add a screen, a flow, a note or some Markdown with “Add”, or ask an agent to compose it."
                      : `Agents write boards to stavy-content/boards/${id}.json; run the prototype's dev server to edit here.`}
                  </div>
                </>
              )}
            </div>
          )}

          {!hidden && (
            <>
              <div className="ps ps-glass absolute top-4 left-4 z-20 rounded-2xl pl-3.5 pr-1.5 py-1.5 flex items-center gap-2.5" data-ps-ui>
                <Layers className="size-4" style={{ color: "var(--ps-muted)" }} />
                <span className="font-semibold text-[13px]">Stavy</span>
                <span style={{ color: "var(--ps-faint)" }}>/</span>
                <span className="font-medium text-[13px]">{manifest.product.name}</span>
                <span style={{ color: "var(--ps-faint)" }}>/</span>
                <PageSwitcher current={{ kind: "board", id }} board={board} />
                {board && (
                  <StatusControl
                    status={board.status}
                    ready={board.ready}
                    onChange={
                      writable
                        ? (v) => {
                            const { status: _s, ready: _r, ...rest } = board
                            commit({
                              ...rest,
                              ...(v ? { status: v } : {}),
                              ...(v === "ready" ? { ready: { at: new Date().toISOString().slice(0, 10), ...(dev?.user ? { by: dev.user } : {}) } } : {}),
                            })
                          }
                        : undefined
                    }
                  />
                )}
              </div>

              <div className="ps ps-glass absolute top-4 right-4 z-20 rounded-2xl px-1.5 py-1 flex items-center gap-0.5" data-ps-ui>
                {writable && (
                  <>
                    <PsButton active={editMode} tip="Edit this board" keys={["E"]} tipBelow onClick={() => setFlag("e", !editMode)}>
                      <Pencil /> Edit
                    </PsButton>
                    {editMode && (
                      <>
                        <AddPalette onAdd={addItem} />
                        <PsButton icon tip="Undo" keys={["⌘", "Z"]} tipBelow disabled={!canUndo} onClick={doUndo}>
                          <Undo2 />
                        </PsButton>
                        <PsButton icon tip="Redo" keys={["⇧", "⌘", "Z"]} tipBelow disabled={!canRedo} onClick={doRedo}>
                          <Redo2 />
                        </PsButton>
                        <span className={cn("ps-save", saveState === "error" && "is-error")} aria-live="polite">
                          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : saveState === "saved" ? "Saved" : ""}
                        </span>
                      </>
                    )}
                    <PsDivider />
                  </>
                )}
                <PsButton active={inspect} tip="Inspect: hover a screen to read its live DOM" keys={["I"]} tipBelow disabled={editMode} onClick={() => setFlag("i", !inspect)}>
                  <Crosshair /> Inspect
                </PsButton>
                <PsButton active={liveMode} tip="Live frames instead of snapshots for cards near the viewport" keys={["L"]} tipBelow onClick={() => setFlag("live", !liveMode)}>
                  <Play /> Live
                </PsButton>
                <PsDivider />
                <PsButton
                  icon
                  active={placing}
                  tip="Leave a comment: click an item or the board"
                  keys={["M"]}
                  tipBelow
                  onClick={() => setPlacing((p) => !p)}
                  style={placing ? { color: "var(--ps-comment)", background: "var(--ps-comment-soft)" } : undefined}
                >
                  <MessageCirclePlus />
                </PsButton>
                <PsButton icon active={commentsOpen} tip="Comments" tipBelow onClick={() => setParam("comments", commentsOpen ? null : "1")} className="relative">
                  <MessageCircle />
                  {boardComments > 0 && <span className="ps-ccount">{boardComments}</span>}
                </PsButton>
                <PsDivider />
                <PsButton icon tip="Zoom out" keys={["−"]} tipBelow onClick={() => pz.current?.zoomBy(1 / 1.5, true)}>
                  <Minus />
                </PsButton>
                <PsButton className="ps-mono tabular-nums px-1.5 w-14 justify-center" tip="Fit the board" keys={["0"]} tipBelow onClick={() => fit(true)}>
                  <span ref={zoomLabel}>{fmtZoom(t.k)}</span>
                </PsButton>
                <PsButton icon tip="Zoom in" keys={["+"]} tipBelow onClick={() => pz.current?.zoomBy(1.5, true)}>
                  <Plus />
                </PsButton>
                <PsButton icon tip="Fit the board" keys={["2"]} tipBelow onClick={() => fit(true)}>
                  <Maximize2 />
                </PsButton>
                <PsDivider />
                <ThemeToggle tipBelow />
                <HelpButton tipBelow />
              </div>

              <ShortcutsSheet
                items={[
                  ...(writable
                    ? ([
                        ["Edit mode", "E"],
                        ["Multi-select", "⇧ click · ⇧ drag"],
                        ["Duplicate", "⌘ D"],
                        ["Delete", "⌫"],
                        ["Nudge", "← → ↑ ↓"],
                        ["Undo / redo", "⌘ Z · ⇧ ⌘ Z"],
                        ["Edit text", "double-click · ↵"],
                      ] as Array<[string, string]>)
                    : []),
                  ["Live frames", "L"],
                  ["Leave a comment", "M"],
                  ["Wireframe", "W"],
                  ["Theme", "T"],
                  ["Zoom in / out", "+ −"],
                  ["100% / fit", "1 2"],
                  ["Hide / show UI", "⌘ \\ ⇧ H"],
                  ["This sheet", "?"],
                ]}
              />

              {commentsOpen && (
                <CommentsPanel
                  wireframe={wireframe}
                  here={{ label: board?.title ?? id, test: (c) => c.board === id, open: (c) => setParam("c", c.id) }}
                  onClose={() => setParam("comments", null)}
                  onAdd={() => {
                    setParam("comments", null)
                    setPlacing(true)
                  }}
                />
              )}

              {editMode && (
                <div className="ps ps-glass absolute bottom-4 left-4 z-20 rounded-xl px-3 py-1.5 flex items-center gap-4 text-[11px]" style={{ color: "var(--ps-muted)" }} data-ps-ui>
                  <span>drag to move</span>
                  <span>⇧ click or ⇧ drag to select more</span>
                  <span>double-click to edit text</span>
                  <span>⌘D duplicate · ⌫ delete</span>
                </div>
              )}
            </>
          )}
        </div>
      </CanvasInspectContext.Provider>
    </CanvasViewportContext.Provider>
  )
}

/* ------------------------------------------------------------------ */


/** The board's own title and description, set in the canvas above its content like a page heading. */
function BoardHeading({ board, x, y, editMode, onPatch }: { board: BoardFile; x: number; y: number; editMode: boolean; onPatch: (p: Partial<BoardFile>) => void }) {
  const [edit, setEdit] = useState(false)
  return (
    <div className="ps-board-heading" style={{ left: x, top: y - 56 }} data-ps-ui={editMode ? true : undefined}>
      <div className="ps-zs-head">
        {edit ? (
          <InlineInput
            value={board.title}
            className="ps-board-title"
            onDone={(v) => {
              setEdit(false)
              if (v != null && v.trim() && v !== board.title) onPatch({ title: v.trim() })
            }}
          />
        ) : (
          <h1 className="ps-board-title" onDoubleClick={() => editMode && setEdit(true)}>
            {board.title}
          </h1>
        )}
        {board.description && <p className="ps-board-desc">{board.description}</p>}
      </div>
    </div>
  )
}
