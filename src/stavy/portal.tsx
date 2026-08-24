import { createContext, useContext } from "react"

/**
 * Overlay containment (SPEC §3). Most kits portal modals, drawers and toasts
 * to `document.body`, which escapes the canvas card's scale + clip and lands
 * a full-viewport overlay at the document root — covering the whole canvas.
 * The viewer therefore hands every rendered page a positioned container to
 * portal into instead. Inside it, `position: fixed` resolves against the card
 * frame rather than the window (the scaled ancestor is a containing block),
 * so a "full-screen" modal fills the card — the flow step stays live on the
 * canvas, which is the point of pinning it.
 *
 * Never adopt an already-portalled node into the card after mount
 * (MutationObserver + appendChild): moving DOM that React owns desyncs
 * React's tree from the document and crashes the canvas on unmount.
 */
const PortalContainerContext = createContext<HTMLElement | null>(null)

export const PortalContainerProvider = PortalContainerContext.Provider

/**
 * The element this page's overlays should portal into. Pages pass it to the
 * kit's escape hatch: MUI/Base `<Modal container={…}>`, Radix
 * `<Portal container={…}>`, Ant `getContainer`, `createPortal(…, container)`.
 * Undefined outside the viewer, so kits fall back to `document.body`.
 */
export function useStavyPortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined
}
