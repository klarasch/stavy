// The dev plugin's capture queue: which states to re-capture next, one job at
// a time. Pure apart from the timer and the `run` callback it is given, so the
// policy can be unit-tested without a browser.
//
// Policy: an app source change only records when it happened. A captured state
// is out of date when its capture is older than that. Out-of-date states are
// re-captured only while a viewer is looking (it reported visible cards in the
// last `activeMs`), after the source has been quiet for `debounceMs`, and by
// default only the ones on screen. A card that scrolls into view later is
// captured when the viewer's next report names it. With scope "all" the other
// captured states follow in small chunks. A scan someone asked for (a card's
// refresh button) always goes first. Jobs never overlap, and a change while
// one runs just makes its states out of date again.

/**
 * @param {{
 *   run: (keys: string[] | "all", o: { background: boolean }) => Promise<unknown>,
 *   capturedKeys: () => string[],
 *   capturedAt?: (key: string) => string | null | undefined,
 *   scope?: "visible" | "all",
 *   debounceMs?: number, activeMs?: number, chunk?: number, visibleMax?: number,
 *   now?: () => number,
 *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout },
 * }} o
 */
export function createRefresher({
  run,
  capturedKeys,
  capturedAt = () => null,
  scope = "visible",
  debounceMs = 2000,
  activeMs = 10_000,
  chunk = 12,
  visibleMax = 24,
  now = Date.now,
  timers = globalThis,
}) {
  /** @type {Set<string> | "all" | null} */
  let manual = null
  let changedAt = null // ms of the last source change
  const startedFor = new Map() // key → when we last started capturing it
  const tried = new Set() // keys already tried since the last change (a failing one is not retried in a loop)
  let visible = []
  let visibleAt = -Infinity
  let running = null
  let timer = null

  const active = () => now() - visibleAt < activeMs
  const stamp = (k) => startedFor.get(k) ?? Date.parse(capturedAt(k) ?? "") // NaN when never captured
  const isStale = (k) => changedAt != null && stamp(k) < changedAt
  const staleVisible = () => visible.filter((k) => isStale(k) && !tried.has(k))

  function next() {
    if (manual) {
      const keys = manual === "all" ? "all" : [...manual]
      manual = null
      return { keys, background: false, auto: false }
    }
    if (timer || !active() || changedAt == null) return null
    const shown = staleVisible().slice(0, visibleMax)
    if (shown.length) return { keys: shown, background: false, auto: true }
    if (scope === "all") {
      const rest = capturedKeys().filter((k) => isStale(k) && !tried.has(k))
      if (rest.length) return { keys: rest.slice(0, chunk), background: true, auto: true }
    }
    return null
  }

  function pump() {
    if (running) return
    const job = next()
    if (!job) return
    const started = now()
    running = job
    for (const k of job.keys === "all" ? capturedKeys() : job.keys) {
      startedFor.set(k, started)
      if (job.auto) tried.add(k)
    }
    Promise.resolve()
      .then(() => run(job.keys, { background: job.background }))
      .catch(() => {})
      .finally(() => {
        running = null
        pump()
      })
  }

  return {
    /** Re-capture these states (or everything) as soon as the current job ends. */
    request(keys) {
      if (keys === "all" || manual === "all") manual = "all"
      else manual = new Set([...(manual ?? []), ...keys])
      pump()
    },
    /** The app's source changed: states are out of date; capture after a quiet moment. */
    sourceChanged() {
      changedAt = now()
      tried.clear()
      if (timer) timers.clearTimeout(timer)
      timer = timers.setTimeout(() => {
        timer = null
        pump()
      }, debounceMs)
    },
    /** The cards the viewer has on screen, most important first. Also its "I'm looking" heartbeat. */
    setVisible(keys) {
      visible = [...new Set(keys)].slice(0, 500)
      visibleAt = now()
      pump()
    },
    status() {
      return {
        running: !!running,
        /** A refresh after a source change is waiting or under way */
        refreshing: !!running?.auto || (active() && changedAt != null && (!!timer || staleVisible().length > 0)),
        sourceChangedAt: changedAt == null ? null : new Date(changedAt).toISOString(),
        keys: running?.keys ?? null,
      }
    },
  }
}
