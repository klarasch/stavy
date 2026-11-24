import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { manifest, getPage, valueLabel, dimensionLabel, pageUrl, canvasUrl, contentUrl, contentIndex, targetsById } from "../manifest"
import { fetchRounds, postRoundOps, useContentRev, useDev } from "../dev"
import { adapterSetting, loadAdapterModule, resolveMode, type CommentsAdapter, type CommentsMode } from "./adapter"
import { relocate, type AnchorEl, type ElementAnchor, type FracBox } from "./anchor"
import { applyOp, asRound, describeRounds, legacyToRounds, localDate, mergeRounds, newId, type Round, type RoundOp } from "../../../scripts/lib/rounds.mjs"

export { pathBetween, followPath } from "./anchor"
export type { Round } from "../../../scripts/lib/rounds.mjs"

/* ------------------------------------------------------------------ */
/* Comments: conversation about a prototype — separate from annotations  */
/* (authored documentation in the manifest). They can sit anywhere the  */
/* viewer shows something: on an element in the player, on a board (an */
/* item or a point), on the map, or on a passage of a doc.              */
/*                                                                      */
/* They are kept as review rounds (scripts/lib/rounds.mjs,              */
/* docs/COMMENTS.md): one file per author per round, and every change   */
/* is one operation — a comment, a reply, a status — applied to the     */
/* rounds as they are. The viewer never writes a list of comments from  */
/* memory, so a comment it failed to load can not be lost by saving.    */
/* Where the rounds live is an adapter (adapter.ts): files through the  */
/* dev endpoint, this browser, or a module the workspace provides.      */
/* ------------------------------------------------------------------ */

export interface CommentReply {
  id: string
  author: string
  body: string
  createdAt: number
  /** Set when the reply came with a status change ("addressed") */
  status?: CommentStatus
  commit?: string
}

export type CommentStatus = "open" | "addressed" | "closed"

/** The map (overview canvas) is addressed as a board with this id. */
export const MAP_BOARD = "@map"

export interface Comment extends ElementAnchor {
  id: string
  /* ---- player: an element of a page state (ElementAnchor fields) ---- */
  page?: string
  dims?: Record<string, string>
  /**
   * Player: the app URL on screen when the comment was made, when the app had
   * navigated somewhere that is not a registered state. `page` and `dims` are
   * then the state the reviewer came from.
   */
  url?: string
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
  /** The commit and branch of the build the comment was made on, when known */
  commit?: string
  branch?: string
  /** open → addressed (by whoever made the change, with the commit) → closed (by the comment's author) */
  status: CommentStatus
  /** The commit a comment was addressed in, and by whom */
  addressedIn?: string
  addressedBy?: string
  /** Same as status === "closed" */
  resolved: boolean
  replies: CommentReply[]
  /** The round (file) the comment lives in */
  round?: string
}

export type Place = "page" | "board" | "map" | "doc"
export function placeOf(c: Pick<Comment, "doc" | "board">): Place {
  if (c.doc != null) return "doc"
  if (c.board != null) return c.board === MAP_BOARD ? "map" : "board"
  return "page"
}

export type NewComment = Omit<Comment, "id" | "createdAt" | "resolved" | "replies" | "author" | "body" | "status"> & { body: string; author?: string }

interface CommentsState {
  comments: Comment[]
  /** Threads not closed yet (open or addressed) */
  open: number
  author: string
  mode: CommentsMode
  setAuthor: (a: string) => void
  add: (c: NewComment) => Comment
  /** `{ resolved }` closes or reopens; anything else edits the comment */
  update: (id: string, patch: Partial<Comment>) => void
  setStatus: (id: string, status: CommentStatus) => void
  remove: (id: string) => void
  reply: (id: string, body: string) => void
  /** Take in someone's rounds (a reviewer's link). Returns how many comments were new. */
  importRounds: (list: Round[]) => number
  /** What "Send feedback" sends: this browser's rounds on a published build, every round in the dev viewer */
  outgoing: Round[]
  /** Rounds that arrived in a link and wait for a yes */
  incoming: Round[] | null
  acceptIncoming: () => number
  dismissIncoming: () => void
  countFor: (page: string, dims: Record<string, string>) => number
  forInstance: (page: string, dims: Record<string, string>) => Comment[]
}

const Ctx = createContext<CommentsState | null>(null)
const roundsKey = () => `ps-rounds:${manifest.product.name}`
/** Before rounds: one list of comments in the browser, and the ids taken in from a published comments.json. */
const legacyKey = () => `ps-comments:${manifest.product.name}`
const legacySeededKey = () => `ps-comments-seeded:${manifest.product.name}`
const AUTHOR_KEY = "ps-author"

export const uid = newId

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
const asRounds = (list: unknown): Round[] => (Array.isArray(list) ? list.map(asRound).filter((r): r is Round => !!r) : [])

/** This browser's own rounds. Comments kept here before rounds existed are converted once. */
function loadLocal(): Round[] {
  let rounds = asRounds(readLS<unknown[]>(roundsKey(), []))
  const old = readLS<unknown[] | null>(legacyKey(), null)
  if (Array.isArray(old)) {
    // Those taken in from a published comments.json are still in that file: only this browser's own move.
    const seeded = new Set(readLS<string[]>(legacySeededKey(), []))
    for (const round of legacyToRounds(old.filter((c: any) => c && !seeded.has(c.id)))) rounds = applyOp(rounds, { author: round.author, date: round.date }, { op: "import", round }).rounds
    writeLS(roundsKey(), rounds)
    try {
      localStorage.removeItem(legacyKey())
      localStorage.removeItem(legacySeededKey())
    } catch {
      /* stays; converting again changes nothing */
    }
  }
  return rounds
}

async function fetchJson(rel: string): Promise<any | null> {
  try {
    const r = await fetch(contentUrl(rel), { cache: "no-store" })
    if (!r.ok) return null
    const t = await r.text()
    // A dev server or static host answers a missing file with index.html: only JSON counts.
    return /^\s*[{[]/.test(t) ? JSON.parse(t) : null
  } catch {
    return null
  }
}

/** The rounds a static build ships (rounds/index.json lists them), plus an old comments.json if it is still there. */
async function fetchShipped(): Promise<Round[]> {
  const index = await fetchJson("rounds/index.json")
  const files: string[] = Array.isArray(index?.rounds) ? index.rounds.filter((f: unknown) => typeof f === "string") : []
  let rounds = asRounds(await Promise.all(files.map((f) => fetchJson(`rounds/${f}`))))
  const legacy = await fetchJson("comments.json")
  const list = Array.isArray(legacy) ? legacy : legacy?.comments
  if (Array.isArray(list)) for (const round of legacyToRounds(list)) rounds = applyOp(rounds, { author: round.author, date: round.date }, { op: "import", round }).rounds
  return rounds
}

/** The commit and branch a published build was made from (scripts/publish.mjs writes stavy-content/build.json). */
let buildStamp: { commit?: string; branch?: string } | null = null
async function loadBuildStamp() {
  if (buildStamp) return buildStamp
  const b = await fetchJson("build.json")
  buildStamp = b && typeof b === "object" ? { ...(typeof b.commit === "string" ? { commit: b.commit } : {}), ...(typeof b.branch === "string" ? { branch: b.branch } : {}) } : {}
  return buildStamp
}

/** A stored comment from an adapter or an old file, as the viewer's shape. */
const threadsOf = (rounds: Round[]) => mergeRounds(rounds) as Comment[]

export function CommentsProvider({ children }: { children: ReactNode }) {
  const dev = useDev()
  const rev = useContentRev()
  const mode = resolveMode(adapterSetting(), !!dev?.writable)
  const [author, setAuthorState] = useState(() => {
    try {
      return localStorage.getItem(AUTHOR_KEY) ?? ""
    } catch {
      return ""
    }
  })

  // Everything shown. `known` are the rounds that live somewhere else than this
  // browser (shipped with the build, or on disk behind the dev endpoint): the
  // browser never stores those, and never writes into them.
  const [rounds, setRoundsState] = useState<Round[]>(() => (resolveMode(adapterSetting(), false) === "module" ? [] : loadLocal()))
  const roundsRef = useRef(rounds)
  const known = useRef<Set<string>>(new Set())
  const setRounds = useCallback((next: Round[]) => {
    roundsRef.current = next
    setRoundsState(next)
  }, [])
  const comments = useMemo(() => threadsOf(rounds), [rounds])

  const [stamp, setStamp] = useState<{ commit?: string; branch?: string }>({})
  useEffect(() => {
    if (dev?.commit) setStamp({ commit: dev.commit, branch: dev.branch })
    // (the dev server may answer while this is under way: what it said stays)
    else if (!dev) void loadBuildStamp().then((b) => setStamp((prev) => (prev.commit ? prev : b)))
  }, [dev, dev?.commit, dev?.branch])

  /* ---- local: this browser's rounds next to the ones the build ships ---- */
  useEffect(() => {
    if (mode !== "local") return
    writeLS(roundsKey(), rounds.filter((r) => !known.current.has(r.id)))
  }, [rounds, mode])
  useEffect(() => {
    if (mode !== "local") return
    let cancelled = false
    void fetchShipped().then((shipped) => {
      if (cancelled || !shipped.length) return
      const ids = new Set(shipped.map((r) => r.id))
      // A round made here before the build shipped one of the same name keeps its own comments.
      let next: Round[] = [...shipped]
      for (const round of roundsRef.current.filter((r) => !known.current.has(r.id))) next = applyOp(next, { author: round.author, date: round.date, avoid: [...ids] }, { op: "import", round }).rounds
      known.current = ids
      setRounds(next)
    })
    const onStorage = (e: StorageEvent) => {
      if (e.key !== roundsKey()) return
      setRounds([...roundsRef.current.filter((r) => known.current.has(r.id)), ...loadLocal().filter((r) => !known.current.has(r.id))])
    }
    window.addEventListener("storage", onStorage)
    return () => {
      cancelled = true
      window.removeEventListener("storage", onStorage)
    }
  }, [mode, setRounds])

  /* ---- file: the rounds on disk, through the dev endpoint ---- */
  // Changes wait in a queue until the endpoint has taken them; what is on
  // screen is replaced by what is on disk only when the queue is empty.
  const queue = useRef<Array<{ author: string; date: string; op: RoundOp }>>([])
  const flushing = useRef(false)
  const reload = useCallback(async () => {
    const list = await fetchRounds()
    if (!list || queue.current.length) return
    const next = asRounds(list)
    known.current = new Set(next.map((r) => r.id))
    setRounds(next)
  }, [setRounds])
  const flush = useCallback(async () => {
    if (flushing.current) return
    flushing.current = true
    try {
      while (queue.current.length) {
        const batch = queue.current.slice()
        await postRoundOps(batch)
        queue.current.splice(0, batch.length)
      }
      await reload()
    } catch (e) {
      console.warn("stavy: could not save comments yet, trying again", e)
      setTimeout(() => void flush(), 2000)
    } finally {
      flushing.current = false
    }
  }, [reload])
  const movedIn = useRef(false)
  useEffect(() => {
    if (mode !== "file") return
    // Rounds collected in this browser while there was no endpoint move into files, once.
    if (!movedIn.current) {
      movedIn.current = true
      const mine = roundsRef.current.filter((r) => !known.current.has(r.id))
      if (mine.length) {
        for (const round of mine) queue.current.push({ author: round.author, date: round.date, op: { op: "import", round } })
        void flush().then(() => {
          if (!queue.current.length) writeLS(roundsKey(), [])
        })
        return
      }
    }
    void (queue.current.length ? flush() : reload())
  }, [mode, rev, reload, flush])

  /* ---- module: the workspace's own adapter (it stores whole comments) ---- */
  const adapter = useRef<CommentsAdapter | null>(null)
  const refresh = useCallback(async () => {
    const a = adapter.current
    if (!a) return
    try {
      setRounds(legacyToRounds(await a.list()))
    } catch (e) {
      console.warn("stavy: comments adapter list() failed", e)
    }
  }, [setRounds])
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

  /** The one way anything changes: apply an operation to what is on screen, then hand it to where the rounds live. */
  const apply = useCallback(
    (op: RoundOp, as = author) => {
      const ctx = { author: as || "anonymous", date: localDate(), ...stamp, avoid: mode === "local" ? [...known.current] : [] }
      const before = roundsRef.current
      const next = applyOp(before, ctx, op).rounds
      if (next === before) return
      setRounds(next)
      if (mode === "file") {
        queue.current.push({ author: ctx.author, date: ctx.date, op })
        void flush()
      } else if (mode === "module" && adapter.current) {
        const a = adapter.current
        const had = new Set(threadsOf(before).map((c) => c.id))
        const now = threadsOf(next)
        const calls: Array<Promise<void> | undefined> = []
        if (op.op === "event") {
          const c = now.find((x) => x.id === op.event.thread)
          if (!c) calls.push(a.remove?.(op.event.thread))
          else calls.push(a.update(c.id, { ...(op.event.type === "edit" ? (op.event.patch as Partial<Comment>) : {}), status: c.status, resolved: c.resolved, replies: c.replies, addressedIn: c.addressedIn }))
        } else for (const c of now) if (!had.has(c.id)) calls.push(a.save(c))
        Promise.all(calls).catch((e) => console.warn("stavy: comments adapter write failed", e))
      }
    },
    [author, stamp, mode, setRounds, flush]
  )

  const importRounds = useCallback(
    (list: Round[]) => {
      const had = new Set(threadsOf(roundsRef.current).map((c) => c.id))
      for (const round of asRounds(list)) apply({ op: "import", round }, round.author)
      return threadsOf(roundsRef.current).filter((c) => !had.has(c.id)).length
    },
    [apply]
  )

  // A reviewer's link (#round=…, or the older #c=…): unpack it, drop the hash, and ask before taking it in.
  const [incoming, setIncoming] = useState<Round[] | null>(null)
  useEffect(() => {
    const m = window.location.hash.match(/[#&](?:round|c)=([^&]+)/)
    if (!m) return
    decodeRounds(m[1])
      .then((list) => {
        history.replaceState(null, "", window.location.pathname + window.location.search)
        if (list.length) setIncoming(list)
      })
      .catch((e) => console.warn("stavy: could not unpack the feedback link", e))
  }, [])

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
        const by = c.author ?? author
        const stored = { ...c, ...stamp, author: by || "anonymous", id: uid(), createdAt: Date.now() }
        apply({ op: "comment", comment: stored }, by)
        return { ...stored, status: "open", resolved: false, replies: [] }
      },
      update: (id, patch) => {
        const { resolved, status, replies: _r, ...rest } = patch
        void _r
        if (status) apply({ op: "event", event: { thread: id, type: "status", status } })
        else if (resolved !== undefined) apply({ op: "event", event: { thread: id, type: "status", status: resolved ? "closed" : "open" } })
        if (Object.keys(rest).length) apply({ op: "event", event: { thread: id, type: "edit", patch: rest } })
      },
      setStatus: (id, status) => apply({ op: "event", event: { thread: id, type: "status", status } }),
      remove: (id) => apply({ op: "event", event: { thread: id, type: "remove" } }),
      reply: (id, body) => apply({ op: "event", event: { thread: id, type: "reply", body } }),
      importRounds,
      outgoing: mode === "local" ? rounds.filter((r) => !known.current.has(r.id)) : rounds,
      incoming,
      acceptIncoming: () => {
        const n = incoming ? importRounds(incoming) : 0
        setIncoming(null)
        return n
      },
      dismissIncoming: () => setIncoming(null),
      countFor: (page, dims) => comments.filter((c) => !c.resolved && placeOf(c) === "page" && c.page === page && dimsEqual(c.dims, dims)).length,
      forInstance: (page, dims) => comments.filter((c) => placeOf(c) === "page" && c.page === page && dimsEqual(c.dims, dims)),
    }),
    [comments, rounds, author, mode, stamp, apply, importRounds, incoming]
  )
  return (
    <Ctx.Provider value={value}>
      {children}
      {incoming && <IncomingRound rounds={incoming} writable={mode === "file"} onImport={value.acceptIncoming} onDismiss={value.dismissIncoming} />}
    </Ctx.Provider>
  )
}

/** "Import round: 5 comments from Dana": shown when the viewer is opened from a reviewer's link. */
function IncomingRound({ rounds, writable, onImport, onDismiss }: { rounds: Round[]; writable: boolean; onImport: () => number; onDismiss: () => void }) {
  const d = describeRounds(rounds)
  const what = [d.comments ? `${d.comments} comment${d.comments === 1 ? "" : "s"}` : "", d.events ? `${d.events} repl${d.events === 1 ? "y or status change" : "ies and status changes"}` : ""].filter(Boolean).join(", ")
  return (
    <div className="ps ps-glass-strong fixed left-1/2 top-4 -translate-x-1/2 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ zIndex: "var(--ps-z-chrome)" }} data-ps-ui data-ps-incoming>
      <div className="text-[12.5px] leading-snug">
        <div className="font-semibold">
          Import round: {what} from {d.authors.join(", ")}
        </div>
        <div className="text-[11px]" style={{ color: "var(--ps-muted)" }}>
          {writable ? "Writes the round file into stavy-content/rounds/." : "Adds them to this browser. Open the link in the dev viewer to write the round file."}
        </div>
      </div>
      <button className="ps-btn ps-btn-primary h-7 px-2.5 text-[12px]" onClick={onImport}>
        Import
      </button>
      <button className="ps-btn h-7 px-2.5 text-[12px]" onClick={onDismiss}>
        Not now
      </button>
    </div>
  )
}

export function useComments() {
  const c = useContext(Ctx)
  if (!c) throw new Error("useComments must be used inside <CommentsProvider>")
  return c
}

/* ---------------- payload: gzip + base64url in the URL hash ---------------- */

const b64u = {
  enc: (bytes: Uint8Array) => {
    let s = ""
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  },
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

/** Rounds as one string for a link: "r1." + gzip, or "r0." where the browser cannot compress. */
export async function encodeRounds(list: Round[]): Promise<string> {
  const json = JSON.stringify({ v: 1, rounds: list })
  const z = await gzip(json)
  return z ? "r1." + b64u.enc(z) : "r0." + b64u.enc(new TextEncoder().encode(json))
}

/**
 * Accepts a payload, a `#round=…` fragment, a full share link, or plain JSON
 * (a round, `{ rounds }`), and the older forms: `#c=…` payloads and a plain
 * list of comments, which come back as rounds.
 */
export async function decodeRounds(input: string): Promise<Round[]> {
  let s = input.trim()
  const m = s.match(/[#&](?:round|c)=([^&\s]+)/)
  if (m) s = m[1]
  let raw: any
  if (s.startsWith("[") || s.startsWith("{")) raw = JSON.parse(s)
  else if (/^[rc]1\./.test(s)) raw = JSON.parse(await gunzip(b64u.dec(s.slice(3))))
  else if (/^[rc]0\./.test(s)) raw = JSON.parse(new TextDecoder().decode(b64u.dec(s.slice(3))))
  else throw new Error("Not a Stavy feedback payload")
  if (Array.isArray(raw)) return raw.every((x) => asRound(x)) && raw.length ? asRounds(raw) : legacyToRounds(raw)
  if (Array.isArray(raw?.rounds)) return asRounds(raw.rounds)
  if (Array.isArray(raw?.comments) && !raw.id) return legacyToRounds(raw.comments)
  const one = asRound(raw)
  if (!one) throw new Error("Not a Stavy feedback payload")
  return [one]
}

/** The one link a reviewer sends: opening it offers to import the rounds. */
export async function shareUrl(list: Round[]): Promise<string> {
  return `${window.location.origin}${canvasUrl({ comments: "1" })}#round=${await encodeRounds(list)}`
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
      return `${page?.label ?? c.page}${dims ? ` (${dims})` : ""}${c.url ? ` at ${c.url}` : ""}${what}`
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

/**
 * The digest that goes with a feedback link: the threads these rounds touch,
 * in words, each with a link to its place. Markdown that reads in chat, a
 * ticket or a wiki page.
 */
export async function toMarkdown(rounds: Round[], all: Comment[]): Promise<string> {
  const touched = new Set(rounds.flatMap((r) => [...r.comments.map((c) => c.id), ...r.events.map((e) => e.thread)]))
  const list = all.filter((c) => touched.has(c.id))
  const d = describeRounds(rounds)
  const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  const versions = [...new Set(rounds.map((r) => [r.branch && `branch \`${r.branch}\``, r.commit && `commit \`${r.commit}\``].filter(Boolean).join(", ")).filter(Boolean))]
  const state = (c: Comment) => (c.status === "addressed" ? ` (addressed${c.addressedIn ? ` in ${c.addressedIn}` : ""})` : c.status === "closed" ? " (closed)" : "")
  const lines: string[] = [`# Feedback on ${manifest.product.name}${d.authors.length ? ` from ${d.authors.join(", ")}` : ""}`, ""]
  if (versions.length) lines.push(`Reviewed: ${versions.join("; ")}`, "")
  lines.push(`${list.filter((c) => c.status === "open").length} open, ${list.filter((c) => c.status === "addressed").length} addressed, ${list.filter((c) => c.status === "closed").length} closed`, "")
  list.forEach((c, i) => {
    lines.push(`${i + 1}. **${describeAnchor(c)}**${state(c)} · ${c.author || "anonymous"}, ${fmtDate(c.createdAt)}`)
    lines.push(`   ${c.body.replace(/\n/g, "\n   ")}`)
    for (const r of c.replies) lines.push(`   - ${r.author || "anonymous"}: ${r.body.replace(/\n/g, " ")}`)
    lines.push(`   ${commentUrl(c)}`)
  })
  lines.push("", `Import this round in the dev viewer: ${await shareUrl(rounds)}`)
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
