import { appBase, manifest } from "../manifest"
import type { Comment } from "./store"

/* ------------------------------------------------------------------ */
/* Where comments are kept (docs/COMMENTS.md).                          */
/*                                                                      */
/*   "file"   stavy-content/comments.json through the dev endpoint      */
/*   "local"  this browser (localStorage), shared as a link or .md      */
/*   { module: "/stavy-comments.js" }  a same-origin ES module that     */
/*            exports async list(), save(comment), update(id, patch)    */
/*            (and optionally remove(id)); bring your own backend.      */
/*                                                                      */
/* Default: "file" when the dev endpoint is writable, else "local".     */
/* ------------------------------------------------------------------ */

export interface CommentsAdapter {
  list(): Promise<Comment[]>
  save(comment: Comment): Promise<void>
  update(id: string, patch: Partial<Comment>): Promise<void>
  remove?(id: string): Promise<void>
}

export type AdapterSetting = "file" | "local" | { module: string }
export type CommentsMode = "file" | "local" | "module"

export function adapterSetting(): AdapterSetting | undefined {
  return manifest.viewer?.comments?.adapter
}

/** The mode in effect: "file" needs the writable dev endpoint, and falls back to "local" without it. */
export function resolveMode(setting: AdapterSetting | undefined, writable: boolean): CommentsMode {
  if (setting && typeof setting === "object" && typeof setting.module === "string") return "module"
  if (setting === "local") return "local"
  return writable ? "file" : "local"
}

/** Resolve a module spec the way `viewer.inspect.module` is: "/x.js" is under the app's base. */
export function moduleUrl(spec: string): string {
  return spec.startsWith("/") ? `${appBase}${spec}` : spec
}

/**
 * Import the adapter module. Same-origin only: the viewer is a static bundle
 * next to the prototype, and a runtime import of a file it serves is the one
 * plug an adopter can reach without a build step. Fetched and imported from a
 * blob, so a dev server's /public rules don't get in the way (relative
 * imports inside the module are therefore not supported: ship one file).
 */
export async function loadAdapterModule(spec: string): Promise<CommentsAdapter> {
  const url = moduleUrl(spec)
  if (new URL(url, location.href).origin !== location.origin) throw new Error(`viewer.comments.adapter.module must be same-origin — ${spec}`)
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const blob = URL.createObjectURL(new Blob([await res.text()], { type: "text/javascript" }))
  let mod: Record<string, unknown>
  try {
    mod = await import(/* @vite-ignore */ blob)
  } finally {
    URL.revokeObjectURL(blob)
  }
  const a = ((mod.default && typeof mod.default === "object" ? mod.default : mod) ?? {}) as Partial<CommentsAdapter>
  for (const fn of ["list", "save", "update"] as const)
    if (typeof a[fn] !== "function") throw new Error(`comments adapter ${spec} does not export ${fn}()`)
  return a as CommentsAdapter
}
