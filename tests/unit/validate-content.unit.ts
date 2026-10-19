import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { validate } from "../../scripts/validate.mjs"

let root: string
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "stavy-validate-"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const manifest = (): any => ({
  version: "0.3",
  product: { name: "T" },
  pages: [
    {
      id: "contacts",
      label: "Contacts",
      fidelity: "static",
      status: "draft",
      tags: ["crm"],
      layout: "row",
      states: [
        { id: "loaded", url: "/contacts", tags: ["happy"] },
        { id: "empty", url: "/contacts?empty=1" },
      ],
    },
  ],
  scenarios: [],
})
const run = (m: any = manifest()) => validate(m, root, { refs: [], coverage: false, snapshots: join(root, "snapshots") }) as Promise<{ errors: string[]; warnings: string[] }>

describe("validate: named states", () => {
  it("accepts a page with states, no page url, layout, status and tags", async () => {
    const { errors, warnings } = await run()
    expect(errors).toEqual([])
    expect(warnings.filter((w) => !w.startsWith("scan:"))).toEqual([])
  })

  it("requires a url somewhere: a state without one on a page without one is an error", async () => {
    const m = manifest()
    delete m.pages[0].states[1].url
    const { errors } = await run(m)
    expect(errors.some((e) => e.includes("no url"))).toBe(true)
  })

  it("a page url may fill states that have none", async () => {
    const m = manifest()
    m.pages[0].url = "/contacts"
    delete m.pages[0].states[1].url
    expect((await run(m)).errors).toEqual([])
  })

  it("warns about an unknown state in a scenario step, instead of failing", async () => {
    const m = manifest()
    m.scenarios = [{ id: "s", label: "S", refs: ["R"], steps: [{ page: "contacts", state: "ghost", title: "x" }] }]
    const { errors, warnings } = await run(m)
    expect(errors).toEqual([])
    expect(warnings.some((w) => w.includes('no state "ghost"'))).toBe(true)
  })

  it("accepts unknown extra fields on pages and states", async () => {
    const m = manifest()
    m.pages[0].owner = "me"
    m.pages[0].states[0].figma = "https://example.com"
    expect((await run(m)).errors).toEqual([])
  })
})

describe("validate: stavy-content", () => {
  it("is fine without a content folder", async () => {
    expect((await run()).warnings.filter((w) => w.includes("stavy-content"))).toEqual([])
  })

  it("errors only on unparsable JSON", async () => {
    put("stavy-content/index.json", "{ nope")
    put("stavy-content/boards/broken.json", "[1,")
    const { errors } = await run()
    expect(errors.filter((e) => e.includes("not valid JSON"))).toHaveLength(2)
  })

  it("warns about a board that is not in the index, and an index entry without a file", async () => {
    put("stavy-content/index.json", JSON.stringify({ boards: [{ id: "ghost", title: "Ghost" }], docs: [{ id: "nodoc", title: "D" }] }))
    put("stavy-content/boards/real.json", JSON.stringify({ title: "Real", items: [] }))
    const { errors, warnings } = await run()
    expect(errors).toEqual([])
    expect(warnings.some((w) => w.includes('board "ghost" has no'))).toBe(true)
    expect(warnings.some((w) => w.includes("real.json is not listed"))).toBe(true)
    expect(warnings.some((w) => w.includes('doc "nodoc"'))).toBe(true)
  })

  it("warns (never errors) for unknown types, duplicate ids and unknown references", async () => {
    put("stavy-content/index.json", JSON.stringify({ boards: [{ id: "b", title: "B" }] }))
    put(
      "stavy-content/boards/b.json",
      JSON.stringify({
        title: "B",
        items: [
          { id: "a", type: "screen", screen: "contacts", state: "loaded", crop: "Menu", do: [{ click: "Filter" }] },
          { id: "a", type: "note", text: "dup" },
          { id: "w", type: "wobble" },
          { id: "s2", type: "screen", screen: "ghost" },
          { id: "s3", type: "screen", screen: "contacts", state: "ghost" },
          { id: "st", type: "states", screen: "contacts", states: ["loaded", "nope"] },
          { id: "f", type: "flow", flow: "ghost-flow" },
          { id: "ar", type: "arrow", from: "a", to: "missing" },
          { id: "sec", type: "section", title: "S", items: [{ id: "deep", type: "screen", screen: "ghost2" }] },
          { id: "act", type: "screen", screen: "contacts", state: "empty", do: [{ dance: "x" }] },
        ],
      }),
    )
    const { errors, warnings } = await run()
    expect(errors).toEqual([])
    const text = warnings.join("\n")
    expect(text).toContain('duplicate item id "a"')
    expect(text).toContain('unknown type "wobble"')
    expect(text).toContain('unknown screen "ghost"')
    expect(text).toContain('has no state "ghost"')
    expect(text).toContain('has no state "nope"')
    expect(text).toContain('unknown flow "ghost-flow"')
    expect(text).toContain('to "missing" is not an item')
    expect(text).toContain('unknown screen "ghost2"')
    expect(text).toContain("unknown action")
  })

  it("a clean board produces no content warnings", async () => {
    put("stavy-content/index.json", JSON.stringify({ boards: [{ id: "b", title: "B" }] }))
    put(
      "stavy-content/boards/b.json",
      JSON.stringify({
        title: "B",
        items: [
          { id: "a", type: "screen", screen: "contacts", state: "loaded", crop: "Menu", do: [{ click: "Filter" }, { type: "x", into: "Search" }] },
          { id: "n", type: "note", text: "hello", color: "yellow" },
          { id: "ar", type: "arrow", from: "a", to: "n" },
          { id: "md", type: "markdown", md: "# hi", note: "extra field fine", myOwn: 1 },
        ],
      }),
    )
    const { errors, warnings } = await run()
    expect(errors).toEqual([])
    expect(warnings.filter((w) => w.includes("board"))).toEqual([])
  })
})
