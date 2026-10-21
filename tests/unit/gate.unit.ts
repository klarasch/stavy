import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installGate } from "../../scripts/lib/gate.mjs"

function fakeWin() {
  return { setTimeout, clearTimeout, setInterval, console } as unknown as Window
}

describe("timer gate", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("holds long timers while closed and runs them on open, in order", () => {
    const w = fakeWin()
    const g = installGate(w)
    const ran: string[] = []
    w.setTimeout(() => ran.push("a"), 1000)
    w.setTimeout(() => ran.push("b"), 1200)
    g.close()
    vi.advanceTimersByTime(2000)
    expect(ran).toEqual([])
    g.open()
    expect(ran).toEqual(["a", "b"])
  })

  it("leaves short timers alone", () => {
    const w = fakeWin()
    installGate(w).close()
    const fn = vi.fn()
    w.setTimeout(fn, 0)
    w.setTimeout(fn, 16)
    vi.advanceTimersByTime(20)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("clearTimeout cancels a queued callback", () => {
    const w = fakeWin()
    const g = installGate(w)
    const fn = vi.fn()
    const id = w.setTimeout(fn, 500)
    g.close()
    vi.advanceTimersByTime(600)
    w.clearTimeout(id)
    g.open()
    expect(fn).not.toHaveBeenCalled()
  })

  it("skips interval ticks while closed", () => {
    const w = fakeWin()
    const g = installGate(w)
    const fn = vi.fn()
    w.setInterval(fn, 100)
    vi.advanceTimersByTime(250)
    expect(fn).toHaveBeenCalledTimes(2)
    g.close()
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(2)
    g.open()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("installs once", () => {
    const w = fakeWin()
    expect(installGate(w)).toBe(installGate(w))
  })
})
