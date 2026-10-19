import { useEffect, useState, useSyncExternalStore } from "react"
import { appBase, contentUrl, workspaceBase } from "./manifest"

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

export { contentUrl }
