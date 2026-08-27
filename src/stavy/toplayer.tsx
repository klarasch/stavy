import { createPortal } from "react-dom"
import type { ReactNode } from "react"

/**
 * Shared portal root for floating Stavy chrome — tooltips, tour cards, the
 * shortcuts sheet. One fixed, pointer-events-none element at the end of
 * <body> with z-index --ps-z-top, so Stavy UI wins over whatever z-index
 * the host app's own chrome uses, and internal layering stays a private
 * matter between Stavy elements. Page overlays must NOT go here — they are
 * deliberately contained inside card frames (see portal.tsx).
 *
 * Hosts that put their own UI in the native top layer (<dialog>, popover)
 * still paint above any z-index; if that ever bites, the upgrade path is
 * rendering this root with the `popover` attribute and showPopover().
 */
let layer: HTMLDivElement | null = null

export function stavyLayer(): HTMLElement {
  if (!layer || !layer.isConnected) {
    layer = document.createElement("div")
    layer.className = "ps-toplayer"
    layer.setAttribute("data-ps-ui", "")
    document.body.appendChild(layer)
  }
  return layer
}

/** Render children into the Stavy top layer. */
export function StavyLayer({ children }: { children: ReactNode }) {
  return createPortal(children, stavyLayer())
}
