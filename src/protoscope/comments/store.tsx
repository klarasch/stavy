import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { manifest, getPage, valueLabel, dimensionLabel, pageUrl } from "../manifest"

/* ------------------------------------------------------------------ */
/* Comments: conversation about a prototype — separate from annotations  */
/* (authored documentation in the manifest). Local-first: stored in the   */
/* browser, shared as a link payload or Markdown (Slack-friendly).       */
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
  /** data-proto target the comment is anchored to (preferred: survives redesigns) */
  target?: string
  /** position in % of the anchor (target element, or the page root) */
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
const KEY = `ps-comments:${manifest.product.name}`
const AUTHOR_KEY = "ps-author"

export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)

export function dimsEqual(a: Record<string, string>, b: Record<string, string>) {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

function load(): Comment[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]")
  } catch {
    return []
  }
}

export function CommentsProvider({ children }: { children: ReactNode }) {
  const [comments, setComments] = useState<Comment[]>(load)
  const [author, setAuthorState] = useState(() => localStorage.getItem(AUTHOR_KEY) ?? "")

  useEffect(() => localStorage.setItem(KEY, JSON.stringify(comments)), [comments])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setComments(load())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

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
  }, [])

  // Unpack a shared payload from the URL hash (#c=…), then drop the hash.
  useEffect(() => {
    const m = window.location.hash.match(/[#&]c=([^&]+)/)
    if (!m) return
    decodePayload(m[1])
      .then((list) => {
        const n = importMany(list)
        history.replaceState(null, "", window.location.pathname + window.location.search)
        if (n > 0) console.info(`protoscope: imported ${n} comment(s) from link`)
      })
      .catch((e) => console.warn("protoscope: could not unpack comments", e))
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
      clearAll: () => setComments([]),
      countFor: (page, dims) => comments.filter((c) => !c.resolved && c.page === page && dimsEqual(c.dims, dims)).length,
      forInstance: (page, dims) => comments.filter((c) => c.page === page && dimsEqual(c.dims, dims)),
    }),
    [comments, author, importMany]
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
  throw new Error("Not a Protoscope comments payload")
}

export async function shareUrl(list: Comment[]): Promise<string> {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, "")
  return `${base}/?comments=1#c=${await encodePayload(list)}`
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
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, "")
  return base + pageUrl(c.page, c.dims, { c: c.id })
}

export async function toMarkdown(list: Comment[]): Promise<string> {
  const open = list.filter((c) => !c.resolved)
  const resolved = list.filter((c) => c.resolved)
  const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const lines: string[] = [`*Protoscope comments — ${manifest.product.name}* (${open.length} open, ${resolved.length} resolved)`, ""]
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
