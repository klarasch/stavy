// Diff-friendly JSON for board files (stavy-content/boards/*.json, map.json).
// Pure: no I/O. The viewer and `stavy:format` both write through it, so a drag
// or a text edit changes a line or two instead of reflowing the file.
//
// The layout is the one hand-written boards use:
//   - the board's own keys one per line;
//   - each top-level item expanded, one key per line, values inline;
//   - an arrow on one line;
//   - a section expanded, its child items one per line;
//   - inside an expanded item, an array of two or more objects one per line.
// Inline values read like `{ "id": "a", "w": 300 }` and `["a", "b"]`.

const IND = "  "

/** A value on one line: `{ "k": v, … }`, `[a, b]`, strings as JSON. */
export function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined)
    return keys.length ? `{ ${keys.map((k) => `${JSON.stringify(k)}: ${inline(v[k])}`).join(", ")} }` : "{}"
  }
  return JSON.stringify(v) ?? "null"
}

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v)
const hasItems = (it) => isObj(it) && Array.isArray(it.items)

/** One item at `depth` (0 = a top-level item of the board, 1 = inside a section…). */
function item(it, depth, ind) {
  if (!isObj(it)) return inline(it)
  const oneLine = depth > 0 ? !hasItems(it) : it.type === "arrow"
  if (oneLine) return inline(it)
  const inner = ind + IND
  const lines = Object.keys(it)
    .filter((k) => it[k] !== undefined)
    .map((k) => `${inner}${JSON.stringify(k)}: ${value(k, it[k], depth, inner)}`)
  return lines.length ? `{\n${lines.join(",\n")}\n${ind}}` : "{}"
}

/** A value of an expanded item. */
function value(k, v, depth, ind) {
  if (k === "items" && Array.isArray(v)) return list(v, depth + 1, ind)
  if (Array.isArray(v) && v.length > 1 && v.some(isObj)) return `[\n${v.map((x) => ind + IND + inline(x)).join(",\n")}\n${ind}]`
  return inline(v)
}

function list(items, depth, ind) {
  if (!items.length) return "[]"
  const inner = ind + IND
  return `[\n${items.map((it) => inner + item(it, depth, inner)).join(",\n")}\n${ind}]`
}

/**
 * Format a board (or the map layer) as diff-friendly JSON, with a trailing
 * newline. Anything that isn't board-shaped (no `items` array) falls back to
 * plain two-space JSON. Idempotent: formatting the output again changes nothing.
 */
export function formatBoard(board) {
  if (!isObj(board) || !Array.isArray(board.items)) return JSON.stringify(board, null, 2) + "\n"
  const lines = Object.keys(board)
    .filter((k) => board[k] !== undefined)
    .map((k) => `${IND}${JSON.stringify(k)}: ${k === "items" ? list(board.items, 0, IND) : inline(board[k])}`)
  return `{\n${lines.join(",\n")}\n}\n`
}

/** True for a path inside stavy-content/ that holds a board: boards/*.json or map.json. */
export function isBoardPath(rel) {
  const p = String(rel).replace(/^\/+/, "")
  return p === "map.json" || /^boards\/[^/]+\.json$/.test(p)
}
