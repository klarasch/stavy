import { useEffect, useState } from "react"
import { findProtoTarget } from "../proto"
import type { AnnotationDef } from "../types"

interface Pin extends AnnotationDef {
  top: number
  left: number
}

export type AnnotationMode = "hover" | "all"

/**
 * Annotation pins on a page. `hover`: numbered pins, note on hover, click to
 * keep it open. `all`: every note open at once (review / print mode).
 */
export function AnnotationOverlay({
  annotations,
  wrapper,
  mode = "hover",
}: {
  annotations: AnnotationDef[]
  wrapper: HTMLElement
  mode?: AnnotationMode
}) {
  const [pins, setPins] = useState<Pin[]>([])
  const [pinned, setPinned] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const isOpen = (id: string) => mode === "all" || pinned === id || hovered === id

  useEffect(() => {
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const measure = () => {
      const w = wrapper.getBoundingClientRect()
      const found: Pin[] = []
      for (const a of annotations) {
        const el = findProtoTarget(wrapper, a.target)
        if (!el) continue
        const r = el.getBoundingClientRect()
        found.push({
          ...a,
          top: r.top - w.top + wrapper.scrollTop - 10,
          left: r.left - w.left + wrapper.scrollLeft + r.width - 10,
        })
      }
      setPins(found)
      if (tries++ < 20) timer = setTimeout(measure, 250)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("resize", measure)
    }
  }, [annotations, wrapper])

  return (
    <div className="absolute inset-0 pointer-events-none z-30" data-ps-ui>
      {pins.map((p, i) => (
        <div
          key={p.target}
          className="absolute"
          style={{ top: p.top, left: p.left, zIndex: isOpen(p.target) ? 2 : 1 }}
          onMouseEnter={() => setHovered(p.target)}
          onMouseLeave={() => setHovered(null)}
        >
          <button className="ps-pin pointer-events-auto size-6! text-[11px]!" onClick={() => setPinned(pinned === p.target ? null : p.target)}>
            {i + 1}
          </button>
          {isOpen(p.target) && (
            <div className="ps ps-glass-strong pointer-events-auto absolute top-8 right-0 w-72 rounded-xl p-3.5 z-10">
              <div className="text-[13px] font-semibold mb-1">{p.title}</div>
              <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--ps-muted)" }}>
                {p.note}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
