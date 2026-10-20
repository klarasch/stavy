import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { appBase, contentUrl, reloadManifest, workspaceBase } from "./manifest"

/**
 * The dev endpoint (scripts/vite-plugin.mjs). When the prototype's dev server
 * runs the plugin, the viewer can write boards, notes, docs and comments back
 * to stavy-content/ and ask for snapshots on demand. Without it — static
 * hosting, a published build — `writable` stays false and the viewer is
 * read-only. Nothing else changes.
 */

type Health = { ok: boolean; writable: boolean; rev: number; scan?: { running: boolean; ok?: boolean; finishedAt?: string } }

let health: Health | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function api(path: string) {
  return `${workspaceBase || appBase}/__stavy/${path}`
}

let polling = false
/** Start polling the endpoint (once). Every rev change notifies subscribers. */
export function startDevPolling(intervalMs = 1500) {
  if (polling) return
  polling = true
  const tick = async () => {
    try {
      const r = await fetch(api("health"), { cache: "no-store" })
      const next = r.ok ? ((await r.json()) as Health) : null
      const changed = JSON.stringify(next) !== JSON.stringify(health)
      health = next?.ok ? next : null
      if (changed) emit()
      // Static hosting answers 404 (or index.html): stop asking.
      if (!health) return
    } catch {
      health = null
      emit()
      return
    }
    setTimeout(tick, intervalMs)
  }
  void tick()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The endpoint's state: null when absent (read-only viewer). */
export function useDev(): Health | null {
  useEffect(() => startDevPolling(), [])
  return useSyncExternalStore(subscribe, () => health)
}

export const isWritable = () => !!health?.writable

/**
 * Re-run `effect` whenever the dev endpoint reports a content change (an
 * agent edited a board file, a scan finished). Calls it once on mount.
 */
export function useContentRev(): number {
  const h = useDev()
  const [rev, setRev] = useState(0)
  useEffect(() => {
    if (h?.rev) setRev(h.rev)
  }, [h?.rev])
  return rev
}

/** Write a file under stavy-content/. JSON values are pretty-printed. */
export async function writeContent(rel: string, data: unknown): Promise<void> {
  const body = typeof data === "string" || data instanceof Blob ? data : JSON.stringify(data, null, 2) + "\n"
  const r = await fetch(api(`content/${rel.replace(/^\/+/, "")}`), { method: "PUT", body })
  if (!r.ok) throw new Error(`save ${rel} → ${r.status} ${await r.text()}`)
}

export async function deleteContent(rel: string): Promise<void> {
  const r = await fetch(api(`content/${rel.replace(/^\/+/, "")}`), { method: "DELETE" })
  if (!r.ok) throw new Error(`delete ${rel} → ${r.status}`)
}

/** Ask for fresh snapshots of these states (instance keys), or of everything. */
export async function requestScan(keys: string[] | "all"): Promise<void> {
  const r = await fetch(api("scan"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(keys === "all" ? { all: true } : { keys }),
  })
  if (!r.ok) throw new Error(`scan → ${r.status}`)
}

/** A text field of stavy.json the viewer may edit (see scripts/lib/patch.mjs for the allowed paths). */
export type ManifestPath = (string | number)[]

/** Set one text field of stavy.json through the dev endpoint, then re-read the manifest. */
export async function patchManifest(path: ManifestPath, value: string): Promise<void> {
  const r = await fetch(api("manifest"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, value }),
  })
  if (!r.ok) throw new Error(`edit → ${r.status} ${await r.text()}`)
  await reloadManifest()
}

/** Keep the viewer's manifest true when stavy.json changes on disk (an agent or a hand edit). */
export function useManifestSync() {
  const h = useDev()
  // The first rev seen is the state the manifest was just loaded at; only later ones are changes.
  const seen = useRef<number | null>(null)
  useEffect(() => {
    if (!h?.rev) return
    if (seen.current === null) {
      seen.current = h.rev
      return
    }
    if (h.rev !== seen.current) {
      seen.current = h.rev
      void reloadManifest()
    }
  }, [h?.rev])
}

export type RepoCommit = { hash: string; date: string; author: string; subject: string }

/** Recent commits from the dev endpoint; null when it is absent (static hosting). */
export async function fetchCommits(limit = 10, path?: string): Promise<RepoCommit[] | null> {
  try {
    const q = new URLSearchParams({ limit: String(limit), ...(path ? { path } : {}) })
    const r = await fetch(api(`git-log?${q}`), { cache: "no-store" })
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null
    const rows = await r.json()
    return Array.isArray(rows) ? (rows as RepoCommit[]) : null
  } catch {
    return null
  }
}

export { contentUrl }
