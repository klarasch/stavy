import { memo, useEffect, useRef, useState } from "react"
import { PageRenderer } from "../PageRenderer"
import { resolveDims } from "../manifest"
import { findProtoTarget } from "../proto"
import { VIEWPORT_W, VIEWPORT_H } from "./InstanceCard"
import { useLiveWhenVisible } from "./visibility"
import type { PageDef } from "../types"

interface Callout {
  n: number
  title: string
  note: string
  left: number
  top: number
  width: number
  height: number
}

/**
 * Design anatomy: one instance of the page with its *annotations* drawn as
 * numbered callouts and a legend of what each part does — for PMs, designers
 * and engineers alike. (Which components implement a part is the inspector's
 * job, not this card's.)
 */
export const AnatomyCard = memo(function AnatomyCard({ page, scale = 0.3 }: { page: PageDef; scale?: number }) {
  const annotations = page.annotations ?? []
  const dims = resolveDims(page, page.instances?.[0]?.dims)
  const FW = page.frame?.width ?? VIEWPORT_W
  const FH = page.frame?.height ?? VIEWPORT_H
  const w = Math.round(FW * scale)
  const h = Math.round(FH * scale)
  const frameRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const live = useLiveWhenVisible(frameRef)
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null)
  const [callouts, setCallouts] = useState<Callout[]>([])

  useEffect(() => {
    if (!annotations.length) return
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const measure = () => {
      const frame = frameRef.current
      const content = contentRef.current
      if (!frame || !content) return
      const c = frame.getBoundingClientRect()
      if (!c.width) return
      const out: Callout[] = []
      annotations.forEach((a, i) => {
        const el = findProtoTarget(content, a.target)
        if (!el) return
        const r = el.getBoundingClientRect()
        out.push({
          n: i + 1,
          title: a.title,
          note: a.note,
          left: ((r.left - c.left) / c.width) * 100,
          top: ((r.top - c.top) / c.height) * 100,
          width: (r.width / c.width) * 100,
          height: (r.height / c.height) * 100,
        })
      })
      setCallouts(out)
      if (tries++ < 8) timer = setTimeout(measure, 350)
    }
    measure()
    return () => clearTimeout(timer)
  }, [page.id, annotations, live])

  if (!annotations.length) return null

  return (
    <div className="ps flex items-start gap-6" data-ps-ui>
      <div ref={frameRef} className="ps-card-frame relative rounded-lg bg-white overflow-hidden shrink-0" style={{ width: w, height: h }}>
        {live && (
          <div
            ref={(el) => {
              contentRef.current = el
              setPortalHost(el)
            }}
            inert
            className="relative pointer-events-none select-none origin-top-left"
            style={{ width: FW, height: FH, transform: `scale(${scale})` }}
          >
            {portalHost && <PageRenderer pageId={page.id} dims={dims} nav={() => {}} portalContainer={portalHost} />}
          </div>
        )}
        {callouts.map((c) => (
          <div key={c.n}>
            <div className="ps-anat-box" style={{ left: `${c.left}%`, top: `${c.top}%`, width: `${c.width}%`, height: `${c.height}%` }} />
            <div className="ps-anat-tag" style={{ left: `${c.left}%`, top: `${c.top}%` }}>{c.n}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2.5 pt-1" style={{ width: 300 }}>
        {annotations.map((a, i) => (
          <div key={a.target} className="flex items-start gap-2.5">
            <span className="ps-anat-tag" style={{ position: "static", transform: "none", flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
            <div>
              <div className="text-[12.5px] font-semibold leading-tight">{a.title}</div>
              <div className="ps-sub leading-snug mt-0.5">{a.note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})
