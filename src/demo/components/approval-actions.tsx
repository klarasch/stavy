import type { PageProps } from "@/protopact/types"
import { ApprovalActions } from "../organisms/ApprovalActions"

export default function ApprovalActionsComponent({ dims, nav }: PageProps) {
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
