import { memo, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { PageRenderer } from "../PageRenderer"
import { pageUrl, valueLabel, instanceKey } from "../manifest"
import { findProtoTarget } from "../proto"
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
 * A live-rendered, scaled instance of a page variant on the canvas.
 * Clicking it zooms into the fully interactive page. When `showPins` is on,
 * the page's annotations render as pins over the thumbnail — positions are
 * stored as percentages so they survive canvas zoom.
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
}) {
  const FW = frame?.width ?? VIEWPORT_W
  const FH = frame?.height ?? VIEWPORT_H
  const { countFor } = useComments()
  const commentCount = countFor(pageId, dims)
  const navigate = useNavigate()
  const frameRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [pins, setPins] = useState<PinPos[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const w = Math.round(FW * scale)
  const h = Math.round(FH * scale)
  const url = href ?? pageUrl(pageId, dims)
  const key = instanceKey(pageId, dims)

  useEffect(() => {
    if (!showPins || !annotations?.length) {
      setPins([])
      return
    }
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const measure = () => {
      const frame = frameRef.current
      const content = contentRef.current
      if (!frame || !content) return
      const c = frame.getBoundingClientRect()
      if (c.width === 0) return
      const found: PinPos[] = []
      for (const a of annotations) {
        const el = findProtoTarget(content, a.target)
        if (!el) continue
        const t = el.getBoundingClientRect()
        found.push({
          ...a,
          leftPct: Math.min(94, Math.max(3, ((t.left - c.left + t.width) / c.width) * 100)),
          topPct: Math.min(92, Math.max(3, ((t.top - c.top) / c.height) * 100)),
        })
      }
      setPins(found)
      if (tries++ < 10) timer = setTimeout(measure, 300)
    }
    measure()
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, showPins, pageId, key])

  return (
    <div
      className={cn("ps flex flex-col gap-1.5", open && "relative z-30")}
      style={{ width: w }}
      data-instance={key}
      data-instance-scope={scope}
    >
      <div className="relative">
        <div
          ref={frameRef}
          onClick={() => navigate(url)}
          className="ps-card-frame rounded-lg bg-white overflow-hidden cursor-zoom-in transition-[box-shadow,transform] duration-150 hover:-translate-y-px"
          style={{ width: w, height: h }}
        >
          <div
            ref={contentRef}
            className="ps-proto-content pointer-events-none select-none origin-top-left"
            style={{ width: FW, height: FH, transform: `scale(${scale})` }}
          >
            <PageRenderer pageId={pageId} dims={dims} nav={() => {}} />
          </div>
        </div>
        {commentCount > 0 && (
          <span className="ps-cbubble ps-cbubble-badge" data-ps-ui title={`${commentCount} open comment(s)`}>{commentCount}</span>
        )}
        {showPins &&
          pins.map((p, i) => (
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
                <div
                  className="ps ps-glass-strong absolute left-0 top-2 w-60 rounded-xl p-3 z-30"
                  onClick={(e) => e.stopPropagation()}
                >
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
  a.frame?.width === b.frame?.width &&
  a.frame?.height === b.frame?.height)
