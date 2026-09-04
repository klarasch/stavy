// Harness route for the "approval-actions" component page: renders the
// organism alone, reading its dims from the URL like every other Orbit route.
import { useAppNav, useDims } from "../app/dims"
import { ApprovalActions } from "../organisms/ApprovalActions"

const DEFAULTS = { role: "manager", lifecycle: "submitted" }

export default function ApprovalActionsComponent() {
  const dims = useDims(DEFAULTS)
  const nav = useAppNav()
  return (
    <div className="min-h-full bg-muted/40 p-6 flex items-start">
      <div className="w-full max-w-sm">
        <ApprovalActions
          role={dims.role}
          lifecycle={dims.lifecycle}
          onAdvance={(next) => nav("approval-actions", { role: dims.role, lifecycle: next })}
          locale={dims.locale}
        />
      </div>
    </div>
  )
}
