import { describe, it, expect } from "vitest"
import { describeElement, relocate, snippetOf, snippetMatches, findBySnippet, SNIPPET_MAX, type AnchorEl, type AnchorLookups } from "../../src/stavy/comments/anchor"
import { fromFile, toFile, normalize, placeOf, type Comment } from "../../src/stavy/comments/store"

/* A tiny element tree standing in for a DOM: attributes + text, nothing else. */
interface Fake extends AnchorEl {
  tag: string
  attrs: Record<string, string>
  children: Fake[]
  parentElement: Fake | null
  ownText: string
}
function el(tag: string, attrs: Record<string, string> = {}, ...kids: Array<Fake | string>): Fake {
  const children = kids.filter((k): k is Fake => typeof k !== "string")
  const ownText = kids.filter((k): k is string => typeof k === "string").join(" ")
  const node: Fake = {
    tag,
    attrs,
    children,
    parentElement: null,
    ownText,
    get textContent() {
      return [ownText, ...children.map((c) => c.textContent)].join(" ")
    },
    getAttribute: (n: string) => attrs[n] ?? null,
  }
  for (const c of children) c.parentElement = node
  return node
}
function all(root: Fake): Fake[] {
  return [root, ...root.children.flatMap(all)]
}
function lookups(root: Fake): AnchorLookups {
  return {
    root,
    targetOf: (e) => {
      for (let cur = e as Fake | null; cur; cur = cur.parentElement) if (cur.attrs["data-proto"]) return { id: cur.attrs["data-proto"], el: cur }
      return null
    },
    targetsById: (id) => all(root).filter((n) => n.attrs["data-proto"] === id),
    boxOf: () => ({ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }),
  }
}

/** A table whose rows share one target id (the case that used to land every comment on row 1). */
function table(rows: string[][]): Fake {
  return el(
    "body",
    {},
    el("h1", {}, "Expenses"),
    el("table", { "data-proto": "ExpenseTable" }, ...rows.map((cells) => el("tr", { "data-proto": "Row" }, ...cells.map((c) => el("td", {}, c)))))
  )
}

describe("snippets", () => {
  it("uses the element's text, collapsed, else an accessible label", () => {
    expect(snippetOf(el("td", {}, "  Lunch \n  with  team "))).toBe("Lunch with team")
    expect(snippetOf(el("button", { "aria-label": "Close" }))).toBe("Close")
    expect(snippetOf(el("div"))).toBeUndefined()
  })
  it("is capped, and a capped snippet matches as a prefix", () => {
    const long = "x".repeat(200)
    const s = snippetOf(el("p", {}, long))!
    expect(s.length).toBe(SNIPPET_MAX)
    expect(snippetMatches(el("p", {}, long + " more"), s)).toBe(true)
    expect(snippetMatches(el("p", {}, "short"), "shorter")).toBe(false)
  })
  it("findBySnippet returns the deepest element that says it", () => {
    const td = el("td", {}, "Taxi")
    const root = el("body", {}, el("table", {}, el("tr", {}, td)))
    expect(findBySnippet(root, "Taxi")).toBe(td)
  })
})

describe("describeElement → relocate", () => {
  const rows = [
    ["Lunch", "120"],
    ["Taxi", "45"],
    ["Hotel", "980"],
  ]

  it("records the target, which occurrence, the path, the snippet and the box", () => {
    const root = table(rows)
    const cell = root.children[1].children[2].children[1] // row 3, amount
    const a = describeElement(cell, lookups(root))
    expect(a).toEqual({ target: "Row", nth: 2, path: [1], snippet: "980", box: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 } })
  })

  it("lands on the same cell in a fresh copy of the document (not on the first row)", () => {
    const a = describeElement(table(rows).children[1].children[1].children[0], lookups(table(rows)))
    // describe against one tree, relocate in a freshly built one: a reload
    const before = table(rows)
    const anchor = describeElement(before.children[1].children[1].children[0], lookups(before))
    const after = table(rows)
    const found = relocate(anchor, lookups(after))
    expect(found && "el" in found && found.el).toBe(after.children[1].children[1].children[0])
    expect(found?.via).toBe("path")
    expect(a.snippet).toBe("Taxi")
  })

  it("finds the cell by its words when rows were reordered", () => {
    const before = table(rows)
    const anchor = describeElement(before.children[1].children[1].children[0], lookups(before)) // "Taxi", row 2
    const after = table([rows[2], rows[0], rows[1]]) // Taxi is now row 3
    const found = relocate(anchor, lookups(after))
    // (the same path under another row of the same target, verified by its words)
    expect(found && "el" in found && found.el).toBe(after.children[1].children[2].children[0])
  })

  it("searches inside the target when the path no longer holds", () => {
    const before = table(rows)
    const anchor = describeElement(before.children[1].children[1].children[0], lookups(before))
    const after = el("body", {}, el("table", { "data-proto": "ExpenseTable" }, el("tr", { "data-proto": "Row" }, el("td", {}, "✓"), el("td", {}, el("span", {}, "Taxi")))))
    const found = relocate(anchor, lookups(after))
    expect(found?.via).toBe("snippet")
    expect(found && "el" in found && (found.el as Fake).tag).toBe("span")
  })

  it("falls back to the stored box when the element is gone", () => {
    const before = table(rows)
    const anchor = describeElement(before.children[1].children[1].children[0], lookups(before))
    const after = table([["Parking", "8"]])
    const found = relocate(anchor, lookups(after))
    expect(found).toEqual({ box: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, via: "box" })
  })

  it("anchors outside any target from the page root", () => {
    const root = table(rows)
    const h1 = root.children[0]
    const anchor = describeElement(h1, lookups(root))
    expect(anchor.target).toBeUndefined()
    expect(anchor.path).toEqual([0])
    const found = relocate(anchor, lookups(table(rows)))
    expect(found && "el" in found && (found.el as Fake).tag).toBe("h1")
  })

  it("reads anchors from before snippets: target + path, else the target itself", () => {
    const root = table(rows)
    const legacy = { target: "ExpenseTable", path: [0, 1] }
    const found = relocate(legacy, lookups(root))
    expect(found && "el" in found && found.el).toBe(root.children[1].children[0].children[1])
    const broken = relocate({ target: "ExpenseTable", path: [9, 9] }, lookups(root))
    expect(broken && "el" in broken && broken.el).toBe(root.children[1])
    expect(broken?.via).toBe("target")
  })
})

describe("comment file round trip", () => {
  const base = { body: "b", author: "a", createdAt: 1700000000000, resolved: false, replies: [] }
  it("keeps every kind of anchor and tells them apart", () => {
    const list: Comment[] = [
      { ...base, id: "p", page: "expenses", dims: { role: "manager" }, target: "Row", nth: 2, path: [1], snippet: "980", box: { x: 0, y: 0, w: 1, h: 1 }, x: 50, y: 50 },
      { ...base, id: "b", board: "approval-story", item: "s1", x: 10, y: 20 },
      { ...base, id: "m", board: "@map", x: 400, y: 300 },
      { ...base, id: "d", doc: "approval-rules", heading: "Approval limits", quote: "Split into separate claims" },
    ]
    const back = fromFile(toFile(list))
    expect(back).toEqual(list)
    expect(back.map(placeOf)).toEqual(["page", "board", "map", "doc"])
  })
  it("reads version-1 files (ISO dates, no anchor extras)", () => {
    const v1 = JSON.stringify({ version: 1, comments: [{ id: "o", page: "x", dims: {}, target: "T", path: [0], x: 1, y: 2, body: "old", author: "", createdAt: "2026-01-02T10:00:00.000Z", resolved: false, replies: [] }] })
    const [c] = fromFile(v1)
    expect(c.createdAt).toBe(Date.parse("2026-01-02T10:00:00.000Z"))
    expect(placeOf(c)).toBe("page")
  })
  it("normalize fills what an adapter may leave out", () => {
    const [c] = normalize([{ id: "z", page: "x", body: "hi" }])
    expect(c).toMatchObject({ dims: {}, resolved: false, replies: [], author: "" })
  })
})
