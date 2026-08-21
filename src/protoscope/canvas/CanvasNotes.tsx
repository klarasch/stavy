import { useEffect, useRef, useState } from "react"
import { getPage, resolveDims, instanceKey } from "../manifest"
import type { CanvasNote } from "../types"

interface Placed {
  note: CanvasNote
  /** note box position (canvas/content coordinates) */
  x: number
  y: number
  /** translate so the box hangs off its anchor correctly */
  tx: string
  /** leader line: from note anchor to target */
  ax: number
  ay: number
  px: number
  py: number
}

const NOTE_W = 220
const GAP = 26

/**
 * "Pointing notes": sticky notes placed next to a page instance on the canvas,
 * with a leader line to the instance — or to a specific data-proto element
 * inside it. Measured in canvas content coordinates (divided by the current
 * zoom), so they stay glued to their targets at any zoom level.
 */
export function CanvasNotes({
  notes,
  root,
  getScale,
}: {
  notes: CanvasNote[]
  root: HTMLElement
  getScale: () => number
}) {
  const [placed, setPlaced] = useState<Placed[]>([])
  const raf = useRef<number | null>(null)

  useEffect(() => {
    let tries = 0
    let timer: ReturnType<typeof setTimeout>
    const measure = () => {
      const k = getScale()
      const rootRect = root.getBoundingClientRect()
      const toLocal = (px: number, py: number) => ({
        x: (px - rootRect.left) / k,
        y: (py - rootRect.top) / k,
      })
      const out: Placed[] = []
      for (const n of notes) {
        const page = getPage(n.page)
        if (!page) continue
        const dims = resolveDims(page, n.dims ?? page.instances?.[0]?.dims)
        const key = instanceKey(n.page, dims)
        const card =
          root.querySelector<HTMLElement>(`[data-instance="${CSS.escape(key)}"][data-instance-scope="pages"]`) ??
          root.querySelector<HTMLElement>(`[data-instance="${CSS.escape(key)}"]`)
        if (!card) continue
        const frame = card.firstElementChild?.firstElementChild as HTMLElement | null
        const targetEl = n.target && frame ? frame.querySelector<HTMLElement>(`[data-proto="${CSS.escape(n.target)}"]`) : null
        const fr = (frame ?? card).getBoundingClientRect()
        const tr = (targetEl ?? frame ?? card).getBoundingClientRect()
        const tl = toLocal(fr.left, fr.top)
        const br = toLocal(fr.right, fr.bottom)
        const tc = targetEl
          ? toLocal(tr.left + tr.width / 2, tr.top + tr.height / 2)
          : { x: (tl.x + br.x) / 2, y: tl.y + 6 }
        const ox = n.offset?.x ?? 0
        const oy = n.offset?.y ?? 0
        const placement = n.placement ?? "top"
        let p: Placed
        if (placement === "right") {
          const ax = br.x + GAP + ox
          const ay = tc.y + oy
          p = { note: n, x: ax, y: ay, tx: "translateY(-50%)", ax, ay, px: tc.x, py: tc.y }
        } else if (placement === "left") {
          const ax = tl.x - GAP + ox
          const ay = tc.y + oy
          p = { note: n, x: ax - NOTE_W, y: ay, tx: "translateY(-50%)", ax, ay, px: tc.x, py: tc.y }
        } else if (placement === "bottom") {
          const ax = tc.x + ox
          const ay = br.y + 58 + oy
          p = { note: n, x: ax - NOTE_W / 2, y: ay, tx: "none", ax, ay, px: tc.x, py: targetEl ? tc.y : br.y - 6 }
        } else {
          const ax = tc.x + ox
          const ay = tl.y - GAP + oy
          p = { note: n, x: ax - NOTE_W / 2, y: ay, tx: "translateY(-100%)", ax, ay, px: tc.x, py: tc.y }
        }
        out.push(p)
      }
      setPlaced(out)
      if (tries++ < 12) timer = setTimeout(measure, 350)
    }
    measure()
    const ro = new ResizeObserver(() => {
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = requestAnimationFrame(measure)
    })
    ro.observe(root)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [notes, root, getScale])

  if (!placed.length) return null

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }} data-ps-ui>
      <svg className="absolute inset-0 overflow-visible" width="100%" height="100%">
        <defs>
          <marker id="ps-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ps-note-line)" />
          </marker>
        </defs>
        {placed.map((p) => {
          const mx = (p.ax + p.px) / 2
          const my = (p.ay + p.py) / 2
          const horizontal = Math.abs(p.px - p.ax) > Math.abs(p.py - p.ay)
          const c1 = horizontal ? `${mx} ${p.ay}` : `${p.ax} ${my}`
          const c2 = horizontal ? `${mx} ${p.py}` : `${p.px} ${my}`
          return (
            <g key={p.note.id}>
              <path
                d={`M ${p.ax} ${p.ay} C ${c1}, ${c2}, ${p.px} ${p.py}`}
                fill="none"
                stroke="var(--ps-note-line)"
                strokeWidth={1.5}
                strokeLinecap="round"
                markerEnd="url(#ps-arrow)"
              />
              <circle cx={p.ax} cy={p.ay} r={2.5} fill="var(--ps-note-line)" />
            </g>
          )
        })}
      </svg>
      {placed.map((p) => (
        <div
          key={p.note.id}
          className="ps ps-note pointer-events-auto"
          style={{ left: p.x, top: p.y, transform: `${p.tx} rotate(-0.6deg)` }}
        >
          {p.note.text}
        </div>
      ))}
    </div>
  )
}
