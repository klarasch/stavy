import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, RotateCcw, Trash2, X, CornerDownRight } from "../icons"
import { PsButton } from "../chrome"
import { initials, timeAgo, type Comment } from "./store"

/* The composer and the thread card, shared by every comment layer (player, boards, map, docs). */

export function AuthorField({ author, onAuthor }: { author: string; onAuthor: (a: string) => void }) {
  // Asked once, remembered in the browser. The name counts as soon as it is
  // typed (so ⌘↩ straight after it works), the field goes away on blur.
  const [typing, setTyping] = useState(false)
  if (author && !typing) return null
  return (
    <input
      className="ps-cinput mb-1.5"
      placeholder="Your name"
      autoFocus
      defaultValue={author}
      data-ps-author
      onChange={(e) => {
        setTyping(true)
        onAuthor(e.target.value.trim())
      }}
      onBlur={() => setTyping(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

const canWriteAnnotations = import.meta.env.DEV

async function saveAnnotation(pageId: string, target: string, title: string, note: string) {
  const res = await fetch("/__stavy/annotation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ page: pageId, target, title, note }),
  })
  if (!res.ok) throw new Error(await res.text())
}

export function Composer({
  left,
  top,
  author,
  onAuthor,
  onCancel,
  onPost,
  anchor,
  annotation,
}: {
  left: number
  top: number
  author: string
  onAuthor: (a: string) => void
  onCancel: () => void
  onPost: (body: string) => void
  /** What the comment is attached to (chips, the parent/child picker) */
  anchor?: ReactNode
  /** Offer "save as a design annotation" (player, on a target, dev only) */
  annotation?: { pageId: string; target: string }
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [asAnnotation, setAsAnnotation] = useState(false)
  const [title, setTitle] = useState("")
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (author) ref.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const annotate = canWriteAnnotations && !!annotation
  const post = async () => {
    const v = ref.current?.value.trim()
    if (!v) return
    if (asAnnotation && annotation) {
      try {
        await saveAnnotation(annotation.pageId, annotation.target, title.trim() || v.split(/[.!?\n]/)[0].slice(0, 60), v)
        onCancel()
      } catch (e) {
        setErr(String(e))
      }
      return
    }
    onPost(v)
  }
  return (
    <div
      className="ps ps-glass-strong ps-ccomposer absolute w-80 rounded-2xl p-3"
      style={{ left, top }}
      data-ps-ui
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="ps-cbubble" style={{ position: "static", transform: "none", ...(asAnnotation ? { background: "var(--ps-pin)", color: "var(--ps-pin-fg)" } : {}) }}>
          {asAnnotation ? "!" : initials(author || "?")}
        </span>
        <span className="text-[12px] font-semibold">{asAnnotation ? "New design annotation" : "New comment"}</span>
        <button className="ml-auto" style={{ color: "var(--ps-faint)" }} onClick={onCancel} title="Cancel (Esc)">
          <X className="size-4" />
        </button>
      </div>
      {anchor && <div className="flex items-center gap-1 mb-2 flex-wrap">{anchor}</div>}
      {annotate && (
        <label className="flex items-center gap-2 mb-2 text-[11.5px] cursor-pointer select-none" style={{ color: "var(--ps-muted)" }}>
          <input type="checkbox" checked={asAnnotation} onChange={(e) => setAsAnnotation(e.target.checked)} />
          Save as a design annotation (writes to stavy.json)
        </label>
      )}
      {asAnnotation ? (
        <input className="ps-cinput mb-1.5" placeholder="Title (e.g. Primary CTA)" value={title} onChange={(e) => setTitle(e.target.value)} />
      ) : (
        <AuthorField author={author} onAuthor={onAuthor} />
      )}
      <textarea
        ref={ref}
        className="ps-cinput"
        rows={3}
        placeholder={asAnnotation ? "What this part is and what it does" : "What should change, and why?"}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Escape") onCancel()
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void post()
        }}
      />
      {err && (
        <div className="text-[11px] mt-1" style={{ color: "var(--ps-pin)" }}>
          {err}
        </div>
      )}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10.5px]" style={{ color: "var(--ps-faint)" }}>
          ⌘↩ to {asAnnotation ? "save" : "post"}
        </span>
        <div className="flex gap-1">
          <PsButton onClick={onCancel}>Cancel</PsButton>
          <PsButton primary onClick={() => void post()}>
            {asAnnotation ? "Save annotation" : "Post"}
          </PsButton>
        </div>
      </div>
    </div>
  )
}

export function Thread({
  c,
  left,
  top,
  author,
  where,
  onClose,
  onResolve,
  onDelete,
  onReply,
  onAuthor,
}: {
  c: Comment
  left: number
  top: number
  author: string
  /** Short description of the anchor, shown under the author */
  where?: string
  onClose: () => void
  onResolve: () => void
  onDelete: () => void
  onReply: (body: string) => void
  onAuthor: (a: string) => void
}) {
  return (
    <div
      className="ps ps-glass-strong ps-cthread absolute w-80 rounded-2xl p-3"
      style={{ left, top }}
      data-ps-ui
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="ps-cbubble" style={{ position: "static", transform: "none" }} data-resolved={c.resolved ? "true" : undefined}>
          {initials(c.author || "?")}
        </span>
        <div className="leading-tight min-w-0">
          <div className="text-[12px] font-semibold">{c.author || "anonymous"}</div>
          <div className="text-[10.5px] truncate" style={{ color: "var(--ps-faint)" }}>
            {timeAgo(c.createdAt)}
            {where && <span className="ps-mono"> · {where}</span>}
          </div>
        </div>
        <button className="ml-auto" style={{ color: "var(--ps-faint)" }} onClick={onClose} title="Close">
          <X className="size-4" />
        </button>
      </div>
      {c.quote && (
        <blockquote className="ps-cquote text-[11.5px] mb-1.5" style={{ color: "var(--ps-muted)" }}>
          “{c.quote}”
        </blockquote>
      )}
      <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap">{c.body}</p>
      {c.replies.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5" style={{ borderLeft: "2px solid var(--ps-border)", paddingLeft: 10 }}>
          {c.replies.map((r) => (
            <div key={r.id} className="text-[12px]">
              <span className="font-semibold">{r.author || "anonymous"}</span> <span style={{ color: "var(--ps-faint)" }}>{timeAgo(r.createdAt)}</span>
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
            className="ps-cinput"
            rows={1}
            placeholder="Reply…"
            onKeyDown={(e) => {
              e.stopPropagation()
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
        <PsButton onClick={onResolve}>
          {c.resolved ? (
            <>
              <RotateCcw /> Reopen
            </>
          ) : (
            <>
              <Check /> Resolve
            </>
          )}
        </PsButton>
        <PsButton className="ml-auto" onClick={onDelete} title="Delete">
          <Trash2 />
        </PsButton>
      </div>
    </div>
  )
}

/** Keep a fixed card (composer, thread) inside the window. */
export function clampCard(left: number, top: number, w = 330, h = 280) {
  return { left: Math.max(8, Math.min(left, window.innerWidth - w)), top: Math.max(8, Math.min(top, window.innerHeight - h)) }
}
