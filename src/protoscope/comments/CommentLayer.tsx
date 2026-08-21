import { useCallback, useEffect, useRef, useState } from "react"
import { Check, RotateCcw, Trash2, X, CornerDownRight } from "lucide-react"
import { findProtoTarget } from "../proto"
import { PsButton } from "../chrome"
import { useComments, dimsEqual, timeAgo, type Comment } from "./store"

interface Placed {
  c: Comment
  left: number
  top: number
}

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean)
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : (p[0] ?? "?").slice(0, 2)).toUpperCase()
}

/**
 * Comment bubbles on a page + the composer for placing new ones.
 * Anchors: a data-proto target when the click lands inside one (robust to
 * redesigns), otherwise the page root; position is stored in % of the anchor.
 */
export function CommentLayer({
  wrapper,
  pageId,
  dims,
  placing,
  onPlaced,
  openId,
  onOpenChange,
}: {
  wrapper: HTMLElement
  pageId: string
  dims: Record<string, string>
  placing: boolean
  onPlaced: () => void
  openId: string | null
  onOpenChange: (id: string | null) => void
}) {
  const { comments, add, update, remove, reply, author, setAuthor } = useComments()
  const [placed, setPlaced] = useState<Placed[]>([])
  const [draft, setDraft] = useState<{ target?: string; x: number; y: number; left: number; top: number } | null>(null)
  const mine = comments.filter((c) => c.page === pageId && dimsEqual(c.dims, dims))
  const root = wrapper.firstElementChild as HTMLElement | null

  const measure = useCallback(() => {
    if (!root) return
    const w = wrapper.getBoundingClientRect()
    const out: Placed[] = []
    for (const c of mine) {
      const anchor = (c.target && findProtoTarget(wrapper, c.target)) || root
      const r = anchor.getBoundingClientRect()
      out.push({
        c,
        left: r.left - w.left + wrapper.scrollLeft + (r.width * c.x) / 100,
        top: r.top - w.top + wrapper.scrollTop + (r.height * c.y) / 100,
      })
    }
    setPlaced(out)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapper, root, comments, pageId, JSON.stringify(dims)])

  useEffect(() => {
    measure()
    const timers = [200, 600, 1200].map((ms) => setTimeout(measure, ms))
    const ro = new ResizeObserver(measure)
    if (root) ro.observe(root)
    window.addEventListener("resize", measure)
    return () => {
      timers.forEach(clearTimeout)
      ro.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [measure, root])

  // Placement: capture the next click on the prototype.
  useEffect(() => {
    if (!placing || !root) return
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || (e.target as Element).closest(".ps-cthread, .ps-ccomposer")) return
      e.preventDefault()
      e.stopPropagation()
      const targetEl = e.target.closest<HTMLElement>("[data-proto]")
      const anchor = targetEl ?? root
      const r = anchor.getBoundingClientRect()
      const w = wrapper.getBoundingClientRect()
      setDraft({
        target: targetEl?.getAttribute("data-proto") ?? undefined,
        x: ((e.clientX - r.left) / r.width) * 100,
        y: ((e.clientY - r.top) / r.height) * 100,
        left: e.clientX - w.left + wrapper.scrollLeft,
        top: e.clientY - w.top + wrapper.scrollTop,
      })
      onOpenChange(null)
    }
    wrapper.addEventListener("click", onClick, { capture: true })
    return () => wrapper.removeEventListener("click", onClick, { capture: true })
  }, [placing, wrapper, root, onOpenChange])

  const open = placed.find((p) => p.c.id === openId) ?? null

  return (
    <div className="absolute inset-0 pointer-events-none z-[35]" data-ps-ui>
      {placing && <div className="absolute inset-0" style={{ cursor: "crosshair", pointerEvents: "none" }} />}
      {placed.map((p) => (
        <button
          key={p.c.id}
          className="ps-cbubble pointer-events-auto absolute -translate-x-1/2 -translate-y-full"
          data-resolved={p.c.resolved ? "true" : undefined}
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
          left={Math.min(open.left, wrapper.clientWidth - 330)}
          top={open.top + 8}
          author={author}
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
          left={Math.min(draft.left, wrapper.clientWidth - 330)}
          top={draft.top + 8}
          author={author}
          target={draft.target}
          onAuthor={setAuthor}
          onCancel={() => {
            setDraft(null)
            onPlaced()
          }}
          onPost={(body) => {
            add({ page: pageId, dims, target: draft.target, x: draft.x, y: draft.y, body, author })
            setDraft(null)
            onPlaced()
          }}
        />
      )}
    </div>
  )
}

function AuthorField({ author, onAuthor }: { author: string; onAuthor: (a: string) => void }) {
  if (author) return null
  return (
    <input
      className="ps-cinput mb-1.5"
      placeholder="Your name"
      autoFocus
      onBlur={(e) => e.target.value.trim() && onAuthor(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

function Composer({
  left, top, author, target, onAuthor, onCancel, onPost,
}: {
  left: number
  top: number
  author: string
  target?: string
  onAuthor: (a: string) => void
  onCancel: () => void
  onPost: (body: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (author) ref.current?.focus()
  }, [author])
  return (
    <div className="ps ps-glass-strong ps-ccomposer pointer-events-auto absolute w-80 rounded-2xl p-3" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-2">
        <span className="ps-cbubble" style={{ position: "static", transform: "none" }}>{initials(author || "?")}</span>
        <span className="text-[12px] font-semibold">New comment</span>
        {target && <span className="ps-chip ps-chip-sm ps-mono">@{target}</span>}
        <button className="ml-auto" style={{ color: "var(--ps-faint)" }} onClick={onCancel} title="Cancel (Esc)">
          <X className="size-4" />
        </button>
      </div>
      <AuthorField author={author} onAuthor={onAuthor} />
      <textarea
        ref={ref}
        className="ps-cinput"
        rows={3}
        placeholder="What should change, and why?"
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel()
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            const v = (e.target as HTMLTextAreaElement).value.trim()
            if (v) onPost(v)
          }
        }}
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10.5px]" style={{ color: "var(--ps-faint)" }}>⌘↩ to post</span>
        <div className="flex gap-1">
          <PsButton onClick={onCancel}>Cancel</PsButton>
          <PsButton
            primary
            onClick={() => {
              const v = ref.current?.value.trim()
              if (v) onPost(v)
            }}
          >
            Post
          </PsButton>
        </div>
      </div>
    </div>
  )
}

function Thread({
  c, left, top, author, onClose, onResolve, onDelete, onReply, onAuthor,
}: {
  c: Comment
  left: number
  top: number
  author: string
  onClose: () => void
  onResolve: () => void
  onDelete: () => void
  onReply: (body: string) => void
  onAuthor: (a: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  return (
    <div className="ps ps-glass-strong ps-cthread pointer-events-auto absolute w-80 rounded-2xl p-3" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 mb-2">
        <span className="ps-cbubble" style={{ position: "static", transform: "none" }} data-resolved={c.resolved ? "true" : undefined}>
          {initials(c.author || "?")}
        </span>
        <div className="leading-tight">
          <div className="text-[12px] font-semibold">{c.author || "anonymous"}</div>
          <div className="text-[10.5px]" style={{ color: "var(--ps-faint)" }}>
            {timeAgo(c.createdAt)}
            {c.target && <span className="ps-mono"> · @{c.target}</span>}
          </div>
        </div>
        <button className="ml-auto" style={{ color: "var(--ps-faint)" }} onClick={onClose} title="Close">
          <X className="size-4" />
        </button>
      </div>
      <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{c.body}</p>
      {c.replies.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5" style={{ borderLeft: "2px solid var(--ps-border)", paddingLeft: 10 }}>
          {c.replies.map((r) => (
            <div key={r.id} className="text-[12px]">
              <span className="font-semibold">{r.author || "anonymous"}</span>{" "}
              <span style={{ color: "var(--ps-faint)" }}>{timeAgo(r.createdAt)}</span>
              <div className="whitespace-pre-wrap">{r.body}</div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2.5">
        <AuthorField author={author} onAuthor={onAuthor} />
        <div className="flex items-start gap-1.5">
          <CornerDownRight className="size-3.5 mt-2 shrink-0" style={{ color: "var(--ps-faint)" }} />
          <textarea
            ref={ref}
            className="ps-cinput"
            rows={1}
            placeholder="Reply…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                const v = (e.target as HTMLTextAreaElement).value.trim()
                if (v) {
                  onReply(v)
                  ;(e.target as HTMLTextAreaElement).value = ""
                }
              }
            }}
          />
        </div>
      </div>
      <div className="flex items-center gap-1 mt-2.5">
        <PsButton onClick={onResolve}>{c.resolved ? <><RotateCcw /> Reopen</> : <><Check /> Resolve</>}</PsButton>
        <PsButton className="ml-auto" onClick={onDelete} title="Delete">
          <Trash2 />
        </PsButton>
      </div>
    </div>
  )
}
