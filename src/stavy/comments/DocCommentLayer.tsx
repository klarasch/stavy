import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MessageCirclePlus } from "../icons"
import { normText } from "./anchor"
import { useComments, initials, type Comment } from "./store"
import { Composer, Thread, clampCard } from "./Thread"

/* ------------------------------------------------------------------ */
/* Comments on a doc: a passage (selected text) or a block (clicked in  */
/* comment mode). Anchor: { doc, heading?, quote, block? }. The quote   */
/* is highlighted in the rendered Markdown, a marker sits in the        */
/* margin, and both open the thread.                                    */
/* ------------------------------------------------------------------ */

const QUOTE_MAX = 280
const MARK = "ps-chl"

/** Top-level block of the Markdown root that contains `node`. */
function blockOf(md: HTMLElement, node: Node | null): HTMLElement | null {
  let cur: Node | null = node
  while (cur && cur.parentNode !== md) cur = cur.parentNode
  return cur instanceof HTMLElement ? cur : null
}

/** Text of the last heading at or before `block`. */
function headingBefore(md: HTMLElement, block: Element | null): string | undefined {
  const kids = [...md.children]
  for (let i = block ? kids.indexOf(block) : -1; i >= 0; i--) if (/^H[1-6]$/.test(kids[i].tagName)) return normText(kids[i].textContent) || undefined
  return undefined
}

/** The text of `root` as one whitespace-collapsed string, each character mapped back to its text node. */
function textMap(root: HTMLElement) {
  const nodes: Array<{ node: Text; offset: number }> = []
  let s = ""
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest(".ps-md-embed, [data-ps-ui]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
  })
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const t = n.data
    for (let i = 0; i < t.length; i++) {
      const ws = /\s/.test(t[i])
      if (ws && (s === "" || s.endsWith(" "))) continue
      s += ws ? " " : t[i]
      nodes.push({ node: n, offset: i })
    }
  }
  return { s, nodes }
}

/** Wrap the first occurrence of `quote` (after the `heading`, when given) in marks; returns them. */
export function highlight(md: HTMLElement, quote: string, heading: string | undefined, attrs: Record<string, string>): HTMLElement[] {
  const q = normText(quote)
  if (!q) return []
  const { s, nodes } = textMap(md)
  let from = 0
  if (heading) {
    const h = [...md.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((x) => normText(x.textContent) === heading)
    if (h) {
      const hs = textMap(md)
      const first = hs.nodes.findIndex((p) => h.contains(p.node))
      if (first >= 0) from = first
    }
  }
  let at = s.indexOf(q, from)
  if (at < 0) at = s.indexOf(q)
  if (at < 0) return []
  // Group the matched characters by text node, then wrap each run.
  const runs: Array<{ node: Text; start: number; end: number }> = []
  for (let i = at; i < at + q.length; i++) {
    const p = nodes[i]
    const last = runs[runs.length - 1]
    if (last && last.node === p.node) last.end = p.offset + 1
    else runs.push({ node: p.node, start: p.offset, end: p.offset + 1 })
  }
  const marks: HTMLElement[] = []
  for (const r of runs) {
    let node = r.node
    if (r.start > 0) node = node.splitText(r.start)
    if (r.end - r.start < node.data.length) node.splitText(r.end - r.start)
    const m = md.ownerDocument.createElement("mark")
    m.className = MARK
    for (const [k, v] of Object.entries(attrs)) m.setAttribute(k, v)
    node.parentNode!.insertBefore(m, node)
    m.appendChild(node)
    marks.push(m)
  }
  return marks
}

function unhighlight(md: HTMLElement) {
  for (const m of [...md.querySelectorAll(`mark.${MARK}`)]) {
    const parent = m.parentNode!
    while (m.firstChild) parent.insertBefore(m.firstChild, m)
    parent.removeChild(m)
    parent.normalize()
  }
  for (const b of [...md.querySelectorAll(".ps-cblock")]) b.classList.remove("ps-cblock")
}

export function DocCommentLayer({
  docId,
  article,
  text,
  placing,
  onPlaced,
  openId,
  onOpenChange,
}: {
  docId: string
  /** The rendered doc page (contains the Markdown root) */
  article: HTMLElement | null
  /** The Markdown source: highlights are re-applied when it changes */
  text: string | null
  placing: boolean
  onPlaced: () => void
  openId: string | null
  onOpenChange: (id: string | null) => void
}) {
  const { comments, add, update, remove, reply, author, setAuthor } = useComments()
  const mine = useMemo(() => comments.filter((c) => c.doc === docId), [comments, docId])
  const [markers, setMarkers] = useState<Array<{ c: Comment; top: number }>>([])
  const [sel, setSel] = useState<{ quote: string; heading?: string; block?: number; left: number; top: number } | null>(null)
  const [draft, setDraft] = useState<{ quote: string; heading?: string; block?: number; left: number; top: number } | null>(null)
  const [, force] = useState(0)
  const md = () => article?.querySelector<HTMLElement>(".ps-md") ?? null

  /* ---- highlights + margin markers ---- */
  const apply = useCallback(() => {
    const root = md()
    if (!root || !article) return
    unhighlight(root)
    const aTop = article.getBoundingClientRect().top
    const out: Array<{ c: Comment; top: number }> = []
    for (const c of mine) {
      const marks = c.quote ? highlight(root, c.quote, c.heading, { "data-cid": c.id, ...(c.resolved ? { "data-resolved": "true" } : {}), ...(c.id === openId ? { "data-open": "true" } : {}) }) : []
      let anchorEl: Element | null = marks[0] ?? null
      if (!anchorEl && c.block != null) {
        anchorEl = root.children[c.block] ?? null
        anchorEl?.classList.add("ps-cblock")
      }
      out.push({ c, top: anchorEl ? anchorEl.getBoundingClientRect().top - aTop : 0 })
    }
    // Two comments on one line: stack their markers.
    out.sort((a, b) => a.top - b.top)
    for (let i = 1; i < out.length; i++) if (out[i].top < out[i - 1].top + 28) out[i].top = out[i - 1].top + 28
    setMarkers(out)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article, mine, openId])

  useLayoutEffect(() => {
    apply()
  }, [apply, text])
  // The Markdown view rewrites its HTML on its own schedule (embeds, live reload): re-apply after it.
  useEffect(() => {
    const root = md()
    if (!root || !article) return
    const mo = new MutationObserver((list) => {
      // New blocks (not our own marks) mean the HTML was rewritten.
      if (list.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n as Element).tagName !== "MARK"))) apply()
    })
    mo.observe(root, { childList: true })
    const ro = new ResizeObserver(() => apply())
    ro.observe(article)
    return () => {
      mo.disconnect()
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article, apply, text])

  /* ---- opening from a link or the panel: scroll it into view ---- */
  const scrolled = useRef<string | null>(null)
  useEffect(() => {
    if (!openId || scrolled.current === openId || !article) return
    const el = article.querySelector(`mark[data-cid="${CSS.escape(openId)}"]`) ?? article.querySelector(`[data-comment-id="${CSS.escape(openId)}"]`)
    if (!el) return
    scrolled.current = openId
    el.scrollIntoView({ block: "center" })
    force((n) => n + 1)
  }, [openId, article, markers])

  /* ---- clicks: a highlight opens its thread; in comment mode a block is picked ---- */
  useEffect(() => {
    if (!article) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element
      if (t.closest("[data-ps-ui]")) return
      const mark = t.closest<HTMLElement>(`mark.${MARK}`)
      if (mark && !placing) {
        e.preventDefault()
        onOpenChange(mark.dataset.cid ?? null)
        return
      }
      if (!placing) return
      const root = md()
      const block = root && blockOf(root, t)
      if (!root || !block) return
      e.preventDefault()
      e.stopPropagation()
      const quote = normText(block.textContent).slice(0, 80)
      setDraft({ quote, heading: /^H[1-6]$/.test(block.tagName) ? normText(block.textContent) : headingBefore(root, block), block: [...root.children].indexOf(block), left: e.clientX, top: e.clientY })
      onOpenChange(null)
    }
    article.addEventListener("click", onClick, true)
    return () => article.removeEventListener("click", onClick, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article, placing, onOpenChange])

  /* ---- selecting text offers "Comment" ---- */
  useEffect(() => {
    if (!article) return
    const onUp = () =>
      setTimeout(() => {
        const s = article.ownerDocument.getSelection()
        const root = md()
        if (!s || s.isCollapsed || !root || !s.rangeCount || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) return setSel(null)
        const quote = normText(s.toString()).slice(0, QUOTE_MAX)
        if (!quote) return setSel(null)
        const r = s.getRangeAt(0).getBoundingClientRect()
        const block = blockOf(root, s.getRangeAt(0).startContainer)
        setSel({ quote, heading: headingBefore(root, block), block: block ? [...root.children].indexOf(block) : undefined, left: r.right, top: r.top })
      }, 0)
    article.addEventListener("mouseup", onUp)
    article.addEventListener("keyup", onUp)
    return () => {
      article.removeEventListener("mouseup", onUp)
      article.removeEventListener("keyup", onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article])
  useEffect(() => {
    const clear = () => setSel(null)
    article?.parentElement?.addEventListener("scroll", clear, { passive: true })
    return () => article?.parentElement?.removeEventListener("scroll", clear)
  }, [article])

  const open = markers.find((m) => m.c.id === openId) ?? null
  // Measured after commit: the open thread sits by its margin marker, which is
  // drawn in this same render — reading it during render would find nothing the
  // first time and leave the thread closed until something else re-rendered.
  const [openRect, setOpenRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    const el = open && article ? article.querySelector(`[data-comment-id="${CSS.escape(open.c.id)}"]`) : null
    const r = el?.getBoundingClientRect() ?? null
    setOpenRect((prev) => (prev && r && prev.left === r.left && prev.bottom === r.bottom ? prev : r))
  })

  return (
    <>
      {article &&
        createPortal(
          <div data-ps-ui className="ps-cmargin-col">
            {markers.map((m) => (
              <button
                key={m.c.id}
                className="ps-cbubble ps-cmargin"
                style={{ top: m.top }}
                data-comment-id={m.c.id}
                data-resolved={m.c.resolved ? "true" : undefined}
                title={`${m.c.author || "anonymous"}: ${m.c.body.slice(0, 80)}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenChange(openId === m.c.id ? null : m.c.id)
                }}
              >
                {initials(m.c.author || "?")}
                {m.c.replies.length > 0 && <span className="ps-cbubble-n">{m.c.replies.length + 1}</span>}
              </button>
            ))}
          </div>,
          article
        )}
      {createPortal(
        <div className="ps-fixed-layer" data-ps-ui>
          {sel && !draft && (
            <button
              type="button"
              className="ps-btn ps-btn-primary ps-cadd h-7 px-2 text-[12px]"
              style={{ left: Math.min(sel.left + 6, window.innerWidth - 110), top: Math.max(8, sel.top - 34), pointerEvents: "auto" }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDraft(sel)
                setSel(null)
                onOpenChange(null)
              }}
            >
              <MessageCirclePlus className="size-3.5" /> Comment
            </button>
          )}
          {open && openRect && (
            <Thread
              c={open.c}
              {...clampCard(openRect.left - 330, openRect.bottom + 6)}
              author={author}
              where={open.c.heading ? `› ${open.c.heading}` : undefined}
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
              {...clampCard(draft.left, draft.top + 16)}
              author={author}
              onAuthor={setAuthor}
              anchor={
                <span className="ps-cquote text-[11.5px] line-clamp-2" style={{ color: "var(--ps-muted)" }} data-ps-anchor>
                  “{draft.quote}”
                </span>
              }
              onCancel={() => {
                setDraft(null)
                onPlaced()
              }}
              onPost={(body) => {
                add({ doc: docId, quote: draft.quote, ...(draft.heading ? { heading: draft.heading } : {}), ...(draft.block != null && draft.block >= 0 ? { block: draft.block } : {}), body, author })
                setDraft(null)
                article?.ownerDocument.getSelection()?.removeAllRanges()
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
