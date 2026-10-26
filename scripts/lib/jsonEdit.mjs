// Format-preserving edits to JSON text. Pure: no I/O, no dependencies.
//
//   setAt(text, ["pages", 3, "label"], "Inbox")  → text with only that value's bytes changed
//   removeAt(text, ["pages", 3, "note"])          → text without that member
//
// A path is object keys and array indexes. Setting a key that doesn't exist
// inserts it as the object's last member, in the object's own style: inline
// (`{ "a": 1, "b": 2 }`) when the object sits on one line, else on its own
// line at its siblings' indentation. Throws when the text isn't valid JSON or
// the path doesn't lead anywhere.

/* ---------------- scanner: values with their spans ---------------- */

function scan(text) {
  let i = 0
  const fail = (why) => {
    throw new Error(`JSON: ${why} at ${i}`)
  }
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++
  }
  const str = () => {
    const start = i
    i++ // opening quote
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1
    if (i >= text.length) fail("unterminated string")
    i++
    return JSON.parse(text.slice(start, i))
  }
  const val = () => {
    ws()
    const start = i
    const c = text[i]
    if (c === "{") {
      i++
      const members = []
      ws()
      if (text[i] === "}") return { type: "object", start, end: ++i, members }
      for (;;) {
        ws()
        if (text[i] !== '"') fail("expected a key")
        const keyStart = i
        const key = str()
        const keyEnd = i
        ws()
        if (text[i] !== ":") fail("expected ':'")
        i++
        const value = val()
        members.push({ key, keyStart, keyEnd, value })
        ws()
        if (text[i] === ",") {
          i++
          continue
        }
        if (text[i] === "}") return { type: "object", start, end: ++i, members }
        fail("expected ',' or '}'")
      }
    }
    if (c === "[") {
      i++
      const items = []
      ws()
      if (text[i] === "]") return { type: "array", start, end: ++i, items }
      for (;;) {
        items.push(val())
        ws()
        if (text[i] === ",") {
          i++
          continue
        }
        if (text[i] === "]") return { type: "array", start, end: ++i, items }
        fail("expected ',' or ']'")
      }
    }
    if (c === '"') {
      str()
      return { type: "value", start, end: i }
    }
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64))
    if (!m) fail("unexpected character")
    i += m[0].length
    return { type: "value", start, end: i }
  }
  const root = val()
  ws()
  if (i !== text.length) fail("trailing text")
  return root
}

/** Walk `path` to the node that holds its last segment. */
function locate(text, path) {
  if (!Array.isArray(path) || path.length === 0) throw new Error("path must be a non-empty array")
  let node = scan(text)
  for (const seg of path.slice(0, -1)) {
    node = child(node, seg)
    if (!node) throw new Error(`path not found: ${path.join(".")}`)
  }
  return node
}

function child(node, seg) {
  if (node.type === "object" && typeof seg === "string") return lastMember(node, seg)?.value
  if (node.type === "array" && Number.isInteger(seg)) return node.items[seg]
  return undefined
}
// JSON.parse keeps the last of duplicate keys; so do we.
const lastMember = (node, key) => node.members.findLast((m) => m.key === key)

/* ---------------- style ---------------- */

const lineStart = (text, at) => text.lastIndexOf("\n", at - 1) + 1
const indentAt = (text, at) => /^[ \t]*/.exec(text.slice(lineStart(text, at)))[0]
const oneLine = (text, node) => !text.slice(node.start, node.end).includes("\n")

/** The step between nesting levels: from the object's members, else two spaces. */
function unitOf(text, obj) {
  const first = obj.members?.[0] ?? obj.items?.[0]
  if (!first || oneLine(text, obj)) return "  "
  const outer = indentAt(text, obj.start)
  const inner = indentAt(text, first.keyStart ?? first.start)
  return inner.length > outer.length ? inner.slice(outer.length) : "  "
}

/** A value on one line, spaced like hand-written JSON: `{ "a": 1 }`, `[1, 2]`. */
function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined)
    return keys.length ? `{ ${keys.map((k) => `${JSON.stringify(k)}: ${inline(v[k])}`).join(", ")} }` : "{}"
  }
  return JSON.stringify(v)
}

/** A value written at `indent`: inline when asked, else pretty with `unit` steps. */
function render(v, multiline, indent, unit) {
  if (!multiline || v === null || typeof v !== "object") return inline(v)
  return JSON.stringify(v, null, unit).replace(/\n/g, "\n" + indent)
}

/* ---------------- edits ---------------- */

/** Set the value at `path` (a new key is inserted), changing as few bytes as possible. */
export function setAt(text, path, value) {
  if (value === undefined) return removeAt(text, path)
  const parent = locate(text, path)
  const key = path.at(-1)
  if (parent.type === "array") {
    const it = Number.isInteger(key) ? parent.items[key] : undefined
    if (!it) throw new Error(`no index ${String(key)} at ${path.join(".")}`)
    const v = render(value, !oneLine(text, it), indentAt(text, it.start), unitOf(text, parent))
    return text.slice(0, it.start) + v + text.slice(it.end)
  }
  if (parent.type !== "object" || typeof key !== "string") throw new Error(`not an object at ${path.join(".")}`)
  const unit = unitOf(text, parent)
  const m = lastMember(parent, key)
  if (m) {
    const v = render(value, !oneLine(text, m.value), indentAt(text, m.keyStart), unit)
    return text.slice(0, m.value.start) + v + text.slice(m.value.end)
  }
  const k = JSON.stringify(key)
  if (parent.members.length === 0) {
    // `{}`: inline, or on its own line if the braces already sit apart.
    if (oneLine(text, parent)) return text.slice(0, parent.start) + `{ ${k}: ${inline(value)} }` + text.slice(parent.end)
    const outer = indentAt(text, parent.start)
    return text.slice(0, parent.start) + `{\n${outer}${unit}${k}: ${render(value, true, outer + unit, unit)}\n${outer}}` + text.slice(parent.end)
  }
  const last = parent.members.at(-1)
  if (oneLine(text, parent)) {
    // Copy the object's own spacing: after the colon and after a comma.
    const colon = /^\s*:(\s*)/.exec(text.slice(last.keyEnd, last.value.start))?.[1] ?? " "
    const prev = parent.members.at(-2)
    const comma = prev ? /,(\s*)$/.exec(text.slice(prev.value.end, last.keyStart))?.[1] ?? " " : " "
    return text.slice(0, last.value.end) + `,${comma}${k}:${colon}${inline(value)}` + text.slice(last.value.end)
  }
  const indent = indentAt(text, last.keyStart)
  // Siblings on one line each: a new line at their indent. Several per line: append to the last line.
  const sameLine = lineStart(text, last.keyStart) === lineStart(text, parent.members[0].keyStart) && parent.members.length > 1
  const sep = sameLine ? ", " : `,\n${indent}`
  return text.slice(0, last.value.end) + `${sep}${k}: ${render(value, true, indent, unit)}` + text.slice(last.value.end)
}

/** Remove the member (or array item) at `path`, with its comma and its line when it had one. */
export function removeAt(text, path) {
  const parent = locate(text, path)
  const key = path.at(-1)
  const entries =
    parent.type === "object"
      ? parent.members.map((m) => ({ start: m.keyStart, end: m.value.end, hit: m.key === key }))
      : parent.type === "array"
        ? parent.items.map((it, i) => ({ start: it.start, end: it.end, hit: i === key }))
        : []
  const at = entries.findLastIndex((e) => e.hit)
  if (at === -1) return text // nothing there: nothing to remove
  if (entries.length === 1) {
    const open = parent.start + 1
    const close = parent.end - 1
    return text.slice(0, open) + text.slice(close)
  }
  if (at === entries.length - 1) return text.slice(0, entries[at - 1].end) + text.slice(entries[at].end)
  return text.slice(0, entries[at].start) + text.slice(entries[at + 1].start)
}
