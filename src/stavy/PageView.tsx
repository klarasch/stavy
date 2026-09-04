import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Layers, MessageSquare, Crosshair, Play, PencilRuler, ChevronLeft, SlidersHorizontal, RotateCcw, GripVertical, MessageCircle, MessageCirclePlus, PanelBottom, PictureInPicture2, ExternalLink } from "./icons"
import { cn } from "./cn"
import {
  canvasUrl,
  manifest,
  getPage,
  getScenario,
  getTemplate,
  dimsFromParams,
  resolveDims,
  pageUrl,
  appUrl,
  matchAppUrl,
  dimsEqual,
  dimensionLabel,
  valueLabel,
  isWorkspaceDim,
  workspaceDimensions,
  workspaceDimsFromParams,
  workspaceKey,
  workspaceCarry,
  pageInWorkspace,
} from "./manifest"
import { TourOverlay, stepUrl } from "./overlays/TourOverlay"
import { AnnotationOverlay } from "./overlays/AnnotationOverlay"
import { Inspector, type FrameHit } from "./overlays/Inspector"
import { PsButton, PsDivider, PsSelect, Chip, ThemeToggle, MockNotice, HelpButton, ShortcutsSheet, WorkspaceDims, useChrome, useHotkeys, cycleTheme } from "./chrome"
import type { ToolbarAnchor } from "./types"
import { CommentLayer } from "./comments/CommentLayer"
import { CommentsPanel } from "./comments/CommentsPanel"
import { useComments } from "./comments/store"
import { useFrameDocument, frameHref, setWireframe, bridgeFrameKeys, elementAt } from "./frame"

const ANCHORS: ToolbarAnchor[] = ["bottom", "top", "bottom-left", "bottom-right", "top-left", "top-right", "bar-bottom", "bar-top"]

/** Nearest dock anchor for a pointer position: thirds horizontally, halves vertically. */
function anchorFor(x: number, y: number): ToolbarAnchor {
  const col = x < window.innerWidth / 3 ? "left" : x > (2 * window.innerWidth) / 3 ? "right" : "center"
  const row = y < window.innerHeight / 2 ? "top" : "bottom"
  return (col === "center" ? row : `${row}-${col}`) as ToolbarAnchor
}

/**
 * The player: one same-origin frame showing the prototype at a page +
 * dimension assignment, with the viewer chrome floating over it. The
 * prototype is fully interactive here (it is the real app); switching a
 * dimension rewrites the frame URL. In-frame navigation that lands on a
 * registered page is followed (the viewer URL updates); anything else is
 * shown as drift with a reset.
 */
export function PageView() {
  const [sp, setSp] = useSearchParams()
  const pageId = sp.get("p") ?? ""
  const navigate = useNavigate()
  const { hidden, theme, setTheme, setHidden } = useChrome()
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null)
  const [shield, setShield] = useState<HTMLDivElement | null>(null)
  const doc = useFrameDocument(iframe)
  const [dimPanel, setDimPanel] = useState(false)
  const [drag, setDrag] = useState<{ dx: number; dy: number; target: ToolbarAnchor } | null>(null)
  const [placing, setPlacing] = useState(false)
  const [drift, setDrift] = useState<string | null>(null)
  const { countFor } = useComments()

  const page = getPage(pageId)
  const dims = useMemo(() => (page ? dimsFromParams(page, sp) : {}), [page, sp])
  const wKey = workspaceKey(sp)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wdims = useMemo(() => workspaceDimsFromParams(sp), [wKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wCarry = useMemo(() => workspaceCarry(sp), [wKey])
  const wireOn = sp.get("w") === "1"

  const setParam = useCallback(
    (k: string, v: string | null) => {
      const next = new URLSearchParams(sp)
      if (v === null) next.delete(k)
      else next.set(k, v)
      setSp(next, { replace: true })
    },
    [sp, setSp]
  )

  const annotParam = sp.get("a")
  const annotMode: "hover" | "all" | null = annotParam === "all" ? "all" : annotParam ? "hover" : null
  const inspectOn = sp.get("i") === "1"
  const commentsOpen = sp.get("comments") === "1"
  const openCommentId = sp.get("c")
  const tourId = sp.get("tour")
  const tourStep = Number(sp.get("ts") ?? "0")
  const scenario = tourId ? getScenario(tourId) : undefined

  // Viewer mode flags to keep alive across every in-viewer navigation (SPEC.md §3).
  const carry: Record<string, string> = { ...wCarry }
  if (annotMode) carry.a = annotMode
  if (inspectOn) carry.i = "1"
  if (wireOn) carry.w = "1"

  /* ---- the frame follows the viewer URL, and the viewer follows the frame ---- */
  const desired = page ? appUrl(page, dims) : null
  useEffect(() => {
    if (!iframe || !page || !desired) return
    const cur = frameHref(iframe)
    const m = cur ? matchAppUrl(cur) : null
    // Already showing this exact state (e.g. we just followed the frame there): don't reload.
    if (m && m.page.id === page.id && dimsEqual(m.dims, dims)) return
    iframe.src = desired
    setDrift(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframe, desired])

  const lastHref = useRef<string | null>(null)
  useEffect(() => {
    if (!iframe || !page) return
    const tick = () => {
      const href = frameHref(iframe)
      if (!href || href === lastHref.current) return
      lastHref.current = href
      const m = matchAppUrl(href)
      if (!m) {
        setDrift(href)
        return
      }
      setDrift(null)
      if (m.page.id !== page.id || !dimsEqual(m.dims, dims)) {
        // The user navigated inside the prototype onto a registered state: follow it.
        const { tour: _t, ts: _s, ...rest } = carry as Record<string, string>
        void _t
        void _s
        navigate(pageUrl(m.page.id, m.dims, rest), { replace: true })
      }
    }
    const t = setInterval(tick, 400)
    iframe.addEventListener("load", tick)
    return () => {
      clearInterval(t)
      iframe.removeEventListener("load", tick)
    }
  })

  useEffect(() => setWireframe(doc, wireOn), [doc, wireOn])
  useEffect(() => bridgeFrameKeys(doc), [doc])

  if (!page) {
    return (
      <div className="ps h-screen flex flex-col items-center justify-center gap-3" style={{ background: "var(--ps-canvas-bg)" }}>
        <p>
          Page <code className="ps-mono">{pageId}</code> is not registered in this workspace.
        </p>
        <PsButton onClick={() => navigate(canvasUrl({ ...wCarry, ...(wireOn ? { w: "1" } : {}) }))}>
          <Layers /> Back to canvas
        </PsButton>
      </div>
    )
  }

  const template = getTemplate(page.template)
  const annotOn = annotMode !== null
  const cycleAnnot = () => setParam("a", annotMode === null ? "hover" : annotMode === "hover" ? "all" : null)
  const pageScenarios = manifest.scenarios.filter((s) => s.steps.some((st) => st.page === page.id))
  const exitUrl = pageUrl(page.id, dims, carry)

  // Toolbar dock: manifest default, overridable per link (?tb=) and by dragging the grip.
  const tbParam = sp.get("tb") as ToolbarAnchor | null
  const anchor: ToolbarAnchor = tbParam && ANCHORS.includes(tbParam) ? tbParam : (manifest.viewer?.toolbar ?? "bottom")
  const isBar = anchor.startsWith("bar-")
  const barSide = anchor === "bar-top" || anchor === "top" || anchor.startsWith("top-") ? "top" : "bottom"
  const setAnchor = (next: ToolbarAnchor) => {
    const def = manifest.viewer?.toolbar ?? "bottom"
    setParam("tb", next === def ? null : next)
  }
  // Float ⇄ bar keeps the vertical side; a bar shrinks the prototype viewport instead of covering it.
  const toggleBar = () => setAnchor(isBar ? (barSide === "top" ? "top" : "bottom") : barSide === "top" ? "bar-top" : "bar-bottom")
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const move = (ev: PointerEvent) => setDrag({ dx: ev.clientX - sx, dy: ev.clientY - sy, target: anchorFor(ev.clientX, ev.clientY) })
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      setDrag(null)
      setAnchor(anchorFor(ev.clientX, ev.clientY))
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  // Workspace axes are chosen in the chrome, not in the page switcher (SPEC §1.1).
  const dimEntries = Object.entries(page.dimensions).filter(([d]) => !isWorkspaceDim(d))
  const inScope = pageInWorkspace(page, wdims)
  const outOfScope = Object.entries(wdims).find(([d, v]) => d in page.dimensions && !page.dimensions[d].includes(v))

  const setWorkspaceDim = (dimId: string, value: string) => {
    const dim = workspaceDimensions.find((d) => d.id === dimId)
    if (!dim) return
    const isDefault = dim.values[0].id === value
    if (dimId in page.dimensions && !page.dimensions[dimId].includes(value)) {
      const next = { ...wCarry }
      if (isDefault) delete next[`d_${dimId}`]
      else next[`d_${dimId}`] = value
      navigate(canvasUrl({ ...next, ...(wireOn ? { w: "1" } : {}) }))
      return
    }
    setParam(`d_${dimId}`, isDefault ? null : value)
  }
  const defaultOf = (d: string) => page.defaults?.[d] ?? page.dimensions[d][0]
  const changed = dimEntries.filter(([d]) => dims[d] !== defaultOf(d))
  const inlineDims = dimEntries.length <= 3
  const resetDims = () => {
    const next = new URLSearchParams(sp)
    for (const [d] of dimEntries) next.delete(`d_${d}`)
    setSp(next, { replace: true })
  }
  const resetFrame = () => {
    if (iframe && desired) iframe.src = desired
    setDrift(null)
  }

  useHotkeys({
    n: cycleAnnot,
    i: () => setParam("i", inspectOn ? null : "1"),
    w: () => setParam("w", wireOn ? null : "1"),
    m: () => setPlacing((p) => !p),
    d: () => setDimPanel((o) => !o),
    c: () => navigate(canvasUrl({ ...wCarry, ...(wireOn ? { w: "1" } : {}) })),
    t: () => setTheme(cycleTheme(theme)),
    Escape: () => {
      if (placing) setPlacing(false)
      else if (openCommentId) setParam("c", null)
      else if (dimPanel) setDimPanel(false)
      else if (commentsOpen) setParam("comments", null)
      else if (scenario) navigate(exitUrl)
      else if (inspectOn) setParam("i", null)
      else setHidden(false)
    },
  })
  const commentCount = countFor(page.id, dims)

  const hit = useCallback(
    (e: MouseEvent): FrameHit | null => {
      if (!iframe) return null
      const el = elementAt(iframe, e.clientX, e.clientY)
      return el ? { el, iframe, ctx: { page, template, dims } } : null
    },
    [iframe, page, template, dims]
  )

  return (
    <div className="h-screen relative">
      <div className="ps-viewport h-full relative" data-bar={isBar ? barSide : undefined}>
        <div className="ps-player">
          <iframe ref={setIframe} className="ps-frame" title={page.label} src={desired ?? undefined} />
          {inspectOn && !hidden && <div ref={setShield} className="ps-shield" data-mode="inspect" />}
          <CommentLayer iframe={iframe} doc={doc} pageId={page.id} dims={dims} placing={placing} onPlaced={() => setPlacing(false)} openId={openCommentId} onOpenChange={(id) => setParam("c", id)} />
        </div>
        {annotMode && page.annotations && <AnnotationOverlay annotations={page.annotations} iframe={iframe} doc={doc} mode={annotMode} />}
        {scenario && <TourOverlay scenario={scenario} stepIdx={tourStep} iframe={iframe} doc={doc} exitUrl={exitUrl} carry={carry} />}
        {inspectOn && !hidden && shield && <Inspector host={shield} hit={hit} onClose={() => setParam("i", null)} />}
      </div>

      {!hidden && (
        <div
          className="ps-dock"
          data-anchor={anchor}
          data-dragging={drag ? "true" : undefined}
          style={drag ? { transform: `${anchor === "bottom" || anchor === "top" ? "translateX(-50%) " : ""}translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
        >
          {dimPanel && (
            <div className="ps ps-glass-strong rounded-2xl p-3.5 mb-1" style={{ width: 560, maxWidth: "94vw" }}>
              <div className="flex items-center gap-2 mb-3">
                <SlidersHorizontal className="size-3.5" style={{ color: "var(--ps-muted)" }} />
                <span className="font-semibold text-[12.5px]">Dimensions</span>
                <span className="ps-sub">{dimEntries.length} axes, {changed.length} changed from default</span>
                <button className="ps-btn ml-auto h-6 px-2 text-[11px]" disabled={changed.length === 0} onClick={resetDims}>
                  <RotateCcw /> Reset
                </button>
              </div>
              <div className="grid gap-y-2 gap-x-4 items-center" style={{ gridTemplateColumns: "auto 1fr" }}>
                {dimEntries.map(([dimId, values]) => (
                  <div key={dimId} className="contents">
                    <span className="text-[11.5px] whitespace-nowrap" style={{ color: dims[dimId] !== defaultOf(dimId) ? "var(--ps-fg)" : "var(--ps-muted)" }}>
                      {dimensionLabel(dimId)}
                    </span>
                    <div className="ps-seg">
                      {values.map((v) => (
                        <button key={v} data-on={dims[dimId] === v ? "true" : undefined} onClick={() => setParam(`d_${dimId}`, v)}>
                          {valueLabel(dimId, v)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!isBar && <MockNotice />}
          <div className="ps ps-glass rounded-2xl pl-1 pr-1.5 py-1 flex items-center gap-0.5">
            {!isBar && (
              <span className="ps-grip" title="Drag to move the toolbar" onPointerDown={startDrag}>
                <GripVertical className="size-3.5" />
              </span>
            )}
            <PsButton icon tip={isBar ? "Float the toolbar" : "Dock as a full-width bar (keeps the app intact)"} tipBelow={barSide === "top"} onClick={toggleBar}>
              {isBar ? <PictureInPicture2 /> : <PanelBottom />}
            </PsButton>
            {/* Where am I */}
            <PsButton tip="Back to canvas" keys={["C"]} onClick={() => navigate(canvasUrl({ ...wCarry, ...(wireOn ? { w: "1" } : {}) }))}>
              <ChevronLeft />
              <Layers style={{ color: "var(--ps-accent)" }} />
            </PsButton>
            <span className="font-semibold text-[13px] px-1.5 whitespace-nowrap">{page.label}</span>
            {template && <Chip sm mono>{template.id}</Chip>}
            {drift && (
              <Chip sm className="ps-chip-warn ps-drift" title={`The prototype navigated to ${drift}, which is not a registered state. Reset to return to this page's state.`}>
                off the map
                <button className="ps-copy" onClick={resetFrame} style={{ marginLeft: 2 }}>
                  <RotateCcw className="size-3" /> reset
                </button>
              </Chip>
            )}
            {workspaceDimensions.length > 0 && (
              <>
                <PsDivider />
                <WorkspaceDims value={wdims} onChange={setWorkspaceDim} />
                {!inScope && outOfScope && (
                  <Chip
                    sm
                    className="ps-chip-warn"
                    title={`This screen is not part of ${dimensionLabel(outOfScope[0])} = ${valueLabel(outOfScope[0], outOfScope[1])} — it declares only ${page.dimensions[outOfScope[0]].map((v) => valueLabel(outOfScope[0], v)).join(", ")}. You reached it by a direct link.`}
                  >
                    not in {valueLabel(outOfScope[0], outOfScope[1])}
                  </Chip>
                )}
              </>
            )}
            <PsDivider />

            {/* Dimensions: inline pills up to 3 axes, a panel beyond that */}
            {inlineDims ? (
              dimEntries.map(([dimId, values]) => (
                <PsSelect
                  key={dimId}
                  prefix={dimensionLabel(dimId)}
                  value={dims[dimId]}
                  options={values.map((v) => ({ value: v, label: valueLabel(dimId, v) }))}
                  onChange={(v) => setParam(`d_${dimId}`, v)}
                />
              ))
            ) : (
              <PsButton active={dimPanel} tip="All dimensions" keys={["D"]} onClick={() => setDimPanel((o) => !o)}>
                <SlidersHorizontal />
                {dimEntries.length} dimensions
                {changed.length > 0 && (
                  <span className="ps-chip ps-chip-sm" style={{ marginLeft: 2 }}>
                    {changed.map(([d]) => valueLabel(d, dims[d])).join(" · ")}
                  </span>
                )}
              </PsButton>
            )}
            <PsDivider />

            {/* Tools */}
            {pageScenarios.length > 0 && !scenario && (
              <PsSelect
                value=""
                align="end"
                title="Play a scenario that passes through this page"
                placeholder={
                  <span className="flex items-center gap-1.5" style={{ color: "var(--ps-accent)" }}>
                    <Play className="size-3.5" /> Play
                  </span>
                }
                options={pageScenarios.map((s) => ({ value: s.id, label: s.label }))}
                onChange={(id) => {
                  const sc = getScenario(id)
                  if (sc) navigate(stepUrl(sc, 0, carry))
                }}
              />
            )}
            <PsButton
              icon
              active={annotOn}
              tip={`Annotations: ${annotMode === null ? "hidden" : annotMode === "hover" ? "numbers, notes on hover" : "all notes open"} (click to cycle)`}
              keys={["N"]}
              onClick={cycleAnnot}
              className="relative"
            >
              <MessageSquare />
              {(page.annotations?.length ?? 0) > 0 && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-3.5 h-3.5 px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
                  style={{ background: "var(--ps-pin)", color: "var(--ps-pin-fg)" }}
                >
                  {page.annotations!.length}
                </span>
              )}
            </PsButton>
            <PsButton icon active={inspectOn} tip="Inspect (dev mode)" keys={["I"]} onClick={() => setParam("i", inspectOn ? null : "1")}>
              <Crosshair />
            </PsButton>
            <PsButton icon active={wireOn} tip="Wireframe" keys={["W"]} onClick={() => setParam("w", wireOn ? null : "1")}>
              <PencilRuler />
            </PsButton>
            <PsDivider />
            <PsButton icon active={placing} tip="Leave a comment: click anywhere on the page" keys={["M"]} onClick={() => setPlacing((p) => !p)} style={placing ? { color: "var(--ps-comment)", background: "var(--ps-comment-soft)" } : undefined}>
              <MessageCirclePlus />
            </PsButton>
            <PsButton icon active={commentsOpen} tip="All comments" onClick={() => setParam("comments", commentsOpen ? null : "1")} className="relative">
              <MessageCircle />
              {commentCount > 0 && <span className="ps-ccount">{commentCount}</span>}
            </PsButton>
            <PsDivider />
            <a className="ps-btn ps-icon" href={desired ?? "#"} target="_blank" rel="noreferrer" title="Open this state in the prototype itself (new tab)">
              <ExternalLink />
            </a>
            <ThemeToggle tipBelow={barSide === "top"} />
            <HelpButton tipBelow={barSide === "top"} />
          </div>
          {isBar && <MockNotice className="ps-dock-notice" />}
        </div>
      )}
      {drag && <DockTargetGhost anchor={drag.target} />}
      {commentsOpen && !hidden && <CommentsPanel wireframe={wireOn} onClose={() => setParam("comments", null)} onAdd={() => { setParam("comments", null); setPlacing(true) }} />}
      <ShortcutsSheet
        items={[
          ["Annotations: hidden → on hover → all", "N"], ["Inspect", "I"], ["Wireframe", "W"], ["Leave a comment", "M"], ["Dimensions panel", "D"], ["Back to canvas", "C"],
          ["Tour: next / previous", "→ ←"], ["Exit tour / close", "Esc"], ["Theme", "T"], ["Hide / show UI", "⌘ \\ ⇧ H"], ["This sheet", "?"],
        ]}
      />
    </div>
  )
}

function DockTargetGhost({ anchor }: { anchor: ToolbarAnchor }) {
  const w = 360
  const h = 44
  const style: React.CSSProperties = { width: w, height: h }
  if (anchor.startsWith("top")) style.top = 16
  else style.bottom = 16
  if (anchor.endsWith("left")) style.left = 16
  else if (anchor.endsWith("right")) style.right = 16
  else {
    style.left = "50%"
    style.transform = "translateX(-50%)"
  }
  return <div className="ps-dock-target" style={style} />
}
