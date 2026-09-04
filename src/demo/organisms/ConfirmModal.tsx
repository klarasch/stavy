import { createPortal } from "react-dom"
import { Button } from "@/ui/button"
import { proto } from "@/demo/lib/proto"

/**
 * Organism: a destructive-action confirm dialog. A normal modal, portalled to
 * `document.body` like any other — containment (keeping it inside an
 * instance's frame when Stavy snapshots this page) is the overlay viewer's
 * job now, not this component's.
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
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      {...proto("RejectConfirmModal", {
        component: "ConfirmModal (organism)",
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
    document.body
  )
}
