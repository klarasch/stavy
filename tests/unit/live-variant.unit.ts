import { describe, expect, it } from "vitest"
import { replaysLive } from "../../src/stavy/boards/liveVariant"

describe("replaysLive", () => {
  it("replays actions that only open or point at things", () => {
    expect(replaysLive(undefined)).toBe(true)
    expect(replaysLive([{ click: "StatusFilter" }, { hover: "Row" }, { focus: "Search" }, { wait: 200 }, { hold: true }])).toBe(true)
  })
  it("keeps the snapshot when a variant types or presses keys", () => {
    expect(replaysLive([{ click: "Edit" }, { type: "hello", into: "Name" }])).toBe(false)
    expect(replaysLive([{ press: "Enter" }])).toBe(false)
    expect(replaysLive([{ unknown: 1 }])).toBe(false)
  })
})
