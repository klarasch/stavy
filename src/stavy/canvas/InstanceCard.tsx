import { memo, useContext, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CanvasInspectContext, useLiveWhenVisible } from "./visibility"
import { getPage, pageUrl, appUrl, valueLabel, instanceKey, snapshotUrl, snapshotEntry } from "../manifest"
import { frameDoc, setWireframe } from "../frame"
import type { AnnotationDef } from "../types"
import { cn } from "../cn"
import { useComments } from "../comments/store"

export const VIEWPORT_W = 1280
export const VIEWPORT_H = 832

interface PinPos extends AnnotationDef {
  leftPct: number
  topPct: number
}

/**
 * One page variant on the canvas. By decision the canvas is a *map*, not a
 * playground: a card shows the instance's snapshot (written by
 * `scripts/scan.mjs`) and clicking it opens the player. A same-origin frame
 * of the real prototype is mounted underneath only when it earns its cost —
 * while the inspector hovers this card (so it can read the live DOM), or in
 * "live" mode for cards near the viewport — and even then a shield swallows
 * every pointer event, so a flow step never navigates itself away.
 * Pins come from the snapshot index (target boxes measured at scan time).
 */
export const InstanceCard = memo(function InstanceCard({
  pageId,
  dims,
  note,
  scale = 0.2,
  href,
  annotations,
  showPins = false,
  scope = "pages",
  frame,
  hideChips = false,
  wireframe = false,
}: {
  pageId: string
  dims: Record<string, string>
  note?: string
  scale?: number
  href?: string
  annotations?: AnnotationDef[]
  showPins?: boolean
  scope?: "pages" | "scenarios"
  frame?: { width: number; height: number }
  hideChips?: boolean
  /** Canvas wireframe mode: opened page should keep it on (SPEC.md §3 deep links). */
  wireframe?: boolean
}) {
  const FW = frame?.width ?? VIEWPORT_W
  const FH = frame?.height ?? VIEWPORT_H
  const { countFor } = useComments()
  const commentCount = countFor(pageId, dims)
  const navigate = useNavigate()
  const frameRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const inspect = useContext(CanvasInspectContext)
  const near = useLiveWhenVisible(frameRef)
  const [hover, setHover] = useState(false)
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [snapErr, setSnapErr] = useState(false)
  const page = getPage(pageId)
  const entry = page ? snapshotEntry(page, dims) : undefined
  const snapshot = page ? snapshotUrl(page, dims) : null
  const w = Math.round(FW * scale)
  const h = Math.round(FH * scale)
  const url = href ?? pageUrl(pageId, dims, wireframe ? { w: "1" } : undefined)
  const key = instanceKey(pageId, dims)

  // Hover with a short delay in, a grace period out — sweeping the pointer
  // across the canvas must not mount a frame per card it crosses.
  const hoverT = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enter = () => {
    if (hoverT.current) clearTimeout(hoverT.current)
    hoverT.current = setTimeout(() => setHover(true), 140)
  }
  const leave = () => {
    if (hoverT.current) clearTimeout(hoverT.current)
    hoverT.current = setTimeout(() => setHover(false), 600)
  }
  useEffect(() => () => { if (hoverT.current) clearTimeout(hoverT.current) }, [])

  const held = !!inspect.hold && inspect.hold === iframeRef.current
  const live = !!page && ((inspect.on && (hover || held)) || (inspect.live && near))
  useEffect(() => {
    if (!live) setReady(false)
  }, [live])
  useEffect(() => {
    if (live && ready) setWireframe(frameDoc(iframeRef.current), wireframe)
  }, [live, ready, wireframe])

  const pins: PinPos[] =
    showPins && entry && annotations
      ? annotations.flatMap((a) => {
          const b = entry.targets[a.target]
          if (!b) return []
          return [{ ...a, leftPct: Math.min(94, Math.max(3, (b.x + b.w) * 100)), topPct: Math.min(92, Math.max(3, b.y * 100)) }]
        })
      : []

  return (
    <div
      className={cn("ps flex flex-col gap-1.5", open && "relative z-30")}
      style={{ width: w }}
      data-instance={key}
      data-instance-scope={scope}
      onPointerEnter={inspect.on ? enter : undefined}
      onPointerLeave={inspect.on ? leave : undefined}
    >
      <div className="relative">
        <div
          ref={frameRef}
          className="ps-card-frame relative rounded-lg bg-white overflow-hidden cursor-zoom-in transition-[box-shadow,transform] duration-150 hover:-translate-y-px"
          style={{ width: w, height: h }}
        >
          <div className="absolute inset-0 flex items-center justify-center text-[11px] font-medium" style={{ color: "var(--ps-faint)" }}>
            {page?.label ?? pageId}
          </div>
          {live && page && (
            <iframe
              ref={iframeRef}
              className={cn("ps-frame ps-card-live", ready && "is-ready")}
              title={page.label}
              src={appUrl(page, dims)}
              tabIndex={-1}
              style={{ width: FW, height: FH, transform: `scale(${scale})` }}
              onLoad={() => setReady(true)}
            />
          )}
          {snapshot && !snapErr && <img className="ps-card-img" src={snapshot} alt="" draggable={false} onError={() => setSnapErr(true)} />}
          {/* The shield: cards are static previews — click opens the player; the inspector hit-tests through it. */}
          <div className="ps-card-shield" onClick={() => navigate(url)} />
        </div>
        {commentCount > 0 && (
          <span className="ps-cbubble ps-cbubble-badge" data-ps-ui title={`${commentCount} open comment(s)`}>{commentCount}</span>
        )}
        {pins.map((p, i) => (
          <span key={p.target} className="absolute" data-ps-ui style={{ left: `${p.leftPct}%`, top: `${p.topPct}%` }}>
            <span
              onClick={(e) => {
                e.stopPropagation()
                setOpen(open === p.target ? null : p.target)
              }}
              className="ps-pin -translate-x-1/2 -translate-y-1/2"
            >
              {i + 1}
            </span>
            {open === p.target && (
              <div className="ps ps-glass-strong absolute left-0 top-2 w-60 rounded-xl p-3 z-30" onClick={(e) => e.stopPropagation()}>
                <div className="text-xs font-semibold mb-0.5">{p.title}</div>
                <p className="text-[11px] leading-snug" style={{ color: "var(--ps-muted)" }}>
                  {p.note}
                </p>
              </div>
            )}
          </span>
        ))}
      </div>
      {!hideChips && (
        <div className="flex flex-wrap gap-1 px-0.5">
          {Object.entries(dims).map(([d, v]) => (
            <span key={d} className="ps-chip ps-chip-sm">
              {valueLabel(d, v)}
            </span>
          ))}
        </div>
      )}
      {note && (
        <p className="text-[11px] leading-snug px-0.5" style={{ color: "var(--ps-muted)" }}>
          {note}
        </p>
      )}
    </div>
  )
},
(a, b) =>
  a.pageId === b.pageId &&
  instanceKey(a.pageId, a.dims) === instanceKey(b.pageId, b.dims) &&
  a.note === b.note &&
  a.scale === b.scale &&
  a.href === b.href &&
  a.annotations === b.annotations &&
  a.showPins === b.showPins &&
  a.scope === b.scope &&
  a.hideChips === b.hideChips &&
  a.wireframe === b.wireframe &&
  a.frame?.width === b.frame?.width &&
  a.frame?.height === b.frame?.height)
