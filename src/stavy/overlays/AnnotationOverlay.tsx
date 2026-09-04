import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { findTarget } from "../manifest"
import { hostRect, onFrameChange } from "../frame"
import type { AnnotationDef } from "../types"

interface Pin extends AnnotationDef {
  top: number
  left: number
}

export type AnnotationMode = "hover" | "all"

/**
 * Annotation pins over the player frame. `hover`: numbered pins, note on
 * hover, click to keep it open. `all`: every note open at once (review /
 * print mode). Targets are measured inside the frame and drawn in a fixed
 * host layer, following the frame's scroll.
 */
export function AnnotationOverlay({
  annotations,
  iframe,
  doc,
  mode = "hover",
}: {
  annotations: AnnotationDef[]
  iframe: HTMLIFrameElement | null
  doc: Document | null
  mode?: AnnotationMode
}) {
  const [pins, setPins] = useState<Pin[]>([])
  const [pinned, setPinned] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const isOpen = (id: string) => mode === "all" || pinned === id || hovered === id

  useEffect(() => {
    if (!iframe || !doc) {
      setPins([])
      return
    }
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const measure = () => {
      const found: Pin[] = []
      for (const a of annotations) {
        const el = findTarget(doc, a.target)
        if (!el) continue
        const r = hostRect(el, iframe)
        found.push({ ...a, top: r.top - 10, left: r.left + r.width - 10 })
      }
      setPins(found)
    }
    const settle = () => {
      measure()
      if (tries++ < 20) timer = setTimeout(settle, 250)
    }
    settle()
    const off = onFrameChange(iframe, measure)
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [annotations, iframe, doc])

  return createPortal(
    <div className="ps-fixed-layer" data-ps-ui>
      {pins.map((p, i) => (
        <div
          key={p.target}
          className="absolute"
          style={{ top: p.top, left: p.left, zIndex: isOpen(p.target) ? 2 : 1, pointerEvents: "auto" }}
          onMouseEnter={() => setHovered(p.target)}
          onMouseLeave={() => setHovered(null)}
        >
          <button className="ps-pin size-6! text-[11px]!" onClick={() => setPinned(pinned === p.target ? null : p.target)}>
            {i + 1}
          </button>
          {isOpen(p.target) && (
            <div className="ps ps-glass-strong absolute top-8 right-0 w-72 rounded-xl p-3.5 z-10">
              <div className="text-[13px] font-semibold mb-1">{p.title}</div>
              <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--ps-muted)" }}>
                {p.note}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body
  )
}
