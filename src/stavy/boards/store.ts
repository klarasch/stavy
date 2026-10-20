import { useEffect, useSyncExternalStore } from "react"
import { contentIndex, loadContentIndex } from "../manifest"
import { deleteContent, useContentRev, writeContent } from "../dev"
import { refreshSnapshotIndex, useSnapshotRev } from "../snapshots"
import type { BoardFile, ContentIndex, ContentLink } from "../types"

/**
 * Shared state for authored content (stavy-content/): the index of boards
 * and docs, re-read whenever the dev endpoint reports a change, so every
 * board picks up an agent's edits live.
 */

let index: ContentIndex = contentIndex
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export async function refreshIndex() {
  index = { ...(await loadContentIndex()) }
  emit()
}

/** The content index, re-read when the dev endpoint reports a change. */
export function useContentIndex(): ContentIndex {
  const rev = useContentRev()
  useEffect(() => {
    if (rev) void refreshIndex()
  }, [rev])
  return useSyncExternalStore(subscribe, () => index)
}

let lastSnapRev = 0
/**
 * Re-read the snapshot index on every content change — a scan an agent ran
 * from the terminal finishes, a board asked for a variant — so cards on a
 * board (and the map's own cards, via snapshots.ts) show new captures live.
 */
export function useSnapshotsRev(): number {
  const rev = useContentRev()
  useEffect(() => {
    if (!rev || rev === lastSnapRev) return
    lastSnapRev = rev
    void refreshSnapshotIndex()
  }, [rev])
  return useSnapshotRev()
}

/* ------------------------------------------------------------------ */
/* Routing: ?b=<board> · ?doc=<id> · ?view=map · neither = Home        */
/* (the map, when there is no stavy-content/index.json)                */
/* ------------------------------------------------------------------ */

const VIEW_KEY = "ps-views"
function views(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "{}")
  } catch {
    return {}
  }
}
/** Remember where a page was looked at (`v=x,y,k`), so switching back lands there. */
export function rememberView(page: string, v: string) {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ ...views(), [page]: v }))
  } catch {
    /* private mode: no memory, no harm */
  }
}
const withView = (page: string, extra: Record<string, string>) => {
  const v = views()[page]
  return v ? { ...extra, v } : extra
}

// Search-only links: navigate() resolves them against the current path, so the
// viewer stays wherever it is served (no basename doubling; deep links reload).
const qs = (p: Record<string, string>) => `?${new URLSearchParams(p).toString()}`
export const mapHref = () => qs(withView("map", { view: "map" }))
export const homeHref = () => qs({ view: "home" })
export const boardHref = (id: string) => qs(withView(`b:${id}`, { b: id }))
export const docHref = (id?: string) => qs({ doc: id ?? "" })

/* ------------------------------------------------------------------ */
/* Index edits (dev endpoint only)                                     */
/* ------------------------------------------------------------------ */

export function slug(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "board"
  let id = base
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  return id
}

async function writeIndex(next: ContentIndex) {
  await writeContent("index.json", next)
  index = next
  emit()
}

export async function saveLinks(links: ContentLink[]) {
  const cur = await loadContentIndex()
  const next: ContentIndex = { ...cur }
  if (links.length) next.links = links
  else delete next.links
  await writeIndex(next)
}

export async function createBoard(title: string): Promise<string> {
  const cur = await loadContentIndex()
  const id = slug(title, new Set((cur.boards ?? []).map((b) => b.id)))
  const board: BoardFile = { title, status: "draft", items: [] }
  await writeContent(`boards/${id}.json`, board)
  await writeIndex({ ...cur, boards: [...(cur.boards ?? []), { id, title }] })
  return id
}

export async function renameBoard(id: string, title: string, board: BoardFile | null) {
  const cur = await loadContentIndex()
  await writeIndex({ ...cur, boards: (cur.boards ?? []).map((b) => (b.id === id ? { ...b, title } : b)) })
  if (board) await writeContent(`boards/${id}.json`, { ...board, title })
}

export async function removeBoard(id: string) {
  const cur = await loadContentIndex()
  await deleteContent(`boards/${id}.json`)
  await writeIndex({ ...cur, boards: (cur.boards ?? []).filter((b) => b.id !== id) })
}

export async function createDoc(title: string): Promise<string> {
  const cur = await loadContentIndex()
  const id = slug(title, new Set((cur.docs ?? []).map((d) => d.id)))
  await writeContent(`docs/${id}.md`, `# ${title}\n\n`)
  await writeIndex({ ...cur, docs: [...(cur.docs ?? []), { id, title }] })
  return id
}

