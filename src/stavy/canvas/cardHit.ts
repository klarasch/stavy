import { getPage, getTemplate, resolveDims } from "../manifest"
import { elementAt } from "../frame"
import type { FrameHit } from "../overlays/Inspector"

/**
 * Inspect on any surface of cards (map, board, doc): the pointer lands on a
 * card's shield; resolve it to the element under it inside that card's live
 * frame. `data-instance` is an instanceKey or a variantKey (`page?dims#crop=…`).
 */
export function cardHit(e: MouseEvent): FrameHit | null {
  const card = (e.target as Element | null)?.closest<HTMLElement>("[data-instance]")
  const iframe = card?.querySelector("iframe")
  if (!card || !iframe) return null
  const el = elementAt(iframe, e.clientX, e.clientY)
  if (!el) return null
  const [pageId, qs] = (card.getAttribute("data-instance") ?? "").split("#")[0].split("?")
  const page = getPage(pageId)
  if (!page) return null
  return { el, iframe, ctx: { page, template: getTemplate(page.template), dims: resolveDims(page, Object.fromEntries(new URLSearchParams(qs ?? ""))) } }
}
