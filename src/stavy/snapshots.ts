import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { reloadSnapshotIndex } from "./manifest"
import { requestScan, useContentRev, useDev } from "./dev"

/**
 * On-demand snapshots (dev endpoint only). `useSnapshotRev` re-renders its
 * caller whenever the snapshot index was re-read; `useScan` asks the dev
 * server to capture some states (or everything) and reports `busy` until the
 * endpoint says content changed and the scan is no longer running.
 */

let snapRev = 0
const listeners = new Set<() => void>()

export async function refreshSnapshotIndex() {
  await reloadSnapshotIndex()
  snapRev++
  listeners.forEach((l) => l())
}

export function useSnapshotRev(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapRev
  )
}

const GIVE_UP_MS = 120_000

export function useScan(keys: string[] | "all"): { busy: boolean; start: () => void; writable: boolean } {
  const dev = useDev()
  const rev = useContentRev()
  const [busy, setBusy] = useState(false)
  const base = useRef(0)
  const running = !!dev?.scan?.running
  const keyStr = Array.isArray(keys) ? keys.join(",") : keys

  const start = useCallback(() => {
    base.current = rev
    setBusy(true)
    requestScan(keys).catch((e) => {
      console.warn("[stavy] scan request failed:", e)
      setBusy(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, keyStr])

  useEffect(() => {
    if (!busy || rev === base.current) return
    void refreshSnapshotIndex()
    if (!running) setBusy(false)
  }, [busy, rev, running])

  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => setBusy(false), GIVE_UP_MS)
    return () => clearTimeout(t)
  }, [busy])

  return { busy, start, writable: !!dev?.writable }
}
