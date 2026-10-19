import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { manifest, getPage, valueLabel, dimensionLabel, pageUrl, canvasUrl, findTarget, contentUrl } from "../manifest"
import { useContentRev, useDev, writeContent } from "../dev"

/* ------------------------------------------------------------------ */
/* Comments: conversation about a prototype — separate from annotations  */
/* (authored documentation in the manifest). With the dev endpoint they   */
/* live in stavy-content/comments.json (a file the team and agents can    */
/* read, commit and review); without it they stay in the browser and are  */
/* shared as a link payload or Markdown (Slack-friendly).                 */
/* ------------------------------------------------------------------ */

export interface CommentReply {
  id: string
  author: string
  body: string
  createdAt: number
}

export interface Comment {
  id: string
  page: string
  dims: Record<string, string>
  /** Semantic target the comment is anchored to (preferred: survives redesigns) */
  target?: string
  /** nth-child path from the anchor (target or page root) down to the exact element clicked */
  path?: number[]
  /** position in % of the resolved anchor element */
  x: number
  y: number
  body: string
  author: string
  createdAt: number
  resolved: boolean
  replies: CommentReply[]
}

interface CommentsState {
  comments: Comment[]
  open: number
  author: string
  setAuthor: (a: string) => void
  add: (c: Omit<Comment, "id" | "createdAt" | "resolved" | "replies">) => Comment
  update: (id: string, patch: Partial<Comment>) => void
  remove: (id: string) => void
  reply: (id: string, body: string) => void
  importMany: (list: Comment[]) => number
  clearAll: () => void
  countFor: (page: string, dims: Record<string, string>) => number
  forInstance: (page: string, dims: Record<string, string>) => Comment[]
}

const Ctx = createContext<CommentsState | null>(null)
const storageKey = () => `ps-comments:${manifest.product.name}`
const AUTHOR_KEY = "ps-author"
/** Where the comments live when the viewer can write (relative to stavy-content/). */
export const COMMENTS_FILE = "comments.json"

export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)

export function dimsEqual(a: Record<string, string>, b: Record<string, string>) {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

function load(): Comment[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey()) ?? "[]")
  } catch {
    return []
  }
}

/* ---- the file: ISO timestamps so it reads (and diffs) like text ---- */
const iso = (t: number) => new Date(t).toISOString()
const ms = (t: unknown) => (typeof t === "number" ? t : Date.parse(String(t)) || Date.now())

function toFile(list: Comment[]): string {
  return JSON.stringify(
    {
      version: 1,
      comments: list.map((c) => ({ ...c, createdAt: iso(c.createdAt), replies: c.replies.map((r) => ({ ...r, createdAt: iso(r.createdAt) })) })),
    },
    null,
    2
  )
}

function fromFile(text: string): Comment[] {
  const raw = JSON.parse(text)
  const list: any[] = Array.isArray(raw) ? raw : (raw.comments ?? [])
  return list.map((c) => ({
    ...c,
    dims: c.dims ?? {},
    createdAt: ms(c.createdAt),
    resolved: !!c.resolved,
    replies: (c.replies ?? []).map((r: any) => ({ ...r, createdAt: ms(r.createdAt) })),
  }))
}

export function CommentsProvider({ children }: { children: ReactNode }) {
  const [comments, setCommentsRaw] = useState<Comment[]>(load)
  const [author, setAuthorState] = useState(() => localStorage.getItem(AUTHOR_KEY) ?? "")
  const dev = useDev()
  const rev = useContentRev()
  const writable = !!dev?.writable

  // File mode (the dev endpoint is there): comments.json is the source of
  // truth. `dirty` marks a local edit not yet written; a reload from the file
  // never overwrites one, and our own write is recognised and skipped.
  const dirty = useRef(false)
  const loaded = useRef(false)
  const lastFile = useRef<string | null>(null)
  const [saveTick, setSaveTick] = useState(0)
  const setComments = useCallback((fn: (prev: Comment[]) => Comment[]) => {
    dirty.current = true
    setCommentsRaw(fn)
  }, [])

  // Browser mode: localStorage, in sync across tabs.
  useEffect(() => {
    if (writable) return
    localStorage.setItem(storageKey(), JSON.stringify(comments))
  }, [comments, writable])
  useEffect(() => {
    if (writable) return
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey()) setCommentsRaw(load())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [writable])

  // File mode: load on start and whenever the content changes underneath us.
  useEffect(() => {
    if (!writable) {
      loaded.current = false
      return
    }
    let cancelled = false
    ;(async () => {
      let text: string | null = null
      try {
        const r = await fetch(contentUrl(COMMENTS_FILE), { cache: "no-store" })
        if (r.ok) {
          const t = await r.text()
          // A dev server answers a missing file with index.html: only JSON counts.
          if (/^\s*[{[]/.test(t)) text = t
        }
      } catch {
        /* treated as no file */
      }
      if (cancelled) return
      if (text === null) {
        // No file yet: anything collected in the browser so far moves into it.
        const first = !loaded.current
        loaded.current = true
        if (first && comments.length > 0) dirty.current = true
        setSaveTick((t) => t + 1)
        return
      }
      loaded.current = true
      setSaveTick((t) => t + 1)
      if (text === lastFile.current || dirty.current) return
      try {
        setCommentsRaw(fromFile(text))
        lastFile.current = text
      } catch (e) {
        console.warn("stavy: comments.json is not valid, keeping what is on screen", e)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writable, rev])

  // File mode: save shortly after a local edit.
  useEffect(() => {
    if (!writable || !loaded.current || !dirty.current) return
    const t = setTimeout(async () => {
      const text = toFile(comments)
      try {
        dirty.current = false
        lastFile.current = text
        await writeContent(COMMENTS_FILE, text)
      } catch (e) {
        dirty.current = true
        console.warn("stavy: could not save comments", e)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [comments, writable, saveTick])

  const importMany = useCallback((list: Comment[]) => {
    let added = 0
    setComments((prev) => {
      const byId = new Map(prev.map((c) => [c.id, c]))
      for (const c of list) {
        const existing = byId.get(c.id)
        if (!existing) added++
        // newest wins per comment; merge replies by id
        const replies = [...(existing?.replies ?? [])]
        for (const r of c.replies ?? []) if (!replies.some((x) => x.id === r.id)) replies.push(r)
        byId.set(c.id, { ...(existing ?? c), ...c, replies: replies.sort((a, b) => a.createdAt - b.createdAt) })
      }
      return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt)
    })
    return added
  }, [setComments])

  // Unpack a shared payload from the URL hash (#c=…), then drop the hash.
  useEffect(() => {
    const m = window.location.hash.match(/[#&]c=([^&]+)/)
    if (!m) return
    decodePayload(m[1])
      .then((list) => {
        const n = importMany(list)
        history.replaceState(null, "", window.location.pathname + window.location.search)
        if (n > 0) console.info(`stavy: imported ${n} comment(s) from link`)
      })
      .catch((e) => console.warn("stavy: could not unpack comments", e))
  }, [importMany])

  const value = useMemo<CommentsState>(
    () => ({
      comments,
      open: comments.filter((c) => !c.resolved).length,
      author,
      setAuthor: (a) => {
        setAuthorState(a)
        localStorage.setItem(AUTHOR_KEY, a)
      },
      add: (c) => {
        const full: Comment = { ...c, id: uid(), createdAt: Date.now(), resolved: false, replies: [] }
        setComments((p) => [...p, full])
        return full
      },
      update: (id, patch) => setComments((p) => p.map((c) => (c.id === id ? { ...c, ...patch } : c))),
      remove: (id) => setComments((p) => p.filter((c) => c.id !== id)),
      reply: (id, body) =>
        setComments((p) =>
          p.map((c) => (c.id === id ? { ...c, replies: [...c.replies, { id: uid(), author, body, createdAt: Date.now() }] } : c))
        ),
      importMany,
      clearAll: () => setComments(() => []),
      countFor: (page, dims) => comments.filter((c) => !c.resolved && c.page === page && dimsEqual(c.dims, dims)).length,
      forInstance: (page, dims) => comments.filter((c) => c.page === page && dimsEqual(c.dims, dims)),
    }),
    [comments, author, importMany, setComments]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useComments() {
  const c = useContext(Ctx)
  if (!c) throw new Error("useComments must be used inside <CommentsProvider>")
  return c
}

/* ---------------- payload: gzip + base64url in the URL hash ---------------- */

const b64u = {
  enc: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
}

async function gzip(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Response(stream).text()
}

export async function encodePayload(list: Comment[]): Promise<string> {
  const json = JSON.stringify(list)
  const z = await gzip(json)
  return z ? "c1." + b64u.enc(z) : "c0." + b64u.enc(new TextEncoder().encode(json))
}

/** Accepts a raw payload, a `#c=…` fragment, a full share URL, or plain JSON. */
export async function decodePayload(input: string): Promise<Comment[]> {
  let s = input.trim()
  const m = s.match(/[#&]c=([^&\s]+)/)
  if (m) s = m[1]
  if (s.startsWith("[")) return JSON.parse(s)
  if (s.startsWith("c1.")) return JSON.parse(await gunzip(b64u.dec(s.slice(3))))
  if (s.startsWith("c0.")) return JSON.parse(new TextDecoder().decode(b64u.dec(s.slice(3))))
  throw new Error("Not a Stavy comments payload")
}

export async function shareUrl(list: Comment[]): Promise<string> {
  return `${window.location.origin}${canvasUrl({ comments: "1" })}#c=${await encodePayload(list)}`
}

/* ---------------- Markdown (Slack-friendly) ---------------- */

export function describeAnchor(c: Comment): string {
  const page = getPage(c.page)
  const dims = Object.entries(c.dims)
    .map(([d, v]) => `${dimensionLabel(d)} ${valueLabel(d, v)}`)
    .join(", ")
  return `${page?.label ?? c.page}${dims ? ` (${dims})` : ""}${c.target ? ` @${c.target}` : ""}`
}

export function commentUrl(c: Comment): string {
  return window.location.origin + pageUrl(c.page, c.dims, { c: c.id })
}

export async function toMarkdown(list: Comment[]): Promise<string> {
  const open = list.filter((c) => !c.resolved)
  const resolved = list.filter((c) => c.resolved)
  const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const lines: string[] = [`*Stavy comments — ${manifest.product.name}* (${open.length} open, ${resolved.length} resolved)`, ""]
  const block = (c: Comment) => {
    lines.push(`• ${c.resolved ? "✅ " : ""}*${describeAnchor(c)}* — ${c.author || "anonymous"}, ${fmtDate(c.createdAt)}`)
    lines.push(`  ${c.body.replace(/\n/g, "\n  ")}`)
    for (const r of c.replies) lines.push(`  ↳ ${r.author || "anonymous"}: ${r.body}`)
    lines.push(`  ${commentUrl(c)}`)
  }
  open.forEach(block)
  if (resolved.length) {
    lines.push("", "_Resolved_")
    resolved.forEach(block)
  }
  lines.push("", `Open all in the viewer: ${await shareUrl(list)}`)
  return lines.join("\n")
}

export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/* ---------------- anchoring helpers ---------------- */

/** nth-child path from `from` down to `el` (empty when el === from). */
export function pathBetween(from: Element, el: Element): number[] {
  const path: number[] = []
  let cur: Element | null = el
  while (cur && cur !== from) {
    const parent: Element | null = cur.parentElement
    if (!parent) return []
    path.unshift(Array.prototype.indexOf.call(parent.children, cur))
    cur = parent
  }
  return cur === from ? path : []
}

/** Follow an nth-child path; null if the DOM changed underneath it. */
export function followPath(from: Element, path: number[] | undefined): Element | null {
  let cur: Element | null = from
  for (const i of path ?? []) {
    cur = cur?.children[i] ?? null
    if (!cur) return null
  }
  return cur
}

/** Resolve a comment's anchor inside the prototype document: exact element via path → target → page root. */
export function resolveAnchor(c: Comment, doc: ParentNode, root: Element): Element {
  const target = c.target ? findTarget(doc, c.target) : null
  const base = target ?? root
  return followPath(base, c.path) ?? base
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
