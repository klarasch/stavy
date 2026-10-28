import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { reloadSnapshotIndex } from "./manifest"
import { postVisible, requestScan, useContentRev, useDev } from "./dev"
import type { SnapshotEntry } from "./types"

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

/* ------------------------------------------------------------------ */
/* Live snapshots: auto-refresh after the app's source changes         */
/* ------------------------------------------------------------------ */

let lastContentRev = 0
/**
 * Re-read the snapshot index on every content change — a scan finished, or
 * wrote one more capture — so cards show new captures as they land.
 */
export function useLiveSnapshotRev(): number {
  const rev = useContentRev()
  useEffect(() => {
    if (!rev || rev === lastContentRev) return
    lastContentRev = rev
    void refreshSnapshotIndex()
  }, [rev])
  return useSnapshotRev()
}

/**
 * True while the dev server is refreshing after a source change and this
 * capture predates that change: the card is about to update.
 */
export function useUpdating(entry: SnapshotEntry | undefined): boolean {
  const dev = useDev()
  if (!entry || !dev?.refreshing || !dev.sourceChangedAt) return false
  const seen = entry.checkedAt ?? entry.at
  return !seen || seen < dev.sourceChangedAt
}

const VISIBLE_THROTTLE_MS = 1000
/** Re-send an unchanged list this often: the server treats silence (10 s) as "nobody is looking". */
const VISIBLE_HEARTBEAT_MS = 4000

/**
 * Report the `[data-instance]` cards on screen to the dev server, nearest the
 * middle first, so the server re-captures what you look at, and only that. It
 * repeats the list while the tab is shown and stops when the tab is hidden, so
 * a closed or backgrounded viewer costs no captures. One IntersectionObserver
 * for the whole viewer; cards are found by attribute, so the map, boards and
 * docs need no wiring. Mount once.
 */
export function useVisibleCardsReport() {
  const dev = useDev()
  const on = !!dev?.writable && !!dev?.autoRefresh
  useEffect(() => {
    if (!on || typeof IntersectionObserver === "undefined") return
    const shown = new Set<Element>()
    const watched = new Set<Element>()
    let sent = ""
    let timer: ReturnType<typeof setTimeout> | null = null
    let last = 0
    const send = (force = false) => {
      timer = null
      if (document.hidden) return
      last = Date.now()
      const cx = innerWidth / 2
      const cy = innerHeight / 2
      const dist = (el: Element) => {
        const r = el.getBoundingClientRect()
        return Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy)
      }
      const keys = [...new Set([...shown].filter((el) => el.isConnected).sort((a, b) => dist(a) - dist(b)).map((el) => el.getAttribute("data-instance") ?? ""))].filter(Boolean)
      const body = keys.join("\n")
      if (body === sent && !force) return
      sent = body
      postVisible(keys).catch(() => {})
    }
    const schedule = () => {
      if (timer || document.hidden) return
      timer = setTimeout(send, Math.max(0, VISIBLE_THROTTLE_MS - (Date.now() - last)))
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.isIntersecting ? shown.add(e.target) : shown.delete(e.target)
      schedule()
    })
    const sync = () => {
      const now = new Set(document.querySelectorAll("[data-instance]"))
      for (const el of now) if (!watched.has(el)) (watched.add(el), io.observe(el))
      for (const el of watched) if (!now.has(el)) (watched.delete(el), shown.delete(el), io.unobserve(el))
    }
    let syncT: ReturnType<typeof setTimeout> | null = null
    const mo = new MutationObserver(() => {
      if (!syncT) syncT = setTimeout(() => ((syncT = null), sync()), 250)
    })
    mo.observe(document.body, { childList: true, subtree: true })
    sync()
    const beat = setInterval(() => send(true), VISIBLE_HEARTBEAT_MS)
    const onVisibility = () => {
      if (!document.hidden) send(true)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      clearInterval(beat)
      document.removeEventListener("visibilitychange", onVisibility)
      mo.disconnect()
      io.disconnect()
      if (timer) clearTimeout(timer)
      if (syncT) clearTimeout(syncT)
    }
  }, [on])
}

/** Mount once: keeps the snapshot index live and reports visible cards. Renders nothing. */
export function LiveSnapshots(): null {
  useLiveSnapshotRev()
  useVisibleCardsReport()
  return null
}
