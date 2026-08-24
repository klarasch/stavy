import { createPortal } from "react-dom"
import { Button } from "@/ui/button"
import { proto } from "@/stavy/proto"
import { useStavyPortalContainer } from "@/stavy/portal"

/**
 * Organism: a destructive-action confirm dialog. The reference for overlay
 * containment (SPEC §3): it portals into the container the viewer provides,
 * so on the canvas the "modal open" state renders inside its instance card
 * instead of covering the whole canvas from document.body. Inside the card
 * `position: fixed` resolves against the card frame (a scaled ancestor is a
 * containing block), so the same markup fills the card on the canvas and the
 * window on the open page.
 */
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const container = useStavyPortalContainer()
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      {...proto("RejectConfirmModal", {
        component: "ConfirmModal (organism)",
        portalledInto: "portalContainer (SPEC §3 overlay containment)",
      })}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative w-100 max-w-[90%] rounded-xl border bg-background p-6 shadow-xl">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} {...proto("CancelRejectButton", { component: "Button", closesOverlay: true })}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} {...proto("ConfirmRejectButton", { component: "Button", advancesTo: "rejected" })}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    container ?? document.body
  )
}
