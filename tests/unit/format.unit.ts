import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { formatBoard, isBoardPath } from "../../scripts/lib/format.mjs"

const boardsDir = join(__dirname, "../../stavy-content/boards")

describe("formatBoard", () => {
  it("reproduces the hand-written demo boards byte for byte", () => {
    const files = readdirSync(boardsDir).filter((f) => f.endsWith(".json"))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const text = readFileSync(join(boardsDir, f), "utf8")
      expect(formatBoard(JSON.parse(text)), f).toBe(text)
    }
  })

  it("is idempotent and keeps the data", () => {
    const board = {
      title: "T",
      layout: { direction: "row", gap: 40 },
      items: [
        { id: "n", type: "note", text: "Line\n\"quoted\" — ünïcode", x: 10, y: 20 },
        { id: "s", type: "section", title: "S", items: [{ id: "c", type: "screen", screen: "p", dims: { a: "b" }, do: [{ click: "X" }] }] },
        { id: "a", type: "arrow", from: "n", to: "s" },
        { id: "i", type: "image", src: "x.svg", callouts: [{ x: 0.1, y: 0.2, title: "A" }, { x: 0.3, y: 0.4, title: "B" }] },
      ],
    }
    const once = formatBoard(board)
    expect(JSON.parse(once)).toEqual(board)
    expect(formatBoard(JSON.parse(once))).toBe(once)
  })

  it("lays items out for small diffs", () => {
    const out = formatBoard({
      title: "T",
      items: [
        { id: "n", type: "note", text: "hi" },
        { id: "s", type: "section", items: [{ id: "c1", type: "screen", screen: "p" }, { id: "c2", type: "screen", screen: "q" }] },
        { id: "a", type: "arrow", from: "n", to: "s" },
      ],
    })
    expect(out).toBe(
      [
        "{",
        '  "title": "T",',
        '  "items": [',
        "    {",
        '      "id": "n",',
        '      "type": "note",',
        '      "text": "hi"',
        "    },",
        "    {",
        '      "id": "s",',
        '      "type": "section",',
        '      "items": [',
        '        { "id": "c1", "type": "screen", "screen": "p" },',
        '        { "id": "c2", "type": "screen", "screen": "q" }',
        "      ]",
        "    },",
        '    { "id": "a", "type": "arrow", "from": "n", "to": "s" }',
        "  ]",
        "}",
        "",
      ].join("\n")
    )
  })

  it("a drag changes one line per moved coordinate", () => {
    const board = { title: "T", items: [{ id: "n", type: "note", text: "hi", x: 1, y: 2 }, { id: "m", type: "note", text: "yo" }] }
    const a = formatBoard(board).split("\n")
    const b = formatBoard({ ...board, items: [{ ...board.items[0], x: 50 }, board.items[1]] }).split("\n")
    expect(a.length).toBe(b.length)
    expect(a.filter((l, i) => l !== b[i])).toEqual(['      "x": 1,'])
  })

  it("falls back to plain JSON for anything not board-shaped, and knows board paths", () => {
    expect(formatBoard({ a: [1, 2] })).toBe(JSON.stringify({ a: [1, 2] }, null, 2) + "\n")
    expect(formatBoard({ title: "Empty", items: [] })).toBe('{\n  "title": "Empty",\n  "items": []\n}\n')
    expect(isBoardPath("boards/x.json")).toBe(true)
    expect(isBoardPath("/map.json")).toBe(true)
    expect(isBoardPath("comments.json")).toBe(false)
    expect(isBoardPath("index.json")).toBe(false)
    expect(isBoardPath("boards/sub/x.json")).toBe(false)
  })
})
