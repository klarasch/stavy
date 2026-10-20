import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CanvasViewportContext } from "../canvas/visibility"
import { useComments, initials, type Comment } from "./store"
import { Composer, Thread, clampCard } from "./Thread"

/**
 * Comments on a pan/zoom surface: a board (`?b=`) or the map. A comment sits
 * on an item (its position kept as % of the item's box, so it follows the
 * item when it moves or resizes) or on a point of the empty board (board
 * coordinates). Pins live inside the zoomed content, counter-scaled so they
 * read at any zoom; the thread and composer are fixed cards over it.
 *
 * Placing (`placing`): the next click on the surface picks the item under the
 * pointer (or the point); dragging the background still pans.
 */
export function SurfaceCommentLayer({
  surface,
  itemSelector,
  itemIdOf,
  itemLabel,
  placing,
  onPlaced,
  openId,
  onOpenChange,
  reveal,
}: {
  /** Board id, or MAP_BOARD for the map */
  surface: string
  /** CSS selector matching an item element */
  itemSelector: string
  /** The id stored for an item element */
  itemIdOf: (el: Element) => string | null
  /** Human name of an item, for the composer */
  itemLabel?: (id: string) => string | undefined
  placing: boolean
  onPlaced: () => void
  openId: string | null
  onOpenChange: (id: string | null) => void
  /** Bring a point (surface coordinates) into view */
  reveal?: (x: number, y: number) => void
}) {
  const vp = useContext(CanvasViewportContext)
  const { comments, add, update, remove, reply, author, setAuthor } = useComments()
  const mine = useMemo(() => comments.filter((c) => c.board === surface), [comments, surface])
  const [pins, setPins] = useState<Array<{ c: Comment; x: number; y: number }>>([])
  const [hover, setHover] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [draft, setDraft] = useState<{ item?: string; x: number; y: number; cx: number; cy: number } | null>(null)
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const contentEl = vp?.contentEl() ?? null

  const findItem = useCallback(
    (id: string): HTMLElement | null => {
      if (!contentEl) return null
      for (const el of contentEl.querySelectorAll<HTMLElement>(itemSelector)) if (itemIdOf(el) === id) return el
      return null
    },
    [contentEl, itemSelector, itemIdOf]
  )
  /** An element's box in surface coordinates. */
  const boxOf = useCallback(
    (el: Element) => {
      const k = vp?.get().k || 1
      const cr = contentEl!.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return { x: (r.left - cr.left) / k, y: (r.top - cr.top) / k, w: r.width / k, h: r.height / k }
    },
    [vp, contentEl]
  )
  const toSurface = useCallback(
    (cx: number, cy: number) => {
      const k = vp?.get().k || 1
      const cr = contentEl!.getBoundingClientRect()
      return { x: (cx - cr.left) / k, y: (cy - cr.top) / k }
    },
    [vp, contentEl]
  )
  const toScreen = (x: number, y: number) => {
    const t = vp?.get() ?? { x: 0, y: 0, k: 1 }
    const vr = vp?.viewportEl()?.getBoundingClientRect()
    return { left: (vr?.left ?? 0) + t.x + x * t.k, top: (vr?.top ?? 0) + t.y + y * t.k }
  }

  const measure = useCallback(() => {
    if (!contentEl) return
    const out: Array<{ c: Comment; x: number; y: number }> = []
    for (const c of mine) {
      if (c.item) {
        const el = findItem(c.item)
        if (!el) continue
        const b = boxOf(el)
        out.push({ c, x: b.x + (b.w * (c.x ?? 0)) / 100, y: b.y + (b.h * (c.y ?? 0)) / 100 })
      } else out.push({ c, x: c.x ?? 0, y: c.y ?? 0 })
    }
    setPins((prev) => (JSON.stringify(prev.map((p) => [p.c, p.x, p.y])) === JSON.stringify(out.map((p) => [p.c, p.x, p.y])) ? prev : out))
  }, [contentEl, mine, findItem, boxOf])

  // Items move (drag, layout, late measurement): follow them.
  useEffect(() => {
    measure()
    if (!contentEl) return
    let raf: number | null = null
    const schedule = () => {
      if (raf == null)
        raf = requestAnimationFrame(() => {
          raf = null
          measure()
        })
    }
    const mo = new MutationObserver((list) => {
      // The content element's own style changes on every zoom frame: not a move.
      if (list.some((m) => m.target !== contentEl)) schedule()
    })
    mo.observe(contentEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"] })
    const ro = new ResizeObserver(schedule)
    ro.observe(contentEl)
    const timers = [300, 1000].map((ms) => setTimeout(schedule, ms))
    return () => {
      mo.disconnect()
      ro.disconnect()
      timers.forEach(clearTimeout)
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [measure, contentEl])

  // A fixed card follows its pin while the surface pans and zooms.
  useEffect(() => {
    if (!vp || (!openId && !draft)) return
    return vp.subscribe(tick)
  }, [vp, openId, draft])

  // Opened from a link or the panel: bring it into view, once.
  const revealed = useRef<string | null>(null)
  useEffect(() => {
    if (!openId || revealed.current === openId) return
    const p = pins.find((x) => x.c.id === openId)
    if (!p) return
    revealed.current = openId
    reveal?.(p.x, p.y)
  }, [openId, pins, reveal])

  // Placing: the next click picks an item or a point; a drag still pans.
  useEffect(() => {
    if (!placing || draft || !contentEl) return
    const viewport = vp?.viewportEl()
    const onSurface = (t: EventTarget | null) => t instanceof Element && !!viewport?.contains(t) && !t.closest("[data-ps-ui]")
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (!onSurface(e.target)) return
      down = { x: e.clientX, y: e.clientY }
      // Over an item, nothing else reacts (no drag in edit mode, no player).
      if ((e.target as Element).closest(itemSelector)) {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    const onClick = (e: MouseEvent) => {
      if (!onSurface(e.target)) return
      e.stopPropagation()
      e.preventDefault()
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      const itemEl = (e.target as Element).closest(itemSelector)
      const item = itemEl ? (itemIdOf(itemEl) ?? undefined) : undefined
      let x: number
      let y: number
      if (itemEl && item) {
        const b = boxOf(itemEl)
        const p = toSurface(e.clientX, e.clientY)
        x = Math.round(((p.x - b.x) / (b.w || 1)) * 10000) / 100
        y = Math.round(((p.y - b.y) / (b.h || 1)) * 10000) / 100
      } else ({ x, y } = toSurface(e.clientX, e.clientY))
      setHover(null)
      setDraft({ item, x, y, cx: e.clientX, cy: e.clientY })
      onOpenChange(null)
    }
    const onMove = (e: MouseEvent) => {
      const itemEl = onSurface(e.target) ? (e.target as Element).closest(itemSelector) : null
      if (!itemEl) return setHover(null)
      const r = itemEl.getBoundingClientRect()
      setHover({ left: r.left, top: r.top, width: r.width, height: r.height })
    }
    window.addEventListener("pointerdown", onDown, { capture: true })
    window.addEventListener("click", onClick, { capture: true })
    window.addEventListener("mousemove", onMove, { passive: true })
    document.documentElement.classList.add("ps-commenting")
    return () => {
      window.removeEventListener("pointerdown", onDown, { capture: true })
      window.removeEventListener("click", onClick, { capture: true })
      window.removeEventListener("mousemove", onMove)
      document.documentElement.classList.remove("ps-commenting")
      setHover(null)
    }
  }, [placing, draft, contentEl, vp, itemSelector, itemIdOf, boxOf, toSurface, onOpenChange])

  const open = pins.find((p) => p.c.id === openId) ?? null
  const openAt = open ? toScreen(open.x, open.y) : null
  const where = (c: { item?: string }) => (c.item ? `@${itemLabel?.(c.item) ?? c.item}` : "on the board")

  return (
    <>
      {contentEl &&
        createPortal(
          <div data-ps-ui className="ps-cpins">
            {pins.map((p) => (
              <div key={p.c.id} className="ps-cpin" style={{ left: p.x, top: p.y }}>
                <button
                  className="ps-cbubble"
                  data-resolved={p.c.resolved ? "true" : undefined}
                  data-comment-id={p.c.id}
                  title={`${p.c.author || "anonymous"}: ${p.c.body.slice(0, 80)}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenChange(openId === p.c.id ? null : p.c.id)
                  }}
                >
                  {initials(p.c.author || "?")}
                  {p.c.replies.length > 0 && <span className="ps-cbubble-n">{p.c.replies.length + 1}</span>}
                </button>
              </div>
            ))}
          </div>,
          contentEl
        )}
      {createPortal(
        <div className="ps-fixed-layer" data-ps-ui>
          {hover && <div className="ps-ctarget" style={hover} />}
          {open && openAt && (
            <Thread
              c={open.c}
              {...clampCard(openAt.left, openAt.top + 8)}
              author={author}
              where={where(open.c)}
              onClose={() => onOpenChange(null)}
              onResolve={() => update(open.c.id, { resolved: !open.c.resolved })}
              onDelete={() => {
                remove(open.c.id)
                onOpenChange(null)
              }}
              onReply={(body) => reply(open.c.id, body)}
              onAuthor={setAuthor}
            />
          )}
          {draft && (
            <Composer
              {...clampCard(draft.cx, draft.cy + 8)}
              author={author}
              onAuthor={setAuthor}
              anchor={<span className="ps-chip ps-chip-sm ps-mono truncate max-w-[260px]" data-ps-anchor>{where(draft)}</span>}
              onCancel={() => {
                setDraft(null)
                onPlaced()
              }}
              onPost={(body) => {
                add({ board: surface, ...(draft.item ? { item: draft.item } : {}), x: draft.x, y: draft.y, body, author })
                setDraft(null)
                onPlaced()
              }}
            />
          )}
        </div>,
        document.body
      )}
    </>
  )
}
