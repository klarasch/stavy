import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { removeAt, setAt } from "../../scripts/lib/jsonEdit.mjs"
import { patchManifestText } from "../../scripts/lib/patch.mjs"

/** The lines that differ between two texts of the same length in lines. */
const changed = (a: string, b: string) => {
  const x = a.split("\n")
  const y = b.split("\n")
  return { removed: x.filter((l) => !y.includes(l)), added: y.filter((l) => !x.includes(l)) }
}

describe("setAt", () => {
  const multi = '{\n  "a": "one",\n  "b": {\n    "c": [1, 2],\n    "d": "x"\n  }\n}\n'

  it("replaces a string and nothing else", () => {
    const out = setAt(multi, ["a"], "two")
    expect(out).toBe(multi.replace('"one"', '"two"'))
  })

  it("follows a nested path through objects and arrays", () => {
    expect(setAt(multi, ["b", "d"], "y")).toBe(multi.replace('"x"', '"y"'))
    expect(setAt(multi, ["b", "c", 1], 3)).toBe(multi.replace("[1, 2]", "[1, 3]"))
  })

  it("inserts a key on its own line in a multi-line object", () => {
    const out = setAt(multi, ["b", "e"], "new")
    expect(out).toBe('{\n  "a": "one",\n  "b": {\n    "c": [1, 2],\n    "d": "x",\n    "e": "new"\n  }\n}\n')
    expect(JSON.parse(out).b.e).toBe("new")
  })

  it("inserts a key inline in a one-line object, copying its spacing", () => {
    expect(setAt('{ "list": [{ "id": "a", "label": "A" }] }', ["list", 0, "note"], "n")).toBe('{ "list": [{ "id": "a", "label": "A", "note": "n" }] }')
    expect(setAt('{"a":1,"b":2}', ["c"], 3)).toBe('{"a":1,"b":2,"c":3}')
    expect(setAt('{ "x": {} }', ["x", "k"], "v")).toBe('{ "x": { "k": "v" } }')
  })

  it("writes an object value in the style of where it goes", () => {
    const out = setAt(multi, ["b", "ready"], { at: "2026-01-01", by: "Ana" })
    expect(out).toContain('    "d": "x",\n    "ready": {\n      "at": "2026-01-01",\n      "by": "Ana"\n    }\n  }')
    expect(setAt('{ "s": { "id": "a" } }', ["s", "ready"], { at: "d" })).toBe('{ "s": { "id": "a", "ready": { "at": "d" } } }')
  })

  it("keeps unicode and escapes intact around the edit", () => {
    const text = '{\n  "label": "Café \\"quoted\\" \\u00e9",\n  "emoji": "🚀",\n  "note": "x"\n}'
    const out = setAt(text, ["note"], 'Ünïcode "q" \\ 🚀\nline')
    expect(out.startsWith('{\n  "label": "Café \\"quoted\\" \\u00e9",\n  "emoji": "🚀",\n')).toBe(true)
    expect(JSON.parse(out).note).toBe('Ünïcode "q" \\ 🚀\nline')
    // A key with an escaped quote still finds its value.
    expect(JSON.parse(setAt('{ "a\\"b": 1 }', ['a"b'], 2))).toEqual({ 'a"b': 2 })
  })

  it("throws for a missing path or broken JSON", () => {
    expect(() => setAt(multi, ["nope", "x"], 1)).toThrow()
    expect(() => setAt('{ "a": ', ["a"], 1)).toThrow()
  })
})

describe("removeAt", () => {
  it("removes a member with its comma and line", () => {
    const t = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}'
    expect(removeAt(t, ["b"])).toBe('{\n  "a": 1,\n  "c": 3\n}')
    expect(removeAt(t, ["c"])).toBe('{\n  "a": 1,\n  "b": 2\n}')
    expect(removeAt('{ "a": 1, "b": 2 }', ["a"])).toBe('{ "b": 2 }')
    expect(removeAt('{ "a": 1 }', ["a"])).toBe("{}")
    expect(removeAt(t, ["zzz"])).toBe(t)
  })
})

describe("patchManifestText", () => {
  const raw = readFileSync(join(__dirname, "../../stavy.json"), "utf8")
  const page = JSON.parse(raw).pages[0]
  // A manifest with named states, in the shape JSON.stringify(…, null, 2) writes.
  const withStates = JSON.stringify(
    { pages: [{ id: "inbox", label: "Inbox", url: "/inbox", states: [{ id: "empty", url: "/inbox?s=empty", label: "Empty" }] }] },
    null,
    2
  ) + "\n"

  it("changes one line for a label", () => {
    const r = patchManifestText(raw, ["pages", page.id, "label"], "Renamed")
    expect(r.text).not.toBeNull()
    const d = changed(raw, r.text!)
    expect(d.removed.length).toBe(1)
    expect(d.added).toEqual([d.removed[0].replace(JSON.stringify(page.label), '"Renamed"')])
    expect(JSON.parse(r.text!)).toEqual(r.manifest)
  })

  it("adds and removes optional fields without touching the rest", () => {
    const added = patchManifestText(withStates, ["pages", "inbox", "states", "empty", "note"], "A note")
    const d = changed(withStates, added.text!)
    expect(d.removed).toEqual(['          "label": "Empty"']) // gains a comma
    expect(d.added).toEqual(['          "label": "Empty",', '          "note": "A note"'])
    expect(JSON.parse(added.text!)).toEqual(added.manifest)
    const back = patchManifestText(added.text!, ["pages", "inbox", "states", "empty", "note"], "")
    expect(back.text).toBe(withStates)
  })

  it("records ready with its meta, and drops it again", () => {
    const ready = { at: "2026-10-26", by: "Ana", snapshots: { k: "h" } }
    const r = patchManifestText(raw, ["pages", page.id, "status"], "ready", { ready })
    expect(JSON.parse(r.text!)).toEqual(r.manifest)
    expect(r.manifest.pages.find((p: { id: string }) => p.id === page.id).ready).toEqual(ready)
    const back = patchManifestText(r.text!, ["pages", page.id, "status"], "")
    expect(back.text).toBe(raw)
  })

  it("still refuses what applyPatch refuses", () => {
    expect(() => patchManifestText(raw, ["pages", page.id, "url"], "/x")).toThrow()
    expect(() => patchManifestText(raw, ["pages", page.id, "label"], "")).toThrow()
  })
})
