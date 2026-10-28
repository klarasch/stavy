import { contentIndex, viewerHref } from "./manifest"

/**
 * Where the player was opened from. Every view but the player records its own
 * URL (zoom and position included, they're in the query), so the player's
 * Back returns there — a board, a doc, Home or the map — instead of always to
 * the map. Per tab (sessionStorage); a player opened from a link goes to the map.
 */
const KEY = "stavy:origin"

export interface Origin {
  href: string
  label: string
}

export function rememberOrigin(search: string) {
  try {
    sessionStorage.setItem(KEY, search)
  } catch {
    /* storage blocked: Back goes to the map */
  }
}

export function playerOrigin(fallback: string): Origin {
  let search: string | null = null
  try {
    search = sessionStorage.getItem(KEY)
  } catch {
    search = null
  }
  if (search == null) return { href: fallback, label: "Map" }
  const sp = new URLSearchParams(search)
  const href = `${viewerHref}${search}`
  const b = sp.get("b")
  if (b) return { href, label: contentIndex.boards?.find((x) => x.id === b)?.title ?? "Board" }
  if (sp.has("doc")) return { href, label: contentIndex.docs?.find((x) => x.id === sp.get("doc"))?.title ?? "Docs" }
  if (sp.get("view") === "map") return { href, label: "Map" }
  if (sp.get("view") === "home" || !sp.size) return { href, label: "Home" }
  return { href, label: "Map" }
}
