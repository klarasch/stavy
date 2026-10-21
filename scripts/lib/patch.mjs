// The one place that decides which fields of stavy.json the dev viewer may
// edit, and how a path is resolved to a spot in the file. Pure: no I/O.
//
// A path names a text field by ids, not array positions (except the entries
// that have no id):
//   ["pages", <pageId>, "label" | "description" | "status"]
//   ["pages", <pageId>, "states", <stateId>, "label" | "note" | "status"]
//   ["pages", <pageId>, "instances", <index>, "note"]
//   ["scenarios", <id>, "label" | "description"]
//   ["scenarios", <id>, "steps", <index>, "title" | "note"]

const isIndex = (n) => Number.isInteger(n) && n >= 0

/**
 * Resolve a path to `{ parent, key }` inside `manifest`, or throw an Error
 * saying why it is not allowed. Only the fields listed above resolve.
 */
export function resolvePatchPath(manifest, path) {
  if (!Array.isArray(path)) throw new Error("path must be an array")
  const bad = (why) => new Error(`path not editable: ${why}`)
  const byId = (list, id, what) => {
    if (typeof id !== "string") throw bad(`${what} id must be a string`)
    const item = Array.isArray(list) ? list.find((x) => x && x.id === id) : undefined
    if (!item) throw bad(`no ${what} "${id}"`)
    return item
  }
  const at = (list, i, what) => {
    if (!isIndex(i)) throw bad(`${what} index must be a non-negative integer`)
    const item = Array.isArray(list) ? list[i] : undefined
    if (!item || typeof item !== "object") throw bad(`no ${what} at index ${i}`)
    return item
  }
  const field = (obj, key, allowed) => {
    if (typeof key !== "string" || !allowed.includes(key)) throw bad(`field "${String(key)}" is not editable here`)
    return { parent: obj, key }
  }
  const [root, id, ...rest] = path
  if (root === "pages") {
    const page = byId(manifest.pages, id, "page")
    if (rest.length === 1) return field(page, rest[0], ["label", "description", "status"])
    if (rest.length === 3 && rest[0] === "states") return field(byId(page.states, rest[1], "state"), rest[2], ["label", "note", "status"])
    if (rest.length === 3 && rest[0] === "instances") return field(at(page.instances, rest[1], "instance"), rest[2], ["note"])
  } else if (root === "scenarios") {
    const sc = byId(manifest.scenarios, id, "scenario")
    if (rest.length === 1) return field(sc, rest[0], ["label", "description"])
    if (rest.length === 3 && rest[0] === "steps") return field(at(sc.steps, rest[1], "step"), rest[2], ["title", "note"])
  }
  throw bad("unknown path shape")
}

/** The statuses the viewer can set. "ready" means ready for development. */
export const STATUSES = ["draft", "review", "ready"]

/**
 * Set a text field on `manifest` (mutates it). An empty string removes an
 * optional field (note, description, title, status) so the file stays tidy;
 * a label can't be emptied.
 *
 * `status` takes one of STATUSES. Setting "ready" also records `ready`
 * (`opts.ready`: when, who, and the snapshot hashes at that moment, so the
 * viewer can tell when a ready screen changed); any other status drops it.
 */
export function applyPatch(manifest, path, value, opts = {}) {
  if (typeof value !== "string") throw new Error("value must be a string")
  const { parent, key } = resolvePatchPath(manifest, path)
  const v = value.trim()
  if (key === "status") {
    if (v && !STATUSES.includes(v)) throw new Error(`status must be one of ${STATUSES.join(", ")}`)
    if (v === "ready") {
      if (parent.status !== "ready" || opts.ready) parent.ready = opts.ready ?? { at: new Date().toISOString().slice(0, 10) }
    } else delete parent.ready
  }
  if (!v) {
    if (key === "label") throw new Error("label can't be empty")
    delete parent[key]
  } else parent[key] = v
  return manifest
}
