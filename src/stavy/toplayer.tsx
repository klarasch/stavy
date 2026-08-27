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
 * paint above any z-index — no number wins against it. So the root promotes
 * itself into the native top layer via `popover="manual"` + showPopover()
 * (manual = no light-dismiss, no auto-closing); the z-index stays as the
 * fallback for browsers without the Popover API, and if showPopover throws,
 * the attribute is removed again (a non-open [popover] is display:none per
 * the UA sheet). Remaining limitation: a host <dialog> opened *after* the
 * layer sits above it in the top-layer stack until it closes; fixed chrome
 * outside this layer (dock, panels) still loses to any native top layer.
 */
let layer: HTMLDivElement | null = null

export function stavyLayer(): HTMLElement {
  if (!layer || !layer.isConnected) {
    layer = document.createElement("div")
    layer.className = "ps-toplayer"
    layer.setAttribute("data-ps-ui", "")
    document.body.appendChild(layer)
    if ("showPopover" in layer) {
      layer.setAttribute("popover", "manual")
      try {
        layer.showPopover()
      } catch {
        layer.removeAttribute("popover")
      }
    }
  }
  return layer
}

/** Render children into the Stavy top layer. */
export function StavyLayer({ children }: { children: ReactNode }) {
  return createPortal(children, stavyLayer())
}
