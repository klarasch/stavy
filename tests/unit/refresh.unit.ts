import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { createRefresher } from "../../scripts/lib/refresh.mjs"

type Job = { keys: string[] | "all"; background: boolean; finish: () => void }

function setup(captured: string[], opts: { chunk?: number } = {}) {
  const jobs: Job[] = []
  const r = createRefresher({
    run: (keys: string[] | "all", o: { background: boolean }) => new Promise<void>((finish) => jobs.push({ keys, background: o.background, finish })),
    capturedKeys: () => captured,
    debounceMs: 800,
    chunk: opts.chunk ?? 2,
  })
  /** Finish the running job and let the queue pick the next one. */
  const finish = async () => {
    jobs.at(-1)!.finish()
    await vi.runAllTimersAsync()
  }
  return { r, jobs, finish }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("refresh queue", () => {
  it("waits for the debounce, then does visible cards first and the rest in chunks", async () => {
    const { r, jobs, finish } = setup(["a", "b", "c", "d", "e"])
    r.setVisible(["d", "b"])
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(500)
    r.sourceChanged() // a second save inside the window restarts it
    await vi.advanceTimersByTimeAsync(700)
    expect(jobs).toHaveLength(0)
    expect(r.status().refreshing).toBe(true)
    await vi.advanceTimersByTimeAsync(200)
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

  it("never runs two scans at once; a change mid-scan starts over from the visible cards", async () => {
    const { r, jobs, finish } = setup(["a", "b", "c"])
    r.setVisible(["c"])
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(800)
    expect(jobs.map((j) => j.keys)).toEqual([["c"]])
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(800)
    expect(jobs).toHaveLength(1) // still the one scan
    await finish()
    // "c" was captured before the latest change: it goes again, first.
    expect(jobs.at(-1)!.keys).toEqual(["c"])
  })

  it("moves newly visible cards ahead of the background rest", async () => {
    const { r, jobs, finish } = setup(["a", "b", "c", "d", "e"])
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(800)
    expect(jobs.at(-1)!.keys).toEqual(["a", "b"])
    r.setVisible(["e"])
    expect(jobs).toHaveLength(1)
    await finish()
    expect(jobs.at(-1)!.keys).toEqual(["e"])
    await finish()
    expect(jobs.at(-1)!.keys).toEqual(["c", "d"])
  })

  it("puts a requested scan first and coalesces requests", async () => {
    const { r, jobs, finish } = setup(["a", "b"])
    r.request(["x"])
    r.request(["y"])
    r.request(["z", "y"])
    r.sourceChanged()
    await vi.advanceTimersByTimeAsync(800)
    expect(jobs.map((j) => j.keys)).toEqual([["x"]])
    expect(r.status().running).toBe(true)
    await finish()
    expect(jobs.at(-1)!.keys).toEqual(["y", "z"])
    r.request("all")
    r.request(["q"])
    await finish()
    expect(jobs.at(-1)!.keys).toBe("all")
    await finish()
    expect(jobs.at(-1)!.keys).toEqual(["a", "b"])
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
