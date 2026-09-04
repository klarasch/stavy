// Harness route for the "work-queue" component page: renders the organism
// alone, reading its dims from the URL like every other Orbit route.
import { useAppNav, useDims } from "../app/dims"
import { WorkQueue } from "../organisms/WorkQueue"
import { dashboardFixture } from "../fixtures"

const DEFAULTS = { role: "manager", state: "loaded" }

export default function WorkQueueComponent() {
  const dims = useDims(DEFAULTS)
  const nav = useAppNav()
  const fx = dashboardFixture(dims.role)
  return (
    <div className="min-h-full bg-muted/40 p-6">
      <WorkQueue
        className="max-w-xl"
        title={fx.queueTitle}
        subtitle={dims.role === "employee" ? "Latest first" : "Oldest first — keep the queue moving"}
        items={fx.queue}
        state={dims.state}
        onOpen={(e) => nav("expense-detail", { role: dims.role, lifecycle: e.status, id: e.id })}
        onViewAll={() => nav("expenses", { role: dims.role })}
        locale={dims.locale}
      />
    </div>
  )
}
