import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { manifest, getPage, valueLabel, dimensionLabel, pageUrl, canvasUrl, contentUrl, contentIndex, targetsById } from "../manifest"
import { useContentRev, useDev, writeContent } from "../dev"
import { adapterSetting, loadAdapterModule, resolveMode, type CommentsAdapter, type CommentsMode } from "./adapter"
import { relocate, type AnchorEl, type ElementAnchor, type FracBox } from "./anchor"

export { pathBetween, followPath } from "./anchor"

/* ------------------------------------------------------------------ */
/* Comments: conversation about a prototype — separate from annotations  */
/* (authored documentation in the manifest). They can sit anywhere the  */
/* viewer shows something: on an element in the player, on a board (an */
/* item or a point), on the map, or on a passage of a doc. Where they   */
/* live is an adapter (adapter.ts, docs/COMMENTS.md): a file through    */
/* the dev endpoint, this browser, or a module the workspace provides.  */
/* ------------------------------------------------------------------ */

export interface CommentReply {
  id: string
  author: string
  body: string
  createdAt: number
}

/** The map (overview canvas) is addressed as a board with this id. */
export const MAP_BOARD = "@map"

export interface Comment extends ElementAnchor {
  id: string
  /* ---- player: an element of a page state (ElementAnchor fields) ---- */
  page?: string
  dims?: Record<string, string>
  /* ---- board / map: an item, or a point on the board ---- */
  board?: string
  item?: string
  /* ---- doc: a passage ---- */
  doc?: string
  heading?: string
  quote?: string
  /** Index of the block (paragraph, list item, heading…) clicked, when no text was selected */
  block?: number
  /**
   * Position. Player: % of the anchored element. Board item: % of the item's
   * box. Board point (no item): board coordinates in px.
   */
  x?: number
  y?: number
  body: string
  author: string
  createdAt: number
  resolved: boolean
  replies: CommentReply[]
}

export type Place = "page" | "board" | "map" | "doc"
export function placeOf(c: Comment): Place {
  if (c.doc != null) return "doc"
  if (c.board != null) return c.board === MAP_BOARD ? "map" : "board"
  return "page"
}

export type NewComment = Omit<Comment, "id" | "createdAt" | "resolved" | "replies" | "author" | "body"> & { body: string; author?: string }

interface CommentsState {
  comments: Comment[]
  open: number
  author: string
  mode: CommentsMode
  setAuthor: (a: string) => void
  add: (c: NewComment) => Comment
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
const seededKey = () => `ps-comments-seeded:${manifest.product.name}`
const AUTHOR_KEY = "ps-author"
/** Where the comments live when the viewer can write (relative to stavy-content/). */
export const COMMENTS_FILE = "comments.json"

export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)

export function dimsEqual(a: Record<string, string> | undefined, b: Record<string, string> | undefined) {
  const A = a ?? {}
  const B = b ?? {}
  const ka = Object.keys(A)
  return ka.length === Object.keys(B).length && ka.every((k) => A[k] === B[k])
}

function readLS<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback
  } catch {
    return fallback
  }
}
function writeLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode / quota: nothing to keep */
  }
}
const load = (): Comment[] => normalize(readLS<unknown[]>(storageKey(), []))

/** Accept whatever shape a stored or shared comment comes in (older versions, the file, an adapter). */
export function normalize(list: unknown[]): Comment[] {
  return list
    .filter((c): c is Record<string, any> => !!c && typeof c === "object")
    .map((c) => {
      const out = {
        ...c,
        createdAt: ms(c.createdAt),
        resolved: !!c.resolved,
        body: String(c.body ?? ""),
        author: String(c.author ?? ""),
        replies: (Array.isArray(c.replies) ? c.replies : []).map((r: any) => ({ ...r, createdAt: ms(r.createdAt) })),
      } as Comment
      if (placeOf(out) === "page") out.dims = c.dims ?? {}
      return out
    })
}

/* ---- the file: ISO timestamps so it reads (and diffs) like text ---- */
const iso = (t: number) => new Date(t).toISOString()
const ms = (t: unknown) => (typeof t === "number" ? t : Date.parse(String(t)) || Date.now())

export function toFile(list: Comment[]): string {
  return JSON.stringify(
    {
      version: 2,
      comments: list.map((c) => ({ ...c, createdAt: iso(c.createdAt), replies: c.replies.map((r) => ({ ...r, createdAt: iso(r.createdAt) })) })),
    },
    null,
    2
  )
}

export function fromFile(text: string): Comment[] {
  const raw = JSON.parse(text)
  return normalize(Array.isArray(raw) ? raw : (raw.comments ?? []))
}

async function fetchFile(): Promise<string | null> {
  try {
    const r = await fetch(contentUrl(COMMENTS_FILE), { cache: "no-store" })
    if (!r.ok) return null
    const t = await r.text()
    // A dev server answers a missing file with index.html: only JSON counts.
    return /^\s*[{[]/.test(t) ? t : null
  } catch {
    return null
  }
}

export function CommentsProvider({ children }: { children: ReactNode }) {
  const [comments, setCommentsRaw] = useState<Comment[]>(load)
  const [author, setAuthorState] = useState(() => {
    try {
      return localStorage.getItem(AUTHOR_KEY) ?? ""
    } catch {
      return ""
    }
  })
  const dev = useDev()
  const rev = useContentRev()
  const mode = resolveMode(adapterSetting(), !!dev?.writable)

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

  /* ---- local: localStorage, in sync across tabs ---- */
  useEffect(() => {
    if (mode !== "local") return
    writeLS(storageKey(), comments)
  }, [comments, mode])
  useEffect(() => {
    if (mode !== "local") return
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey()) setCommentsRaw(load())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [mode])
  // A published build may ship the team's comments.json: show those too (read
  // once; each comment is taken in once, so deleting one here sticks).
  useEffect(() => {
    if (mode !== "local") return
    let cancelled = false
    void fetchFile().then((text) => {
      if (cancelled || !text) return
      try {
        const seen = new Set(readLS<string[]>(seededKey(), []))
        const fresh = fromFile(text).filter((c) => !seen.has(c.id))
        if (!fresh.length) return
        writeLS(seededKey(), [...seen, ...fresh.map((c) => c.id)])
        setCommentsRaw((prev) => {
          const have = new Set(prev.map((c) => c.id))
          return [...prev, ...fresh.filter((c) => !have.has(c.id))].sort((a, b) => a.createdAt - b.createdAt)
        })
      } catch {
        /* not valid: nothing to show */
      }
    })
    return () => {
      cancelled = true
    }
  }, [mode])

  /* ---- file: load on start and whenever the content changes underneath us ---- */
  useEffect(() => {
    if (mode !== "file") {
      loaded.current = false
      return
    }
    let cancelled = false
    ;(async () => {
      const text = await fetchFile()
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
  }, [mode, rev])

  // File mode: save shortly after a local edit.
  useEffect(() => {
    if (mode !== "file" || !loaded.current || !dirty.current) return
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
  }, [comments, mode, saveTick])

  /* ---- module: the workspace's own adapter ---- */
  const adapter = useRef<CommentsAdapter | null>(null)
  const refresh = useCallback(async () => {
    const a = adapter.current
    if (!a) return
    try {
      setCommentsRaw(normalize(await a.list()))
    } catch (e) {
      console.warn("stavy: comments adapter list() failed", e)
    }
  }, [])
  useEffect(() => {
    if (mode !== "module") return
    const setting = adapterSetting()
    if (!setting || typeof setting !== "object") return
    let cancelled = false
    loadAdapterModule(setting.module).then(
      (a) => {
        if (cancelled) return
        adapter.current = a
        void refresh()
      },
      (e) => console.warn("stavy: could not load the comments adapter", e)
    )
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => {
      cancelled = true
      window.removeEventListener("focus", onFocus)
    }
  }, [mode, refresh])
  /** Hand a change to the adapter (module mode only); the screen has already changed. */
  const send = useCallback(
    (op: (a: CommentsAdapter) => Promise<void> | undefined) => {
      if (mode !== "module" || !adapter.current) return
      Promise.resolve(op(adapter.current)).catch((e) => console.warn("stavy: comments adapter write failed", e))
    },
    [mode]
  )

  const importMany = useCallback(
    (list: Comment[]) => {
      let added = 0
      const changed: Comment[] = []
      setComments((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]))
        for (const c of normalize(list)) {
          const existing = byId.get(c.id)
          if (!existing) added++
          // newest wins per comment; merge replies by id
          const replies = [...(existing?.replies ?? [])]
          for (const r of c.replies ?? []) if (!replies.some((x) => x.id === r.id)) replies.push(r)
          const next = { ...(existing ?? c), ...c, replies: replies.sort((a, b) => a.createdAt - b.createdAt) }
          byId.set(c.id, next)
          changed.push(next)
        }
        return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt)
      })
      send((a) => Promise.all(changed.map((c) => a.save(c))).then(() => undefined))
      return added
    },
    [setComments, send]
  )

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
      mode,
      setAuthor: (a) => {
        setAuthorState(a)
        try {
          localStorage.setItem(AUTHOR_KEY, a)
        } catch {
          /* not remembered */
        }
      },
      add: (c) => {
        const full: Comment = { ...c, author: c.author ?? author, id: uid(), createdAt: Date.now(), resolved: false, replies: [] }
        setComments((p) => [...p, full])
        send((a) => a.save(full))
        return full
      },
      update: (id, patch) => {
        setComments((p) => p.map((c) => (c.id === id ? { ...c, ...patch } : c)))
        send((a) => a.update(id, patch))
      },
      remove: (id) => {
        setComments((p) => p.filter((c) => c.id !== id))
        send((a) => a.remove?.(id))
      },
      reply: (id, body) => {
        const c = comments.find((x) => x.id === id)
        if (!c) return
        const replies = [...c.replies, { id: uid(), author, body, createdAt: Date.now() }]
        setComments((p) => p.map((x) => (x.id === id ? { ...x, replies } : x)))
        send((a) => a.update(id, { replies }))
      },
      importMany,
      clearAll: () => {
        const ids = comments.map((c) => c.id)
        setComments(() => [])
        send((a) => (a.remove ? Promise.all(ids.map((i) => a.remove!(i))).then(() => undefined) : undefined))
      },
      countFor: (page, dims) => comments.filter((c) => !c.resolved && placeOf(c) === "page" && c.page === page && dimsEqual(c.dims, dims)).length,
      forInstance: (page, dims) => comments.filter((c) => placeOf(c) === "page" && c.page === page && dimsEqual(c.dims, dims)),
    }),
    [comments, author, mode, importMany, setComments, send]
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

/* ---------------- where a comment is, in words and as a link ---------------- */

const boardTitle = (id: string) => contentIndex.boards?.find((b) => b.id === id)?.title ?? id
const docTitle = (id: string) => contentIndex.docs?.find((d) => d.id === id)?.title ?? id
const short = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1) + "…" : s)

export function describeAnchor(c: Comment): string {
  switch (placeOf(c)) {
    case "doc":
      return `Doc: ${docTitle(c.doc!)}${c.heading ? ` › ${c.heading}` : ""}${c.quote ? ` “${short(c.quote)}”` : ""}`
    case "map":
      return `Map${c.item ? ` @${c.item}` : ""}`
    case "board":
      return `Board: ${boardTitle(c.board!)}${c.item ? ` @${c.item}` : ""}`
    default: {
      const page = getPage(c.page ?? "")
      const dims = Object.entries(c.dims ?? {})
        .map(([d, v]) => `${dimensionLabel(d)} ${valueLabel(d, v)}`)
        .join(", ")
      const what = c.target ? ` @${c.target}` : c.snippet ? ` “${short(c.snippet, 30)}”` : ""
      return `${page?.label ?? c.page}${dims ? ` (${dims})` : ""}${what}`
    }
  }
}

/** The viewer link that opens a comment in its place (search-only for in-app navigation). */
export function commentHref(c: Comment, extra: Record<string, string> = {}): string {
  switch (placeOf(c)) {
    case "doc":
      return canvasUrl({ doc: c.doc!, c: c.id, ...extra })
    case "map":
      return canvasUrl({ c: c.id, ...extra })
    case "board":
      return canvasUrl({ b: c.board!, c: c.id, ...extra })
    default:
      return pageUrl(c.page ?? "", c.dims, { c: c.id, ...extra })
  }
}

export function commentUrl(c: Comment): string {
  return window.location.origin + commentHref(c)
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

export function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean)
  return (p.length >= 2 ? p[0][0] + p[p.length - 1][0] : (p[0] ?? "?").slice(0, 2)).toUpperCase()
}

/* ---------------- anchoring in the prototype document ---------------- */

/** Where a player comment is now: an element (and how it was found), or a stored box. */
export function locateInDoc(c: Comment, doc: ParentNode, root: Element): { el: Element; via: string } | { box: FracBox; via: "box" } {
  const found = relocate(c, {
    root: root as unknown as AnchorEl,
    targetOf: () => null,
    targetsById: (id) => targetsById(doc, id) as unknown as AnchorEl[],
  })
  if (!found) return { el: root, via: "root" }
  return "box" in found ? found : { el: found.el as unknown as Element, via: found.via }
}

/** Resolve a comment's anchor to an element (the page root when only a box is left). */
export function resolveAnchor(c: Comment, doc: ParentNode, root: Element): Element {
  const r = locateInDoc(c, doc, root)
  return "el" in r ? r.el : root
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
