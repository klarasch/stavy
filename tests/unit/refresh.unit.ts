import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { createRefresher } from "../../scripts/lib/refresh.mjs"

type Job = { keys: string[] | "all"; background: boolean; finish: () => void }

/** `at` holds each captured state's capture time (ms); every state starts captured long ago. */
function setup(captured: string[], opts: { scope?: "visible" | "all"; chunk?: number } = {}) {
  const jobs: Job[] = []
  const at = new Map(captured.map((k) => [k, 1000]))
  const r = createRefresher({
    run: (keys: string[] | "all", o: { background: boolean }) =>
      new Promise<void>((finish) => {
        jobs.push({ keys, background: o.background, finish })
      }),
    capturedKeys: () => captured,
    capturedAt: (k: string) => (at.has(k) ? new Date(at.get(k)!).toISOString() : null),
    scope: opts.scope,
    debounceMs: 2000,
    activeMs: 10_000,
    chunk: opts.chunk ?? 2,
  })
  /** Finish the running job and let the queue pick the next one. */
  const finish = async () => {
    jobs.at(-1)!.finish()
    await vi.advanceTimersByTimeAsync(0)
  }
  return { r, jobs, finish, at }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => vi.useRealTimers())

describe("refresh queue", () => {
  it("captures only the visible out-of-date cards, after the debounce", async () => {
    const { r, jobs, finish } = setup(["a", "b", "c", "d", "e"])
    r.setVisible(["d", "b"])
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(1500)
    r.sourceChanged() // a second save inside the window restarts it
    await vi.advanceTimersByTimeAsync(1900)
    expect(jobs).toHaveLength(0)
    expect(r.status().refreshing).toBe(true)
    await vi.advanceTimersByTimeAsync(200)
    expect(jobs.map((j) => j.keys)).toEqual([["d", "b"]])
    await finish()
    // The rest is only out of date: nothing else runs.
    await vi.advanceTimersByTimeAsync(5000)
    expect(jobs).toHaveLength(1)
    expect(r.status()).toMatchObject({ running: false, refreshing: false })
    expect(typeof r.status().sourceChangedAt).toBe("string")
  })

  it("captures a stale card when it scrolls into view later, without a new change", async () => {
    const { r, jobs, finish } = setup(["a", "b", "c"])
    r.setVisible(["a"])
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(2000)
    expect(jobs.map((j) => j.keys)).toEqual([["a"]])
    await finish()
    r.setVisible(["a", "c"]) // c scrolled in; a is already fresh
    await vi.advanceTimersByTimeAsync(0)
    expect(jobs.map((j) => j.keys)).toEqual([["a"], ["c"]])
    expect(r.status().refreshing).toBe(true)
    await finish()
    r.setVisible(["a", "c"]) // heartbeat: nothing left to do
    await vi.advanceTimersByTimeAsync(0)
    expect(jobs).toHaveLength(2)
    expect(r.status().refreshing).toBe(false)
  })

  it("idles when no viewer has reported lately, and resumes when one does", async () => {
    const { r, jobs } = setup(["a"])
    r.setVisible(["a"])
    await vi.advanceTimersByTimeAsync(11_000) // the viewer went quiet
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(5000)
    expect(jobs).toHaveLength(0)
    expect(r.status().refreshing).toBe(false)
    expect(typeof r.status().sourceChangedAt).toBe("string")
    r.setVisible(["a"]) // the tab is back
    await vi.advanceTimersByTimeAsync(0)
    expect(jobs.map((j) => j.keys)).toEqual([["a"]])
  })

  it("never runs two jobs at once; a change mid-job makes the card out of date again", async () => {
    const { r, jobs, finish } = setup(["a", "b"])
    r.setVisible(["a"])
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(2000)
    expect(jobs.map((j) => j.keys)).toEqual([["a"]])
    await vi.advanceTimersByTimeAsync(500)
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(2000)
    expect(jobs).toHaveLength(1) // still the one job
    await finish()
    // "a" was started before the latest change: it goes again.
    expect(jobs.at(-1)!.keys).toEqual(["a"])
    expect(jobs).toHaveLength(2)
  })

  it("does not retry a failing card in a loop", async () => {
    const { r, jobs, finish } = setup(["a"])
    r.setVisible(["a"])
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(2000)
    await finish()
    for (let i = 0; i < 3; i++) {
      r.setVisible(["a"])
      await vi.advanceTimersByTimeAsync(4000)
    }
    expect(jobs).toHaveLength(1)
  })

  it('scope "all" follows the visible cards with the rest, in chunks', async () => {
    const { r, jobs, finish } = setup(["a", "b", "c", "d", "e"], { scope: "all" })
    r.setVisible(["d", "b"])
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(2000)
    expect(jobs.map((j) => j.keys)).toEqual([["d", "b"]])
    expect(jobs[0].background).toBe(false)
    await finish()
    expect(jobs.at(-1)!.keys).toEqual(["a", "c"])
    expect(jobs.at(-1)!.background).toBe(true)
    await finish()
    expect(jobs.at(-1)!.keys).toEqual(["e"])
    await finish()
    expect(jobs).toHaveLength(3)
    expect(r.status()).toMatchObject({ running: false, refreshing: false })
  })

  it("puts a requested scan first, runs it even when nobody looks, and coalesces requests", async () => {
    const { r, jobs, finish } = setup(["a", "b"])
    r.request(["x"])
    r.request(["y"])
    r.request(["z", "y"])
    await vi.advanceTimersByTimeAsync(0)
    expect(jobs.map((j) => j.keys)).toEqual([["x"]])
    expect(r.status().running).toBe(true)
    await finish()
    expect(jobs.at(-1)!.keys).toEqual(["y", "z"])
    r.request("all")
    r.request(["q"])
    await finish()
    expect(jobs.at(-1)!.keys).toBe("all")
    await finish()
    expect(jobs).toHaveLength(3) // "all" covers "q"
  })

  it("does nothing without a source change, and reports when it happened", async () => {
    const { r, jobs } = setup(["a"])
    r.setVisible(["a"])
    await vi.advanceTimersByTimeAsync(5000)
    expect(jobs).toHaveLength(0)
    expect(r.status().sourceChangedAt).toBeNull()
    r.sourceChanged()
    expect(typeof r.status().sourceChangedAt).toBe("string")
  })
})
