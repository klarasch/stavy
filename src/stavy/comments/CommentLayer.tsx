import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, ChevronUp } from "../icons"
import { targetElementOf, targetsById } from "../manifest"
import { docFracBox, elementAt, hostRect, hostRectOfFrac, onFrameChange, type HostRect } from "../frame"
import { describeElement, normText, type AnchorEl, type ElementAnchor } from "./anchor"
import { useComments, dimsEqual, placeOf, locateInDoc, initials, type Comment } from "./store"
import { Composer, Thread, clampCard } from "./Thread"

interface Placed {
  c: Comment
  left: number
  top: number
}

/** A short name for an element: its target id, else tag + words. */
export function elementName(el: Element): string {
  const t = targetElementOf(el)
  const tag = el.tagName.toLowerCase()
  const words = normText(el.textContent).slice(0, 24)
  if (t?.el === el) return `@${t.id}`
  return `<${tag}>${words ? ` “${words}${normText(el.textContent).length > 24 ? "…" : ""}”` : ""}`
}

/** Capture a comment anchor for an element in the frame document. */
export function anchorFor(el: Element): ElementAnchor {
  const doc = el.ownerDocument
  return describeElement(el as unknown as AnchorEl, {
    root: doc.body as unknown as AnchorEl,
    targetOf: (e) => targetElementOf(e as unknown as Element) as unknown as { id: string; el: AnchorEl } | null,
    targetsById: (id) => targetsById(doc, id) as unknown as AnchorEl[],
    boxOf: (e) => docFracBox(e as unknown as Element),
  })
}

/** The element and its ancestors up to (not including) the body: what "select parent" walks. */
function chainOf(el: Element): Element[] {
  const out: Element[] = []
  for (let cur: Element | null = el; cur && cur !== cur.ownerDocument.body && cur !== cur.ownerDocument.documentElement; cur = cur.parentElement) out.push(cur)
  return out.length ? out : [el]
}

/**
 * Comment pins over the player frame + the composer for placing new ones.
 *
 * Placing hit-tests like the inspector (the deepest element under the
 * pointer, outlined while hovering); the composer can widen the choice to a
 * parent. The anchor stores the nearest target id, the child path from it, a
 * text snippet and the element's box (anchor.ts), and is found again on every
 * load, however the state was reached. Everything is measured inside the
 * prototype's document and drawn in a fixed host layer.
 */
export function CommentLayer({
  iframe,
  doc,
  pageId,
  dims,
  placing,
  onPlaced,
  openId,
  onOpenChange,
}: {
  iframe: HTMLIFrameElement | null
  doc: Document | null
  pageId: string
  dims: Record<string, string>
  placing: boolean
  onPlaced: () => void
  openId: string | null
  onOpenChange: (id: string | null) => void
}) {
  const { comments, add, update, remove, reply, author, setAuthor } = useComments()
  const [placed, setPlaced] = useState<Placed[]>([])
  const [hover, setHover] = useState<{ rect: HostRect; name: string } | null>(null)
  const [draft, setDraft] = useState<{ chain: Element[]; depth: number; cx: number; cy: number } | null>(null)
  const dimsKey = JSON.stringify(dims)
  const mine = useMemo(
    () => comments.filter((c) => placeOf(c) === "page" && c.page === pageId && dimsEqual(c.dims, dims)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comments, pageId, dimsKey]
  )
  const root = doc?.body ?? null

  const measure = useCallback(() => {
    if (!root || !iframe || !doc || !root.isConnected) return setPlaced([])
    const out: Placed[] = []
    for (const c of mine) {
      const at = locateInDoc(c, doc, root)
      const r = "el" in at ? hostRect(at.el, iframe) : hostRectOfFrac(at.box, iframe)
      if (!r) continue
      out.push({ c, left: r.left + (r.width * (c.x ?? 0)) / 100, top: r.top + (r.height * (c.y ?? 0)) / 100 })
    }
    setPlaced(out)
  }, [iframe, doc, root, mine])

  useEffect(() => {
    measure()
    if (!iframe) return
    const timers = [200, 600, 1200, 2500].map((ms) => setTimeout(measure, ms))
    const ro = new ResizeObserver(measure)
    if (root) ro.observe(root)
    // A state that renders late (data, lazy panels) moves its content after load.
    let raf: number | null = null
    const mo = root
      ? new MutationObserver(() => {
          if (raf == null)
            raf = requestAnimationFrame(() => {
              raf = null
              measure()
            })
        })
      : null
    if (root) mo!.observe(root, { childList: true, subtree: true })
    const off = onFrameChange(iframe, measure)
    return () => {
      timers.forEach(clearTimeout)
      ro.disconnect()
      mo?.disconnect()
      if (raf != null) cancelAnimationFrame(raf)
      off()
    }
  }, [measure, root, iframe])

  useEffect(() => {
    if (!placing) setHover(null)
  }, [placing])

  const pick = (e: React.MouseEvent) => (iframe ? elementAt(iframe, e.clientX, e.clientY) : null)
  const onHover = (e: React.MouseEvent) => {
    const el = pick(e)
    if (!el || !iframe || el === root || el === doc?.documentElement) return setHover(null)
    setHover({ rect: hostRect(el, iframe), name: elementName(el) })
  }
  const place = (e: React.MouseEvent) => {
    const el = pick(e)
    if (!el || !root) return
    setDraft({ chain: chainOf(el), depth: 0, cx: e.clientX, cy: e.clientY })
    setHover(null)
    onOpenChange(null)
  }

  const chosen = draft ? draft.chain[draft.depth] : null
  const chosenRect = chosen && iframe ? hostRect(chosen, iframe) : null
  const post = (body: string) => {
    if (!draft || !chosen || !iframe) return
    const r = hostRect(chosen, iframe)
    const pct = (v: number, size: number) => Math.round((size ? (v / size) * 100 : 50) * 100) / 100
    const a = anchorFor(chosen)
    add({ page: pageId, dims, ...a, x: pct(draft.cx - r.left, r.width), y: pct(draft.cy - r.top, r.height), body, author })
    setDraft(null)
    onPlaced()
  }

  const open = placed.find((p) => p.c.id === openId) ?? null

  return (
    <>
      {placing && !draft && <div className="ps-shield" data-mode="comment" data-ps-ui onClick={place} onMouseMove={onHover} onMouseLeave={() => setHover(null)} />}
      {createPortal(
        <div className="ps-fixed-layer" data-ps-ui>
          {(hover || chosenRect) && (
            <div
              className="ps-ctarget"
              style={{ left: (chosenRect ?? hover!.rect).left, top: (chosenRect ?? hover!.rect).top, width: (chosenRect ?? hover!.rect).width, height: (chosenRect ?? hover!.rect).height }}
            >
              {!chosenRect && hover && <span className="ps-ctarget-tag ps-mono">{hover.name}</span>}
            </div>
          )}
          {placed.map((p) => (
            <button
              key={p.c.id}
              className="ps-cbubble absolute -translate-x-1/2 -translate-y-full"
              data-resolved={p.c.resolved ? "true" : undefined}
              data-comment-id={p.c.id}
              style={{ left: p.left, top: p.top }}
              title={`${p.c.author || "anonymous"}: ${p.c.body.slice(0, 80)}`}
              onClick={(e) => {
                e.stopPropagation()
                onOpenChange(openId === p.c.id ? null : p.c.id)
              }}
            >
              {initials(p.c.author || "?")}
              {p.c.replies.length > 0 && <span className="ps-cbubble-n">{p.c.replies.length + 1}</span>}
            </button>
          ))}

          {open && (
            <Thread
              c={open.c}
              {...clampCard(open.left, open.top + 8)}
              author={author}
              where={open.c.target ? `@${open.c.target}` : undefined}
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

          {draft && chosen && (
            <Composer
              {...clampCard(draft.cx, draft.cy + 8)}
              author={author}
              onAuthor={setAuthor}
              annotation={(() => {
                const t = targetElementOf(chosen)
                return t && t.el === chosen ? { pageId, target: t.id } : undefined
              })()}
              anchor={
                <>
                  <span className="ps-chip ps-chip-sm ps-mono truncate max-w-[200px]" data-ps-anchor title="What this comment is attached to">
                    {elementName(chosen)}
                  </span>
                  <button
                    type="button"
                    className="ps-btn h-6 px-1.5 text-[11px]"
                    title="Attach to the enclosing element"
                    disabled={draft.depth >= draft.chain.length - 1}
                    onClick={() => setDraft({ ...draft, depth: draft.depth + 1 })}
                  >
                    <ChevronUp className="size-3" /> Parent
                  </button>
                  <button
                    type="button"
                    className="ps-btn h-6 px-1.5 text-[11px]"
                    title="Back to the inner element"
                    disabled={draft.depth === 0}
                    onClick={() => setDraft({ ...draft, depth: draft.depth - 1 })}
                  >
                    <ChevronDown className="size-3" /> Child
                  </button>
                </>
              }
              onCancel={() => {
                setDraft(null)
                onPlaced()
              }}
              onPost={post}
            />
          )}
        </div>,
        document.body
      )}
    </>
  )
}
