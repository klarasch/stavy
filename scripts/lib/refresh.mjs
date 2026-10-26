// The dev plugin's scan queue: which states to re-capture next, one scan at a
// time. Pure apart from the timer and the `run` callback it is given, so the
// order can be unit-tested without a browser.
//
// Order: a scan someone asked for (a card's refresh button), then, after the
// app's source changed, the cards the viewer says are on screen, then every
// other captured state in small background chunks. A source change while a
// scan runs doesn't start a second one: the running scan finishes, and the
// refresh starts over from the visible cards.

/**
 * @param {{
 *   run: (keys: string[] | "all", o: { background: boolean }) => Promise<unknown>,
 *   capturedKeys: () => string[],
 *   debounceMs?: number, chunk?: number, visibleMax?: number,
 *   now?: () => number,
 *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout },
 * }} o
 */
export function createRefresher({ run, capturedKeys, debounceMs = 800, chunk = 12, visibleMax = 24, now = Date.now, timers = globalThis }) {
  /** @type {Set<string> | "all" | null} */
  let manual = null
  let stale = false // every captured state is out of date, except `fresh`
  const fresh = new Set()
  let gen = 0 // bumps on every (debounced) source change
  let visible = []
  let running = null
  let timer = null
  let changedAt = null

  function next() {
    if (manual) {
      const keys = manual === "all" ? "all" : [...manual]
      manual = null
      return { keys, background: false, auto: false }
    }
    if (!stale) return null
    const shown = visible.filter((k) => !fresh.has(k)).slice(0, visibleMax)
    if (shown.length) return { keys: shown, background: false, auto: true }
    const rest = capturedKeys().filter((k) => !fresh.has(k))
    if (rest.length) return { keys: rest.slice(0, chunk), background: true, auto: true }
    stale = false
    fresh.clear()
    return null
  }

  function pump() {
    if (running) return
    const job = next()
    if (!job) return
    running = { ...job, gen }
    Promise.resolve()
      .then(() => run(job.keys, { background: job.background }))
      .catch(() => {})
      .finally(() => {
        // Captured before the latest change? Then they are still stale.
        if (job.auto && running.gen === gen) for (const k of job.keys) fresh.add(k)
        running = null
        pump()
      })
  }

  return {
    /** Re-capture these states (or everything) as soon as the current scan ends. */
    request(keys) {
      if (keys === "all" || manual === "all") manual = "all"
      else manual = new Set([...(manual ?? []), ...keys])
      pump()
    },
    /** The app's source changed: refresh everything after a quiet moment. */
    sourceChanged() {
      changedAt = now()
      if (timer) timers.clearTimeout(timer)
      timer = timers.setTimeout(() => {
        timer = null
        gen++
        stale = true
        fresh.clear()
        pump()
      }, debounceMs)
    },
    /** The keys of the cards the viewer has on screen, most important first. */
    setVisible(keys) {
      visible = [...new Set(keys)].slice(0, 500)
      pump()
    },
    status() {
      return {
        running: !!running,
        /** A refresh after a source change is waiting or under way */
        refreshing: !!timer || stale || !!running?.auto,
        sourceChangedAt: changedAt == null ? null : new Date(changedAt).toISOString(),
        keys: running?.keys ?? null,
      }
    },
  }
}
