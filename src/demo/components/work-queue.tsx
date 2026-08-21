import type { PageProps } from "@/stavy/types"
import { WorkQueue } from "../organisms/WorkQueue"
import { dashboardFixture } from "../fixtures"

export default function WorkQueueComponent({ dims, nav }: PageProps) {
  const fx = dashboardFixture(dims.role)
  return (
    <div className="min-h-full bg-muted/40 p-6">
      <WorkQueue
        className="max-w-xl"
        title={fx.queueTitle}
        subtitle={dims.role === "employee" ? "Latest first" : "Oldest first — keep the queue moving"}
        items={fx.queue}
        state={dims.state}
        onOpen={(e) => nav("expense-detail", { role: dims.role, lifecycle: e.status })}
        onViewAll={() => nav("expenses", { role: dims.role })}
        locale={dims.locale}
      />
    </div>
  )
}
